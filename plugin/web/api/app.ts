/**
 * This is a API server
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import authRoutes from './routes/auth.js'
import objectsRoutes from './routes/objects.js'
import changelogRoutes from './routes/changelog.js'
import docsRoutes from './routes/docs.js'
import projectFilesRoutes from './routes/project-files.js'
import settingsRoutes from './routes/settings.js'
import cognitionRoutes from './routes/cognition.js'
import { primeWebGovernanceScope } from './services/governanceScope.js'

dotenv.config()

/** Import-time governance work is observable so callers can await app startup. */
export const appReady = primeWebGovernanceScope()

const app: express.Application = express()

// CORS: 允许前端开发服务器访问
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'],
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use('/api', (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})

/**
 * API Routes
 */
app.use('/api/auth', authRoutes)
app.use('/api/objects', objectsRoutes)
app.use('/api/changelog', changelogRoutes)
app.use('/api/docs', docsRoutes)
app.use('/api/project-files', projectFilesRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/cognition', cognitionRoutes)

/**
 * health
 */
app.use(
  '/api/health',
  (req: Request, res: Response, next: NextFunction): void => {
    void req
    void next
    res.status(200).json({
      success: true,
      message: 'ok',
    })
  },
)

/**
 * error handler middleware
 */
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  void error
  void req
  void next
  res.status(500).json({
    success: false,
    error: 'Server internal error',
  })
})

/**
 * 404 handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
