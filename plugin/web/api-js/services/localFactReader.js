import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { FACT_FIELD_CONTRACT } from './factFieldContract.js';
import { canonicalUid } from '../../shared-js/factIdentity.js';
export const FACT_TYPE_DIRS = {
    pitfall: 'pitfalls',
    spark: 'sparks',
    report: 'reports',
    friction: 'frictions',
    norm: 'norms',
    subgoal: 'subgoals',
};
export const FACT_TYPE_CARRIERS = {
    pitfall: '.md',
    spark: '.md',
    report: '.md',
    friction: '.md',
    norm: '.md',
    subgoal: '.md',
};
function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
const listCache = new Map();
const LIST_CACHE_LIMIT = 64;
function cacheKeyOf(scope, type) {
    return `${scope.governedProjectId}\u0000${scope.worktreeLocator}\u0000${type}`;
}
async function carrierSignature(dir) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch {
        return null;
    }
    const parts = [];
    for (const entry of entries) {
        if (!entry.isFile())
            continue;
        try {
            const info = await stat(path.join(dir, entry.name));
            parts.push(`${entry.name}:${info.mtimeMs}:${info.size}`);
        }
        catch {
            parts.push(`${entry.name}:missing`);
        }
    }
    parts.sort();
    return parts.join('|');
}
function rememberList(key, entry) {
    if (listCache.size >= LIST_CACHE_LIMIT && !listCache.has(key)) {
        const oldest = listCache.keys().next().value;
        if (oldest !== undefined)
            listCache.delete(oldest);
    }
    listCache.set(key, entry);
}
function baseDirOf(scope, type) {
    return path.join(scope.worktreeLocator, 'ldvh-base', FACT_TYPE_DIRS[type]);
}
function expectedFileName(type, objectId) {
    return `${objectId}${FACT_TYPE_CARRIERS[type]}`;
}
const MARKDOWN_CARRIER_TYPES = new Set([
    'report', 'spark', 'pitfall', 'friction', 'norm', 'subgoal',
]);
function carrierFor(type) {
    return MARKDOWN_CARRIER_TYPES.has(type) ? 'markdown' : 'yaml';
}
function metadataFor(scope, type, objectId) {
    const fileName = expectedFileName(type, objectId);
    return {
        object_ref: { governed_project_id: scope.governedProjectId, fact_type_key: type, object_id: objectId },
        canonical_path: path.posix.join('ldvh-base', FACT_TYPE_DIRS[type], fileName),
        absolute_path: path.join(baseDirOf(scope, type), fileName),
        carrier: carrierFor(type),
    };
}
function isExpectedCarrierName(type, fileName) {
    const extension = FACT_TYPE_CARRIERS[type].replace('.', '\\.');
    const idSegment = MARKDOWN_CARRIER_TYPES.has(type)
        ? '(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\\d{4,}|[0-7][0-9A-HJKMNP-TV-Z]{25})'
        : '(?:\\d{4,}|[0-7][0-9A-HJKMNP-TV-Z]{25})';
    return new RegExp(`^${type}-${idSegment}${extension}$`).test(fileName);
}
function expectedManifestPath(metadata) {
    return metadata.absolute_path;
}
function looksLikeFactCarrier(fileName) {
    return /\.(?:yaml|yml|md)$/i.test(fileName);
}
function parseMarkdownWithFrontmatter(content) {
    const lines = content.split(/\r?\n/);
    if (lines[0]?.trim() !== '---') {
        return { metadata: null, frontmatterSource: '', body: '', issues: [{ code: 'frontmatter_missing', message: 'Markdown 缺少 frontmatter' }] };
    }
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end === -1) {
        return { metadata: null, frontmatterSource: '', body: '', issues: [{ code: 'frontmatter_unclosed', message: 'frontmatter 未闭合' }] };
    }
    const frontmatterSource = lines.slice(1, end).join('\n');
    try {
        const value = yaml.load(frontmatterSource);
        if (!isRecord(value)) {
            return { metadata: null, frontmatterSource, body: '', issues: [{ code: 'frontmatter_parse_failed', message: 'frontmatter 顶层不是键值映射' }] };
        }
        return { metadata: value, frontmatterSource, body: lines.slice(end + 1).join('\n').replace(/^\s*\n/, ''), issues: [] };
    }
    catch (error) {
        return { metadata: null, frontmatterSource, body: '', issues: [{ code: 'frontmatter_parse_failed', message: `frontmatter YAML 解析失败：${error instanceof Error ? error.message : String(error)}` }] };
    }
}
const TIMESTAMP_FIELDS = new Set([
    'created_at', 'updated_at', 'retired_at', 'occurred_at', 'resolved_at', 'closed_at',
]);
function isTimestampField(field) {
    return TIMESTAMP_FIELDS.has(field);
}
function matchesObjectShape(value, shape) {
    if (!shape)
        return true;
    for (const key of shape.requiredKeys ?? []) {
        if (!(key in value))
            return false;
    }
    for (const key of shape.nonEmptyKeys ?? []) {
        const member = value[key];
        if (typeof member !== 'string' || member.trim().length === 0)
            return false;
    }
    return true;
}
function matchesExpectation(value, expected, shape) {
    if (expected === 'array')
        return Array.isArray(value);
    if (expected === 'object')
        return isRecord(value) && matchesObjectShape(value, shape);
    return typeof value === expected;
}
const RECORD_ARRAY_FIELDS = {
    spark: new Set(['evolution', 'relations', 'change_log']),
    pitfall: new Set(['change_log']),
    report: new Set(['uncertain', 'gaps', 'implications', 'clarification_log', 'change_log']),
};
function isConsumableRecordMember(type, field, member) {
    if (field === 'change_log') {
        const at = member.at instanceof Date ? member.at.toISOString() : member.at;
        return typeof at === 'string' && at.trim().length > 0
            && typeof member.summary === 'string' && member.summary.trim().length > 0
            && (member.signature === undefined || isConsumableChangeLogSignature(member.signature));
    }
    if (type !== 'spark' || field !== 'evolution')
        return true;
    const evolutionAt = member.at instanceof Date ? member.at.toISOString() : member.at;
    return typeof evolutionAt === 'string' && evolutionAt.trim().length > 0
        && typeof member.summary === 'string' && member.summary.trim().length > 0;
}
function isConsumableChangeLogSignature(value) {
    if (!isRecord(value))
        return false;
    const hasCurrentShape = Object.keys(value).every((key) => key === 'product_name' || key === 'model_name')
        && Object.keys(value).length === 2
        && Object.entries(value).every(([key, entry]) => (['product_name', 'model_name'].includes(key)
            ? entry === null || (typeof entry === 'string' && entry.trim().length > 0)
            : false))
        && Object.values(value).some((entry) => typeof entry === 'string' && entry.trim().length > 0);
    if (hasCurrentShape)
        return true;
    const hasLegacyThreeFieldShape = Object.keys(value).every((key) => key === 'product_name' || key === 'model_name' || key === 'agent_runtime_name')
        && Object.keys(value).length === 3
        && Object.entries(value).every(([key, entry]) => (['product_name', 'model_name', 'agent_runtime_name'].includes(key)
            ? entry === null || (typeof entry === 'string' && entry.trim().length > 0)
            : false))
        && Object.values(value).some((entry) => typeof entry === 'string' && entry.trim().length > 0);
    if (hasLegacyThreeFieldShape)
        return true;
    const hasCanonicalShape = Object.keys(value).every((key) => key === 'model_id' || key === 'agent_workbench')
        && typeof value.model_id === 'string'
        && value.model_id.trim().length > 0
        && typeof value.agent_workbench === 'string'
        && value.agent_workbench.trim().length > 0;
    if (hasCanonicalShape)
        return true;
    const hasHostEnvironmentLegacy = Object.keys(value).every((key) => key === 'agent_id' || key === 'host_environment')
        && typeof value.agent_id === 'string'
        && value.agent_id.trim().length > 0
        && typeof value.host_environment === 'string'
        && value.host_environment.trim().length > 0;
    if (hasHostEnvironmentLegacy)
        return true;
    return Object.keys(value).every((key) => key === 'model_id' || key === 'host_name')
        && typeof value.model_id === 'string'
        && value.model_id.trim().length > 0
        && typeof value.host_name === 'string'
        && value.host_name.trim().length > 0;
}
function projectFields(type, objectId, parsed, extra) {
    const all = { ...parsed, ...extra };
    const expected = FACT_FIELD_CONTRACT[type];
    const factObject = {};
    const fieldIssues = [];
    const unparsedStructures = [];
    if (all.object_id === undefined && objectId)
        all.object_id = objectId;
    for (const [field, contract] of Object.entries(expected)) {
        const { expected: kind } = contract;
        const value0 = all[field];
        const value = kind === 'string' && isTimestampField(field) && value0 instanceof Date
            ? value0.toISOString()
            : value0;
        if (value === undefined || value === null) {
            if (contract.required)
                fieldIssues.push({ path: field, reason: 'missing', expected: kind });
            continue;
        }
        if (!matchesExpectation(value, kind, contract.objectShape)) {
            fieldIssues.push({ path: field, reason: 'type_mismatch', expected: kind, raw_value: value });
            continue;
        }
        factObject[field] = value;
        if (kind === 'array' && Array.isArray(value) && RECORD_ARRAY_FIELDS[type]?.has(field)) {
            value.forEach((member, index) => {
                if (!isRecord(member) || !isConsumableRecordMember(type, field, member)) {
                    unparsedStructures.push({ path: `${field}[${index}]`, reason: 'unparseable_member', raw_value: member });
                }
            });
        }
    }
    if (typeof all.object_id === 'string' && all.object_id !== objectId) {
        fieldIssues.push({ path: 'object_id', reason: 'identity_mismatch', expected: objectId, raw_value: all.object_id });
    }
    if (typeof all.fact_type_key === 'string' && all.fact_type_key !== type) {
        fieldIssues.push({ path: 'fact_type_key', reason: 'identity_mismatch', expected: type, raw_value: all.fact_type_key });
    }
    if (all.object_uid !== undefined && !canonicalUid(all.object_uid)) {
        fieldIssues.push({
            path: 'object_uid',
            reason: 'identity_mismatch',
            expected: 'canonical lowercase UUIDv4',
            raw_value: all.object_uid,
        });
    }
    unparsedStructures.push(...Object.entries(all)
        .filter(([field]) => !(field in expected))
        .map(([field, value]) => ({ path: field, reason: 'unconsumed_field', raw_value: value })));
    return { fact_object: factObject, field_issues: fieldIssues, unparsed_structures: unparsedStructures };
}
function unreadable(metadata, issues) {
    return { ...metadata, read_status: 'unreadable', source_content_fingerprint: null, fact_object: null, field_issues: [], unparsed_structures: [], issues: issues.map((issue) => ({ ...issue, path: issue.path ?? metadata.canonical_path })) };
}
function readable(metadata, sourceContentFingerprint, projected, yamlSource) {
    const objectUid = projected.fact_object?.object_uid;
    return {
        ...metadata,
        ...(canonicalUid(objectUid) ? { authority_ref: { object_uid: objectUid } } : {}),
        read_status: 'readable',
        source_content_fingerprint: sourceContentFingerprint,
        ...(yamlSource !== undefined ? { yaml_source: yamlSource } : {}),
        ...projected,
        issues: [],
    };
}
async function readItemFile(scope, type, fileName) {
    const objectId = fileName.replace(/\.(yaml|yml|md)$/i, '');
    const metadata = metadataFor(scope, type, objectId);
    let content;
    let sourceContentFingerprint;
    try {
        const carrierBytes = await readFile(expectedManifestPath(metadata));
        content = carrierBytes.toString('utf-8');
        sourceContentFingerprint = createHash('sha256').update(carrierBytes).digest('hex');
    }
    catch (error) {
        return unreadable(metadata, [{ code: 'read_failed', message: `文件读取失败：${error instanceof Error ? error.message : String(error)}` }]);
    }
    if (metadata.carrier === 'markdown') {
        const parsed = parseMarkdownWithFrontmatter(content);
        if (parsed.metadata === null)
            return unreadable(metadata, parsed.issues);
        return readable(metadata, sourceContentFingerprint, projectFields(type, objectId, parsed.metadata, { report_body: parsed.body }), parsed.frontmatterSource);
    }
    let parsed;
    try {
        parsed = yaml.load(content);
    }
    catch (error) {
        return unreadable(metadata, [{ code: 'yaml_parse_failed', message: `YAML 解析失败：${error instanceof Error ? error.message : String(error)}` }]);
    }
    if (!isRecord(parsed)) {
        return unreadable(metadata, [{ code: 'yaml_parse_failed', message: 'YAML 顶层不是键值映射' }]);
    }
    return readable(metadata, sourceContentFingerprint, projectFields(type, objectId, parsed, {}), content);
}
function emptyTypeDirectory() {
    return { status: 'complete', items: [], issues: [] };
}
function directoryMissing(scope, type) {
    return !existsSync(baseDirOf(scope, type));
}
export async function listLocalFacts(type, scope) {
    if (directoryMissing(scope, type))
        return emptyTypeDirectory();
    const dir = baseDirOf(scope, type);
    const key = cacheKeyOf(scope, type);
    const signature = await carrierSignature(dir);
    if (signature !== null) {
        const cached = listCache.get(key);
        if (cached && cached.signature === signature)
            return cached.list;
    }
    const entries = await readdir(dir, { withFileTypes: true });
    const carriers = entries.filter((entry) => entry.isFile() && looksLikeFactCarrier(entry.name));
    const fileNames = carriers.filter((entry) => isExpectedCarrierName(type, entry.name)).map((entry) => entry.name).sort((left, right) => left.localeCompare(right));
    const v5UidCarrier = MARKDOWN_CARRIER_TYPES.has(type);
    const issues = carriers.filter((entry) => !isExpectedCarrierName(type, entry.name)).map((entry) => ({
        code: 'unexpected_fact_carrier',
        message: v5UidCarrier
            ? `${type} 正式载体必须是 ${type}-<uid>${FACT_TYPE_CARRIERS[type]}，已忽略错载体 ${entry.name}`
            : `${type} 正式载体必须是 ${type}-NNNN${FACT_TYPE_CARRIERS[type]}，已忽略错载体 ${entry.name}`,
        path: path.posix.join('ldvh-base', FACT_TYPE_DIRS[type], entry.name),
    }));
    const list = { status: 'complete', items: await Promise.all(fileNames.map((fileName) => readItemFile(scope, type, fileName))), issues };
    if (signature !== null)
        rememberList(key, { signature, list });
    return list;
}
const FACT_OBJECT_ID_PATTERN = /^(pitfall|spark|report|friction|norm|subgoal)-(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-7][0-9A-HJKMNP-TV-Z]{25})$/;
export async function readLocalFact(type, objectId, scope) {
    const metadata = metadataFor(scope, type, objectId);
    if (!FACT_OBJECT_ID_PATTERN.test(objectId)) {
        return { status: 'not_found', metadata, issues: [{ code: 'read_failed', message: `未找到预期事实对象 ${objectId}`, path: metadata.canonical_path }] };
    }
    const expectedName = expectedFileName(type, objectId);
    const filePath = path.join(baseDirOf(scope, type), expectedName);
    try {
        const lstatResult = await lstat(filePath);
        if (!lstatResult.isFile() || lstatResult.isSymbolicLink()) {
            return { status: 'not_found', metadata, issues: [{ code: 'read_failed', message: `未找到预期事实对象 ${expectedName}`, path: metadata.canonical_path }] };
        }
    }
    catch {
        return { status: 'not_found', metadata, issues: [{ code: 'read_failed', message: `未找到预期事实对象 ${expectedName}`, path: metadata.canonical_path }] };
    }
    return { status: 'ok', item: await readItemFile(scope, type, expectedName) };
}
