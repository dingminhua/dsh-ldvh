import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

// 确定性的治理不可用状态：载体路径指向必然不存在的临时路径，使每个依赖治理
// 解析的路由以 WebGovernanceError 拒绝。必须在 import app 之前设置——app 模块
// 顶层就会预热治理作用域。
process.env.LDVH_GOVERNED_PROJECTS_CONFIG = join(tmpdir(), `ldvh-async-bridge-absent-carrier-${process.pid}.yaml`)

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

test('async 路由 rejection 进入错误中间件——WebGovernanceError 以 503 降级应答而非杀死进程', async () => {
  // /api/objects/:type 在列表前解析请求作用域；载体不可读时以
  // WebGovernanceError 拒绝（governanceScope.ts「configuration is
  // unavailable」分支）。Express 4 下该 rejection 若未被桥接会成为
  // unhandledRejection：进程退出、在途请求 ECONNRESET、宿主按请求重拉
  // 子进程形成崩溃循环——本用例守住该回归。
  const response = await fetch(`${baseUrl}/api/objects/spark`)

  assert.equal(response.status, 503)
  const body = await response.json() as { ok: boolean; error: string; exitCode: string }
  assert.equal(body.ok, false)
  assert.equal(body.exitCode, 'governance_unavailable')
  assert.match(body.error, /Governance configuration is unavailable/)
})

test('被拒路由之后进程仍在服务——无崩溃循环', async () => {
  const response = await fetch(`${baseUrl}/api/health`)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { success: true, message: 'ok' })
})
