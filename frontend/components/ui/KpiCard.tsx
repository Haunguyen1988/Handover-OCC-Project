'use client';

import { cn } from '../../lib/cn';
import type { ReactNode } from 'react';

export type KpiKind = 'active' | 'alert' | 'issues' | 'opsImpact' | 'trace' | 'ok';

/**
 * Each kind maps to a single semantic accent. We deliberately render color
 * only as a small status dot + the value tint on emphasis kinds — never a
 * loud filled badge — to keep the grid quiet and editorial. The dot color
 * resolves to the same design tokens the rest of the app uses, so dark mode
 * is handled for free.
 */
const KIND_DOT: Record<KpiKind, string> = {
  active: 'bg-priority-low-fg',
  alert: 'bg-priority-high-fg',
  issues: 'bg-priority-normal-fg',
  opsImpact: 'bg-priority-critical-fg',
  trace: 'bg-status-monitoring',
  ok: 'bg-status-resolved',
};

/**
 * Attention-demanding kinds tint the value itself with their semantic color
 * (matching the dot) so a glance reads severity without a loud badge.
 */
const KIND_VALUE_TINT: Partial<Record<KpiKind, string>> = {
  alert: 'text-priority-high-fg',
  opsImpact: 'text-priority-critical-fg',
};

export interface KpiCardProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  kind?: KpiKind;
  onClick?: () => void;
  className?: string;
}

/**
 * Dashboard KPI tile. Optional `onClick` makes it deep-link to the
 * filtered Handover Log (e.g. clicking "Awaiting ack" → log filtered by
 * `priority=Critical&unack=1`).
 */
export function KpiCard({ label, value, hint, kind = 'active', onClick, className }: KpiCardProps) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'group flex w-full flex-col gap-3 rounded-md border border-line bg-bg-elev p-5 text-left transition-all duration-200 ease-ease',
        onClick &&
          'hover:-translate-y-0.5 hover:border-line-soft hover:shadow-elev focus-visible:border-accent focus-visible:outline-none',
        className
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-pill', KIND_DOT[kind])} aria-hidden="true" />
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-mute">
          {label}
        </span>
      </div>
      <div
        className={cn(
          'text-4xl font-semibold leading-none tracking-tight tabular-nums',
          KIND_VALUE_TINT[kind] ?? 'text-fg'
        )}
      >
        {value}
      </div>
      {hint && <div className="text-xs text-fg-mute">{hint}</div>}
    </Tag>
  );
}
