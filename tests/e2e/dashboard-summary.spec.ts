import { expect, test } from '@playwright/test'

import { SEED_ACCOUNTS, signIn } from './helpers/auth'

/**
 * The dashboard summary endpoint must expose the KPI breakdowns the
 * frontend mapper depends on. Hard-coding zero fallbacks in the mapper
 * has bitten us before — this test guards the contract end-to-end.
 */
test.describe('Dashboard summary KPIs', () => {
  test('today payload exposes byPriority/byShift/abnormalEventsByType/flightsAffected', async ({
    page,
  }) => {
    await signIn(page, SEED_ACCOUNTS.supervisor)

    const response = await page.request.get('/api/v1/dashboard/summary')
    expect(response.status()).toBe(200)

    const body = (await response.json()) as {
      today: {
        totalHandovers: number
        flightsAffected: number
        byPriority: Record<string, number>
        byShift: Record<string, number>
        abnormalEventsByType: Record<string, number>
      }
    }

    expect(body.today).toBeTruthy()
    expect(typeof body.today.totalHandovers).toBe('number')
    expect(typeof body.today.flightsAffected).toBe('number')

    expect(Object.keys(body.today.byPriority).sort()).toEqual([
      'Critical',
      'High',
      'Low',
      'Normal',
    ])
    expect(Object.keys(body.today.byShift).sort()).toEqual([
      'Morning',
      'Night',
    ])

    for (const value of Object.values(body.today.byPriority)) {
      expect(typeof value).toBe('number')
      expect(value).toBeGreaterThanOrEqual(0)
    }
    for (const value of Object.values(body.today.byShift)) {
      expect(typeof value).toBe('number')
      expect(value).toBeGreaterThanOrEqual(0)
    }

    expect(typeof body.today.abnormalEventsByType).toBe('object')
  })

  test('dashboard page renders without backend errors', async ({ page }) => {
    await signIn(page, SEED_ACCOUNTS.supervisor)
    await page.goto('/dashboard')

    await expect(page.locator('h1', { hasText: /dashboard/i })).toBeVisible({
      timeout: 10_000,
    })
    // The "Backend unreachable" red banner must NOT be visible.
    await expect(page.getByText(/Backend unreachable|Backend \d+/i)).toHaveCount(
      0,
    )
  })
})
