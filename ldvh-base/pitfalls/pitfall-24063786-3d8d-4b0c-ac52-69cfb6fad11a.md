---
title: 宿主外子进程 HTTP API 无来源校验致任意网页可调用
status: active
scope: 任何 DSH 插件在宿主进程外 spawn 本地 HTTP API 子进程、且宿主侧网关未接 connection.requestRejection、或子进程未做 Host/Sec-Fetch 来源校验的场合。不适用于纯宿主进程内处理的路由（DSH webServer 已带 peer 语义），也不适用于非浏览器攻击向量（本机其他进程属用户自身信任域）。
trigger_signal: DSH 升级改动了 connection 服务的 requestRejection 契约、或浏览器 Fetch Metadata 规范变化（Sec-Fetch-Site 语义）、或插件新增第三层对外 HTTP 入口时重审。
object_uid: 24063786-3d8d-4b0c-ac52-69cfb6fad11a
fact_type_key: pitfall
created_at: 2026-11-23T20:31:48.130Z
change_log:
  - at: 2026-11-23T20:31:48.130Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 创建：记录 Web 后端双层缺来源校验致 CSRF 的失败机制与修复取舍
---

# 宿主外子进程 HTTP API 无来源校验致任意网页可调用

## 症状

用户在浏览器里打开的任意网页，都能跨站调用 dsh-ldvh 的本地 Web API（127.0.0.1:3299），执行只有本机用户才有权执行的状态变更；`/api/health` 还带 `Access-Control-Allow-Origin: *`，允许跨站读取响应。直连端口同样对任意请求放行。外部发现者 awesome-dsh-plugin 维护者 fkysly 在收录条目描述上公开标注安全告示（PR #18279 合并评论，2026-11-23/24），并点名修复通道 `ctx.connection.requestRejection`。受影响版本线 dev@1.1.4-dev.1。

## 触发条件

宿主进程 spawn 的 localhost express 子进程作为 Web 后端，宿主经 web-mount.js 代理网关 `/ldvh/api` 转发；此时存在两条独立入口：网关路由与子进程直连端口。只要其中任一层没有来源校验，攻击面即成立。触发者是用户浏览器中的任意第三方页面（含跨站 fetch 与 DNS 重绑定后的同源请求），不需要用户安装任何东西。

## 根因

到 1.1.4 为止两层都无来源校验。网关侧，`plugin/lib/index.js` 的 `createApiHandler` / `registerStateRoute` 没有调用 DSH 的 `connection.requestRejection`，`ctx.inject` 也未声明 `connection`，因此即便 DSH 提供了机制也无从取用。子进程侧，`plugin/web/api/app.ts` 对任意请求放行，既不检查 Host 头，也不检查浏览器 Fetch Metadata。两层同时缺失属结构性疏漏：代理网关与直连端口是同一份能力的两个入口，防护只做一层等于没做。

## 解决

版本 1.1.5 对两层同时收口（dev 提交 49eaf113，发布树同步提交 23f2d3a6/1986cb08）。

网关层：`ctx.inject` 扩为 `["webServer", "connection"]`，`/ldvh/api` 与 `/ldvh/state` 的处理器入口先问 `connection.requestRejection(req)`，返回值只可能是 401、403 或 undefined，非 undefined 就地短路；`connection` 服务缺失时整个 web 路由不注册，形成架构级 fail-closed。判定辅助函数照抄 DSH 官方插件 dsh-host-open-in-app 的 `rejected()` 写法，避免自创语义。

直连层：子进程 express 对 `/api` 全路由加中间件，先剥离端口比较 Host 头，必须是 `127.0.0.1`、`localhost` 或 `[::1]` 之一（防 DNS 重绑定），再拒绝 `Sec-Fetch-Site: cross-site`（浏览器不可伪造的元数据，防跨站 CSRF）。宿主代理形态与 node fetch 测试形态（本地 Host、无 Sec-Fetch-Site）天然通过，无需额外豁免。

工程取舍：曾考虑宿主与子进程共享 token 的方案，弃用。原因是 env 丢失时该方案静默 fail-open，且会把 9 个起真实 HTTP 的契约测试全部掀翻。浏览器元数据栅栏无密钥、无 env 耦合；对非浏览器的本机进程本就无需设防。

## 规避

同形态插件若暂不能改造，可先只绑 127.0.0.1 并去掉一切 `Access-Control-Allow-Origin` 通配，能挡住跨站读取但不能挡住跨站写入；这不是修复，只是收窄暴露面。真正规避是接入 `connection.requestRejection` 补齐网关层，并在子进程侧加 Host 与 Sec-Fetch 双栅栏，两层缺一不可。

## 验证

`plugin/test/web-routes.test.mjs` 覆盖网关三态用例（401、403、放行），14/14 通过；新增 `plugin/web/tests/api/direct-port-fence.test.ts` 直连栅栏五用例；既有 385 项 HTTP 契约测试零改动全绿；全量 2638 项 0 失败。

## 影响与适用范围

任何 DSH 插件在宿主进程外 spawn 本地 HTTP API 子进程、且宿主侧网关未接 connection.requestRejection、或子进程未做 Host/Sec-Fetch 来源校验的场合。不适用于纯宿主进程内处理的路由（DSH webServer 已带 peer 语义），也不适用于非浏览器攻击向量（本机其他进程属用户自身信任域）。
