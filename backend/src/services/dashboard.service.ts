import { ItemStatus, Prisma, Priority, Shift, UserRole } from '@prisma/client'

import { prisma } from '../lib/prisma'
import type { AuthenticatedUser } from '../middleware/auth.middleware'
import {
  classifyAckAlert,
  DEFAULT_ACK_ALERT_THRESHOLDS,
  type AckAlertSeverity,
  type AckAlertThresholds,
} from './ackAlert.service'

type TodayItemMetricsRow = {
  openItems: number | bigint
  monitoringItems: number | bigint
  resolvedItems: number | bigint
  criticalItems: number | bigint
}

type HandoverDashboardCountsRow = {
  totalHandovers: number | bigint
  unacknowledgedHighPriority: number | bigint
  carriedForwardCount: number | bigint
  staleUnackedCriticalCount: number | bigint
  oldestUnackedCriticalMinutes: number | bigint
  staleUnackedHighCount: number | bigint
  oldestUnackedHighMinutes: number | bigint
}

type DashboardAggregateRow = TodayItemMetricsRow & HandoverDashboardCountsRow & {
  trendRows: unknown
  priorityHeatmapRows: unknown
  unresolvedByCategoryRows: unknown
  shiftComparisonRows: unknown
  openByCategoryRows: unknown
  byPriorityRows: unknown
  byShiftRows: unknown
  abnormalEventsByTypeRows: unknown
  flightsAffected: number | bigint
  overdueItems: number | bigint
  itemsDueInNext2Hours: number | bigint
}

type TrendPayloadRow = {
  handoverDate: Date | string
  open: number | bigint
  resolved: number | bigint
}

type PriorityHeatmapPayloadRow = {
  handoverDate: Date | string
  unresolvedCount: number | bigint
  criticalCount: number | bigint
}

type UnresolvedByCategoryPayloadRow = {
  category: string
  openCount: number | bigint
  monitoringCount: number | bigint
  oldestOpenDate: Date | string | null
}

type ShiftComparisonPayloadRow = {
  handoverDate: Date | string
  shift: Shift | string
  openCount: number | bigint
}

type OpenByCategoryPayloadRow = {
  category: string
  openCount: number | bigint
}

type PriorityCountRow = {
  priority: Priority | string
  count: number | bigint
}

type ShiftCountRow = {
  shift: Shift | string
  count: number | bigint
}

type AbnormalEventTypeCountRow = {
  eventType: string
  count: number | bigint
}

const ITEM_TABLE_CONFIG = [
  { tableName: 'AircraftItem', alias: 'aircraftItem', categoryKey: 'aircraft' },
  { tableName: 'AirportItem', alias: 'airportItem', categoryKey: 'airport' },
  {
    tableName: 'FlightScheduleItem',
    alias: 'flightScheduleItem',
    categoryKey: 'flightSchedule',
  },
  { tableName: 'CrewItem', alias: 'crewItem', categoryKey: 'crew' },
  { tableName: 'WeatherItem', alias: 'weatherItem', categoryKey: 'weather' },
  { tableName: 'SystemItem', alias: 'systemItem', categoryKey: 'system' },
  {
    tableName: 'AbnormalEvent',
    alias: 'abnormalEvent',
    categoryKey: 'abnormalEvents',
  },
] as const

type ItemTableConfig = (typeof ITEM_TABLE_CONFIG)[number]
type DashboardCategoryKey = ItemTableConfig['categoryKey']

function sqlItemStatus(status: ItemStatus) {
  return Prisma.sql`CAST(${status} AS "ItemStatus")`
}

function sqlPriority(priority: Priority) {
  return Prisma.sql`CAST(${priority} AS "Priority")`
}

function toDateOnly(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

function addUtcDays(value: Date, days: number) {
  const nextDate = new Date(value)
  nextDate.setUTCDate(nextDate.getUTCDate() + days)

  return nextDate
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10)
}

function toCount(value: number | bigint | null | undefined) {
  return Number(value ?? 0)
}

const ACK_ALERT_SEVERITY_RANK: Record<AckAlertSeverity, number> = {
  none: 0,
  warn: 1,
  breach: 2,
}

/**
 * Roll the per-priority stale-unacked counts into a single alert summary.
 *
 * Unlike `today.unacknowledgedHighPriority` (scoped to today), this counts
 * every still-open High/Critical handover regardless of date — a Critical
 * left unacknowledged across a shift boundary stays visible instead of
 * silently dropping off when the operational day rolls over. The `severity`
 * is the more urgent of the Critical and High classifications.
 */
function buildAckAlert(
  row: HandoverDashboardCountsRow | undefined,
  thresholds: AckAlertThresholds = DEFAULT_ACK_ALERT_THRESHOLDS
) {
  const criticalCount = toCount(row?.staleUnackedCriticalCount)
  const highCount = toCount(row?.staleUnackedHighCount)
  const oldestCriticalMinutes = toCount(row?.oldestUnackedCriticalMinutes)
  const oldestHighMinutes = toCount(row?.oldestUnackedHighMinutes)

  const criticalSeverity = criticalCount
    ? classifyAckAlert(Priority.Critical, oldestCriticalMinutes, thresholds)
    : 'none'
  const highSeverity = highCount
    ? classifyAckAlert(Priority.High, oldestHighMinutes, thresholds)
    : 'none'

  const severity: AckAlertSeverity =
    ACK_ALERT_SEVERITY_RANK[criticalSeverity] >=
    ACK_ALERT_SEVERITY_RANK[highSeverity]
      ? criticalSeverity
      : highSeverity

  return {
    severity,
    unackedCount: criticalCount + highCount,
    criticalCount,
    highCount,
    oldestUnackedMinutes: Math.max(oldestCriticalMinutes, oldestHighMinutes),
  }
}

function emptyAckAlert() {
  return {
    severity: 'none' as AckAlertSeverity,
    unackedCount: 0,
    criticalCount: 0,
    highCount: 0,
    oldestUnackedMinutes: 0,
  }
}

function toJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[]
  }

  if (typeof value === 'string') {
    return JSON.parse(value) as T[]
  }

  return []
}

function coerceDateValue(value: Date | string) {
  return value instanceof Date ? value : new Date(value)
}

function buildAccessibleTodayHandoverWhere(
  user: AuthenticatedUser,
  today: Date
): Prisma.HandoverWhereInput {
  return {
    deletedAt: null,
    handoverDate: today,
    ...(user.role === UserRole.OCC_STAFF ? { preparedById: user.id } : {}),
  }
}

function buildDashboardScopeSql(user: AuthenticatedUser) {
  if (user.role !== UserRole.OCC_STAFF) {
    return Prisma.empty
  }

  return Prisma.sql` AND h."preparedById" = ${user.id}`
}

function buildScopedItemSelectSql(
  config: ItemTableConfig,
  selectSql: Prisma.Sql,
  extraWhere: Prisma.Sql,
  user: AuthenticatedUser
) {
  const table = Prisma.raw(`"${config.tableName}"`)
  const tableAlias = Prisma.raw(config.alias)
  const handoverIdColumn = Prisma.raw(`${config.alias}."handoverId"`)
  const deletedAtColumn = Prisma.raw(`${config.alias}."deletedAt"`)
  const userScope = buildDashboardScopeSql(user)

  return Prisma.sql`
    SELECT
      ${selectSql}
    FROM ${table} ${tableAlias}
    INNER JOIN "Handover" h ON h.id = ${handoverIdColumn}
    WHERE ${deletedAtColumn} IS NULL
      AND h."deletedAt" IS NULL
      ${extraWhere}
      ${userScope}
  `
}

function buildScopedItemUnionSql(
  user: AuthenticatedUser,
  selectSqlBuilder: (config: ItemTableConfig) => Prisma.Sql,
  extraWhere: Prisma.Sql = Prisma.empty
) {
  return Prisma.join(
    ITEM_TABLE_CONFIG.map((config) =>
      buildScopedItemSelectSql(config, selectSqlBuilder(config), extraWhere, user)
    ),
    ' UNION ALL '
  )
}

function buildDashboardItemUnionSql(user: AuthenticatedUser) {
  return buildScopedItemUnionSql(
    user,
    (config) => {
      const statusColumn = Prisma.raw(`${config.alias}.status`)
      const priorityColumn = Prisma.raw(`${config.alias}.priority`)
      const dueTimeColumn = Prisma.raw(`${config.alias}."dueTime"`)

      return Prisma.sql`
        ${config.categoryKey} AS category,
        ${statusColumn} AS status,
        ${priorityColumn} AS priority,
        h."handoverDate" AS "handoverDate",
        h.shift AS shift,
        ${dueTimeColumn} AS "dueTime"
      `
    }
  )
}

async function getDashboardAggregates(
  user: AuthenticatedUser,
  today: Date,
  startDate: Date,
  now: Date
) {
  const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000)
  const handoverUserScope =
    user.role === UserRole.OCC_STAFF
      ? Prisma.sql` AND h."preparedById" = ${user.id}`
      : Prisma.empty
  const [row] = await prisma.$queryRaw<DashboardAggregateRow[]>(Prisma.sql`
    WITH items AS MATERIALIZED (
      ${buildDashboardItemUnionSql(user)}
    )
    SELECT
      (
        SELECT COUNT(*)::int
        FROM "Handover" h
        WHERE h."deletedAt" IS NULL
          AND h."handoverDate" = ${today}
          ${handoverUserScope}
      ) AS "totalHandovers",
      (
        SELECT COUNT(*)::int
        FROM "Handover" h
        WHERE h."deletedAt" IS NULL
          AND h."handoverDate" = ${today}
          AND h."overallPriority" IN (${sqlPriority(Priority.High)}, ${sqlPriority(Priority.Critical)})
          AND h."acknowledgedAt" IS NULL
          ${handoverUserScope}
      ) AS "unacknowledgedHighPriority",
      (
        SELECT COUNT(*)::int
        FROM "Handover" h
        WHERE h."deletedAt" IS NULL
          AND h."handoverDate" = ${today}
          AND h."isCarriedForward" = true
          ${handoverUserScope}
      ) AS "carriedForwardCount",
      (
        SELECT COUNT(*)::int
        FROM "Handover" h
        WHERE h."deletedAt" IS NULL
          AND h."overallPriority" = ${sqlPriority(Priority.Critical)}
          AND h."acknowledgedAt" IS NULL
          ${handoverUserScope}
      ) AS "staleUnackedCriticalCount",
      (
        SELECT COALESCE(
          FLOOR(EXTRACT(EPOCH FROM (${now}::timestamptz - MIN(h."createdAt"))) / 60)::int,
          0
        )
        FROM "Handover" h
        WHERE h."deletedAt" IS NULL
          AND h."overallPriority" = ${sqlPriority(Priority.Critical)}
          AND h."acknowledgedAt" IS NULL
          ${handoverUserScope}
      ) AS "oldestUnackedCriticalMinutes",
      (
        SELECT COUNT(*)::int
        FROM "Handover" h
        WHERE h."deletedAt" IS NULL
          AND h."overallPriority" = ${sqlPriority(Priority.High)}
          AND h."acknowledgedAt" IS NULL
          ${handoverUserScope}
      ) AS "staleUnackedHighCount",
      (
        SELECT COALESCE(
          FLOOR(EXTRACT(EPOCH FROM (${now}::timestamptz - MIN(h."createdAt"))) / 60)::int,
          0
        )
        FROM "Handover" h
        WHERE h."deletedAt" IS NULL
          AND h."overallPriority" = ${sqlPriority(Priority.High)}
          AND h."acknowledgedAt" IS NULL
          ${handoverUserScope}
      ) AS "oldestUnackedHighMinutes",
      COUNT(*) FILTER (
        WHERE items."handoverDate" = ${today}
          AND items.status = ${sqlItemStatus(ItemStatus.Open)}
      )::int AS "openItems",
      COUNT(*) FILTER (
        WHERE items."handoverDate" = ${today}
          AND items.status = ${sqlItemStatus(ItemStatus.Monitoring)}
      )::int AS "monitoringItems",
      COUNT(*) FILTER (
        WHERE items."handoverDate" = ${today}
          AND items.status = ${sqlItemStatus(ItemStatus.Resolved)}
      )::int AS "resolvedItems",
      COUNT(*) FILTER (
        WHERE items."handoverDate" = ${today}
          AND items.priority = ${sqlPriority(Priority.Critical)}
          AND items.status IN (${sqlItemStatus(ItemStatus.Open)}, ${sqlItemStatus(ItemStatus.Monitoring)})
      )::int AS "criticalItems",
      COUNT(*) FILTER (
        WHERE items."dueTime" IS NOT NULL
          AND items."dueTime" < ${now}
          AND items.status != ${sqlItemStatus(ItemStatus.Resolved)}
      )::int AS "overdueItems",
      COUNT(*) FILTER (
        WHERE items."dueTime" IS NOT NULL
          AND items."dueTime" >= ${now}
          AND items."dueTime" <= ${twoHoursLater}
          AND items.status != ${sqlItemStatus(ItemStatus.Resolved)}
      )::int AS "itemsDueInNext2Hours",
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'handoverDate', trend."handoverDate",
            'open', trend.open,
            'resolved', trend.resolved
          )
          ORDER BY trend."handoverDate"
        )
        FROM (
          SELECT
            items."handoverDate",
            COUNT(*) FILTER (WHERE items.status = ${sqlItemStatus(ItemStatus.Open)})::int AS open,
            COUNT(*) FILTER (WHERE items.status = ${sqlItemStatus(ItemStatus.Resolved)})::int AS resolved
          FROM items
          WHERE items."handoverDate" BETWEEN ${startDate} AND ${today}
          GROUP BY items."handoverDate"
        ) trend
      ), '[]'::jsonb) AS "trendRows",
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'handoverDate', heatmap."handoverDate",
            'unresolvedCount', heatmap."unresolvedCount",
            'criticalCount', heatmap."criticalCount"
          )
          ORDER BY heatmap."handoverDate"
        )
        FROM (
          SELECT
            items."handoverDate",
            COUNT(*) FILTER (
              WHERE items.status IN (${sqlItemStatus(ItemStatus.Open)}, ${sqlItemStatus(ItemStatus.Monitoring)})
            )::int AS "unresolvedCount",
            COUNT(*) FILTER (
              WHERE items.priority = ${sqlPriority(Priority.Critical)}
                AND items.status IN (${sqlItemStatus(ItemStatus.Open)}, ${sqlItemStatus(ItemStatus.Monitoring)})
            )::int AS "criticalCount"
          FROM items
          WHERE items."handoverDate" BETWEEN ${startDate} AND ${today}
          GROUP BY items."handoverDate"
        ) heatmap
      ), '[]'::jsonb) AS "priorityHeatmapRows",
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'category', unresolved.category,
            'openCount', unresolved."openCount",
            'monitoringCount', unresolved."monitoringCount",
            'oldestOpenDate', unresolved."oldestOpenDate"
          )
          ORDER BY unresolved.category
        )
        FROM (
          SELECT
            items.category,
            COUNT(*) FILTER (WHERE items.status = ${sqlItemStatus(ItemStatus.Open)})::int AS "openCount",
            COUNT(*) FILTER (WHERE items.status = ${sqlItemStatus(ItemStatus.Monitoring)})::int AS "monitoringCount",
            MIN(items."handoverDate") FILTER (
              WHERE items.status = ${sqlItemStatus(ItemStatus.Open)}
            ) AS "oldestOpenDate"
          FROM items
          WHERE items.status IN (${sqlItemStatus(ItemStatus.Open)}, ${sqlItemStatus(ItemStatus.Monitoring)})
          GROUP BY items.category
        ) unresolved
      ), '[]'::jsonb) AS "unresolvedByCategoryRows",
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'handoverDate', shift_counts."handoverDate",
            'shift', shift_counts.shift,
            'openCount', shift_counts."openCount"
          )
          ORDER BY shift_counts."handoverDate", shift_counts.shift
        )
        FROM (
          SELECT
            items."handoverDate",
            items.shift,
            COUNT(*) FILTER (WHERE items.status = ${sqlItemStatus(ItemStatus.Open)})::int AS "openCount"
          FROM items
          WHERE items."handoverDate" BETWEEN ${startDate} AND ${today}
          GROUP BY items."handoverDate", items.shift
        ) shift_counts
      ), '[]'::jsonb) AS "shiftComparisonRows",
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'category', open_category.category,
            'openCount', open_category."openCount"
          )
          ORDER BY open_category.category
        )
        FROM (
          SELECT
            items.category,
            COUNT(*) FILTER (WHERE items.status = ${sqlItemStatus(ItemStatus.Open)})::int AS "openCount"
          FROM items
          WHERE items."handoverDate" = ${today}
          GROUP BY items.category
        ) open_category
      ), '[]'::jsonb) AS "openByCategoryRows",
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'priority', priority_counts.priority,
            'count', priority_counts.count
          )
          ORDER BY priority_counts.priority
        )
        FROM (
          SELECT
            h."overallPriority"::text AS priority,
            COUNT(*)::int AS count
          FROM "Handover" h
          WHERE h."deletedAt" IS NULL
            AND h."handoverDate" = ${today}
            ${handoverUserScope}
          GROUP BY h."overallPriority"
        ) priority_counts
      ), '[]'::jsonb) AS "byPriorityRows",
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'shift', shift_counts.shift,
            'count', shift_counts.count
          )
          ORDER BY shift_counts.shift
        )
        FROM (
          SELECT
            h.shift::text AS shift,
            COUNT(*)::int AS count
          FROM "Handover" h
          WHERE h."deletedAt" IS NULL
            AND h."handoverDate" = ${today}
            ${handoverUserScope}
          GROUP BY h.shift
        ) shift_counts
      ), '[]'::jsonb) AS "byShiftRows",
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'eventType', abnormal_counts."eventType",
            'count', abnormal_counts.count
          )
          ORDER BY abnormal_counts."eventType"
        )
        FROM (
          SELECT
            ae."eventType" AS "eventType",
            COUNT(*)::int AS count
          FROM "AbnormalEvent" ae
          INNER JOIN "Handover" h ON h.id = ae."handoverId"
          WHERE ae."deletedAt" IS NULL
            AND h."deletedAt" IS NULL
            AND h."handoverDate" = ${today}
            AND ae.status IN (
              ${sqlItemStatus(ItemStatus.Open)},
              ${sqlItemStatus(ItemStatus.Monitoring)}
            )
            ${handoverUserScope}
          GROUP BY ae."eventType"
        ) abnormal_counts
      ), '[]'::jsonb) AS "abnormalEventsByTypeRows",
      (
        SELECT COUNT(DISTINCT TRIM(flights.flight_number))::int
        FROM (
          SELECT fsi."flightNumber" AS flight_number
          FROM "FlightScheduleItem" fsi
          INNER JOIN "Handover" h ON h.id = fsi."handoverId"
          WHERE fsi."deletedAt" IS NULL
            AND h."deletedAt" IS NULL
            AND h."handoverDate" = ${today}
            AND fsi.status IN (
              ${sqlItemStatus(ItemStatus.Open)},
              ${sqlItemStatus(ItemStatus.Monitoring)}
            )
            AND fsi."flightNumber" IS NOT NULL
            AND TRIM(fsi."flightNumber") <> ''
            ${handoverUserScope}
          UNION
          SELECT f.flight_number
          FROM "AbnormalEvent" ae
          INNER JOIN "Handover" h ON h.id = ae."handoverId"
          CROSS JOIN LATERAL UNNEST(
            string_to_array(COALESCE(ae."flightsAffected", ''), ',')
          ) AS f(flight_number)
          WHERE ae."deletedAt" IS NULL
            AND h."deletedAt" IS NULL
            AND h."handoverDate" = ${today}
            AND ae.status IN (
              ${sqlItemStatus(ItemStatus.Open)},
              ${sqlItemStatus(ItemStatus.Monitoring)}
            )
            AND TRIM(f.flight_number) <> ''
            ${handoverUserScope}
        ) flights
      ) AS "flightsAffected"
    FROM items
  `)

  const trendRows = toJsonArray<TrendPayloadRow>(row?.trendRows)
  const trendMap = new Map(
    trendRows.map((row) => [
      formatDateOnly(coerceDateValue(row.handoverDate)),
      {
        open: toCount(row.open),
        resolved: toCount(row.resolved),
      },
    ])
  )

  const priorityHeatmapRows = toJsonArray<PriorityHeatmapPayloadRow>(
    row?.priorityHeatmapRows
  )
  const heatmapMap = new Map(
    priorityHeatmapRows.map((row) => [
      formatDateOnly(coerceDateValue(row.handoverDate)),
      {
        unresolvedCount: toCount(row.unresolvedCount),
        criticalCount: toCount(row.criticalCount),
      },
    ])
  )

  const unresolvedRows = toJsonArray<UnresolvedByCategoryPayloadRow>(
    row?.unresolvedByCategoryRows
  )
  const unresolvedRowMap = new Map(unresolvedRows.map((row) => [row.category, row]))
  const unresolvedByCategory = ITEM_TABLE_CONFIG.map((config) => {
    const categoryRow = unresolvedRowMap.get(config.categoryKey)

    return {
      category: config.categoryKey as DashboardCategoryKey,
      openCount: toCount(categoryRow?.openCount),
      monitoringCount: toCount(categoryRow?.monitoringCount),
      oldestOpenDate: categoryRow?.oldestOpenDate
        ? formatDateOnly(coerceDateValue(categoryRow.oldestOpenDate))
        : null,
    }
  })

  const shiftRows = toJsonArray<ShiftComparisonPayloadRow>(row?.shiftComparisonRows)
  const comparisonMap = new Map<string, Partial<Record<Shift, number>>>()

  shiftRows.forEach((row) => {
    const dateKey = formatDateOnly(coerceDateValue(row.handoverDate))
    const shiftKey = row.shift as Shift
    const existing = comparisonMap.get(dateKey) ?? {}

    existing[shiftKey] = toCount(row.openCount)
    comparisonMap.set(dateKey, existing)
  })

  const openByCategoryRows = toJsonArray<OpenByCategoryPayloadRow>(
    row?.openByCategoryRows
  )
  const openByCategoryRowMap = new Map(
    openByCategoryRows.map((row) => [row.category, toCount(row.openCount)])
  )
  const openByCategory = Object.fromEntries(
    ITEM_TABLE_CONFIG.map((config) => [
      config.categoryKey,
      openByCategoryRowMap.get(config.categoryKey) ?? 0,
    ])
  ) as Record<DashboardCategoryKey, number>

  const byPriorityRows = toJsonArray<PriorityCountRow>(row?.byPriorityRows)
  const byPriority: Record<Priority, number> = {
    [Priority.Low]: 0,
    [Priority.Normal]: 0,
    [Priority.High]: 0,
    [Priority.Critical]: 0,
  }
  byPriorityRows.forEach((entry) => {
    const key = entry.priority as Priority
    if (key in byPriority) {
      byPriority[key] = toCount(entry.count)
    }
  })

  const byShiftRows = toJsonArray<ShiftCountRow>(row?.byShiftRows)
  const byShift: Record<Shift, number> = {
    [Shift.Morning]: 0,
    [Shift.Night]: 0,
  }
  byShiftRows.forEach((entry) => {
    const key = entry.shift as Shift
    if (key in byShift) {
      byShift[key] = toCount(entry.count)
    }
  })

  const abnormalEventsByTypeRows = toJsonArray<AbnormalEventTypeCountRow>(
    row?.abnormalEventsByTypeRows
  )
  const abnormalEventsByType: Record<string, number> = {}
  abnormalEventsByTypeRows.forEach((entry) => {
    if (entry.eventType) {
      abnormalEventsByType[entry.eventType] = toCount(entry.count)
    }
  })

  return {
    handoverCounts: {
      totalHandovers: toCount(row?.totalHandovers),
      unacknowledgedHighPriority: toCount(row?.unacknowledgedHighPriority),
      carriedForwardCount: toCount(row?.carriedForwardCount),
      ackAlert: buildAckAlert(row),
    },
    todayMetrics: {
      openItems: toCount(row?.openItems),
      monitoringItems: toCount(row?.monitoringItems),
      resolvedItems: toCount(row?.resolvedItems),
      criticalItems: toCount(row?.criticalItems),
      flightsAffected: toCount(row?.flightsAffected),
      byPriority,
      byShift,
      abnormalEventsByType,
    },
    trend7Days: Array.from({ length: 7 }, (_, index) => {
      const date = addUtcDays(startDate, index)
      const dateKey = formatDateOnly(date)
      const counts = trendMap.get(dateKey)

      return {
        date: dateKey,
        open: counts?.open ?? 0,
        resolved: counts?.resolved ?? 0,
      }
    }),
    priorityHeatmap7Days: Array.from({ length: 7 }, (_, index) => {
      const date = addUtcDays(startDate, index)
      const dateKey = formatDateOnly(date)
      const counts = heatmapMap.get(dateKey)

      return {
        date: dateKey,
        unresolvedCount: counts?.unresolvedCount ?? 0,
        criticalCount: counts?.criticalCount ?? 0,
      }
    }),
    unresolvedByCategory,
    shiftComparison7Days: Array.from({ length: 7 }, (_, index) => {
      const date = addUtcDays(startDate, index)
      const dateKey = formatDateOnly(date)
      const counts = comparisonMap.get(dateKey)

      return {
        date: dateKey,
        Morning: counts?.[Shift.Morning] ?? 0,
        Night: counts?.[Shift.Night] ?? 0,
      }
    }),
    openByCategory,
    overdueMetrics: {
      overdueItems: toCount(row?.overdueItems),
      itemsDueInNext2Hours: toCount(row?.itemsDueInNext2Hours),
    },
  }
}

function emptyOpenByCategory() {
  return Object.fromEntries(
    ITEM_TABLE_CONFIG.map((config) => [config.categoryKey, 0])
  ) as Record<DashboardCategoryKey, number>
}

function emptyUnresolvedByCategory() {
  return ITEM_TABLE_CONFIG.map((config) => ({
    category: config.categoryKey as DashboardCategoryKey,
    openCount: 0,
    monitoringCount: 0,
    oldestOpenDate: null,
  }))
}

function buildEmpty7DaySeries<T>(
  startDate: Date,
  factory: (dateKey: string) => T
) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = addUtcDays(startDate, index)
    return factory(formatDateOnly(date))
  })
}

function createEmptyItemAggregates(startDate: Date) {
  return {
    handoverCounts: {
      totalHandovers: 0,
      unacknowledgedHighPriority: 0,
      carriedForwardCount: 0,
      ackAlert: emptyAckAlert(),
    },
    todayMetrics: {
      openItems: 0,
      monitoringItems: 0,
      resolvedItems: 0,
      criticalItems: 0,
      flightsAffected: 0,
      byPriority: {
        [Priority.Low]: 0,
        [Priority.Normal]: 0,
        [Priority.High]: 0,
        [Priority.Critical]: 0,
      },
      byShift: {
        [Shift.Morning]: 0,
        [Shift.Night]: 0,
      },
      abnormalEventsByType: {} as Record<string, number>,
    },
    trend7Days: buildEmpty7DaySeries(startDate, (date) => ({
      date,
      open: 0,
      resolved: 0,
    })),
    priorityHeatmap7Days: buildEmpty7DaySeries(startDate, (date) => ({
      date,
      unresolvedCount: 0,
      criticalCount: 0,
    })),
    unresolvedByCategory: emptyUnresolvedByCategory(),
    shiftComparison7Days: buildEmpty7DaySeries(startDate, (date) => ({
      date,
      Morning: 0,
      Night: 0,
    })),
    openByCategory: emptyOpenByCategory(),
    overdueMetrics: {
      overdueItems: 0,
      itemsDueInNext2Hours: 0,
    },
  }
}

async function getSafeDashboardItemAggregates(
  user: AuthenticatedUser,
  today: Date,
  startDate: Date,
  now: Date
) {
  const aggregates = await getDashboardAggregates(user, today, startDate, now)

  if (aggregates) {
    return aggregates
  }

  return createEmptyItemAggregates(startDate)
}

export async function getDashboardSummary(
  user: AuthenticatedUser,
  now: Date = new Date()
) {
  const today = toDateOnly(now)
  const startDate = addUtcDays(today, -6)

  const itemAggregates = await getSafeDashboardItemAggregates(
    user,
    today,
    startDate,
    now
  )

  return {
    today: {
      totalHandovers: itemAggregates.handoverCounts.totalHandovers,
      openItems: itemAggregates.todayMetrics.openItems,
      monitoringItems: itemAggregates.todayMetrics.monitoringItems,
      resolvedItems: itemAggregates.todayMetrics.resolvedItems,
      criticalItems: itemAggregates.todayMetrics.criticalItems,
      unacknowledgedHighPriority:
        itemAggregates.handoverCounts.unacknowledgedHighPriority,
      flightsAffected: itemAggregates.todayMetrics.flightsAffected,
      byPriority: itemAggregates.todayMetrics.byPriority,
      byShift: itemAggregates.todayMetrics.byShift,
      abnormalEventsByType: itemAggregates.todayMetrics.abnormalEventsByType,
    },
    trend7Days: itemAggregates.trend7Days,
    priorityHeatmap7Days: itemAggregates.priorityHeatmap7Days,
    unresolvedByCategory: itemAggregates.unresolvedByCategory,
    shiftComparison7Days: itemAggregates.shiftComparison7Days,
    openByCategory: itemAggregates.openByCategory,
    carriedForwardCount: itemAggregates.handoverCounts.carriedForwardCount,
    ackAlert: itemAggregates.handoverCounts.ackAlert,
    overdueItems: itemAggregates.overdueMetrics.overdueItems,
    itemsDueInNext2Hours: itemAggregates.overdueMetrics.itemsDueInNext2Hours,
  }
}
