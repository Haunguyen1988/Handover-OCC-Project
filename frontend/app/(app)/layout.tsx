import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { AppShell } from '@/components/layout/AppShell'
import { backendFetch } from '@/lib/server/api-client'
import {
  EMPTY_DASHBOARD_SUMMARY,
  type BackendDashboardSummary,
} from '@/lib/dashboard/mapDashboardSummary'
import type { AckAlert, UserRole, UserSummary } from '@/lib/types'

import { Providers } from './Providers'

/**
 * Fetch just the stale-unacked High/Critical summary for the persistent
 * banner. Guarded so a backend hiccup degrades to a hidden banner instead
 * of crashing the whole app shell.
 */
async function loadAckAlert(): Promise<AckAlert> {
  try {
    const summary = await backendFetch<BackendDashboardSummary>(
      '/api/v1/dashboard/summary',
    )
    return summary.ackAlert ?? EMPTY_DASHBOARD_SUMMARY.ackAlert
  } catch {
    return EMPTY_DASHBOARD_SUMMARY.ackAlert
  }
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user) {
    redirect('/signin')
  }

  const user: UserSummary = {
    id: session.user.id,
    name: session.user.name ?? session.user.email ?? 'User',
    email: session.user.email ?? undefined,
    role: session.user.role as UserRole,
  }

  const ackAlert = await loadAckAlert()

  return (
    <Providers>
      <AppShell user={user} ackAlert={ackAlert}>
        {children}
      </AppShell>
    </Providers>
  )
}
