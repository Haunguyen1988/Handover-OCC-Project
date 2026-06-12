import { Priority } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Integration-style wiring test for the Tier 3 ack-alert push.
 *
 * The other two suites each stub a seam:
 *   - ackAlertNotifier.service.test.ts injects a fake `post`.
 *   - ackAlertScheduler.test.ts injects a fake `runSweep`.
 *
 * This suite injects NEITHER `post` nor `runSweep`. It drives the real
 * `runAckAlertSweep` → `defaultPost` → `fetch` chain and stubs only the two
 * genuine boundaries: the network (`globalThis.fetch`) and the database
 * (`prisma`). That `defaultPost` ↔ real `fetch` seam is exactly what the two
 * single-seam unit suites stub away and never exercise, so a break in how the
 * sweep builds its HTTP request would slip past them — this test catches it.
 */

const prismaMock = vi.hoisted(() => ({
  handover: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('../../../backend/src/lib/prisma', () => ({
  prisma: prismaMock,
}))

import { runAckAlertSweep } from '../../../backend/src/services/ackAlertNotifier.service'

const NOW = new Date('2026-06-12T12:00:00.000Z')

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000)
}

describe('ack-alert Tier 3 (sweep → defaultPost → fetch, integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('issues a real fetch carrying the breach payload, then marks the handover', async () => {
    prismaMock.handover.findMany.mockResolvedValueOnce([
      {
        id: 'h-critical',
        referenceId: 'HDO-2026-000042',
        overallPriority: Priority.Critical,
        createdAt: minutesAgo(30),
      },
    ])

    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const result = await runAckAlertSweep({
      webhookUrl: 'https://hook.example/occ',
      now: NOW,
    })

    expect(result).toEqual({ breachCount: 1, pushed: true })

    // The real defaultPost issued exactly one fetch with the webhook URL and a
    // JSON body carrying the breach.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://hook.example/occ')
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.breaches).toEqual([
      {
        referenceId: 'HDO-2026-000042',
        priority: Priority.Critical,
        ageMinutes: 30,
      },
    ])
    expect(body.text).toContain('HDO-2026-000042')

    // The breach was marked alerted only after the successful push.
    expect(prismaMock.handover.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['h-critical'] } },
      data: { breachAlertedAt: NOW },
    })
  })

  it('propagates a non-OK fetch and leaves the handover unmarked for retry', async () => {
    prismaMock.handover.findMany.mockResolvedValueOnce([
      {
        id: 'h-critical',
        referenceId: 'HDO-2026-000043',
        overallPriority: Priority.Critical,
        createdAt: minutesAgo(30),
      },
    ])

    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 502 } as Response)
    vi.stubGlobal('fetch', fetchMock)

    // defaultPost throws on a non-OK response; the sweep must not swallow it,
    // and must not mark the handover, so the next sweep retries the same breach.
    await expect(
      runAckAlertSweep({ webhookUrl: 'https://hook.example/occ', now: NOW })
    ).rejects.toThrow('HTTP 502')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(prismaMock.handover.updateMany).not.toHaveBeenCalled()
  })
})
