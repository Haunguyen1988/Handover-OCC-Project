/**
 * Client-side HMAC header builder for authenticated backend API calls.
 *
 * The Next.js frontend calls the Express backend with these signed headers
 * so the backend can verify the caller's identity without sharing a session
 * store. The backend counterpart lives at `backend/src/lib/auth-bridge.ts`.
 *
 * Security note: this is NOT a substitute for proper JWT or session auth.
 * It was introduced as a minimal bridge during the Phase-2 MVP and should
 * be replaced with a real auth mechanism before production (see
 * docs/AUTH_MIGRATION.md once it exists).
 */
import { createHmac } from 'node:crypto'

export type BackendAuthUser = {
  id: string
  name: string
  email: string
  role: string
}

/**
 * Build the `x-occ-auth-*` headers that the Express backend verifies via
 * HMAC-SHA256 in `backend/src/lib/auth-bridge.ts`.
 *
 * @param user - The authenticated user identity from the NextAuth session.
 * @param timestamp - Epoch-ms string. Pass explicitly in tests; omit in
 *   production to use `Date.now()`.
 */
export function createBackendAuthHeaders(
  user: BackendAuthUser,
  timestamp?: string
): Record<string, string> {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET

  if (!secret) {
    throw new Error(
      'NEXTAUTH_SECRET or AUTH_SECRET must be set to sign backend auth headers.'
    )
  }

  const ts = timestamp ?? Date.now().toString()
  const payload = [user.id, user.name, user.email, user.role, ts].join(':')
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url')

  return {
    'x-occ-auth-user-id': user.id,
    'x-occ-auth-user-name': user.name,
    'x-occ-auth-user-email': user.email,
    'x-occ-auth-user-role': user.role,
    'x-occ-auth-timestamp': ts,
    'x-occ-auth-signature': signature,
  }
}
