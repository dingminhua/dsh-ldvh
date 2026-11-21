import { Router } from 'express';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildFrictionObservationReport, buildGateReport, dshHomeFromEnvironment, invalidateGateReportCache, } from '../services/runtimeDiagnostics.js';
import { LOGGABLE_TARGETS, RETENTION_CHOICES, planCleanup } from '../services/logsCleanup.js';
import { LDVH_WORKSPACE_ROOT } from '../services/pytools.js';
import { ProjectScopeError, requestProject } from '../services/requestScope.js';
const router = Router();
function ldvhHome() {
    return path.join(dshHomeFromEnvironment(), 'ldvh');
}
function fail(res, status, code, message) {
    res.status(status).json({ ok: false, error: { code, message } });
}
router.get('/gate', async (req, res) => {
    try {
        const project = await requestProject(req).catch(() => null);
        const workspaceRoot = project?.path ?? LDVH_WORKSPACE_ROOT;
        const report = await buildGateReport({ workspaceRoot });
        res.json({ ok: true, ...report });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        fail(res, 500, 'GATE_REPORT_FAILED', message);
    }
});
async function readJsonFile(filePath, fallback) {
    if (!existsSync(filePath))
        return fallback;
    try {
        return JSON.parse(await readFile(filePath, 'utf8'));
    }
    catch {
        return fallback;
    }
}
router.get('/queue', async (_req, res) => {
    try {
        const home = ldvhHome();
        const runsFile = path.join(home, 'idle-checkpoint-runs.json');
        const runsFileContent = await readJsonFile(runsFile, {});
        const runs = Array.isArray(runsFileContent.runs) ? runsFileContent.runs : [];
        const stageCounts = new Map();
        for (const run of runs) {
            const stage = typeof run.stage === 'string' ? run.stage : 'unknown';
            stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);
        }
        res.json({
            ok: true,
            generatedAt: new Date().toISOString(),
            scope: {
                ldvhHome: home,
                runsFileExists: existsSync(runsFile),
                limits: [
                    '运行记录在 ~/.dsh/ldvh 下，属本机当前用户的运行账，不随仓库分发。',
                    '运行记录是环形缓冲（保留最近 50 条），更早的轮次已被覆盖。',
                    'ActivityLog 只在内存，进程退出即消失——但失败轮次的 stop_reason 与 residual 首项自 2026-11-03 起写入运行记录的 note 字段，故「为什么 stopped」在保留窗口内可回看。',
                ],
            },
            runs: {
                total: runs.length,
                byStage: Array.from(stageCounts, ([stage, count]) => ({ stage, count }))
                    .sort((a, b) => b.count - a.count),
                recent: runs.slice(-20).reverse().map((run) => ({
                    at: run.at ?? null,
                    stage: run.stage ?? 'unknown',
                    code: run.code ?? null,
                    action: run.action ?? null,
                    task: run.task ?? null,
                    note: (run.note ?? '').slice(0, 300) || null,
                    pending_entry_id: run.pending_entry_id ?? null,
                })),
            },
        });
    }
    catch (error) {
        if (error instanceof ProjectScopeError) {
            fail(res, 400, 'PROJECT_SCOPE_INVALID', error.message);
            return;
        }
        const message = error instanceof Error ? error.message : String(error);
        fail(res, 500, 'QUEUE_REPORT_FAILED', message);
    }
});
router.get('/observations', async (_req, res) => {
    try {
        const report = await buildFrictionObservationReport();
        res.json(report);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        fail(res, 500, 'OBSERVATION_REPORT_FAILED', message);
    }
});
router.get('/logs/preview', async (req, res) => {
    try {
        const days = Number.parseInt(String(req.query.days ?? '7'), 10);
        if (!Number.isInteger(days) || days <= 0) {
            fail(res, 400, 'INVALID_RETENTION', 'days must be a positive integer');
            return;
        }
        const raw = req.query.targets;
        const targets = typeof raw === 'string' && raw.length > 0
            ? raw.split(',').map((x) => x.trim()).filter(Boolean)
            : LOGGABLE_TARGETS.map((t) => t.id);
        const plan = await planCleanup({ retentionDays: days, targetIds: targets, apply: false });
        res.json(plan);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        fail(res, 500, 'LOG_PREVIEW_FAILED', message);
    }
});
router.post('/logs/clean', async (req, res) => {
    try {
        const body = (req.body ?? {});
        const days = Number.parseInt(String(body.days ?? ''), 10);
        if (!Number.isInteger(days) || !RETENTION_CHOICES.includes(days)) {
            fail(res, 400, 'INVALID_RETENTION', `days must be one of ${RETENTION_CHOICES.join(', ')}`);
            return;
        }
        const targets = Array.isArray(body.targets)
            ? body.targets.filter((x) => typeof x === 'string' && x.length > 0)
            : [];
        if (targets.length === 0) {
            fail(res, 400, 'NO_TARGETS', 'at least one target must be selected');
            return;
        }
        const unknown = targets.filter((id) => !LOGGABLE_TARGETS.some((t) => t.id === id));
        if (unknown.length > 0) {
            fail(res, 400, 'UNKNOWN_TARGET', `unknown target(s): ${unknown.join(', ')}`);
            return;
        }
        const result = await planCleanup({ retentionDays: days, targetIds: targets, apply: true });
        invalidateGateReportCache();
        res.json(result);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        fail(res, 500, 'LOG_CLEAN_FAILED', message);
    }
});
export default router;
