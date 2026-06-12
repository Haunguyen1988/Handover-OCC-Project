import { AuditAction, ItemStatus, Priority, Shift } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CarryForwardResult } from '../../../backend/src/services/carryForward.service'

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------

type MockItem = {
  id: string
  handoverId: string
  status: ItemStatus
  priority: Priority
  issue?: string
  ownerId?: string | null
  dueTime?: Date | null
  flightsAffected?: string | null
  remarks?: string | null
  resolvedAt?: Date | null
  deletedAt?: Date | null
  createdAt: Date
  updatedAt: Date
  [key: string]: unknown
}

let createdItems: Array<{ delegate: string; data: Record<string, unknown> }> = []
let auditLogs: Array<Record<string, unknown>> = []
let handoverUpdates: Array<{ id: string; data: Record<string, unknown> }> = []

function createMockDelegate(delegateName: string) {
  return {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const id = `new-${delegateName}-${createdItems.length + 1}`
      createdItems.push({ delegate: delegateName, data })
      return { id, ...data }
    }),
  }
}

const prismaMock = vi.hoisted(() => ({
  handover: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  aircraftItem: { create: vi.fn() },
  airportItem: { create: vi.fn() },
  flightScheduleItem: { create: vi.fn() },
  crewItem: { create: vi.fn() },
  weatherItem: { create: vi.fn() },
  systemItem: { create: vi.fn() },
  abnormalEvent: { create: vi.fn() },
  auditLog: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('../../../backend/src/lib/prisma', () => ({
  prisma: prismaMock,
}))

import {
  carryForwardOpenItems,
  getPreviousShift,
  autoCarryForward,
} from '../../../backend/src/services/carryForward.service'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(
  overrides: Partial<MockItem> & { id: string; status: ItemStatus }
): MockItem {
  return {
    handoverId: 'source-handover-id',
    priority: Priority.Normal,
    issue: 'Test issue',
    ownerId: null,
    dueTime: null,
    flightsAffected: null,
    remarks: null,
    resolvedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-04-22T10:00:00Z'),
    updatedAt: new Date('2026-04-22T10:00:00Z'),
    ...overrides,
  }
}

function makeSourceHandover(items: {
  aircraftItems?: MockItem[]
  airportItems?: MockItem[]
  flightScheduleItems?: MockItem[]
  crewItems?: MockItem[]
  weatherItems?: MockItem[]
  systemItems?: MockItem[]
  abnormalEvents?: MockItem[]
}) {
  return {
    id: 'source-handover-id',
    aircraftItems: items.aircraftItems ?? [],
    airportItems: items.airportItems ?? [],
    flightScheduleItems: items.flightScheduleItems ?? [],
    crewItems: items.crewItems ?? [],
    weatherItems: items.weatherItems ?? [],
    systemItems: items.systemItems ?? [],
    abnormalEvents: items.abnormalEvents ?? [],
  }
}

function setupTransactionMock() {
  // Make $transaction execute the callback with delegate-like mocks
  prismaMock.$transaction.mockImplementation(async (fn: Function) => {
    const txClient = {
      aircraftItem: createMockDelegate('aircraftItem'),
      airportItem: createMockDelegate('airportItem'),
      flightScheduleItem: createMockDelegate('flightScheduleItem'),
      crewItem: createMockDelegate('crewItem'),
      weatherItem: createMockDelegate('weatherItem'),
      systemItem: createMockDelegate('systemItem'),
      abnormalEvent: createMockDelegate('abnormalEvent'),
      auditLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          auditLogs.push(data)
          return data
        }),
      },
      handover: {
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            handoverUpdates.push({ id: where.id, data })
            return { id: where.id, ...data }
          }
        ),
      },
    }

    return fn(txClient)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('carryForward.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createdItems = []
    auditLogs = []
    handoverUpdates = []
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // getPreviousShift
  // -------------------------------------------------------------------------

  describe('getPreviousShift', () => {
    it('returns Morning shift of same day when current is Night', () => {
      const date = new Date('2026-04-23T00:00:00Z')
      const result = getPreviousShift(date, Shift.Night)

      expect(result.shift).toBe(Shift.Morning)
      expect(result.date).toBe(date)
    })

    it('handles cross-day carry (Morning → previous day Night)', () => {
      const date = new Date('2026-04-23T00:00:00Z')
      const result = getPreviousShift(date, Shift.Morning)

      expect(result.shift).toBe(Shift.Night)
      expect(result.date.getUTCDate()).toBe(22)
      expect(result.date.getUTCMonth()).toBe(3) // April = 3
    })
  })

  // -------------------------------------------------------------------------
  // carryForwardOpenItems
  // -------------------------------------------------------------------------

  describe('carryForwardOpenItems', () => {
    it('carries all Open items from previous shift', async () => {
      const openItem1 = makeItem({
        id: 'aircraft-open-1',
        status: ItemStatus.Open,
        registration: 'VN-A123',
        issue: 'Hydraulic leak',
      })
      const openItem2 = makeItem({
        id: 'airport-open-1',
        status: ItemStatus.Open,
        airport: 'SGN',
        issue: 'Runway closure',
      })

      prismaMock.handover.findFirst
        .mockResolvedValueOnce(
          makeSourceHandover({
            aircraftItems: [openItem1],
            airportItems: [openItem2],
          })
        )
        .mockResolvedValueOnce({ id: 'target-handover-id' }) // target exists check

      setupTransactionMock()

      const result = await carryForwardOpenItems(
        'source-handover-id',
        'target-handover-id',
        'acting-user-id'
      )

      expect(result.carriedItemCount).toBe(2)
      expect(result.targetHandoverId).toBe('target-handover-id')
      expect(createdItems).toHaveLength(2)

      // Verify the items were created with correct handoverId
      for (const created of createdItems) {
        expect(created.data.handoverId).toBe('target-handover-id')
      }
    })

    it('carries all Monitoring items from previous shift', async () => {
      const monitoringItem = makeItem({
        id: 'weather-monitoring-1',
        status: ItemStatus.Monitoring,
        affectedArea: 'SGN',
        weatherType: 'Typhoon',
        issue: 'Tropical storm approaching',
      })

      prismaMock.handover.findFirst
        .mockResolvedValueOnce(
          makeSourceHandover({ weatherItems: [monitoringItem] })
        )
        .mockResolvedValueOnce({ id: 'target-handover-id' })

      setupTransactionMock()

      const result = await carryForwardOpenItems(
        'source-handover-id',
        'target-handover-id',
        'acting-user-id'
      )

      expect(result.carriedItemCount).toBe(1)
      expect(createdItems[0].delegate).toBe('weatherItem')
    })

    it('does NOT carry Resolved items', async () => {
      const resolvedItem = makeItem({
        id: 'system-resolved-1',
        status: ItemStatus.Resolved,
        systemName: 'AIMS',
        issue: 'System down',
        resolvedAt: new Date('2026-04-22T14:00:00Z'),
      })
      const openItem = makeItem({
        id: 'crew-open-1',
        status: ItemStatus.Open,
        crewName: 'Nguyen Van A',
        issue: 'Crew shortage',
      })

      prismaMock.handover.findFirst
        .mockResolvedValueOnce(
          makeSourceHandover({
            systemItems: [resolvedItem],
            crewItems: [openItem],
          })
        )
        .mockResolvedValueOnce({ id: 'target-handover-id' })

      setupTransactionMock()

      const result = await carryForwardOpenItems(
        'source-handover-id',
        'target-handover-id',
        'acting-user-id'
      )

      // Only the open item should be carried, not the resolved one
      expect(result.carriedItemCount).toBe(1)
      expect(createdItems).toHaveLength(1)
      expect(createdItems[0].delegate).toBe('crewItem')
    })

    it('creates copies — does not modify originals', async () => {
      const original = makeItem({
        id: 'original-aircraft-1',
        status: ItemStatus.Open,
        registration: 'VN-B456',
        issue: 'Engine issue',
        ownerId: 'owner-1',
        dueTime: new Date('2026-04-23T18:00:00Z'),
        flightsAffected: 'VJ123, VJ456',
        remarks: 'Monitor closely',
      })

      prismaMock.handover.findFirst
        .mockResolvedValueOnce(
          makeSourceHandover({ aircraftItems: [original] })
        )
        .mockResolvedValueOnce({ id: 'target-handover-id' })

      setupTransactionMock()

      await carryForwardOpenItems(
        'source-handover-id',
        'target-handover-id',
        'acting-user-id'
      )

      expect(createdItems).toHaveLength(1)
      const copy = createdItems[0].data

      // Verify the copy has the target handoverId
      expect(copy.handoverId).toBe('target-handover-id')

      // Verify inherited fields
      expect(copy.issue).toBe('Engine issue')
      expect(copy.status).toBe(ItemStatus.Open)
      expect(copy.priority).toBe(Priority.Normal)
      expect(copy.ownerId).toBe('owner-1')
      expect(copy.flightsAffected).toBe('VJ123, VJ456')
      expect(copy.remarks).toBe('Monitor closely')
      expect(copy.registration).toBe('VN-B456')

      // Verify excluded fields are NOT present
      expect(copy.id).toBeUndefined()
      expect(copy.resolvedAt).toBeUndefined()
      expect(copy.createdAt).toBeUndefined()
      expect(copy.updatedAt).toBeUndefined()
      expect(copy.deletedAt).toBeUndefined()
    })

    it('writes audit log entry for each carried item', async () => {
      const item1 = makeItem({
        id: 'ac-1',
        status: ItemStatus.Open,
        registration: 'VN-X',
        issue: 'Issue 1',
      })
      const item2 = makeItem({
        id: 'ae-1',
        status: ItemStatus.Monitoring,
        eventType: 'Bird strike',
        description: 'Bird strike at SGN',
      })

      prismaMock.handover.findFirst
        .mockResolvedValueOnce(
          makeSourceHandover({
            aircraftItems: [item1],
            abnormalEvents: [item2],
          })
        )
        .mockResolvedValueOnce({ id: 'target-handover-id' })

      setupTransactionMock()

      await carryForwardOpenItems(
        'source-handover-id',
        'target-handover-id',
        'acting-user-id'
      )

      expect(auditLogs).toHaveLength(2)

      for (const log of auditLogs) {
        expect(log.handoverId).toBe('target-handover-id')
        expect(log.userId).toBe('acting-user-id')
        expect(log.action).toBe(AuditAction.CARRIED_FORWARD)
        expect((log.oldValue as Record<string, unknown>).sourceHandoverId).toBe(
          'source-handover-id'
        )
      }
    })

    it('updates target handover isCarriedForward and carriedFromId', async () => {
      const item = makeItem({
        id: 'fs-1',
        status: ItemStatus.Open,
        flightNumber: 'VJ100',
        issue: 'Delay',
      })

      prismaMock.handover.findFirst
        .mockResolvedValueOnce(
          makeSourceHandover({ flightScheduleItems: [item] })
        )
        .mockResolvedValueOnce({ id: 'target-handover-id' })

      setupTransactionMock()

      await carryForwardOpenItems(
        'source-handover-id',
        'target-handover-id',
        'acting-user-id'
      )

      expect(handoverUpdates).toHaveLength(1)
      expect(handoverUpdates[0].id).toBe('target-handover-id')
      expect(handoverUpdates[0].data).toEqual({
        isCarriedForward: true,
        carriedFromId: 'source-handover-id',
      })
    })

    it('handles empty source handover (no items to carry)', async () => {
      prismaMock.handover.findFirst
        .mockResolvedValueOnce(makeSourceHandover({}))
        .mockResolvedValueOnce({ id: 'target-handover-id' })

      const result = await carryForwardOpenItems(
        'source-handover-id',
        'target-handover-id',
        'acting-user-id'
      )

      expect(result.carriedItemCount).toBe(0)
      expect(result.targetHandoverId).toBe('target-handover-id')

      // No transaction should have been initiated
      expect(prismaMock.$transaction).not.toHaveBeenCalled()
    })

    it('throws NOT_FOUND when source handover does not exist', async () => {
      prismaMock.handover.findFirst.mockResolvedValueOnce(null)

      await expect(
        carryForwardOpenItems(
          'nonexistent-source',
          'target-handover-id',
          'acting-user-id'
        )
      ).rejects.toThrow('Source handover not found')
    })

    it('throws NOT_FOUND when target handover does not exist', async () => {
      prismaMock.handover.findFirst
        .mockResolvedValueOnce(makeSourceHandover({}))
        .mockResolvedValueOnce(null)

      await expect(
        carryForwardOpenItems(
          'source-handover-id',
          'nonexistent-target',
          'acting-user-id'
        )
      ).rejects.toThrow('Target handover not found')
    })

    it('carries items across all seven categories', async () => {
      const source = makeSourceHandover({
        aircraftItems: [
          makeItem({ id: 'a1', status: ItemStatus.Open, registration: 'VN-1', issue: 'i1' }),
        ],
        airportItems: [
          makeItem({ id: 'ap1', status: ItemStatus.Open, airport: 'SGN', issue: 'i2' }),
        ],
        flightScheduleItems: [
          makeItem({ id: 'fs1', status: ItemStatus.Open, flightNumber: 'VJ1', issue: 'i3' }),
        ],
        crewItems: [
          makeItem({ id: 'c1', status: ItemStatus.Open, crewName: 'A', issue: 'i4' }),
        ],
        weatherItems: [
          makeItem({ id: 'w1', status: ItemStatus.Open, affectedArea: 'SGN', weatherType: 'Rain', issue: 'i5' }),
        ],
        systemItems: [
          makeItem({ id: 's1', status: ItemStatus.Open, systemName: 'AIMS', issue: 'i6' }),
        ],
        abnormalEvents: [
          makeItem({ id: 'ae1', status: ItemStatus.Monitoring, eventType: 'Fire', description: 'd7' }),
        ],
      })

      prismaMock.handover.findFirst
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce({ id: 'target-handover-id' })

      setupTransactionMock()

      const result = await carryForwardOpenItems(
        'source-handover-id',
        'target-handover-id',
        'acting-user-id'
      )

      expect(result.carriedItemCount).toBe(7)
      expect(createdItems).toHaveLength(7)

      // Verify all delegates were called
      const delegates = createdItems.map((c) => c.delegate)
      expect(delegates).toContain('aircraftItem')
      expect(delegates).toContain('airportItem')
      expect(delegates).toContain('flightScheduleItem')
      expect(delegates).toContain('crewItem')
      expect(delegates).toContain('weatherItem')
      expect(delegates).toContain('systemItem')
      expect(delegates).toContain('abnormalEvent')
    })
  })

  // -------------------------------------------------------------------------
  // autoCarryForward
  // -------------------------------------------------------------------------

  describe('autoCarryForward', () => {
    it('returns null when no previous shift handover exists', async () => {
      prismaMock.handover.findFirst.mockResolvedValueOnce(null)

      const result = await autoCarryForward(
        'new-handover-id',
        new Date('2026-04-23T00:00:00Z'),
        Shift.Night,
        'user-1'
      )

      expect(result).toBeNull()
    })
  })
})
