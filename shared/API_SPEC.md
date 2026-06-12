# API Specification — OCC Handover System

> **Agent instruction:** Implement every endpoint listed here. Use the exact URL paths, HTTP methods,
> request/response shapes, and status codes specified. Do not invent new endpoints without updating this file.

**Base URL:** `/api/v1`
**Auth:** All endpoints require a valid session (NextAuth). See role requirements per endpoint.

---

## Authentication

### `POST /api/auth/[...nextauth]`
Handled by NextAuth.js. Support credentials provider (email + password) and optional SSO.

---

## Handovers

### `GET /api/v1/handovers`
List handovers with filtering, sorting, pagination.

**Roles:** All authenticated users (OCC_STAFF sees own; SUPERVISOR+ sees all)

**Query params:**
```
?status=Open,Monitoring     // comma-separated ItemStatus values
?priority=High,Critical     // comma-separated Priority values
?shift=Morning              // Shift enum
?from=2025-01-01            // date range start (ISO 8601 date)
?to=2025-12-31              // date range end
?search=AOG                 // full-text search in remarks/items
?carriedForwardOnly=true    // only carried-forward handovers
?mine=true                  // only handovers prepared by the current user
?overdueOnly=true           // only handovers with overdue active items
?page=1                     // default 1
?limit=20                   // default 20, max 100
?sortBy=createdAt           // field name
?sortOrder=desc             // asc | desc
```

**Response 200:**
```json
{
  "data": [
    {
      "id": "clx...",
      "referenceId": "HDO-2025-000001",
      "handoverDate": "2025-06-15",
      "shift": "Morning",
      "preparedBy": { "id": "...", "name": "John Smith" },
      "handedTo": { "id": "...", "name": "Jane Doe" },
      "overallPriority": "High",
      "overallStatus": "Open",
      "isCarriedForward": false,
      "itemCounts": {
        "open": 3,
        "monitoring": 1,
        "resolved": 2
      },
      "createdAt": "2025-06-15T06:00:00Z",
      "acknowledgedAt": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 145,
    "totalPages": 8
  }
}
```

---

### `POST /api/v1/handovers`
Create a new handover.

**Roles:** OCC_STAFF, SUPERVISOR, ADMIN

**Request body:**
```json
{
  "handoverDate": "2025-06-15",
  "shift": "Morning",
  "handedToId": "clx...",
  "overallPriority": "High",
  "generalRemarks": "Busy morning, multiple issues outstanding.",
  "nextShiftActions": "1. Monitor AXA123 AOG status\n2. Follow up crew positioning for PMI route",
  "categories": {
    "aircraft": [
      {
        "registration": "9M-XXA",
        "type": "A320",
        "issue": "AOG – hydraulic leak discovered at gate C12",
        "status": "Open",
        "priority": "Critical",
        "flightsAffected": "AXA123, AXA456",
        "ownerId": "clx...",
        "dueTime": "2025-06-15T12:00:00Z",
        "remarks": "Engineering team engaged. ETA 4 hours."
      }
    ],
    "weather": [
      {
        "affectedArea": "WMKK",
        "weatherType": "Thunderstorm",
        "issue": "CB activity east of field, expect 30 min delay window",
        "status": "Monitoring",
        "priority": "High",
        "flightsAffected": "AXA789, AXA790"
      }
    ]
  }
}
```

**Response 201:**
```json
{
  "id": "clx...",
  "referenceId": "HDO-2025-000042",
  "createdAt": "2025-06-15T06:05:00Z"
}
```

**Errors:**
- `400 VALIDATION_FAILED` — Zod error details
- `400 CATEGORY_ACTIVATED_BUT_EMPTY` — BR-13
- `400 OWNER_REQUIRED` — BR-06
- `409 DUPLICATE_SHIFT_HANDOVER` — same date + shift already has an active handover

---

### `GET /api/v1/handovers/:id`
Get full handover detail including all category items.

**Roles:** All authenticated. OCC_STAFF restricted to own handovers.

**Response 200:**
```json
{
  "id": "clx...",
  "referenceId": "HDO-2025-000042",
  "handoverDate": "2025-06-15",
  "shift": "Morning",
  "preparedBy": { "id": "...", "name": "John Smith" },
  "handedTo": { "id": "...", "name": "Jane Doe" },
  "overallPriority": "High",
  "overallStatus": "Open",
  "generalRemarks": "...",
  "nextShiftActions": "...",
  "isCarriedForward": false,
  "carriedFromId": null,
  "submittedAt": "2025-06-15T06:10:00Z",
  "acknowledgedAt": null,
  "categories": {
    "aircraft": [ { ...AircraftItem } ],
    "airport": [],
    "flightSchedule": [],
    "crew": [],
    "weather": [ { ...WeatherItem } ],
    "system": [],
    "abnormalEvents": []
  },
  "auditLog": [
    {
      "action": "CREATED",
      "user": { "name": "John Smith" },
      "createdAt": "2025-06-15T06:05:00Z",
      "oldValue": null,
      "newValue": null
    }
  ],
  "acknowledgments": []
}
```

---

### `PATCH /api/v1/handovers/:id`
Update handover header fields or overall status.

**Roles:** OCC_STAFF (own only), SUPERVISOR, ADMIN

**Request body (partial):**
```json
{
  "overallPriority": "Critical",
  "generalRemarks": "Updated remarks",
  "nextShiftActions": "Updated actions"
}
```

**Response 200:** Updated handover (same shape as GET)

---

### `DELETE /api/v1/handovers/:id`
Soft-delete a handover and archive its child items in the same transaction.

**Roles:** SUPERVISOR, ADMIN

**Response 200:**
```json
{
  "id": "clx...",
  "deletedAt": "2025-06-15T15:00:00Z"
}
```

**Notes:**
- This endpoint performs soft delete only.
- The implementation sets `deletedAt` on the handover and its child items.
- Soft-deleted handovers are excluded from default queries.

---

### `POST /api/v1/handovers/:id/acknowledge`
Incoming shift acknowledges the handover.

**Roles:** OCC_STAFF, SUPERVISOR (cannot be same user as preparedBy)

**Request body:**
```json
{ "notes": "Acknowledged. Will monitor AOG situation." }
```

**Response 200:**
```json
{ "acknowledgedAt": "2025-06-15T14:00:00Z" }
```

**Errors:**
- `403 CANNOT_ACK_OWN_HANDOVER` — BR-10

---

### `POST /api/v1/handovers/:id/carry-forward`
Carry all Open/Monitoring items to a new handover.

**Roles:** SUPERVISOR, ADMIN

**Notes:**
- This endpoint is the manual carry-forward trigger for supervisor/admin recovery or backfill flows.
- Automatic carry-forward still runs in the service layer when the next shift handover is created or submitted, per BR-07.

**Request body:**
```json
{ "targetHandoverId": "clx..." }
```

**Response 200:**
```json
{
  "carriedItemCount": 5,
  "targetHandoverId": "clx..."
}
```

---

## Handover Items (per category)

> All item endpoints follow the same pattern. Replace `:category` with:
> `aircraft` | `airport` | `flight-schedule` | `crew` | `weather` | `system` | `abnormal-events`

### `POST /api/v1/handovers/:id/items/:category`
Add a new item to a category.

**Roles:** OCC_STAFF (own handover), SUPERVISOR, ADMIN

**Response 201:** Created item with `id`

---

### `PATCH /api/v1/handovers/:id/items/:category/:itemId`
Update an existing item (fields or status).

**Roles:** OCC_STAFF (own handover items), SUPERVISOR, ADMIN

**Errors:**
- `409 ITEM_RESOLVED_IMMUTABLE` — BR-15
- `400 STATUS_TRANSITION_INVALID` — BR-05

---

### `DELETE /api/v1/handovers/:id/items/:category/:itemId`
Soft-delete an item.

**Roles:** SUPERVISOR, ADMIN only

---

## Dashboard

### `GET /api/v1/dashboard/summary`
KPI summary for the dashboard.

**Roles:** All authenticated

**Response 200:**
```json
{
  "today": {
    "totalHandovers": 3,
    "openItems": 12,
    "monitoringItems": 4,
    "resolvedItems": 8,
    "criticalItems": 2,
    "unacknowledgedHighPriority": 1,
    "flightsAffected": 7,
    "byPriority": { "Low": 0, "Normal": 1, "High": 1, "Critical": 1 },
    "byShift": { "Morning": 1, "Night": 1 },
    "abnormalEventsByType": { "AOG": 2, "Diversion": 1 }
  },
  "trend7Days": [
    { "date": "2025-06-09", "open": 5, "resolved": 3 },
    { "date": "2025-06-10", "open": 7, "resolved": 6 }
  ],
  "priorityHeatmap7Days": [
    { "date": "2025-06-09", "unresolvedCount": 4, "criticalCount": 1 },
    { "date": "2025-06-10", "unresolvedCount": 0, "criticalCount": 0 }
  ],
  "unresolvedByCategory": [
    {
      "category": "aircraft",
      "openCount": 3,
      "monitoringCount": 1,
      "oldestOpenDate": "2025-06-09"
    },
    {
      "category": "crew",
      "openCount": 4,
      "monitoringCount": 2,
      "oldestOpenDate": "2025-06-08"
    }
  ],
  "shiftComparison7Days": [
    { "date": "2025-06-09", "Morning": 2, "Night": 1 },
    { "date": "2025-06-10", "Morning": 1, "Night": 0 }
  ],
  "openByCategory": {
    "aircraft": 3,
    "airport": 1,
    "flightSchedule": 2,
    "crew": 4,
    "weather": 1,
    "system": 1,
    "abnormalEvents": 0
  },
  "carriedForwardCount": 5,
  "overdueItems": 2,
  "itemsDueInNext2Hours": 1,
  "ackAlert": {
    "severity": "breach",
    "unackedCount": 3,
    "criticalCount": 2,
    "highCount": 1,
    "oldestUnackedMinutes": 245
  }
}
```

`ackAlert` summarises every still-unacknowledged High/Critical handover
**regardless of operational date** (unlike `today.unacknowledgedHighPriority`,
which is scoped to the current day). This keeps a Critical handover that was
left unacknowledged across a shift boundary visible instead of silently
dropping off when the day rolls over.

- `severity`: `"none" | "warn" | "breach"` — the more urgent of the Critical
  and High classifications. Critical unacked ≥ 15 min is `breach`; High unacked
  ≥ 60 min is `warn`. Thresholds live in `backend/src/services/ackAlert.service.ts`.
- `unackedCount`: total unacknowledged High + Critical handovers.
- `criticalCount` / `highCount`: per-priority breakdown.
- `oldestUnackedMinutes`: age in minutes of the oldest unacknowledged handover.

`ackAlert` is the read side (Tier 1). The same breach signal also drives an
out-of-band push (Tier 3): a backend scheduler
(`backend/src/services/ackAlertScheduler.ts`) periodically POSTs a generic
webhook for each handover that crosses into `breach`, deduped via
`Handover.breachAlertedAt` so a breach escalates at most once. This is not an
HTTP endpoint clients call — it is enabled by setting `ACK_ALERT_WEBHOOK_URL`
(and optionally `ACK_ALERT_SWEEP_INTERVAL_MS`) in the backend environment, and
is disabled entirely when that variable is unset. See BR-10 for the full
three-tier description.

---

## Export

### `GET /api/v1/handovers/:id/export/pdf`
Generate printable PDF summary of one handover.

**Roles:** All authenticated

**Response:** `Content-Type: application/pdf` binary

---

### `GET /api/v1/handovers/export/csv`
Export filtered handover list as CSV.

**Roles:** All authenticated

**Query params:** Same as `GET /api/v1/handovers`

**Response:** `Content-Type: text/csv` with `Content-Disposition: attachment; filename=handovers-export.csv`

---

## Users (Admin only)

### `GET /api/v1/users`
List all users.

**Roles:** ADMIN only

### `POST /api/v1/users`
Create a user.

### `PATCH /api/v1/users/:id`
Update user role or active status.

### `DELETE /api/v1/users/:id`
Deactivate user (soft delete — set `isActive = false`).

---

## Audit Log

### `GET /api/v1/handovers/:id/audit`
Get full audit trail for a handover.

**Roles:** SUPERVISOR, MANAGEMENT_VIEWER, ADMIN

**Response 200:**
```json
{
  "data": [
    {
      "id": "...",
      "action": "STATUS_CHANGED",
      "targetModel": "AircraftItem",
      "targetId": "...",
      "user": { "id": "...", "name": "John Smith" },
      "oldValue": { "status": "Open" },
      "newValue": { "status": "Monitoring" },
      "createdAt": "2025-06-15T08:30:00Z"
    }
  ]
}
```

---

## Error Response Format

All errors follow this shape:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description",
  "details": {}
}
```

Standard HTTP status codes:
- `400` — Validation or business rule failure
- `401` — Not authenticated
- `403` — Authenticated but not authorized (wrong role)
- `404` — Record not found
- `409` — Conflict (duplicate, immutable record)
- `500` — Internal server error (never expose stack trace in production)
