#!/usr/bin/env node
/**
 * Schema drift checker.
 *
 * Asserts that `frontend-stubs/lib/types.ts` agrees with
 * `database/prisma/schema.prisma`. Specifically:
 *
 *   1. Every Prisma `enum X` must have an identical TS union literal
 *      `export type X = '...' | '...'` (same name, same members).
 *
 *   2. Every Prisma scalar field on a watched model must appear on the
 *      corresponding TS interface (or one of its parent interfaces),
 *      OR be in the explicit `INTENTIONAL_OMISSIONS` allowlist.
 *
 *   3. The TS union literals defined in the frontend types must NOT
 *      contain values that the matching Prisma enum does not declare.
 *
 * Zero npm dependencies: runs on stock Node, even when the sandbox
 * has no registry access. Wire this into `npm test` so CI catches
 * drift.
 *
 * Exits 0 on success, 1 on drift.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = resolve(SCRIPT_DIR, '..')
const PRISMA_SCHEMA_PATH = resolve(
  ROOT_DIR,
  'database/prisma/schema.prisma'
)
const FRONTEND_TYPES_PATH = resolve(ROOT_DIR, 'frontend-stubs/lib/types.ts')

// ---------------------------------------------------------------------------
// Configuration: what we watch and what we allow to drift on purpose.
// ---------------------------------------------------------------------------

/**
 * Map from Prisma model name → TypeScript interface name(s) that mirror it.
 * Multiple TS shapes can mirror one Prisma model (e.g. `Handover` is
 * exposed as both `HandoverListRow` and `HandoverDetail`).
 */
const MODEL_TO_TS = {
  AircraftItem: ['AircraftItem'],
  AirportItem: ['AirportItem'],
  FlightScheduleItem: ['FlightScheduleItem'],
  CrewItem: ['CrewItem'],
  WeatherItem: ['WeatherItem'],
  SystemItem: ['SystemItem'],
  AbnormalEvent: ['AbnormalEvent'],
}

/**
 * Fields that intentionally do NOT appear on the TS interface, with the
 * reason. Drift checker must be told about these explicitly so a future
 * accidental omission still trips the check.
 *
 * Key shape: `${PrismaModel}.${field}`
 */
const INTENTIONAL_OMISSIONS = {
  // Each item table FK to the parent handover lives on `BaseItem.handoverId`,
  // already covered by inheritance.

  // Cosmetic remappings: the API joins these on the server side, so the
  // client gets `flightsAffected: string | null` (already on BaseItem) and
  // the per-category interface only carries the category-specific scalar
  // fields. Nothing to omit per-category here right now.
}

/**
 * For each Prisma enum, the matching TypeScript type alias name.
 * If a Prisma enum is intentionally not exposed to the client, list it
 * here as `null` so the drift checker knows to skip it.
 */
const ENUM_TO_TS = {
  Shift: 'Shift',
  Priority: 'Priority',
  ItemStatus: 'ItemStatus',
  UserRole: 'UserRole',
  AuditAction: 'AuditAction',
}

// ---------------------------------------------------------------------------
// Prisma schema parser — minimal, regex-based, handles the subset we use.
// ---------------------------------------------------------------------------

/**
 * @returns {{ enums: Record<string, string[]>, models: Record<string, { name: string, optional: boolean, isList: boolean, type: string }[]> }}
 */
function parsePrismaSchema(source) {
  const enums = {}
  const models = {}

  // enum X { A\n B\n C }
  const enumPattern = /^enum\s+(\w+)\s*\{([^}]*)\}/gm
  for (const match of source.matchAll(enumPattern)) {
    const [, name, body] = match
    const members = body
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .filter(Boolean)
    enums[name] = members
  }

  // model X { ... }
  const modelPattern = /^model\s+(\w+)\s*\{([\s\S]*?)\n\}/gm
  for (const match of source.matchAll(modelPattern)) {
    const [, name, body] = match
    const fields = []
    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/\/\/.*$/, '').trim()
      if (!line) continue
      // Skip block-level attributes like `@@index([…])` and `@@unique([…])`.
      if (line.startsWith('@@')) continue
      // Field shape: `name  Type[?|[]]  @attributes…`
      // Note: multi-word relation lines like
      //   `handover Handover @relation(...)`
      // also match this pattern but parse cleanly because we ignore
      // attributes after the type.
      const fieldMatch = line.match(/^(\w+)\s+(\w+)(\?|\[\])?/)
      if (!fieldMatch) continue
      const [, fieldName, fieldType, modifier] = fieldMatch
      fields.push({
        name: fieldName,
        type: fieldType,
        optional: modifier === '?',
        isList: modifier === '[]',
      })
    }
    models[name] = fields
  }

  return { enums, models }
}

// ---------------------------------------------------------------------------
// TypeScript types parser — handles the `export type X = 'a' | 'b'` and
// `export interface X extends Y { … }` subset that frontend-stubs uses.
// ---------------------------------------------------------------------------

function parseTsTypes(source) {
  const stringUnions = {}
  const interfaces = {}

  // export type X = 'A' | 'B' | 'C';
  // (also handles `\n  | 'A'\n  | 'B'` multi-line form)
  const unionPattern = /export\s+type\s+(\w+)\s*=\s*([^;]+);/g
  for (const match of source.matchAll(unionPattern)) {
    const [, name, body] = match
    const literals = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1])
    if (literals.length > 0) {
      stringUnions[name] = literals
    }
  }

  // export interface X [extends Y[, Z]] { … }
  // Body is greedy across nested braces — we count braces manually.
  const interfaceHeaderPattern =
    /export\s+interface\s+(\w+)(?:\s+extends\s+([^\{]+))?\s*\{/g
  for (const headerMatch of source.matchAll(interfaceHeaderPattern)) {
    const [, name, extendsList] = headerMatch
    const bodyStart = headerMatch.index + headerMatch[0].length
    const body = sliceMatchingBrace(source, bodyStart)
    const fields = []
    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/\/\*\*?.*?\*\//gs, '').trim()
      if (!line || line.startsWith('//') || line.startsWith('*')) continue
      // Field shape: `name[?]: type;`
      const fieldMatch = line.match(/^(\w+)(\?)?\s*:/)
      if (!fieldMatch) continue
      const [, fieldName, optional] = fieldMatch
      fields.push({ name: fieldName, optional: Boolean(optional) })
    }
    const parents = extendsList
      ? extendsList
          .split(',')
          .map((parent) => parent.trim())
          .filter(Boolean)
      : []
    interfaces[name] = { fields, parents }
  }

  return { stringUnions, interfaces }
}

/**
 * Return the substring between `start` and the matching `}` that closes
 * the brace opened immediately before `start`.
 */
function sliceMatchingBrace(source, start) {
  let depth = 1
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(start, index)
      }
    }
  }
  return source.slice(start)
}

/**
 * Walk an interface and its parents and return the union of every field
 * name declared (used to support `extends BaseItem`).
 */
function collectInheritedFieldNames(interfaceName, interfaces, seen = new Set()) {
  if (seen.has(interfaceName)) return new Set()
  seen.add(interfaceName)
  const entry = interfaces[interfaceName]
  if (!entry) return new Set()
  const names = new Set(entry.fields.map((field) => field.name))
  for (const parent of entry.parents) {
    for (const inherited of collectInheritedFieldNames(parent, interfaces, seen)) {
      names.add(inherited)
    }
  }
  return names
}

// ---------------------------------------------------------------------------
// Drift comparison.
// ---------------------------------------------------------------------------

function compareEnums(prismaEnums, tsUnions) {
  const errors = []
  for (const [prismaName, tsName] of Object.entries(ENUM_TO_TS)) {
    if (tsName == null) continue
    const prismaMembers = prismaEnums[prismaName]
    if (!prismaMembers) {
      errors.push(`Prisma enum ${prismaName} listed in ENUM_TO_TS is missing from schema.prisma`)
      continue
    }
    const tsMembers = tsUnions[tsName]
    if (!tsMembers) {
      errors.push(
        `TS union ${tsName} (mirror of Prisma enum ${prismaName}) is missing from frontend-stubs/lib/types.ts`
      )
      continue
    }
    const prismaSorted = [...prismaMembers].sort()
    const tsSorted = [...tsMembers].sort()
    const missingInTs = prismaSorted.filter((m) => !tsSorted.includes(m))
    const extraInTs = tsSorted.filter((m) => !prismaSorted.includes(m))
    if (missingInTs.length > 0) {
      errors.push(
        `Enum drift on ${prismaName}/${tsName}: present in Prisma but missing from TS union: ${missingInTs.join(', ')}`
      )
    }
    if (extraInTs.length > 0) {
      errors.push(
        `Enum drift on ${prismaName}/${tsName}: present in TS union but missing from Prisma enum: ${extraInTs.join(', ')}`
      )
    }
  }
  return errors
}

function compareModels(prismaModels, interfaces) {
  const errors = []
  for (const [modelName, tsInterfaceNames] of Object.entries(MODEL_TO_TS)) {
    const prismaFields = prismaModels[modelName]
    if (!prismaFields) {
      errors.push(`Prisma model ${modelName} listed in MODEL_TO_TS is missing from schema.prisma`)
      continue
    }
    for (const interfaceName of tsInterfaceNames) {
      if (!interfaces[interfaceName]) {
        errors.push(
          `TS interface ${interfaceName} (mirror of Prisma model ${modelName}) is missing from frontend-stubs/lib/types.ts`
        )
        continue
      }
      const allFieldNames = collectInheritedFieldNames(interfaceName, interfaces)
      for (const field of prismaFields) {
        // Skip relation fields that point at other models — they are
        // either expanded server-side into joins (preparedBy, handedTo)
        // or live on the parent (handoverId is on BaseItem).
        if (isRelationField(field, prismaModels)) continue

        const omissionKey = `${modelName}.${field.name}`
        if (omissionKey in INTENTIONAL_OMISSIONS) continue

        if (!allFieldNames.has(field.name)) {
          errors.push(
            `Field drift on ${modelName}/${interfaceName}: scalar field "${field.name}" is in Prisma but absent from the TS interface (and its parents). ` +
              `If this is intentional, add "${omissionKey}" to INTENTIONAL_OMISSIONS in scripts/check-schema-drift.mjs with a justification.`
          )
        }
      }
    }
  }
  return errors
}

/**
 * Heuristic: a field is a "relation field" if its type matches another
 * Prisma model name. The accompanying foreign-key scalar (e.g.
 * `handoverId` for the relation field `handover`) stays as a regular
 * scalar in the parser output, which is what we want — it's what the
 * frontend interfaces use.
 */
function isRelationField(field, prismaModels) {
  return Boolean(prismaModels[field.type])
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

function main() {
  const prismaSource = readFileSync(PRISMA_SCHEMA_PATH, 'utf8')
  const tsSource = readFileSync(FRONTEND_TYPES_PATH, 'utf8')

  const { enums: prismaEnums, models: prismaModels } = parsePrismaSchema(prismaSource)
  const { stringUnions, interfaces } = parseTsTypes(tsSource)

  const errors = [
    ...compareEnums(prismaEnums, stringUnions),
    ...compareModels(prismaModels, interfaces),
  ]

  if (errors.length === 0) {
    console.log('[schema-drift] OK — Prisma schema and frontend-stubs/lib/types.ts agree.')
    console.log(
      `[schema-drift] Checked ${Object.keys(ENUM_TO_TS).length} enum(s) and ${Object.keys(MODEL_TO_TS).length} model(s).`
    )
    process.exit(0)
  }

  console.error('[schema-drift] FAIL — drift detected:')
  for (const error of errors) {
    console.error(`  - ${error}`)
  }
  console.error(
    '\nFix one of the four sources, or update INTENTIONAL_OMISSIONS / ENUM_TO_TS / MODEL_TO_TS in scripts/check-schema-drift.mjs if the divergence is on purpose.'
  )
  process.exit(1)
}

main()
