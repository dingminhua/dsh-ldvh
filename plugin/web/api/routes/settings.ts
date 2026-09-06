import { Router, type Request, type Response } from 'express'
import { readGovernedProjectsSettings, updateGovernedProjectsSettings, type GovernedProjectSetting } from '../services/governedProjectsSettings.js'
import { verifyWebGovernanceConfiguration } from '../services/governanceScope.js'
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

router.post('/governed-projects/verify', async (_req: Request, res: Response): Promise<void> => {
  try {
    await verifyWebGovernanceConfiguration()
    res.json({ ok: true })
  } catch (error) { res.status(422).json({ ok: false, error: error instanceof Error ? error.message : String(error) }) }
})

router.put('/governed-projects', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { projects?: GovernedProjectSetting[]; expectedFingerprint?: string; defaultProjectId?: unknown }
  if (!Array.isArray(body.projects) || typeof body.expectedFingerprint !== 'string') {
    res.status(400).json({ ok: false, error: 'projects 与 expectedFingerprint 是必填字段' })
    return
  }
  try { res.json({ ok: true, ...(await updateGovernedProjectsSettings(body.projects, body.expectedFingerprint, body.defaultProjectId)) }) }
  catch (error) { res.status(422).json({ ok: false, error: error instanceof Error ? error.message : String(error) }) }
})

export default router
