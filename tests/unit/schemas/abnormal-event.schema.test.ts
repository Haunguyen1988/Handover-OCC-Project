import { describe, expect, it } from 'vitest'

import { AbnormalEventSchema } from '../../../backend/src/schemas/item.schema'

const VALID_OWNER_ID = 'c123456789012345678901234'

function buildValidAbnormalEvent() {
  return {
    eventType: 'AOG',
    description: 'Aircraft grounded pending engineering inspection and dispatch decision.',
    flightsAffected: 'AXA123, AXA456',
    notificationRef: 'NOC-CRIT-2026-001',
    status: 'Open',
    priority: 'Critical',
    ownerId: VALID_OWNER_ID,
    dueTime: '2099-01-01T12:00:00Z',
  }
}

describe('AbnormalEventSchema', () => {
  it('accepts a valid abnormal event payload', () => {
    const result = AbnormalEventSchema.safeParse(buildValidAbnormalEvent())

    expect(result.success).toBe(true)
  })

  it('rejects descriptions shorter than 20 characters (BR-08)', () => {
    const result = AbnormalEventSchema.safeParse({
      ...buildValidAbnormalEvent(),
      description: 'Too short',
    })

    expect(result.success).toBe(false)
  })

  it('rejects AOG events without flightsAffected (BR-08)', () => {
    const { flightsAffected: _flightsAffected, ...payload } =
      buildValidAbnormalEvent()

    const result = AbnormalEventSchema.safeParse(payload)

    expect(result.success).toBe(false)
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'flightsAffected')).toBe(true)
  })

  it('rejects Critical events without notificationRef (BR-08)', () => {
    const { notificationRef: _notificationRef, ...payload } =
      buildValidAbnormalEvent()

    const result = AbnormalEventSchema.safeParse(payload)

    expect(result.success).toBe(false)
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'notificationRef')).toBe(true)
  })
})
