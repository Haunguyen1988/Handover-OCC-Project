import { describe, expect, it } from 'vitest'

import {
  EMPTY_DASHBOARD_SUMMARY,
  mapDashboardSummary,
  type BackendDashboardSummary,
} from '../../../frontend/lib/dashboard/mapDashboardSummary'

function buildBackend(
  overrides: Partial<BackendDashboardSummary['today']> = {},
  openByCategoryOverrides: Partial<
    BackendDashboardSummary['openByCategory']
  > = {},
  rest: Partial<BackendDashboardSummary> = {},
): BackendDashboardSummary {
  return {
    today: {
      totalHandovers: 3,
      openItems: 12,
      monitoringItems: 4,
      resolvedItems: 8,
      criticalItems: 2,
      unacknowledgedHighPriority: 1,
      flightsAffected: 7,
      byPriority: { Low: 0, Normal: 1, High: 1, Critical: 1 },
      byShift: { Morning: 1, Night: 1 },
      abnormalEventsByType: { AOG: 2, Diversion: 1 },
      ...overrides,
    },
    openByCategory: {
      aircraft: 3,
      airport: 1,
      flightSchedule: 2,
      crew: 4,
      weather: 1,
      system: 1,
      abnormalEvents: 0,
      ...openByCategoryOverrides,
    },
    carriedForwardCount: 5,
    ackAlert: {
      severity: 'breach',
      unackedCount: 3,
      criticalCount: 2,
      highCount: 1,
      oldestUnackedMinutes: 245,
    },
    ...rest,
  }
}

describe('mapDashboardSummary', () => {
  it('uses real backend values for byPriority/byShift/flightsAffected/abnormalEventsByType', () => {
    const summary = mapDashboardSummary(buildBackend())

    expect(summary.totalHandovers).toBe(3)
    expect(summary.openHandovers).toBe(12)
    expect(summary.highOrCritical).toBe(2)
    expect(summary.flightsAffected).toBe(7)
    expect(summary.awaitingAcknowledgment).toBe(1)
    expect(summary.carriedForwardCount).toBe(5)
    expect(summary.aircraftIssues).toBe(3)
    expect(summary.byCategory).toEqual({
      aircraft: 3,
      airport: 1,
      flightSchedule: 2,
      crew: 4,
      weather: 1,
      system: 1,
      abnormal: 0,
    })
    expect(summary.byPriority).toEqual({
      Low: 0,
      Normal: 1,
      High: 1,
      Critical: 1,
    })
    expect(summary.byShift).toEqual({ Morning: 1, Night: 1 })
    expect(summary.abnormalEventsByType).toEqual({ AOG: 2, Diversion: 1 })
    expect(summary.ackAlert).toEqual({
      severity: 'breach',
      unackedCount: 3,
      criticalCount: 2,
      highCount: 1,
      oldestUnackedMinutes: 245,
    })
  })

  it('falls back to a none-severity ackAlert when the backend omits it', () => {
    const backend = buildBackend()
    delete (backend as { ackAlert?: unknown }).ackAlert

    const summary = mapDashboardSummary(backend)

    expect(summary.ackAlert).toEqual({
      severity: 'none',
      unackedCount: 0,
      criticalCount: 0,
      highCount: 0,
      oldestUnackedMinutes: 0,
    })
  })

  it('zero-fills missing priority/shift buckets while preserving extra abnormal types', () => {
    const summary = mapDashboardSummary(
      buildBackend({
        // @ts-expect-error - intentionally pass partial buckets
        byPriority: { High: 4 },
        // @ts-expect-error - intentionally pass partial buckets
        byShift: { Night: 2 },
        abnormalEventsByType: { 'Bird Strike': 1, AOG: 5 },
      }),
    )

    expect(summary.byPriority).toEqual({ Low: 0, Normal: 0, High: 4, Critical: 0 })
    expect(summary.byShift).toEqual({ Morning: 0, Night: 2 })
    expect(summary.abnormalEventsByType).toEqual({
      'Bird Strike': 1,
      AOG: 5,
    })
  })

  it('exposes a fully zeroed empty summary for backend-unreachable fallbacks', () => {
    expect(EMPTY_DASHBOARD_SUMMARY.totalHandovers).toBe(0)
    expect(EMPTY_DASHBOARD_SUMMARY.byPriority).toEqual({
      Low: 0,
      Normal: 0,
      High: 0,
      Critical: 0,
    })
    expect(EMPTY_DASHBOARD_SUMMARY.byShift).toEqual({
      Morning: 0,
      Night: 0,
    })
    expect(EMPTY_DASHBOARD_SUMMARY.abnormalEventsByType).toEqual({})
    expect(EMPTY_DASHBOARD_SUMMARY.byCategory).toEqual({
      aircraft: 0,
      airport: 0,
      flightSchedule: 0,
      crew: 0,
      weather: 0,
      system: 0,
      abnormal: 0,
    })
    expect(EMPTY_DASHBOARD_SUMMARY.ackAlert).toEqual({
      severity: 'none',
      unackedCount: 0,
      criticalCount: 0,
      highCount: 0,
      oldestUnackedMinutes: 0,
    })
  })
})
