import express from 'express';
import cors from 'cors';
import compression from 'compression';
import dotenv from 'dotenv';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
import objectsRoutes from './routes/objects.js';
import changelogRoutes from './routes/changelog.js';
import docsRoutes from './routes/docs.js';
import projectFilesRoutes from './routes/project-files.js';
import settingsRoutes from './routes/settings.js';
import cognitionRoutes from './routes/cognition.js';
import federationRoutes from './routes/federation.js';
import diagnosticsRoutes from './routes/diagnostics.js';
import { primeWebGovernanceScope, WebGovernanceError } from './services/governanceScope.js';
const nodeRequire = createRequire(import.meta.url);
const expressLayer = nodeRequire('express/lib/router/layer');
expressLayer.prototype.handle_request = function bridgedHandleRequest(req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) {
        return next();
    }
    try {
        Promise.resolve(fn.call(this, req, res, next)).catch((error) => next(error));
    }
    catch (error) {
        next(error);
    }
};
dotenv.config();
export const appReady = primeWebGovernanceScope();
const app = express();
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'],
    credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());
app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});
app.use('/api/auth', authRoutes);
app.use('/api/objects', objectsRoutes);
app.use('/api/changelog', changelogRoutes);
app.use('/api/docs', docsRoutes);
app.use('/api/project-files', projectFilesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/cognition', cognitionRoutes);
app.use('/api/federation', federationRoutes);
app.use('/api/diagnostics', diagnosticsRoutes);
app.use('/api/health', (req, res, next) => {
    void req;
    void next;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-LDVH-Health', 'ok');
    res.status(200).json({
        success: true,
        message: 'ok',
    });
});
const WEB_DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
app.use('/ldvh/api', (req, res, next) => {
    const original = req.url;
    req.url = `/api${original}`;
    const restore = () => {
        req.url = original;
    };
    res.on('finish', restore);
    res.on('close', restore);
    app(req, res, (error) => {
        restore();
        if (error !== undefined && error !== null)
            next(error);
        else
            next();
    });
});
app.use('/ldvh', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
    }
    if (!existsSync(WEB_DIST_DIR)) {
        res.status(503).type('text/plain').send('LDVH web dist is not built (run: cd web && pnpm build:dsh)');
        return;
    }
    const url = new URL(req.url ?? '/', 'http://ldvh.local');
    const relative = decodeURIComponent(url.pathname);
    const candidate = resolve(WEB_DIST_DIR, `.${relative === '/' ? '/index.html' : relative}`);
    if (candidate.startsWith(WEB_DIST_DIR + sep) && existsSync(candidate)) {
        res.sendFile(candidate);
        return;
    }
    res.sendFile(join(WEB_DIST_DIR, 'index.html'));
});
app.use((error, req, res, next) => {
    void req;
    void next;
    if (error instanceof WebGovernanceError) {
        res.status(503).json({ ok: false, error: error.message, exitCode: 'governance_unavailable' });
        return;
    }
    res.status(500).json({
        success: false,
        error: 'Server internal error',
    });
});
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'API not found',
    });
});
export default app;
