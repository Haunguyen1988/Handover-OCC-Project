/**
 * Example dashboard page (Next.js App Router).
 * Drop this at `app/(app)/dashboard/page.tsx` in your frontend.
 *
 * It demonstrates how to wire `<AppShell>` + `<DashboardKpis>` + the
 * recent-handovers table together against your existing data sources.
 */

import { AppShell } from '../../components/layout/AppShell';
import { DashboardKpis } from '../../components/dashboard/DashboardKpis';
import { HandoverTable } from '../../components/handover/HandoverTable';
import type { DashboardSummary, HandoverListRow, UserSummary } from '../../lib/types';

// 👇 Replace these with real fetchers (server components can call fetch()
//    against your Express API directly, no useEffect needed).
async function getCurrentUser(): Promise<UserSummary> {
  return { id: 'u-1', name: 'Lê Thu', role: 'OCC_STAFF' };
}
async function getDashboardSummary(): Promise<DashboardSummary> {
  return {
    totalHandovers: 6,
    openHandovers: 3,
    highOrCritical: 4,
    flightsAffected: 1064,
    awaitingAcknowledgment: 1,
    carriedForwardCount: 1,
    aircraftIssues: 3,
    byCategory: { aircraft: 3, airport: 2, flightSchedule: 4, crew: 2, weather: 1, system: 2, abnormal: 1 },
    byPriority: { Low: 1, Normal: 1, High: 3, Critical: 1 },
    byShift: { Morning: 2, Night: 2 },
    abnormalEventsByType: { AOG: 1, Diversion: 0 },
    ackAlert: {
      severity: 'breach',
      unackedCount: 1,
      criticalCount: 1,
      highCount: 0,
      oldestUnackedMinutes: 245,
    },
  };
}
async function getRecentHandovers(): Promise<HandoverListRow[]> {
  return [];
}

export default async function DashboardPage() {
  const [user, summary, handovers] = await Promise.all([
    getCurrentUser(),
    getDashboardSummary(),
    getRecentHandovers(),
  ]);

  return (
    <AppShell
      user={user}
      ackAlert={summary.ackAlert}
      recordCount={summary.totalHandovers}
    >
      <div className="flex flex-col gap-6">
        <header>
          <h1 className="text-2xl font-bold text-fg">Dashboard</h1>
          <p className="text-sm text-fg-mute">Active operational overview</p>
        </header>
        <DashboardKpis summary={summary} />
        <section>
          <header className="mb-2 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-fg">Recent handovers</h2>
            <a href="/log" className="text-sm text-accent hover:underline">View all →</a>
          </header>
          <HandoverTable handovers={handovers} />
        </section>
      </div>
    </AppShell>
  );
}
