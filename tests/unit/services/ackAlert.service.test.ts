import { Priority } from '@prisma/client'
import { describe, expect, it } from 'vitest'

import {
  classifyAckAlert,
  DEFAULT_ACK_ALERT_THRESHOLDS,
  type AckAlertThresholds,
} from '../../../backend/src/services/ackAlert.service'

describe('classifyAckAlert', () => {
  describe('Critical priority', () => {
    it('warns while still within the breach grace window', () => {
      expect(classifyAckAlert(Priority.Critical, 0)).toBe('warn')
      expect(classifyAckAlert(Priority.Critical, 14)).toBe('warn')
    })

    it('breaches once it reaches the breach threshold', () => {
      expect(classifyAckAlert(Priority.Critical, 15)).toBe('breach')
      expect(classifyAckAlert(Priority.Critical, 240)).toBe('breach')
    })
  })

  describe('High priority', () => {
    it('stays silent until the warn threshold', () => {
      expect(classifyAckAlert(Priority.High, 0)).toBe('none')
      expect(classifyAckAlert(Priority.High, 59)).toBe('none')
    })

    it('warns once it reaches the warn threshold', () => {
      expect(classifyAckAlert(Priority.High, 60)).toBe('warn')
      expect(classifyAckAlert(Priority.High, 600)).toBe('warn')
    })
  })

  describe('priorities outside BR-10 scope', () => {
    it('never alerts for Normal or Low regardless of age', () => {
      expect(classifyAckAlert(Priority.Normal, 100000)).toBe('none')
      expect(classifyAckAlert(Priority.Low, 100000)).toBe('none')
    })
  })

  describe('age edge cases', () => {
    it('floors a negative age (clock skew) to zero', () => {
      expect(classifyAckAlert(Priority.Critical, -5)).toBe('warn')
      expect(classifyAckAlert(Priority.High, -5)).toBe('none')
    })

    it('treats a non-finite age as zero', () => {
      expect(classifyAckAlert(Priority.Critical, Number.NaN)).toBe('warn')
      expect(classifyAckAlert(Priority.Critical, Number.POSITIVE_INFINITY)).toBe(
        'breach'
      )
    })
  })

  describe('custom thresholds', () => {
    const aggressive: AckAlertThresholds = {
      criticalBreachMinutes: 5,
      highWarnMinutes: 20,
    }

    it('honours caller-supplied thresholds', () => {
      expect(classifyAckAlert(Priority.Critical, 5, aggressive)).toBe('breach')
      expect(classifyAckAlert(Priority.Critical, 4, aggressive)).toBe('warn')
      expect(classifyAckAlert(Priority.High, 20, aggressive)).toBe('warn')
      expect(classifyAckAlert(Priority.High, 19, aggressive)).toBe('none')
    })
  })

  describe('DEFAULT_ACK_ALERT_THRESHOLDS', () => {
    it('documents the pilot defaults', () => {
      expect(DEFAULT_ACK_ALERT_THRESHOLDS).toEqual({
        criticalBreachMinutes: 15,
        highWarnMinutes: 60,
      })
    })
  })
})
