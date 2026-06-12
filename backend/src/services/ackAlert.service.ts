import { Priority } from '@prisma/client'

/**
 * Severity tiers for an unacknowledged High/Critical handover.
 * - `breach`: past the hard deadline; demands immediate attention.
 * - `warn`:   unacknowledged and counting, but not yet breaching.
 * - `none`:   no alert (priority below BR-10 scope, or still within grace).
 */
export type AckAlertSeverity = 'none' | 'warn' | 'breach'

export interface AckAlertThresholds {
  /** Minutes a Critical handover may sit unacknowledged before it breaches. */
  criticalBreachMinutes: number
  /** Minutes a High handover may sit unacknowledged before it warns. */
  highWarnMinutes: number
}

/**
 * Defaults chosen for the pilot. Tune these as OCC operating procedure
 * dictates — they are the single knob for how aggressive the alert is.
 */
export const DEFAULT_ACK_ALERT_THRESHOLDS: AckAlertThresholds = {
  criticalBreachMinutes: 15,
  highWarnMinutes: 60,
}

/**
 * Classify how urgent an unacknowledged handover is, given its priority and
 * how long it has gone unacknowledged.
 *
 * BR-10 only requires acknowledgment for High/Critical handovers, so Low and
 * Normal always classify as `none`. A negative age (clock skew between the
 * created-at timestamp and "now") is floored to 0; a NaN age (e.g. an
 * unparseable timestamp) is treated as 0 rather than trusted.
 *
 * Pure function — no I/O, no clock read. The caller supplies `ageMinutes`.
 */
export function classifyAckAlert(
  priority: Priority,
  ageMinutes: number,
  thresholds: AckAlertThresholds = DEFAULT_ACK_ALERT_THRESHOLDS
): AckAlertSeverity {
  const age = Number.isNaN(ageMinutes) ? 0 : Math.max(0, ageMinutes)

  if (priority === Priority.Critical) {
    return age >= thresholds.criticalBreachMinutes ? 'breach' : 'warn'
  }

  if (priority === Priority.High) {
    return age >= thresholds.highWarnMinutes ? 'warn' : 'none'
  }

  return 'none'
}
