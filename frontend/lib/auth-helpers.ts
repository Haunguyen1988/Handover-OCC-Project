/**
 * Client-side route-guard helpers for the Next.js middleware.
 *
 * These determine whether a user should be redirected and which routes
 * are accessible without authentication.
 */

/**
 * Routes that are always accessible without authentication.
 */
const PUBLIC_PATHS = new Set(['/login', '/signin', '/forbidden'])

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
  if (PUBLIC_PATHS.has(path)) return true

  // Authenticated users can access all non-public routes.
  return isAuthenticated
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
  if (PUBLIC_PATHS.has(path)) return null

  // Unauthenticated user trying to access a protected page → login.
  if (!isAuthenticated) return '/login'

  // Authenticated user on login page → dashboard.
  if (isAuthenticated && (path === '/login' || path === '/signin')) {
    return '/dashboard'
  }

  return null
}
