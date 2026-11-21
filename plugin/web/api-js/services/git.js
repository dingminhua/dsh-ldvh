import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalizeRfc3339Timestamp, normalizeGitTimestampInput } from '../../shared-js/timestamp.js';
import { normalizeSignature } from '../../shared-js/signature.js';
import { getRelativeTime as sharedGetRelativeTime } from './time.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LDVH_ROOT = process.env.LDVH_ROOT || path.resolve(__dirname, '../../..');
export function normalizeTimestamp(value) {
    return canonicalizeRfc3339Timestamp(normalizeGitTimestampInput(value)) ?? value;
}
export const CATEGORY_COLORS = {
    feat: '#3b82f6',
    fix: '#ef4444',
    docs: '#6b7280',
    style: '#a855f7',
    refactor: '#06b6d4',
    test: '#eab308',
    chore: '#6b7280',
    perf: '#22c55e',
    ci: '#ec4899',
    build: '#92400e',
    release: '#7c3aed',
    default: '#6b7280',
};
export function parseCommitMessage(message) {
    const match = message.match(/^([A-Za-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/);
    if (match) {
        return {
            category: match[1].toLowerCase(),
            scope: match[2] ?? '',
            isBreaking: Boolean(match[3]),
            description: match[4],
        };
    }
    return {
        category: 'other',
        scope: '',
        description: message,
        isBreaking: false,
    };
}
export function splitCommitMessage(fullMessage) {
    const normalized = fullMessage.replace(/\r\n/g, '\n').trimEnd();
    const [subject = '', ...rest] = normalized.split('\n');
    return {
        subject,
        body: rest.join('\n').replace(/^\n+/, '').trim(),
    };
}
function getCommitTrailerValue(body, key) {
    const matcher = new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'gmi');
    const values = [...body.matchAll(matcher)]
        .map((match) => match[1]?.trim())
        .filter((value) => Boolean(value));
    return values.at(-1);
}
export function parseCommitSignature(body) {
    const v4ProductName = getCommitTrailerValue(body, 'LDVH-Product-Name');
    const v4ModelName = getCommitTrailerValue(body, 'LDVH-Model-Name');
    if (v4ProductName || v4ModelName) {
        const { productName, modelName } = normalizeSignature({
            productName: v4ProductName,
            modelName: v4ModelName,
        });
        if (productName || modelName) {
            return {
                ...(productName ? { productName } : {}),
                ...(modelName ? { modelName } : {}),
            };
        }
    }
    const provider = getCommitTrailerValue(body, 'LDVH-Provider');
    const model = getCommitTrailerValue(body, 'LDVH-Model');
    if (provider || model) {
        return {
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
        };
    }
    return undefined;
}
export async function getGitPushStatuses(hashes, cwd = LDVH_ROOT) {
    const statuses = new Map(hashes.map((hash) => [hash, 'unknown']));
    if (hashes.length === 0)
        return statuses;
    const upstream = await getGitUpstream(cwd);
    if (!upstream)
        return statuses;
    const getCommitsOutside = (ref) => new Promise((resolve) => {
        execFile('git', ['rev-list', '--no-walk', ...hashes, '--not', ref], { cwd, maxBuffer: 5 * 1024 * 1024 }, (error, stdout) => resolve(error ? null : new Set(stdout.split(/\r?\n/).filter(Boolean))));
    });
    const [outsideHead, outsideUpstream] = await Promise.all([
        getCommitsOutside('HEAD'),
        getCommitsOutside(upstream),
    ]);
    if (!outsideHead || !outsideUpstream)
        return statuses;
    for (const hash of hashes) {
        const inHead = !outsideHead.has(hash);
        const inUpstream = !outsideUpstream.has(hash);
        if (inHead && inUpstream)
            statuses.set(hash, 'pushed');
        else if (inHead)
            statuses.set(hash, 'unpushed');
        else if (inUpstream)
            statuses.set(hash, 'incoming');
    }
    return statuses;
}
async function getGitUpstream(cwd) {
    return new Promise((resolve) => {
        execFile('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { cwd, maxBuffer: 1024 * 1024 }, (error, stdout) => resolve(error ? null : stdout.trim() || null));
    });
}
export async function getGitLog(count = 50, locale = 'zh', cwd = LDVH_ROOT) {
    const upstream = await getGitUpstream(cwd);
    return new Promise((resolve, reject) => {
        execFile('git', [
            'log',
            `-${count}`,
            ...(upstream ? ['--date-order'] : []),
            '--format=%H%x1f%h%x1f%an%x1f%ai%x1f%B%x1e',
            ...(upstream ? ['HEAD', upstream] : []),
        ], { cwd, maxBuffer: 5 * 1024 * 1024 }, (error, stdout) => {
            if (error) {
                reject(new Error(`git log failed: ${error.message}`));
                return;
            }
            const blocks = stdout.split('\x1e').map((block) => block.trim()).filter(Boolean);
            const entries = blocks.map((block) => {
                const [hash, shortHash, author, date, fullMessage = ''] = block.split('\x1f');
                const { subject: message, body } = splitCommitMessage(fullMessage);
                const { category, scope, description, isBreaking } = parseCommitMessage(message);
                return {
                    hash,
                    shortHash,
                    author,
                    date: normalizeTimestamp(date),
                    message,
                    body,
                    category,
                    scope,
                    description,
                    isBreaking,
                    relativeTime: sharedGetRelativeTime(date, locale),
                    pushStatus: 'unknown',
                    signature: parseCommitSignature(body),
                };
            });
            void getGitPushStatuses(entries.map((entry) => entry.hash), cwd).then((pushStatuses) => {
                resolve(entries.map((entry) => ({
                    ...entry,
                    pushStatus: pushStatuses.get(entry.hash) || 'unknown',
                })));
            });
        });
    });
}
export async function getGitLogWithFiles(since, until, locale = 'zh', cwd = LDVH_ROOT) {
    return new Promise((resolve, reject) => {
        execFile('git', [
            'log',
            `--since=${since.toISOString()}`,
            `--until=${until.toISOString()}`,
            '--name-only',
            '--format=%x1e%H%x1f%h%x1f%an%x1f%aI%x1f%B%x1d',
        ], { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
            if (error) {
                reject(new Error(`git log with files failed: ${error.message}`));
                return;
            }
            const entries = stdout
                .split('\x1e')
                .map((block) => block.trim())
                .filter(Boolean)
                .flatMap((block) => {
                const separator = block.indexOf('\x1d');
                if (separator < 0)
                    return [];
                const header = block.slice(0, separator);
                const filesBlock = block.slice(separator + 1);
                const [hash, shortHash, author, date, fullMessage = ''] = header.split('\x1f');
                if (!hash || !shortHash || !date)
                    return [];
                const { subject: message, body } = splitCommitMessage(fullMessage);
                const { category, scope, description, isBreaking } = parseCommitMessage(message);
                const files = filesBlock
                    .split(/\r?\n/)
                    .map((entry) => entry.trim())
                    .filter(Boolean);
                return [{
                        hash,
                        shortHash,
                        author,
                        date: normalizeTimestamp(date),
                        message,
                        body,
                        category,
                        scope,
                        description,
                        isBreaking,
                        relativeTime: sharedGetRelativeTime(date, locale),
                        pushStatus: 'unknown',
                        signature: parseCommitSignature(body),
                        files,
                    }];
            });
            void getGitPushStatuses(entries.map((entry) => entry.hash), cwd).then((pushStatuses) => {
                resolve(entries.map((entry) => ({
                    ...entry,
                    pushStatus: pushStatuses.get(entry.hash) || 'unknown',
                })));
            });
        });
    });
}
export async function getGitCommit(hash, locale = 'zh', cwd = LDVH_ROOT) {
    return new Promise((resolve, reject) => {
        execFile('git', ['show', '-s', '--format=%H%x1f%h%x1f%an%x1f%ai%x1f%B', hash], { cwd, maxBuffer: 5 * 1024 * 1024 }, (error, stdout) => {
            if (error) {
                reject(new Error(`git show commit failed: ${error.message}`));
                return;
            }
            const [fullHash, shortHash, author, date, fullMessage = ''] = stdout.trimEnd().split('\x1f');
            const { subject: message, body } = splitCommitMessage(fullMessage);
            const { category, scope, description, isBreaking } = parseCommitMessage(message);
            void getGitPushStatuses([fullHash], cwd).then((pushStatuses) => resolve({
                hash: fullHash,
                shortHash,
                author,
                date: normalizeTimestamp(date),
                message,
                body,
                category,
                scope,
                description,
                isBreaking,
                relativeTime: sharedGetRelativeTime(date, locale),
                pushStatus: pushStatuses.get(fullHash) || 'unknown',
                signature: parseCommitSignature(body),
            }));
        });
    });
}
export async function getGitShow(hash, cwd = LDVH_ROOT) {
    return new Promise((resolve, reject) => {
        execFile('git', ['show', '--stat', hash], { cwd, maxBuffer: 5 * 1024 * 1024 }, (error, stdout) => {
            if (error) {
                reject(new Error(`git show failed: ${error.message}`));
                return;
            }
            resolve(stdout);
        });
    });
}
