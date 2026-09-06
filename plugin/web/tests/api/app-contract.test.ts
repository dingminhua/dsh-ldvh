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
