import express from 'express'

import { attachAuthenticatedUser } from './middleware/auth.middleware'
import { createRateLimitMiddlewareFromEnv } from './middleware/rate-limit.middleware'
import { dashboardRouter } from './routes/dashboard.routes'
import { handoverRouter } from './routes/handovers.routes'

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

  return app
}

if (require.main === module) {
  const app = createApp()
  const port = Number(process.env.PORT ?? 4000)

  app.listen(port, () => {
    console.log(`OCC backend listening on http://localhost:${port}`)
  })
}
