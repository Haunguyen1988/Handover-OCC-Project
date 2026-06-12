import { Priority } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  handover: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('../../../backend/src/lib/prisma', () => ({
  prisma: prismaMock,
}))

import {
  buildWebhookPayload,
  findBreachingHandovers,
  runAckAlertSweep,
  type BreachingHandover,
} from '../../../backend/src/services/ackAlertNotifier.service'

const NOW = new Date('2026-06-12T12:00:00.000Z')

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000)
}

describe('ackAlertNotifier.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('findBreachingHandovers', () => {
    it('queries only unacknowledged, un-alerted High/Critical handovers', async () => {
      prismaMock.handover.findMany.mockResolvedValueOnce([])

      await findBreachingHandovers(NOW)

      expect(prismaMock.handover.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          acknowledgedAt: null,
          breachAlertedAt: null,
          overallPriority: { in: [Priority.High, Priority.Critical] },
        },
        select: {
          id: true,
          referenceId: true,
          overallPriority: true,
          createdAt: true,
        },
      })
    })

    it('keeps a Critical past the breach threshold and drops one still in warn', async () => {
      prismaMock.handover.findMany.mockResolvedValueOnce([
        {
          id: 'c-breach',
          referenceId: 'HDO-1',
          overallPriority: Priority.Critical,
          createdAt: minutesAgo(20),
        },
        {
          id: 'c-warn',
          referenceId: 'HDO-2',
          overallPriority: Priority.Critical,
          createdAt: minutesAgo(5),
        },
      ])

      const result = await findBreachingHandovers(NOW)

      expect(result.map((b) => b.id)).toEqual(['c-breach'])
      expect(result[0]).toMatchObject({
        referenceId: 'HDO-1',
        overallPriority: Priority.Critical,
        ageMinutes: 20,
      })
    })

    it('drops High handovers because High never breaches, only warns', async () => {
      prismaMock.handover.findMany.mockResolvedValueOnce([
        {
          id: 'h-old',
          referenceId: 'HDO-3',
          overallPriority: Priority.High,
          createdAt: minutesAgo(600),
        },
      ])

      const result = await findBreachingHandovers(NOW)

      expect(result).toEqual([])
    })
  })

  describe('buildWebhookPayload', () => {
    it('produces a human line and a structured breach list', () => {
      const breaches: BreachingHandover[] = [
        {
          id: 'c1',
          referenceId: 'HDO-9',
          overallPriority: Priority.Critical,
          ageMinutes: 42,
        },
      ]

      const payload = buildWebhookPayload(breaches)

      expect(payload.text).toContain('HDO-9')
      expect(payload.text).toContain('1 handover')
      expect(payload.breaches).toEqual([
        { referenceId: 'HDO-9', priority: Priority.Critical, ageMinutes: 42 },
      ])
    })
  })

  describe('runAckAlertSweep', () => {
    it('no-ops without posting or marking when there are no breaches', async () => {
      prismaMock.handover.findMany.mockResolvedValueOnce([])
      const post = vi.fn()

      const result = await runAckAlertSweep({
        webhookUrl: 'https://hook.example/x',
        now: NOW,
        post,
      })

      expect(result).toEqual({ breachCount: 0, pushed: false })
      expect(post).not.toHaveBeenCalled()
      expect(prismaMock.handover.updateMany).not.toHaveBeenCalled()
    })

    it('posts once then marks the breached handovers as alerted', async () => {
      prismaMock.handover.findMany.mockResolvedValueOnce([
        {
          id: 'c-breach',
          referenceId: 'HDO-1',
          overallPriority: Priority.Critical,
          createdAt: minutesAgo(30),
        },
      ])
      const post = vi.fn().mockResolvedValueOnce(undefined)

      const result = await runAckAlertSweep({
        webhookUrl: 'https://hook.example/x',
        now: NOW,
        post,
      })

      expect(result).toEqual({ breachCount: 1, pushed: true })
      expect(post).toHaveBeenCalledTimes(1)
      expect(post).toHaveBeenCalledWith(
        'https://hook.example/x',
        expect.objectContaining({
          breaches: [
            { referenceId: 'HDO-1', priority: Priority.Critical, ageMinutes: 30 },
          ],
        })
      )
      expect(prismaMock.handover.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['c-breach'] } },
        data: { breachAlertedAt: NOW },
      })
    })

    it('does NOT mark handovers when the webhook post fails, so the next tick retries', async () => {
      prismaMock.handover.findMany.mockResolvedValueOnce([
        {
          id: 'c-breach',
          referenceId: 'HDO-1',
          overallPriority: Priority.Critical,
          createdAt: minutesAgo(30),
        },
      ])
      const post = vi.fn().mockRejectedValueOnce(new Error('502 from hook'))

      await expect(
        runAckAlertSweep({
          webhookUrl: 'https://hook.example/x',
          now: NOW,
          post,
        })
      ).rejects.toThrow('502 from hook')

      expect(prismaMock.handover.updateMany).not.toHaveBeenCalled()
    })
  })
})
