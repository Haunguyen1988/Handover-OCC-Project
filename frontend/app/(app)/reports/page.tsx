'use client'

import { useState } from 'react'

import { ExportButton } from '@/components/reports/ExportButton'
import {
  DEFAULT_REPORT_FILTERS,
  ReportFilters,
} from '@/components/reports/ReportFilters'
import { ReportPreview } from '@/components/reports/ReportPreview'
import type {
  ExportFormat,
  HandoverListResponse,
  ItemStatus,
  Priority,
  ReportDataset,
  ReportFiltersValue,
  Shift,
} from '@/lib/types'

function reportFiltersToQuery(filters: ReportFiltersValue): string {
  const params = new URLSearchParams()
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  if (filters.shift !== 'All') params.set('shift', filters.shift)
  if (filters.priority !== 'All') params.set('priority', filters.priority)
  if (filters.category !== 'All') params.set('category', filters.category)
  if (filters.preparedById) params.set('preparedById', filters.preparedById)
  if (filters.openOnly) params.set('openOnly', 'true')
  if (filters.carryForwardOnly) params.set('carryForwardOnly', 'true')
  // Pull a generous page so the preview reflects the full filtered set.
  params.set('limit', '100')
  return params.toString()
}

function tallyTotals(rows: HandoverListResponse['data']) {
  const byShift: Record<Shift, number> = { Morning: 0, Night: 0 }
  const byPriority: Record<Priority, number> = {
    Low: 0,
    Normal: 0,
    High: 0,
    Critical: 0,
  }
  const byStatus: Record<ItemStatus, number> = {
    Open: 0,
    Monitoring: 0,
    Resolved: 0,
  }
  for (const row of rows) {
    byShift[row.shift] += 1
    byPriority[row.overallPriority] += 1
    byStatus[row.overallStatus] += 1
  }
  return { byShift, byPriority, byStatus }
}

export default function ReportsPage() {
  const [filters, setFilters] = useState<ReportFiltersValue>(
    DEFAULT_REPORT_FILTERS
  )
  const [dataset, setDataset] = useState<ReportDataset | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDataset = async (next: ReportFiltersValue) => {
    setPending(true)
    setError(null)
    try {
      const qs = reportFiltersToQuery(next)
      const res = await fetch(`/api/v1/handovers?${qs}`, { cache: 'no-store' })
      if (!res.ok) {
        throw new Error(`Backend ${res.status}`)
      }
      const body = (await res.json()) as HandoverListResponse
      setDataset({
        filters: next,
        generatedAt: new Date().toISOString(),
        totalHandovers: body.pagination.total,
        rows: body.data,
        totals: tallyTotals(body.data),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setDataset(null)
    } finally {
      setPending(false)
    }
  }

  const exportTo = async (
    format: ExportFormat,
    activeFilters: ReportFiltersValue
  ): Promise<void> => {
    if (format !== 'csv') {
      setError(`Export format ${format} is not implemented yet`)
      return
    }
    const qs = reportFiltersToQuery(activeFilters)
    // Browser navigates so the Content-Disposition header triggers the download.
    window.location.href = `/api/v1/handovers/export/csv?${qs}`
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-fg">Reports & Export</h1>
          <p className="text-sm text-fg-mute">
            Filter handovers by date range and export to CSV. Per BR-14,
            PDF export is per-handover — use the PDF link in each row.
          </p>
        </div>
        <ExportButton
          filters={filters}
          exportTo={exportTo}
          onPrint={() => window.print()}
        />
      </header>

      {error && (
        <p className="rounded-md border border-priority-high bg-priority-high-bg px-3 py-2 text-sm text-priority-high-fg print:hidden">
          {error}
        </p>
      )}

      <div className="print:hidden">
        <ReportFilters
          value={filters}
          onChange={setFilters}
          onApply={() => loadDataset(filters)}
          onReset={() => {
            setFilters(DEFAULT_REPORT_FILTERS)
            setDataset(null)
            setError(null)
          }}
        />
        {pending && (
          <p className="mt-2 text-xs text-fg-mute">Loading dataset…</p>
        )}
      </div>

      <ReportPreview dataset={dataset} />
    </div>
  )
}
