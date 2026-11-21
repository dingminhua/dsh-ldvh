import { execFile } from 'node:child_process';
import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { LDVH_ROOT, LDVH_WORKSPACE_ROOT } from './pytools.js';
const MAX_WORKSPACE_DIRECTORIES = 200;
const CONFLICT_STATUSES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
function runGit(cwd, args) {
    return new Promise((resolve, reject) => {
        execFile('git', ['-C', cwd, ...args], { maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr.trim() || error.message));
                return;
            }
            resolve(stdout);
        });
    });
}
function isInside(basePath, targetPath) {
    const relative = path.relative(basePath, targetPath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
async function canonicalPath(value) {
    try {
        return await realpath(value);
    }
    catch {
        return path.resolve(value);
    }
}
async function gitCommonDir(worktreePath) {
    const value = await runGit(worktreePath, ['rev-parse', '--path-format=absolute', '--git-common-dir']).catch(() => '');
    return value.trim() ? canonicalPath(value.trim()) : undefined;
}
function worktreePaths(output) {
    return output.split('\n')
        .filter((line) => line.startsWith('worktree '))
        .map((line) => line.slice('worktree '.length).trim())
        .filter(Boolean);
}
function statusSummary(output) {
    const summary = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
    for (const line of output.split('\n')) {
        if (!line)
            continue;
        const status = line.slice(0, 2);
        if (status === '??') {
            summary.untracked += 1;
            continue;
        }
        if (CONFLICT_STATUSES.has(status)) {
            summary.conflicted += 1;
            continue;
        }
        if (status[0] && status[0] !== ' ')
            summary.staged += 1;
        if (status[1] && status[1] !== ' ')
            summary.unstaged += 1;
    }
    return summary;
}
async function inspectWorktree(worktreePath, isMain, registeredByPath, governedByCommonDir) {
    const [branch, head, status, commonDir] = await Promise.all([
        runGit(worktreePath, ['branch', '--show-current']).catch(() => ''),
        runGit(worktreePath, ['rev-parse', '--short', 'HEAD']).catch(() => ''),
        runGit(worktreePath, ['status', '--porcelain=v1', '--untracked-files=all']).catch(() => undefined),
        gitCommonDir(worktreePath),
    ]);
    const registeredProjectId = registeredByPath.get(worktreePath);
    const governedProjectId = commonDir ? governedByCommonDir.get(commonDir) : undefined;
    return {
        path: worktreePath,
        ...(branch.trim() ? { branch: branch.trim() } : {}),
        ...(head.trim() ? { head: head.trim() } : {}),
        isMain,
        ...(status === undefined ? {} : { status: statusSummary(status) }),
        ...(registeredProjectId ? { registeredProjectId } : {}),
        ...(governedProjectId ? { governedProjectId } : {}),
    };
}
export async function scanWorkspaceWorktrees(projects) {
    const workspaceRoot = await canonicalPath(LDVH_WORKSPACE_ROOT);
    const entries = await readdir(workspaceRoot, { withFileTypes: true });
    const candidates = new Set([workspaceRoot, path.resolve(LDVH_ROOT)]);
    for (const entry of entries.slice(0, MAX_WORKSPACE_DIRECTORIES)) {
        if (!entry.isDirectory() || entry.name.startsWith('.'))
            continue;
        candidates.add(path.join(workspaceRoot, entry.name));
    }
    const registeredByPath = new Map();
    const governedByCommonDir = new Map();
    for (const project of projects) {
        const registeredPath = await canonicalPath(project.path);
        registeredByPath.set(registeredPath, project.id);
        const commonDir = await gitCommonDir(registeredPath);
        if (commonDir && !governedByCommonDir.has(commonDir))
            governedByCommonDir.set(commonDir, project.id);
    }
    const discovered = new Map();
    for (const candidate of candidates) {
        const listed = await runGit(candidate, ['worktree', 'list', '--porcelain']).catch(() => '');
        const paths = worktreePaths(listed);
        for (const [index, listedPath] of paths.entries()) {
            const resolved = await canonicalPath(listedPath);
            if (!isInside(workspaceRoot, resolved) || discovered.has(resolved))
                continue;
            discovered.set(resolved, { isMain: index === 0 });
        }
    }
    const inspected = await Promise.all([...discovered.entries()].map(async ([worktreePath, metadata]) => (inspectWorktree(worktreePath, metadata.isMain, registeredByPath, governedByCommonDir))));
    return inspected.sort((left, right) => left.path.localeCompare(right.path));
}
export async function scanGovernedProjectWorktrees(projects) {
    const registeredByPath = new Map();
    const governedByCommonDir = new Map();
    for (const project of projects) {
        const registeredPath = await canonicalPath(project.path);
        registeredByPath.set(registeredPath, project.id);
        const commonDir = await gitCommonDir(registeredPath);
        if (commonDir)
            governedByCommonDir.set(commonDir, project.id);
    }
    const discovered = new Map();
    for (const project of projects) {
        const listed = await runGit(project.path, ['worktree', 'list', '--porcelain']).catch(() => '');
        for (const [index, listedPath] of worktreePaths(listed).entries()) {
            const resolved = await canonicalPath(listedPath);
            if (!discovered.has(resolved))
                discovered.set(resolved, { isMain: index === 0 });
        }
    }
    const inspected = await Promise.all([...discovered.entries()].map(async ([worktreePath, metadata]) => (inspectWorktree(worktreePath, metadata.isMain, registeredByPath, governedByCommonDir))));
    return inspected.sort((left, right) => left.path.localeCompare(right.path));
}
export async function resolveGovernedProjectWorktree(project, requestedPath) {
    const requested = await canonicalPath(requestedPath);
    const listed = await runGit(project.path, ['worktree', 'list', '--porcelain']).catch(() => '');
    for (const listedPath of worktreePaths(listed)) {
        const resolved = await canonicalPath(listedPath);
        if (resolved === requested)
            return resolved;
    }
    return undefined;
}
export function workspaceRootForWorktreeScan() {
    return LDVH_WORKSPACE_ROOT;
}
