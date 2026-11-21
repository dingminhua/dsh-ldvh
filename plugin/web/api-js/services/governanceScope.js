import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import yaml from 'js-yaml';
import path from 'node:path';
import { LDVH_ROOT } from './pytools.js';
let verifiedSnapshot = null;
let verificationInFlight = null;
export class WebGovernanceError extends Error {
    constructor(message) {
        super(message);
        this.name = 'WebGovernanceError';
    }
}
function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function configuredLocator() {
    const raw = process.env.LDVH_WEB_WORKTREE_LOCATOR || LDVH_ROOT;
    return path.resolve(raw);
}
function v5CarrierPath() {
    const configured = process.env.LDVH_GOVERNED_PROJECTS_CONFIG;
    return configured ? path.resolve(configured) : null;
}
function configurationPath() {
    const carrier = v5CarrierPath();
    if (carrier === null) {
        throw new WebGovernanceError('Governance configuration is unavailable: LDVH_GOVERNED_PROJECTS_CONFIG is not set');
    }
    return carrier;
}
function gitEnvironment() {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
        if (key === 'GIT_CONFIG_COUNT' || key.startsWith('GIT_CONFIG_KEY_') || key.startsWith('GIT_CONFIG_VALUE_')
            || ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY'].includes(key))
            delete env[key];
    }
    return env;
}
function gitQuery(worktree, args) {
    return new Promise((resolve, reject) => {
        execFile('git', ['-C', worktree, ...args], { env: gitEnvironment(), encoding: 'utf8', timeout: 10_000 }, (error, stdout) => {
            if (error)
                reject(error);
            else
                resolve(String(stdout).trim());
        });
    });
}
async function resolveV5ProjectIdentity(projectPath) {
    try {
        const requested = await realpath(projectPath);
        const top = await gitQuery(projectPath, ['rev-parse', '--show-toplevel']);
        const common = await gitQuery(projectPath, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
        const canonicalRoot = await realpath(top);
        if (canonicalRoot !== requested)
            return null;
        return { projectRoot: canonicalRoot, gitCommonDir: await realpath(common) };
    }
    catch {
        return null;
    }
}
async function resolveV5CarrierScope(carrierPath, fingerprint) {
    let content;
    try {
        content = await readFile(carrierPath, 'utf8');
    }
    catch (error) {
        throw new WebGovernanceError(`Governance configuration is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    let document;
    try {
        document = yaml.load(content);
    }
    catch (error) {
        throw new WebGovernanceError(`Governance configuration is not valid: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isRecord(document) || !Array.isArray(document.projects)) {
        throw new WebGovernanceError('Governance configuration is not valid: v5 carrier must declare a projects list');
    }
    const defaultProjectId = typeof document.default_project_id === 'string' ? document.default_project_id : '';
    const verified = [];
    for (const entry of document.projects) {
        if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim()
            || typeof entry.path !== 'string' || !entry.path.trim())
            continue;
        const identity = await resolveV5ProjectIdentity(entry.path);
        if (identity)
            verified.push({ id: entry.id, path: identity.projectRoot, gitCommonDir: identity.gitCommonDir });
    }
    if (verified.length === 0) {
        throw new WebGovernanceError('Governance resolution is not verified: no registered project has a verifiable Git worktree');
    }
    const locator = normalizedExistingPath(configuredLocator());
    const current = verified.find((project) => project.path === locator)
        ?? verified.find((project) => project.id === defaultProjectId)
        ?? verified[0];
    return { configurationFingerprint: fingerprint, current, projects: verified };
}
async function configurationFingerprint() {
    const content = await readFile(configurationPath(), 'utf8');
    return createHash('sha256').update(content).digest('hex');
}
function normalizedExistingPath(value) {
    const resolved = path.resolve(value);
    try {
        return realpathSync.native(resolved);
    }
    catch {
        return resolved;
    }
}
async function refreshVerifiedScope(fingerprint) {
    const carrier = v5CarrierPath();
    if (carrier === null) {
        throw new WebGovernanceError('Governance configuration is unavailable: LDVH_GOVERNED_PROJECTS_CONFIG is not set');
    }
    return resolveV5CarrierScope(carrier, fingerprint);
}
async function currentVerifiedScope(force = false) {
    let fingerprint;
    try {
        fingerprint = await configurationFingerprint();
    }
    catch (error) {
        throw new WebGovernanceError(`Governance configuration is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!force && verifiedSnapshot?.configurationFingerprint === fingerprint)
        return verifiedSnapshot;
    if (verificationInFlight)
        return verificationInFlight;
    verifiedSnapshot = null;
    verificationInFlight = refreshVerifiedScope(fingerprint)
        .then((snapshot) => {
        verifiedSnapshot = snapshot;
        return snapshot;
    })
        .catch((error) => {
        const normalized = error instanceof WebGovernanceError
            ? error
            : new WebGovernanceError(error instanceof Error ? error.message : String(error));
        throw normalized;
    })
        .finally(() => { verificationInFlight = null; });
    return verificationInFlight;
}
export function primeWebGovernanceScope() {
    return currentVerifiedScope().then(() => undefined).catch(() => undefined);
}
export async function verifyWebGovernanceConfiguration() {
    let fingerprint;
    try {
        fingerprint = await configurationFingerprint();
    }
    catch (error) {
        throw new WebGovernanceError(`Governance configuration is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    verifiedSnapshot = null;
    const carrier = v5CarrierPath();
    if (carrier === null) {
        throw new WebGovernanceError('Governance configuration is unavailable: LDVH_GOVERNED_PROJECTS_CONFIG is not set');
    }
    await resolveV5CarrierScope(carrier, fingerprint);
}
export async function resolveCurrentWebProject() {
    return (await currentVerifiedScope()).current;
}
export async function resolveWebGovernedProjects() {
    return (await currentVerifiedScope()).projects;
}
