import {
  runAckAlertSweep,
  type RunAckAlertSweepOptions,
} from './ackAlertNotifier.service'

/**
 * In-process scheduler that drives the Tier 3 ack-alert sweep on a fixed
 * interval. Deliberately simple: a single `setInterval` in the API process,
 * matching the in-process rate limiter already used here. Multi-process
 * deployments would need a shared lock so two workers don't both push — out
 * of scope for the pilot (see the rate-limit middleware's note for the same
 * limitation and migration path).
 */

const DEFAULT_INTERVAL_MS = 60_000

export interface AckAlertSchedulerConfig {
  webhookUrl: string
  intervalMs: number
}

export interface StartAckAlertSchedulerOptions {
  /** Override the sweep runner in tests. Defaults to the real sweep. */
  runSweep?: (options: RunAckAlertSweepOptions) => Promise<unknown>
  /** Hook for logging/observability in tests. Defaults to console.error. */
  onError?: (error: unknown) => void
}

/**
 * Resolve scheduler config from the environment. Returns `null` when the
 * feature is not configured, so the caller can no-op cleanly instead of
 * starting a timer that can never push anything.
 *
 *   ACK_ALERT_WEBHOOK_URL          (required to enable) — generic POST target
 *   ACK_ALERT_SWEEP_INTERVAL_MS    (default: 60000)      — tick period
 */
export function readAckAlertSchedulerConfig(): AckAlertSchedulerConfig | null {
  const webhookUrl = process.env.ACK_ALERT_WEBHOOK_URL
  if (typeof webhookUrl !== 'string' || webhookUrl.trim().length === 0) {
    return null
  }

  const rawInterval = process.env.ACK_ALERT_SWEEP_INTERVAL_MS
  const parsed = Number(rawInterval)
  const intervalMs =
    Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS

  return { webhookUrl: webhookUrl.trim(), intervalMs }
}

/**
 * Start the periodic sweep. Returns a stop function, or `null` when the
 * feature is disabled (no webhook configured). The interval is `unref`'d so
 * a pending tick never keeps the process alive on shutdown.
 */
export function startAckAlertScheduler(
  options: StartAckAlertSchedulerOptions = {}
): (() => void) | null {
  const config = readAckAlertSchedulerConfig()
  if (!config) {
    return null
  }

  const runSweep = options.runSweep ?? runAckAlertSweep
  const onError = options.onError ?? ((error) => console.error('[ack-alert]', error))

  let running = false

  async function tick() {
    // Skip overlapping ticks: a slow webhook or DB read must not let a second
    // sweep start and double-push the same breaches.
    if (running) {
      return
    }

    running = true
    try {
      await runSweep({ webhookUrl: config!.webhookUrl })
    } catch (error) {
      onError(error)
    } finally {
      running = false
    }
  }

  const timer = setInterval(tick, config.intervalMs)
  if (typeof timer.unref === 'function') {
    timer.unref()
  }

  return () => clearInterval(timer)
}
