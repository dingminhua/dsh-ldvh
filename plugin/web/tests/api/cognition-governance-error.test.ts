import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

let server: Server
let baseUrl = ''

before(async () => {
  const { default: app } = await import('../../api/app.ts')
  server = app.listen(0)
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
})

test('无管辖项目时 cognition 透出可判定错误，不吞成泛化 500', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ldvh-cog-gov-'))
  const configPath = path.join(home, 'governed-projects.yaml')
  await writeFile(configPath, 'projects: []\ndefault_project_id: ""\n', 'utf8')

  const previous = process.env.LDVH_GOVERNED_PROJECTS_CONFIG
  process.env.LDVH_GOVERNED_PROJECTS_CONFIG = configPath
  try {
    const response = await fetch(`${baseUrl}/api/cognition`)
    const body = (await response.json()) as Record<string, unknown>

    assert.equal(response.status, 503, `无管辖项目须是 503 而非 500，实际=${response.status} body=${JSON.stringify(body)}`)
    assert.equal(body.ok, false)
    assert.equal(
      body.exitCode,
      'governance_unavailable',
      `须透出可判定的 exitCode，实际 body=${JSON.stringify(body)}`,
    )
    assert.notEqual(
      body.error,
      'Cognition aggregation failed',
      '不得再退化成泛化文案——须带出底层治理原因',
    )
    assert.match(
      String(body.error),
      /governance|project|worktree/i,
      `错误须点明治理原因，实际=${String(body.error)}`,
    )
  } finally {
    if (previous === undefined) delete process.env.LDVH_GOVERNED_PROJECTS_CONFIG
    else process.env.LDVH_GOVERNED_PROJECTS_CONFIG = previous
  }
})
