# Business Rules - OCC Handover System

> **Agent instruction:** Every rule here must be enforced in code - either in Zod schema validation,
> Prisma middleware, or the service layer. Do not skip any rule. Reference rule IDs in code comments.

---

## BR-01 - Mandatory Handover Fields

Every handover record MUST have:
- `handoverDate` - the operational date
- `shift` - Morning / Night
- `preparedById` - user creating the handover
- `overallPriority` - Low / Normal / High / Critical

**Enforcement:** Zod schema + Prisma not-null constraints.

```typescript
// Comment in code: // BR-01: mandatory handover fields
```

**Implementation:** `backend/src/schemas/handover.schema.ts` - `CreateHandoverSchema` and `UpdateHandoverSchema` validate required fields; `database/schema.prisma` - required columns remain non-null.
**Test file:** `tests/unit/schemas/handover.schema.test.ts`

---

## BR-02 - Unique Reference ID

Every handover MUST have a system-generated `referenceId`. It is:
- Auto-generated on creation (format: `HDO-YYYY-NNNNNN`)
- Never editable by any user
- Never reused, even after deletion

**Enforcement:** Generate in service layer before `prisma.handover.create()`. Never accept from client.

**Implementation:** `backend/src/services/handover.service.ts` - generate `referenceId` server-side before create; `backend/src/schemas/handover.schema.ts` - reject client-supplied `referenceId`; `database/migrations/*_handover_reference_seq.sql` - create the monotonic `handover_reference_seq` used by the service.
**Test file:** `tests/unit/services/handover.service.test.ts`

---

## BR-03 - Open Items Remain Visible

Any handover item (across all categories) with `status = Open` or `status = Monitoring` MUST:
- Appear on the active dashboard
- Be included in carry-forward logic (see BR-07)
- Never be hidden from log view

**Enforcement:** Dashboard query must always include `status: { in: ['Open', 'Monitoring'] }` when building active work views.

**Implementation:** `backend/src/services/dashboard.service.ts` - active dashboard aggregates only open and monitoring items; `backend/src/services/carry-forward.service.ts` - clones open and monitoring items only; `backend/src/services/handover-query.service.ts` - detail and log views exclude only soft-deleted records, not open or monitoring items.
**Test file:** `tests/unit/services/dashboard.service.test.ts`

---

## BR-04 - Critical / High Priority Highlighting

Handover records or items with `priority = Critical` or `priority = High` MUST:
- Be visually flagged on the dashboard (frontend)
- Appear at the top of all list views (sort: priority DESC, then createdAt DESC)
- Trigger ownership requirement (see BR-06)

**Enforcement:** Sort order enforced in all list queries. Frontend applies visual badges.

**Implementation:** `backend/src/services/handover-query.service.ts` - sort all relevant lists by priority then `createdAt`; `frontend/src/components/priority-badge.tsx` - render high/critical visual treatment on cards, tables, and dashboard widgets.
**Test file:** `tests/unit/services/handover-query.service.test.ts`

---

## BR-05 - Status Transition Rules

Valid status transitions for any item:

```text
Open -> Monitoring
Open -> Resolved
Monitoring -> Open
Monitoring -> Resolved
Resolved -> (no further transition allowed)
```

**Enforcement:** Validate in service layer. Return `400 STATUS_TRANSITION_INVALID` if violated.

```typescript
const VALID_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  Open: ['Monitoring', 'Resolved'],
  Monitoring: ['Open', 'Resolved'],
  Resolved: [],
}
```

**Implementation:** `backend/src/services/item.service.ts` - validate transitions before mutation; `backend/src/schemas/item-status-transition.schema.ts` - validate the PATCH payload structure for status changes.
**Test file:** `tests/unit/services/item.service.test.ts`

---

## BR-06 - Ownership Required for High/Critical Open Items

If an item has:
- `status = Open` AND `priority = High` or `priority = Critical`

Then `ownerId` MUST be set.

**Enforcement:** Zod `.superRefine()` check on item schemas. Return `400 OWNER_REQUIRED`.

**Implementation:** `backend/src/schemas/item.schema.ts` - shared base item schema `.superRefine()` enforces owner presence when open/high or open/critical; the same schema is reused by the frontend form.
**Test file:** `tests/unit/schemas/item.schema.test.ts`

---

## BR-07 - Carry-Forward Logic

When a shift ends (or a handover is submitted), all items with `status = Open` or `status = Monitoring` MUST be carried forward to the next shift handover automatically.

Rules:
- Carried items set `isCarriedForward = true` on the new handover
- `carriedFromId` is set to the source handover ID
- Carried items preserve original `priority`, `status`, `ownerId`, and `dueTime`
- Carry-forward creates a new item record - it does NOT move the original
- Carried items are flagged visually in the UI (frontend badge: "Carried Forward")

**Enforcement:** `carryForwardOpenItems(sourceHandoverId, targetHandoverId)` service function. Called when a new handover is created for the next shift. The explicit API endpoint is retained as a supervisor/admin backfill or recovery trigger.

**Implementation:** `backend/src/services/carry-forward.service.ts` - implement `carryForwardOpenItems(sourceHandoverId, targetHandoverId)`; `backend/src/services/handover.service.ts` - invoke automatic carry-forward during next-shift creation/submission; `backend/src/routes/handovers.ts` - expose the manual `/carry-forward` endpoint for supervisor/admin retry flows.
**Test file:** `tests/unit/services/carry-forward.service.test.ts`

---

## BR-08 - Abnormal Event Required Fields

For `AbnormalEvent` records:
- `description` is always required (min 20 characters)
- `flightsAffected` is required if `eventType` is `AOG` or `Diversion`
- `notificationRef` is required if `priority` is `Critical`

**Enforcement:** Zod `.superRefine()` on `AbnormalEventSchema`.

**Implementation:** `backend/src/schemas/abnormal-event.schema.ts` - `.superRefine()` checks description length, conditional `flightsAffected`, and conditional `notificationRef`.
**Test file:** `tests/unit/schemas/abnormal-event.schema.test.ts`

---

## BR-09 - Audit Trail on All Mutations

Every write operation (create, update, status change, delete) MUST write to `AuditLog`:

| Action | Trigger |
| --- | --- |
| `CREATED` | New handover or item created |
| `UPDATED` | Any field on existing record changed |
| `STATUS_CHANGED` | `status` field specifically changed |
| `ACKNOWLEDGED` | Incoming shift acknowledges handover |
| `CARRIED_FORWARD` | Item carried to next shift |
| `DELETED` | Record soft-deleted (see BR-11) |

`oldValue` and `newValue` must capture a JSON snapshot of changed fields only (not the entire record).

**Implementation:** `backend/src/services/audit.service.ts` - `writeAuditLog()` computes changed-field snapshots only; `backend/src/services/handover.service.ts`, `backend/src/services/item.service.ts`, `backend/src/services/acknowledgment.service.ts`, and `backend/src/services/carry-forward.service.ts` call it after every mutation.
**Test file:** `tests/unit/services/audit.service.test.ts`

---

## BR-10 - Incoming Shift Acknowledgment

For handovers with `overallPriority = High` or `Critical`, the incoming shift user MUST acknowledge before the handover is considered complete.

- Acknowledgment is recorded in `Acknowledgment` table
- `Handover.acknowledgedAt` is set at time of first acknowledgment
- Cannot acknowledge own handover (`preparedById != acknowledging userId`)
- Multiple users can acknowledge the same handover

**Enforcement:** Service layer check. Return `403 CANNOT_ACK_OWN_HANDOVER` if violated.

**Implementation:** `backend/src/services/acknowledgment.service.ts` - block self-acknowledgment, insert `Acknowledgment`, and set the first `handover.acknowledgedAt`; `backend/src/routes/handovers.ts` - expose the acknowledge endpoint.
**Test file:** `tests/unit/services/acknowledgment.service.test.ts`

### Stale-acknowledgment surfacing and escalation (ack-alert)

Because acknowledgment can lapse across a shift/day boundary, a High/Critical
handover left unacknowledged is surfaced in three tiers:

- **Tier 1 — dashboard signal.** `GET /api/v1/dashboard/summary` returns an
  `ackAlert` object counting every still-unacknowledged High/Critical handover
  **regardless of date**, with a `severity` of `none` / `warn` / `breach`.
  Critical unacked ≥ 15 min is `breach`; High unacked ≥ 60 min is `warn`.
  Thresholds live in `backend/src/services/ackAlert.service.ts`.
- **Tier 2 — banner.** The dashboard critical banner reads `ackAlert` and shows
  the oldest waiting age, coloured by severity.
- **Tier 3 — push escalation.** An in-process scheduler
  (`backend/src/services/ackAlertScheduler.ts`) sweeps for handovers that have
  crossed into `breach` and POSTs a generic webhook (Slack/Teams compatible)
  once per handover. The push is deduped via `Handover.breachAlertedAt`, so each
  breach escalates at most once; acknowledging the handover removes it from the
  sweep permanently. Disabled unless `ACK_ALERT_WEBHOOK_URL` is set.

**Implementation:** `backend/src/services/ackAlertNotifier.service.ts` (`findBreachingHandovers`, `runAckAlertSweep`), `backend/src/services/ackAlertScheduler.ts` (`startAckAlertScheduler`).
**Test files:** `tests/unit/services/ackAlert.service.test.ts`, `tests/unit/services/ackAlertNotifier.service.test.ts`, `tests/unit/services/ackAlertScheduler.test.ts`

---

## BR-11 - Soft Delete Only

Handover records and items must NEVER be hard-deleted from the database. They must be archived:
- Add `deletedAt DateTime?` field to `Handover` and all item models
- All queries MUST filter `WHERE deletedAt IS NULL` by default
- Only `SUPERVISOR` or `ADMIN` role can soft-delete

**Enforcement:** Prisma middleware excludes soft-deleted records from default queries, and delete endpoints set `deletedAt` instead of removing rows.

```typescript
prisma.$use(async (params, next) => {
  if (params.action === 'findMany' || params.action === 'findFirst') {
    params.args.where = { ...params.args.where, deletedAt: null }
  }
  return next(params)
})
```

**Implementation:** `database/schema.prisma` - `deletedAt` fields on `Handover` and every item model; `backend/src/middleware/soft-delete.ts` - inject default `deletedAt: null` filters; `backend/src/routes/handovers.ts` and `backend/src/routes/items.ts` - soft-delete endpoints update `deletedAt` instead of calling hard delete.
**Test file:** `tests/unit/middleware/soft-delete.test.ts`

---

## BR-12 - Role-Based Access Matrix

| Action | OCC_STAFF | SUPERVISOR | MANAGEMENT_VIEWER | ADMIN |
| --- | --- | --- | --- | --- |
| Create handover | Yes | Yes | No | Yes |
| View own handovers | Yes | Yes | Yes | Yes |
| View all handovers | No | Yes | Yes | Yes |
| Update open items | Yes | Yes | No | Yes |
| Close / resolve items | Yes | Yes | No | Yes |
| Delete records | No | Yes | No | Yes |
| Manage users | No | No | No | Yes |
| Export / download | Yes | Yes | Yes | Yes |
| View audit log | No | Yes | Yes | Yes |

**Enforcement:** `requireRole([...roles])` middleware on every protected route, plus ownership checks for OCC staff.

**Implementation:** `backend/src/middleware/require-role.ts` - route-level authorization; `backend/src/middleware/require-ownership.ts` - enforce own-handover and own-item restrictions; `shared/roles.md` - full endpoint-to-role matrix for all API routes.
**Test file:** `tests/unit/middleware/authorization.test.ts`

---

## BR-13 - Category Activation

If a category section (Aircraft, Airport, Crew, etc.) is activated in the form, at minimum ONE item must be entered for that category.

**Enforcement:** Frontend form validation. Also enforced in API: if category array is `[]` (empty array), return `400 CATEGORY_ACTIVATED_BUT_EMPTY`.

**Implementation:** `frontend/src/features/handovers/handover-form.tsx` - prevent submit when an activated category is empty; `backend/src/schemas/handover.schema.ts` - reject empty arrays for activated categories.
**Test file:** `tests/unit/schemas/handover.schema.test.ts`

---

## BR-14 - Due Time Constraint

Item `dueTime` must be:
- In the future at time of item creation
- Within 72 hours of the handover date (operational constraint)

**Enforcement:** Zod `.refine()` on item schemas.

**Implementation:** `backend/src/schemas/item.schema.ts` - validate future due time and 72-hour window relative to `handoverDate`; frontend uses the same rule for inline feedback.
**Test file:** `tests/unit/schemas/item.schema.test.ts`

---

## BR-15 - Resolved Items Are Immutable

Once any item's `status` is set to `Resolved`, no fields can be edited except `remarks`.

**Enforcement:** Service layer check before any update. Return `409 ITEM_RESOLVED_IMMUTABLE`.

**Implementation:** `backend/src/services/item.service.ts` - reject any post-resolution field changes other than `remarks`; `backend/src/routes/items.ts` - surface `409 ITEM_RESOLVED_IMMUTABLE`.
**Test file:** `tests/unit/services/item.service.test.ts`
