
import { execFile } from 'node:child_process'
import {
  listLocalFacts,
  type LocalFactScope,
  type LocalFactItem,
} from './localFactReader.js'
import type { ObjectType } from './facts.js'


export type CrossWorktreeMeta = {
  sourceBranch?: string
  mainWorktreeDiffers?: boolean
}

export type WorktreeInfo = {
  path: string
  branch: string
  isMain: boolean
}


function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      { maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || error.message))
        else resolve(stdout)
      },
    )
  })
}

function parseWorktreePaths(output: string): string[] {
  return output
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter(Boolean)
}


export async function getWorktreeInfos(
  mainWorktreePath: string,
): Promise<WorktreeInfo[]> {
  const output = await runGit(mainWorktreePath, [
    'worktree',
    'list',
    '--porcelain',
  ])
  const paths = parseWorktreePaths(output)

  const infos = await Promise.all(
    paths.map(async (wpath, index) => {
      const branch = await runGit(wpath, ['branch', '--show-current']).catch(
        () => '',
      )
      return { path: wpath, branch: branch.trim(), isMain: index === 0 }
    }),
  )
  return infos
}


export async function collectFingerprints(
  worktreeInfos: WorktreeInfo[],
  governedProjectId: string,
  type: ObjectType,
): Promise<{
  fingerprints: Map<string, Map<string, string | null>>
  itemsByWorktree: Map<string, LocalFactItem[]>
}> {
  const fingerprints = new Map<string, Map<string, string | null>>()
  const itemsByWorktree = new Map<string, LocalFactItem[]>()

  for (const info of worktreeInfos) {
    const scope: LocalFactScope = {
      worktreeLocator: info.path,
      governedProjectId,
    }
    const listed = await listLocalFacts(type, scope)
    if (listed.status !== 'complete') continue

    itemsByWorktree.set(info.path, listed.items)

    for (const item of listed.items) {
      const objectId = item.object_ref.object_id
      if (!fingerprints.has(objectId)) {
        fingerprints.set(objectId, new Map())
      }
      fingerprints.get(objectId)!.set(info.path, item.source_content_fingerprint)
    }
  }

  return { fingerprints, itemsByWorktree }
}


export function calculateMergeMeta(
  fingerprints: Map<string, Map<string, string | null>>,
  worktreeInfos: WorktreeInfo[],
  currentWorktreePath: string,
  mainWorktreePath: string,
): Map<string, CrossWorktreeMeta> {
  const meta = new Map<string, CrossWorktreeMeta>()

  for (const [objectId, pathFingerprints] of fingerprints) {
    const currentFingerprint = pathFingerprints.get(currentWorktreePath) ?? null
    const mainFingerprint = pathFingerprints.get(mainWorktreePath) ?? null

    if (currentFingerprint !== null) {
      if (
        mainFingerprint !== null &&
        mainFingerprint !== currentFingerprint
      ) {
        meta.set(objectId, { mainWorktreeDiffers: true })
      }
    } else {
      for (const info of worktreeInfos) {
        if (info.path === currentWorktreePath) continue
        if (pathFingerprints.has(info.path)) {
          meta.set(objectId, {
            sourceBranch: info.branch || info.path,
          })
          break
        }
      }
    }
  }

  return meta
}