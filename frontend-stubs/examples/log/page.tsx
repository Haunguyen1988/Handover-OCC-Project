/**
 * Example Handover Log page. Drop at `app/(app)/log/page.tsx`.
 *
 * The filters are state-only here for brevity; in production you'll want
 * to round-trip them through `useSearchParams()` + `router.replace()` so
 * that the dashboard KPI deep-links (`/log?priority=Critical&unack=1`)
 * keep working.
 */

'use client';

import { useState } from 'react';
import { AppShell } from '../../components/layout/AppShell';
import { HandoverFilters, type HandoverFiltersValue } from '../../components/handover/HandoverFilters';
import { HandoverTable } from '../../components/handover/HandoverTable';
import type { HandoverListRow, QuickFilter, UserSummary } from '../../lib/types';

const DEMO_USER: UserSummary = { id: 'u-1', name: 'Lê Thu', role: 'OCC_STAFF' };

const DEFAULT_FILTERS: HandoverFiltersValue = {
  search: '',
  shift: 'All',
  priority: 'All',
  status: 'All',
  unack: false,
  carryForward: false,
};

export default function LogPage({ rows }: { rows: HandoverListRow[] }) {
  const [filters, setFilters] = useState<HandoverFiltersValue>(DEFAULT_FILTERS);
  const [quick, setQuick] = useState<QuickFilter>('all');

  return (
    <AppShell
      user={DEMO_USER}
      ackAlert={{ severity: 'breach', unackedCount: 1, criticalCount: 1, highCount: 0, oldestUnackedMinutes: 245 }}
      recordCount={rows.length}
    >
      <div className="flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-bold text-fg">Handover Log</h1>
        </header>
        <HandoverFilters
          value={filters}
          onChange={setFilters}
          quickFilter={quick}
          onQuickFilterChange={setQuick}
        />
        <HandoverTable handovers={rows} />
      </div>
    </AppShell>
  );
}
