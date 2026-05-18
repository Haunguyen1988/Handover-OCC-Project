/**
 * Auth helpers for the OCC Handover frontend.
 *
 * This module exposes two complementary sets of helpers:
 *
 * 1. Server-side helpers built on top of NextAuth.js v5 (`auth()` from
 *    `auth.ts`). Use these inside Server Components, route handlers, and
 *    server actions to read the current user and enforce role gates.
 *
 * 2. Client/middleware route-guard helpers used by `middleware.ts` to
 *    decide whether a request should be redirected based on auth state.
 *
 * The actual `auth()` function is exported from `auth.ts` (see
 * `auth.example.ts`). This file documents the helper shapes so your
 * page components can import them with full TypeScript safety.
 */
import type { UserRole, UserSummary } from './types';
import type { Capability } from './permissions';
import { can } from './permissions';

// ---------------------------------------------------------------------------
// Server-side helpers (Server Components / Route Handlers / Server Actions)
// ---------------------------------------------------------------------------

/**
 * Drop-in replacement for `auth()` returning a session-shaped object.
 * In your real app this is just:
 *
 *   import { auth } from '@/auth';
 *
 * Keeping the type narrowed here so the helpers below stay usable in
 * `frontend-stubs/` without depending on next-auth at type-check time.
 */
export interface SessionLike {
  user: UserSummary & { id: string; role: UserRole };
}

export type SessionGetter = () => Promise<SessionLike | null>;

/**
 * Returns the current user or `null` when unauthenticated. Caller is
 * responsible for redirecting to `/signin` when needed (or use
 * `requireUser`).
 */
export async function getCurrentUser(getSession: SessionGetter): Promise<SessionLike['user'] | null> {
  const session = await getSession();
  return session?.user ?? null;
}

/**
 * Throws a `Response` redirect to `/signin` when no session exists.
 * Use in Server Components/actions where the caller cannot tolerate
 * a `null` user.
 */
export async function requireUser(
  getSession: SessionGetter,
  signinUrl = '/signin'
): Promise<SessionLike['user']> {
  const user = await getCurrentUser(getSession);
  if (!user) throw redirect(signinUrl);
  return user;
}

/**
 * Throws a `Response` redirect to `/forbidden` when the current user
 * lacks the requested capability. Mirrors `requireRole` behaviour from
 * `shared/roles.md`.
 */
export async function requireCapability(
  getSession: SessionGetter,
  capability: Capability,
  forbiddenUrl = '/forbidden'
): Promise<SessionLike['user']> {
  const user = await requireUser(getSession);
  if (!can(user.role, capability)) throw redirect(forbiddenUrl);
  return user;
}

/**
 * Same as `requireCapability` but checks against an explicit role list
 * (useful when a route's allowed-role set is documented in
 * `shared/roles.md` but not yet captured as a Capability).
 */
export async function requireRole(
  getSession: SessionGetter,
  roles: ReadonlyArray<UserRole>,
  forbiddenUrl = '/forbidden'
): Promise<SessionLike['user']> {
  const user = await requireUser(getSession);
  if (!roles.includes(user.role)) throw redirect(forbiddenUrl);
  return user;
}

function redirect(url: string): never {
  // Server Components throw a Response to redirect — Next.js intercepts it.
  // The string error message keeps the throw informative when not running
  // inside a Next.js request (e.g. unit tests).
  const err = new Error(`REDIRECT:${url}`);
  (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
  throw err;
}

// ---------------------------------------------------------------------------
// Client / middleware route-guard helpers
// ---------------------------------------------------------------------------

/**
 * Routes that are always accessible without authentication.
 */
const PUBLIC_PATHS = new Set(['/login', '/signin', '/forbidden']);

/**
 * Check whether a path is accessible for the current auth state.
 *
 * @param path - The requested URL path.
 * @param isAuthenticated - Whether the user has a valid session.
 * @returns `true` if the user may proceed, `false` if a redirect is needed.
 */
export function isAuthorizedPath(
  path: string,
  isAuthenticated: boolean
): boolean {
  // Public pages are always accessible.
  if (PUBLIC_PATHS.has(path)) return true;

  // Authenticated users can access all non-public routes.
  return isAuthenticated;
}

/**
 * Determine where to redirect the user, or `null` if no redirect is needed.
 *
 * @param path - The requested URL path.
 * @param isAuthenticated - Whether the user has a valid session.
 * @returns Redirect target path, or `null` when no redirect is required.
 */
export function getAuthRedirectPath(
  path: string,
  isAuthenticated: boolean
): string | null {
  // Already on a public page → no redirect needed.
  if (PUBLIC_PATHS.has(path)) return null;

  // Unauthenticated user trying to access a protected page → login.
  if (!isAuthenticated) return '/login';

  // Authenticated user on login page → dashboard.
  if (isAuthenticated && (path === '/login' || path === '/signin')) {
    return '/dashboard';
  }

  return null;
}
