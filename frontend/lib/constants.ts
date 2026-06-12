import type { CategoryCode, Priority, Shift } from './types';

export const CATEGORIES: ReadonlyArray<{
  code: CategoryCode;
  shortLabel: string;
  longLabel: string;
  hint: string;
}> = [
  { code: 'aircraft', shortLabel: 'AC', longLabel: 'Aircraft', hint: 'AOG, kỹ thuật, dispatch' },
  { code: 'airport', shortLabel: 'APT', longLabel: 'Airport', hint: 'Runway, NOTAM, GSE' },
  { code: 'flightSchedule', shortLabel: 'SKED', longLabel: 'Flight Schedule', hint: 'Delay, cancel, divert' },
  { code: 'crew', shortLabel: 'CREW', longLabel: 'Crew', hint: 'Out-of-hours, positioning' },
  { code: 'weather', shortLabel: 'WX', longLabel: 'Weather', hint: 'TS, low-vis, gust' },
  { code: 'system', shortLabel: 'SYS', longLabel: 'System', hint: 'ACARS, AIMS, Crew Portal' },
  { code: 'abnormal', shortLabel: 'ABN', longLabel: 'Ab-Normal', hint: 'Sự kiện bất thường (báo cáo riêng)' },
];

/** Priority sort order: Critical → Low. Used for stable sorts. */
export const PRIORITY_ORDER: Record<Priority, number> = {
  Critical: 0,
  High: 1,
  Normal: 2,
  Low: 3,
};

export const SHIFT_ORDER: readonly Shift[] = ['Morning', 'Night'];

export const PRIORITY_CHOICES: readonly Priority[] = ['Low', 'Normal', 'High', 'Critical'];
