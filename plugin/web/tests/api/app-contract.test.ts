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

/**
 * `/ldvh/api/*` 别名链（宿主 iframe 绕行路径）。
 *
 * 该别名靠 `app(req, res, next)` 复用既有路由表——**不是 `app.handle`**。express 4
 * 运行时两者等价（`createApplication` 里 app 函数体就是 `app.handle(req, res, next)`），
 * 但 `@types/express` 的 `Application` 只声明了可调用签名 `(req, res) => any`，
 * **从不声明 `handle`**。写成 `app.handle(...)` 会让 `tsc -b` 报 TS2339。
 *
 * **本用例的保证边界（实测，勿作过度声明）**：负向控制证明改回 `app.handle` 时
 * 本文件**依然全绿**——因为运行时两者行为相同，别名转发不受影响。故：
 *   - 「类型形状」由 `tsc -b` 守护，**不由本用例守护**；
 *   - 本用例守护的是**别名语义**：转发后状态码与响应体须与直连逐字节一致。
 * 二者互补，任一单独存在都会漏掉一类回归（缺 tsc 则类型错误无声复活；
 * 缺本用例则别名被改成改写上游结果时无人发现）。改写本别名逻辑时两处都要看。
 */
test('the /ldvh/api alias reuses the existing route table (same status and body as /api)', async () => {
  // 三类响应形态逐一比对：正常 200、参数化 400、未命中 404。必须逐字节一致，
  // 否则「别名」名不副实——iframe 侧会看到与主框架不同的结果。
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
  // 别名实现会临时改写 `req.url`（去掉 /ldvh 前缀），并在 finish/close 时还原。
  // 还原失败会让后续请求看到被污染的超集路径。此处以「别名请求之后再走直连」验证
  // 主框架视角不被改动。
  const aliased = await fetch(`${baseUrl}/ldvh/api/health`)
  assert.equal(aliased.status, 200)

  const direct = await fetch(`${baseUrl}/api/health`)
  assert.equal(direct.status, 200)
  assert.deepEqual(await direct.json(), { success: true, message: 'ok' })
})
