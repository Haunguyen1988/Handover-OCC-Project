import Link from 'next/link'

import { DashboardKpis } from '@/components/dashboard/DashboardKpis'
import { DashboardBreakdown } from '@/components/dashboard/DashboardBreakdown'
import { HandoverTable } from '@/components/handover/HandoverTable'
import { backendFetch, BackendApiError } from '@/lib/server/api-client'
import {
  EMPTY_DASHBOARD_SUMMARY,
  mapDashboardSummary,
  type BackendDashboardSummary,
} from '@/lib/dashboard/mapDashboardSummary'
import type {
  DashboardSummary,
  HandoverListResponse,
  HandoverListRow,
} from '@/lib/types'

async function loadDashboard(): Promise<{
  summary: DashboardSummary
  handovers: HandoverListRow[]
  error?: string
}> {
  try {
    const [backendSummary, list] = await Promise.all([
      backendFetch<BackendDashboardSummary>('/api/v1/dashboard/summary'),
      backendFetch<HandoverListResponse>('/api/v1/handovers?limit=10'),
    ])
    return {
      summary: mapDashboardSummary(backendSummary),
      handovers: list.data,
    }
  } catch (err) {
    const message =
      err instanceof BackendApiError
        ? `Backend ${err.status}: ${err.message}`
        : 'Backend unreachable'
    return { summary: EMPTY_DASHBOARD_SUMMARY, handovers: [], error: message }
  }
}

export default async function DashboardPage() {
  const { summary, handovers, error } = await loadDashboard()

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-10">
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-fg-mute">
          Operations
        </span>
        <h1 className="text-3xl font-semibold tracking-tight text-fg">Dashboard</h1>
      </header>
      {error && (
        <div className="rounded-md border border-priority-high bg-priority-high-bg px-3 py-2 text-sm text-priority-high-fg">
          {error}. Showing empty state — start the backend at{' '}
          <code className="font-mono">{process.env.BACKEND_URL ?? 'http://localhost:4000'}</code>{' '}
          and reload.
        </div>
      )}
      <DashboardKpis summary={summary} />
      <DashboardBreakdown
        byPriority={summary.byPriority}
        byShift={summary.byShift}
        abnormalEventsByType={summary.abnormalEventsByType}
      />
      <section className="flex flex-col gap-4">
        <header className="flex items-baseline justify-between border-b border-line-soft pb-3">
          <h2 className="text-sm font-medium uppercase tracking-[0.08em] text-fg-mute">
            Recent handovers
          </h2>
          <Link
            href="/log"
            className="text-xs font-medium text-accent transition-opacity hover:opacity-70"
          >
            View all →
          </Link>
        </header>
        <HandoverTable handovers={handovers} />
      </section>
    </div>
  )
}
