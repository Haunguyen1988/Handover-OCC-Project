'use client';

import Link from 'next/link';
import { cn } from '../../lib/cn';
import { formatDate } from '../../lib/format';
import { PriorityBadge } from '../ui/PriorityBadge';
import { StatusBadge } from '../ui/StatusBadge';
import { AckBadge } from '../ui/AckBadge';
import { Badge } from '../ui/Badge';
import type { HandoverListRow } from '../../lib/types';

const SHIFT_LABEL: Record<HandoverListRow['shift'], string> = {
  Morning: 'Morning',
  Night: 'Night',
};

export interface HandoverRowProps {
  handover: HandoverListRow;
  /** Optional category code chips (left of priority). */
  categories?: ReadonlyArray<string>;
}

/**
 * Single row used in the dashboard "Recent" table and the Handover Log.
 * Carry-forward rows render with a coloured left border that matches the
 * shift accent (BR-07 visual flag).
 */
export function HandoverRow({ handover, categories = [] }: HandoverRowProps) {
  return (
    <Link
      href={`/handover/${handover.id}`}
      className={cn(
        'grid grid-cols-[10rem_10rem_minmax(0,1fr)_8rem_5rem_5rem_3rem_2rem] items-center gap-3 rounded-md border border-line bg-bg-elev px-3 py-2 text-sm transition hover:border-accent',
        handover.isCarriedForward && 'border-l-4 border-l-shift'
      )}
    >
      <div className="leading-tight">
        <div className="font-medium text-fg">{formatDate(handover.handoverDate)}</div>
        <div className="text-xs text-fg-mute">{SHIFT_LABEL[handover.shift]}</div>
      </div>
      <div className="font-mono text-xs text-fg-soft">{handover.referenceId}</div>
      <div className="truncate text-fg-soft">{handover.preparedBy.name}</div>
      <div className="flex flex-wrap gap-1">
        {categories.slice(0, 3).map((c) => (
          <Badge key={c} tone="neutral" className="uppercase">
            {c}
          </Badge>
        ))}
      </div>
      <PriorityBadge priority={handover.overallPriority} />
      <StatusBadge status={handover.overallStatus} />
      <span className="text-xs text-fg-mute">
        {handover.isCarriedForward ? <span title="Carry-forward">↺</span> : '—'}
      </span>
      <AckBadge acknowledgedAt={handover.acknowledgedAt} />
    </Link>
  );
}
