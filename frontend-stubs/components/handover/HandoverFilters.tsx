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

  return (
    <div className="flex flex-col gap-3">
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

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 min-w-[200px] flex-col text-xs text-fg-mute">
          <span className="sr-only">Search</span>
          <input
            type="search"
            placeholder={t('topbar.search')}
            value={value.search}
            onChange={(e) => update('search', e.target.value)}
            className="rounded-md border border-line bg-bg-elev px-3 py-1.5 text-sm text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
          />
        </label>

        <select
          value={value.shift}
          onChange={(e) => update('shift', e.target.value as HandoverFiltersValue['shift'])}
          className="min-w-[140px] rounded-md border border-line bg-bg-elev px-2 py-1.5 text-sm"
        >
          <option value="All">All shifts</option>
          <option value="Morning">Morning</option>
          <option value="Night">Night</option>
        </select>

        <select
          value={value.priority}
          onChange={(e) => update('priority', e.target.value as HandoverFiltersValue['priority'])}
          className="min-w-[140px] rounded-md border border-line bg-bg-elev px-2 py-1.5 text-sm"
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
          className="min-w-[140px] rounded-md border border-line bg-bg-elev px-2 py-1.5 text-sm"
        >
          <option value="All">All statuses</option>
          <option value="Open">Open</option>
          <option value="Monitoring">Monitoring</option>
          <option value="Resolved">Resolved</option>
        </select>

        <label className="inline-flex items-center gap-1 text-sm text-fg-soft">
          <input
            type="checkbox"
            checked={value.unack}
            onChange={(e) => update('unack', e.target.checked)}
          />
          Awaiting ack
        </label>

        <label className="inline-flex items-center gap-1 text-sm text-fg-soft">
          <input
            type="checkbox"
            checked={value.carryForward}
            onChange={(e) => update('carryForward', e.target.checked)}
          />
          Carry-forward
        </label>

        <button
          type="button"
          onClick={clear}
          className="ml-auto rounded-md border border-line px-3 py-1.5 text-xs text-fg-soft hover:border-accent hover:text-accent"
        >
          {t('log.clearFilters')}
        </button>
      </div>
    </div>
  );
}
