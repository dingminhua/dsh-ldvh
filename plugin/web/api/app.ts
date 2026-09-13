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
import { createRequire } from 'node:module'
import authRoutes from './routes/auth.js'
import objectsRoutes from './routes/objects.js'
import changelogRoutes from './routes/changelog.js'
import docsRoutes from './routes/docs.js'
import projectFilesRoutes from './routes/project-files.js'
import settingsRoutes from './routes/settings.js'
import cognitionRoutes from './routes/cognition.js'
import federationRoutes from './routes/federation.js'
import { primeWebGovernanceScope, WebGovernanceError } from './services/governanceScope.js'

// Express 4（本服务运行时）不会把 async 路由处理器的 rejection 送进错误链——
// 那是 Express 5 的行为。本服务的路由大量使用 async 处理器并在作用域解析失败时
// re-throw（见 routes/objects.ts 的 `throw scopeError`），在 Express 4 下这些
// rejection 成为 unhandledRejection：Node >= 15 默认令进程直接退出（exit 1），
// 每个在途代理请求以 ECONNRESET 失败，懒启动管理器又按请求重拉子进程形成崩溃
// 循环。此处在 Layer 层一次性桥接：async rejection → next(error)，恢复「路由
// re-throw 期待错误中间件应答」的本意；同步语义不变（fn.length > 3 的非标准
// 处理器仍按原样跳过）。
const nodeRequire = createRequire(import.meta.url)

interface BridgedLayer {
  handle: ((req: Request, res: Response, next: NextFunction) => unknown) & { length: number }
}

type BridgedHandleRequest = (this: BridgedLayer, req: Request, res: Response, next: NextFunction) => void

const expressLayer = nodeRequire('express/lib/router/layer') as {
  prototype: { handle_request: BridgedHandleRequest }
}

expressLayer.prototype.handle_request = function bridgedHandleRequest(req, res, next) {
  const fn = this.handle
  if (fn.length > 3) {
    return next()
  }
  try {
    Promise.resolve(fn.call(this, req, res, next)).catch((error: unknown) => next(error))
  } catch (error) {
    next(error)
  }
}

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
  void req
  void next
  // 治理不可用是服务状态（载体不可读/无已验证的管辖项目），不是服务器内部
  // 错误：503 + exitCode 走前端既有的 ApiRequestError 降级通道（对齐
  // fact_service_unavailable 的先例契约），页面呈现不可用提示而非红错箱。
  if (error instanceof WebGovernanceError) {
    res.status(503).json({ ok: false, error: error.message, exitCode: 'governance_unavailable' })
    return
  }
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
