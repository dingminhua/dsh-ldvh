import { Router } from 'express';
const router = Router();
router.post('/register', async (req, res) => {
    void req;
    res.status(501).json({ ok: false, error: 'Register is not implemented' });
});
router.post('/login', async (req, res) => {
    void req;
    res.status(501).json({ ok: false, error: 'Login is not implemented' });
});
router.post('/logout', async (req, res) => {
    void req;
    res.status(501).json({ ok: false, error: 'Logout is not implemented' });
});
export default router;
