# Frontend Stubs — Friendly-Redesign Components

React + Tailwind component stubs distilled from the
[`prototype/`](../prototype/) folder. Drop into your **Next.js 14 (App Router)
+ TypeScript strict + Tailwind** project to get the redesigned UX (shift-aware
theming, critical banner, KPI deep-links, 3-step wizard, status timeline,
keyboard shortcuts, EN/VI toggle) without rebuilding from scratch.

These are **stubs** — they ship with no runtime dependencies on your project,
no data fetching, no auth wiring. You bring the data; they handle the look,
feel, and interaction patterns.

---

## What's included

```
frontend-stubs/
├── README.md                       ← you are here
├── tailwind.config.example.ts      ← extend your tailwind config
├── styles.global.example.css       ← copy into your globals.css
├── lib/
│   ├── types.ts                    ← matches shared/DATA_MODEL.md (no invented fields)
│   ├── i18n.ts                     ← VI / EN dictionaries + translate()
│   ├── format.ts                   ← formatDate / formatTime / shiftForTime / dayDiff
│   ├── permissions.ts              ← BR-12 capability matrix
│   ├── constants.ts                ← CATEGORIES, PRIORITY_ORDER, SHIFT_ORDER
│   └── cn.ts                       ← lightweight clsx
├── hooks/
│   ├── useTheme.ts                 ← light/dark, persists in cookie (NOT localStorage)
│   ├── useShiftTheme.ts            ← morning/afternoon/night accent
│   ├── useI18n.ts                  ← locale provider + t()
│   └── useKeyboardShortcuts.ts     ← N / D / L / A / T / / / ? / Esc
├── components/
│   ├── ui/
│   │   ├── Badge.tsx
│   │   ├── PriorityBadge.tsx
│   │   ├── StatusBadge.tsx
│   │   ├── AckBadge.tsx
│   │   ├── StatusTimeline.tsx      ← Open → Monitoring → Resolved (BR-05)
│   │   ├── FilterChip.tsx
│   │   ├── KpiCard.tsx
│   │   ├── EmptyState.tsx
│   │   └── Toast.tsx               ← ToastProvider + useToast
│   ├── layout/
│   │   ├── AppShell.tsx            ← topbar + sidebar + banner + content
│   │   ├── TopBar.tsx
│   │   ├── Sidebar.tsx
│   │   ├── CriticalBanner.tsx      ← BR-08 / BR-10
│   │   └── FloatingActionButton.tsx
│   ├── dashboard/
│   │   └── DashboardKpis.tsx       ← KPI grid with deep-links to /log?…
│   ├── handover/
│   │   ├── HandoverRow.tsx
│   │   ├── HandoverTable.tsx
│   │   ├── HandoverHeader.tsx
│   │   ├── HandoverFilters.tsx     ← chips + selects (Today / Last 7d / High+ / …)
│   │   ├── CategorySection.tsx     ← per-category items + toItemView() helper
│   │   ├── AcknowledgeButton.tsx   ← BR-10
│   │   ├── AuditTrail.tsx          ← BR-09
│   │   └── CarryForwardLink.tsx    ← BR-07
│   ├── admin/                      ← ADMIN-only console (BR-12)
│   │   ├── UsersTable.tsx          ← list + activity counters
│   │   ├── UserFilters.tsx         ← search + role chips + status select
│   │   ├── UserFormDialog.tsx      ← create + edit (no `passwordHash` on client)
│   │   └── UserDeactivateDialog.tsx← confirm soft-delete (`isActive=false`)
│   ├── reports/                    ← Reports & Export
│   │   ├── ReportFilters.tsx       ← date range, shift, priority, category
│   │   ├── ReportPreview.tsx       ← print-ready dataset (`@media print` aware)
│   │   └── ExportButton.tsx        ← CSV via API, browser print pipe
│   ├── auth/                       ← NextAuth.js v5 (Auth.js) wiring
│   │   ├── SignInLayout.tsx        ← branded auth shell
│   │   ├── SignInForm.tsx          ← credentials form (email + password)
│   │   ├── UserMenu.tsx            ← avatar dropdown + sign out (TopBar drop-in)
│   │   ├── RoleSwitcher.tsx        ← dev-only role switcher (gated to non-prod)
│   │   └── UnauthorizedView.tsx    ← 403 page (rendered by /forbidden)
│   ├── settings/                   ← Settings page (self-service)
│   │   ├── SettingsLayout.tsx      ← 2-col shell with hash routing
│   │   ├── SettingsNav.tsx         ← sidebar nav (Profile/Preferences/Security)
│   │   ├── ProfileSection.tsx      ← edit name (+ email/role for ADMIN)
│   │   ├── PreferencesSection.tsx  ← theme + locale + density + default shift
│   │   ├── SecuritySection.tsx     ← change password + sign-out-all-sessions
│   │   └── PasswordStrengthMeter.tsx ← length + char-class scoring
│   ├── cmdk/                       ← Command palette + shortcuts overlay
│   │   ├── CommandPalette.tsx      ← Cmd+K modal (fuzzy search, ↑↓, Enter)
│   │   └── ShortcutsOverlay.tsx    ← "?" modal listing all keyboard chords
│   └── wizard/
│       ├── HandoverWizard.tsx      ← 3-step orchestrator
│       ├── WizardStepper.tsx
│       ├── StepHeader.tsx
│       ├── StepCategories.tsx
│       └── StepReview.tsx
├── auth.config.example.ts          ← Edge-safe NextAuth.js v5 config
├── auth.example.ts                 ← Full Auth.js wiring + Prisma adapter
├── middleware.example.ts           ← Route guard middleware (uses authConfig)
├── next-auth.d.ts                  ← Module augmentation (role on Session/JWT)
└── examples/
    ├── dashboard/page.tsx
    ├── log/page.tsx
    ├── handover/page.tsx           ← detail
    ├── handover-new/page.tsx       ← wizard
    ├── admin/page.tsx              ← ADMIN users console
    ├── reports/page.tsx            ← Reports & Export
    ├── settings/page.tsx           ← Settings (self-service profile + prefs + security)
    ├── cmdk/page.tsx                ← page-scoped command registration sample
    └── auth/
        ├── route.example.ts        ← `app/api/auth/[...nextauth]/route.ts`
        ├── signin/page.tsx         ← `app/(auth)/signin/page.tsx`
        └── forbidden/page.tsx      ← `app/forbidden/page.tsx`
```

---

## Quick start (4 steps)

### 1. Copy the design tokens
- Append the contents of `styles.global.example.css` to your `app/globals.css`.
- Replace your `tailwind.config.ts` with `tailwind.config.example.ts` (or merge
  the `theme.extend` block into yours).

You should now see Tailwind utilities like
`bg-priority-critical-bg`, `text-priority-critical-fg`,
`border-shift`, `bg-accent-soft` resolve.

### 2. Copy the source folders into your frontend
```bash
# from your frontend repo root
cp -R /path/to/Handover-OCC-Project/frontend-stubs/lib            src/lib/handover-ui
cp -R /path/to/Handover-OCC-Project/frontend-stubs/hooks          src/hooks
cp -R /path/to/Handover-OCC-Project/frontend-stubs/components     src/components
```

(Or pick a subset — every component has explicit imports, so any subtree
can be copied independently as long as `lib/` and `hooks/` come along.)

### 3. Wrap your app with the providers
```tsx
// app/layout.tsx
import { I18nProvider } from '@/hooks/useI18n';
import { ToastProvider } from '@/components/ui/Toast';
import { cookies } from 'next/headers';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const themeCookie = cookies().get('occ_theme')?.value === 'dark' ? 'dark' : 'light';
  return (
    <html lang="vi" data-theme={themeCookie}>
      <body>
        <I18nProvider initialLocale="vi">
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
```

### 4. Drop in the example pages
The four files in `examples/` correspond directly to App Router routes:

| Stub                              | Place at                                      |
| --------------------------------- | --------------------------------------------- |
| `examples/dashboard/page.tsx`     | `app/(app)/dashboard/page.tsx`                |
| `examples/log/page.tsx`           | `app/(app)/log/page.tsx`                      |
| `examples/handover/page.tsx`      | `app/(app)/handover/[id]/page.tsx`            |
| `examples/handover-new/page.tsx`  | `app/(app)/handover/new/page.tsx`             |
| `examples/admin/page.tsx`         | `app/(admin)/users/page.tsx`                  |
| `examples/reports/page.tsx`       | `app/(app)/reports/page.tsx`                  |
| `examples/auth/signin/page.tsx`   | `app/(auth)/signin/page.tsx`                  |
| `examples/auth/forbidden/page.tsx`| `app/forbidden/page.tsx`                      |
| `examples/auth/route.example.ts`  | `app/api/auth/[...nextauth]/route.ts`         |
| `examples/settings/page.tsx`      | `app/(app)/settings/page.tsx`                 |

> Gate `app/(admin)/**` in your `middleware.ts` (or a layout-level
> auth guard) by checking `can(currentUser.role, 'manageUsers')` —
> the page itself defends in depth but server-side enforcement is the
> real gate (BR-12).

Each page has a comment block at the top showing exactly what to swap out
for real data fetching.

---

## Mapping: prototype feature → component

| Prototype feature                                   | React/Tailwind stub                                 |
| --------------------------------------------------- | --------------------------------------------------- |
| Shift-aware accent (morning/afternoon/night)        | `useShiftTheme` + `bg-shift` / `text-shift-fg`      |
| Light/dark toggle (T)                               | `useTheme` + `data-theme="dark"` selector           |
| EN/VI toggle                                        | `useI18n` + `<I18nProvider>`                        |
| Critical-unack banner                               | `<CriticalBanner ackAlert={…}>`                     |
| KPI cards w/ deep-link to log                       | `<DashboardKpis summary={…}>`                       |
| Smart filter chips                                  | `<FilterChip>` + `<HandoverFilters>`                |
| Carry-forward visual (left border + back-link card) | `border-l-shift` row + `<CarryForwardLink>`         |
| 3-step new-handover wizard                          | `<HandoverWizard>` + Step components                |
| Status timeline (Open → Monitoring → Resolved)      | `<StatusTimeline status={…}>`                       |
| Keyboard shortcuts (N / D / L / A / T / / / ? )     | `useKeyboardShortcuts(map)`                         |
| Audit trail                                         | `<AuditTrail entries={…}>`                          |
| Acknowledge with toast                              | `<AcknowledgeButton acknowledge={…}>` + `useToast`  |
| Admin user CRUD                                     | `<UsersTable>` + `<UserFormDialog>` + `<UserDeactivateDialog>` |
| Soft-delete user (BR-12, no hard delete)            | `<UserDeactivateDialog>` → `PATCH /api/v1/users/:id { isActive: false }` |
| Filtered reports + export                           | `<ReportFilters>` + `<ReportPreview>` + `<ExportButton>` |
| Print preview (CSS-driven)                          | `@media print` rules in `styles.global.example.css` + `print:hidden` |

---

## Admin Users page (BR-12 / ADMIN only)

Backed by `GET|POST /api/v1/users`, `PATCH /api/v1/users/:id`, and
`DELETE /api/v1/users/:id` (the DELETE endpoint sets `isActive=false`
— never hard-delete). The example page (`examples/admin/page.tsx`)
demonstrates:

- **List** with role chips, status select, full-text search.
- **Activity counters** (`handoversPreparedCount`, `handoversReceivedCount`)
  if your list endpoint returns them; the column is hidden otherwise.
- **Create / edit** via `<UserFormDialog>`. The dialog never asks for or
  echoes `passwordHash` — a fresh `password` field is sent to the server,
  which hashes it. Leaving it blank keeps the existing hash (or remains
  `null` for SSO-only users, per `shared/DATA_MODEL.md`).
- **Soft-delete** (`isActive=false`) via `<UserDeactivateDialog>`, which
  doubles as the reactivate dialog when the user is already inactive.
- **Permission guard** — `can(role, 'manageUsers')` returns true only for
  `ADMIN`, matching `shared/roles.md` and BR-12.

## Reports & Export page

Backed by `GET /api/v1/handovers/export/csv` (filtered list export) and,
for per-handover PDF, `GET /api/v1/handovers/:id/export/pdf` from the
detail page. The example page (`examples/reports/page.tsx`) demonstrates:

- **Filter form** — date range, shift, priority, category, and a couple
  of toggles. Round-trip to URL search params for shareable reports.
- **Preview** — `<ReportPreview>` renders a print-ready summary card +
  totals breakdown + flat handover table, all wrapped in
  `<div className="print-region">`.
- **Export** — `<ExportButton>` calls your `exportTo(format, filters)`
  callback; the easiest implementation is
  `window.location.href = '/api/v1/handovers/export/csv?…'` so the
  browser handles the download via `Content-Disposition`.
- **Print** — `window.print()` triggers the `@media print` rules in
  `styles.global.example.css`, which hide chrome (sidebar, top bar,
  toasts, FAB) and force the report to a clean white-on-black layout.

> ⚠️ **Per-handover PDF** lives on the **detail page**, not on Reports.
> Add an `<ExportButton allowPdf onPrint />` near the
> `<HandoverHeader>` and call `/api/v1/handovers/:id/export/pdf` from
> there. Reports = filtered list (CSV); Detail = single handover (PDF).

---

## Field-name fidelity (BR sanity-check)

- Every type in `lib/types.ts` mirrors `shared/DATA_MODEL.md` 1:1. **Do not
  add fields here** without first updating the canonical data model.
- The wizard never sets `referenceId` — it's generated server-side
  (BR-02). The example shows a placeholder until the API responds.
- `useTheme` writes to a cookie, **not** `localStorage` — production code
  in this repo is forbidden from touching `localStorage` (AGENTS.md "Do
  Not"). The prototype uses `localStorage` because it's a demo.
- `<AcknowledgeButton disabled>` should be set when
  `handover.preparedBy.id === currentUser.id` (BR-10 — cannot ack own
  handover). The example wires this up.
- `<CategorySection>` only renders fields that exist on `DATA_MODEL.md`.
  Use `toItemView(item, category)` to convert API shapes safely.
- `permissions.ts` mirrors the BR-12 / `shared/roles.md` matrix. Use
  `can(role, 'createHandover')` etc. for client-side hint-rendering, but
  always re-enforce in your route handlers.

---

## Settings page (self-service)

`<SettingsLayout>` is a hash-routed shell that hosts three self-service
sections without spawning three Next.js routes. Drop the example at
`app/(app)/settings/page.tsx` and link to it from `<UserMenu>`.

| Section       | Component                  | Backed by                                                 |
| ------------- | -------------------------- | --------------------------------------------------------- |
| Profile       | `<ProfileSection>`         | `GET\|PATCH /api/v1/users/me` (recommended new endpoint)  |
| Preferences   | `<PreferencesSection>`     | Cookies (`occ_theme`, `occ_locale`, `occ_density`, `occ_default_shift`) — no API |
| Security      | `<SecuritySection>`        | `POST /api/v1/users/me/password` + `POST /api/v1/users/me/sessions/revoke` (recommended new endpoints) |

Hash routing — `#profile` / `#preferences` / `#security` — means deep
links from emails or audit-trail entries land on the right section
without extra route files. The component listens to `hashchange` and
also writes back via `history.replaceState`, so back/forward navigation
within Settings stays smooth and never grows the history stack.

### Permissions

`<ProfileSection canEditPrivilegedFields={false}>` (default) leaves
`email` read-only and the `role` badge non-interactive — appropriate
for a user editing their own profile. Admins editing **someone else's**
profile should keep using `<UserFormDialog>` from PR #3 instead, since
that flow lives in `app/(admin)/users/page.tsx` and reuses the
`UserUpdateInput` shape.

### API gap

The endpoints listed above are **NOT** yet documented in
`shared/API_SPEC.md`. The stubs are written so an integrator can either:

1. **Add the recommended endpoints** (preferred — keeps the URL surface
   "/me"-shaped and lets the backend bind to `session.user.id`
   automatically).
2. **Reuse `PATCH /api/v1/users/:id`** with `id = session.user.id`. The
   backend authorization layer must reject non-self edits when the
   caller is not ADMIN. The `ChangePasswordInput` shape isn't usable
   here without a new endpoint, since the current admin update accepts
   a plain `password` field but does NOT verify `currentPassword`.

The `ChangePasswordInput` type carries a doc-comment flagging this gap.

### Password strength

`<PasswordStrengthMeter>` is a pure-React 4-bar meter scored by
`scorePassword()` (length + char-class heuristic, no `zxcvbn`
dependency). It's a UI hint only — server-side enforcement of password
policy is still required.

### What this is NOT

- Not a full session manager. The "Sign out from all sessions" CTA is
  optional; if you don't pass `onSignOutAllSessions`, the button is
  hidden.
- Not a 2FA enrolment flow. Add `<SecuritySection.TwoFactor>` later
  once the backend supports TOTP.
- Not a notification preferences screen. Add when push/email
  notifications land.

---

## Command palette (Cmd+K) + Shortcuts overlay (?)

`<AppShell>` now mounts a `<CommandPaletteProvider>` and renders both
overlays at the root of the layout. No additional wiring is required
— after copying the `frontend-stubs/` source, your existing pages get
the palette and shortcuts overlay for free.

### Default keystrokes

| Chord                  | What it does                                         |
| ---------------------- | ---------------------------------------------------- |
| `Cmd+K` / `Ctrl+K`     | Toggle the command palette (works inside text inputs) |
| `?`                    | Toggle the shortcuts overlay                         |
| `/`                    | Focus the topbar search                              |
| `Esc`                  | Close any open overlay                               |
| `N`                    | New handover                                         |
| `D`                    | Go to dashboard                                      |
| `L`                    | Go to handover log                                   |
| `T`                    | Toggle light/dark theme                              |
| `A`                    | Acknowledge (page-scoped — only on detail pages)     |

The single-letter chords are intentionally suppressed when focus is in
an `<input>`, `<textarea>`, `<select>` or `contenteditable` element.
`Cmd+K` is the only chord that intentionally works inside text inputs
so users can summon the palette without leaving the search box.

### Built-in commands

The default registry (in `lib/commands.ts`) ships with:

- **Navigation:** Dashboard, Handover Log, Reports (ADMIN/SUPERVISOR/MANAGEMENT_VIEWER), Admin Users (ADMIN), Settings
- **Actions:** New handover, Sign out (when `<AppShell onSignOut>` is provided)
- **Preferences:** Toggle theme, Toggle locale (VI/EN)
- **Help:** Show keyboard shortcuts

Each command carries a `group` for sectioned rendering, optional
`kbd` for the keyboard chord shown in both UIs, optional `keywords`
that the fuzzy matcher searches alongside the title, and optional
`availableWhen: ReadonlyArray<UserRole>` to gate visibility per role.

### Registering page-scoped commands

Any client component below `<AppShell>` can register additional
commands for the lifetime of that component:

```tsx
'use client';
import { useMemo } from 'react';
import { useRegisterCommands } from '@/hooks/useCommandPalette';

export function HandoverDetailCommands({ handoverId, onAcknowledge }: { handoverId: string; onAcknowledge: () => Promise<void> }) {
  const commands = useMemo(() => [
    {
      id: `handover.${handoverId}.acknowledge`,
      titleKey: 'detail.acknowledge' as const,
      group: 'actions' as const,
      kbd: { key: 'A' },
      icon: '✓',
      run: onAcknowledge,
    },
  ], [handoverId, onAcknowledge]);

  useRegisterCommands(commands);
  return null;
}
```

When the component unmounts, the commands disappear from the palette
and from the shortcuts overlay automatically. **Pass a stable
reference** (e.g. via `useMemo`) — re-creating the array on every
render would re-register every render and produce flicker.

A worked example lives in `examples/cmdk/page.tsx` (handover detail
case: Acknowledge / Carry forward / Export CSV).

### Fuzzy matcher

`lib/fuzzy.ts` is a tiny zero-dependency matcher (~50 lines) tuned for
command palettes:

- Match-at-start gets the highest bonus, then match-after-separator,
  then consecutive-run, then any-position.
- Distance between matches is a small negative tie-breaker so contiguous
  spans rank above scattered ones.
- `highlightMatch()` returns chunks tagged `match: true|false` for
  bolding matched characters in the rendered title.

Replace with `match-sorter` or `cmdk` (the npm package) if you want a
heavier matcher — the API surface is intentionally small.

### What this is NOT

- Not a global app store. The palette only knows about commands that
  have been registered with it; route-state is still owned by your app.
- Not a Spotlight clone. There's no recents/frecency tracking yet —
  the order is purely score-based. Add `localStorage`-free persistence
  later if you want recent commands sticky.
- Not a substitute for a search bar. Free-text fleet search ("HVN217",
  "VVNB") still belongs in the topbar `<input>` (`/` shortcut).

---

## NextAuth.js v5 (Auth.js) wiring

Tech-stack baseline (`AGENTS.md`) is **NextAuth.js v5** — the
modernised package name is `next-auth@5.x`, marketed as "Auth.js". The
stubs target this version, **not** v4.

### Files

| Stub                                | Place at                                |
| ----------------------------------- | --------------------------------------- |
| `auth.config.example.ts`            | `auth.config.ts` (project root)         |
| `auth.example.ts`                   | `auth.ts` (project root)                |
| `middleware.example.ts`             | `middleware.ts` (project root)          |
| `next-auth.d.ts`                    | `next-auth.d.ts` (project root)         |
| `examples/auth/route.example.ts`    | `app/api/auth/[...nextauth]/route.ts`   |
| `examples/auth/signin/page.tsx`     | `app/(auth)/signin/page.tsx`            |
| `examples/auth/forbidden/page.tsx`  | `app/forbidden/page.tsx`                |

### Why two config files?

`auth.config.ts` is **Edge-safe** — Next.js middleware runs on the Edge
runtime, which doesn't allow Node-only packages (`bcryptjs`,
`@prisma/client`). So we keep providers / adapter wiring in `auth.ts`
(Node) and only the JWT/session callbacks + route matrix in
`auth.config.ts` (Edge). The middleware imports the Edge-safe one.

This is the official Auth.js v5 split — see
<https://authjs.dev/getting-started/installation>.

### Required env

```dotenv
AUTH_SECRET=...           # openssl rand -base64 32
DATABASE_URL=...          # PostgreSQL — same as backend
```

### Module augmentation

`next-auth.d.ts` extends `Session.user` with `id` and `role` so
TypeScript-strict code can do:

```ts
const session = await auth();
if (session?.user.role === 'ADMIN') { … }
```

### Server-side guards

For Server Components / route handlers, prefer the helpers in
`lib/auth-helpers.ts`:

```ts
// app/(admin)/users/page.tsx
import { auth } from '@/auth';
import { requireCapability } from '@/lib/auth-helpers';

export default async function Page() {
  const user = await requireCapability(() => auth(), 'manageUsers');
  // ↑ throws a NEXT_REDIRECT to /forbidden if user lacks the capability
  return <UsersClient currentUser={user} />;
}
```

For client-only contexts (banners, hint-rendering), keep using
`can(role, capability)` from `lib/permissions.ts`.

### Dev-only role switcher

`<RoleSwitcher>` lets you impersonate a role in development to test
gating without bouncing through Auth.js. It's gated to
`process.env.NODE_ENV !== 'production'` and **only flips the local UI
state** — the real `auth()` session is unchanged, so server-side
checks remain accurate.

### What this isn't

- **Not a credentials backend.** `auth.example.ts` calls Prisma
  directly; if you'd rather hit your Express `/api/v1/auth/login`,
  swap the `authorize()` body to `fetch()` against your API and drop
  the `PrismaAdapter`.
- **Not OAuth.** Add providers in `auth.example.ts` once you decide on
  the IdP (Microsoft, Google, etc.).
- **Not a forgot-password flow.** The link is rendered but
  `app/forgot-password/page.tsx` is up to you.

---

## What's intentionally NOT included

- **No data fetching layer.** Use whatever you already have (server
  components calling `fetch`, React Query, SWR, …). The example pages
  show the seam.
- **No charting library.** The prototype uses Chart.js via a CDN — for a
  TypeScript-strict app, install `chart.js` + `react-chartjs-2` (or
  `recharts`) and feed it `summary.byCategory` / `summary.byPriority` /
  `summary.byShift`.
- **No localStorage.** Cookies for theme; use real APIs for everything
  else.

---

## TypeScript strict notes

- All components are typed against `lib/types.ts`. There is no `any`
  anywhere; the discriminated union helper `toItemView()` keeps category
  items type-safe.
- Hooks that need DOM (`useTheme`, `useShiftTheme`, `useKeyboardShortcuts`)
  carry the `'use client'` directive. Server components can still
  consume layout/UI primitives that don't.
- The `Toast` and `I18n` providers use `createContext` + `createElement`
  to avoid JSX in `.ts` files; you can refactor to JSX in `.tsx` if you
  prefer.
