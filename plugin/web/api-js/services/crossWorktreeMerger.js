import { execFile } from 'node:child_process';
import { listLocalFacts, } from './localFactReader.js';
function runGit(cwd, args) {
    return new Promise((resolve, reject) => {
        execFile('git', ['-C', cwd, ...args], { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error)
                reject(new Error(stderr.trim() || error.message));
            else
                resolve(stdout);
        });
    });
}
function parseWorktreePaths(output) {
    return output
        .split('\n')
        .filter((line) => line.startsWith('worktree '))
        .map((line) => line.slice('worktree '.length).trim())
        .filter(Boolean);
}
export async function getWorktreeInfos(mainWorktreePath) {
    const output = await runGit(mainWorktreePath, [
        'worktree',
        'list',
        '--porcelain',
    ]);
    const paths = parseWorktreePaths(output);
    const infos = await Promise.all(paths.map(async (wpath, index) => {
        const branch = await runGit(wpath, ['branch', '--show-current']).catch(() => '');
        return { path: wpath, branch: branch.trim(), isMain: index === 0 };
    }));
    return infos;
}
export async function collectFingerprints(worktreeInfos, governedProjectId, type) {
    const fingerprints = new Map();
    const itemsByWorktree = new Map();
    for (const info of worktreeInfos) {
        const scope = {
            worktreeLocator: info.path,
            governedProjectId,
        };
        const listed = await listLocalFacts(type, scope);
        if (listed.status !== 'complete')
            continue;
        itemsByWorktree.set(info.path, listed.items);
        for (const item of listed.items) {
            const objectId = item.object_ref.object_id;
            if (!fingerprints.has(objectId)) {
                fingerprints.set(objectId, new Map());
            }
            fingerprints.get(objectId).set(info.path, item.source_content_fingerprint);
        }
    }
    return { fingerprints, itemsByWorktree };
}
export function calculateMergeMeta(fingerprints, worktreeInfos, currentWorktreePath, mainWorktreePath) {
    const meta = new Map();
    for (const [objectId, pathFingerprints] of fingerprints) {
        const currentFingerprint = pathFingerprints.get(currentWorktreePath) ?? null;
        const mainFingerprint = pathFingerprints.get(mainWorktreePath) ?? null;
        if (currentFingerprint !== null) {
            if (mainFingerprint !== null &&
                mainFingerprint !== currentFingerprint) {
                meta.set(objectId, { mainWorktreeDiffers: true });
            }
        }
        else {
            for (const info of worktreeInfos) {
                if (info.path === currentWorktreePath)
                    continue;
                if (pathFingerprints.has(info.path)) {
                    meta.set(objectId, {
                        sourceBranch: info.branch || info.path,
                    });
                    break;
                }
            }
        }
    }
    return meta;
}
