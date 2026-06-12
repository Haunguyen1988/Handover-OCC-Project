'use client';

import Link from 'next/link';
import { useI18n } from '../../hooks/useI18n';
import { formatDate, formatDateTime } from '../../lib/format';
import { Badge } from '../ui/Badge';
import { PriorityBadge } from '../ui/PriorityBadge';
import { StatusBadge } from '../ui/StatusBadge';
import { AckBadge } from '../ui/AckBadge';
import type { HandoverDetail } from '../../lib/types';

const SHIFT_LABEL_KEY = {
  Morning: 'shift.morning',
  Night: 'shift.night',
} as const;

export interface HandoverHeaderProps {
  handover: HandoverDetail;
  rightSlot?: React.ReactNode;
}

export function HandoverHeader({ handover, rightSlot }: HandoverHeaderProps) {
  const { t } = useI18n();
  return (
    <header className="rounded-md border border-line bg-bg-elev p-4 shadow-soft border-l-4 border-l-shift">
      <Link href="/log" className="text-xs text-fg-mute hover:text-accent">
        ← {t('detail.back')}
      </Link>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-fg">
          {t(SHIFT_LABEL_KEY[handover.shift])} · {formatDate(handover.handoverDate)}
        </h1>
        <PriorityBadge priority={handover.overallPriority} />
        <StatusBadge status={handover.overallStatus} />
        <AckBadge acknowledgedAt={handover.acknowledgedAt} />
        {handover.isCarriedForward && <Badge tone="shift">↺ Carried forward</Badge>}
        <div className="ml-auto flex items-center gap-2">{rightSlot}</div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-fg-mute">{t('detail.reference')}</dt>
          <dd className="font-mono text-fg">{handover.referenceId}</dd>
        </div>
        <div>
          <dt className="text-fg-mute">{t('detail.preparedBy')}</dt>
          <dd className="text-fg">{handover.preparedBy.name}</dd>
        </div>
        <div>
          <dt className="text-fg-mute">{t('detail.handedTo')}</dt>
          <dd className="text-fg">{handover.handedTo?.name ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-fg-mute">{t('detail.submittedAt')}</dt>
          <dd className="text-fg">{formatDateTime(handover.submittedAt)}</dd>
        </div>
        <div>
          <dt className="text-fg-mute">{t('detail.acknowledgedAt')}</dt>
          <dd className="text-fg">{formatDateTime(handover.acknowledgedAt)}</dd>
        </div>
      </dl>
      {handover.generalRemarks && (
        <p className="mt-3 text-sm text-fg-soft">
          <span className="font-semibold">{t('detail.summary')}:</span> {handover.generalRemarks}
        </p>
      )}
      {handover.nextShiftActions && (
        <p className="mt-1 text-sm text-fg-soft">
          <span className="font-semibold">{t('detail.nextActions')}:</span> {handover.nextShiftActions}
        </p>
      )}
    </header>
  );
}
