import type {
  AckAlert,
  CategoryCode,
  DashboardSummary,
  Priority,
  Shift,
} from '../types'

/**
 * Shape returned by `GET /api/v1/dashboard/summary`.
 * Mirrors `getDashboardSummary` in `backend/src/services/dashboard.service.ts`.
 * Extra fields (trend7Days, priorityHeatmap7Days, etc.) are intentionally
 * omitted here — they're consumed elsewhere.
 */
export interface BackendDashboardSummary {
  today: {
    totalHandovers: number
    openItems: number
    monitoringItems: number
    resolvedItems: number
    criticalItems: number
    unacknowledgedHighPriority: number
    flightsAffected: number
    byPriority: Record<Priority, number>
    byShift: Record<Shift, number>
    abnormalEventsByType: Record<string, number>
  }
  openByCategory: {
    aircraft: number
    airport: number
    flightSchedule: number
    crew: number
    weather: number
    system: number
    abnormalEvents: number
  }
  carriedForwardCount: number
  ackAlert?: AckAlert
}

const ZERO_BY_CATEGORY: Record<CategoryCode, number> = {
  aircraft: 0,
  airport: 0,
  flightSchedule: 0,
  crew: 0,
  weather: 0,
  system: 0,
  abnormal: 0,
}

const ZERO_BY_PRIORITY: Record<Priority, number> = {
  Low: 0,
  Normal: 0,
  High: 0,
  Critical: 0,
}

const ZERO_BY_SHIFT: Record<Shift, number> = {
  Morning: 0,
  Night: 0,
}

const EMPTY_ACK_ALERT: AckAlert = {
  severity: 'none',
  unackedCount: 0,
  criticalCount: 0,
  highCount: 0,
  oldestUnackedMinutes: 0,
}

export const EMPTY_DASHBOARD_SUMMARY: DashboardSummary = {
  totalHandovers: 0,
  openHandovers: 0,
  highOrCritical: 0,
  flightsAffected: 0,
  awaitingAcknowledgment: 0,
  carriedForwardCount: 0,
  aircraftIssues: 0,
  byCategory: { ...ZERO_BY_CATEGORY },
  byPriority: { ...ZERO_BY_PRIORITY },
  byShift: { ...ZERO_BY_SHIFT },
  abnormalEventsByType: {},
  ackAlert: { ...EMPTY_ACK_ALERT },
}

function pickAckAlert(source: AckAlert | undefined): AckAlert {
  if (!source) return { ...EMPTY_ACK_ALERT }
  return {
    severity: source.severity ?? 'none',
    unackedCount: source.unackedCount ?? 0,
    criticalCount: source.criticalCount ?? 0,
    highCount: source.highCount ?? 0,
    oldestUnackedMinutes: source.oldestUnackedMinutes ?? 0,
  }
}

function pickPriority(
  source: Partial<Record<Priority, number>> | undefined,
): Record<Priority, number> {
  return {
    Low: source?.Low ?? 0,
    Normal: source?.Normal ?? 0,
    High: source?.High ?? 0,
    Critical: source?.Critical ?? 0,
  }
}

function pickShift(
  source: Partial<Record<Shift, number>> | undefined,
): Record<Shift, number> {
  return {
    Morning: source?.Morning ?? 0,
    Night: source?.Night ?? 0,
  }
}

/**
 * Map the rich backend dashboard summary onto the leaner KPI shape the
 * `DashboardKpis` component expects. `today.criticalItems` is the
 * count of open+monitoring items at Critical priority — that's what the
 * "High/Critical" KPI surfaces today. We expose the per-priority breakdown
 * separately for downstream consumers.
 */
export function mapDashboardSummary(
  backend: BackendDashboardSummary,
): DashboardSummary {
  return {
    totalHandovers: backend.today.totalHandovers,
    openHandovers: backend.today.openItems,
    highOrCritical: backend.today.criticalItems,
    flightsAffected: backend.today.flightsAffected ?? 0,
    awaitingAcknowledgment: backend.today.unacknowledgedHighPriority,
    carriedForwardCount: backend.carriedForwardCount,
    aircraftIssues: backend.openByCategory.aircraft,
    byCategory: {
      aircraft: backend.openByCategory.aircraft,
      airport: backend.openByCategory.airport,
      flightSchedule: backend.openByCategory.flightSchedule,
      crew: backend.openByCategory.crew,
      weather: backend.openByCategory.weather,
      system: backend.openByCategory.system,
      abnormal: backend.openByCategory.abnormalEvents,
    },
    byPriority: pickPriority(backend.today.byPriority),
    byShift: pickShift(backend.today.byShift),
    abnormalEventsByType: { ...(backend.today.abnormalEventsByType ?? {}) },
    ackAlert: pickAckAlert(backend.ackAlert),
  }
}
