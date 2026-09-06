import { Router, type Request, type Response } from 'express'
import { readGovernedProjectsSettings, updateProjectColor } from '../services/governedProjectsSettings.js'
import { scanWorkspaceWorktrees, workspaceRootForWorktreeScan } from '../services/workspaceWorktrees.js'

const router = Router()

router.get('/governed-projects', async (_req: Request, res: Response): Promise<void> => {
  try { res.json({ ok: true, ...(await readGovernedProjectsSettings()) }) }
  catch (error) { res.status(422).json({ ok: false, error: error instanceof Error ? error.message : String(error) }) }
})

router.get('/workspace-worktrees', async (_req: Request, res: Response): Promise<void> => {
  try {
    const settings = await readGovernedProjectsSettings()
    const items = await scanWorkspaceWorktrees(settings.projects)
    res.json({ ok: true, workspaceRoot: workspaceRootForWorktreeScan(), items })
  } catch (error) {
    res.status(422).json({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
})

router.post('/governed-projects/verify', (_req: Request, res: Response): void => {
  res.status(501).json({ ok: false, error: '管辖验证已归 DSH 插件设置卡（LDVH → 管辖项目配置 → 检查）。' })
})

// 管辖登记的写路径归 DSH 插件设置卡（07 规范登记面）——Web 侧只读呈现；
// v4 时代的轻写入（改名/增删项目/改默认）已下线，保留读端点供呈现。
router.put('/governed-projects', (_req: Request, res: Response): void => {
  res.status(501).json({ ok: false, error: '管辖项目配置为只读：请使用 DSH 插件设置卡（LDVH → 管辖项目配置）修改登记；项目颜色也已在插件设置卡设置。' })
})

export default router

// 颜色偏好读写：颜色是呈现偏好（独立载体），插件设置卡经此端点设置，
// Web 侧的 Settings 页调色板交互同样落这里。
router.put('/governed-projects/color', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { projectId?: unknown; color?: unknown }
  if (typeof body.projectId !== 'string' || !body.projectId) {
    res.status(400).json({ ok: false, error: 'projectId 是必填字段' })
    return
  }
  try {
    const settings = await readGovernedProjectsSettings()
    if (!settings.projects.some((project) => project.id === body.projectId)) {
      res.status(404).json({ ok: false, error: `未登记的项目：${body.projectId}` })
      return
    }
    const requestedColor = typeof body.color === 'string' ? body.color : undefined
    const updated = await updateProjectColor(body.projectId, body.color === null ? undefined : requestedColor)
    res.json({ ok: true, projects: updated.projects })
  } catch (error) { res.status(422).json({ ok: false, error: error instanceof Error ? error.message : String(error) }) }
})
