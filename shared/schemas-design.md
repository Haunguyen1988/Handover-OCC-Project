# Schema Design — OCC Handover System

> **The Zod schemas live in code, not in this document.**
>
> This file used to contain a parallel TypeScript draft of the Phase-2
> Zod schemas. It drifted from the real implementation (e.g. it modelled
> `categories.aircraft.array.min(1)` while the implemented schema rejects
> empty activated categories via a separate `superRefine`). To prevent
> the drift recurring, we treat the implementation as canonical and link
> to it from here.

## Where to find the schemas

| Concern | File |
| --- | --- |
| Shared helpers (date/time strings, enums, owner / dueTime validators) | [`backend/src/schemas/shared.schema.ts`](../backend/src/schemas/shared.schema.ts) |
| Handover create / update payloads | [`backend/src/schemas/handover.schema.ts`](../backend/src/schemas/handover.schema.ts) |
| Per-category item create / update payloads (7 categories) | [`backend/src/schemas/item.schema.ts`](../backend/src/schemas/item.schema.ts) |
| Item status transition matrix (BR-05) | [`backend/src/schemas/item-status-transition.schema.ts`](../backend/src/schemas/item-status-transition.schema.ts) |

Each schema enforces a documented business rule. Comments inside the
files reference the BR-01…BR-14 numbers from
[`shared/BUSINESS_RULES.md`](./BUSINESS_RULES.md).

## Field-level rules

The validation invariants the Zod schemas enforce are summarised in the
"Field Validation Rules" table in
[`shared/DATA_MODEL.md`](./DATA_MODEL.md), which links each rule to the
exact schema function that enforces it.

## API contracts

For the request / response shapes that consume these schemas, see
[`shared/API_SPEC.md`](./API_SPEC.md).
