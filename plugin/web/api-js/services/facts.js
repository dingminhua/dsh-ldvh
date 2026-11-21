import { listLocalFacts, readLocalFact, } from './localFactReader.js';
import { canonicalUid } from '../../shared-js/factIdentity.js';
import { resolveCurrentWebProject, WebGovernanceError } from './governanceScope.js';
import { FACT_LIST_FIELD_NAMES } from './factFieldContract.js';
import { getGitCommit } from './git.js';
export const ACTIVE_OBJECT_TYPES = ['pitfall', 'spark', 'report', 'friction', 'norm', 'subgoal'];
export const OBJECT_TYPES = ACTIVE_OBJECT_TYPES;
function result(action, target, data) {
    return { ok: true, command: 'field-level-fact-reader', action, target, summary: { count: Array.isArray(data.items) ? data.items.length : undefined }, issues: [], data };
}
function error(value) {
    if (value instanceof WebGovernanceError)
        return { ok: false, error: value.message, stderr: '', exitCode: 'governance_unavailable' };
    return { ok: false, error: value instanceof Error ? value.message : 'Fact reader unavailable', stderr: '', exitCode: 1 };
}
async function readingScope(scope) {
    if (scope)
        return scope;
    const project = await resolveCurrentWebProject();
    return { worktreeLocator: project.path, governedProjectId: project.id };
}
function notIntegrated(type, message) {
    const issue = { code: 'type_not_integrated', message };
    const response = result('list', type, { items: [], coverage_status: 'type_not_integrated', collection_issues: [issue] });
    response.issues = [issue];
    response.summary.coverage_status = 'type_not_integrated';
    return response;
}
function readFailure(id, type, metadata, issues) {
    const response = result('show', id, {
        fact_read_failure: true,
        object_ref: metadata.object_ref,
        canonical_path: metadata.canonical_path,
        carrier: metadata.carrier,
        read_status: 'unreadable',
        field_issues: [],
        unparsed_structures: [],
        read_issues: issues,
    });
    response.summary = { id, type, read_status: 'unreadable' };
    response.issues = issues;
    return response;
}
function projectFactIdentity(source) {
    return copyPresentFields(source, ['object_uid']);
}
function projectListItem(type, item, _uidTargets) {
    const source = item.fact_object ?? {};
    const base = copyPresentFields(source, FACT_LIST_FIELD_NAMES[type]);
    return {
        ...base,
        ...projectFactIdentity(source),
        ...copyPresentFields(source, ['change_log']),
        read_status: item.read_status,
        read_issues: item.issues,
        field_issues: item.field_issues,
        unparsed_structures: item.unparsed_structures,
    };
}
function refObjectUid(value) {
    return canonicalUid(value) ? value : null;
}
function factAssociationTargetKey(target) {
    if ('commit' in target)
        return `commit\u0000${target.commit}`;
    if ('objectUid' in target)
        return `uid\u0000${target.objectUid}`;
    return `${target.governedProjectId}\u0000${target.factTypeKey}\u0000${target.objectId}`;
}
function projectFactAssociationTarget(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const target = value;
    const keys = Object.keys(target);
    if (keys.length === 1 && canonicalUid(target.object_uid)) {
        return { objectUid: target.object_uid };
    }
    if (keys.length === 1 && typeof target.commit === 'string' && /^[0-9a-f]{40}$/i.test(target.commit.trim())) {
        return { commit: target.commit.trim() };
    }
    if (keys.length !== 3
        || !keys.every((key) => ['governed_project_id', 'fact_type_key', 'object_id'].includes(key)))
        return null;
    if (typeof target.governed_project_id !== 'string' || !target.governed_project_id.trim()
        || typeof target.fact_type_key !== 'string' || !target.fact_type_key.trim()
        || typeof target.object_id !== 'string' || !target.object_id.trim())
        return null;
    return {
        governedProjectId: target.governed_project_id,
        factTypeKey: target.fact_type_key,
        objectId: target.object_id,
    };
}
const commitDescriptionCache = new Map();
const COMMIT_CACHE_LIMIT = 512;
async function readCommitDescription(hash, scope) {
    const cwd = scope.worktreeLocator;
    if (typeof cwd !== 'string' || !cwd)
        return null;
    const cacheKey = `${cwd}\u0000${hash}`;
    if (commitDescriptionCache.has(cacheKey))
        return commitDescriptionCache.get(cacheKey) ?? null;
    try {
        const entry = await getGitCommit(hash, 'zh', cwd);
        const description = typeof entry?.description === 'string' ? entry.description.trim() : '';
        if (description)
            return rememberCommit(cacheKey, description);
        const message = typeof entry?.message === 'string' ? entry.message.trim() : '';
        return rememberCommit(cacheKey, message || null);
    }
    catch {
        return rememberCommit(cacheKey, null);
    }
}
function rememberCommit(key, value) {
    if (commitDescriptionCache.size >= COMMIT_CACHE_LIMIT && !commitDescriptionCache.has(key)) {
        const oldest = commitDescriptionCache.keys().next().value;
        if (oldest !== undefined)
            commitDescriptionCache.delete(oldest);
    }
    commitDescriptionCache.set(key, value);
    return value;
}
function isObjectType(value) {
    return ACTIVE_OBJECT_TYPES.includes(value);
}
async function currentProjectUidTargets(scope) {
    const matches = new Map();
    for (const type of ACTIVE_OBJECT_TYPES) {
        const listed = await listLocalFacts(type, scope);
        for (const item of listed.items) {
            const objectUid = item.fact_object?.object_uid;
            if (item.read_status !== 'readable' || !canonicalUid(objectUid))
                continue;
            const targets = matches.get(objectUid) ?? [];
            targets.push({
                governedProjectId: scope.governedProjectId,
                factTypeKey: type,
                objectId: item.object_ref.object_id,
            });
            matches.set(objectUid, targets);
        }
    }
    return new Map([...matches].map(([objectUid, targets]) => [objectUid, targets.length === 1 ? targets[0] : null]));
}
async function currentProjectFactRefSources(scope) {
    const reverse = new Map();
    const seen = new Set();
    for (const type of ACTIVE_OBJECT_TYPES) {
        const listed = await listLocalFacts(type, scope);
        for (const item of listed.items) {
            if (item.read_status !== 'readable' || item.fact_object === null)
                continue;
            const sourceUid = refObjectUid(item.fact_object.object_uid);
            if (!sourceUid || !Array.isArray(item.fact_object.refs))
                continue;
            const sourceTarget = {
                governedProjectId: scope.governedProjectId,
                factTypeKey: type,
                objectId: item.object_ref.object_id,
            };
            const sourceTitle = typeof item.fact_object.title === 'string' && item.fact_object.title.trim()
                ? item.fact_object.title
                : undefined;
            const sourceEntry = {
                objectUid: sourceUid,
                available: true,
                resolvedTarget: sourceTarget,
                ...(sourceTitle !== undefined ? { title: sourceTitle } : {}),
                ...copyPresentFields(item.fact_object, ['title_en', 'title_zh', 'status']),
            };
            for (const candidate of item.fact_object.refs) {
                const targetUid = typeof candidate === 'string'
                    ? refObjectUid(candidate)
                    : candidate && typeof candidate === 'object' && !Array.isArray(candidate)
                        ? refObjectUid(candidate.object_uid)
                        : null;
                if (!targetUid)
                    continue;
                const edgeKey = `${sourceUid.toLowerCase()}\u0000${targetUid.toLowerCase()}`;
                if (seen.has(edgeKey))
                    continue;
                seen.add(edgeKey);
                const targetKey = targetUid.toLowerCase();
                const sources = reverse.get(targetKey) ?? [];
                sources.push({ ...sourceEntry });
                reverse.set(targetKey, sources);
            }
        }
    }
    return reverse;
}
async function projectFactCardAssociations(item, scope, uidTargets) {
    const relations = item.fact_object?.relations;
    if (!Array.isArray(relations))
        return [];
    const seenTargets = new Set();
    const visibleRelations = relations.filter((candidate) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
            return true;
        const relation = candidate;
        const target = projectFactAssociationTarget(relation.target);
        if (typeof relation.relation_key !== 'string' || target === null)
            return true;
        const targetKey = factAssociationTargetKey(target);
        if (seenTargets.has(targetKey))
            return false;
        seenTargets.add(targetKey);
        return true;
    });
    return Promise.all(visibleRelations.map(async (candidate) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
            return { available: false };
        const relation = candidate;
        const target = projectFactAssociationTarget(relation.target);
        if (typeof relation.relation_key !== 'string' || target === null)
            return { available: false };
        const projection = { relationKey: relation.relation_key, target, available: false };
        if ('commit' in target) {
            const shortHash = target.commit.slice(0, 7);
            const commitDescription = await readCommitDescription(target.commit, scope);
            return { ...projection, available: true, shortHash, ...(commitDescription ? { title: commitDescription } : {}) };
        }
        const locator = 'objectUid' in target ? uidTargets.get(target.objectUid) : target;
        if (!locator || locator.governedProjectId !== scope.governedProjectId || !isObjectType(locator.factTypeKey))
            return projection;
        const exact = await readLocalFact(locator.factTypeKey, locator.objectId, scope);
        if (exact.status !== 'ok' || exact.item.read_status !== 'readable' || exact.item.fact_object === null)
            return projection;
        const source = exact.item.fact_object;
        if (typeof source.title !== 'string' || !source.title.trim())
            return projection;
        return {
            ...projection,
            available: true,
            ...('objectUid' in target ? { resolvedTarget: locator } : {}),
            title: source.title,
            ...copyPresentFields(source, ['title_en', 'title_zh', 'status']),
        };
    }));
}
async function projectFactRefs(item, scope, uidTargets) {
    const refs = item.fact_object?.refs;
    if (!Array.isArray(refs))
        return [];
    const out = [];
    const seen = new Set();
    for (const candidate of refs) {
        const objectUid = typeof candidate === 'string'
            ? candidate
            : (candidate && typeof candidate === 'object' && !Array.isArray(candidate)
                ? candidate.object_uid
                : undefined);
        if (typeof objectUid !== 'string' || !objectUid.trim() || seen.has(objectUid))
            continue;
        seen.add(objectUid);
        const locator = uidTargets.get(objectUid) ?? null;
        if (!locator || locator.governedProjectId !== scope.governedProjectId || !isObjectType(locator.factTypeKey)) {
            out.push({ objectUid, target: { objectUid }, available: false });
            continue;
        }
        const exact = await readLocalFact(locator.factTypeKey, locator.objectId, scope);
        if (exact.status !== 'ok' || exact.item.read_status !== 'readable' || exact.item.fact_object === null) {
            out.push({ objectUid, target: { objectUid }, available: false });
            continue;
        }
        const source = exact.item.fact_object;
        if (typeof source.title !== 'string' || !source.title.trim()) {
            out.push({ objectUid, target: { objectUid }, available: false });
            continue;
        }
        out.push({
            objectUid,
            target: { objectUid },
            available: true,
            resolvedTarget: locator,
            title: source.title,
            ...copyPresentFields(source, ['title_en', 'title_zh', 'status']),
        });
    }
    return out;
}
async function projectListItemWithAssociations(type, item, scope, uidTargets, _refSourceIndex) {
    const associations = await projectFactCardAssociations(item, scope, uidTargets);
    const refs = await projectFactRefs(item, scope, uidTargets);
    const inboundRefSources = [];
    return {
        ...projectListItem(type, item, uidTargets),
        ...(associations.length > 0 ? { factAssociations: associations } : {}),
        ...(refs.length > 0 ? { factRefs: refs } : {}),
        ...(inboundRefSources.length > 0 ? { factRefSources: inboundRefSources } : {}),
    };
}
function copyPresentFields(source, fields) {
    return Object.fromEntries(fields.flatMap((field) => Object.prototype.hasOwnProperty.call(source, field) ? [[field, source[field]]] : []));
}
async function deriveServingWorkIndex(scope) {
    const types = ['spark'];
    const bySubGoal = new Map();
    const unreadable = [];
    for (const type of types) {
        let listed;
        try {
            listed = await listLocalFacts(type, scope);
        }
        catch {
            unreadable.push(`${type}: read failed`);
            continue;
        }
        if (listed.status !== 'complete') {
            unreadable.push(`${type}: ${listed.issues[0]?.message ?? 'unavailable'}`);
            continue;
        }
        for (const item of listed.items) {
            if (item.read_status !== 'readable' || item.fact_object === null) {
                unreadable.push(`${type}: ${item.object_ref.object_id} unreadable`);
                continue;
            }
            const serves = item.fact_object.serves;
            const targets = Array.isArray(serves) ? serves : typeof serves === 'string' ? [serves] : [];
            if (targets.length === 0)
                continue;
            const uid = typeof item.fact_object.object_uid === 'string' ? item.fact_object.object_uid : undefined;
            const status = typeof item.fact_object.status === 'string' ? item.fact_object.status : '';
            for (const target of targets) {
                if (typeof target !== 'string' || target.length === 0)
                    continue;
                const rows = bySubGoal.get(target) ?? [];
                rows.push({
                    object_uid: uid,
                    type,
                    id: item.object_ref.object_id,
                    title: typeof item.fact_object.title === 'string' ? item.fact_object.title : item.object_ref.object_id,
                    status,
                    governed_project_id: item.object_ref.governed_project_id,
                    href: `/objects/${type}/${item.object_ref.object_id}`,
                });
                bySubGoal.set(target, rows);
            }
        }
    }
    return { bySubGoal, unreadable };
}
export async function deriveServingWorkIndexForScope(scope) {
    return deriveServingWorkIndex(scope);
}
async function deriveServingWork(scope, subGoalUid) {
    const index = await deriveServingWorkIndex(scope);
    return { items: index.bySubGoal.get(subGoalUid) ?? [], unreadable: index.unreadable };
}
export async function listObjects(type, _baseDir, status, scope) {
    try {
        const resolvedScope = await readingScope(scope);
        const listed = await listLocalFacts(type, resolvedScope);
        if (listed.status !== 'complete')
            return notIntegrated(type, listed.issues[0]?.message ?? `类型 ${type} 无法列举`);
        const uidTargets = await currentProjectUidTargets(resolvedScope);
        const refSourceIndex = await currentProjectFactRefSources(resolvedScope);
        const servingWork = type === 'subgoal' ? await deriveServingWorkIndex(resolvedScope) : null;
        const projectedItems = await Promise.all(listed.items.map(async (item) => {
            const projected = await projectListItemWithAssociations(type, item, resolvedScope, uidTargets, refSourceIndex);
            if (servingWork === null)
                return projected;
            const subGoalUid = typeof item.fact_object?.object_uid === 'string' ? item.fact_object.object_uid : '';
            if (!subGoalUid)
                return projected;
            const derived = servingWork.bySubGoal.get(subGoalUid) ?? [];
            return {
                ...projected,
                serving_work: derived,
                ...(derived.length === 0 ? { serving_empty: true } : {}),
                ...(servingWork.unreadable.length > 0 ? { serving_unreadable: servingWork.unreadable } : {}),
            };
        }));
        const items = projectedItems.filter((item) => !status || item.status === status);
        const response = result('list', type, { items, coverage_status: 'complete', collection_issues: listed.issues });
        response.issues = [
            ...listed.issues.map((issue) => ({ ...issue })),
            ...listed.items.flatMap((item) => item.issues.map((issue) => ({ ...issue, object_ref: item.object_ref }))),
            ...listed.items.flatMap((item) => item.field_issues.map((issue) => ({
                code: issue.reason,
                message: `字段 ${issue.path} ${issue.reason}；期望 ${issue.expected}`,
                path: issue.path,
                object_ref: item.object_ref,
            }))),
        ];
        return response;
    }
    catch (caught) {
        return error(caught);
    }
}
const OBJECT_ID_PATTERN = /^(pitfall|spark|report|friction|norm|subgoal)-(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-7][0-9A-HJKMNP-TV-Z]{25})$/;
export async function showObject(id, scope) {
    const match = OBJECT_ID_PATTERN.exec(id);
    if (!match)
        return { ok: false, error: `Object not found: ${id}`, stderr: '', exitCode: 1 };
    const type = match[1];
    try {
        const resolvedScope = await readingScope(scope);
        const detail = await readLocalFact(type, id, resolvedScope);
        if (detail.status !== 'ok')
            return readFailure(id, type, detail.metadata, detail.issues);
        const item = detail.item;
        if (item.read_status === 'unreadable' || item.fact_object === null)
            return readFailure(id, type, item, item.issues);
        const data = {
            ...item.fact_object,
            object_ref: item.object_ref,
            canonical_path: item.canonical_path,
            carrier: item.carrier,
            read_status: item.read_status,
            ...(typeof item.yaml_source === 'string' ? { yaml_source: item.yaml_source } : {}),
            field_issues: item.field_issues,
            unparsed_structures: item.unparsed_structures,
            read_issues: item.issues,
        };
        const uidTargets = await currentProjectUidTargets(resolvedScope);
        const associations = await projectFactCardAssociations(item, resolvedScope, uidTargets);
        if (associations.length > 0)
            data.factAssociations = associations;
        const refs = await projectFactRefs(item, resolvedScope, uidTargets);
        if (refs.length > 0)
            data.factRefs = refs;
        if (type === 'subgoal') {
            const subGoalUid = typeof item.fact_object.object_uid === 'string' ? item.fact_object.object_uid : '';
            if (subGoalUid) {
                const derived = await deriveServingWork(resolvedScope, subGoalUid);
                data.serving_work = derived.items;
                if (derived.items.length === 0)
                    data.serving_empty = true;
                if (derived.unreadable.length > 0)
                    data.serving_unreadable = derived.unreadable;
            }
        }
        const response = { ...result('show', id, data), summary: { id, type, ...(typeof data.status === 'string' ? { status: data.status } : {}) } };
        response.issues = [...item.issues, ...item.field_issues];
        return response;
    }
    catch (caught) {
        return error(caught);
    }
}
