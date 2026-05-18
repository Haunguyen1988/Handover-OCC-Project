import type { Response } from 'express'
import { z } from 'zod'

import { isServiceError } from './service-error'

export type ValidationErrorMapper = (error: z.ZodError) => {
  code: string
  message?: string
}

const DEFAULT_VALIDATION_PAYLOAD: ValidationErrorMapper = () => ({
  code: 'VALIDATION_FAILED',
  message: 'Validation failed',
})

/**
 * Centralised error responder for HTTP routes.
 *
 * - Zod errors → 400 with a structured `details: error.flatten()` payload.
 *   Pass `mapZodError` to remap the top-level `error` code based on which
 *   field failed (e.g. `OWNER_REQUIRED`, `CATEGORY_ACTIVATED_BUT_EMPTY`).
 * - ServiceError → its own statusCode + code + message + details.
 * - Anything else → 500 INTERNAL_SERVER_ERROR (logged via console.error).
 */
export function sendErrorResponse(
  res: Response,
  error: unknown,
  options?: {
    mapZodError?: ValidationErrorMapper
  }
) {
  if (error instanceof z.ZodError) {
    const mapper = options?.mapZodError ?? DEFAULT_VALIDATION_PAYLOAD
    const { code, message } = mapper(error)

    return res.status(400).json({
      error: code,
      message: message ?? 'Validation failed',
      details: error.flatten(),
    })
  }

  if (isServiceError(error)) {
    return res.status(error.statusCode).json({
      error: error.code,
      message: error.message,
      details: error.details,
    })
  }

  console.error(error)

  return res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'Internal server error',
    details: {},
  })
}
