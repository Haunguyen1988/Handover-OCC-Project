/**
 * Example New Handover page. Drop at `app/(app)/handover/new/page.tsx`.
 *
 * Notice how the wizard NEVER passes `referenceId`. That is generated
 * server-side in `submitDraft` (BR-02). The wizard receives the new
 * handover id back and routes to its detail page.
 */

'use client';

import { AppShell } from '../../components/layout/AppShell';
import { HandoverWizard, type HandoverDraft } from '../../components/wizard/HandoverWizard';
import type { UserSummary } from '../../lib/types';

const DEMO_USER: UserSummary = { id: 'u-1', name: 'Lê Thu', role: 'OCC_STAFF' };

const RECIPIENTS: UserSummary[] = [
  { id: 'u-2', name: 'Nguyễn Hậu', role: 'SUPERVISOR' },
  { id: 'u-3', name: 'Trần Minh', role: 'MANAGEMENT_VIEWER' },
];

async function submitDraft(_draft: HandoverDraft) {
  // 👉 Replace with your real fetcher:
  //    const res = await fetch('/api/v1/handovers', { method: 'POST', body: JSON.stringify(draft) });
  //    return res.json();
  return { id: 'h-new', referenceId: 'HDO-2026-001376' };
}

export default function NewHandoverPage() {
  return (
    <AppShell
      user={DEMO_USER}
      ackAlert={{ severity: 'none', unackedCount: 0, criticalCount: 0, highCount: 0, oldestUnackedMinutes: 0 }}
    >
      <HandoverWizard recipients={RECIPIENTS} submitDraft={submitDraft} />
    </AppShell>
  );
}
