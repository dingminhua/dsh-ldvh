/**
 * Git 服务：通过子进程执行 git 命令获取提交日志
 */

import { execFile } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { canonicalizeRfc3339Timestamp, normalizeGitTimestampInput } from '../../shared/timestamp.ts'
import { normalizeSignature } from '../../shared/signature.js'
import { getRelativeTime as sharedGetRelativeTime } from './time.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** LDVH 项目根目录 */
const LDVH_ROOT = process.env.LDVH_ROOT || path.resolve(__dirname, '../../..')

/**
 * How this commit relates to the current branch and its upstream-tracking ref.
 *
 * This is deliberately a local Git reachability check, not a network probe:
 * the web can state only what the currently fetched upstream ref proves.
 */
export type GitPushStatus = 'pushed' | 'unpushed' | 'incoming' | 'unknown'

/** Optional provenance markers carried in Git commit trailers. */
export type GitCommitSignature = {
  productName?: string
  modelName?: string
}

export interface GitLogEntry {
  hash: string
  shortHash: string
  author: string
  date: string
  message: string
  body: string
  category: string
  scope: string
  description: string
  isBreaking: boolean
  relativeTime: string
  pushStatus: GitPushStatus
  signature?: GitCommitSignature
}

/** A commit record together with its changed repository-relative paths. */
export interface GitLogEntryWithFiles extends GitLogEntry {
  files: string[]
}

export type ParsedCommitMessage = {
  category: string
  scope: string
  description: string
  isBreaking: boolean
}

export type SplitCommitMessage = {
  subject: string
  body: string
}

/** Normalize Git's offset-bearing date output at the API boundary. */
export function normalizeTimestamp(value: string): string {
  return canonicalizeRfc3339Timestamp(normalizeGitTimestampInput(value)) ?? value
}

/** Conventional commit 分类颜色 */
export const CATEGORY_COLORS: Record<string, string> = {
  feat: '#3b82f6',      // blue
  fix: '#ef4444',       // red
  docs: '#6b7280',      // gray
  style: '#a855f7',     // purple
  refactor: '#06b6d4',  // cyan
  test: '#eab308',      // yellow
  chore: '#6b7280',     // gray
  perf: '#22c55e',      // green
  ci: '#ec4899',        // pink
  build: '#92400e',     // brown
  release: '#7c3aed',   // violet
  default: '#6b7280',   // gray
}

/**
 * 解析 conventional commit message
 * 格式: type(scope)!: description、type!: description 或 type: description
 */
export function parseCommitMessage(message: string): ParsedCommitMessage {
  const match = message.match(/^([A-Za-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/)
  if (match) {
    return {
      category: match[1].toLowerCase(),
      scope: match[2] ?? '',
      isBreaking: Boolean(match[3]),
      description: match[4],
    }
  }
  return {
    category: 'other',
    scope: '',
    description: message,
    isBreaking: false,
  }
}

export function splitCommitMessage(fullMessage: string): SplitCommitMessage {
  const normalized = fullMessage.replace(/\r\n/g, '\n').trimEnd()
  const [subject = '', ...rest] = normalized.split('\n')
  return {
    subject,
    body: rest.join('\n').replace(/^\n+/, '').trim(),
  }
}

function getCommitTrailerValue(body: string, key: string): string | undefined {
  const matcher = new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'gmi')
  const values = [...body.matchAll(matcher)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))
  return values.at(-1)
}

/**
 * Read the display-safe part of an optional commit signature.
 *
 * Session identifiers and signer classification remain in the raw commit body;
 * the compact commit identity only exposes the model/agent and host when present.
 */
export function parseCommitSignature(body: string): GitCommitSignature | undefined {
  const productName = normalizeSignature({
    productName: getCommitTrailerValue(body, 'LDVH-Product-Name'),
    modelName: getCommitTrailerValue(body, 'LDVH-Model-Name'),
  }).productName || undefined
  const modelName = normalizeSignature({
    productName: getCommitTrailerValue(body, 'LDVH-Product-Name'),
    modelName: getCommitTrailerValue(body, 'LDVH-Model-Name'),
  }).modelName || undefined
  return productName || modelName
    ? { productName, modelName }
    : undefined
}

/**
 * Classify commits against the current branch's configured upstream.
 *
 * Shared commits are pushed, HEAD-only commits are unpushed, and upstream-only
 * commits are incoming. Repositories without a readable upstream stay unknown
 * so the UI never invents a synchronization state.
 */
export async function getGitPushStatuses(hashes: string[], cwd: string = LDVH_ROOT): Promise<Map<string, GitPushStatus>> {
  const statuses = new Map(hashes.map((hash) => [hash, 'unknown' as GitPushStatus]))
  if (hashes.length === 0) return statuses

  const upstream = await getGitUpstream(cwd)
  if (!upstream) return statuses

  const getCommitsOutside = (ref: string) => new Promise<Set<string> | null>((resolve) => {
    execFile(
      'git',
      ['rev-list', '--no-walk', ...hashes, '--not', ref],
      { cwd, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout) => resolve(error ? null : new Set(stdout.split(/\r?\n/).filter(Boolean))),
    )
  })

  const [outsideHead, outsideUpstream] = await Promise.all([
    getCommitsOutside('HEAD'),
    getCommitsOutside(upstream),
  ])
  if (!outsideHead || !outsideUpstream) return statuses

  for (const hash of hashes) {
    const inHead = !outsideHead.has(hash)
    const inUpstream = !outsideUpstream.has(hash)
    if (inHead && inUpstream) statuses.set(hash, 'pushed')
    else if (inHead) statuses.set(hash, 'unpushed')
    else if (inUpstream) statuses.set(hash, 'incoming')
  }
  return statuses
}

async function getGitUpstream(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      { cwd, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(error ? null : stdout.trim() || null),
    )
  })
}

/**
 * 获取 git log 列表
 */
export async function getGitLog(count: number = 50, locale: string = 'zh', cwd: string = LDVH_ROOT): Promise<GitLogEntry[]> {
  const upstream = await getGitUpstream(cwd)
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [
        'log',
        `-${count}`,
        ...(upstream ? ['--date-order'] : []),
        '--format=%H%x1f%h%x1f%an%x1f%ai%x1f%B%x1e',
        ...(upstream ? ['HEAD', upstream] : []),
      ],
      { cwd, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new Error(`git log failed: ${error.message}`))
          return
        }

        const blocks = stdout.split('\x1e').map((block) => block.trim()).filter(Boolean)
        const entries: GitLogEntry[] = blocks.map((block) => {
          const [hash, shortHash, author, date, fullMessage = ''] = block.split('\x1f')
          const { subject: message, body } = splitCommitMessage(fullMessage)
          const { category, scope, description, isBreaking } = parseCommitMessage(message)
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
          }
        })

        void getGitPushStatuses(entries.map((entry) => entry.hash), cwd).then((pushStatuses) => {
          resolve(entries.map((entry) => ({
            ...entry,
            pushStatus: pushStatuses.get(entry.hash) || 'unknown',
          })))
        })
      },
    )
  })
}

/**
 * Read a bounded commit slice with changed paths in one Git invocation.
 *
 * The record and message/file separators are control characters emitted by
 * Git's format string.  We only consume paths later by exact equality against
 * current canonical fact paths; arbitrary changed source paths never leave
 * the cognition aggregation.
 */
export async function getGitLogWithFiles(
  since: Date,
  until: Date,
  locale: string = 'zh',
  cwd: string = LDVH_ROOT,
): Promise<GitLogEntryWithFiles[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [
        'log',
        `--since=${since.toISOString()}`,
        `--until=${until.toISOString()}`,
        '--name-only',
        '--format=%x1e%H%x1f%h%x1f%an%x1f%aI%x1f%B%x1d',
      ],
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new Error(`git log with files failed: ${error.message}`))
          return
        }

        const entries = stdout
          .split('\x1e')
          .map((block) => block.trim())
          .filter(Boolean)
          .flatMap((block) => {
            const separator = block.indexOf('\x1d')
            if (separator < 0) return []
            const header = block.slice(0, separator)
            const filesBlock = block.slice(separator + 1)
            const [hash, shortHash, author, date, fullMessage = ''] = header.split('\x1f')
            if (!hash || !shortHash || !date) return []
            const { subject: message, body } = splitCommitMessage(fullMessage)
            const { category, scope, description, isBreaking } = parseCommitMessage(message)
            const files = filesBlock
              .split(/\r?\n/)
              .map((entry) => entry.trim())
              .filter(Boolean)
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
            }]
          })

        void getGitPushStatuses(entries.map((entry) => entry.hash), cwd).then((pushStatuses) => {
          resolve(entries.map((entry) => ({
            ...entry,
            pushStatus: pushStatuses.get(entry.hash) || 'unknown',
          })))
        })
      },
    )
  })
}

/**
 * 获取指定 commit 的解析后 message 信息
 */
export async function getGitCommit(hash: string, locale: string = 'zh', cwd: string = LDVH_ROOT): Promise<GitLogEntry> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['show', '-s', '--format=%H%x1f%h%x1f%an%x1f%ai%x1f%B', hash],
      { cwd, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new Error(`git show commit failed: ${error.message}`))
          return
        }

        const [fullHash, shortHash, author, date, fullMessage = ''] = stdout.trimEnd().split('\x1f')
        const { subject: message, body } = splitCommitMessage(fullMessage)
        const { category, scope, description, isBreaking } = parseCommitMessage(message)
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
        }))
      },
    )
  })
}

/**
 * 获取指定 commit 的 show --stat 输出
 */
export async function getGitShow(hash: string, cwd: string = LDVH_ROOT): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['show', '--stat', hash],
      { cwd, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new Error(`git show failed: ${error.message}`))
          return
        }
        resolve(stdout)
      },
    )
  })
}
