import { type Request, type Response } from 'express'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createRateLimitMiddleware,
  createRateLimitMiddlewareFromEnv,
} from '../../../backend/src/middleware/rate-limit.middleware'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type MockResponse = Response & {
  statusCode?: number
  payload?: unknown
  headers: Record<string, string>
}

function createMockResponse(): MockResponse {
  const headers: Record<string, string> = {}
  const response = {
    headers,
    setHeader(name: string, value: string) {
      headers[name] = value
      return response
    },
    status(code: number) {
      response.statusCode = code
      return response
    },
    json(payload: unknown) {
      response.payload = payload
      return response
    },
  }

  return response as unknown as MockResponse
}

function createMockRequest(
  overrides: { user?: Request['user']; ip?: string } = {}
): Request {
  return {
    user: overrides.user,
    ip: overrides.ip ?? '127.0.0.1',
    socket: { remoteAddress: overrides.ip ?? '127.0.0.1' },
  } as Request
}

/**
 * Drive the middleware once, returning a tuple of `(next-was-called, res)`
 * so callers can assert both flows.
 */
function runMiddleware(
  middleware: ReturnType<typeof createRateLimitMiddleware>,
  req: Request
) {
  const res = createMockResponse()
  let nextCalled = false
  middleware(req, res, () => {
    nextCalled = true
  })
  return { nextCalled, res }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createRateLimitMiddleware', () => {
  afterEach(() => {
    delete process.env.RATE_LIMIT_CAPACITY
    delete process.env.RATE_LIMIT_REFILL_INTERVAL_MS
    delete process.env.RATE_LIMIT_MAX_IDENTITIES
  })

  // -------------------------------------------------------------------------
  // Construction validation
  // -------------------------------------------------------------------------

  describe('construction', () => {
    it('throws when capacity is not positive', () => {
      expect(() =>
        createRateLimitMiddleware({ capacity: 0, refillIntervalMs: 1000 })
      ).toThrow('capacity must be > 0')
    })

    it('throws when refillIntervalMs is not positive', () => {
      expect(() =>
        createRateLimitMiddleware({ capacity: 10, refillIntervalMs: 0 })
      ).toThrow('refillIntervalMs must be > 0')
    })
  })

  // -------------------------------------------------------------------------
  // Token consumption
  // -------------------------------------------------------------------------

  describe('token consumption', () => {
    it('passes through requests up to capacity, rejecting the first over-cap request', () => {
      const middleware = createRateLimitMiddleware({
        capacity: 3,
        refillIntervalMs: 60_000,
        // Pin the clock so refill cannot mask the rejection.
        now: () => 1_700_000_000_000,
      })
      const req = createMockRequest({ ip: '10.0.0.1' })

      // First 3 requests succeed and consume one token each.
      const r1 = runMiddleware(middleware, req)
      const r2 = runMiddleware(middleware, req)
      const r3 = runMiddleware(middleware, req)
      const r4 = runMiddleware(middleware, req)

      expect(r1.nextCalled).toBe(true)
      expect(r2.nextCalled).toBe(true)
      expect(r3.nextCalled).toBe(true)
      expect(r4.nextCalled).toBe(false)
      expect(r4.res.statusCode).toBe(429)
    })

    it('decrements X-RateLimit-Remaining header on each request', () => {
      const middleware = createRateLimitMiddleware({
        capacity: 3,
        refillIntervalMs: 60_000,
        now: () => 1_700_000_000_000,
      })
      const req = createMockRequest({ ip: '10.0.0.1' })

      const r1 = runMiddleware(middleware, req)
      const r2 = runMiddleware(middleware, req)
      const r3 = runMiddleware(middleware, req)

      expect(r1.res.headers['X-RateLimit-Limit']).toBe('3')
      expect(r1.res.headers['X-RateLimit-Remaining']).toBe('2')
      expect(r2.res.headers['X-RateLimit-Remaining']).toBe('1')
      expect(r3.res.headers['X-RateLimit-Remaining']).toBe('0')
    })

    it('returns 429 with RATE_LIMIT_EXCEEDED, retry-after header, and JSON body', () => {
      const middleware = createRateLimitMiddleware({
        capacity: 1,
        refillIntervalMs: 60_000,
        now: () => 1_700_000_000_000,
      })
      const req = createMockRequest({ ip: '10.0.0.1' })

      runMiddleware(middleware, req) // consume the only token
      const blocked = runMiddleware(middleware, req)

      expect(blocked.nextCalled).toBe(false)
      expect(blocked.res.statusCode).toBe(429)
      expect(blocked.res.payload).toMatchObject({
        error: 'RATE_LIMIT_EXCEEDED',
        message: expect.stringContaining('Too many requests'),
        details: {
          retryAfterSeconds: expect.any(Number),
        },
      })
      // Retry-After must be at least 1 second per RFC 7231 §7.1.3.
      const retryAfter = Number(blocked.res.headers['Retry-After'])
      expect(retryAfter).toBeGreaterThanOrEqual(1)
      expect(blocked.res.headers['X-RateLimit-Remaining']).toBe('0')
    })
  })

  // -------------------------------------------------------------------------
  // Refill behaviour
  // -------------------------------------------------------------------------

  describe('refill', () => {
    it('refills the bucket to capacity after a full interval has elapsed', () => {
      let now = 1_000_000_000_000
      const middleware = createRateLimitMiddleware({
        capacity: 2,
        refillIntervalMs: 10_000,
        now: () => now,
      })
      const req = createMockRequest({ ip: '10.0.0.1' })

      // Drain the bucket.
      runMiddleware(middleware, req)
      runMiddleware(middleware, req)
      const blocked = runMiddleware(middleware, req)
      expect(blocked.res.statusCode).toBe(429)

      // Advance past a full refill interval.
      now += 10_000

      const r4 = runMiddleware(middleware, req)
      const r5 = runMiddleware(middleware, req)
      const r6 = runMiddleware(middleware, req)

      // 2 tokens were refilled, so 2 more requests pass and the 3rd fails.
      expect(r4.nextCalled).toBe(true)
      expect(r5.nextCalled).toBe(true)
      expect(r6.nextCalled).toBe(false)
    })

    it('partially refills proportional to elapsed time', () => {
      let now = 1_000_000_000_000
      const middleware = createRateLimitMiddleware({
        capacity: 10,
        refillIntervalMs: 10_000, // 1 token per 1000ms
        now: () => now,
      })
      const req = createMockRequest({ ip: '10.0.0.1' })

      // Drain all 10 tokens.
      for (let i = 0; i < 10; i += 1) runMiddleware(middleware, req)
      expect(runMiddleware(middleware, req).nextCalled).toBe(false)

      // Advance 3 seconds — should refill 3 tokens.
      now += 3_000

      const r1 = runMiddleware(middleware, req)
      const r2 = runMiddleware(middleware, req)
      const r3 = runMiddleware(middleware, req)
      const r4 = runMiddleware(middleware, req)

      expect(r1.nextCalled).toBe(true)
      expect(r2.nextCalled).toBe(true)
      expect(r3.nextCalled).toBe(true)
      expect(r4.nextCalled).toBe(false)
    })

    it('caps refilled tokens at capacity even after a long idle period', () => {
      let now = 1_000_000_000_000
      const middleware = createRateLimitMiddleware({
        capacity: 5,
        refillIntervalMs: 10_000,
        now: () => now,
      })
      const req = createMockRequest({ ip: '10.0.0.1' })

      // Consume one token, then idle for 100x the refill interval.
      runMiddleware(middleware, req)
      now += 1_000_000

      // Bucket should be capped at capacity (5), not the silly inflated number.
      let nextCalls = 0
      for (let i = 0; i < 6; i += 1) {
        if (runMiddleware(middleware, req).nextCalled) nextCalls += 1
      }
      expect(nextCalls).toBe(5)
    })
  })

  // -------------------------------------------------------------------------
  // Identity strategy
  // -------------------------------------------------------------------------

  describe('identity', () => {
    it('keys off req.user.id when authenticated', () => {
      const middleware = createRateLimitMiddleware({
        capacity: 1,
        refillIntervalMs: 60_000,
        now: () => 1_700_000_000_000,
      })

      const userA = createMockRequest({
        user: {
          id: 'user-A',
          name: 'A',
          email: 'a@x.test',
          role: 'OCC_STAFF',
        } as Request['user'],
      })
      const userB = createMockRequest({
        user: {
          id: 'user-B',
          name: 'B',
          email: 'b@x.test',
          role: 'OCC_STAFF',
        } as Request['user'],
      })

      // Both users start with their own bucket and can spend their token.
      expect(runMiddleware(middleware, userA).nextCalled).toBe(true)
      expect(runMiddleware(middleware, userB).nextCalled).toBe(true)
      // Each user is now exhausted independently.
      expect(runMiddleware(middleware, userA).nextCalled).toBe(false)
      expect(runMiddleware(middleware, userB).nextCalled).toBe(false)
    })

    it('falls back to req.ip when req.user is absent', () => {
      const middleware = createRateLimitMiddleware({
        capacity: 1,
        refillIntervalMs: 60_000,
        now: () => 1_700_000_000_000,
      })

      const ip1 = createMockRequest({ ip: '1.1.1.1' })
      const ip2 = createMockRequest({ ip: '2.2.2.2' })

      expect(runMiddleware(middleware, ip1).nextCalled).toBe(true)
      expect(runMiddleware(middleware, ip2).nextCalled).toBe(true)
      expect(runMiddleware(middleware, ip1).nextCalled).toBe(false)
      expect(runMiddleware(middleware, ip2).nextCalled).toBe(false)
    })

    it('uses socket.remoteAddress when req.ip is unset', () => {
      const middleware = createRateLimitMiddleware({
        capacity: 1,
        refillIntervalMs: 60_000,
        now: () => 1_700_000_000_000,
      })
      const req = {
        socket: { remoteAddress: '3.3.3.3' },
      } as Request

      expect(runMiddleware(middleware, req).nextCalled).toBe(true)
      expect(runMiddleware(middleware, req).nextCalled).toBe(false)
    })

    it('keys user-id and ip-address into separate buckets even when ids collide', () => {
      // Regression guard: an attacker setting `req.ip = 'user-X'` must
      // not be able to exhaust user-X's bucket. The default identifier
      // namespaces with `user:` and `ip:` prefixes precisely for this.
      const middleware = createRateLimitMiddleware({
        capacity: 1,
        refillIntervalMs: 60_000,
        now: () => 1_700_000_000_000,
      })

      const reqByUser = createMockRequest({
        user: {
          id: 'X',
          name: 'X',
          email: 'x@x.test',
          role: 'OCC_STAFF',
        } as Request['user'],
        ip: '10.0.0.5',
      })
      const reqByIp = createMockRequest({ ip: 'X' })

      expect(runMiddleware(middleware, reqByUser).nextCalled).toBe(true)
      // Same string `X` but different namespace → independent bucket.
      expect(runMiddleware(middleware, reqByIp).nextCalled).toBe(true)
    })

    it('respects a custom identify function', () => {
      const middleware = createRateLimitMiddleware({
        capacity: 1,
        refillIntervalMs: 60_000,
        now: () => 1_700_000_000_000,
        identify: () => 'singleton',
      })

      const reqA = createMockRequest({ ip: '1.1.1.1' })
      const reqB = createMockRequest({ ip: '2.2.2.2' })

      // Custom identify collapses both requests into the same bucket.
      expect(runMiddleware(middleware, reqA).nextCalled).toBe(true)
      expect(runMiddleware(middleware, reqB).nextCalled).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Skip predicate
  // -------------------------------------------------------------------------

  describe('skip predicate', () => {
    it('bypasses the limiter entirely when skip returns true', () => {
      const middleware = createRateLimitMiddleware({
        capacity: 1,
        refillIntervalMs: 60_000,
        skip: () => true,
        now: () => 1_700_000_000_000,
      })
      const req = createMockRequest({ ip: '10.0.0.1' })

      // Should never reject, even on the 100th call.
      let allPassed = true
      for (let i = 0; i < 100; i += 1) {
        if (!runMiddleware(middleware, req).nextCalled) {
          allPassed = false
          break
        }
      }
      expect(allPassed).toBe(true)
    })

    it('does not set rate-limit headers when skipped', () => {
      const middleware = createRateLimitMiddleware({
        capacity: 1,
        refillIntervalMs: 60_000,
        skip: () => true,
        now: () => 1_700_000_000_000,
      })
      const req = createMockRequest({ ip: '10.0.0.1' })

      const result = runMiddleware(middleware, req)

      expect(result.res.headers['X-RateLimit-Limit']).toBeUndefined()
      expect(result.res.headers['X-RateLimit-Remaining']).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // LRU eviction
  // -------------------------------------------------------------------------

  describe('LRU eviction', () => {
    it('evicts the least-recently-touched bucket when maxIdentities is exceeded', () => {
      const middleware = createRateLimitMiddleware({
        capacity: 1,
        refillIntervalMs: 60_000,
        maxIdentities: 2,
        now: () => 1_700_000_000_000,
      })

      const reqA = createMockRequest({ ip: 'A' })
      const reqB = createMockRequest({ ip: 'B' })
      const reqC = createMockRequest({ ip: 'C' })

      // Drain A (buckets order: [A]).
      expect(runMiddleware(middleware, reqA).nextCalled).toBe(true)
      // Drain B (buckets order: [A, B]).
      expect(runMiddleware(middleware, reqB).nextCalled).toBe(true)
      // C arrives — must evict A (the LRU). buckets: [B, C].
      expect(runMiddleware(middleware, reqC).nextCalled).toBe(true)

      // B's bucket is still drained — the eviction touched A, not B.
      // (Check B FIRST: bringing A back would evict B as the new LRU.)
      expect(runMiddleware(middleware, reqB).nextCalled).toBe(false)
      // A's bucket was evicted, so A gets a fresh capacity-1 bucket.
      expect(runMiddleware(middleware, reqA).nextCalled).toBe(true)
    })

    it('treats a bucket touch as recent activity (LRU re-ordering)', () => {
      const middleware = createRateLimitMiddleware({
        capacity: 5,
        refillIntervalMs: 60_000,
        maxIdentities: 2,
        now: () => 1_700_000_000_000,
      })

      const reqA = createMockRequest({ ip: 'A' })
      const reqB = createMockRequest({ ip: 'B' })
      const reqC = createMockRequest({ ip: 'C' })

      runMiddleware(middleware, reqA)
      runMiddleware(middleware, reqB)
      // Touch A again → A moves to LRU tail; B is now the oldest.
      runMiddleware(middleware, reqA)
      // C arrives — must evict B, NOT A.
      runMiddleware(middleware, reqC)

      // A still has its consumed-twice bucket (3 tokens left).
      const aHeader = runMiddleware(middleware, reqA).res.headers[
        'X-RateLimit-Remaining'
      ]
      expect(Number(aHeader)).toBe(2) // 5 - 3 consumed = 2 remaining
    })
  })

  // -------------------------------------------------------------------------
  // Env-var configuration
  // -------------------------------------------------------------------------

  describe('createRateLimitMiddlewareFromEnv', () => {
    it('uses defaults when no env vars are set', () => {
      const middleware = createRateLimitMiddlewareFromEnv({
        now: () => 1_700_000_000_000,
      })
      const req = createMockRequest({ ip: '10.0.0.1' })

      const result = runMiddleware(middleware, req)
      expect(result.nextCalled).toBe(true)
      // Default capacity is 100.
      expect(result.res.headers['X-RateLimit-Limit']).toBe('100')
    })

    it('reads RATE_LIMIT_CAPACITY from the environment', () => {
      process.env.RATE_LIMIT_CAPACITY = '5'
      const middleware = createRateLimitMiddlewareFromEnv({
        now: () => 1_700_000_000_000,
      })
      const req = createMockRequest({ ip: '10.0.0.1' })

      expect(runMiddleware(middleware, req).res.headers['X-RateLimit-Limit']).toBe(
        '5'
      )
    })

    it('falls back to the default when RATE_LIMIT_CAPACITY is non-numeric', () => {
      process.env.RATE_LIMIT_CAPACITY = 'not-a-number'
      const middleware = createRateLimitMiddlewareFromEnv({
        now: () => 1_700_000_000_000,
      })
      const req = createMockRequest({ ip: '10.0.0.1' })

      expect(runMiddleware(middleware, req).res.headers['X-RateLimit-Limit']).toBe(
        '100'
      )
    })

    it('falls back to the default when RATE_LIMIT_CAPACITY is zero', () => {
      process.env.RATE_LIMIT_CAPACITY = '0'
      const middleware = createRateLimitMiddlewareFromEnv({
        now: () => 1_700_000_000_000,
      })
      const req = createMockRequest({ ip: '10.0.0.1' })

      expect(runMiddleware(middleware, req).res.headers['X-RateLimit-Limit']).toBe(
        '100'
      )
    })

    it('falls back to the default when RATE_LIMIT_CAPACITY is non-integer', () => {
      process.env.RATE_LIMIT_CAPACITY = '3.14'
      const middleware = createRateLimitMiddlewareFromEnv({
        now: () => 1_700_000_000_000,
      })
      const req = createMockRequest({ ip: '10.0.0.1' })

      expect(runMiddleware(middleware, req).res.headers['X-RateLimit-Limit']).toBe(
        '100'
      )
    })

    it('lets explicit overrides take precedence over the environment', () => {
      process.env.RATE_LIMIT_CAPACITY = '5'
      const middleware = createRateLimitMiddlewareFromEnv({
        capacity: 999,
        now: () => 1_700_000_000_000,
      })
      const req = createMockRequest({ ip: '10.0.0.1' })

      expect(runMiddleware(middleware, req).res.headers['X-RateLimit-Limit']).toBe(
        '999'
      )
    })
  })
})
