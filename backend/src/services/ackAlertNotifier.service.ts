import { Priority } from '@prisma/client'

import { prisma } from '../lib/prisma'
import {
  classifyAckAlert,
  DEFAULT_ACK_ALERT_THRESHOLDS,
  type AckAlertThresholds,
} from './ackAlert.service'

/**
 * Tier 3 of the ack-alert roadmap: a background sweep that pushes a single
 * webhook notification the first time an unacknowledged High/Critical
 * handover crosses into `breach` severity, then never again for that same
 * handover (the push is deduped via `Handover.breachAlertedAt`).
 *
 * Unlike the dashboard `ackAlert` aggregate — which is scoped to the calling
 * user — this sweep runs without a user and looks across every handover,
 * because a breach is an operational fact that does not belong to one viewer.
 */

const ONE_MINUTE_MS = 60_000

export interface BreachingHandover {
  id: string
  referenceId: string
  overallPriority: Priority
  ageMinutes: number
}

export interface AckAlertWebhookPayload {
  /** Human-readable single line, ready for Slack/Teams generic webhooks. */
  text: string
  /** Structured breach list for consumers that parse the JSON body. */
  breaches: Array<{
    referenceId: string
    priority: Priority
    ageMinutes: number
  }>
}

export type WebhookPoster = (
  url: string,
  payload: AckAlertWebhookPayload
) => Promise<void>

export interface RunAckAlertSweepOptions {
  webhookUrl: string
  now?: Date
  thresholds?: AckAlertThresholds
  /** Injectable for tests; defaults to a real `fetch` POST. */
  post?: WebhookPoster
}

export interface AckAlertSweepResult {
  breachCount: number
  pushed: boolean
}

/**
 * Find every still-open High/Critical handover that has crossed into `breach`
 * severity and has not yet been pushed. `breachAlertedAt IS NULL` is the dedup
 * guard; `acknowledgedAt IS NULL` means acknowledging a handover naturally
 * drops it from this query forever.
 */
export async function findBreachingHandovers(
  now: Date = new Date(),
  thresholds: AckAlertThresholds = DEFAULT_ACK_ALERT_THRESHOLDS
): Promise<BreachingHandover[]> {
  const candidates = await prisma.handover.findMany({
    where: {
      deletedAt: null,
      acknowledgedAt: null,
      breachAlertedAt: null,
      overallPriority: { in: [Priority.High, Priority.Critical] },
    },
    select: {
      id: true,
      referenceId: true,
      overallPriority: true,
      createdAt: true,
    },
  })

  return candidates
    .map((handover) => ({
      id: handover.id,
      referenceId: handover.referenceId,
      overallPriority: handover.overallPriority,
      ageMinutes: Math.floor(
        (now.getTime() - handover.createdAt.getTime()) / ONE_MINUTE_MS
      ),
    }))
    .filter(
      (handover) =>
        classifyAckAlert(
          handover.overallPriority,
          handover.ageMinutes,
          thresholds
        ) === 'breach'
    )
}

export function buildWebhookPayload(
  breaches: BreachingHandover[],
  thresholds: AckAlertThresholds = DEFAULT_ACK_ALERT_THRESHOLDS
): AckAlertWebhookPayload {
  const summary = breaches
    .map((b) => `${b.referenceId} (${b.overallPriority}, ${b.ageMinutes}m)`)
    .join(', ')

  return {
    text:
      `🚨 OCC: ${breaches.length} handover(s) unacknowledged past ` +
      `${thresholds.criticalBreachMinutes}m: ${summary}`,
    breaches: breaches.map((b) => ({
      referenceId: b.referenceId,
      priority: b.overallPriority,
      ageMinutes: b.ageMinutes,
    })),
  }
}

const defaultPost: WebhookPoster = async (url, payload) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`ack-alert webhook responded with HTTP ${response.status}`)
  }
}

/**
 * One sweep: find new breaches, push them in a single webhook call, then mark
 * them as alerted. The mark happens only after a successful push, so a failed
 * webhook leaves `breachAlertedAt` null and the next tick retries the same
 * breaches rather than silently dropping them.
 */
export async function runAckAlertSweep(
  options: RunAckAlertSweepOptions
): Promise<AckAlertSweepResult> {
  const now = options.now ?? new Date()
  const thresholds = options.thresholds ?? DEFAULT_ACK_ALERT_THRESHOLDS
  const post = options.post ?? defaultPost

  const breaches = await findBreachingHandovers(now, thresholds)

  if (breaches.length === 0) {
    return { breachCount: 0, pushed: false }
  }

  await post(options.webhookUrl, buildWebhookPayload(breaches, thresholds))

  await prisma.handover.updateMany({
    where: { id: { in: breaches.map((b) => b.id) } },
    data: { breachAlertedAt: now },
  })

  return { breachCount: breaches.length, pushed: true }
}
