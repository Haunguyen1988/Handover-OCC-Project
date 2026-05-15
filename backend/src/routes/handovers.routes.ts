import { Router, type Request, type Response } from 'express'
import { UserRole } from '@prisma/client'
import { z } from 'zod'

import { sendErrorResponse } from '../lib/error-response'
import { requireRole } from '../middleware/role.middleware'
import {
  CreateHandoverSchema,
  UpdateHandoverSchema,
} from '../schemas/handover.schema'
import { EntityIdSchema } from '../schemas/shared.schema'
import {
  createHandover,
  getHandoverDetail,
  listHandovers,
  updateHandover,
} from '../services/handover.service'
import {
  createItem,
  deleteItem,
  parseCreateItemPayload,
  parseUpdateItemPayload,
  updateItem,
} from '../services/item.service'
import {
  exportHandoversCsv,
  exportHandoverPdfHtml,
} from '../services/export.service'
import {
  carryForwardOpenItems,
} from '../services/carryForward.service'
import {
  acknowledgeHandover,
} from '../services/acknowledgment.service'

const router = Router()
const itemCategoryValues = [
  'aircraft',
  'airport',
  'flight-schedule',
  'crew',
  'weather',
  'system',
  'abnormal-events',
] as const

const handoverIdParamSchema = z.object({
  id: EntityIdSchema,
})
const handoverItemParamsSchema = z.object({
  id: EntityIdSchema,
  category: z.enum(itemCategoryValues),
})
const handoverItemMutationParamsSchema = handoverItemParamsSchema.extend({
  itemId: EntityIdSchema,
})

function mapHandoverZodError(error: z.ZodError) {
  const issuePaths = error.issues.map((issue) => issue.path.join('.'))
  const code = issuePaths.some((path) => path.endsWith('ownerId'))
    ? 'OWNER_REQUIRED'
    : issuePaths.some((path) => path.startsWith('categories.'))
      ? 'CATEGORY_ACTIVATED_BUT_EMPTY'
      : 'VALIDATION_FAILED'

  return { code }
}

function sendHandoverErrorResponse(res: Response, error: unknown) {
  return sendErrorResponse(res, error, { mapZodError: mapHandoverZodError })
}

router.get(
  '/',
  requireRole([
    UserRole.OCC_STAFF,
    UserRole.SUPERVISOR,
    UserRole.MANAGEMENT_VIEWER,
    UserRole.ADMIN,
  ]),
  async (req, res) => {
    try {
      const data = await listHandovers(req.user!, req.query as Record<string, string>)

      res.status(200).json(data)
    } catch (error) {
      sendHandoverErrorResponse(res, error)
    }
  }
)

router.post(
  '/',
  requireRole([UserRole.OCC_STAFF, UserRole.SUPERVISOR, UserRole.ADMIN]),
  async (req, res) => {
    try {
      const parsedPayload = CreateHandoverSchema.parse(req.body)
      const handover = await createHandover(parsedPayload, req.user!)

      res.status(201).json(handover)
    } catch (error) {
      sendHandoverErrorResponse(res, error)
    }
  }
)

// Export routes — must be registered before /:id to avoid param conflict

router.get(
  '/export/csv',
  requireRole([
    UserRole.OCC_STAFF,
    UserRole.SUPERVISOR,
    UserRole.MANAGEMENT_VIEWER,
    UserRole.ADMIN,
  ]),
  async (req, res) => {
    try {
      const csv = await exportHandoversCsv(
        req.user!,
        req.query as Record<string, string>
      )
      const date = new Date().toISOString().slice(0, 10)

      res
        .status(200)
        .setHeader('Content-Type', 'text/csv; charset=utf-8')
        .setHeader(
          'Content-Disposition',
          `attachment; filename=handovers-export-${date}.csv`
        )
        .send(csv)
    } catch (error) {
      sendHandoverErrorResponse(res, error)
    }
  }
)

router.get(
  '/:id/export/pdf',
  requireRole([
    UserRole.OCC_STAFF,
    UserRole.SUPERVISOR,
    UserRole.MANAGEMENT_VIEWER,
    UserRole.ADMIN,
  ]),
  async (req: Request<{ id: string }>, res) => {
    try {
      const params = handoverIdParamSchema.parse(req.params)
      const html = await exportHandoverPdfHtml(params.id, req.user!)

      res
        .status(200)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(html)
    } catch (error) {
      sendHandoverErrorResponse(res, error)
    }
  }
)

router.get(
  '/:id',
  requireRole([
    UserRole.OCC_STAFF,
    UserRole.SUPERVISOR,
    UserRole.MANAGEMENT_VIEWER,
    UserRole.ADMIN,
  ]),
  async (req: Request<{ id: string }>, res) => {
    try {
      const params = handoverIdParamSchema.parse(req.params)
      const handover = await getHandoverDetail(params.id, req.user!)

      res.status(200).json(handover)
    } catch (error) {
      sendHandoverErrorResponse(res, error)
    }
  }
)

router.patch(
  '/:id',
  requireRole([UserRole.OCC_STAFF, UserRole.SUPERVISOR, UserRole.ADMIN]),
  async (req: Request<{ id: string }>, res) => {
    try {
      const params = handoverIdParamSchema.parse(req.params)
      const payload = UpdateHandoverSchema.parse(req.body)
      const handover = await updateHandover(params.id, payload, req.user!)

      res.status(200).json(handover)
    } catch (error) {
      sendHandoverErrorResponse(res, error)
    }
  }
)

// Manual carry-forward — SUPERVISOR+ only (Task 3.2)
router.post(
  '/:id/carry-forward',
  requireRole([UserRole.SUPERVISOR, UserRole.ADMIN]),
  async (req: Request<{ id: string }>, res) => {
    try {
      const params = handoverIdParamSchema.parse(req.params)
      const { targetHandoverId } = req.body ?? {}

      if (!targetHandoverId || typeof targetHandoverId !== 'string') {
        return res.status(400).json({
          error: 'TARGET_HANDOVER_REQUIRED',
          message: 'targetHandoverId is required',
        })
      }

      const targetIdParsed = EntityIdSchema.safeParse(targetHandoverId)

      if (!targetIdParsed.success) {
        return res.status(400).json({
          error: 'VALIDATION_FAILED',
          message: 'Invalid targetHandoverId',
        })
      }

      const result = await carryForwardOpenItems(
        params.id,
        targetIdParsed.data,
        req.user!.id
      )

      res.status(200).json(result)
    } catch (error) {
      sendHandoverErrorResponse(res, error)
    }
  }
)

// Incoming shift acknowledgment — OCC_STAFF + SUPERVISOR (Task 3.5)
router.post(
  '/:id/acknowledge',
  requireRole([UserRole.OCC_STAFF, UserRole.SUPERVISOR]),
  async (req: Request<{ id: string }>, res) => {
    try {
      const params = handoverIdParamSchema.parse(req.params)
      const notes =
        req.body?.notes && typeof req.body.notes === 'string'
          ? req.body.notes.trim() || null
          : null

      const result = await acknowledgeHandover(
        params.id,
        req.user!.id,
        notes
      )

      res.status(200).json(result)
    } catch (error) {
      sendHandoverErrorResponse(res, error)
    }
  }
)

router.post(
  '/:id/items/:category',
  requireRole([UserRole.OCC_STAFF, UserRole.SUPERVISOR, UserRole.ADMIN]),
  async (req, res) => {
    try {
      const params = handoverItemParamsSchema.parse(req.params)
      const payload = parseCreateItemPayload(params.category, req.body)
      const item = await createItem(params.id, params.category, payload, req.user!)

      res.status(201).json(item)
    } catch (error) {
      sendHandoverErrorResponse(res, error)
    }
  }
)

router.patch(
  '/:id/items/:category/:itemId',
  requireRole([UserRole.OCC_STAFF, UserRole.SUPERVISOR, UserRole.ADMIN]),
  async (req, res) => {
    try {
      const params = handoverItemMutationParamsSchema.parse(req.params)
      const payload = parseUpdateItemPayload(params.category, req.body)
      const item = await updateItem(
        params.id,
        params.category,
        params.itemId,
        payload,
        req.user!
      )

      res.status(200).json(item)
    } catch (error) {
      sendHandoverErrorResponse(res, error)
    }
  }
)

router.delete(
  '/:id/items/:category/:itemId',
  requireRole([UserRole.SUPERVISOR, UserRole.ADMIN]),
  async (req, res) => {
    try {
      const params = handoverItemMutationParamsSchema.parse(req.params)
      const deletedItem = await deleteItem(
        params.id,
        params.category,
        params.itemId,
        req.user!
      )

      res.status(200).json(deletedItem)
    } catch (error) {
      sendHandoverErrorResponse(res, error)
    }
  }
)

export { router as handoverRouter }
