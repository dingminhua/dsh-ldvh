import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'

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
    server.close((error) => error ? reject(error) : resolve())
  })
})

test('health endpoint preserves the current response and no-store boundary', async () => {
  const response = await fetch(`${baseUrl}/api/health`)

  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control') ?? '', /no-store/)
  assert.deepEqual(await response.json(), { success: true, message: 'ok' })
})

test('unknown API routes preserve the current 404 response', async () => {
  const response = await fetch(`${baseUrl}/api/not-a-current-route`)

  assert.equal(response.status, 404)
  assert.match(response.headers.get('cache-control') ?? '', /no-store/)
  assert.deepEqual(await response.json(), { success: false, error: 'API not found' })
})

test('the /ldvh/api alias reuses the existing route table (same status and body as /api)', async () => {
  const cases = [
    ['/api/health', '/ldvh/api/health'],
    ['/api/objects/badtype', '/ldvh/api/objects/badtype'],
    ['/api/not-a-current-route', '/ldvh/api/not-a-current-route'],
  ] as const

  for (const [direct, aliased] of cases) {
    const a = await fetch(`${baseUrl}${direct}`)
    const b = await fetch(`${baseUrl}${aliased}`)
    assert.equal(b.status, a.status, `${aliased} 的状态码应与 ${direct} 一致`)
    assert.equal(
      await b.text(),
      await a.text(),
      `${aliased} 的响应体应与 ${direct} 逐字节一致——别名不得改写上游结果`,
    )
  }
})

test('the /ldvh/api alias restores the original url so later requests are unaffected', async () => {
  const aliased = await fetch(`${baseUrl}/ldvh/api/health`)
  assert.equal(aliased.status, 200)

  const direct = await fetch(`${baseUrl}/api/health`)
  assert.equal(direct.status, 200)
  assert.deepEqual(await direct.json(), { success: true, message: 'ok' })
})
