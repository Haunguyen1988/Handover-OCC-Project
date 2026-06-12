'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import {
  HandoverFilters,
  type HandoverFiltersValue,
} from '@/components/handover/HandoverFilters'
import { HandoverTable } from '@/components/handover/HandoverTable'
import type {
  HandoverListRow,
  ItemStatus,
  Priority,
  QuickFilter,
  Shift,
} from '@/lib/types'

const DEFAULT_FILTERS: HandoverFiltersValue = {
  search: '',
  shift: 'All',
  priority: 'All',
  status: 'All',
  unack: false,
  carryForward: false,
}

const PRIORITIES: ReadonlyArray<Priority> = ['Low', 'Normal', 'High', 'Critical']
const SHIFTS: ReadonlyArray<Shift> = ['Morning', 'Night']
const STATUSES: ReadonlyArray<ItemStatus> = ['Open', 'Monitoring', 'Resolved']

/** Build the initial filter/quick state from the URL deep-link params. */
function readParams(params: URLSearchParams): {
  filters: HandoverFiltersValue
  quick: QuickFilter
} {
  const filters: HandoverFiltersValue = { ...DEFAULT_FILTERS }
  let quick: QuickFilter = 'all'

  const search = params.get('search')
  if (search) filters.search = search

  // priority can be a single value or a comma list (e.g. "High,Critical").
  const priority = params.get('priority')
  if (priority) {
    const values = priority.split(',').filter((v): v is Priority =>
      PRIORITIES.includes(v as Priority),
    )
    if (values.length === 1) {
      filters.priority = values[0]
    } else if (values.length > 1) {
      quick = 'highPlus'
    }
  }

  const shift = params.get('shift')
  if (shift && SHIFTS.includes(shift as Shift)) {
    filters.shift = shift as Shift
  }

  const status = params.get('status')
  if (status) {
    const values = status.split(',').filter((v): v is ItemStatus =>
      STATUSES.includes(v as ItemStatus),
    )
    if (values.length === 1) {
      filters.status = values[0]
    } else if (values.includes('Open')) {
      quick = 'openOnly'
    }
  }

  if (params.get('unack') === '1') filters.unack = true
  if (
    params.get('carriedForwardOnly') === 'true' ||
    params.get('carryForward') === 'true'
  ) {
    filters.carryForward = true
  }

  return { filters, quick }
}

function matchesFilters(
  row: HandoverListRow,
  filters: HandoverFiltersValue,
): boolean {
  if (filters.shift !== 'All' && row.shift !== filters.shift) return false
  if (filters.priority !== 'All' && row.overallPriority !== filters.priority)
    return false
  if (filters.status !== 'All' && row.overallStatus !== filters.status)
    return false
  if (filters.unack && row.acknowledgedAt !== null) return false
  if (filters.carryForward && !row.isCarriedForward) return false

  if (filters.search.trim()) {
    const q = filters.search.trim().toLowerCase()
    const haystack = [
      row.referenceId,
      row.preparedBy.name,
      row.preparedBy.email ?? '',
      row.handedTo?.name ?? '',
    ]
      .join(' ')
      .toLowerCase()
    if (!haystack.includes(q)) return false
  }

  return true
}

function matchesQuick(row: HandoverListRow, quick: QuickFilter): boolean {
  switch (quick) {
    case 'all':
      return true
    case 'today': {
      const today = new Date().toISOString().slice(0, 10)
      return row.handoverDate === today
    }
    case 'last7': {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 7)
      return new Date(row.handoverDate) >= cutoff
    }
    case 'highPlus':
      return row.overallPriority === 'High' || row.overallPriority === 'Critical'
    case 'openOnly':
      return row.overallStatus === 'Open'
    case 'carryForward':
      return row.isCarriedForward
    case 'awaitingAck':
      return row.acknowledgedAt === null
    default:
      return true
  }
}

export function LogClient({
  rows,
  error,
}: {
  rows: HandoverListRow[]
  error?: string
}) {
  const searchParams = useSearchParams()
  const initial = useMemo(
    () => readParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  )

  const [filters, setFilters] = useState<HandoverFiltersValue>(initial.filters)
  const [quick, setQuick] = useState<QuickFilter>(initial.quick)

  const visibleRows = useMemo(
    () =>
      rows.filter(
        (row) => matchesFilters(row, filters) && matchesQuick(row, quick),
      ),
    [rows, filters, quick],
  )

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-10">
      <header className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-fg-mute">
            Operations
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-fg">
            Handover Log
          </h1>
        </div>
        <span className="font-mono text-sm tabular-nums text-fg-mute">
          {visibleRows.length} / {rows.length}
        </span>
      </header>
      {error && (
        <div className="rounded-md border border-priority-high bg-priority-high-bg px-3 py-2 text-sm text-priority-high-fg">
          {error}.
        </div>
      )}
      <div className="flex flex-col gap-5">
        <HandoverFilters
          value={filters}
          onChange={setFilters}
          quickFilter={quick}
          onQuickFilterChange={setQuick}
        />
        <HandoverTable handovers={visibleRows} />
      </div>
    </div>
  )
}
