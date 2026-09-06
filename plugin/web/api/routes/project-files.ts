/**
 * Project files API：管辖项目文件浏览、Markdown/文本读取和 Git 工作区 diff。
 * 所有接口均为只读能力，不提供暂存、提交、还原或删除。
 */

import { Router, type Request, type Response } from 'express'
import { lstat, readdir, readFile, stat } from 'fs/promises'
import path from 'path'
import { getGitPushStatuses, normalizeTimestamp, parseCommitMessage, parseCommitSignature, splitCommitMessage } from '../services/git.js'
import { LDVH_WORKSPACE_ROOT } from '../services/pytools.js'
import { readGovernedProjectsSettings } from '../services/governedProjectsSettings.js'
import { ProjectScopeError, requestProject } from '../services/requestScope.js'
import { scanGovernedProjectWorktrees } from '../services/workspaceWorktrees.js'
import {
  EXCLUDED_DIRS,
  MAX_DIRECTORY_ENTRIES,
  MAX_FILE_BYTES,
  TEXT_SAMPLE_BYTES,
  detectKind,
  getProject,
  isHiddenPath,
  loadProjects,
  parseCommitFileLine,
  parseGitStatusLine,
  resolveProjectTarget,
  runCommand,
  toProjectRelative,
} from '../services/projectFiles.js'

const router = Router()

function isValidCommitHash(hash: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(hash)
}

function projectScopeStatus(err: unknown): number {
  if (!(err instanceof ProjectScopeError)) return 500
  return err.message.startsWith('Unknown governed project') ? 404 : 400
}

router.get('/projects', async (_req: Request, res: Response): Promise<void> => {
  try {
    const [projects, settings] = await Promise.all([loadProjects(), readGovernedProjectsSettings()])
    const worktrees = await scanGovernedProjectWorktrees(settings.projects)
    res.json({
      ok: true,
      workspaceRoot: LDVH_WORKSPACE_ROOT,
      defaultProjectId: settings.defaultProjectId,
      projects: projects.map((project) => ({
        ...project,
        docsPath: path.join(project.path, 'docs'),
        ldvhBasePath: path.join(project.path, 'ldvh-base'),
        worktrees: worktrees
          .filter((worktree) => worktree.governedProjectId === project.id)
          .map((worktree) => ({
            path: worktree.path,
            branch: worktree.branch,
            head: worktree.head,
            isMain: worktree.isMain,
            status: worktree.status,
          })),
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load governed projects'
    res.status(500).json({ ok: false, error: message })
  }
})

router.get('/entries', async (req: Request, res: Response): Promise<void> => {
  try {
    const dir = String(req.query.dir || '')
    const showHidden = String(req.query.showHidden || '') === 'true'
    const project = await requestProject(req)

    const target = await resolveProjectTarget(project, dir)
    if (!target) {
      res.status(403).json({ ok: false, error: 'Invalid directory path' })
      return
    }

    const targetStat = await lstat(target)
    if (!targetStat.isDirectory()) {
      res.status(400).json({ ok: false, error: 'Path is not a directory' })
      return
    }

    const rawEntries = await readdir(target, { withFileTypes: true })
    const visibleEntries = rawEntries
      .filter((entry) => !EXCLUDED_DIRS.has(entry.name))
      .filter((entry) => showHidden || !entry.name.startsWith('.'))
    const entries = await Promise.all(
      visibleEntries
        .slice(0, MAX_DIRECTORY_ENTRIES)
        .map(async (entry) => {
          const absolutePath = path.join(target, entry.name)
          const entryStat = await lstat(absolutePath)
          const isDirectory = entry.isDirectory()
          return {
            name: entry.name,
            path: toProjectRelative(project, absolutePath),
            absolutePath,
            type: isDirectory ? 'directory' : 'file',
            kind: detectKind(entry.name, isDirectory),
            size: entryStat.size,
            updated: entryStat.mtime.toISOString(),
          }
        }),
    )

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    res.json({
      ok: true,
      project,
      dir: toProjectRelative(project, target),
      parent: toProjectRelative(project, target) ? toProjectRelative(project, path.dirname(target)) : '',
      showHidden,
      truncated: visibleEntries.length > MAX_DIRECTORY_ENTRIES,
      entries,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list directory'
    res.status(projectScopeStatus(err)).json({ ok: false, error: message })
  }
})

router.get('/content', async (req: Request, res: Response): Promise<void> => {
  try {
    const filePath = String(req.query.path || '')
    const showHidden = String(req.query.showHidden || '') === 'true'
    const project = await requestProject(req)

    const target = await resolveProjectTarget(project, filePath)
    if (!target) {
      res.status(403).json({ ok: false, error: 'Invalid file path' })
      return
    }

    const relativePath = toProjectRelative(project, target)
    if (!showHidden && isHiddenPath(relativePath)) {
      res.status(403).json({ ok: false, error: 'Hidden file is not visible' })
      return
    }

    const fileStat = await stat(target)
    if (!fileStat.isFile()) {
      res.status(400).json({ ok: false, error: 'Path is not a file' })
      return
    }

    const sample = await readFile(target, { flag: 'r' }).then((buffer) => buffer.subarray(0, TEXT_SAMPLE_BYTES))
    const kind = detectKind(path.basename(target), false, sample)
    if (kind === 'binary') {
      res.json({
        ok: true,
        project,
        path: relativePath,
        absolutePath: target,
        kind,
        size: fileStat.size,
        content: '',
        truncated: false,
      })
      return
    }

    const buffer = await readFile(target)
    const truncated = buffer.length > MAX_FILE_BYTES
    res.json({
      ok: true,
      project,
      path: relativePath,
      absolutePath: target,
      kind,
      size: fileStat.size,
      content: buffer.subarray(0, MAX_FILE_BYTES).toString('utf-8'),
      truncated,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read file'
    res.status(projectScopeStatus(err)).json({ ok: false, error: message })
  }
})

router.get('/git/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const projectId = String(req.query.projectId || '')
    const projects = projectId ? [await requestProject(req)] : await loadProjects()
    const entries = []

    for (const project of projects) {
      await runCommand('git', ['rev-parse', '--is-inside-work-tree'], project.path)
      const stdout = await runCommand('git', ['status', '--short', '--untracked-files=all'], project.path)
      for (const line of stdout.split('\n').filter(Boolean)) {
        entries.push(parseGitStatusLine(project, line))
      }
    }

    res.json({ ok: true, entries })
  } catch (err) {
    const message = err instanceof ProjectScopeError && err.message.startsWith('Unknown governed project')
      ? 'Project not found'
      : (err instanceof Error ? err.message : 'Failed to read git status')
    res.status(projectScopeStatus(err)).json({ ok: false, error: message })
  }
})

router.get('/git/diff', async (req: Request, res: Response): Promise<void> => {
  try {
    const filePath = String(req.query.path || '')
    const statusCode = String(req.query.status || '')
    const project = await requestProject(req)

    const target = await resolveProjectTarget(project, filePath)
    if (!target) {
      res.status(403).json({ ok: false, error: 'Invalid file path' })
      return
    }

    const relativePath = toProjectRelative(project, target)
    let diff = ''

    if (statusCode === '??') {
      const fileStat = await stat(target)
      if (!fileStat.isFile()) {
        res.status(400).json({ ok: false, error: 'Path is not a file' })
        return
      }
      const buffer = await readFile(target)
      if (buffer.subarray(0, TEXT_SAMPLE_BYTES).includes(0)) {
        diff = `Untracked binary file: ${relativePath}`
      } else {
        const truncated = buffer.length > MAX_FILE_BYTES
        const content = buffer.subarray(0, MAX_FILE_BYTES).toString('utf-8')
        diff = [
          `Untracked file: ${relativePath}`,
          truncated ? `Content truncated at ${MAX_FILE_BYTES} bytes.` : '',
          '',
          ...content.split('\n').map((line) => `+${line}`),
        ].filter((line, index) => line || index !== 1).join('\n')
      }
    } else {
      const unstaged = await runCommand('git', ['diff', '--', relativePath], project.path)
      const staged = await runCommand('git', ['diff', '--cached', '--', relativePath], project.path)
      diff = [staged && '## Staged changes', staged, unstaged && '## Unstaged changes', unstaged]
        .filter(Boolean)
        .join('\n\n')
    }

    res.json({
      ok: true,
      project,
      path: relativePath,
      absolutePath: target,
      status: statusCode,
      diff: diff || `No diff available for ${relativePath}`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read git diff'
    res.status(projectScopeStatus(err)).json({ ok: false, error: message })
  }
})

router.get('/git/commits', async (req: Request, res: Response): Promise<void> => {
  try {
    const count = Math.min(Math.max(parseInt(String(req.query.count || '50'), 10) || 50, 1), 200)
    const project = await requestProject(req)

    await runCommand('git', ['rev-parse', '--is-inside-work-tree'], project.path)
    const stdout = await runCommand(
      'git',
      ['log', `-${count}`, '--date=iso-strict', '--format=%H%x1f%h%x1f%P%x1f%an%x1f%ai%x1f%B%x1e'],
      project.path,
    )
    const entries = stdout
      .trim()
      .split('\x1e')
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => {
        const [hash, shortHash, parentsRaw, author, date, fullMessage = ''] = block.split('\x1f')
        const parents = parentsRaw ? parentsRaw.split(' ').filter(Boolean) : []
        const { subject: message, body } = splitCommitMessage(fullMessage)
        const { category, scope, description, isBreaking } = parseCommitMessage(message)
        return {
          hash,
          shortHash,
          parents,
          author,
          date: normalizeTimestamp(date),
          message,
          body,
          category,
          scope,
          description,
          isBreaking,
          signature: parseCommitSignature(body),
          isMerge: parents.length > 1,
        }
      })

    const pushStatuses = await getGitPushStatuses(entries.map((entry) => entry.hash), project.path)
    res.json({
      ok: true,
      project,
      entries: entries.map((entry) => ({
        ...entry,
        pushStatus: pushStatuses.get(entry.hash) || 'unknown',
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read git commits'
    res.status(projectScopeStatus(err)).json({ ok: false, error: message })
  }
})

router.get('/git/commit/:hash', async (req: Request, res: Response): Promise<void> => {
  try {
    const { hash } = req.params
    const project = await requestProject(req)
    if (!isValidCommitHash(hash)) {
      res.status(400).json({ ok: false, error: 'Invalid hash format' })
      return
    }

    await runCommand('git', ['rev-parse', '--is-inside-work-tree'], project.path)
    const meta = await runCommand('git', ['show', '-s', '--date=iso-strict', '--format=%H%n%h%n%P%n%an%n%ai%n%B', hash], project.path)
    const [fullHash = hash, shortHash = hash.slice(0, 7), parentsRaw = '', author = '', date = '', ...messageLines] = meta.split('\n')
    const fullMessage = messageLines.join('\n').trim()
    const { subject: message, body } = splitCommitMessage(fullMessage)
    const { category, scope, description, isBreaking } = parseCommitMessage(message)
    const [filesStdout, pushStatuses] = await Promise.all([
      runCommand('git', ['show', '--name-status', '--format=', '--find-renames', '--root', hash], project.path),
      getGitPushStatuses([fullHash], project.path),
    ])
    const files = filesStdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parseCommitFileLine(project, line))
      .filter((file) => Boolean(file.path))

    const parents = parentsRaw ? parentsRaw.split(' ').filter(Boolean) : []
    res.json({
      ok: true,
      project,
      commit: {
        hash: fullHash,
        shortHash,
        parents,
        author,
        date: normalizeTimestamp(date),
        message,
        body,
        category,
        scope,
        description,
        isBreaking,
        signature: parseCommitSignature(body),
        pushStatus: pushStatuses.get(fullHash) || 'unknown',
        isMerge: parents.length > 1,
        files,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read git commit'
    res.status(projectScopeStatus(err)).json({ ok: false, error: message })
  }
})

router.get('/git/commit/:hash/diff', async (req: Request, res: Response): Promise<void> => {
  try {
    const filePath = String(req.query.path || '')
    const { hash } = req.params
    const project = await requestProject(req)
    if (!isValidCommitHash(hash)) {
      res.status(400).json({ ok: false, error: 'Invalid hash format' })
      return
    }

    const target = await resolveProjectTarget(project, filePath)
    if (!target) {
      res.status(403).json({ ok: false, error: 'Invalid file path' })
      return
    }

    const relativePath = toProjectRelative(project, target)
    const diff = await runCommand('git', ['show', '--format=', '--find-renames', hash, '--', relativePath], project.path)

    res.json({
      ok: true,
      project,
      hash,
      path: relativePath,
      absolutePath: target,
      status: 'commit',
      diff: diff || `No diff available for ${relativePath} in ${hash}`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read commit file diff'
    res.status(projectScopeStatus(err)).json({ ok: false, error: message })
  }
})

export default router
