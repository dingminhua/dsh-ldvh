/**
 * v5 登记模式契约测试（LDVH_GOVERNED_PROJECTS_CONFIG 指向 v5 登记载体）。
 *
 * 覆盖：schema_version 根字段容忍、配置从 v5 载器（而非 v4 工作区布局）读取、
 * 治理验证走 Node git 解析（全程不设 LDVH_HELPER_EXECUTABLE——零 Python Helper
 * 依赖的证明）、非 Git 项目降级剔除、载器变更后指纹失效重验。
 * 夹具参照 settings.test.ts（真实 git 项目）。
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { before, after } from 'node:test';
import type { Server } from 'node:http';

const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'ldvh-v5-registration-'));
const soloProject = path.join(workspaceRoot, 'solo');
fs.mkdirSync(soloProject, { recursive: true });
execFileSync('git', ['init', '-q', soloProject]);
fs.writeFileSync(path.join(soloProject, 'README.md'), 'v5 registration fixture\n');
execFileSync('git', ['-C', soloProject, '-c', 'user.name=v5 test', '-c', 'user.email=v5@example.test', 'add', 'README.md']);
execFileSync('git', ['-C', soloProject, '-c', 'user.name=v5 test', '-c', 'user.email=v5@example.test', 'commit', '-qm', 'fixture']);

// v5 载器：文件名与根字段都与 v4 布局不同（schema_version）
const carrierPath = path.join(workspaceRoot, 'governed-projects.yaml');
function writeCarrier(projects: Array<{ id: string; path: string; name?: string }>, defaultProjectId: string) {
  const lines = [
    'schema_version: 1',
    'governance_instance_name: v5 test',
    'product_description: v5 registration carrier fixture.',
    'projects:',
  ];
  for (const project of projects) {
    lines.push(`  - id: ${project.id}`, `    path: ${project.path}`);
    if (project.name) lines.push(`    name: ${project.name}`);
  }
  lines.push(`default_project_id: ${defaultProjectId}`, '');
  fs.writeFileSync(carrierPath, lines.join('\n'));
}
writeCarrier([{ id: 'solo', path: soloProject, name: 'Solo project' }], 'solo');

process.env.LDVH_WORKSPACE_ROOT = workspaceRoot
process.env.LDVH_GOVERNED_PROJECTS_CONFIG = carrierPath
process.env.LDVH_WEB_WORKTREE_LOCATOR = soloProject
// 刻意不设置 LDVH_HELPER_EXECUTABLE / LDVH_ROOT：v5 模式必须零 Helper 依赖。

let server: Server
let baseUrl = ''

before(async () => {
  const { default: app } = await import('../../api/app.ts')
  server = app.listen(0)
  const address = server.address() as { port: number }
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  server.closeAllConnections?.()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
  fs.rmSync(workspaceRoot, { recursive: true, force: true })
})

test('settings reads the v5 carrier with schema_version tolerated', async () => {
  const response = await fetch(`${baseUrl}/api/settings/governed-projects`)
  const body = await response.json() as Record<string, unknown>
  assert.equal(response.status, 200)
  assert.equal(body.defaultProjectId, 'solo')
  const projects = body.projects as Array<Record<string, unknown>>
  assert.equal(projects.length, 1)
  assert.equal(projects[0].id, 'solo')
  assert.equal(projects[0].name, 'Solo project')
})

test('project listing verifies the v5 carrier through Node git resolution (no helper)', async () => {
  const response = await fetch(`${baseUrl}/api/project-files/projects`)
  const body = await response.json() as Record<string, unknown>
  assert.equal(response.status, 200, JSON.stringify(body))
  assert.equal(body.defaultProjectId, 'solo')
  const projects = body.projects as Array<Record<string, unknown>>
  assert.equal(projects.length, 1)
  assert.equal(projects[0].id, 'solo')
  assert.ok(Array.isArray(projects[0].worktrees))
})

test('federation overview aggregates the v5-registered project', async () => {
  const response = await fetch(`${baseUrl}/api/federation/overview`)
  const body = await response.json() as Record<string, unknown>
  assert.equal(response.status, 200)
  const cards = body.projects as Array<Record<string, unknown>>
  assert.equal(cards.length, 1)
  assert.equal(cards[0].id, 'solo')
})

test('a non-git project in the carrier degrades out of the verified listing', async () => {
  // 载器加一个非 Git 项目：设置页如实列出（原始视图），项目列表降级剔除。
  writeCarrier([
    { id: 'solo', path: soloProject, name: 'Solo project' },
    { id: 'not-a-repo', path: path.join(workspaceRoot, 'missing-directory') },
  ], 'solo')
  const settingsResponse = await fetch(`${baseUrl}/api/settings/governed-projects`)
  const settings = await settingsResponse.json() as Record<string, unknown>
  assert.equal((settings.projects as unknown[]).length, 2, 'settings lists the raw carrier view')

  const filesResponse = await fetch(`${baseUrl}/api/project-files/projects`)
  const files = await filesResponse.json() as Record<string, unknown>
  assert.equal(filesResponse.status, 200)
  const verified = files.projects as Array<Record<string, unknown>>
  assert.equal(verified.length, 1, 'unverifiable project degrades out of the verified listing')
  assert.equal(verified[0].id, 'solo')
})

test('all non-git projects fail verification with an honest error', async () => {
  writeCarrier([{ id: 'not-a-repo', path: path.join(workspaceRoot, 'still-missing') }], 'not-a-repo')
  const response = await fetch(`${baseUrl}/api/project-files/projects`)
  assert.equal(response.status, 500)
  const body = await response.json() as Record<string, unknown>
  assert.match(String(body.error), /no registered project has a verifiable Git worktree|Governance/)
})
