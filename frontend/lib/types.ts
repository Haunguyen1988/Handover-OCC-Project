/**
 * Shared TypeScript types for the OCC Handover frontend.
 *
 * These mirror `shared/DATA_MODEL.md` 1:1. Do NOT invent fields here —
 * if you need a new field, add it to the data model first.
 *
 * BR-02: never accept `referenceId` from the client; the server generates it.
 */

export type Shift = 'Morning' | 'Night';

export type Priority = 'Low' | 'Normal' | 'High' | 'Critical';

export type ItemStatus = 'Open' | 'Monitoring' | 'Resolved';

export type AckAlertSeverity = 'none' | 'warn' | 'breach';

export type UserRole = 'OCC_STAFF' | 'SUPERVISOR' | 'MANAGEMENT_VIEWER' | 'ADMIN';

export type AuditAction =
  | 'CREATED'
  | 'UPDATED'
  | 'STATUS_CHANGED'
  | 'ACKNOWLEDGED'
  | 'CARRIED_FORWARD'
  | 'DELETED';

export type CategoryCode =
  | 'aircraft'
  | 'airport'
  | 'flightSchedule'
  | 'crew'
  | 'weather'
  | 'system'
  | 'abnormal';

export interface UserSummary {
  id: string;
  name: string;
  email?: string;
  role?: UserRole;
}

export interface ItemCounts {
  open: number;
  monitoring: number;
  resolved: number;
}

/** Shape returned by `GET /api/v1/handovers` list rows. */
export interface HandoverListRow {
  id: string;
  referenceId: string;
  handoverDate: string; // ISO date `YYYY-MM-DD`
  shift: Shift;
  preparedBy: UserSummary;
  handedTo: UserSummary | null;
  overallPriority: Priority;
  overallStatus: ItemStatus;
  isCarriedForward: boolean;
  itemCounts: ItemCounts;
  createdAt: string; // ISO datetime
  acknowledgedAt: string | null;
}

/** Common item fields shared by every category record. */
export interface BaseItem {
  id: string;
  handoverId: string;
  status: ItemStatus;
  priority: Priority;
  flightsAffected?: string | null;
  ownerId?: string | null;
  owner?: UserSummary | null;
  dueTime?: string | null;
  remarks?: string | null;
  resolvedAt?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AircraftItem extends BaseItem {
  registration: string;
  type?: string | null;
  issue: string;
}

export interface AirportItem extends BaseItem {
  airport: string;
  issue: string;
}

export interface FlightScheduleItem extends BaseItem {
  flightNumber: string;
  route?: string | null;
  issue: string;
}

export interface CrewItem extends BaseItem {
  crewId?: string | null;
  crewName?: string | null;
  role?: string | null;
  issue: string;
}

export interface WeatherItem extends BaseItem {
  affectedArea: string;
  weatherType: string;
  issue: string;
}

export interface SystemItem extends BaseItem {
  systemName: string;
  issue: string;
}

export interface AbnormalEvent extends BaseItem {
  eventType: string;
  description: string;
  notificationRef?: string | null;
}

export type AnyItem =
  | AircraftItem
  | AirportItem
  | FlightScheduleItem
  | CrewItem
  | WeatherItem
  | SystemItem
  | AbnormalEvent;

/** Shape returned by `GET /api/v1/handovers/:id`. */
export interface HandoverDetail {
  id: string;
  referenceId: string;
  handoverDate: string;
  shift: Shift;
  preparedBy: UserSummary;
  handedTo: UserSummary | null;
  overallPriority: Priority;
  overallStatus: ItemStatus;
  generalRemarks?: string | null;
  nextShiftActions?: string | null;
  isCarriedForward: boolean;
  carriedFromId?: string | null;
  carriedFromReference?: string | null;
  submittedAt?: string | null;
  acknowledgedAt?: string | null;
  createdAt: string;
  updatedAt: string;

  aircraftItems: AircraftItem[];
  airportItems: AirportItem[];
  flightScheduleItems: FlightScheduleItem[];
  crewItems: CrewItem[];
  weatherItems: WeatherItem[];
  systemItems: SystemItem[];
  abnormalEvents: AbnormalEvent[];
}

export interface AuditLogEntry {
  id: string;
  handoverId: string;
  user: UserSummary;
  action: AuditAction;
  targetModel: string;
  targetId: string;
  oldValue?: unknown;
  newValue?: unknown;
  createdAt: string;
}

export interface DashboardSummary {
  totalHandovers: number;
  openHandovers: number;
  highOrCritical: number;
  flightsAffected: number;
  awaitingAcknowledgment: number;
  carriedForwardCount: number;
  aircraftIssues: number;
  byCategory: Record<CategoryCode, number>;
  byPriority: Record<Priority, number>;
  byShift: Record<Shift, number>;
  abnormalEventsByType: Record<string, number>;
  ackAlert: AckAlert;
}

/**
 * Stale unacknowledged High/Critical handovers, summarised regardless of
 * operational date (mirrors the backend `ackAlert` field). `severity` is the
 * more urgent of the Critical and High classifications.
 */
export interface AckAlert {
  severity: AckAlertSeverity;
  unackedCount: number;
  criticalCount: number;
  highCount: number;
  oldestUnackedMinutes: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface HandoverListResponse {
  data: HandoverListRow[];
  pagination: PaginationMeta;
}

/** Quick-filter chip identifiers used on the dashboard + log. */
export type QuickFilter =
  | 'all'
  | 'today'
  | 'last7'
  | 'highPlus'
  | 'openOnly'
  | 'carryForward'
  | 'awaitingAck';

export type ThemeMode = 'light' | 'dark';

export type Locale = 'vi' | 'en';

// ----------------------------------------------------------------------------
// Admin · User management (BR-12 / shared/API_SPEC.md "Users (Admin only)")
// ----------------------------------------------------------------------------

/**
 * Full user record returned by `GET /api/v1/users`.
 *
 * `passwordHash` is intentionally absent — the server never returns it to
 * any client (BR-12 / `shared/DATA_MODEL.md`). Client code only ever sees
 * the fields below.
 */
export interface UserDetail {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Optional activity counters joined server-side; absent on lighter list endpoints. */
  handoversPreparedCount?: number;
  handoversReceivedCount?: number;
  lastLoginAt?: string | null;
}

/** Payload for `POST /api/v1/users`. Server hashes the password. */
export interface UserCreateInput {
  email: string;
  name: string;
  role: UserRole;
  /** Optional for SSO-only users (passwordHash is nullable in the schema). */
  password?: string;
}

/** Payload for `PATCH /api/v1/users/:id` — only mutable fields are listed. */
export interface UserUpdateInput {
  name?: string;
  email?: string;
  role?: UserRole;
  isActive?: boolean;
  /** Optional admin-initiated reset (server hashes; passwordHash stays nullable for SSO). */
  password?: string;
}

export interface UserFiltersValue {
  search: string;
  role: UserRole | 'All';
  status: 'All' | 'Active' | 'Inactive';
}

// ----------------------------------------------------------------------------
// Reports · Export
// ----------------------------------------------------------------------------

/** Format requested when exporting. PDF is per-handover (BR-14); CSV is list-level. */
export type ExportFormat = 'pdf' | 'csv';

/** Filters that drive `GET /api/v1/handovers` and `GET /api/v1/handovers/export/csv`. */
export interface ReportFiltersValue {
  /** ISO date `YYYY-MM-DD`. Inclusive on both sides. */
  dateFrom: string | null;
  dateTo: string | null;
  shift: Shift | 'All';
  priority: Priority | 'All';
  category: CategoryCode | 'All';
  preparedById?: string | null;
  /** When true, only handovers that have items still Open or Monitoring. */
  openOnly: boolean;
  /** When true, only handovers `isCarriedForward = true`. */
  carryForwardOnly: boolean;
}

/**
 * Aggregate dataset rendered by the report preview before the user clicks
 * "Export". Generated server-side by re-using `GET /api/v1/handovers` with
 * the report filters applied.
 */
export interface ReportDataset {
  filters: ReportFiltersValue;
  generatedAt: string; // ISO datetime
  totalHandovers: number;
  rows: HandoverListRow[];
  /** Optional aggregate counters for the cover page. */
  totals?: {
    byShift: Record<Shift, number>;
    byPriority: Record<Priority, number>;
    byStatus: Record<ItemStatus, number>;
  };
}

// ----------------------------------------------------------------------------
// Settings · self-service profile, preferences, security
// ----------------------------------------------------------------------------

/**
 * Read-only "my profile" payload. Mirrors `UserDetail` minus admin-only
 * counters. Source: `GET /api/v1/users/me` (recommended new endpoint) or
 * `GET /api/v1/users/:id` with `id = session.user.id`.
 *
 * `passwordHash` is intentionally absent — the server never returns it.
 */
export interface SelfProfile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string | null;
}

/**
 * Self-service profile update. Only `name` is generally editable by the
 * user themselves; `email` and `role` typically require ADMIN
 * (`<UserFormDialog>` from PR #3). The shape leaves both editable so a
 * privileged self-edit screen can reuse the form, but the example page
 * gates `email`/`role` behind a role check.
 *
 * Source: `PATCH /api/v1/users/me` (recommended) or
 * `PATCH /api/v1/users/:id` with `id = session.user.id`.
 */
export interface ProfileUpdateInput {
  name?: string;
  email?: string;
}

/**
 * Change-password payload. The server MUST require `currentPassword`
 * before accepting `newPassword` (BR-12 self-service safety) and MUST
 * hash with bcrypt before storing.
 *
 * Source: `POST /api/v1/users/me/password` (recommended new endpoint).
 *
 * NOTE: This endpoint is NOT yet documented in `shared/API_SPEC.md`.
 * Add it before wiring the form to a real backend.
 */
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/** Visual density. Persists in cookie alongside the existing `useTheme` cookie. */
export type Density = 'comfortable' | 'compact';

/**
 * Client-side preference state. None of these touch `User.*` columns;
 * theme + locale + density live in cookies so SSR can render the
 * correct surface on the first byte. Cookie names:
 *   - `occ_theme`    → ThemeMode
 *   - `occ_locale`   → Locale
 *   - `occ_density`  → Density
 *   - `occ_default_shift` → Shift | '' (empty means "current shift")
 */
export interface PreferenceState {
  theme: ThemeMode | 'system';
  locale: Locale;
  density: Density;
  /** Empty string ⇒ use the current real-time shift. */
  defaultShift: Shift | '';
}
