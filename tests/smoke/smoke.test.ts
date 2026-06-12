import { createHmac } from 'node:crypto'

import {
  AuditAction,
  Prisma,
  PrismaClient,
  Shift,
  UserRole,
} from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

const prisma = new PrismaClient()

const BACKEND_URL =
  process.env.SMOKE_BACKEND_URL ??
  process.env.BACKEND_URL ??
  'http://localhost:4000'
const AUTH_SECRET = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET
const SMOKE_TAG = '[SMOKE]'

const CATEGORY_AUDIT_CONFIG = [
  { relation: 'aircraftItems', delegate: 'aircraftItem', modelName: 'AircraftItem' },
  { relation: 'airportItems', delegate: 'airportItem', modelName: 'AirportItem' },
  {
    relation: 'flightScheduleItems',
    delegate: 'flightScheduleItem',
    modelName: 'FlightScheduleItem',
  },
  { relation: 'crewItems', delegate: 'crewItem', modelName: 'CrewItem' },
  { relation: 'weatherItems', delegate: 'weatherItem', modelName: 'WeatherItem' },
  { relation: 'systemItems', delegate: 'systemItem', modelName: 'SystemItem' },
  { relation: 'abnormalEvents', delegate: 'abnormalEvent', modelName: 'AbnormalEvent' },
] as const

const HANDOVER_ID_INCLUDE = {
  aircraftItems: { select: { id: true } },
  airportItems: { select: { id: true } },
  flightScheduleItems: { select: { id: true } },
  crewItems: { select: { id: true } },
  weatherItems: { select: { id: true } },
  systemItems: { select: { id: true } },
  abnormalEvents: { select: { id: true } },
} satisfies Prisma.HandoverInclude

type SmokeUser = {
  id: string
  email: string
  name: string
  role: UserRole
}

type CategoryConfig = (typeof CATEGORY_AUDIT_CONFIG)[number]
type HandoverWithItemIds = Prisma.HandoverGetPayload<{
  include: typeof HANDOVER_ID_INCLUDE
}>

type CreateHandoverResponse = {
  id: string
  referenceId: string
  createdAt: string
  carryForward?: {
    carriedItemCount: number
    targetHandoverId: string
  }
}

type HandoverDetailResponse = {
  id: string
  referenceId: string
  handoverDate: string
  shift: 'Morning' | 'Night'
  isCarriedForward: boolean
  carriedFromId: string | null
  acknowledgedAt: string | null
  categories: {
    aircraft: Array<{
      id: string
      issue: string
      remarks: string | null
      ownerId: string | null
    }>
    airport: Array<{ id: string }>
    flightSchedule: Array<{ id: string }>
    crew: Array<{ id: string }>
    weather: Array<{ id: string }>
    system: Array<{ id: string }>
    abnormalEvents: Array<{ id: string }>
  }
  auditLog: Array<{
    id: string
    action: string
    targetId: string
  }>
  acknowledgments: Array<{
    id: string
    user: {
      id: string
      name: string
    }
    notes: string | null
    acknowledgedAt: string
  }>
}

function toDateOnly(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
  )
}

function addUtcDays(dateOnly: Date, days: number) {
  const next = new Date(dateOnly)
  next.setUTCDate(next.getUTCDate() + days)

  return toDateOnly(next)
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10)
}

function buildBackendAuthHeaders(user: SmokeUser) {
  if (!AUTH_SECRET) {
    throw new Error('NEXTAUTH_SECRET or AUTH_SECRET must be set before running smoke tests.')
  }

  const timestamp = Date.now().toString()
  const payload = [
    user.id,
    user.name,
    user.email,
    user.role,
    timestamp,
  ].join(':')
  const signature = createHmac('sha256', AUTH_SECRET)
    .update(payload)
    .digest('base64url')

  return {
    'x-occ-auth-user-id': user.id,
    'x-occ-auth-user-name': user.name,
    'x-occ-auth-user-email': user.email,
    'x-occ-auth-user-role': user.role,
    'x-occ-auth-timestamp': timestamp,
    'x-occ-auth-signature': signature,
  }
}

async function getResponsePayload<T>(response: Response): Promise<T | null> {
  const raw = await response.text()

  if (!raw) {
    return null
  }

  return JSON.parse(raw) as T
}

async function backendRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST'
    user: SmokeUser
    body?: unknown
  }
): Promise<T> {
  const url = new URL(`/api/v1${path}`, BACKEND_URL)
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...buildBackendAuthHeaders(options.user),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })

  const payload = await getResponsePayload<T | Record<string, unknown>>(response)

  if (!response.ok) {
    throw new Error(
      `Backend request failed for ${url.pathname}: ${response.status} ${JSON.stringify(payload)}`
    )
  }

  return payload as T
}

async function requireUser(
  email: string,
  role: UserRole
): Promise<SmokeUser> {
  const user = await prisma.user.findFirst({
    where: {
      email,
      role,
      isActive: true,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
    },
  })

  if (!user) {
    throw new Error(
      `Active UAT user not found for ${email}. Run "npm run db:seed:uat" before the smoke tests.`
    )
  }

  return user
}

async function findAvailableMorningNightDate() {
  const today = toDateOnly(new Date())

  for (let offset = 7; offset >= 0; offset -= 1) {
    const handoverDate = addUtcDays(today, -offset)
    const existing = await prisma.handover.findMany({
      where: {
        deletedAt: null,
        handoverDate,
        shift: {
          in: [Shift.Morning, Shift.Night],
        },
      },
      select: {
        shift: true,
      },
    })

    const occupiedShifts = new Set(existing.map((handover) => handover.shift))

    if (
      !occupiedShifts.has(Shift.Morning) &&
      !occupiedShifts.has(Shift.Night)
    ) {
      return formatDateOnly(handoverDate)
    }
  }

  throw new Error(
    'No free Morning/Night date pair was found in the last 8 days. Run "npm run db:seed:uat" to reset the local UAT dataset.'
  )
}

async function archiveCategoryItems(
  tx: Prisma.TransactionClient,
  delegate: CategoryConfig['delegate'],
  ids: string[],
  deletedAt: Date
) {
  if (ids.length === 0) {
    return
  }

  switch (delegate) {
    case 'aircraftItem':
      await tx.aircraftItem.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt },
      })
      break
    case 'airportItem':
      await tx.airportItem.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt },
      })
      break
    case 'flightScheduleItem':
      await tx.flightScheduleItem.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt },
      })
      break
    case 'crewItem':
      await tx.crewItem.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt },
      })
      break
    case 'weatherItem':
      await tx.weatherItem.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt },
      })
      break
    case 'systemItem':
      await tx.systemItem.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt },
      })
      break
    case 'abnormalEvent':
      await tx.abnormalEvent.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt },
      })
      break
  }
}

async function cleanupSmokeHandovers(handoverIds: string[], userId: string) {
  if (handoverIds.length === 0) {
    return
  }

  const activeHandovers = await prisma.handover.findMany({
    where: {
      id: { in: handoverIds },
      deletedAt: null,
    },
    include: HANDOVER_ID_INCLUDE,
  })

  if (activeHandovers.length === 0) {
    return
  }

  const deletedAt = new Date()

  await prisma.$transaction(async (tx) => {
    const auditLogs: Prisma.AuditLogCreateManyInput[] = []

    for (const handover of activeHandovers as HandoverWithItemIds[]) {
      for (const config of CATEGORY_AUDIT_CONFIG) {
        const items = handover[config.relation] as Array<{ id: string }>
        const ids = items.map((item) => item.id)

        await archiveCategoryItems(tx, config.delegate, ids, deletedAt)

        for (const id of ids) {
          auditLogs.push({
            handoverId: handover.id,
            userId,
            action: AuditAction.DELETED,
            targetModel: config.modelName,
            targetId: id,
            newValue: {
              smokeTag: SMOKE_TAG,
              deletedAt: deletedAt.toISOString(),
            },
          })
        }
      }

      await tx.handover.update({
        where: { id: handover.id },
        data: { deletedAt },
      })

      auditLogs.push({
        handoverId: handover.id,
        userId,
        action: AuditAction.DELETED,
        targetModel: 'Handover',
        targetId: handover.id,
        newValue: {
          smokeTag: SMOKE_TAG,
          deletedAt: deletedAt.toISOString(),
          referenceId: handover.referenceId,
        },
      })
    }

    await tx.auditLog.createMany({ data: auditLogs })
  })
}

describe('Task 4.4 local smoke tests', () => {
  it(
    'covers create handover, auto carry-forward, and acknowledge against the live local URLs',
    async () => {
      const createdHandoverIds: string[] = []
      const [staff, supervisor, admin] = await Promise.all([
        requireUser('staff@occ.test', UserRole.OCC_STAFF),
        requireUser('supervisor@occ.test', UserRole.SUPERVISOR),
        requireUser('admin@occ.test', UserRole.ADMIN),
      ])

      try {
        const healthResponse = await fetch(new URL('/health', BACKEND_URL))

        expect(healthResponse.status).toBe(200)
        expect(await healthResponse.json()).toEqual({ status: 'ok' })

        const handoverDate = await findAvailableMorningNightDate()
        const runId = `${SMOKE_TAG}-${handoverDate}-${Date.now()}`

        const sourceHandover = await backendRequest<CreateHandoverResponse>(
          '/handovers',
          {
            method: 'POST',
            user: staff,
            body: {
              handoverDate,
              shift: 'Morning',
              overallPriority: 'High',
              handedToId: supervisor.id,
              generalRemarks: `${runId} source handover`,
              nextShiftActions: `${runId} create the Night handover to verify auto carry-forward`,
              categories: {
                aircraft: [
                  {
                    registration: '9M-SMK',
                    type: 'A320',
                    issue: `${runId} hydraulic review remains open for the next shift.`,
                    status: 'Open',
                    priority: 'High',
                    ownerId: supervisor.id,
                    remarks: `${runId} carry-forward seed item`,
                  },
                ],
              },
            },
          }
        )

        createdHandoverIds.push(sourceHandover.id)

        expect(sourceHandover.referenceId).toMatch(/^HDO-\d{4}-\d{6}$/)

        const targetHandover = await backendRequest<CreateHandoverResponse>(
          '/handovers',
          {
            method: 'POST',
            user: staff,
            body: {
              handoverDate,
              shift: 'Night',
              overallPriority: 'Normal',
              handedToId: supervisor.id,
              generalRemarks: `${runId} target handover`,
              nextShiftActions: `${runId} supervisor should acknowledge this carried-forward handover`,
              categories: {},
            },
          }
        )

        createdHandoverIds.push(targetHandover.id)

        expect(targetHandover.carryForward?.targetHandoverId).toBe(targetHandover.id)
        expect(targetHandover.carryForward?.carriedItemCount).toBe(1)

        const carriedForwardDetail = await backendRequest<HandoverDetailResponse>(
          `/handovers/${encodeURIComponent(targetHandover.id)}`,
          {
            user: supervisor,
          }
        )

        expect(carriedForwardDetail.isCarriedForward).toBe(true)
        expect(carriedForwardDetail.carriedFromId).toBe(sourceHandover.id)
        expect(carriedForwardDetail.categories.aircraft).toHaveLength(1)
        expect(carriedForwardDetail.categories.aircraft[0]?.issue).toContain(runId)
        expect(
          carriedForwardDetail.auditLog.some((entry) => entry.action === 'CARRIED_FORWARD')
        ).toBe(true)

        const acknowledgment = await backendRequest<{ acknowledgedAt: string }>(
          `/handovers/${encodeURIComponent(targetHandover.id)}/acknowledge`,
          {
            method: 'POST',
            user: supervisor,
            body: {
              notes: `${runId} acknowledged by smoke test`,
            },
          }
        )

        expect(acknowledgment.acknowledgedAt).toBeTruthy()

        const acknowledgedDetail = await backendRequest<HandoverDetailResponse>(
          `/handovers/${encodeURIComponent(targetHandover.id)}`,
          {
            user: supervisor,
          }
        )

        expect(acknowledgedDetail.acknowledgedAt).toBe(acknowledgment.acknowledgedAt)
        expect(acknowledgedDetail.acknowledgments).toHaveLength(1)
        expect(acknowledgedDetail.acknowledgments[0]?.user.id).toBe(supervisor.id)
        expect(acknowledgedDetail.acknowledgments[0]?.notes).toContain(runId)
        expect(
          acknowledgedDetail.auditLog.some((entry) => entry.action === 'ACKNOWLEDGED')
        ).toBe(true)
      } finally {
        await cleanupSmokeHandovers(createdHandoverIds, admin.id)
      }
    },
    120_000
  )
})

afterAll(async () => {
  await prisma.$disconnect()
})
