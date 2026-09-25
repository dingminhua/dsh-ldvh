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
import { existsSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
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
 * SPA 静态托管 + /ldvh/api 别名（宿主 iframe 绕行路径）。
 *
 * 背景：宿主把插件 SPA 的 iframe 请求判 403——`dsh-app://app/ldvh/` 走宿主转发链，
 * 而宿主只在 `request.frame === owner.mainFrame` 时注入身份头，子框架拿不到，遂被拒
 * （DevTools 实测 `GET dsh-app://app/ldvh/ 403`）。本服务由插件自持、监听固定回环
 * 端口，不经 dsh-app 转发链，故在其上直接服务 SPA 可绕开该判据。
 *
 * 路径形状必须与 SPA 构建基址一致：dist/index.html 引用 `/ldvh/assets/...`，且前端
 * API_BASE 解析为 `/ldvh/api`。因此这里同时挂两件事：
 *   - `/ldvh/api/*`  → 复用本服务既有的 `/api/*` 路由（别名，不重复实现）
 *   - `/ldvh/*`      → dist 静态资产，未命中者回落 index.html（SPA 客户端路由）
 * 二者都必须在 404 handler 之前注册，否则先被 404 截获。
 */
const WEB_DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

// `/ldvh/api/*` 别名：去掉 `/ldvh` 前缀后交回 `/api` 链。用 `app.handle` 复用既有
// 路由表，避免为同一批路由维护第二份挂载清单（两处会漂移）。
app.use('/ldvh/api', (req: Request, res: Response, next: NextFunction): void => {
  const original = req.url
  req.url = `/api${original}`
  const restore = (): void => {
    req.url = original
  }
  res.on('finish', restore)
  res.on('close', restore)
  app.handle(req, res, (error?: unknown) => {
    restore()
    if (error !== undefined && error !== null) next(error as Error)
    else next()
  })
})

app.use('/ldvh', (req: Request, res: Response, next: NextFunction): void => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next()
    return
  }
  if (!existsSync(WEB_DIST_DIR)) {
    res.status(503).type('text/plain').send('LDVH web dist is not built (run: cd web && pnpm build:dsh)')
    return
  }
  const url = new URL(req.url ?? '/', 'http://ldvh.local')
  const relative = decodeURIComponent(url.pathname)
  // 防目录穿越：解析后必须仍在 dist 内。
  const candidate = resolve(WEB_DIST_DIR, `.${relative === '/' ? '/index.html' : relative}`)
  if (candidate.startsWith(WEB_DIST_DIR + sep) && existsSync(candidate)) {
    res.sendFile(candidate)
    return
  }
  // SPA 客户端路由回落。
  res.sendFile(join(WEB_DIST_DIR, 'index.html'))
})

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
