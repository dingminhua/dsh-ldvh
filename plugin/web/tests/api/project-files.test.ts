import assert from 'node:assert/strict'
import fs from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { after, before, test } from 'node:test'

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ldvh-project-files-workspace-'))
const projectRoot = path.join(workspaceRoot, 'demo')
const alternateWorktreeRoot = path.join(workspaceRoot, 'demo-alternate')
const secondaryProjectRoot = path.join(workspaceRoot, 'secondary')
fs.mkdirSync(path.join(projectRoot, 'assets'), { recursive: true })
fs.mkdirSync(path.join(projectRoot, '.private'), { recursive: true })
fs.mkdirSync(path.join(projectRoot, 'specs'), { recursive: true })
fs.mkdirSync(secondaryProjectRoot, { recursive: true })
execFileSync('git', ['init', '-q', projectRoot])
execFileSync('git', ['init', '-q', secondaryProjectRoot])
fs.writeFileSync(
  path.join(workspaceRoot, 'LDVH-GOVERNED-PROJECTS.yaml'),
  [
    'governance_instance_name: Project files test',
    'product_description: Code-controlled governance resolution fixture.',
    'projects:',
    '  - id: demo',
    `    path: ${projectRoot}`,
    '    name: Demo',
    '    description: Test project.',
    '  - id: secondary',
    `    path: ${secondaryProjectRoot}`,
    '    name: Secondary',
    '    description: Second governed project.',
    '',
  ].join('\n'),
)

process.env.LDVH_ROOT = projectRoot
process.env.LDVH_WORKSPACE_ROOT = workspaceRoot
// v5 现状：治理范围经 Node git 解析，不依赖 v4 Python Helper。登记载体指向本测试
// 自建的工作区治理 YAML，触发 governanceScope 的 Node git 分支。CI 可用覆盖。
process.env.LDVH_GOVERNED_PROJECTS_CONFIG = path.resolve(workspaceRoot, 'LDVH-GOVERNED-PROJECTS.yaml')
process.env.LDVH_WEB_WORKTREE_LOCATOR = projectRoot

const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5"/></svg>\n'
fs.writeFileSync(path.join(projectRoot, 'assets', 'mark.svg'), svgContent)
fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Demo\n')
fs.writeFileSync(path.join(projectRoot, '.private', 'secret.md'), 'hidden\n')
fs.writeFileSync(path.join(projectRoot, 'large.txt'), `${'a'.repeat(310 * 1024)}tail`)
fs.writeFileSync(path.join(projectRoot, 'binary.bin'), Buffer.from([0x41, 0x00, 0x42]))
fs.writeFileSync(path.join(projectRoot, 'specs', 'scope.md'), 'main baseline\n')
execFileSync('git', ['-C', projectRoot, 'config', 'user.email', 'tests@example.com'])
execFileSync('git', ['-C', projectRoot, 'config', 'user.name', 'LDVH Tests'])
execFileSync('git', ['-C', projectRoot, 'add', '.'])
execFileSync('git', ['-C', projectRoot, 'commit', '-qm', 'fixture'])
execFileSync('git', ['-C', projectRoot, 'worktree', 'add', '-q', '-b', 'alternate', alternateWorktreeRoot])
fs.writeFileSync(path.join(projectRoot, 'branch-scope.txt'), 'main worktree\n')
fs.writeFileSync(path.join(projectRoot, 'specs', 'scope.md'), 'main worktree docs\n')
fs.writeFileSync(path.join(alternateWorktreeRoot, 'branch-scope.txt'), 'alternate worktree\n')
fs.writeFileSync(path.join(alternateWorktreeRoot, 'specs', 'scope.md'), 'alternate worktree docs\n')

let server: Server
let baseUrl = ''

before(async () => {
  const { appReady, default: app } = await import('../../api/app.ts')
  await appReady
  server = app.listen(0)
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  // 先强制断开 keep-alive 连接，避免 close 回调等待空闲连接自然超时，
  // 再关闭 server 停止接受新连接。
  server.closeAllConnections?.()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
  fs.rmSync(workspaceRoot, { recursive: true, force: true })
})

async function get(pathname: string) {
  const response = await fetch(`${baseUrl}${pathname}`)
  const body = await response.json() as Record<string, unknown>
  return { response, body }
}

test('lists and reads the current supported file kinds', async () => {
  const projects = await get('/api/project-files/projects')
  assert.equal(projects.response.status, 200)
  const governed = projects.body.projects as Array<Record<string, unknown>>
  assert.equal(governed.length, 2)
  assert.equal(projects.body.defaultProjectId, 'demo')
  const demo = governed.find((project) => project.id === 'demo')
  const secondary = governed.find((project) => project.id === 'secondary')
  assert.ok(demo)
  assert.ok(secondary)
  assert.equal(demo.name, 'Demo')
  assert.equal(secondary.name, 'Secondary')
  assert.equal(demo.path, fs.realpathSync(projectRoot))
  assert.equal(secondary.path, fs.realpathSync(secondaryProjectRoot))

  const entries = await get('/api/project-files/entries?projectId=demo&dir=assets')
  assert.equal(entries.response.status, 200)
  const listed = entries.body.entries as Array<Record<string, unknown>>
  assert.equal(listed.length, 1)
  assert.equal(listed[0].name, 'mark.svg')
  assert.equal(listed[0].kind, 'svg')

  const file = await get('/api/project-files/content?projectId=demo&path=assets%2Fmark.svg')
  assert.equal(file.response.status, 200)
  assert.equal(file.body.kind, 'svg')
  assert.equal(file.body.content, svgContent)
  assert.equal(file.body.truncated, false)
})

test('preserves hidden-file and lexical traversal responses', async () => {
  const hidden = await get('/api/project-files/content?projectId=demo&path=.private%2Fsecret.md')
  assert.equal(hidden.response.status, 403)
  assert.equal(hidden.body.error, 'Hidden file is not visible')

  const visible = await get('/api/project-files/content?projectId=demo&path=.private%2Fsecret.md&showHidden=true')
  assert.equal(visible.response.status, 200)
  assert.equal(visible.body.content, 'hidden\n')

  const traversal = await get('/api/project-files/content?projectId=demo&path=..%2FLDVH-GOVERNED-PROJECTS.yaml')
  assert.equal(traversal.response.status, 403)
  assert.equal(traversal.body.error, 'Invalid file path')
})

test('preserves truncation and binary responses', async () => {
  const large = await get('/api/project-files/content?projectId=demo&path=large.txt')
  assert.equal(large.response.status, 200)
  assert.equal(large.body.kind, 'text')
  assert.equal(large.body.truncated, true)
  assert.equal(String(large.body.content).length, 300 * 1024)

  const binary = await get('/api/project-files/content?projectId=demo&path=binary.bin')
  assert.equal(binary.response.status, 200)
  assert.equal(binary.body.kind, 'binary')
  assert.equal(binary.body.content, '')
  assert.equal(binary.body.truncated, false)
})

test('does not represent an unknown project Git status as an empty success result', async () => {
  const status = await get('/api/project-files/git/status?projectId=missing')
  assert.equal(status.response.status, 404)
  assert.equal(status.body.ok, false)
  assert.equal(status.body.error, 'Project not found')
})

test('reads files, Git status, and documents from the selected linked worktree', async () => {
  const worktreePath = encodeURIComponent(alternateWorktreeRoot)
  const canonicalWorktreeRoot = fs.realpathSync(alternateWorktreeRoot)
  const entries = await get(`/api/project-files/entries?projectId=demo&worktreePath=${worktreePath}`)
  assert.equal(entries.response.status, 200, JSON.stringify(entries.body))
  const listed = entries.body.entries as Array<Record<string, unknown>>
  assert.ok(listed.some((entry) => entry.name === 'branch-scope.txt'))

  const file = await get(`/api/project-files/content?projectId=demo&worktreePath=${worktreePath}&path=branch-scope.txt`)
  assert.equal(file.response.status, 200, JSON.stringify(file.body))
  assert.equal(file.body.content, 'alternate worktree\n')
  assert.equal(file.body.absolutePath, path.join(canonicalWorktreeRoot, 'branch-scope.txt'))

  const status = await get(`/api/project-files/git/status?projectId=demo&worktreePath=${worktreePath}`)
  assert.equal(status.response.status, 200, JSON.stringify(status.body))
  const changes = status.body.entries as Array<Record<string, unknown>>
  assert.ok(changes.some((entry) => entry.path === 'branch-scope.txt' && entry.absolutePath === path.join(canonicalWorktreeRoot, 'branch-scope.txt')))

  const doc = await get(`/api/docs?projectId=demo&worktreePath=${worktreePath}&path=specs%2Fscope.md`)
  assert.equal(doc.response.status, 200, JSON.stringify(doc.body))
  assert.equal(doc.body.content, 'alternate worktree docs\n')
})

test('rejects Project Files when Code governance cannot verify the workspace', async () => {
  const configPath = path.join(workspaceRoot, 'LDVH-GOVERNED-PROJECTS.yaml')
  const parkedPath = path.join(workspaceRoot, 'LDVH-GOVERNED-PROJECTS.parked')
  fs.renameSync(configPath, parkedPath)
  try {
    const response = await fetch(`${baseUrl}/api/project-files/projects`)
    const body = await response.json() as Record<string, unknown>
    assert.equal(response.status, 500)
    assert.equal(body.ok, false)
    assert.match(String(body.error), /(不可读取|unavailable|not verified)/)
  } finally {
    fs.renameSync(parkedPath, configPath)
  }
})

test('recovers a restored governance carrier without a restart', async () => {
  // v5 现状等价语义：登记载体（LDVH_GOVERNED_PROJECTS_CONFIG）临时不可读时，
  // 治理范围解析失败并如实返回；载体恢复后，同一进程的下一次请求无需重启即再次可用
  // （governanceScope.currentVerifiedScope 对失败解析不缓存，交由后续请求重试）。
  const configPath = process.env.LDVH_GOVERNED_PROJECTS_CONFIG!
  const parkedPath = path.join(workspaceRoot, 'LDVH-GOVERNED-PROJECTS.parked')
  fs.renameSync(configPath, parkedPath)
  try {
    const failed = await get('/api/project-files/projects')
    assert.equal(failed.response.status, 500)
    // 错误文案经 i18n 本地化（governedProjectsSettings 抛中文、governanceScope 抛英文），
    // 断言只锚定错误结构存在，避免绑定具体语言。
    assert.ok(String(failed.body.error).length > 0, 'governance error message must not be empty')
  } finally {
    fs.renameSync(parkedPath, configPath)
  }

  const recovered = await get('/api/project-files/projects')
  assert.equal(recovered.response.status, 200, JSON.stringify(recovered.body))
})
