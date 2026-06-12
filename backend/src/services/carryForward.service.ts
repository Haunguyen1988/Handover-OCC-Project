import {
  AuditAction,
  ItemStatus,
  Shift,
} from '@prisma/client'

import { prisma } from '../lib/prisma'
import { ServiceError } from '../lib/service-error'
import { writeAuditLog } from './audit.service'

/**
 * The Prisma relation keys for all seven item categories, matching
 * the Handover model include keys exactly.
 */
const CATEGORY_RELATIONS = [
  'aircraftItems',
  'airportItems',
  'flightScheduleItems',
  'crewItems',
  'weatherItems',
  'systemItems',
  'abnormalEvents',
] as const

type CategoryRelation = (typeof CATEGORY_RELATIONS)[number]

/**
 * Map relation key → Prisma model delegate name (lower-camelCase).
 */
const RELATION_TO_DELEGATE: Record<CategoryRelation, string> = {
  aircraftItems: 'aircraftItem',
  airportItems: 'airportItem',
  flightScheduleItems: 'flightScheduleItem',
  crewItems: 'crewItem',
  weatherItems: 'weatherItem',
  systemItems: 'systemItem',
  abnormalEvents: 'abnormalEvent',
}

/**
 * Fields that are inherited by the carried-forward copy.
 * Category-specific fields (registration, airport, etc.) are carried
 * automatically because we spread the whole item and then strip the
 * excluded fields.
 */
const EXCLUDED_FIELDS_FOR_COPY = new Set([
  'id',
  'handoverId',
  'resolvedAt',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'handover',
])

export type CarryForwardResult = {
  carriedItemCount: number
  targetHandoverId: string
}

// ---------------------------------------------------------------------------
// Shift helpers
// ---------------------------------------------------------------------------

const SHIFT_ORDER: Shift[] = [Shift.Morning, Shift.Night]

export function getPreviousShift(
  date: Date,
  shift: Shift
): { date: Date; shift: Shift } {
  const currentIndex = SHIFT_ORDER.indexOf(shift)

  if (currentIndex > 0) {
    return { date, shift: SHIFT_ORDER[currentIndex - 1]! }
  }

  // shift is Morning → previous is Night of the day before
  const previousDate = new Date(date)
  previousDate.setUTCDate(previousDate.getUTCDate() - 1)

  return { date: previousDate, shift: Shift.Night }
}

// ---------------------------------------------------------------------------
// Core carry-forward logic
// ---------------------------------------------------------------------------

type SourceItem = Record<string, unknown> & {
  id: string
  status: ItemStatus
}

type SourceHandover = {
  id: string
  [key: string]: unknown
}

function stripExcludedFields(item: Record<string, unknown>) {
  const copy: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(item)) {
    if (!EXCLUDED_FIELDS_FOR_COPY.has(key)) {
      copy[key] = value
    }
  }

  return copy
}

/**
 * Carry all Open/Monitoring items from `sourceHandoverId` to `targetHandoverId`.
 *
 * Rules (BR-07):
 * - Creates NEW item records – never moves the originals.
 * - Original items on the source handover remain unchanged.
 * - All 7 category types are carried.
 * - The entire operation is wrapped in a Prisma transaction.
 * - An AuditLog entry with action = CARRIED_FORWARD is written per item.
 * - The target handover's `isCarriedForward` and `carriedFromId` are updated.
 */
export async function carryForwardOpenItems(
  sourceHandoverId: string,
  targetHandoverId: string,
  actingUserId: string
): Promise<CarryForwardResult> {
  // 1. Load source handover with all category items
  const sourceHandover = await prisma.handover.findFirst({
    where: { id: sourceHandoverId },
    include: {
      aircraftItems: true,
      airportItems: true,
      flightScheduleItems: true,
      crewItems: true,
      weatherItems: true,
      systemItems: true,
      abnormalEvents: true,
    },
  }) as SourceHandover | null

  if (!sourceHandover) {
    throw new ServiceError(404, 'NOT_FOUND', 'Source handover not found')
  }

  // Verify target exists
  const targetHandover = await prisma.handover.findFirst({
    where: { id: targetHandoverId },
    select: { id: true },
  })

  if (!targetHandover) {
    throw new ServiceError(404, 'NOT_FOUND', 'Target handover not found')
  }

  // 2. Collect open/monitoring items across all categories
  const itemsToCarry: Array<{
    relation: CategoryRelation
    item: SourceItem
  }> = []

  for (const relation of CATEGORY_RELATIONS) {
    const items = (sourceHandover[relation] ?? []) as SourceItem[]

    for (const item of items) {
      if (
        item.status === ItemStatus.Open ||
        item.status === ItemStatus.Monitoring
      ) {
        itemsToCarry.push({ relation, item })
      }
    }
  }

  // 3. Nothing to carry → still mark the link but with zero count
  if (itemsToCarry.length === 0) {
    return {
      carriedItemCount: 0,
      targetHandoverId,
    }
  }

  // 4. Wrap in a transaction: create copies + audit logs + update target handover
  return prisma.$transaction(async (tx) => {
    for (const { relation, item } of itemsToCarry) {
      const delegateKey = RELATION_TO_DELEGATE[relation]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delegate = (tx as any)[delegateKey] as {
        create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>
      }

      const strippedData = stripExcludedFields(item)
      const createdItem = await delegate.create({
        data: {
          ...strippedData,
          handoverId: targetHandoverId,
        },
      })

      // Write audit log for each carried item
      await writeAuditLog({
        db: tx,
        handoverId: targetHandoverId,
        userId: actingUserId,
        action: AuditAction.CARRIED_FORWARD,
        targetModel: relation,
        targetId: createdItem.id,
        oldValue: { sourceHandoverId },
        newValue: {
          sourceItemId: item.id,
          status: item.status,
        },
      })
    }

    // 5. Update the target handover flags
    await tx.handover.update({
      where: { id: targetHandoverId },
      data: {
        isCarriedForward: true,
        carriedFromId: sourceHandoverId,
      },
    })

    return {
      carriedItemCount: itemsToCarry.length,
      targetHandoverId,
    }
  })
}

// ---------------------------------------------------------------------------
// Auto carry-forward check (called from handover creation)
// ---------------------------------------------------------------------------

/**
 * Find the previous shift's handover (if any) and carry forward
 * its open/monitoring items to the newly created handover.
 *
 * Returns the carry-forward result or null if no previous shift handover
 * was found or no items were eligible.
 */
export async function autoCarryForward(
  targetHandoverId: string,
  handoverDate: Date,
  shift: Shift,
  actingUserId: string
): Promise<CarryForwardResult | null> {
  const previous = getPreviousShift(handoverDate, shift)

  // Normalize the date to midnight UTC for querying
  const prevDateOnly = new Date(
    Date.UTC(
      previous.date.getUTCFullYear(),
      previous.date.getUTCMonth(),
      previous.date.getUTCDate()
    )
  )

  const previousHandover = await prisma.handover.findFirst({
    where: {
      handoverDate: prevDateOnly,
      shift: previous.shift,
    },
    select: { id: true },
  })

  if (!previousHandover) {
    return null
  }

  const result = await carryForwardOpenItems(
    previousHandover.id,
    targetHandoverId,
    actingUserId
  )

  if (result.carriedItemCount === 0) {
    return null
  }

  return result
}
