<!-- PHASE 1 APPROVED -->

# Data Model — OCC Handover System

> **Canonical schema lives in code, not here.**
> See [`database/prisma/schema.prisma`](../database/prisma/schema.prisma).
> Drift between the Prisma schema and `frontend-stubs/lib/types.ts` is
> caught on every `npm test` run by `scripts/check-schema-drift.mjs`.
>
> This document keeps the **rules and contracts** that don't live in the
> Prisma schema itself: enum names that are referenced by external systems,
> reference-ID format, and field-level validation rules that the Zod
> schemas in `backend/src/schemas/` enforce at runtime.

---

## Models at a glance

The Prisma schema declares 10 models and 5 enums. See
[`schema.prisma`](../database/prisma/schema.prisma) for the canonical
definitions.

| Model | Purpose |
| --- | --- |
| `User` | Authenticated identity. Has a nullable `passwordHash` so SSO-only users can exist. Soft-delete uses `isActive=false`, never a hard delete. |
| `Handover` | One row per shift handover. Owns the seven operational item collections, the audit trail, and acknowledgments. Soft-deleted via `deletedAt`. |
| `AircraftItem` / `AirportItem` / `FlightScheduleItem` / `CrewItem` / `WeatherItem` / `SystemItem` / `AbnormalEvent` | The seven operational categories. Each carries `status`, `priority`, optional `ownerId`, optional `dueTime`, and category-specific fields. Soft-deleted via `deletedAt`; cascade-deleted from their `Handover`. |
| `AuditLog` | Append-only mutation log. Written for every `CREATED` / `UPDATED` / `STATUS_CHANGED` / `ACKNOWLEDGED` / `CARRIED_FORWARD` / `DELETED` action by `backend/src/services/audit.service.ts`. |
| `Acknowledgment` | One row per `(handoverId, userId)`. Enforces BR-10 (one ack per user per handover). |

| Enum | Members |
| --- | --- |
| `Shift` | `Morning`, `Afternoon`, `Night` |
| `Priority` | `Low`, `Normal`, `High`, `Critical` |
| `ItemStatus` | `Open`, `Monitoring`, `Resolved` |
| `UserRole` | `OCC_STAFF`, `SUPERVISOR`, `MANAGEMENT_VIEWER`, `ADMIN` |
| `AuditAction` | `CREATED`, `UPDATED`, `STATUS_CHANGED`, `ACKNOWLEDGED`, `CARRIED_FORWARD`, `DELETED` |

---

## Reference ID Format

Every `Handover` carries a unique `referenceId` of the form
`HDO-YYYY-NNNNNN` (e.g. `HDO-2026-000042`). The suffix is monotonic and
backed by the database sequence `handover_reference_seq` (see
`database/prisma/migrations/20260423095500_add_handover_reference_seq/`).

Generation runs server-side only (BR-02 — never accept `referenceId` from
the client) inside a transaction. The implementation lives at
[`backend/src/services/handover.service.ts → generateReferenceId`](../backend/src/services/handover.service.ts).

```typescript
// Format: HDO-YYYY-NNNNNN
// Example: HDO-2026-000042
// Backed by `handover_reference_seq`. Never derived from count() —
// deletes and concurrent creates would collide.
const result = await db.$queryRawUnsafe<Array<{ value: bigint | number }>>(
  "SELECT nextval('handover_reference_seq') AS value"
)
const sequenceValue = result[0]?.value
const year = new Date().getUTCFullYear()
return `HDO-${year}-${sequenceValue.toString().padStart(6, '0')}`
```

---

## Field Validation Rules

These are the runtime invariants the Zod schemas in
[`backend/src/schemas/`](../backend/src/schemas/) enforce on every API
write. The Prisma schema itself is intentionally permissive on most of
these (e.g. `dueTime` is just `DateTime?`); the rules live in Zod so
identical messages appear on the client and server.

| Field | Rule | Enforced by |
| --- | --- | --- |
| `Handover.handoverDate` | Required. Cannot be more than 7 days in the past. Cannot be future. | `handover.schema.ts` (BR-01) |
| `Handover.shift` | Required. One of `Morning` / `Afternoon` / `Night`. | `shared.schema.ts` enum |
| `Handover.preparedById` | Required. Must reference an active `User`. | `handover.service.ts → ensureActiveUsers` |
| `User.passwordHash` | Required for credentials-authenticated users. Nullable only for SSO-only users. | `auth-bridge.ts` + admin user-management routes |
| `Handover.overallPriority` | Required. Defaults to `Normal`. | `handover.schema.ts` |
| `Handover.referenceId` | Auto-generated. Never user-supplied. | `handover.service.ts → generateReferenceId` (BR-02) |
| `Handover.categories.<name>` | If activated, must contain at least one item; cannot be an empty array. | `handover.schema.ts → validateActivatedCategories` (BR-13) |
| `AbnormalEvent.flightsAffected` | Required if `eventType` is `AOG` or `Diversion`. | `item.schema.ts → AbnormalEventSchema` (BR-08) |
| `AbnormalEvent.notificationRef` | Required if `priority` is `Critical`. | `item.schema.ts → AbnormalEventSchema` (BR-08) |
| Item `dueTime` | Must be a valid ISO datetime, in the future at creation, and within 72 hours of the parent `handoverDate`. | `shared.schema.ts → validateDueTimeWindow` / `validateDueTimeSyntax` (BR-14) |
| Item `ownerId` | Required when `status = Open` AND `priority ∈ { High, Critical }`. | `shared.schema.ts → validateOwnerRequiredForOpenHighPriorityItem` (BR-06) |
| Item status transition | `Open ↔ Monitoring`, `Open → Resolved`, `Monitoring → Resolved`. `Resolved` is terminal. | `item-status-transition.schema.ts → ItemStatusTransitionSchema` (BR-05) |
| Soft delete | All seven item models and `Handover` use `deletedAt`. The Prisma extension in `backend/src/lib/prisma.ts` auto-filters reads and update writes; hard `delete` calls are reserved for the dev seed only. | `lib/prisma.ts` |

For the full BR-01…BR-14 narrative, see
[`shared/BUSINESS_RULES.md`](./BUSINESS_RULES.md).
For the API surface that exposes these models, see
[`shared/API_SPEC.md`](./API_SPEC.md).
