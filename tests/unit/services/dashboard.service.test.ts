import { UserRole } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthenticatedUser } from '../../../backend/src/middleware/auth.middleware'

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
}))

vi.mock('../../../backend/src/lib/prisma', () => ({
  prisma: prismaMock,
}))

import { getDashboardSummary } from '../../../backend/src/services/dashboard.service'

function createUser(role: UserRole): AuthenticatedUser {
  return {
    id: `${role.toLowerCase()}-user`,
    name: `${role} User`,
    email: `${role.toLowerCase()}@example.com`,
    role,
  }
}

describe('dashboard.service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns the dashboard summary in API spec shape with zero-filled trend days', async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([
        {
          totalHandovers: 3,
          unacknowledgedHighPriority: 1,
          carriedForwardCount: 5,
          openItems: 12,
          monitoringItems: 4,
          resolvedItems: 8,
          criticalItems: 2,
          staleUnackedCriticalCount: 2,
          oldestUnackedCriticalMinutes: 45,
          staleUnackedHighCount: 1,
          oldestUnackedHighMinutes: 30,
          trendRows: [
            {
              handoverDate: new Date('2026-04-17T00:00:00.000Z'),
              open: 5,
              resolved: 3,
            },
            {
              handoverDate: new Date('2026-04-20T00:00:00.000Z'),
              open: 7,
              resolved: 6,
            },
          ],
          priorityHeatmapRows: [
            {
              handoverDate: new Date('2026-04-17T00:00:00.000Z'),
              unresolvedCount: 3,
              criticalCount: 0,
            },
            {
              handoverDate: new Date('2026-04-20T00:00:00.000Z'),
              unresolvedCount: 6,
              criticalCount: 2,
            },
          ],
          unresolvedByCategoryRows: [
            {
              category: 'aircraft',
              openCount: 3,
              monitoringCount: 1,
              oldestOpenDate: new Date('2026-04-17T00:00:00.000Z'),
            },
            {
              category: 'crew',
              openCount: 4,
              monitoringCount: 2,
              oldestOpenDate: new Date('2026-04-18T00:00:00.000Z'),
            },
          ],
          shiftComparisonRows: [
            {
              handoverDate: new Date('2026-04-17T00:00:00.000Z'),
              shift: 'Morning',
              openCount: 2,
            },
            {
              handoverDate: new Date('2026-04-17T00:00:00.000Z'),
              shift: 'Night',
              openCount: 1,
            },
            {
              handoverDate: new Date('2026-04-20T00:00:00.000Z'),
              shift: 'Night',
              openCount: 4,
            },
          ],
          openByCategoryRows: [
            { category: 'aircraft', openCount: 3 },
            { category: 'airport', openCount: 1 },
            { category: 'flightSchedule', openCount: 2 },
            { category: 'crew', openCount: 4 },
            { category: 'weather', openCount: 1 },
            { category: 'system', openCount: 1 },
          ],
          byPriorityRows: [
            { priority: 'Normal', count: 1 },
            { priority: 'High', count: 1 },
            { priority: 'Critical', count: 1 },
          ],
          byShiftRows: [
            { shift: 'Morning', count: 1 },
            { shift: 'Night', count: 1 },
          ],
          abnormalEventsByTypeRows: [
            { eventType: 'AOG', count: 2 },
            { eventType: 'Diversion', count: 1 },
          ],
          flightsAffected: 7,
          overdueItems: 2,
          itemsDueInNext2Hours: 4,
        },
      ])

    const summary = await getDashboardSummary(
      createUser(UserRole.SUPERVISOR),
      new Date('2026-04-23T10:15:00.000Z')
    )

    expect(summary).toEqual({
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
      },
      trend7Days: [
        { date: '2026-04-17', open: 5, resolved: 3 },
        { date: '2026-04-18', open: 0, resolved: 0 },
        { date: '2026-04-19', open: 0, resolved: 0 },
        { date: '2026-04-20', open: 7, resolved: 6 },
        { date: '2026-04-21', open: 0, resolved: 0 },
        { date: '2026-04-22', open: 0, resolved: 0 },
        { date: '2026-04-23', open: 0, resolved: 0 },
      ],
      priorityHeatmap7Days: [
        { date: '2026-04-17', unresolvedCount: 3, criticalCount: 0 },
        { date: '2026-04-18', unresolvedCount: 0, criticalCount: 0 },
        { date: '2026-04-19', unresolvedCount: 0, criticalCount: 0 },
        { date: '2026-04-20', unresolvedCount: 6, criticalCount: 2 },
        { date: '2026-04-21', unresolvedCount: 0, criticalCount: 0 },
        { date: '2026-04-22', unresolvedCount: 0, criticalCount: 0 },
        { date: '2026-04-23', unresolvedCount: 0, criticalCount: 0 },
      ],
      unresolvedByCategory: [
        {
          category: 'aircraft',
          openCount: 3,
          monitoringCount: 1,
          oldestOpenDate: '2026-04-17',
        },
        {
          category: 'airport',
          openCount: 0,
          monitoringCount: 0,
          oldestOpenDate: null,
        },
        {
          category: 'flightSchedule',
          openCount: 0,
          monitoringCount: 0,
          oldestOpenDate: null,
        },
        {
          category: 'crew',
          openCount: 4,
          monitoringCount: 2,
          oldestOpenDate: '2026-04-18',
        },
        {
          category: 'weather',
          openCount: 0,
          monitoringCount: 0,
          oldestOpenDate: null,
        },
        {
          category: 'system',
          openCount: 0,
          monitoringCount: 0,
          oldestOpenDate: null,
        },
        {
          category: 'abnormalEvents',
          openCount: 0,
          monitoringCount: 0,
          oldestOpenDate: null,
        },
      ],
      shiftComparison7Days: [
        { date: '2026-04-17', Morning: 2, Night: 1 },
        { date: '2026-04-18', Morning: 0, Night: 0 },
        { date: '2026-04-19', Morning: 0, Night: 0 },
        { date: '2026-04-20', Morning: 0, Night: 4 },
        { date: '2026-04-21', Morning: 0, Night: 0 },
        { date: '2026-04-22', Morning: 0, Night: 0 },
        { date: '2026-04-23', Morning: 0, Night: 0 },
      ],
      openByCategory: {
        aircraft: 3,
        airport: 1,
        flightSchedule: 2,
        crew: 4,
        weather: 1,
        system: 1,
        abnormalEvents: 0,
      },
      carriedForwardCount: 5,
      ackAlert: {
        severity: 'breach',
        unackedCount: 3,
        criticalCount: 2,
        highCount: 1,
        oldestUnackedMinutes: 45,
      },
      overdueItems: 2,
      itemsDueInNext2Hours: 4,
    })
  })

  it('limits OCC staff dashboard queries to their own handovers', async () => {
    const occUser = createUser(UserRole.OCC_STAFF)
    prismaMock.$queryRaw
      .mockResolvedValueOnce([
        {
          totalHandovers: 1,
          unacknowledgedHighPriority: 0,
          carriedForwardCount: 0,
          openItems: 0,
          monitoringItems: 0,
          resolvedItems: 0,
          criticalItems: 0,
          trendRows: [],
          priorityHeatmapRows: [],
          unresolvedByCategoryRows: [],
          shiftComparisonRows: [],
          openByCategoryRows: [],
          byPriorityRows: [],
          byShiftRows: [],
          abnormalEventsByTypeRows: [],
          flightsAffected: 0,
          overdueItems: 0,
          itemsDueInNext2Hours: 0,
        },
      ])

    await getDashboardSummary(occUser, new Date('2026-04-23T18:30:00.000Z'))

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)

    const aggregateQuery = prismaMock.$queryRaw.mock.calls[0]?.[0] as {
      values?: unknown[]
    }

    expect(aggregateQuery.values).toContain(occUser.id)
  })

  it('zero-fills today.byPriority/byShift/abnormalEventsByType when the DB returns empty arrays', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      {
        totalHandovers: 0,
        unacknowledgedHighPriority: 0,
        carriedForwardCount: 0,
        openItems: 0,
        monitoringItems: 0,
        resolvedItems: 0,
        criticalItems: 0,
        trendRows: [],
        priorityHeatmapRows: [],
        unresolvedByCategoryRows: [],
        shiftComparisonRows: [],
        openByCategoryRows: [],
        byPriorityRows: [],
        byShiftRows: [],
        abnormalEventsByTypeRows: [],
        flightsAffected: 0,
        overdueItems: 0,
        itemsDueInNext2Hours: 0,
      },
    ])

    const summary = await getDashboardSummary(
      createUser(UserRole.SUPERVISOR),
      new Date('2026-04-23T10:15:00.000Z')
    )

    expect(summary.today).toEqual({
      totalHandovers: 0,
      openItems: 0,
      monitoringItems: 0,
      resolvedItems: 0,
      criticalItems: 0,
      unacknowledgedHighPriority: 0,
      flightsAffected: 0,
      byPriority: { Low: 0, Normal: 0, High: 0, Critical: 0 },
      byShift: { Morning: 0, Night: 0 },
      abnormalEventsByType: {},
    })
  })

  it('falls back to fully zeroed today metrics when the aggregate query returns no rows', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([])

    const summary = await getDashboardSummary(
      createUser(UserRole.MANAGEMENT_VIEWER),
      new Date('2026-04-23T10:15:00.000Z')
    )

    expect(summary.today).toEqual({
      totalHandovers: 0,
      openItems: 0,
      monitoringItems: 0,
      resolvedItems: 0,
      criticalItems: 0,
      unacknowledgedHighPriority: 0,
      flightsAffected: 0,
      byPriority: { Low: 0, Normal: 0, High: 0, Critical: 0 },
      byShift: { Morning: 0, Night: 0 },
      abnormalEventsByType: {},
    })
    expect(summary.openByCategory).toEqual({
      aircraft: 0,
      airport: 0,
      flightSchedule: 0,
      crew: 0,
      weather: 0,
      system: 0,
      abnormalEvents: 0,
    })
  })
})
