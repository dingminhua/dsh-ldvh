/**
 * This is a API server
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import compression from 'compression'
import dotenv from 'dotenv'
import authRoutes from './routes/auth.js'
import objectsRoutes from './routes/objects.js'
import changelogRoutes from './routes/changelog.js'
import docsRoutes from './routes/docs.js'
import projectFilesRoutes from './routes/project-files.js'
import settingsRoutes from './routes/settings.js'
import cognitionRoutes from './routes/cognition.js'
import federationRoutes from './routes/federation.js'
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
// gzip API JSON——挂载链全程在 Electron 主进程事件循环上，压缩把跨进程字节数
// 降 5-10 倍，直接降低宿主忙时（模型流式输出期间）每个请求的排队代价。
app.use(compression())
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
app.use('/api/federation', federationRoutes)

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
