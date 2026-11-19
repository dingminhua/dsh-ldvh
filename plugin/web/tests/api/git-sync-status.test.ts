import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { getGitLog } from '../../api/services/git.ts'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function configureIdentity(cwd: string): void {
  git(cwd, ['config', 'user.email', 'tester@example.com'])
  git(cwd, ['config', 'user.name', 'Tester'])
}

function commitFile(cwd: string, file: string, content: string, message: string): void {
  fs.writeFileSync(path.join(cwd, file), content)
  git(cwd, ['add', file])
  git(cwd, ['commit', '--quiet', '-m', message])
}

test('changelog includes and classifies local-only and upstream-only commits', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ldvh-git-sync-status-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const local = path.join(root, 'local')
  const other = path.join(root, 'other')
  const remote = path.join(root, 'remote.git')
  fs.mkdirSync(local)
  git(local, ['init', '--quiet', '--initial-branch=main'])
  configureIdentity(local)
  commitFile(local, 'base.txt', 'base\n', 'chore: shared base')
  git(local, ['branch', '-M', 'main'])
  execFileSync('git', ['init', '--bare', '--quiet', '--initial-branch=main', remote])
  git(local, ['remote', 'add', 'origin', remote])
  git(local, ['push', '--quiet', '--set-upstream', 'origin', 'main'])

  execFileSync('git', ['clone', '--quiet', remote, other])
  configureIdentity(other)
  commitFile(other, 'incoming.txt', 'incoming\n', 'feat(web): upstream only')
  git(other, ['push', '--quiet'])

  commitFile(local, 'local.txt', 'local\n', 'fix(web): local only')
  git(local, ['fetch', '--quiet', 'origin'])

  const entries = await getGitLog(20, 'zh', local)
  const byDescription = new Map(entries.map((entry) => [entry.description, entry]))

  assert.equal(byDescription.get('shared base')?.pushStatus, 'pushed')
  assert.equal(byDescription.get('local only')?.pushStatus, 'unpushed')
  assert.equal(byDescription.get('upstream only')?.pushStatus, 'incoming')
  assert.equal(entries.filter((entry) => entry.description === 'upstream only').length, 1)
})
