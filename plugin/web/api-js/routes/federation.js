import { Router } from 'express';
import { listObjects } from '../services/facts.js';
import { readGovernedProjectsSettings } from '../services/governedProjectsSettings.js';
const router = Router();
const CROSS_SPARK_LIMIT = 8;
function itemsOf(result) {
    if (result && typeof result === 'object' && 'ok' in result && result.ok && 'data' in result) {
        const data = result.data;
        if (Array.isArray(data.items))
            return { items: data.items };
    }
    const error = result && typeof result === 'object' && 'error' in result
        ? String(result.error)
        : '列表读取失败';
    return { items: [], error };
}
function latestChangeLogAt(items) {
    let latest;
    for (const item of items) {
        const log = item.change_log;
        if (!Array.isArray(log))
            continue;
        for (let index = log.length - 1; index >= 0; index -= 1) {
            const entry = log[index];
            if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
                continue;
            const at = entry.at;
            if (typeof at === 'string' && at.length > 0 && (!latest || at > latest)) {
                latest = at;
                break;
            }
        }
    }
    return latest;
}
router.get('/objects', async (req, res) => {
    const type = String(req.query.type ?? '');
    const OBJECT_TYPES = ['pitfall', 'spark', 'report', 'friction', 'norm', 'subgoal'];
    if (!OBJECT_TYPES.includes(type)) {
        res.status(400).json({ ok: false, error: `Unsupported object type: ${type || '(missing)'}` });
        return;
    }
    const objectType = type;
    try {
        const settings = await readGovernedProjectsSettings();
        const issues = [];
        const projectOptions = settings.projects.map((project) => ({
            id: project.id,
            name: project.name || project.id,
            ...(project.color ? { color: project.color } : {}),
        }));
        const items = (await Promise.all(settings.projects.map(async (project) => {
            const scope = { worktreeLocator: project.path, governedProjectId: project.id };
            const result = await listObjects(objectType, undefined, undefined, scope);
            const listing = itemsOf(result);
            if (listing.error)
                issues.push(`${project.name || project.id}: ${listing.error}`);
            return listing.items.map((item) => ({
                ...item,
                type: objectType,
                federationProject: {
                    id: project.id,
                    name: project.name || project.id,
                    ...(project.color ? { color: project.color } : {}),
                },
            }));
        }))).flat();
        items.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
        res.json({ ok: true, type: objectType, generatedAt: new Date().toISOString(), projects: projectOptions, items, issues });
    }
    catch (error) {
        res.status(422).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});
router.get('/overview', async (_req, res) => {
    const generatedAt = new Date().toISOString();
    try {
        const settings = await readGovernedProjectsSettings();
        const openSparksByProject = new Map();
        const cards = await Promise.all(settings.projects.map(async (project) => {
            const card = {
                id: project.id,
                name: project.name || project.id,
                path: project.path,
                ...(project.color ? { color: project.color } : {}),
                isDefault: project.id === settings.defaultProjectId,
                issues: [],
            };
            const scope = { worktreeLocator: project.path, governedProjectId: project.id };
            const [sparkResult, pitfallResult] = await Promise.all([
                listObjects('spark', undefined, undefined, scope),
                listObjects('pitfall', undefined, undefined, scope),
            ]);
            const sparks = itemsOf(sparkResult);
            const pitfalls = itemsOf(pitfallResult);
            for (const [kind, listing] of [['spark', sparks], ['pitfall', pitfalls]]) {
                if (listing.error)
                    card.issues.push(`${kind}: ${listing.error}`);
            }
            let openSparks = [];
            if (!sparks.error) {
                openSparks = sparks.items.filter((item) => item.status === 'open');
                card.sparkOpen = openSparks.length;
            }
            if (openSparks.length > 0)
                openSparksByProject.set(project.id, openSparks);
            const lastActivityAt = latestChangeLogAt([...sparks.items, ...pitfalls.items]);
            if (lastActivityAt)
                card.lastActivityAt = lastActivityAt;
            return card;
        }));
        const crossProjectSparks = cards
            .flatMap((card) => (openSparksByProject.get(card.id) ?? []).map((item) => ({
            projectId: card.id,
            projectName: card.name,
            ...(card.color ? { color: card.color } : {}),
            objectId: String(item.object_id ?? item.id ?? ''),
            title: String(item.title ?? ''),
            updatedAt: typeof item.updated_at === 'string' ? item.updated_at : undefined,
        })))
            .sort((a, b) => (a.updatedAt ?? '').localeCompare(b.updatedAt ?? ''))
            .slice(0, CROSS_SPARK_LIMIT);
        res.json({ ok: true, generatedAt, defaultProjectId: settings.defaultProjectId, projects: cards, crossProjectSparks });
    }
    catch (error) {
        res.status(422).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});
export default router;
