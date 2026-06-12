/**
 * Edge-safe NextAuth.js v5 (Auth.js) configuration.
 *
 * This file MUST stay free of Prisma / bcrypt / Node-only imports
 * so it can be evaluated by Next.js middleware (Edge runtime). The
 * full configuration with the Prisma adapter and credentials
 * `authorize()` lives in `auth.ts`.
 */
import type { NextAuthConfig } from 'next-auth'
import type { UserRole } from './lib/types'

/**
 * Routes that do not require an authenticated session.
 * Anything else under `/app` defaults to "authenticated only".
 */
export const PUBLIC_ROUTES: readonly string[] = [
  '/signin',
  '/forbidden',
  '/api/auth',
]

/**
 * Route → roles allowed. Mirrors `shared/roles.md` (BR-12). Server-side
 * enforcement still happens in your Express endpoints; this matrix only
 * gates the Next.js UI surface.
 */
export const ROUTE_ROLES: ReadonlyArray<{
  prefix: string
  roles: ReadonlyArray<UserRole>
}> = [
  { prefix: '/admin', roles: ['ADMIN'] },
  { prefix: '/audit', roles: ['SUPERVISOR', 'MANAGEMENT_VIEWER', 'ADMIN'] },
  { prefix: '/handover/new', roles: ['OCC_STAFF', 'SUPERVISOR', 'ADMIN'] },
]

export const authConfig = {
  pages: {
    signIn: '/signin',
    error: '/signin',
  },
  session: { strategy: 'jwt' },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const path = nextUrl.pathname
      const isPublic = PUBLIC_ROUTES.some(
        (p) => path === p || path.startsWith(`${p}/`)
      )
      if (isPublic) return true

      const session = auth
      if (!session?.user) return false

      const role = session.user.role
      const restricted = ROUTE_ROLES.find((r) => path.startsWith(r.prefix))
      if (restricted && (!role || !restricted.roles.includes(role))) {
        const forbidden = new URL('/forbidden', nextUrl)
        return Response.redirect(forbidden)
      }
      return true
    },
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id
        token.role = (user as { role?: UserRole }).role
      }
      return token
    },
    session({ session, token }) {
      if (token.userId && token.role && session.user) {
        session.user.id = token.userId
        session.user.role = token.role
      }
      return session
    },
  },
  providers: [],
  secret: process.env.AUTH_SECRET,
} satisfies NextAuthConfig
