import type { Shift } from './types';

const PAD = (n: number) => n.toString().padStart(2, '0');

/** Stable `dd/MM/yyyy` formatter that does not depend on locale. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return `${PAD(d.getDate())}/${PAD(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** `HH:mm` 24-hour formatter. */
export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return `${PAD(d.getHours())}:${PAD(d.getMinutes())}`;
}

/** `HH:mm:ss dd/MM/yyyy` for audit timestamps. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return `${PAD(d.getHours())}:${PAD(d.getMinutes())}:${PAD(d.getSeconds())} ${formatDate(d)}`;
}

/** Pick the active shift for a Date based on local time. */
export function shiftForTime(value: Date = new Date()): Shift {
  const h = value.getHours();
  if (h >= 7 && h < 19) return 'Morning';
  return 'Night';
}

/**
 * Format an unacknowledged age (in whole minutes) as a compact `XhYm`
 * string for the critical banner: `45m`, `3h05m`, `0m`. Negative or NaN
 * inputs floor to `0m`.
 */
export function formatAckAge(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0m';
  const total = Math.floor(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h${PAD(m)}m`;
}

/** Whole-day delta between two dates (positive when `b` is after `a`). */
export function dayDiff(a: string | Date, b: string | Date): number {
  const da = typeof a === 'string' ? new Date(a) : a;
  const db = typeof b === 'string' ? new Date(b) : b;
  const ms = db.getTime() - da.getTime();
  return Math.round(ms / 86_400_000);
}
