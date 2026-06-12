import bcrypt from 'bcryptjs'
import {
  AuditAction,
  ItemStatus,
  Prisma,
  PrismaClient,
  Priority,
  Shift,
  UserRole,
} from '@prisma/client'

const prisma = new PrismaClient()

const UAT_PASSWORD = 'Pilot2025!'
const UAT_TAG = '[UAT-SEED]'
const INTERACTIVE_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 60_000,
} satisfies Parameters<typeof prisma.$transaction>[1]

const HANDOVER_WITH_ITEMS_INCLUDE = {
  aircraftItems: true,
  airportItems: true,
  flightScheduleItems: true,
  crewItems: true,
  weatherItems: true,
  systemItems: true,
  abnormalEvents: true,
} satisfies Prisma.HandoverInclude

const UAT_HANDOVER_ID_INCLUDE = {
  aircraftItems: { select: { id: true } },
  airportItems: { select: { id: true } },
  flightScheduleItems: { select: { id: true } },
  crewItems: { select: { id: true } },
  weatherItems: { select: { id: true } },
  systemItems: { select: { id: true } },
  abnormalEvents: { select: { id: true } },
} satisfies Prisma.HandoverInclude

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

type SeededHandover = Prisma.HandoverGetPayload<{
  include: typeof HANDOVER_WITH_ITEMS_INCLUDE
}>

type CategoryConfig = (typeof CATEGORY_AUDIT_CONFIG)[number]
type CategoryItem = {
  id: string
  status: ItemStatus
  priority: Priority
  ownerId: string | null
  dueTime: Date | null
  resolvedAt?: Date | null
  remarks?: string | null
  [key: string]: unknown
}

type UatUsers = {
  staff: { id: string; email: string; name: string }
  supervisor: { id: string; email: string; name: string }
  viewer: { id: string; email: string; name: string }
  admin: { id: string; email: string; name: string }
}

type ScenarioSummary = {
  scenario: string
  referenceId: string
  handoverDate: string
  shift: Shift
  preparedBy: string
  note: string
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

function addHours(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000)
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10)
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null
}

function taggedText(scenario: string, text: string) {
  return `${UAT_TAG}[${scenario}] ${text}`
}

function optionalString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function requiredString(value: unknown) {
  return typeof value === 'string' ? value : String(value ?? '')
}

function buildHandoverCreatedAudit(
  handover: SeededHandover,
  userId: string
): Prisma.AuditLogCreateManyInput {
  return {
    handoverId: handover.id,
    userId,
    action: AuditAction.CREATED,
    targetModel: 'Handover',
    targetId: handover.id,
    newValue: {
      seedTag: UAT_TAG,
      referenceId: handover.referenceId,
      handoverDate: formatDateOnly(handover.handoverDate),
      shift: handover.shift,
      overallPriority: handover.overallPriority,
      overallStatus: handover.overallStatus,
      isCarriedForward: handover.isCarriedForward,
    },
  }
}

function buildItemSnapshot(
  modelName: CategoryConfig['modelName'],
  item: CategoryItem
): Prisma.InputJsonObject {
  const commonFields = {
    status: item.status,
    priority: item.priority,
    ownerId: item.ownerId,
    dueTime: toIso(item.dueTime),
    resolvedAt: toIso(item.resolvedAt),
    remarks: optionalString(item.remarks),
  }

  switch (modelName) {
    case 'AircraftItem':
      return {
        ...commonFields,
        registration: requiredString(item.registration),
        type: optionalString(item.type),
        issue: requiredString(item.issue),
        flightsAffected: optionalString(item.flightsAffected),
      }
    case 'AirportItem':
      return {
        ...commonFields,
        airport: requiredString(item.airport),
        issue: requiredString(item.issue),
        flightsAffected: optionalString(item.flightsAffected),
      }
    case 'FlightScheduleItem':
      return {
        ...commonFields,
        flightNumber: requiredString(item.flightNumber),
        route: optionalString(item.route),
        issue: requiredString(item.issue),
      }
    case 'CrewItem':
      return {
        ...commonFields,
        crewId: optionalString(item.crewId),
        crewName: optionalString(item.crewName),
        role: optionalString(item.role),
        issue: requiredString(item.issue),
        flightsAffected: optionalString(item.flightsAffected),
      }
    case 'WeatherItem':
      return {
        ...commonFields,
        affectedArea: requiredString(item.affectedArea),
        weatherType: requiredString(item.weatherType),
        issue: requiredString(item.issue),
        flightsAffected: optionalString(item.flightsAffected),
      }
    case 'SystemItem':
      return {
        ...commonFields,
        systemName: requiredString(item.systemName),
        issue: requiredString(item.issue),
      }
    case 'AbnormalEvent':
      return {
        ...commonFields,
        eventType: requiredString(item.eventType),
        description: requiredString(item.description),
        flightsAffected: optionalString(item.flightsAffected),
        notificationRef: optionalString(item.notificationRef),
      }
  }
}

function buildItemCreatedAudits(
  handover: SeededHandover,
  userId: string
): Prisma.AuditLogCreateManyInput[] {
  const logs: Prisma.AuditLogCreateManyInput[] = []

  for (const config of CATEGORY_AUDIT_CONFIG) {
    const items = handover[config.relation] as CategoryItem[]

    for (const item of items) {
      logs.push({
        handoverId: handover.id,
        userId,
        action: AuditAction.CREATED,
        targetModel: config.modelName,
        targetId: item.id,
        newValue: {
          seedTag: UAT_TAG,
          ...buildItemSnapshot(config.modelName, item),
        },
      })
    }
  }

  return logs
}

function buildCarryForwardAudit(
  handoverId: string,
  userId: string,
  modelName: CategoryConfig['modelName'],
  targetId: string,
  sourceScenario: string,
  item: CategoryItem
): Prisma.AuditLogCreateManyInput {
  return {
    handoverId,
    userId,
    action: AuditAction.CARRIED_FORWARD,
    targetModel: modelName,
    targetId,
    oldValue: {
      seedTag: UAT_TAG,
      sourceScenario,
    },
    newValue: buildItemSnapshot(modelName, item),
  }
}

async function createScenarioHandover(
  tx: Prisma.TransactionClient,
  userId: string,
  data: Prisma.HandoverCreateInput
) {
  const handover = await tx.handover.create({
    data,
    include: HANDOVER_WITH_ITEMS_INCLUDE,
  })

  const logs = [
    buildHandoverCreatedAudit(handover, userId),
    ...buildItemCreatedAudits(handover, userId),
  ]

  await tx.auditLog.createMany({ data: logs })

  return handover
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

async function archiveExistingUatScenarios(userId: string) {
  const existingHandovers = await prisma.handover.findMany({
    where: {
      deletedAt: null,
      OR: [
        { generalRemarks: { contains: UAT_TAG } },
        { nextShiftActions: { contains: UAT_TAG } },
      ],
    },
    include: UAT_HANDOVER_ID_INCLUDE,
  })

  if (existingHandovers.length === 0) {
    return 0
  }

  const deletedAt = new Date()

  await prisma.$transaction(async (tx) => {
    const auditLogs: Prisma.AuditLogCreateManyInput[] = []

    for (const handover of existingHandovers) {
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
              seedTag: UAT_TAG,
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
          seedTag: UAT_TAG,
          deletedAt: deletedAt.toISOString(),
          referenceId: handover.referenceId,
        },
      })
    }

    await tx.auditLog.createMany({ data: auditLogs })
  }, INTERACTIVE_TRANSACTION_OPTIONS)

  return existingHandovers.length
}

async function allocateReferenceIds(count: number) {
  const year = new Date().getUTCFullYear()
  const result = await prisma.$queryRaw<Array<{ value: bigint | number }>>`
    WITH sequence_state AS (
      SELECT
        COALESCE(MAX(CAST(RIGHT("referenceId", 6) AS BIGINT)), 0) AS max_suffix,
        (SELECT last_value FROM handover_reference_seq) AS current_last_value,
        (SELECT is_called FROM handover_reference_seq) AS sequence_was_called
      FROM "Handover"
    ),
    sync_sequence AS (
      SELECT CASE
        WHEN GREATEST(
          max_suffix,
          CASE WHEN sequence_was_called THEN current_last_value ELSE 0 END
        ) > 0
        THEN setval(
          'handover_reference_seq',
          GREATEST(
            max_suffix,
            CASE WHEN sequence_was_called THEN current_last_value ELSE 0 END
          ),
          true
        )
        ELSE 0
      END AS synced_value
      FROM sequence_state
    )
    SELECT nextval('handover_reference_seq') AS value
    FROM sync_sequence, generate_series(1, ${count})
  `

  return result.map((row) => {
    const suffix = row.value.toString().padStart(6, '0')
    return `HDO-${year}-${suffix}`
  })
}

async function upsertUatUsers(): Promise<UatUsers> {
  const passwordHash = await bcrypt.hash(UAT_PASSWORD, 10)

  const [staff, supervisor, viewer, admin] = await Promise.all([
    prisma.user.upsert({
      where: { email: 'staff@occ.test' },
      update: {
        name: 'UAT OCC Staff',
        passwordHash,
        role: UserRole.OCC_STAFF,
        isActive: true,
      },
      create: {
        email: 'staff@occ.test',
        name: 'UAT OCC Staff',
        passwordHash,
        role: UserRole.OCC_STAFF,
      },
      select: {
        id: true,
        email: true,
        name: true,
      },
    }),
    prisma.user.upsert({
      where: { email: 'supervisor@occ.test' },
      update: {
        name: 'UAT Shift Supervisor',
        passwordHash,
        role: UserRole.SUPERVISOR,
        isActive: true,
      },
      create: {
        email: 'supervisor@occ.test',
        name: 'UAT Shift Supervisor',
        passwordHash,
        role: UserRole.SUPERVISOR,
      },
      select: {
        id: true,
        email: true,
        name: true,
      },
    }),
    prisma.user.upsert({
      where: { email: 'viewer@occ.test' },
      update: {
        name: 'UAT Management Viewer',
        passwordHash,
        role: UserRole.MANAGEMENT_VIEWER,
        isActive: true,
      },
      create: {
        email: 'viewer@occ.test',
        name: 'UAT Management Viewer',
        passwordHash,
        role: UserRole.MANAGEMENT_VIEWER,
      },
      select: {
        id: true,
        email: true,
        name: true,
      },
    }),
    prisma.user.upsert({
      where: { email: 'admin@occ.test' },
      update: {
        name: 'UAT System Admin',
        passwordHash,
        role: UserRole.ADMIN,
        isActive: true,
      },
      create: {
        email: 'admin@occ.test',
        name: 'UAT System Admin',
        passwordHash,
        role: UserRole.ADMIN,
      },
      select: {
        id: true,
        email: true,
        name: true,
      },
    }),
  ])

  return {
    staff,
    supervisor,
    viewer,
    admin,
  }
}

async function main() {
  const users = await upsertUatUsers()
  const archivedCount = await archiveExistingUatScenarios(users.admin.id)
  const [scenario1Ref, scenario2Ref, scenario3Ref, scenario4Ref, scenario5Ref] =
    await allocateReferenceIds(5)

  const today = toDateOnly(new Date())
  const yesterday = addUtcDays(today, -1)
  const twoDaysAgo = addUtcDays(today, -2)

  const scenarioSummaries = await prisma.$transaction(async (tx) => {
    const summaries: ScenarioSummary[] = []

    const scenario1 = await createScenarioHandover(tx, users.staff.id, {
      referenceId: scenario1Ref,
      handoverDate: today,
      shift: Shift.Morning,
      preparedBy: { connect: { id: users.staff.id } },
      handedTo: { connect: { id: users.supervisor.id } },
      overallPriority: Priority.Critical,
      overallStatus: ItemStatus.Open,
      generalRemarks: taggedText(
        'SCENARIO 1',
        'AOG morning handover ready for supervisor acknowledgment and live carry-forward testing.'
      ),
      nextShiftActions: taggedText(
        'SCENARIO 1',
        'Create the Night handover in the app to verify automatic carry-forward from this Morning shift.'
      ),
      aircraftItems: {
        create: [
          {
            registration: '9M-MXA',
            type: 'A320',
            issue: 'Aircraft grounded with hydraulic leak at gate C12. Engineering release is still pending.',
            status: ItemStatus.Open,
            priority: Priority.Critical,
            flightsAffected: 'AXA001, AXA002, AXA003',
            ownerId: users.supervisor.id,
            dueTime: addHours(4),
            remarks: 'UAT AOG seed item for carry-forward testing.',
          },
        ],
      },
      abnormalEvents: {
        create: [
          {
            eventType: 'AOG',
            description:
              'AOG escalation opened for 9M-MXA. OCC must coordinate engineering, customer recovery, and rotation impact decisions.',
            flightsAffected: 'AXA001, AXA002, AXA003',
            notificationRef: 'UAT-AOG-001',
            status: ItemStatus.Open,
            priority: Priority.Critical,
            ownerId: users.supervisor.id,
            dueTime: addHours(6),
          },
        ],
      },
    })

    summaries.push({
      scenario: 'Scenario 1 - AOG Aircraft',
      referenceId: scenario1.referenceId,
      handoverDate: formatDateOnly(scenario1.handoverDate),
      shift: scenario1.shift,
      preparedBy: users.staff.email,
      note: 'Morning shift today; keep today Night open for live carry-forward creation.',
    })

    const scenario2 = await createScenarioHandover(tx, users.staff.id, {
      referenceId: scenario2Ref,
      handoverDate: yesterday,
      shift: Shift.Night,
      preparedBy: { connect: { id: users.staff.id } },
      handedTo: { connect: { id: users.supervisor.id } },
      overallPriority: Priority.High,
      overallStatus: ItemStatus.Open,
      isCarriedForward: true,
      generalRemarks: taggedText(
        'SCENARIO 2',
        'Weather disruption chain seeded as an unacknowledged carried-forward handover.'
      ),
      nextShiftActions: taggedText(
        'SCENARIO 2',
        'Use this handover to verify carried-forward badges and the acknowledgment flow in the UI.'
      ),
      weatherItems: {
        create: [
          {
            affectedArea: 'WMKK',
            weatherType: 'Thunderstorm',
            issue: 'Convective build-up over final approach is causing flow control and runway spacing pressure.',
            status: ItemStatus.Monitoring,
            priority: Priority.High,
            flightsAffected: 'AXA100-AXA120',
            ownerId: users.supervisor.id,
            dueTime: addHours(3),
            remarks: 'Seeded as a carried-forward monitoring item.',
          },
        ],
      },
      flightScheduleItems: {
        create: [
          {
            flightNumber: 'AXA100-AXA120',
            route: 'KUL domestic bank',
            issue: 'Average departure delay is holding around 45 minutes while weather sequencing remains active.',
            status: ItemStatus.Open,
            priority: Priority.Normal,
            ownerId: users.staff.id,
            dueTime: addHours(5),
            remarks: 'Delay chain created for UAT acknowledgment scenario.',
          },
        ],
      },
    })

    await tx.auditLog.createMany({
      data: [
        buildCarryForwardAudit(
          scenario2.id,
          users.staff.id,
          'WeatherItem',
          scenario2.weatherItems[0]!.id,
          'Previous operational day weather watch',
          scenario2.weatherItems[0]!
        ),
        buildCarryForwardAudit(
          scenario2.id,
          users.staff.id,
          'FlightScheduleItem',
          scenario2.flightScheduleItems[0]!.id,
          'Previous operational day weather watch',
          scenario2.flightScheduleItems[0]!
        ),
      ],
    })

    summaries.push({
      scenario: 'Scenario 2 - Weather Disruption Chain',
      referenceId: scenario2.referenceId,
      handoverDate: formatDateOnly(scenario2.handoverDate),
      shift: scenario2.shift,
      preparedBy: users.staff.email,
      note: 'Night shift yesterday; unacknowledged High priority handover with carried-forward item badges.',
    })

    // Keep today Night available so Scenario 1 can create it live via the app.
    const scenario3 = await createScenarioHandover(tx, users.admin.id, {
      referenceId: scenario3Ref,
      handoverDate: twoDaysAgo,
      shift: Shift.Night,
      preparedBy: { connect: { id: users.admin.id } },
      handedTo: { connect: { id: users.supervisor.id } },
      overallPriority: Priority.Critical,
      overallStatus: ItemStatus.Open,
      generalRemarks: taggedText(
        'SCENARIO 3',
        'Crew positioning issue with two visible crew items and valid ownership already assigned.'
      ),
      nextShiftActions: taggedText(
        'SCENARIO 3',
        'Use the New Handover form to confirm Critical open crew items cannot be submitted without an owner.'
      ),
      crewItems: {
        create: [
          {
            crewId: 'CAPT-1138',
            crewName: 'Captain Iskandar',
            role: 'Captain',
            issue: 'Captain missing for KUL-PMI route after positioning sector cancellation.',
            status: ItemStatus.Open,
            priority: Priority.Critical,
            flightsAffected: 'AXA310',
            ownerId: users.supervisor.id,
            dueTime: addHours(8),
            remarks: 'Seeded with owner to keep the existing scenario valid while UAT testers retry the validation in-form.',
          },
          {
            crewId: 'CCM-2201',
            crewName: 'Cabin Crew Pool B',
            role: 'Cabin Crew',
            issue: 'Cabin crew short for AXA200 pending standby confirmation.',
            status: ItemStatus.Monitoring,
            priority: Priority.High,
            ownerId: users.staff.id,
            dueTime: addHours(10),
            remarks: 'Second crew item for visibility and filter testing.',
          },
        ],
      },
    })

    summaries.push({
      scenario: 'Scenario 3 - Crew Positioning Issue',
      referenceId: scenario3.referenceId,
      handoverDate: formatDateOnly(scenario3.handoverDate),
      shift: scenario3.shift,
      preparedBy: users.admin.email,
      note: 'Placed two operational days ago so today Night remains free for Scenario 1 carry-forward testing.',
    })

    const scenario4 = await createScenarioHandover(tx, users.supervisor.id, {
      referenceId: scenario4Ref,
      handoverDate: yesterday,
      shift: Shift.Morning,
      preparedBy: { connect: { id: users.supervisor.id } },
      handedTo: { connect: { id: users.viewer.id } },
      overallPriority: Priority.Normal,
      overallStatus: ItemStatus.Resolved,
      generalRemarks: taggedText(
        'SCENARIO 4',
        'Resolved system degradation that should remain in the handover log but not on active dashboard widgets.'
      ),
      nextShiftActions: taggedText(
        'SCENARIO 4',
        'Verify the record is visible in the log and excluded from active-item dashboard counts.'
      ),
      systemItems: {
        create: [
          {
            systemName: 'ACARS',
            issue: 'ACARS messaging was degraded for two hours due to gateway instability.',
            status: ItemStatus.Resolved,
            priority: Priority.Normal,
            ownerId: users.staff.id,
            remarks: 'Recovered after vendor failover.',
            resolvedAt: addHours(-12),
          },
        ],
      },
    })

    summaries.push({
      scenario: 'Scenario 4 - System Degradation',
      referenceId: scenario4.referenceId,
      handoverDate: formatDateOnly(scenario4.handoverDate),
      shift: scenario4.shift,
      preparedBy: users.supervisor.email,
      note: 'Resolved Morning handover for log-only verification.',
    })

    const scenario5 = await createScenarioHandover(tx, users.staff.id, {
      referenceId: scenario5Ref,
      handoverDate: twoDaysAgo,
      shift: Shift.Night,
      preparedBy: { connect: { id: users.staff.id } },
      handedTo: { connect: { id: users.viewer.id } },
      overallPriority: Priority.Low,
      overallStatus: ItemStatus.Monitoring,
      generalRemarks: taggedText(
        'SCENARIO 5',
        'Normal low-priority shift across multiple categories with no amber or red escalation states.'
      ),
      nextShiftActions: taggedText(
        'SCENARIO 5',
        'Use this handover to confirm standard presentation without High or Critical highlighting.'
      ),
      airportItems: {
        create: [
          {
            airport: 'WSSS',
            issue: 'Bay swap coordination for a routine turnaround remains in progress.',
            status: ItemStatus.Monitoring,
            priority: Priority.Low,
            ownerId: users.staff.id,
            remarks: 'Normal operations sample item.',
          },
        ],
      },
      weatherItems: {
        create: [
          {
            affectedArea: 'WMKJ',
            weatherType: 'Light rain',
            issue: 'Light rain observed with no operational restriction expected.',
            status: ItemStatus.Monitoring,
            priority: Priority.Low,
            ownerId: users.staff.id,
            remarks: 'Low-priority weather watch for normal shift display.',
          },
        ],
      },
      systemItems: {
        create: [
          {
            systemName: 'Crew Portal',
            issue: 'Brief sync delay reported after password reset queue.',
            status: ItemStatus.Open,
            priority: Priority.Low,
            ownerId: users.staff.id,
            dueTime: addHours(12),
            remarks: 'Low-priority system note for steady-state UAT checks.',
          },
        ],
      },
    })

    summaries.push({
      scenario: 'Scenario 5 - Multi-category Normal Shift',
      referenceId: scenario5.referenceId,
      handoverDate: formatDateOnly(scenario5.handoverDate),
      shift: scenario5.shift,
      preparedBy: users.staff.email,
      note: 'Low-priority handover across three categories for baseline UI checks.',
    })

    return summaries
  }, INTERACTIVE_TRANSACTION_OPTIONS)

  console.log(`Archived ${archivedCount} previous active UAT handover(s).`)
  console.log(`UAT users refreshed. Default password: ${UAT_PASSWORD}`)
  console.table([
    {
      email: users.staff.email,
      role: UserRole.OCC_STAFF,
      name: users.staff.name,
    },
    {
      email: users.supervisor.email,
      role: UserRole.SUPERVISOR,
      name: users.supervisor.name,
    },
    {
      email: users.viewer.email,
      role: UserRole.MANAGEMENT_VIEWER,
      name: users.viewer.name,
    },
    {
      email: users.admin.email,
      role: UserRole.ADMIN,
      name: users.admin.name,
    },
  ])
  console.table(scenarioSummaries)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
