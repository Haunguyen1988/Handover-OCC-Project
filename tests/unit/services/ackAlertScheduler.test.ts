import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  readAckAlertSchedulerConfig,
  startAckAlertScheduler,
} from '../../../backend/src/services/ackAlertScheduler'

const ORIGINAL_ENV = { ...process.env }

function clearAckAlertEnv() {
  delete process.env.ACK_ALERT_WEBHOOK_URL
  delete process.env.ACK_ALERT_SWEEP_INTERVAL_MS
}

describe('ackAlertScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearAckAlertEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = { ...ORIGINAL_ENV }
  })

  describe('readAckAlertSchedulerConfig', () => {
    it('returns null when no webhook URL is configured', () => {
      expect(readAckAlertSchedulerConfig()).toBeNull()
    })

    it('returns null when the webhook URL is blank', () => {
      process.env.ACK_ALERT_WEBHOOK_URL = '   '
      expect(readAckAlertSchedulerConfig()).toBeNull()
    })

    it('defaults the interval when unset or invalid', () => {
      process.env.ACK_ALERT_WEBHOOK_URL = 'https://hook.example/x'
      expect(readAckAlertSchedulerConfig()).toEqual({
        webhookUrl: 'https://hook.example/x',
        intervalMs: 60_000,
      })

      process.env.ACK_ALERT_SWEEP_INTERVAL_MS = 'not-a-number'
      expect(readAckAlertSchedulerConfig()?.intervalMs).toBe(60_000)

      process.env.ACK_ALERT_SWEEP_INTERVAL_MS = '0'
      expect(readAckAlertSchedulerConfig()?.intervalMs).toBe(60_000)
    })

    it('honours a positive integer interval and trims the URL', () => {
      process.env.ACK_ALERT_WEBHOOK_URL = '  https://hook.example/x  '
      process.env.ACK_ALERT_SWEEP_INTERVAL_MS = '30000'

      expect(readAckAlertSchedulerConfig()).toEqual({
        webhookUrl: 'https://hook.example/x',
        intervalMs: 30_000,
      })
    })
  })

  describe('startAckAlertScheduler', () => {
    it('returns null and starts no timer when disabled', () => {
      const runSweep = vi.fn()

      const stop = startAckAlertScheduler({ runSweep })

      expect(stop).toBeNull()
      vi.advanceTimersByTime(120_000)
      expect(runSweep).not.toHaveBeenCalled()
    })

    it('runs the sweep on each tick with the configured webhook URL', async () => {
      process.env.ACK_ALERT_WEBHOOK_URL = 'https://hook.example/x'
      process.env.ACK_ALERT_SWEEP_INTERVAL_MS = '1000'
      const runSweep = vi.fn().mockResolvedValue(undefined)

      const stop = startAckAlertScheduler({ runSweep })
      expect(stop).not.toBeNull()

      await vi.advanceTimersByTimeAsync(1000)
      expect(runSweep).toHaveBeenCalledTimes(1)
      expect(runSweep).toHaveBeenCalledWith({
        webhookUrl: 'https://hook.example/x',
      })

      await vi.advanceTimersByTimeAsync(1000)
      expect(runSweep).toHaveBeenCalledTimes(2)

      stop?.()
      await vi.advanceTimersByTimeAsync(2000)
      expect(runSweep).toHaveBeenCalledTimes(2)
    })

    it('skips an overlapping tick while a slow sweep is still running', async () => {
      process.env.ACK_ALERT_WEBHOOK_URL = 'https://hook.example/x'
      process.env.ACK_ALERT_SWEEP_INTERVAL_MS = '1000'

      let resolveSweep: (() => void) | undefined
      const runSweep = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveSweep = resolve
          })
      )

      const stop = startAckAlertScheduler({ runSweep })

      await vi.advanceTimersByTimeAsync(1000)
      expect(runSweep).toHaveBeenCalledTimes(1)

      // Second tick fires while the first sweep is still pending → skipped.
      await vi.advanceTimersByTimeAsync(1000)
      expect(runSweep).toHaveBeenCalledTimes(1)

      // Let the first sweep finish, then the next tick runs again.
      resolveSweep?.()
      await vi.advanceTimersByTimeAsync(1000)
      expect(runSweep).toHaveBeenCalledTimes(2)

      stop?.()
    })

    it('routes a sweep error to onError without stopping the timer', async () => {
      process.env.ACK_ALERT_WEBHOOK_URL = 'https://hook.example/x'
      process.env.ACK_ALERT_SWEEP_INTERVAL_MS = '1000'
      const runSweep = vi
        .fn()
        .mockRejectedValueOnce(new Error('sweep boom'))
        .mockResolvedValue(undefined)
      const onError = vi.fn()

      const stop = startAckAlertScheduler({ runSweep, onError })

      await vi.advanceTimersByTimeAsync(1000)
      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError).toHaveBeenCalledWith(expect.any(Error))

      // Timer survives the error and ticks again.
      await vi.advanceTimersByTimeAsync(1000)
      expect(runSweep).toHaveBeenCalledTimes(2)

      stop?.()
    })
  })
})
