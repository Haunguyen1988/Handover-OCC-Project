/**
 * Example Handover Detail page. Drop at `app/(app)/handover/[id]/page.tsx`.
 *
 * Wires the header, category sections, acknowledge button, and audit
 * trail together. The acknowledge action is intentionally a stub so you
 * can plug in either a server action or a client-side fetch.
 */

import { AppShell } from '../../components/layout/AppShell';
import { HandoverHeader } from '../../components/handover/HandoverHeader';
import { CategorySection, toItemView } from '../../components/handover/CategorySection';
import { AcknowledgeButton } from '../../components/handover/AcknowledgeButton';
import { AuditTrail } from '../../components/handover/AuditTrail';
import { CarryForwardLink } from '../../components/handover/CarryForwardLink';
import type {
  AuditLogEntry,
  CategoryCode,
  HandoverDetail,
  UserSummary,
} from '../../lib/types';

interface DetailProps {
  user: UserSummary;
  handover: HandoverDetail;
  audit: AuditLogEntry[];
  acknowledge: () => Promise<{ acknowledgedAt: string; referenceId: string }>;
}

const CATEGORY_TUPLES: ReadonlyArray<[CategoryCode, keyof HandoverDetail]> = [
  ['aircraft', 'aircraftItems'],
  ['airport', 'airportItems'],
  ['flightSchedule', 'flightScheduleItems'],
  ['crew', 'crewItems'],
  ['weather', 'weatherItems'],
  ['system', 'systemItems'],
  ['abnormal', 'abnormalEvents'],
];

export default function HandoverDetailPage({ user, handover, audit, acknowledge }: DetailProps) {
  const own = handover.preparedBy.id === user.id;
  return (
    <AppShell
      user={user}
      ackAlert={
        handover.acknowledgedAt
          ? { severity: 'none', unackedCount: 0, criticalCount: 0, highCount: 0, oldestUnackedMinutes: 0 }
          : { severity: 'breach', unackedCount: 1, criticalCount: 1, highCount: 0, oldestUnackedMinutes: 245 }
      }
      shiftOverride={handover.shift}
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-4">
          <HandoverHeader
            handover={handover}
            rightSlot={
              <AcknowledgeButton
                acknowledge={acknowledge}
                disabled={own /* BR-10: cannot ack own handover */}
                alreadyAcknowledged={Boolean(handover.acknowledgedAt)}
              />
            }
          />
          {handover.carriedFromId && handover.carriedFromReference && (
            <CarryForwardLink
              sourceId={handover.carriedFromId}
              sourceReference={handover.carriedFromReference}
            />
          )}
          {CATEGORY_TUPLES.map(([code, key]) => {
            const items = handover[key] as Array<Parameters<typeof toItemView>[0]>;
            return (
              <CategorySection
                key={code}
                category={code}
                items={items.map((it) => toItemView(it, code))}
              />
            );
          })}
        </div>
        <AuditTrail entries={audit} />
      </div>
    </AppShell>
  );
}
