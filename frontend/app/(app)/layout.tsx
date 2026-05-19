import { redirect } from 'next/navigation'

import { auth } from '@/auth'
import { AppShell } from '@/components/layout/AppShell'
import type { UserRole, UserSummary } from '@/lib/types'

import { Providers } from './Providers'

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

  return (
    <Providers>
      <AppShell
        user={user}
        unacknowledgedCriticalCount={0}
      >
        {children}
      </AppShell>
    </Providers>
  )
}
