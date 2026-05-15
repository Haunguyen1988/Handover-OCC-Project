import { AuditAction, ItemStatus, UserRole } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// Prisma mock
//
// item.service is the most rule-heavy of the three under test. It runs
// real Zod schemas (BR-06 owner-required, due-time syntax) and the real
// status transition matrix (BR-05) against mocked Prisma rows. We mock
// prisma in-memory and pass the same shape back from $transaction so the
// service's `tx.<delegate>.create/update` calls can be observed.
// ---------------------------------------------------------------------------

let auditLogs: Array<Record<string, unknown>> = []
let createdItems: Array<{ delegate: string; data: Record<string, unknown> }> = []
let updatedItems: Array<{
  delegate: string
  where: Record<string, unknown>
  data: Record<string, unknown>
}> = []

const prismaMock = vi.hoisted(() => ({
  handover: { findFirst: vi.fn() },
  aircraftItem: { findFirst: vi.fn() },
  airportItem: { findFirst: vi.fn() },
  flightScheduleItem: { findFirst: vi.fn() },
  crewItem: { findFirst: vi.fn() },
  weatherItem: { findFirst: vi.fn() },
  systemItem: { findFirst: vi.fn() },
  abnormalEvent: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}))

vi.mock('../../../backend/src/lib/prisma', () => ({
  prisma: prismaMock,
}))

import {
  createItem,
  deleteItem,
  parseCreateItemPayload,
  parseUpdateItemPayload,
  updateItem,
} from '../../../backend/src/services/item.service'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STAFF_USER = {
  id: 'user-staff',
  name: 'Staff One',
  email: 'staff@example.test',
  role: UserRole.OCC_STAFF,
} as const

const SUPERVISOR_USER = {
  id: 'user-supervisor',
  name: 'Super',
  email: 'super@example.test',
  role: UserRole.SUPERVISOR,
} as const

/**
 * Pick a handover date 1 day from now and a dueTime ~36 hours from now.
 *
 * The schemas in shared.schema.ts validate the dueTime window using the
 * REAL clock (`new Date()`), so we cannot freeze time without breaking
 * the surrounding ISO arithmetic. Instead, picking offsets that are
 * well clear of the boundaries (≥ 24h future, ≤ 60h past handoverDate
 * midnight UTC) keeps these tests stable on any host.
 */
function makeFutureDates() {
  const now = Date.now()
  const handoverDateObject = new Date(now + 24 * 60 * 60 * 1000)
  const handoverDateOnly = new Date(
    Date.UTC(
      handoverDateObject.getUTCFullYear(),
      handoverDateObject.getUTCMonth(),
      handoverDateObject.getUTCDate()
    )
  )
  // Aim for handoverDate midnight UTC + 36h, capped to "well within 72h".
  const dueTimeIso = new Date(handoverDateOnly.getTime() + 36 * 60 * 60 * 1000).toISOString()
  return { handoverDate: handoverDateOnly, dueTimeIso }
}

function buildAircraftItemInput(overrides: Record<string, unknown> = {}) {
  return {
    registration: 'VN-A123',
    type: 'A320',
    issue: 'Hydraulic leak under investigation.',
    status: ItemStatus.Open,
    priority: 'Normal',
    ...overrides,
  }
}

function buildAircraftItemRow(overrides: Record<string, unknown> = {}) {
  const baseDate = new Date('2099-04-22T08:00:00Z')
  return {
    id: 'item-1',
    handoverId: 'h-1',
    registration: 'VN-A123',
    type: 'A320',
    issue: 'Hydraulic leak under investigation.',
    status: ItemStatus.Open,
    priority: 'Normal',
    flightsAffected: null,
    ownerId: null,
    dueTime: null,
    remarks: null,
    resolvedAt: null,
    deletedAt: null,
    createdAt: baseDate,
    updatedAt: baseDate,
    ...overrides,
  }
}

function setupAccessibleHandover(handoverDate: Date, preparedById = STAFF_USER.id) {
  prismaMock.handover.findFirst.mockResolvedValue({
    id: 'h-1',
    preparedById,
    handoverDate,
  })
}

function setupTransactionMock() {
  prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg !== 'function') {
      throw new Error('Expected a callback-style $transaction call')
    }
    const makeDelegate = (delegateName: string) => ({
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = {
          id: `new-${delegateName}-${createdItems.length + 1}`,
          createdAt: new Date('2099-04-22T08:00:00Z'),
          updatedAt: new Date('2099-04-22T08:00:00Z'),
          flightsAffected: null,
          ownerId: null,
          dueTime: null,
          remarks: null,
          resolvedAt: null,
          deletedAt: null,
          type: null,
          ...data,
        }
        createdItems.push({ delegate: delegateName, data: created })
        return created
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>
          data: Record<string, unknown>
        }) => {
          updatedItems.push({ delegate: delegateName, where, data })
          // Echo back a record shaped like the original plus the patch so
          // serializeItem doesn't blow up on undefined fields.
          return {
            id: where.id,
            handoverId: 'h-1',
            registration: 'VN-A123',
            type: 'A320',
            issue: 'Hydraulic leak under investigation.',
            status: ItemStatus.Open,
            priority: 'Normal',
            flightsAffected: null,
            ownerId: null,
            dueTime: null,
            remarks: null,
            resolvedAt: null,
            deletedAt: null,
            createdAt: new Date('2099-04-22T08:00:00Z'),
            updatedAt: new Date('2099-04-22T08:30:00Z'),
            ...data,
          }
        }
      ),
    })
    const txClient = {
      aircraftItem: makeDelegate('aircraftItem'),
      airportItem: makeDelegate('airportItem'),
      flightScheduleItem: makeDelegate('flightScheduleItem'),
      crewItem: makeDelegate('crewItem'),
      weatherItem: makeDelegate('weatherItem'),
      systemItem: makeDelegate('systemItem'),
      abnormalEvent: makeDelegate('abnormalEvent'),
      auditLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          auditLogs.push(data)
          return data
        }),
      },
    }
    return (arg as (tx: typeof txClient) => Promise<unknown>)(txClient)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('item.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auditLogs = []
    createdItems = []
    updatedItems = []
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // createItem
  // -------------------------------------------------------------------------

  describe('createItem', () => {
    it('creates an Open item and writes a CREATED audit log entry', async () => {
      const { handoverDate } = makeFutureDates()
      setupAccessibleHandover(handoverDate)
      setupTransactionMock()

      const result = await createItem(
        'h-1',
        'aircraft',
        buildAircraftItemInput(),
        STAFF_USER
      )

      expect(result.category).toBe('aircraft')
      expect(result.status).toBe(ItemStatus.Open)
      expect(createdItems).toHaveLength(1)
      expect(createdItems[0]!.delegate).toBe('aircraftItem')
      expect(createdItems[0]!.data.handoverId).toBe('h-1')

      expect(auditLogs).toHaveLength(1)
      expect(auditLogs[0]!.action).toBe(AuditAction.CREATED)
      expect(auditLogs[0]!.targetModel).toBe('AircraftItem')
      expect(auditLogs[0]!.userId).toBe(STAFF_USER.id)
    })

    it('sets resolvedAt when an item is created with status Resolved', async () => {
      const { handoverDate } = makeFutureDates()
      setupAccessibleHandover(handoverDate)
      setupTransactionMock()

      await createItem(
        'h-1',
        'aircraft',
        buildAircraftItemInput({ status: ItemStatus.Resolved }),
        STAFF_USER
      )

      expect(createdItems[0]!.data.resolvedAt).toBeInstanceOf(Date)
    })

    it('rejects an Open High-priority item without ownerId (BR-06)', async () => {
      const { handoverDate } = makeFutureDates()
      setupAccessibleHandover(handoverDate)
      setupTransactionMock()

      await expect(
        createItem(
          'h-1',
          'aircraft',
          buildAircraftItemInput({ priority: 'High' }),
          STAFF_USER
        )
      ).rejects.toBeInstanceOf(ZodError)

      expect(createdItems).toHaveLength(0)
      expect(auditLogs).toHaveLength(0)
    })

    it('accepts an Open High-priority item with ownerId (BR-06)', async () => {
      const { handoverDate } = makeFutureDates()
      setupAccessibleHandover(handoverDate)
      setupTransactionMock()

      const result = await createItem(
        'h-1',
        'aircraft',
        buildAircraftItemInput({ priority: 'High', ownerId: SUPERVISOR_USER.id }),
        STAFF_USER
      )

      expect(result.priority).toBe('High')
      expect(createdItems).toHaveLength(1)
    })

    it('rejects an item whose dueTime is more than 72h past the handoverDate (BR-14)', async () => {
      const { handoverDate } = makeFutureDates()
      setupAccessibleHandover(handoverDate)
      setupTransactionMock()
      // 96h past handoverDate midnight UTC — clearly outside the BR-14 window.
      const farFutureIso = new Date(
        handoverDate.getTime() + 96 * 60 * 60 * 1000
      ).toISOString()

      await expect(
        createItem(
          'h-1',
          'aircraft',
          buildAircraftItemInput({
            dueTime: farFutureIso,
            ownerId: SUPERVISOR_USER.id,
          }),
          STAFF_USER
        )
      ).rejects.toThrow('Validation failed')

      expect(createdItems).toHaveLength(0)
    })

    it('rejects an item whose dueTime is in the past (BR-14)', async () => {
      const { handoverDate } = makeFutureDates()
      setupAccessibleHandover(handoverDate)
      setupTransactionMock()
      const pastIso = new Date(Date.now() - 60 * 60 * 1000).toISOString()

      await expect(
        createItem(
          'h-1',
          'aircraft',
          buildAircraftItemInput({ dueTime: pastIso, ownerId: SUPERVISOR_USER.id }),
          STAFF_USER
        )
      ).rejects.toThrow('Validation failed')
    })

    it('throws NOT_FOUND when the parent handover does not exist', async () => {
      prismaMock.handover.findFirst.mockResolvedValueOnce(null)

      await expect(
        createItem('missing', 'aircraft', buildAircraftItemInput(), STAFF_USER)
      ).rejects.toThrow('Handover not found')
    })

    it("throws FORBIDDEN when an OCC_STAFF tries to add an item to someone else's handover", async () => {
      const { handoverDate } = makeFutureDates()
      setupAccessibleHandover(handoverDate, 'someone-else')

      await expect(
        createItem('h-1', 'aircraft', buildAircraftItemInput(), STAFF_USER)
      ).rejects.toThrow('You do not have access to this handover')
    })

    it('lets a SUPERVISOR add items to any handover regardless of preparer', async () => {
      const { handoverDate } = makeFutureDates()
      setupAccessibleHandover(handoverDate, 'someone-else')
      setupTransactionMock()

      const result = await createItem(
        'h-1',
        'aircraft',
        buildAircraftItemInput(),
        SUPERVISOR_USER
      )

      expect(result.id).toBeTruthy()
    })
  })

  // -------------------------------------------------------------------------
  // updateItem — status transitions, resolved-immutability, audit action
  // -------------------------------------------------------------------------

  describe('updateItem', () => {
    it('writes a STATUS_CHANGED audit log entry when status changes', async () => {
      const { handoverDate } = makeFutureDates()
      setupAccessibleHandover(handoverDate)
      prismaMock.aircraftItem.findFirst.mockResolvedValueOnce(buildAircraftItemRow())
      setupTransactionMock()

      await updateItem(
        'h-1',
        'aircraft',
        'item-1',
        { status: ItemStatus.Monitoring },
        STAFF_USER
      )

      const audit = auditLogs.find((entry) => entry.action === AuditAction.STATUS_CHANGED)
      expect(audit).toBeDefined()
      expect((audit as Record<string, unknown>).targetModel).toBe('AircraftItem')
    })

    it('writes an UPDATED audit log entry when only non-status fields change', async () => {
      const { handoverDate } = makeFutureDates()
      setupAccessibleHandover(handoverDate)
      prismaMock.aircraftItem.findFirst.mockResolvedValueOnce(buildAircraftItemRow())
      setupTransactionMock()

      await updateItem(
        'h-1',
        'aircraft',
        'item-1',
        { remarks: 'Updated context after engineer review.' },
        STAFF_USER
      )

      expect(auditLogs.filter((e) => e.action === AuditAction.UPDATED)).toHaveLength(1)
      expect(auditLogs.filter((e) => e.action === AuditAction.STATUS_CHANGED)).toHaveLength(0)
    })

    it('does not write an audit log entry when nothing actually changed', async () => {
      const { handoverDate } = makeFutureDates()
      setupAccessibleHandover(handoverDate)
      const existing = buildAircraftItemRow({ remarks: 'Same remarks' })
      prismaMock.aircraftItem.findFirst.mockResolvedValueOnce(existing)
      setupTransactionMock()

      await updateItem(
        'h-1',
        'aircraft',
        'item-1',
        { remarks: 'Same remarks' },
        STAFF_USER
      )

      expect(auditLogs).toHaveLength(0)
    })

    it('allows Open → Resolved transition and stamps resolvedAt (BR-05)', async () => {
      const { handoverDate } = makeFutureDates()
      setupAccessibleHandover(handoverDate)
      prismaMock.aircraftItem.findFirst.mockResolvedValueOnce(buildAircraftItemRow())
      setupTransactionMock()

      await updateItem(
        'h-1',
        'aircraft',
        'item-1',
        { status: ItemStatus.Resolved },
        STAFF_USER
      )

      expect(updatedItems).toHaveLength(1)
      expect(updatedItems[0]!.data.resolvedAt).toBeInstanceOf(Date)
    })

    it('rejects Resolved → Open transition (BR-05: Resolved is terminal)', async () => {
      const { handoverDate } = makeFutureDates()
      setupAccessibleHandover(handoverDate)
      prismaMock.aircraftItem.findFirst.mockResolvedValueOnce(
        buildAircraftItemRow({ status: ItemStatus.Resolved })
      )

      await expect(
        updateItem(
          'h-1',
          'aircraft',
          'item-1',
          { status: ItemStatus.Open },
          STAFF_USER
        )
      ).rejects.toThrow('Status transition is not allowed')
    })

    it('rejects edits to fields other than remarks on a Resolved item (ITEM_RESOLVED_IMMUTABLE)', async () => {
      const { handoverDate } = makeFutureDates()
      setupAccessibleHandover(handoverDate)
      prismaMock.aircraftItem.findFirst.mockResolvedValueOnce(
        buildAircraftItemRow({ status: ItemStatus.Resolved })
      )

      await expect(
        updateItem(
          'h-1',
          'aircraft',
          'item-1',
          { priority: 'High' },
          STAFF_USER
        )
      ).rejects.toThrow('Resolved items can only update remarks')
    })

    it('allows updating remarks on a Resolved item', async () => {
      const { handoverDate } = makeFutureDates()
      setupAccessibleHandover(handoverDate)
      prismaMock.aircraftItem.findFirst.mockResolvedValueOnce(
        buildAircraftItemRow({ status: ItemStatus.Resolved })
      )
      setupTransactionMock()

      await updateItem(
        'h-1',
        'aircraft',
        'item-1',
        { remarks: 'Closed out per supervisor.' },
        STAFF_USER
      )

      expect(updatedItems).toHaveLength(1)
      expect(updatedItems[0]!.data.remarks).toBe('Closed out per supervisor.')
    })

    it('throws NOT_FOUND when the item does not exist on the handover', async () => {
      const { handoverDate } = makeFutureDates()
      setupAccessibleHandover(handoverDate)
      prismaMock.aircraftItem.findFirst.mockResolvedValueOnce(null)

      await expect(
        updateItem(
          'h-1',
          'aircraft',
          'missing',
          { remarks: 'no-op' },
          STAFF_USER
        )
      ).rejects.toThrow('Item not found')
    })
  })

  // -------------------------------------------------------------------------
  // deleteItem — soft delete only (lib/prisma.ts contract)
  // -------------------------------------------------------------------------

  describe('deleteItem', () => {
    it('soft-deletes by setting deletedAt and writes a DELETED audit log entry', async () => {
      const { handoverDate } = makeFutureDates()
      setupAccessibleHandover(handoverDate)
      prismaMock.aircraftItem.findFirst.mockResolvedValueOnce(buildAircraftItemRow())
      setupTransactionMock()

      const result = await deleteItem('h-1', 'aircraft', 'item-1', STAFF_USER)

      expect(updatedItems).toHaveLength(1)
      expect(updatedItems[0]!.data.deletedAt).toBeInstanceOf(Date)
      expect(result.deletedAt).toEqual(expect.any(String))

      const audit = auditLogs.find((entry) => entry.action === AuditAction.DELETED)
      expect(audit).toBeDefined()
      expect((audit as Record<string, unknown>).targetModel).toBe('AircraftItem')
    })

    it('throws NOT_FOUND when the item does not exist', async () => {
      const { handoverDate } = makeFutureDates()
      setupAccessibleHandover(handoverDate)
      prismaMock.aircraftItem.findFirst.mockResolvedValueOnce(null)

      await expect(
        deleteItem('h-1', 'aircraft', 'missing', STAFF_USER)
      ).rejects.toThrow('Item not found')
    })

    it("throws FORBIDDEN when an OCC_STAFF tries to delete from someone else's handover", async () => {
      const { handoverDate } = makeFutureDates()
      setupAccessibleHandover(handoverDate, 'someone-else')

      await expect(
        deleteItem('h-1', 'aircraft', 'item-1', STAFF_USER)
      ).rejects.toThrow('You do not have access to this handover')
    })
  })

  // -------------------------------------------------------------------------
  // Schema dispatch helpers — make sure new categories don't fall through
  // -------------------------------------------------------------------------

  describe('parseCreateItemPayload / parseUpdateItemPayload', () => {
    it('routes aircraft create payloads through the AircraftItemSchema', () => {
      const valid = parseCreateItemPayload('aircraft', buildAircraftItemInput())
      expect(valid.registration).toBe('VN-A123')
    })

    it('routes weather create payloads through the WeatherItemSchema', () => {
      const valid = parseCreateItemPayload('weather', {
        affectedArea: 'WMKK',
        weatherType: 'Thunderstorm',
        issue: 'CB activity east of field.',
        status: ItemStatus.Open,
        priority: 'Normal',
      })
      expect(valid.affectedArea).toBe('WMKK')
    })

    it('rejects an aircraft update payload with an unknown field (strict)', () => {
      expect(() =>
        parseUpdateItemPayload('aircraft', {
          notAField: 'oops',
        } as unknown as Record<string, unknown>)
      ).toThrow()
    })
  })
})
