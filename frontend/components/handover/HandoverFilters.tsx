'use client';

import { useI18n } from '../../hooks/useI18n';
import { FilterChip } from '../ui/FilterChip';
import type { ItemStatus, Priority, QuickFilter, Shift } from '../../lib/types';

export interface HandoverFiltersValue {
  search: string;
  shift: Shift | 'All';
  priority: Priority | 'All';
  status: ItemStatus | 'All';
  unack: boolean;
  carryForward: boolean;
}

export interface HandoverFiltersProps {
  value: HandoverFiltersValue;
  onChange: (next: HandoverFiltersValue) => void;
  quickFilter: QuickFilter;
  onQuickFilterChange: (next: QuickFilter) => void;
  counts?: Partial<Record<QuickFilter, number>>;
}

/**
 * Sticky filter bar combining quick chips + dropdowns. Designed so each
 * change is a controlled callback — your page wires it up to URL search
 * params with `useSearchParams`/`useRouter` to keep the deep-link
 * behaviour from the prototype.
 */
export function HandoverFilters({
  value,
  onChange,
  quickFilter,
  onQuickFilterChange,
  counts = {},
}: HandoverFiltersProps) {
  const { t } = useI18n();

  const update = <K extends keyof HandoverFiltersValue>(key: K, next: HandoverFiltersValue[K]) =>
    onChange({ ...value, [key]: next });

  const chips: Array<{ id: QuickFilter; label: string }> = [
    { id: 'today', label: 'Today' },
    { id: 'last7', label: 'Last 7d' },
    { id: 'highPlus', label: 'High+' },
    { id: 'openOnly', label: 'Open only' },
    { id: 'carryForward', label: 'Carry-forward' },
    { id: 'awaitingAck', label: 'Awaiting ack' },
  ];

  const clear = () =>
    onChange({
      search: '',
      shift: 'All',
      priority: 'All',
      status: 'All',
      unack: false,
      carryForward: false,
    });

  const selectClass =
    'min-w-[140px] rounded-md border border-line bg-bg-elev px-3 py-2 text-sm text-fg-soft transition-colors duration-150 ease-ease hover:border-line-soft focus:border-accent focus:outline-none';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <FilterChip
            key={chip.id}
            label={chip.label}
            count={counts[chip.id]}
            active={quickFilter === chip.id}
            onToggle={() => onQuickFilterChange(quickFilter === chip.id ? 'all' : chip.id)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex flex-1 min-w-[220px] items-center">
          <span className="sr-only">Search</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="pointer-events-none absolute left-3 h-4 w-4 text-fg-faint"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="m11 11 3 3" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            placeholder={t('topbar.search')}
            value={value.search}
            onChange={(e) => update('search', e.target.value)}
            className="w-full rounded-md border border-line bg-bg-elev py-2 pl-9 pr-3 text-sm text-fg placeholder:text-fg-faint transition-colors duration-150 ease-ease hover:border-line-soft focus:border-accent focus:outline-none"
          />
        </label>

        <select
          value={value.shift}
          onChange={(e) => update('shift', e.target.value as HandoverFiltersValue['shift'])}
          className={selectClass}
        >
          <option value="All">All shifts</option>
          <option value="Morning">Morning</option>
          <option value="Night">Night</option>
        </select>

        <select
          value={value.priority}
          onChange={(e) => update('priority', e.target.value as HandoverFiltersValue['priority'])}
          className={selectClass}
        >
          <option value="All">All priorities</option>
          <option value="Critical">Critical</option>
          <option value="High">High</option>
          <option value="Normal">Normal</option>
          <option value="Low">Low</option>
        </select>

        <select
          value={value.status}
          onChange={(e) => update('status', e.target.value as HandoverFiltersValue['status'])}
          className={selectClass}
        >
          <option value="All">All statuses</option>
          <option value="Open">Open</option>
          <option value="Monitoring">Monitoring</option>
          <option value="Resolved">Resolved</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="inline-flex items-center gap-2 text-sm text-fg-soft">
          <input
            type="checkbox"
            checked={value.unack}
            onChange={(e) => update('unack', e.target.checked)}
            className="accent-accent"
          />
          Awaiting ack
        </label>

        <label className="inline-flex items-center gap-2 text-sm text-fg-soft">
          <input
            type="checkbox"
            checked={value.carryForward}
            onChange={(e) => update('carryForward', e.target.checked)}
            className="accent-accent"
          />
          Carry-forward
        </label>

        <button
          type="button"
          onClick={clear}
          className="ml-auto rounded-md px-3 py-1.5 text-xs font-medium text-fg-mute transition-colors duration-150 ease-ease hover:text-accent"
        >
          {t('log.clearFilters')}
        </button>
      </div>
    </div>
  );
}
