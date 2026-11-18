import { Router, type Request, type Response } from 'express'

const router = Router()

router.post('/register', async (req: Request, res: Response): Promise<void> => {
  void req
  res.status(501).json({ ok: false, error: 'Register is not implemented' })
})

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  void req
  res.status(501).json({ ok: false, error: 'Login is not implemented' })
})

router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  void req
  res.status(501).json({ ok: false, error: 'Logout is not implemented' })
})

export default router
