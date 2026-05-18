# Frontend — OCC Handover System

> **Status:** Work in progress. The Next.js 14 frontend app is being
> assembled from the component stubs in [`../frontend-stubs/`](../frontend-stubs/).

## Directory layout

```
frontend/
├── README.md              ← you are here
├── package.json           ← minimal manifest (deps to be added as pages land)
└── lib/
    ├── backend-auth.ts    ← HMAC header builder (consumed by the backend smoke/perf scripts)
    └── auth-helpers.ts    ← route-guard helpers for Next.js middleware
```

## Background

This directory was previously registered as a git submodule pointing at
commit `9ff695bb` with no `.gitmodules` file, making it unresolvable.
PR #10 (or whichever resolved this) removed the broken gitlink and
replaced it with a regular tracked directory containing the minimum
modules needed for the test suite to compile (`tests/unit/auth.test.ts`
imports from `frontend/lib/`).

## What goes here next

Once the frontend app is ready:

1. Copy/migrate components from `frontend-stubs/` into a Next.js 14 App
   Router structure under this directory.
2. Wire `next-auth` v5 using the configs in `frontend-stubs/auth.*.ts`.
3. Update `package.json` with the full dependency tree.
4. Run `npm --prefix frontend ci && npm --prefix frontend run build` to
   verify the Dockerfile still works.
