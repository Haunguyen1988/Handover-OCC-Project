/**
 * Example Reports & Export page. Drop at `app/(app)/reports/page.tsx`.
 *
 * Wires:
 *   - <ReportFilters>      controlled filter form
 *   - <ReportPreview>      print-ready dataset preview
 *   - <ExportButton>       CSV via GET /api/v1/handovers/export/csv
 *                          (PDF is per-handover; use the detail page)
 *   - window.print()       browser print pipe — relies on `@media print`
 *                          rules in `styles.global.example.css`
 *
 * Replace the stubbed `loadDataset()` and `exportCsv()` with real fetchers.
 */

'use client';

import { useState } from 'react';
import { AppShell } from '../../components/layout/AppShell';
import {
  ReportFilters,
  DEFAULT_REPORT_FILTERS,
} from '../../components/reports/ReportFilters';
import { ReportPreview } from '../../components/reports/ReportPreview';
import { ExportButton } from '../../components/reports/ExportButton';
import type {
  ExportFormat,
  ReportDataset,
  ReportFiltersValue,
  UserSummary,
} from '../../lib/types';

const DEMO_USER: UserSummary = { id: 'u-2', name: 'Nguyễn Hậu', role: 'SUPERVISOR' };

export default function ReportsPage() {
  const [filters, setFilters] = useState<ReportFiltersValue>(DEFAULT_REPORT_FILTERS);
  const [dataset, setDataset] = useState<ReportDataset | null>(null);

  // 👉 Replace with real GET /api/v1/handovers?... call. The backend
  //    already supports the same query parameters as the CSV endpoint.
  const loadDataset = async (next: ReportFiltersValue) => {
    setDataset({
      filters: next,
      generatedAt: new Date().toISOString(),
      totalHandovers: 0,
      rows: [],
      totals: {
        byShift: { Morning: 0, Night: 0 },
        byPriority: { Low: 0, Normal: 0, High: 0, Critical: 0 },
        byStatus: { Open: 0, Monitoring: 0, Resolved: 0 },
      },
    });
  };

  // 👉 Replace with: window.location.href = `/api/v1/handovers/export/csv?${qs}`;
  //    The browser triggers the download via Content-Disposition header.
  const exportTo = async (_format: ExportFormat, _filters: ReportFiltersValue) => {
    // Intentionally a no-op stub — the real implementation just navigates.
  };

  return (
    <AppShell
      user={DEMO_USER}
      ackAlert={{ severity: 'none', unackedCount: 0, criticalCount: 0, highCount: 0, oldestUnackedMinutes: 0 }}
    >
      <div className="flex flex-col gap-5">
        <header className="flex flex-wrap items-baseline justify-between gap-2 print:hidden">
          <div>
            <h1 className="text-2xl font-bold text-fg">Reports & Export</h1>
            <p className="text-sm text-fg-mute">
              Filter handovers by date range and export to PDF / CSV.
            </p>
          </div>
          <ExportButton
            filters={filters}
            exportTo={exportTo}
            onPrint={() => window.print()}
          />
        </header>

        <div className="print:hidden">
          <ReportFilters
            value={filters}
            onChange={setFilters}
            onApply={() => loadDataset(filters)}
            onReset={() => {
              setFilters(DEFAULT_REPORT_FILTERS);
              setDataset(null);
            }}
          />
        </div>

        <ReportPreview dataset={dataset} />
      </div>
    </AppShell>
  );
}
