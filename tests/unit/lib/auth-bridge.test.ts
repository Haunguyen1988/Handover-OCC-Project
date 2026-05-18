import { createHmac } from 'node:crypto'

import { UserRole } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { extractAuthenticatedUserFromRequest } from '../../../backend/src/lib/auth-bridge'

// ---------------------------------------------------------------------------
// Why this test file exists
//
// auth-bridge.ts is the entire backend authentication mechanism.
// The original `tests/unit/auth.test.ts` covered only the happy path
// and a single tampered-role case via `attachAuthenticatedUser`. This
// suite tests the verifier directly so every rejection branch in
// `extractAuthenticatedUserFromRequest` is locked in before the
// migration described in `docs/AUTH_MIGRATION.md`.
//
// Branches covered:
//   1. Missing secret → null
//   2. Each of 6 missing headers → null
//   3. Unknown role string → null
//   4. Non-numeric timestamp → null
//   5. Timestamp outside the +/-5min skew window (past + future) → null
//   6. Timestamp inside the skew window → accepted
//   7. Wrong signature → null
//   8. Tampered fields (id / name / email / role) → null
//   9. Valid signature with all 4 valid roles → accepted
//  10. AUTH_SECRET fallback when NEXTAUTH_SECRET is unset
//  11. Constant-time signature comparison rejects a length-mismatched signature
//      without throwing (regression guard for `timingSafeEqual` length check)
// ---------------------------------------------------------------------------

const SECRET = 'test-nextauth-secret-must-be-long-enough'
const FIVE_MIN_MS = 5 * 60 * 1000

type SignedUser = {
  id: string
  name: string
  email: string
  role: UserRole
}

const VALID_USER: SignedUser = {
  id: 'user-1',
  name: 'Shift Supervisor',
  email: 'supervisor@example.com',
  role: UserRole.SUPERVISOR,
}

function signPayload(user: SignedUser, timestamp: string, secret: string): string {
  const payload = [user.id, user.name, user.email, user.role, timestamp].join(':')

  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function buildHeaders(
  user: SignedUser,
  timestamp: string,
  secret: string
): Record<string, string> {
  return {
    'x-occ-auth-user-id': user.id,
    'x-occ-auth-user-name': user.name,
    'x-occ-auth-user-email': user.email,
    'x-occ-auth-user-role': user.role,
    'x-occ-auth-timestamp': timestamp,
    'x-occ-auth-signature': signPayload(user, timestamp, secret),
  }
}

function buildRequest(headers: Record<string, string>) {
  // Express's `req.header()` is case-insensitive; mirror that behaviour
  // so the function under test sees what it would see in production.
  const lower: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    lower[key.toLowerCase()] = value
  }

  return {
    header(name: string) {
      return lower[name.toLowerCase()]
    },
  }
}

function nowTimestamp(): string {
  return Date.now().toString()
}

describe('extractAuthenticatedUserFromRequest', () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = SECRET
    delete process.env.AUTH_SECRET
  })

  afterEach(() => {
    delete process.env.NEXTAUTH_SECRET
    delete process.env.AUTH_SECRET
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('valid request', () => {
    it('accepts a correctly signed request and returns the user', () => {
      const headers = buildHeaders(VALID_USER, nowTimestamp(), SECRET)

      const result = extractAuthenticatedUserFromRequest(buildRequest(headers))

      expect(result).toEqual(VALID_USER)
    })

    it.each([
      UserRole.OCC_STAFF,
      UserRole.SUPERVISOR,
      UserRole.MANAGEMENT_VIEWER,
      UserRole.ADMIN,
    ])('accepts a request with valid role %s', (role) => {
      const user = { ...VALID_USER, role }
      const headers = buildHeaders(user, nowTimestamp(), SECRET)

      const result = extractAuthenticatedUserFromRequest(buildRequest(headers))

      expect(result?.role).toBe(role)
    })

    it('falls back to AUTH_SECRET when NEXTAUTH_SECRET is not set', () => {
      delete process.env.NEXTAUTH_SECRET
      process.env.AUTH_SECRET = 'fallback-secret-also-long-enough'

      const headers = buildHeaders(VALID_USER, nowTimestamp(), 'fallback-secret-also-long-enough')

      const result = extractAuthenticatedUserFromRequest(buildRequest(headers))

      expect(result).toEqual(VALID_USER)
    })

    it('prefers NEXTAUTH_SECRET over AUTH_SECRET when both are set', () => {
      process.env.NEXTAUTH_SECRET = SECRET
      process.env.AUTH_SECRET = 'this-should-be-ignored'

      // Sign with NEXTAUTH_SECRET — verification must succeed.
      const headers = buildHeaders(VALID_USER, nowTimestamp(), SECRET)

      const result = extractAuthenticatedUserFromRequest(buildRequest(headers))

      expect(result).toEqual(VALID_USER)
    })
  })

  // -------------------------------------------------------------------------
  // Missing-input rejection paths
  // -------------------------------------------------------------------------

  describe('rejects when the secret is unavailable', () => {
    it('returns null when NEXTAUTH_SECRET and AUTH_SECRET are both unset', () => {
      delete process.env.NEXTAUTH_SECRET
      delete process.env.AUTH_SECRET

      const headers = buildHeaders(VALID_USER, nowTimestamp(), SECRET)

      expect(extractAuthenticatedUserFromRequest(buildRequest(headers))).toBeNull()
    })

    it('returns null when the secret is an empty string', () => {
      process.env.NEXTAUTH_SECRET = ''
      delete process.env.AUTH_SECRET

      const headers = buildHeaders(VALID_USER, nowTimestamp(), SECRET)

      expect(extractAuthenticatedUserFromRequest(buildRequest(headers))).toBeNull()
    })
  })

  describe('rejects when a required header is missing', () => {
    const requiredHeaders = [
      'x-occ-auth-user-id',
      'x-occ-auth-user-name',
      'x-occ-auth-user-email',
      'x-occ-auth-user-role',
      'x-occ-auth-timestamp',
      'x-occ-auth-signature',
    ] as const

    it.each(requiredHeaders)('returns null when %s is missing', (header) => {
      const headers = buildHeaders(VALID_USER, nowTimestamp(), SECRET)
      delete (headers as Record<string, string | undefined>)[header]

      expect(extractAuthenticatedUserFromRequest(buildRequest(headers))).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Role validation
  // -------------------------------------------------------------------------

  describe('rejects when role is not a known UserRole', () => {
    it('returns null when role is an arbitrary string', () => {
      const user = { ...VALID_USER, role: 'SUPER_ADMIN' as UserRole }
      const headers = buildHeaders(user, nowTimestamp(), SECRET)

      expect(extractAuthenticatedUserFromRequest(buildRequest(headers))).toBeNull()
    })

    it('returns null when role is empty', () => {
      const user = { ...VALID_USER, role: '' as UserRole }
      const headers = buildHeaders(user, nowTimestamp(), SECRET)

      expect(extractAuthenticatedUserFromRequest(buildRequest(headers))).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Timestamp validation (replay-window enforcement, BR for AUTH_MIGRATION#1)
  // -------------------------------------------------------------------------

  describe('rejects timestamps outside the clock-skew window', () => {
    it('returns null when timestamp is exactly 5 minutes + 1ms in the past', () => {
      const staleTimestamp = String(Date.now() - FIVE_MIN_MS - 1)
      const headers = buildHeaders(VALID_USER, staleTimestamp, SECRET)

      expect(extractAuthenticatedUserFromRequest(buildRequest(headers))).toBeNull()
    })

    it('returns null when timestamp is 5 minutes + 1ms in the future', () => {
      const futureTimestamp = String(Date.now() + FIVE_MIN_MS + 1)
      const headers = buildHeaders(VALID_USER, futureTimestamp, SECRET)

      expect(extractAuthenticatedUserFromRequest(buildRequest(headers))).toBeNull()
    })

    it('accepts a timestamp at the +5-minute boundary', () => {
      // Pin "now" so the boundary check is deterministic regardless of the
      // small window between buildHeaders() and extractAuthenticatedUser...
      vi.useFakeTimers()
      const fixedNow = 1_700_000_000_000
      vi.setSystemTime(fixedNow)

      const boundaryTimestamp = String(fixedNow + FIVE_MIN_MS)
      const headers = buildHeaders(VALID_USER, boundaryTimestamp, SECRET)

      expect(extractAuthenticatedUserFromRequest(buildRequest(headers))).toEqual(
        VALID_USER
      )
    })

    it('accepts a timestamp at the -5-minute boundary', () => {
      vi.useFakeTimers()
      const fixedNow = 1_700_000_000_000
      vi.setSystemTime(fixedNow)

      const boundaryTimestamp = String(fixedNow - FIVE_MIN_MS)
      const headers = buildHeaders(VALID_USER, boundaryTimestamp, SECRET)

      expect(extractAuthenticatedUserFromRequest(buildRequest(headers))).toEqual(
        VALID_USER
      )
    })

    it('returns null when timestamp is not numeric', () => {
      // buildHeaders already signs with the (bogus) timestamp, so the
      // rejection here is purely about timestamp parsing — not signature
      // mismatch.
      const headers = buildHeaders(VALID_USER, 'not-a-number', SECRET)

      expect(extractAuthenticatedUserFromRequest(buildRequest(headers))).toBeNull()
    })

    it('returns null when timestamp is empty string', () => {
      // Number('') is 0, which is finite but ~50+ years off from now,
      // so the skew check rejects it.
      const headers = buildHeaders(VALID_USER, '', SECRET)

      expect(extractAuthenticatedUserFromRequest(buildRequest(headers))).toBeNull()
    })

    it('returns null when timestamp is Infinity', () => {
      // Number.isFinite(Infinity) === false, so hasValidClockSkew
      // rejects it before any signature work.
      const headers = buildHeaders(VALID_USER, 'Infinity', SECRET)

      expect(extractAuthenticatedUserFromRequest(buildRequest(headers))).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Signature validation
  // -------------------------------------------------------------------------

  describe('rejects when the signature does not match', () => {
    it('returns null when signature was computed with a different secret', () => {
      const headers = buildHeaders(VALID_USER, nowTimestamp(), 'wrong-secret-but-same-length-roughly')

      expect(extractAuthenticatedUserFromRequest(buildRequest(headers))).toBeNull()
    })

    it('returns null when an attacker tampers with the user id', () => {
      const headers = buildHeaders(VALID_USER, nowTimestamp(), SECRET)
      headers['x-occ-auth-user-id'] = 'attacker-id'

      expect(extractAuthenticatedUserFromRequest(buildRequest(headers))).toBeNull()
    })

    it('returns null when an attacker tampers with the name', () => {
      const headers = buildHeaders(VALID_USER, nowTimestamp(), SECRET)
      headers['x-occ-auth-user-name'] = 'Attacker'

      expect(extractAuthenticatedUserFromRequest(buildRequest(headers))).toBeNull()
    })

    it('returns null when an attacker tampers with the email', () => {
      const headers = buildHeaders(VALID_USER, nowTimestamp(), SECRET)
      headers['x-occ-auth-user-email'] = 'evil@example.com'

      expect(extractAuthenticatedUserFromRequest(buildRequest(headers))).toBeNull()
    })

    it('returns null when an attacker promotes the role from SUPERVISOR to ADMIN', () => {
      const headers = buildHeaders(VALID_USER, nowTimestamp(), SECRET)
      headers['x-occ-auth-user-role'] = UserRole.ADMIN

      expect(extractAuthenticatedUserFromRequest(buildRequest(headers))).toBeNull()
    })

    it('returns null when an attacker forwards a signature replayed from a different timestamp', () => {
      const originalTimestamp = String(Date.now() - 1000)
      const headers = buildHeaders(VALID_USER, originalTimestamp, SECRET)
      // Move the timestamp forward but keep the original signature.
      headers['x-occ-auth-timestamp'] = nowTimestamp()

      expect(extractAuthenticatedUserFromRequest(buildRequest(headers))).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Constant-time comparison safety
  // -------------------------------------------------------------------------

  describe('constant-time signature comparison', () => {
    it('returns null without throwing when the supplied signature has a different length than expected', () => {
      // Regression guard: `crypto.timingSafeEqual` throws if the two
      // buffers differ in length. The verifier must short-circuit on
      // length mismatch before calling timingSafeEqual.
      const headers = buildHeaders(VALID_USER, nowTimestamp(), SECRET)
      headers['x-occ-auth-signature'] = 'short'

      let result: ReturnType<typeof extractAuthenticatedUserFromRequest> | undefined
      expect(() => {
        result = extractAuthenticatedUserFromRequest(buildRequest(headers))
      }).not.toThrow()
      expect(result).toBeNull()
    })

    it('returns null when the signature is the empty string', () => {
      // The empty signature has length 0, so the buffer-length guard in
      // `signaturesMatch` short-circuits before timingSafeEqual.
      const headers = buildHeaders(VALID_USER, nowTimestamp(), SECRET)
      headers['x-occ-auth-signature'] = ''

      let result: ReturnType<typeof extractAuthenticatedUserFromRequest> | undefined
      expect(() => {
        result = extractAuthenticatedUserFromRequest(buildRequest(headers))
      }).not.toThrow()
      expect(result).toBeNull()
    })

    it('returns null when the signature is an arbitrary base64url string of correct length', () => {
      // This exercises the actual timingSafeEqual path (length match,
      // bytes mismatch) which the previous two tests intentionally avoid.
      const headers = buildHeaders(VALID_USER, nowTimestamp(), SECRET)
      // 43 chars = length of a base64url-encoded SHA-256 (32 bytes).
      headers['x-occ-auth-signature'] = 'A'.repeat(43)

      expect(extractAuthenticatedUserFromRequest(buildRequest(headers))).toBeNull()
    })
  })
})
