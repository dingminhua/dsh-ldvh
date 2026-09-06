/**
 * crossWorktreeMerger.ts
 *
 * 跨工作区事实对象合并服务。
 * 扫描同一 git 仓库所有 worktree 的事实文件，比对 sha256 内容指纹，
 * 输出合并元数据：mainWorktreeDiffers（主工作区内容不同）、
 * sourceBranch（来源分支）。
 *
 * 以"当前选中的 worktree 为主视角"，自动合并。
 * 主工作区 = git worktree list --porcelain 第一条。
 */

import { execFile } from 'node:child_process'
import {
  listLocalFacts,
  type LocalFactScope,
  type LocalFactItem,
} from './localFactReader.js'
import type { ObjectType } from './facts.js'

/* ------------------------------------------------------------------ */
/*  公开类型                                                           */
/* ------------------------------------------------------------------ */

export type CrossWorktreeMeta = {
  /** 对象不在当前 worktree，来自此分支 */
  sourceBranch?: string
  /** 主工作区与当前 worktree 的内容指纹不同 */
  mainWorktreeDiffers?: boolean
}

export type WorktreeInfo = {
  path: string
  branch: string
  isMain: boolean
}

/* ------------------------------------------------------------------ */
/*  Git 辅助                                                           */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  获取所有 worktree 信息                                              */
/* ------------------------------------------------------------------ */

/**
 * 从主工作区执行 `git worktree list --porcelain`，发现同一 git 仓库
 * 的所有 worktree，并获取每个 worktree 的分支名。
 */
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

/* ------------------------------------------------------------------ */
/*  收集指纹                                                           */
/* ------------------------------------------------------------------ */

/**
 * 遍历所有 worktree，对每个 worktree 调用 listLocalFacts 读取事实对象，
 * 收集对象 ID → 各 worktree 的内容指纹。
 *
 * 返回：
 *   - fingerprints: objectId → { worktreePath → fingerprint | null }
 *   - itemsByWorktree: worktreePath → LocalFactItem[]
 */
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

/* ------------------------------------------------------------------ */
/*  计算合并元数据                                                       */
/* ------------------------------------------------------------------ */

/**
 * 根据指纹信息，计算每个事实对象的跨工作区合并元数据：
 *
 * 1. 对象在当前 worktree 存在：
 *    - 主工作区无此对象 → 无标记
 *    - 主工作区有，指纹相同 → 无标记
 *    - 主工作区有，指纹不同 → mainWorktreeDiffers: true
 *
 * 2. 对象不在当前 worktree，在其他 worktree 存在：
 *    - 标记 sourceBranch 为最先找到的分支名
 */
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
      // 当前 worktree 有此对象
      if (
        mainFingerprint !== null &&
        mainFingerprint !== currentFingerprint
      ) {
        meta.set(objectId, { mainWorktreeDiffers: true })
      }
    } else {
      // 当前 worktree 无此对象，找第一个有的
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