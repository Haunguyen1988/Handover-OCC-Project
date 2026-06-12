import { describe, expect, it } from 'vitest'

import { formatAckAge } from '../../../frontend/lib/format'

describe('formatAckAge', () => {
  it('formats sub-hour ages as bare minutes', () => {
    expect(formatAckAge(45)).toBe('45m')
    expect(formatAckAge(1)).toBe('1m')
    expect(formatAckAge(59)).toBe('59m')
  })

  it('formats hour+ ages as XhYYm with zero-padded minutes', () => {
    expect(formatAckAge(60)).toBe('1h00m')
    expect(formatAckAge(185)).toBe('3h05m')
    expect(formatAckAge(245)).toBe('4h05m')
  })

  it('floors fractional minutes', () => {
    expect(formatAckAge(45.9)).toBe('45m')
    expect(formatAckAge(60.4)).toBe('1h00m')
  })

  it('floors zero, negative, and non-finite inputs to 0m', () => {
    expect(formatAckAge(0)).toBe('0m')
    expect(formatAckAge(-30)).toBe('0m')
    expect(formatAckAge(NaN)).toBe('0m')
    expect(formatAckAge(Infinity)).toBe('0m')
  })
})
