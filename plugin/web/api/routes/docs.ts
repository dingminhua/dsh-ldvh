/**
 * GET /api/docs?path=specs/21-ADR-决策.md — 读取项目内文档内容
 */
import { Router, type Request, type Response } from 'express'
import { readFile } from 'fs/promises'
import path from 'path'
import { ProjectScopeError, requestProject } from '../services/requestScope.js'

const router = Router()

/** 允许读取的目录前缀（安全白名单） */
const ALLOWED_PREFIXES = ['specs/', 'web/docs/']

function isWithinDirectory(candidate: string, directory: string): boolean {
  const relative = path.relative(directory, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function resolveAllowedDocPath(root: string, requestedPath: string): string | null {
  const resolvedPath = path.resolve(root, requestedPath)
  const allowedRoots = ALLOWED_PREFIXES.map(prefix => path.resolve(root, prefix))
  return allowedRoots.some(directory => isWithinDirectory(resolvedPath, directory))
    ? resolvedPath
    : null
}

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const docPath = String(req.query.path || '')

  if (!docPath) {
    res.status(400).json({ error: 'Missing path parameter' })
    return
  }

  // Resolve first, then apply the allow-list to the resolved location. Checking
  // the raw prefix would allow e.g. "specs/../.env" to escape the docs roots.
  let projectRoot: string
  try {
    projectRoot = (await requestProject(req)).path
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Project scope is unavailable'
    res.status(err instanceof ProjectScopeError ? 400 : 500).json({ error: message })
    return
  }
  const resolvedPath = resolveAllowedDocPath(projectRoot, docPath)
  if (resolvedPath === null) {
    res.status(403).json({ error: 'Path not allowed' })
    return
  }

  try {
    const content = await readFile(resolvedPath, 'utf-8')
    // 限制返回内容大小（最大 200KB）
    if (content.length > 200 * 1024) {
      res.json({ path: docPath, content: content.slice(0, 200 * 1024), truncated: true })
      return
    }
    res.json({ path: docPath, content, truncated: false })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'File not found'
    res.status(404).json({ error: message })
  }
})

export default router
