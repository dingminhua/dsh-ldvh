import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ldvh-settings-workspace-'))
const firstProject = path.join(workspaceRoot, 'first')
const secondProject = path.join(workspaceRoot, 'second')
const firstLinkedWorktree = path.join(workspaceRoot, 'first-linked')
const configPath = path.join(workspaceRoot, 'LDVH-GOVERNED-PROJECTS.yaml')
// v4 迁移适配：仓库根可用 LDVH_SPEC_ROOT 覆盖（夹具自身会覆写 LDVH_ROOT 指向临时项目，故用独立变量）。
const repositoryRoot = process.env.LDVH_SPEC_ROOT || path.resolve(import.meta.dirname, '../../..')

fs.mkdirSync(firstProject, { recursive: true })
fs.mkdirSync(secondProject, { recursive: true })
execFileSync('git', ['init', '-q', firstProject])
execFileSync('git', ['init', '-q', secondProject])
fs.writeFileSync(path.join(firstProject, 'README.md'), 'Settings worktree fixture\n')
execFileSync('git', ['-C', firstProject, '-c', 'user.name=Settings test', '-c', 'user.email=settings@example.test', 'add', 'README.md'])
execFileSync('git', ['-C', firstProject, '-c', 'user.name=Settings test', '-c', 'user.email=settings@example.test', 'commit', '-qm', 'fixture'])
execFileSync('git', ['-C', firstProject, 'worktree', 'add', '-q', '-b', 'linked-settings-fixture', firstLinkedWorktree])
fs.writeFileSync(configPath, [
  '# Settings test configuration.',
  'governance_instance_name: Settings test',
  'product_description: A governed-project configuration fixture.',
  'projects:',
  '  - id: first',
  `    path: ${firstProject}`,
  '    name: First project',
  '    description: This description must survive a name edit.',
  '',
].join('\n'))

process.env.LDVH_ROOT = firstProject
process.env.LDVH_WORKSPACE_ROOT = workspaceRoot
process.env.LDVH_HELPER_EXECUTABLE = path.join(repositoryRoot, 'ldvh')
process.env.LDVH_WEB_WORKTREE_LOCATOR = firstProject

let server: Server
let baseUrl = ''

before(async () => {
  const { default: app } = await import('../../api/app.ts')
  server = app.listen(0)
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  fs.rmSync(workspaceRoot, { recursive: true, force: true })
})

async function request(pathname: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${pathname}`, init)
  return { response, body: await response.json() as Record<string, unknown> }
}

test('reads the editable project projection without changing the configuration', async () => {
  const { response, body } = await request('/api/settings/governed-projects')
  assert.equal(response.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.configPath, configPath)
  assert.equal(body.defaultProjectId, 'first')
  assert.equal(body.hasExplicitDefault, false)
  assert.deepEqual(body.projects, [{ id: 'first', path: firstProject, name: 'First project' }])
  assert.match(fs.readFileSync(configPath, 'utf8'), /description: This description must survive/)
})

test('rejects legacy, mixed and unknown configuration root fields', async () => {
  const valid = fs.readFileSync(configPath, 'utf8')
  const invalidConfigurations = [
    valid.replace('governance_instance_name:', 'product_name:'),
    valid.replace('governance_instance_name: Settings test', 'governance_instance_name: Settings test\nproduct_name: Legacy settings test'),
    `${valid}unknown_root: true\n`,
  ]
  try {
    for (const content of invalidConfigurations) {
      fs.writeFileSync(configPath, content)
      const { response, body } = await request('/api/settings/governed-projects')
      assert.notEqual(response.status, 200)
      assert.equal(body.ok, false)
    }
  } finally {
    fs.writeFileSync(configPath, valid)
  }
})

test('explicit verification endpoint reports read-only relocation', async () => {
  const verify = await request('/api/settings/governed-projects/verify', { method: 'POST' })
  assert.equal(verify.response.status, 501)
  assert.match(String(verify.body.error), /插件设置卡|settings card/)
})

test('discovers current workspace Git worktrees with read-only status and registration context', async () => {
  const { response, body } = await request('/api/settings/workspace-worktrees')
  assert.equal(response.status, 200, JSON.stringify(body))
  assert.equal(body.workspaceRoot, workspaceRoot)
  const items = body.items as Array<Record<string, unknown>>
  const first = items.find((item) => item.path === fs.realpathSync(firstProject))
  const second = items.find((item) => item.path === fs.realpathSync(secondProject))
  const linked = items.find((item) => item.path === fs.realpathSync(firstLinkedWorktree))
  assert.ok(first)
  assert.ok(second)
  assert.ok(linked)
  assert.equal(first.registeredProjectId, 'first')
  assert.equal(first.governedProjectId, 'first')
  assert.equal(second.registeredProjectId, undefined)
  assert.equal(second.governedProjectId, undefined)
  assert.equal(linked.isMain, false)
  assert.equal(linked.branch, 'linked-settings-fixture')
  assert.equal(linked.registeredProjectId, undefined)
  assert.equal(linked.governedProjectId, 'first')
  assert.deepEqual(first.status, { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 })
})

test('governed-projects write endpoints are read-only (501) — registration writes belong to the DSH plugin settings card', async () => {
  const update = await request('/api/settings/governed-projects', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedFingerprint: 'any', projects: [{ id: 'first', path: firstProject }] }),
  })
  assert.equal(update.response.status, 501)
  assert.match(String(update.body.error), /只读|插件设置卡/)

  const verify = await request('/api/settings/governed-projects/verify', { method: 'POST' })
  assert.equal(verify.response.status, 501)

  // 配置未被触碰
  const current = await request('/api/settings/governed-projects')
  assert.equal(current.response.status, 200)
})

test('project color endpoint sets, clears and rejects invalid palette keys', async () => {
  const colored = await request('/api/settings/governed-projects/color', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'first', color: 'emerald' }),
  })
  assert.equal(colored.response.status, 200, JSON.stringify(colored.body))
  const coloredProjects = colored.body.projects as Array<{ id: string; color?: string }>
  assert.equal(coloredProjects.find((item) => item.id === 'first')?.color, 'emerald')

  const cleared = await request('/api/settings/governed-projects/color', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'first', color: null }),
  })
  assert.equal(cleared.response.status, 200)
  const clearedProjects = cleared.body.projects as Array<{ id: string; color?: string }>
  assert.equal(clearedProjects.find((item) => item.id === 'first')?.color, undefined)

  const invalid = await request('/api/settings/governed-projects/color', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'first', color: 'hot-pink' }),
  })
  assert.equal(invalid.response.status, 422)

  const unknown = await request('/api/settings/governed-projects/color', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: 'missing-project', color: 'rose' }),
  })
  assert.equal(unknown.response.status, 404)
})


