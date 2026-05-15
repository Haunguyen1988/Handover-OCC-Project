import { Router } from 'express'
import { UserRole } from '@prisma/client'

import { sendErrorResponse } from '../lib/error-response'
import { requireRole } from '../middleware/role.middleware'
import { getDashboardSummary } from '../services/dashboard.service'

const router = Router()

router.get(
  '/summary',
  requireRole([
    UserRole.OCC_STAFF,
    UserRole.SUPERVISOR,
    UserRole.MANAGEMENT_VIEWER,
    UserRole.ADMIN,
  ]),
  async (req, res) => {
    try {
      const summary = await getDashboardSummary(req.user!)

      res.status(200).json(summary)
    } catch (error) {
      sendErrorResponse(res, error)
    }
  }
)

export { router as dashboardRouter }
