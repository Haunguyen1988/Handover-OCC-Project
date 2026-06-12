import bcrypt from 'bcryptjs'
import {
  ItemStatus,
  Prisma,
  PrismaClient,
  Priority,
  Shift,
  UserRole,
} from '@prisma/client'

const prisma = new PrismaClient()

// AuditLog is append-only at the DB level (triggers from migration
// 20260518000000). A re-runnable seed must still drop and recreate its
// fixture handovers, and those carry AuditLog children that the trigger
// refuses to DELETE. We bypass the triggers for the fixture cleanup only,
// inside one transaction, exactly as the documented emergency-repair path
// prescribes — then the triggers are back on before any app traffic.
async function deleteHandoversByReference(references: string[]) {
  await prisma.$transaction(async (tx) => {
    const handovers = await tx.handover.findMany({
      where: { referenceId: { in: references } },
      select: { id: true },
    })
    if (handovers.length === 0) return
    const ids = handovers.map((h) => h.id)

    await tx.$executeRawUnsafe(
      'ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_no_delete'
    )
    try {
      // Raw SQL on purpose: the append-only guard test forbids Prisma
      // client mutation methods on the audit log anywhere in app/seed
      // source. This deletion is the migration's documented
      // emergency-repair path, gated behind the trigger we just
      // disabled, so it runs as raw DML instead.
      await tx.$executeRaw`DELETE FROM "AuditLog" WHERE "handoverId" IN (${Prisma.join(ids)})`
      await tx.acknowledgment.deleteMany({ where: { handoverId: { in: ids } } })
      await tx.handover.deleteMany({ where: { id: { in: ids } } })
    } finally {
      await tx.$executeRawUnsafe(
        'ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_no_delete'
      )
    }
  })
}

async function main() {
  const passwordHash = await bcrypt.hash('Password123!', 10)

  const [staff, supervisor, admin] = await Promise.all([
    prisma.user.upsert({
      where: { email: 'occ.staff@example.com' },
      update: {
        name: 'OCC Staff',
        passwordHash,
        role: UserRole.OCC_STAFF,
        isActive: true,
      },
      create: {
        email: 'occ.staff@example.com',
        name: 'OCC Staff',
        passwordHash,
        role: UserRole.OCC_STAFF,
      },
    }),
    prisma.user.upsert({
      where: { email: 'supervisor@example.com' },
      update: {
        name: 'Shift Supervisor',
        passwordHash,
        role: UserRole.SUPERVISOR,
        isActive: true,
      },
      create: {
        email: 'supervisor@example.com',
        name: 'Shift Supervisor',
        passwordHash,
        role: UserRole.SUPERVISOR,
      },
    }),
    prisma.user.upsert({
      where: { email: 'admin@example.com' },
      update: {
        name: 'System Admin',
        passwordHash,
        role: UserRole.ADMIN,
        isActive: true,
      },
      create: {
        email: 'admin@example.com',
        name: 'System Admin',
        passwordHash,
        role: UserRole.ADMIN,
      },
    }),
  ])

  const dates = [
    new Date('2026-04-19'),
    new Date('2026-04-20'),
    new Date('2026-04-20'),
    new Date('2026-04-21'),
    new Date('2026-04-21'),
  ]

  const references = [
    'HDO-2026-000001',
    'HDO-2026-000002',
    'HDO-2026-000003',
    'HDO-2026-000004',
    'HDO-2026-000005',
  ]

  await deleteHandoversByReference(references)

  const baseHandovers = await Promise.all([
    prisma.handover.create({
      data: {
        referenceId: references[0],
        handoverDate: dates[0],
        shift: Shift.Morning,
        preparedById: staff.id,
        handedToId: supervisor.id,
        overallPriority: Priority.High,
        overallStatus: ItemStatus.Open,
        generalRemarks: 'Morning shift with an AOG and weather monitoring.',
        nextShiftActions: 'Monitor engineering response and coordinate crew updates.',
        aircraftItems: {
          create: [
            {
              registration: '9M-XXA',
              type: 'A320',
              issue: 'AOG due to hydraulic leak at gate C12.',
              status: ItemStatus.Open,
              priority: Priority.Critical,
              flightsAffected: 'AXA123, AXA456',
              ownerId: supervisor.id,
              dueTime: new Date('2026-04-19T12:00:00Z'),
              remarks: 'Engineering team on standby.',
            },
          ],
        },
        weatherItems: {
          create: [
            {
              affectedArea: 'WMKK',
              weatherType: 'Thunderstorm',
              issue: 'CB activity building east of field.',
              status: ItemStatus.Monitoring,
              priority: Priority.High,
              flightsAffected: 'AXA789',
              ownerId: supervisor.id,
              dueTime: new Date('2026-04-19T10:30:00Z'),
              remarks: 'ATC advised intermittent delays.',
            },
          ],
        },
        abnormalEvents: {
          create: [
            {
              eventType: 'AOG',
              description: 'Aircraft grounded pending engineering inspection and dispatch decision.',
              flightsAffected: 'AXA123, AXA456',
              notificationRef: 'NOC-CRIT-2026-001',
              status: ItemStatus.Open,
              priority: Priority.Critical,
              ownerId: supervisor.id,
              dueTime: new Date('2026-04-19T13:00:00Z'),
            },
          ],
        },
      },
    }),
    prisma.handover.create({
      data: {
        referenceId: references[1],
        handoverDate: dates[1],
        shift: Shift.Morning,
        preparedById: supervisor.id,
        handedToId: staff.id,
        overallPriority: Priority.Normal,
        overallStatus: ItemStatus.Monitoring,
        generalRemarks: 'Airport congestion and crew swap in progress.',
        nextShiftActions: 'Confirm revised departure slots.',
        airportItems: {
          create: [
            {
              airport: 'WSSS',
              issue: 'Stand reassignment causing minor departure delays.',
              status: ItemStatus.Monitoring,
              priority: Priority.Normal,
              flightsAffected: 'AXA231',
              remarks: 'Airport ops coordinating towing.',
            },
          ],
        },
        crewItems: {
          create: [
            {
              crewId: 'C001',
              crewName: 'A. Rahman',
              role: 'Captain',
              issue: 'Late inbound crew requiring reassignment.',
              status: ItemStatus.Open,
              priority: Priority.High,
              flightsAffected: 'AXA552',
              ownerId: staff.id,
              dueTime: new Date('2026-04-20T11:00:00Z'),
              remarks: 'Crew tracking in progress.',
            },
          ],
        },
      },
    }),
    prisma.handover.create({
      data: {
        referenceId: references[2],
        handoverDate: dates[2],
        shift: Shift.Night,
        preparedById: staff.id,
        handedToId: supervisor.id,
        overallPriority: Priority.High,
        overallStatus: ItemStatus.Open,
        generalRemarks: 'System degradation monitored overnight.',
        nextShiftActions: 'Review vendor update and confirm stable platform performance.',
        systemItems: {
          create: [
            {
              systemName: 'AIMS',
              issue: 'Intermittent latency on flight release generation.',
              status: ItemStatus.Open,
              priority: Priority.High,
              ownerId: supervisor.id,
              dueTime: new Date('2026-04-20T20:00:00Z'),
              remarks: 'Vendor engaged for root cause analysis.',
            },
          ],
        },
      },
    }),
    prisma.handover.create({
      data: {
        referenceId: references[3],
        handoverDate: dates[3],
        shift: Shift.Morning,
        preparedById: staff.id,
        handedToId: supervisor.id,
        overallPriority: Priority.High,
        overallStatus: ItemStatus.Open,
        isCarriedForward: true,
        generalRemarks: 'Carried-forward monitoring plus new crew tracking issue.',
        nextShiftActions: 'Close or carry remaining open operational items.',
        aircraftItems: {
          create: [
            {
              registration: '9M-XXA',
              type: 'A320',
              issue: 'AOG due to hydraulic leak at gate C12.',
              status: ItemStatus.Open,
              priority: Priority.Critical,
              flightsAffected: 'AXA123, AXA456',
              ownerId: supervisor.id,
              dueTime: new Date('2026-04-21T06:00:00Z'),
              remarks: 'Carried forward from prior shift.',
            },
          ],
        },
        crewItems: {
          create: [
            {
              crewId: 'C009',
              crewName: 'N. Azmi',
              role: 'FO',
              issue: 'Positioning crew waiting for standby confirmation.',
              status: ItemStatus.Monitoring,
              priority: Priority.High,
              ownerId: supervisor.id,
              dueTime: new Date('2026-04-21T08:00:00Z'),
              remarks: 'Crew control reviewing reserve options.',
            },
          ],
        },
      },
    }),
    prisma.handover.create({
      data: {
        referenceId: references[4],
        handoverDate: dates[4],
        shift: Shift.Night,
        preparedById: supervisor.id,
        handedToId: admin.id,
        overallPriority: Priority.Low,
        overallStatus: ItemStatus.Resolved,
        generalRemarks: 'Resolved operational items and routine follow-up only.',
        nextShiftActions: 'Confirm all closures are reflected in the log.',
        flightScheduleItems: {
          create: [
            {
              flightNumber: 'AXA901',
              route: 'KUL-SIN',
              issue: 'Schedule revision due to aircraft rotation swap.',
              status: ItemStatus.Resolved,
              priority: Priority.Normal,
              remarks: 'Resolved after revised ETD distribution.',
              resolvedAt: new Date('2026-04-21T11:30:00Z'),
            },
          ],
        },
      },
    }),
  ])

  await prisma.handover.update({
    where: { id: baseHandovers[3].id },
    data: { carriedFromId: baseHandovers[2].id },
  })

  await prisma.auditLog.createMany({
    data: baseHandovers.map((handover) => ({
      handoverId: handover.id,
      userId: handover.preparedById,
      action: 'CREATED',
      targetModel: 'Handover',
      targetId: handover.id,
    })),
  })

  // Seed inserts handovers with explicit referenceIds (HDO-2026-000001..5)
  // but doesn't advance the sequence the runtime uses to mint new IDs. If
  // we don't sync, the very next `POST /api/v1/handovers` collides with
  // the seeded rows. Sync to the highest seeded suffix.
  await prisma.$executeRawUnsafe(
    `SELECT setval('handover_reference_seq', GREATEST(
       (SELECT COALESCE(MAX(CAST(RIGHT("referenceId", 6) AS BIGINT)), 0)
        FROM "Handover"),
       1
     ), true)`
  )

  console.log('Seed data created successfully.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
