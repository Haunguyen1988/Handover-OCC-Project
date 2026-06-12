'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useI18n } from '../../hooks/useI18n';
import { formatAckAge } from '../../lib/format';
import type { AckAlert } from '../../lib/types';

/**
 * Persistent banner shown when 1+ High/Critical handovers are unacknowledged
 * (BR-08 / BR-10), summarised regardless of operational date so a Critical
 * handover left unacknowledged across a shift boundary stays visible.
 *
 * Pass the dashboard summary's `ackAlert`. Render conditionally so the banner
 * is removed entirely when there is nothing to surface (`severity === 'none'`).
 * A `breach` is styled with the Critical accent; a `warn` with the High accent.
 */
export interface CriticalBannerProps {
  ackAlert: AckAlert;
  reviewHref?: string;
}

const SEVERITY_CLASSES = {
  breach: {
    wrap: 'border-priority-critical/30 bg-priority-critical-bg text-priority-critical-fg',
    cta: 'bg-priority-critical text-white',
    dismiss: 'text-priority-critical-fg/70 hover:bg-priority-critical/10',
  },
  warn: {
    wrap: 'border-priority-high/30 bg-priority-high-bg text-priority-high-fg',
    cta: 'bg-priority-high text-white',
    dismiss: 'text-priority-high-fg/70 hover:bg-priority-high/10',
  },
} as const;

export function CriticalBanner({
  ackAlert,
  reviewHref = '/log?priority=Critical&unack=1',
}: CriticalBannerProps) {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(false);

  if (ackAlert.severity === 'none' || ackAlert.unackedCount <= 0 || dismissed) {
    return null;
  }

  const styles = SEVERITY_CLASSES[ackAlert.severity];
  const sub =
    ackAlert.severity === 'breach' ? t('banner.ackBreachSub') : t('banner.criticalSub');

  return (
    <div
      role="alert"
      className={`flex items-start justify-between gap-3 border-b px-4 py-3 ${styles.wrap}`}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden="true">⚠</span>
        <div>
          <div className="text-sm font-semibold">
            {t('banner.ackUnacked', { n: ackAlert.unackedCount })}
          </div>
          <div className="text-xs opacity-80">
            {t('banner.ackOldest', { age: formatAckAge(ackAlert.oldestUnackedMinutes) })} · {sub}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={reviewHref}
          className={`rounded-pill px-3 py-1.5 text-xs font-semibold shadow-soft hover:opacity-90 ${styles.cta}`}
        >
          {t('banner.reviewCta')}
        </Link>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className={`rounded-pill px-2 ${styles.dismiss}`}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
