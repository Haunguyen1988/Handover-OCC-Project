'use client';

import { useRouter } from 'next/navigation';
import { useI18n } from '../../hooks/useI18n';
import { cn } from '../../lib/cn';
import type { Priority, Shift } from '../../lib/types';

const PRIORITIES: ReadonlyArray<Priority> = ['Critical', 'High', 'Normal', 'Low'];
const SHIFTS: ReadonlyArray<Shift> = ['Morning', 'Night'];

const PRIORITY_BAR_CLASS: Record<Priority, string> = {
  Critical: 'bg-priority-critical-fg',
  High: 'bg-priority-high-fg',
  Normal: 'bg-priority-normal-fg',
  Low: 'bg-priority-low-fg',
};

const SHIFT_BAR_CLASS = 'bg-shift-fg';
const EVENT_BAR_CLASS = 'bg-status-monitoring';

export interface DashboardBreakdownProps {
  byPriority: Record<Priority, number>;
  byShift: Record<Shift, number>;
  abnormalEventsByType: Record<string, number>;
}

interface BreakdownPanelProps {
  title: string;
  rows: ReadonlyArray<BreakdownRow>;
  emptyLabel: string;
}

interface BreakdownRow {
  key: string;
  label: string;
  value: number;
  barClass: string;
  onClick?: () => void;
}

function BreakdownPanel({ title, rows, emptyLabel }: BreakdownPanelProps) {
  const max = rows.reduce((acc, row) => (row.value > acc ? row.value : acc), 0);
  const total = rows.reduce((acc, row) => acc + row.value, 0);
  const isEmpty = total === 0;

  return (
    <section className="flex flex-col gap-4 rounded-md border border-line bg-bg-elev p-5">
      <header className="flex items-baseline justify-between gap-2 border-b border-line-soft pb-3">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-mute">{title}</h3>
        <span className="font-mono text-lg font-semibold tabular-nums text-fg">{total}</span>
      </header>
      {isEmpty ? (
        <p className="text-xs text-fg-mute">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const widthPct = max === 0 ? 0 : Math.round((row.value / max) * 100);
            const Tag = row.onClick ? 'button' : 'div';
            return (
              <li key={row.key}>
                <Tag
                  type={row.onClick ? 'button' : undefined}
                  onClick={row.onClick}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-sm px-1.5 py-1.5 text-left transition-colors duration-150 ease-ease',
                    row.onClick && 'hover:bg-bg-row focus-visible:bg-bg-row focus-visible:outline-none',
                  )}
                >
                  <span className="w-24 shrink-0 truncate text-xs font-medium text-fg-soft">
                    {row.label}
                  </span>
                  <span className="relative h-1 flex-1 overflow-hidden rounded-pill bg-line-soft">
                    <span
                      className={cn('absolute inset-y-0 left-0 rounded-pill transition-[width] duration-500 ease-ease', row.barClass)}
                      style={{ width: `${widthPct}%` }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-fg">
                    {row.value}
                  </span>
                </Tag>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Three-panel breakdown for today: handovers by Priority, handovers by
 * Shift, and AbnormalEvents by type. Each row in the priority/shift
 * panels deep-links to the corresponding filtered Handover Log query.
 * Abnormal-event-type rows are display-only because the log doesn't
 * filter by event type today.
 */
export function DashboardBreakdown({
  byPriority,
  byShift,
  abnormalEventsByType,
}: DashboardBreakdownProps) {
  const router = useRouter();
  const { t } = useI18n();

  const priorityRows: BreakdownRow[] = PRIORITIES.map((priority) => ({
    key: priority,
    label: t(`priority.${priority.toLowerCase()}` as Parameters<typeof t>[0]),
    value: byPriority[priority] ?? 0,
    barClass: PRIORITY_BAR_CLASS[priority],
    onClick: () => router.push(`/log?priority=${priority}`),
  }));

  const shiftRows: BreakdownRow[] = SHIFTS.map((shift) => ({
    key: shift,
    label: t(`shift.${shift.toLowerCase()}` as Parameters<typeof t>[0]),
    value: byShift[shift] ?? 0,
    barClass: SHIFT_BAR_CLASS,
    onClick: () => router.push(`/log?shift=${shift}`),
  }));

  const eventEntries = Object.entries(abnormalEventsByType)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a);

  const eventRows: BreakdownRow[] = eventEntries.map(([type, value]) => ({
    key: type,
    label: type,
    value,
    barClass: EVENT_BAR_CLASS,
  }));

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      <BreakdownPanel
        title={t('breakdown.byPriority')}
        rows={priorityRows}
        emptyLabel={t('breakdown.empty')}
      />
      <BreakdownPanel
        title={t('breakdown.byShift')}
        rows={shiftRows}
        emptyLabel={t('breakdown.empty')}
      />
      <BreakdownPanel
        title={t('breakdown.byEventType')}
        rows={eventRows}
        emptyLabel={t('breakdown.empty')}
      />
    </div>
  );
}
