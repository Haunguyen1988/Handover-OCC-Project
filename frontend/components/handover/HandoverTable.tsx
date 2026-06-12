'use client';

import { useI18n } from '../../hooks/useI18n';
import { EmptyState } from '../ui/EmptyState';
import { HandoverRow } from './HandoverRow';
import type { HandoverListRow } from '../../lib/types';

export interface HandoverTableProps {
  handovers: HandoverListRow[];
  /** Map of handoverId → category code chips, e.g. `{ "h-1": ["AC","SKED"] }`. */
  categoriesByHandover?: Record<string, string[]>;
  emptyAction?: React.ReactNode;
}

export function HandoverTable({ handovers, categoriesByHandover, emptyAction }: HandoverTableProps) {
  const { t } = useI18n();

  if (handovers.length === 0) {
    return <EmptyState title={t('log.empty.title')} body={t('log.empty.body')} action={emptyAction} />;
  }

  return (
    <div className="overflow-hidden rounded-md border border-line bg-bg-elev">
      <div className="grid grid-cols-[10rem_10rem_minmax(0,1fr)_8rem_5rem_5rem_3rem_2rem] gap-3 border-b border-line-soft bg-bg-row px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-mute">
        <div>Date · shift</div>
        <div>Reference</div>
        <div>Prepared by</div>
        <div>Categories</div>
        <div>Priority</div>
        <div>Status</div>
        <div>CF</div>
        <div>Ack</div>
      </div>
      <div className="divide-y divide-line-soft">
        {handovers.map((h) => (
          <HandoverRow
            key={h.id}
            handover={h}
            categories={categoriesByHandover?.[h.id] ?? []}
          />
        ))}
      </div>
    </div>
  );
}
