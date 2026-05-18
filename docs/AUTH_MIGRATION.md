# Auth Bridge — Security Assessment & Migration Path

> **TL;DR:** The current backend auth mechanism is a shared-secret HMAC
> header scheme with a 5-minute replay window and no nonce store. It was
> introduced as a Phase-2 MVP bridge and is adequate for a pilot with
> controlled access, but **must be replaced before production** with
> proper session validation or short-lived JWTs.

---

## Current design

```
┌──────────────┐         x-occ-auth-* headers          ┌──────────────┐
│  Next.js     │  ──────────────────────────────────▶   │  Express     │
│  (frontend)  │  HMAC-SHA256(id:name:email:role:ts)    │  (backend)   │
└──────────────┘         signed with NEXTAUTH_SECRET    └──────────────┘
```

### How it works

1. **Frontend** reads the authenticated user from the NextAuth.js session.
2. **Frontend** builds a payload `id:name:email:role:timestamp` and signs
   it with `HMAC-SHA256(NEXTAUTH_SECRET)`.
3. **Frontend** sends 6 headers on every API call:
   - `x-occ-auth-user-id`
   - `x-occ-auth-user-name`
   - `x-occ-auth-user-email`
   - `x-occ-auth-user-role`
   - `x-occ-auth-timestamp` (epoch-ms)
   - `x-occ-auth-signature` (base64url HMAC)
4. **Backend** (`backend/src/lib/auth-bridge.ts`) recomputes the HMAC from
   the header values and `NEXTAUTH_SECRET`, then does a constant-time
   comparison. If it matches AND the timestamp is within 5 minutes of
   `Date.now()`, the user identity is attached to `req.user`.

### Files involved

| File | Role |
| --- | --- |
| `frontend/lib/backend-auth.ts` | Builds + signs the headers (client side) |
| `backend/src/lib/auth-bridge.ts` | Verifies the headers (server side) |
| `backend/src/middleware/auth.middleware.ts` | Calls `extractAuthenticatedUserFromRequest` |
| `scripts/perf-check.mjs` | Mints headers directly (bypasses frontend) |
| `tests/smoke/smoke.test.ts` | Mints headers directly (bypasses frontend) |

---

## Known security gaps

| # | Gap | Severity | Exploitability |
|---|-----|----------|----------------|
| 1 | **No nonce / request-ID** — any captured set of headers can be replayed within the 5-minute window. | High | Attacker with network access (e.g. shared WiFi, proxy logs) can replay API calls within the TTL. |
| 2 | **Shared static secret** — `NEXTAUTH_SECRET` is used both for NextAuth session encryption AND for backend HMAC signing. Compromise of either surface exposes the other. | High | If the secret leaks (env dump, log accident), an attacker can forge requests as any user/role indefinitely until the secret is rotated. |
| 3 | **No rate limiting on the backend** — there is no middleware throttling per-user or per-IP request rates. | Medium | Enables brute-force or credential-stuffing if combined with gap #2. |
| 4 | **Role embedded in header, not re-fetched** — the backend trusts the role claim from the signed header. If a user's role changes in the DB, stale signed headers (up to 5 min old) still carry the old elevated role. | Low | Very narrow window; mostly a correctness concern. |
| 5 | **Clock skew only defence** — the 5-min `MAX_CLOCK_SKEW_MS` window is generous; a shorter TTL (e.g. 30s) + server-side nonce store would tighten it significantly. | Low | Reduction of replay window is a hardening measure. |

---

## Recommended migration path

### Option A: Short-lived JWT (preferred for this stack)

Replace the HMAC header scheme with a proper JWT issued by NextAuth and
verified by the backend.

**Steps:**

1. **NextAuth `jwt` callback** already runs on every request. Extend it to
   mint a short-lived (60s) signed JWT containing `{ sub, name, email, role, iat, exp }`.
   Store it in the session token (already available via `auth()` on the
   server side).

2. **Frontend API layer** reads the JWT from the session and sends it as a
   standard `Authorization: Bearer <jwt>` header.

3. **Backend middleware** verifies the JWT signature using `NEXTAUTH_SECRET`
   (or a dedicated `BACKEND_JWT_SECRET`) and checks `exp`. No HMAC
   reconstruction needed — just `jose.jwtVerify(token, secret)`.

4. **Remove** the 6 `x-occ-auth-*` headers, `frontend/lib/backend-auth.ts`,
   and `backend/src/lib/auth-bridge.ts`.

5. **Update** smoke + perf scripts to obtain a real JWT via the NextAuth
   credentials flow (or keep a test-only token-minting helper gated
   behind `NODE_ENV !== 'production'`).

**Pros:** Standard, auditable, short-lived tokens, no replay concern.
**Cons:** Slightly more complex session plumbing; requires `jose` or
similar JWT library on the backend.

### Option B: Server-side session lookup

Instead of signing user identity into headers, the frontend sends the
NextAuth session cookie and the backend validates it against the same
session store (Prisma adapter).

**Steps:**

1. Configure NextAuth to use `strategy: 'database'` sessions (already
   the case with the Prisma adapter).
2. Frontend sends its session cookie on cross-origin requests (requires
   `credentials: 'include'` and correct CORS).
3. Backend reads the session cookie, queries the `Session` table (or
   calls a shared `getServerSession()` helper).
4. Remove HMAC headers entirely.

**Pros:** Simplest conceptually; leverages NextAuth's built-in security.
**Cons:** Requires same-origin or careful CORS; adds a DB round-trip per
request (mitigated with a short in-memory cache).

### Option C: Hardened HMAC (quick fix, not a long-term solution)

If Options A/B are blocked by timeline, harden the current scheme:

1. **Add a nonce** — include a random UUID in the signed payload and
   store seen nonces in a Redis/memory set with 5-min TTL. Reject
   duplicates.
2. **Shorten the clock-skew window** from 5 min to 30s.
3. **Split secrets** — use a dedicated `BACKEND_AUTH_SECRET` separate
   from `NEXTAUTH_SECRET`.
4. **Add rate limiting** — per-user sliding window (e.g. `express-rate-limit`
   with 100 req/min per user ID).

---

## When to migrate

| Phase | Auth mechanism | Acceptable? |
|-------|---------------|-------------|
| Phase 4 (pilot, controlled access) | Current HMAC bridge | Yes — known users on a private network |
| Phase 5 (production, public-facing) | **Must be Option A or B** | Current scheme is NOT acceptable |

The pilot assessment (`docs/pilot-assessment.md`) already flags auth
hardening as a Phase-5 prerequisite. This document provides the
implementation roadmap.

---

## Testing the migration

Regardless of which option is chosen, the existing test coverage should
continue to pass:

- `tests/unit/auth.test.ts` — tests `createBackendAuthHeaders` (Option C
  keeps it; Options A/B replace it with JWT/cookie assertions).
- `tests/smoke/smoke.test.ts` — tests the full flow. Update the header
  builder to mint a JWT or obtain a session cookie.
- `scripts/perf-check.mjs` — same change as the smoke test.

The backend's `requireRole` middleware is auth-mechanism-agnostic — it
reads `req.user` which is set by whatever replaces `auth-bridge.ts`.
