import express from 'express'

import { attachAuthenticatedUser } from './middleware/auth.middleware'
import { createRateLimitMiddlewareFromEnv } from './middleware/rate-limit.middleware'
import { dashboardRouter } from './routes/dashboard.routes'
import { handoverRouter } from './routes/handovers.routes'
import { usersRouter } from './routes/users.routes'
import { startAckAlertScheduler } from './services/ackAlertScheduler'

export function createApp() {
  const app = express()

  app.use(express.json())
  app.use(attachAuthenticatedUser)

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' })
  })

  // Rate limiting: applied to every /api/* request, but `/health` above
  // is already past so probes never get throttled. Keys off `req.user.id`
  // when present (set by attachAuthenticatedUser) and falls back to IP
  // for unauthenticated traffic.
  app.use('/api', createRateLimitMiddlewareFromEnv())

  app.use('/api/v1/dashboard', dashboardRouter)
  app.use('/api/v1/handovers', handoverRouter)
  app.use('/api/v1/users', usersRouter)

  return app
}

if (require.main === module) {
  const app = createApp()
  const port = Number(process.env.PORT ?? 4000)

  app.listen(port, () => {
    console.log(`OCC backend listening on http://localhost:${port}`)
  })

  // Tier 3 ack-alert push. Logs whether it armed so a misconfigured env
  // (missing ACK_ALERT_WEBHOOK_URL) is visible in the boot log instead of
  // silently never pushing.
  const ackAlertStop = startAckAlertScheduler()
  if (ackAlertStop) {
    console.log('[ack-alert] breach webhook scheduler started')
  } else {
    console.log(
      '[ack-alert] breach webhook scheduler disabled (set ACK_ALERT_WEBHOOK_URL to enable)'
    )
  }
}
