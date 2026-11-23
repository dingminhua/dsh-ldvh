import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { request as httpRequest } from 'node:http'

let server: Server
let port = 0

before(async () => {
  const { default: app } = await import('../../api/app.ts')
  server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address() as AddressInfo
  port = address.port
})

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
})

function fetchRaw(path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      let body = ''
      res.on('data', (chunk: Buffer) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

test('直接端口拒绝非本地 Host 头（DNS 重绑定与跨源直连防护）', async () => {
  const res = await fetchRaw('/api/objects', { host: 'evil.example.com' })
  assert.equal(res.status, 403)
  assert.match(res.body, /forbidden origin/)
})

test('直接端口拒绝 cross-site 浏览器调用（CSRF 防护，Sec-Fetch-Site 不可伪造）', async () => {
  const res = await fetchRaw('/api/objects', { host: `127.0.0.1:${port}`, 'sec-fetch-site': 'cross-site' })
  assert.equal(res.status, 403)
})

test('直接端口拒绝非本地 Host 的 health 探测同样被拦（栅栏覆盖全部 /api 路由）', async () => {
  const res = await fetchRaw('/api/health', { host: 'rebind.attacker.example' })
  assert.equal(res.status, 403)
})

test('宿主代理与测试形态（本地 Host、无 Sec-Fetch-Site 元数据）放行', async () => {
  const res = await fetchRaw('/api/health', { host: `127.0.0.1:${port}` })
  assert.equal(res.status, 200)
})

test('localhost 别名与 IPv6 回环绕过端口剥离后放行', async () => {
  const res = await fetchRaw('/api/health', { host: `localhost:${port}` })
  assert.equal(res.status, 200)
  const res6 = await fetchRaw('/api/health', { host: `[::1]:${port}` })
  assert.equal(res6.status, 200)
})
