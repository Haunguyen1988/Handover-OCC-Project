import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// What this guards against
//
// `database/prisma/migrations/20260518000000_audit_log_append_only/`
// installs database triggers that block UPDATE / DELETE / TRUNCATE on
// the AuditLog table. The application code must never attempt those
// operations; if it does, the runtime call will fail with SQLSTATE
// 'AL001' and there's no recovery path inside a transaction.
//
// This test walks the backend source tree and fails if any file calls
// a forbidden audit-log mutation API. It catches the bug at PR review
// time instead of at production runtime.
// ---------------------------------------------------------------------------

const SCANNED_DIRECTORIES = [
  'backend/src',
  'database/prisma',
  'scripts',
] as const

const FORBIDDEN_PATTERNS = [
  // Prisma client mutation methods on `auditLog` / `auditLogs`.
  /\bauditLog\s*\.\s*update\b/,
  /\bauditLog\s*\.\s*updateMany\b/,
  /\bauditLog\s*\.\s*delete\b/,
  /\bauditLog\s*\.\s*deleteMany\b/,
  /\bauditLog\s*\.\s*upsert\b/,
] as const

const ALLOWED_FILES = new Set<string>([
  // The test file itself references the forbidden patterns inside
  // string literals; allowlist by exact path.
  'tests/unit/audit-log-append-only.test.ts',
])

function* walk(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    let info
    try {
      info = statSync(fullPath)
    } catch {
      continue
    }
    if (info.isDirectory()) {
      // Skip generated / vendored directories.
      if (entry === 'node_modules' || entry === 'dist' || entry === 'tempdist') {
        continue
      }
      yield* walk(fullPath)
    } else if (info.isFile()) {
      if (
        fullPath.endsWith('.ts') ||
        fullPath.endsWith('.mts') ||
        fullPath.endsWith('.mjs') ||
        fullPath.endsWith('.js')
      ) {
        yield fullPath
      }
    }
  }
}

describe('AuditLog append-only contract', () => {
  it('rejects forbidden mutation calls on auditLog in scanned source trees', () => {
    const offences: Array<{
      file: string
      pattern: string
      excerpt: string
    }> = []

    // Scan from the workspace root so paths in error messages are
    // relative and easy to act on.
    const workspaceRoot = process.cwd()

    for (const dir of SCANNED_DIRECTORIES) {
      const absoluteDir = join(workspaceRoot, dir)
      for (const file of walk(absoluteDir)) {
        const relative = file.slice(workspaceRoot.length + 1)
        if (ALLOWED_FILES.has(relative)) continue

        const source = readFileSync(file, 'utf8')
        for (const pattern of FORBIDDEN_PATTERNS) {
          const match = pattern.exec(source)
          if (match) {
            // Surface a small excerpt so the failure points at the
            // exact line.
            const beforeMatch = source.slice(0, match.index)
            const lineNumber = beforeMatch.split('\n').length
            const lineStart = source.lastIndexOf('\n', match.index) + 1
            const lineEnd = source.indexOf('\n', match.index)
            const line = source.slice(
              lineStart,
              lineEnd === -1 ? source.length : lineEnd
            )
            offences.push({
              file: `${relative}:${lineNumber}`,
              pattern: pattern.source,
              excerpt: line.trim(),
            })
          }
        }
      }
    }

    if (offences.length > 0) {
      const message =
        '\n\nAuditLog is append-only at the database level (see ' +
        '`database/prisma/migrations/20260518000000_audit_log_append_only/`). ' +
        'The following forbidden mutation calls were detected:\n\n' +
        offences
          .map((o) => `  - ${o.file}\n      pattern: ${o.pattern}\n      line:    ${o.excerpt}`)
          .join('\n\n') +
        '\n\nRemove the call. If a corrective DML on AuditLog is genuinely ' +
        'required, document it as an out-of-band DBA action per the ' +
        'migration\'s emergency-repair section.\n'
      expect.fail(message)
    }
  })
})
