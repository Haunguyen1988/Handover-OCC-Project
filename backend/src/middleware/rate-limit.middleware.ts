import { type NextFunction, type Request, type Response } from 'express'

/**
 * In-memory token-bucket rate limiter.
 *
 * Closes gap #3 from `docs/AUTH_MIGRATION.md`.
 *
 * Algorithm: each identity has a bucket of `capacity` tokens. The bucket
 * refills at a constant rate of `capacity / refillIntervalMs` tokens per
 * millisecond, capped at `capacity`. Each request consumes one token. If
 * the bucket is empty, the request is rejected with HTTP 429.
 *
 * Identity strategy:
 *   1. If `req.user` is set (i.e. the auth middleware accepted the
 *      caller), use `user.id`.
 *   2. Otherwise fall back to the request's remote address.
 *
 * Memory bound: the bucket map is capped at `maxIdentities`. When the
 * cap is reached, the least-recently-touched bucket is evicted. This
 * keeps memory bounded for long-running processes that see many unique
 * IPs (e.g. behind a public load balancer).
 *
 * Limitations:
 *   - In-process only. Multi-process deployments need a shared store
 *     (e.g. Redis); see `docs/AUTH_MIGRATION.md` for the migration path.
 *   - Buckets are lost on restart, which means the limit effectively
 *     resets on every deploy. Acceptable for the Phase-4 pilot.
 */

export type RateLimitBucket = {
  tokens: number
  lastRefillMs: number
}

export type RateLimitOptions = {
  /** Maximum number of tokens (= maximum burst size). */
  capacity: number
  /** Time in milliseconds for the bucket to refill from 0 to capacity. */
  refillIntervalMs: number
  /** Skip rate limiting for paths matching this predicate (e.g. `/health`). */
  skip?: (req: Request) => boolean
  /**
   * Identity extractor. Defaults to `req.user?.id` falling back to the
   * remote address. Override in tests or to key off API keys instead.
   */
  identify?: (req: Request) => string
  /**
   * Maximum number of identities tracked simultaneously. When exceeded,
   * the least-recently-touched bucket is evicted.
   */
  maxIdentities?: number
  /**
   * Clock injection for tests. Defaults to `Date.now`.
   */
  now?: () => number
}

const DEFAULT_MAX_IDENTITIES = 10_000

/**
 * Read positive integer config from the environment, falling back to a
 * default if missing or invalid. Used at server startup.
 */
function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (typeof raw !== 'string' || raw.length === 0) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    return fallback
  }
  return parsed
}

/**
 * Build a rate-limit middleware with options resolved from environment
 * variables. This is the recommended entry point for `server.ts`.
 *
 * Environment variables:
 *   RATE_LIMIT_CAPACITY            (default: 100)   — burst size + per-window cap
 *   RATE_LIMIT_REFILL_INTERVAL_MS  (default: 60000) — full refill window
 *   RATE_LIMIT_MAX_IDENTITIES      (default: 10000) — LRU map cap
 */
export function createRateLimitMiddlewareFromEnv(
  overrides: Partial<RateLimitOptions> = {}
) {
  return createRateLimitMiddleware({
    capacity: readPositiveIntEnv('RATE_LIMIT_CAPACITY', 100),
    refillIntervalMs: readPositiveIntEnv(
      'RATE_LIMIT_REFILL_INTERVAL_MS',
      60_000
    ),
    maxIdentities: readPositiveIntEnv(
      'RATE_LIMIT_MAX_IDENTITIES',
      DEFAULT_MAX_IDENTITIES
    ),
    ...overrides,
  })
}

export function createRateLimitMiddleware(options: RateLimitOptions) {
  if (options.capacity <= 0) {
    throw new Error('rate-limit: capacity must be > 0')
  }
  if (options.refillIntervalMs <= 0) {
    throw new Error('rate-limit: refillIntervalMs must be > 0')
  }

  const capacity = options.capacity
  const refillIntervalMs = options.refillIntervalMs
  const refillRatePerMs = capacity / refillIntervalMs
  const maxIdentities = options.maxIdentities ?? DEFAULT_MAX_IDENTITIES
  const now = options.now ?? Date.now
  const skip = options.skip ?? (() => false)
  const identify = options.identify ?? defaultIdentify

  // Map iteration order is insertion order. We touch a bucket by
  // delete-then-set, which moves it to the tail and gives us LRU
  // semantics for free.
  const buckets = new Map<string, RateLimitBucket>()

  function touchBucket(key: string, currentTimeMs: number): RateLimitBucket {
    const existing = buckets.get(key)
    if (existing) {
      // Refill based on elapsed time since the last touch.
      const elapsedMs = currentTimeMs - existing.lastRefillMs
      if (elapsedMs > 0) {
        existing.tokens = Math.min(
          capacity,
          existing.tokens + elapsedMs * refillRatePerMs
        )
        existing.lastRefillMs = currentTimeMs
      }
      // Move to LRU tail by re-inserting.
      buckets.delete(key)
      buckets.set(key, existing)
      return existing
    }

    // Evict oldest if at capacity.
    if (buckets.size >= maxIdentities) {
      const oldestKey = buckets.keys().next().value
      if (oldestKey !== undefined) {
        buckets.delete(oldestKey)
      }
    }

    const fresh: RateLimitBucket = {
      tokens: capacity,
      lastRefillMs: currentTimeMs,
    }
    buckets.set(key, fresh)
    return fresh
  }

  return function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    if (skip(req)) {
      return next()
    }

    const currentTimeMs = now()
    const key = identify(req)
    const bucket = touchBucket(key, currentTimeMs)

    // Always advertise the configured limit so clients can self-throttle.
    res.setHeader('X-RateLimit-Limit', String(capacity))

    if (bucket.tokens < 1) {
      // How long until at least one token is available?
      const tokensNeeded = 1 - bucket.tokens
      const msUntilOneToken = Math.ceil(tokensNeeded / refillRatePerMs)
      const retryAfterSeconds = Math.max(1, Math.ceil(msUntilOneToken / 1000))

      res.setHeader('Retry-After', String(retryAfterSeconds))
      res.setHeader('X-RateLimit-Remaining', '0')

      return res.status(429).json({
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please retry later.',
        details: {
          retryAfterSeconds,
        },
      })
    }

    bucket.tokens -= 1
    res.setHeader('X-RateLimit-Remaining', String(Math.floor(bucket.tokens)))

    next()
  }
}

function defaultIdentify(req: Request): string {
  const userId = req.user?.id
  if (userId) {
    return `user:${userId}`
  }
  // Express's req.ip respects `app.set('trust proxy', ...)`. The
  // socket fallback handles tests and direct connections.
  const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
  return `ip:${ip}`
}
