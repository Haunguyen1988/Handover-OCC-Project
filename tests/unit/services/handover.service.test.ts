import { AuditAction, ItemStatus, Priority, Shift, UserRole } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CreateHandoverInput } from '../../../backend/src/schemas/handover.schema'

// ---------------------------------------------------------------------------
// Prisma + carry-forward mocks
//
// The handover service orchestrates four collaborators:
//   - prisma (multiple delegates + $transaction)
//   - carryForward.service.carryForwardOpenItems (auto carry-forward)
//   - audit.service.writeAuditLog (always invoked through prisma transactions)
//   - getPreviousShift (pure helper from carryForward.service)
//
// We mock prisma in-memory so we can assert what was written, and we mock
// `carryForwardOpenItems` so we can verify auto-carry-forward is plumbed
// correctly without re-testing carryForward.service (covered separately).
// `getPreviousShift` is a pure shift-arithmetic helper and is NOT mocked
// — we use the real implementation so the previous-shift lookup query
// gets the right inputs.
// ---------------------------------------------------------------------------

let auditLogs: Array<Record<string, unknown>> = []
let createdHandovers: Array<Record<string, unknown>> = []
let updatedHandovers: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = []

const prismaMock = vi.hoisted(() => ({
  handover: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  user: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  $queryRawUnsafe: vi.fn(),
  $transaction: vi.fn(),
}))

const carryForwardMock = vi.hoisted(() => ({
  carryForwardOpenItems: vi.fn(),
}))

vi.mock('../../../backend/src/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('../../../backend/src/services/carryForward.service', async () => {
  // Keep the real `getPreviousShift` (pure helper) and only stub the
  // side-effecting `carryForwardOpenItems`. handover.service imports both.
  const actual = await vi.importActual<typeof import('../../../backend/src/services/carryForward.service')>(
    '../../../backend/src/services/carryForward.service'
  )
  return {
    ...actual,
    carryForwardOpenItems: carryForwardMock.carryForwardOpenItems,
  }
})

import {
  createHandover,
  getHandoverDetail,
  updateHandover,
} from '../../../backend/src/services/handover.service'

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
  name: 'Supervisor',
  email: 'super@example.test',
  role: UserRole.SUPERVISOR,
} as const

function makeCreateInput(
  overrides: Partial<CreateHandoverInput> = {}
): CreateHandoverInput {
  return {
    handoverDate: '2099-04-23',
    shift: 'Afternoon',
    overallPriority: 'Normal',
    categories: {},
    ...overrides,
  } as CreateHandoverInput
}

function setupCreateTransactionMock() {
  prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg !== 'function') {
      throw new Error('Expected a callback-style $transaction call')
    }
    const txClient = {
      $queryRawUnsafe: vi.fn(async () => [{ value: 42 }]),
      handover: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const created = {
            id: `h-${createdHandovers.length + 1}`,
            createdAt: new Date('2099-04-23T08:00:00Z'),
            handoverDate: data.handoverDate ?? new Date('2099-04-23T00:00:00Z'),
            shift: data.shift,
            overallPriority: data.overallPriority,
            referenceId: data.referenceId,
            ...data,
          }
          createdHandovers.push(created)
          return created
        }),
      },
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

function setupUpdateTransactionMock() {
  prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg !== 'function') {
      throw new Error('Expected a callback-style $transaction call')
    }
    const txClient = {
      handover: {
        update: vi.fn(
          async ({
            where,
            data,
          }: {
            where: Record<string, unknown>
            data: Record<string, unknown>
          }) => {
            updatedHandovers.push({ where, data })
            return { id: where.id, ...data }
          }
        ),
      },
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

// `prisma.handover.findFirst` is called from several different code paths
// inside one createHandover / updateHandover flow. Dispatch by inspecting
// the args shape — and crucially distinguish the previous-shift query
// from the duplicate-shift query, which both look like
// `{ where: { handoverDate, shift }, select: { id: true } }`. We tell
// them apart by call order: createHandover runs them in parallel via
// Promise.all([findPreviousShiftHandoverId, ensureActiveUsers,
// assertNoDuplicateShiftHandover]) — order in source = 1st call is
// previous-shift, 2nd findFirst with the same shape is duplicate-shift.
function dispatchHandoverFindFirst(handlers: {
  forPreviousShift?: () => unknown
  forDuplicateShift?: () => unknown
  forAccessCheck?: () => unknown
  forUpdateLoad?: () => unknown
  forDetailSerialization?: () => unknown
}) {
  let dateShiftCalls = 0
  prismaMock.handover.findFirst.mockImplementation(async (args: { where?: Record<string, unknown>; select?: Record<string, unknown>; include?: Record<string, unknown> } = {}) => {
    const where = (args.where ?? {}) as Record<string, unknown>
    const select = (args.select ?? {}) as Record<string, unknown>
    const include = (args.include ?? {}) as Record<string, unknown>

    // assertNoDuplicateShiftHandover may include `id: { not: ... }` when
    // an excludeId is passed (updateHandover path). Detect that branch
    // first since its where-shape is unambiguous.
    if ('handoverDate' in where && 'shift' in where && 'id' in where) {
      return handlers.forDuplicateShift?.() ?? null
    }
    // Both findPreviousShiftHandoverId and the no-excludeId variant of
    // assertNoDuplicateShiftHandover query by handoverDate + shift +
    // select id. Use call order: 1st = previous, 2nd = duplicate.
    if ('handoverDate' in where && 'shift' in where) {
      dateShiftCalls += 1
      if (dateShiftCalls === 1) {
        return handlers.forPreviousShift?.() ?? null
      }
      return handlers.forDuplicateShift?.() ?? null
    }
    // getHandoverForAccessCheck selects id + preparedById only.
    if (select.id && select.preparedById && !select.handoverDate) {
      return handlers.forAccessCheck?.() ?? null
    }
    // updateHandover loads the existing row with `include: { preparedBy }`.
    if (include.preparedBy && !include.aircraftItems) {
      return handlers.forUpdateLoad?.() ?? null
    }
    // serializeHandoverDetail uses HANDOVER_DETAIL_INCLUDE (full include).
    if (include.aircraftItems) {
      return handlers.forDetailSerialization?.() ?? null
    }
    return null
  })
}

function buildDetailRow(overrides: Record<string, unknown> = {}) {
  const baseDate = new Date('2099-04-23T08:00:00Z')
  return {
    id: 'h-1',
    referenceId: 'HDO-2099-000042',
    handoverDate: new Date('2099-04-23T00:00:00Z'),
    shift: Shift.Afternoon,
    preparedBy: { id: STAFF_USER.id, name: STAFF_USER.name },
    handedTo: null,
    overallPriority: Priority.Normal,
    overallStatus: ItemStatus.Open,
    generalRemarks: null,
    nextShiftActions: null,
    isCarriedForward: false,
    carriedFromId: null,
    handedToId: null,
    submittedAt: null,
    acknowledgedAt: null,
    aircraftItems: [],
    airportItems: [],
    flightScheduleItems: [],
    crewItems: [],
    weatherItems: [],
    systemItems: [],
    abnormalEvents: [],
    auditLogs: [],
    acknowledgments: [],
    createdAt: baseDate,
    updatedAt: baseDate,
    preparedById: STAFF_USER.id,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handover.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auditLogs = []
    createdHandovers = []
    updatedHandovers = []

    // Default: no previous shift handover, no duplicate, both users active.
    prismaMock.user.findMany.mockResolvedValue([
      { id: STAFF_USER.id },
      { id: SUPERVISOR_USER.id },
    ])
    prismaMock.user.findFirst.mockResolvedValue({ id: SUPERVISOR_USER.id, isActive: true })
    carryForwardMock.carryForwardOpenItems.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // createHandover
  // -------------------------------------------------------------------------

  describe('createHandover', () => {
    it('creates a handover and writes a CREATED audit log entry', async () => {
      dispatchHandoverFindFirst({}) // no previous shift, no duplicate
      setupCreateTransactionMock()

      const result = await createHandover(
        makeCreateInput({ handedToId: SUPERVISOR_USER.id, generalRemarks: 'note' }),
        STAFF_USER
      )

      expect(result.id).toBeTruthy()
      expect(result.referenceId).toMatch(/^HDO-\d{4}-\d{6}$/)
      expect(createdHandovers).toHaveLength(1)
      expect(createdHandovers[0]!.preparedById).toBe(STAFF_USER.id)
      expect(createdHandovers[0]!.handedToId).toBe(SUPERVISOR_USER.id)

      expect(auditLogs).toHaveLength(1)
      expect(auditLogs[0]!.action).toBe(AuditAction.CREATED)
      expect(auditLogs[0]!.targetModel).toBe('Handover')
      expect(auditLogs[0]!.userId).toBe(STAFF_USER.id)
    })

    it('triggers auto carry-forward when a previous shift handover exists', async () => {
      dispatchHandoverFindFirst({
        forPreviousShift: () => ({ id: 'previous-handover-id' }),
      })
      setupCreateTransactionMock()
      carryForwardMock.carryForwardOpenItems.mockResolvedValueOnce({
        carriedItemCount: 3,
        targetHandoverId: 'h-1',
      })

      const result = await createHandover(makeCreateInput(), STAFF_USER) as {
        id: string
        carryForward?: { carriedItemCount: number; targetHandoverId: string }
      }

      expect(carryForwardMock.carryForwardOpenItems).toHaveBeenCalledOnce()
      expect(carryForwardMock.carryForwardOpenItems).toHaveBeenCalledWith(
        'previous-handover-id',
        result.id,
        STAFF_USER.id
      )
      expect(result.carryForward).toEqual({
        carriedItemCount: 3,
        targetHandoverId: 'h-1',
      })
    })

    it('skips auto carry-forward when no previous shift handover exists', async () => {
      dispatchHandoverFindFirst({}) // forPreviousShift returns null
      setupCreateTransactionMock()

      await createHandover(makeCreateInput(), STAFF_USER)

      expect(carryForwardMock.carryForwardOpenItems).not.toHaveBeenCalled()
    })

    it('does not fail handover creation when carry-forward throws', async () => {
      dispatchHandoverFindFirst({
        forPreviousShift: () => ({ id: 'previous-handover-id' }),
      })
      setupCreateTransactionMock()
      carryForwardMock.carryForwardOpenItems.mockRejectedValueOnce(
        new Error('carry-forward exploded')
      )
      // Silence the expected console.error output the service emits in
      // this catch path so the test log stays readable.
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

      const result = await createHandover(makeCreateInput(), STAFF_USER)

      expect(result.id).toBeTruthy()
      expect(consoleError).toHaveBeenCalled()
      consoleError.mockRestore()
    })

    it('throws DUPLICATE_SHIFT_HANDOVER (BR-01) when a handover already exists for the same date and shift', async () => {
      dispatchHandoverFindFirst({
        forDuplicateShift: () => ({ id: 'colliding-handover-id' }),
      })

      await expect(createHandover(makeCreateInput(), STAFF_USER)).rejects.toThrow(
        'An active handover already exists for the selected date and shift'
      )
      expect(prismaMock.$transaction).not.toHaveBeenCalled()
    })

    it('throws VALIDATION_FAILED when the prepared-by user is inactive', async () => {
      dispatchHandoverFindFirst({})
      // Only the handed-to user is in the active list — preparer is missing.
      prismaMock.user.findMany.mockResolvedValueOnce([{ id: SUPERVISOR_USER.id }])

      await expect(
        createHandover(makeCreateInput({ handedToId: SUPERVISOR_USER.id }), STAFF_USER)
      ).rejects.toThrow('User must be active')
    })
  })

  // -------------------------------------------------------------------------
  // getHandoverDetail
  // -------------------------------------------------------------------------

  describe('getHandoverDetail', () => {
    it('returns the serialized detail when access check passes', async () => {
      dispatchHandoverFindFirst({
        forAccessCheck: () => ({ id: 'h-1', preparedById: STAFF_USER.id }),
        forDetailSerialization: () => buildDetailRow(),
      })

      const detail = await getHandoverDetail('h-1', STAFF_USER)

      expect(detail.id).toBe('h-1')
      expect(detail.referenceId).toBe('HDO-2099-000042')
      expect(detail.handoverDate).toBe('2099-04-23')
      expect(detail.shift).toBe(Shift.Afternoon)
      expect(detail.categories.aircraft).toEqual([])
    })

    it('throws NOT_FOUND when the handover does not exist', async () => {
      dispatchHandoverFindFirst({})

      await expect(getHandoverDetail('missing', STAFF_USER)).rejects.toThrow(
        'Handover not found'
      )
    })

    it('throws FORBIDDEN when an OCC_STAFF tries to access another staff\'s handover', async () => {
      dispatchHandoverFindFirst({
        forAccessCheck: () => ({ id: 'h-1', preparedById: 'someone-else' }),
      })

      await expect(getHandoverDetail('h-1', STAFF_USER)).rejects.toThrow(
        'You do not have access to this handover'
      )
    })

    it('allows SUPERVISOR to access any handover regardless of preparer', async () => {
      dispatchHandoverFindFirst({
        forAccessCheck: () => ({ id: 'h-1', preparedById: 'someone-else' }),
        forDetailSerialization: () =>
          buildDetailRow({ preparedById: 'someone-else' }),
      })

      const detail = await getHandoverDetail('h-1', SUPERVISOR_USER)
      expect(detail.id).toBe('h-1')
    })
  })

  // -------------------------------------------------------------------------
  // updateHandover
  // -------------------------------------------------------------------------

  describe('updateHandover', () => {
    it('writes an UPDATED audit log entry when fields change', async () => {
      const baseRow = buildDetailRow()
      dispatchHandoverFindFirst({
        forUpdateLoad: () => ({
          ...baseRow,
          preparedBy: { id: STAFF_USER.id },
        }),
        forAccessCheck: () => ({ id: 'h-1', preparedById: STAFF_USER.id }),
        forDetailSerialization: () =>
          buildDetailRow({ generalRemarks: 'updated note' }),
      })
      setupUpdateTransactionMock()

      await updateHandover('h-1', { generalRemarks: 'updated note' }, STAFF_USER)

      expect(updatedHandovers).toHaveLength(1)
      expect(updatedHandovers[0]!.data.generalRemarks).toBe('updated note')

      const updateAudit = auditLogs.find(
        (entry) => entry.action === AuditAction.UPDATED
      )
      expect(updateAudit).toBeDefined()
      expect((updateAudit as Record<string, unknown>).targetModel).toBe('Handover')
      expect(
        (updateAudit as { newValue: Record<string, unknown> }).newValue.generalRemarks
      ).toBe('updated note')
    })

    it('does not write an audit log entry when nothing changed', async () => {
      const baseRow = buildDetailRow({ generalRemarks: 'unchanged' })
      dispatchHandoverFindFirst({
        forUpdateLoad: () => ({
          ...baseRow,
          preparedBy: { id: STAFF_USER.id },
        }),
        forAccessCheck: () => ({ id: 'h-1', preparedById: STAFF_USER.id }),
        forDetailSerialization: () => baseRow,
      })
      setupUpdateTransactionMock()

      await updateHandover('h-1', { generalRemarks: 'unchanged' }, STAFF_USER)

      expect(auditLogs.filter((entry) => entry.action === AuditAction.UPDATED)).toHaveLength(0)
    })

    it('throws FORBIDDEN when an OCC_STAFF tries to update someone else\'s handover', async () => {
      dispatchHandoverFindFirst({
        forUpdateLoad: () => ({
          ...buildDetailRow({ preparedById: 'someone-else' }),
          preparedBy: { id: 'someone-else' },
        }),
      })

      await expect(
        updateHandover('h-1', { generalRemarks: 'noop' }, STAFF_USER)
      ).rejects.toThrow('You do not have access to this handover')
    })

    it('throws DUPLICATE_SHIFT_HANDOVER when changing date+shift would collide with another handover', async () => {
      dispatchHandoverFindFirst({
        forUpdateLoad: () => ({
          ...buildDetailRow(),
          preparedBy: { id: STAFF_USER.id },
        }),
        forDuplicateShift: () => ({ id: 'other-handover-on-same-slot' }),
      })

      await expect(
        updateHandover('h-1', { shift: 'Morning' }, STAFF_USER)
      ).rejects.toThrow('An active handover already exists for the selected date and shift')
    })
  })
})
