---
title: DSH 官方插件接入面（0.1.2-rc.1：/api 通道与认证/Web 生命周期/前端启动图/Tab·Sidebar 挂载）
status: active
research_question: DSH 宿主（0.1.2-rc.1）为插件提供哪些 Web 端接入机制——UI 挂载（Tab/Sidebar/面板 slot）、前端资源装载（dsh.client 与 __DSH_BOOT__ 启动图）、浏览器与宿主间 RPC 及其认证、Web 服务生命周期——各自的接入方法与边界在哪
research_purpose: 支撑 LDVH 插件（08 号规范与 Web 呈现 10 号规范）的 Tab/Sidebar/Web 服务接入实现判断——LDVH cognition 端点与 Web UI 的宿主接入径路设计依据
stopping_reason: sufficient
confirmed_statements:
  - F1 浏览器与宿主间 RPC 走 /api 唯一前缀通道，channel 须匹配白名单正则且 /api 保留给 interceptor
  - F2 浏览器认证协议：每进程一枚启动令牌，校验后铸 HMAC 签名 cookie，未认证一律 401
  - F3 请求信任栅栏三级：Host 与 Origin 先过，再判 cookie，/api 与 WebSocket 升级同受约束
  - F4 动态插件双向 RPC：client 的 host.call 复用 /api，不占独立命名空间
  - F5 暴露面边界：白名单与 JSON-only 是纪律而非安全边界
  - F6 路由匹配次序：exact 优先，prefix 最长，fallback 唯一席位兜底
  - F7 index 注入两段式：结构化行先，原始 HTML 变换后，经事件向订阅者收集
  - F8 Web 服务生命周期：init 内 listen，失败即 reject，disposer 全量清理
  - F9 装配链与 DSH_WEB_URL 语义：它是发布出去的 bash 变量，不是读进来的环境输入
  - F10 前端资源声明：dsh.client 四字段各有类型校验，缺 client 导出即硬错误
  - F11 __DSH_BOOT__ 消费链：READY 门控 → 模块系统创建 → 预取 immediate 层 → 逐插件激活 → 审计 → 挂载（补 R1 缺口）
  - F12 HMR 通道：/plugins/events SSE，两帧驱动 fiber 换血
  - F13 UI 挂载实战契约：设置页用三件套，sidebar 只有 footer.action 是安全增量席
  - F14 数据通道：宿主只交裸 observable 源，渲染器合成 useXxx 选择器 prop
uncertain:
  - issue: 浏览器 fetch 是否显式携带 cookie 未由代码声明（未传 credentials 选项，依赖同源默认行为推断），且令牌无 TTL 与轮换机制——撤销仅靠删除凭据记录并重启
    reason: 只读源码无运行时抓包证据；README 只给撤销路径未提过期或轮换
  - issue: 第三方 UI 插件的静态 TS 类型来源未证：各包声明 types 字段，但产物目录内无实际 .d.ts 文件
    reason: 需源码仓库或运行时 Inspect 验证第三方能否 import type
  - issue: 静态插件 dsh.client 声明到「设置页出现 UI」的端到端官方模板缺失（README 仅文案），第三方只能由官方包自有注册代码反推
    reason: 验收所需完整写法只能由官方包自有注册代码反推
  - issue: 同 slot 双占用者的 priority 覆盖规则仅在 SlotCore 注释体现（升序、最低者渲染），未做运行时实测
    reason: 只读调研无运行时实例
gaps:
  - description: LAN 部署与真实局域网信任边界未验证——--host 0.0.0.0 被 CLI 显式拒绝（原文称会向网络暴露远程代码执行）
    priority: medium
  - description: DSH_WEB_URL 与 DSH_WEB_MODE 的第二发布点（apps/cli 侧）不在 @deepseek-ai 包内，需 harness 仓库源码取证
    priority: medium
  - description: tapIndex 原始 HTML 变换逃离舱在官方装配中零使用方，注入约束强度未经组合场景验证
    priority: low
  - description: 路由匹配只按 pathname、无 method 维度，同 path 的方法差异须在 handler 内自行区分且未文档化
    priority: low
  - description: 精确 Fetch 路由（connection.fetch.register）的业务使用方未逐一枚举
    priority: low
  - description: worker-local 直连载体是否绕过 HTTP 401 栅栏未确认
    priority: low
implications:
  - finding_ref: F1 浏览器与宿主间 RPC 走 /api 唯一前缀通道，channel 须匹配白名单正则且 /api 保留给 interceptor
    implication: LDVH cognition 端点与 Web UI 后端只有这一条正路，应注册为 /api 下 channel 或精确 Fetch 路由以继承宿主认证与信任栅栏
  - finding_ref: F2 浏览器认证协议：每进程一枚启动令牌，校验后铸 HMAC 签名 cookie，未认证一律 401
    implication: LDVH 走官方 Web 通道即自动获得认证，但打印出的 URL 等价于会话钥匙，须在 Human 可见面提示其敏感性
  - finding_ref: F3 请求信任栅栏三级：Host 与 Origin 先过，再判 cookie，/api 与 WebSocket 升级同受约束
    implication: LDVH 前端与外部页面交互必须同源，跨站调用会被 403 拒绝
  - finding_ref: F4 动态插件双向 RPC：client 的 host.call 复用 /api，不占独立命名空间
    implication: LDVH 插件的 Client 到 Host 私有方法与页面数据请求共用通道与认证，无需额外开口子
  - finding_ref: F5 暴露面边界：白名单与 JSON-only 是纪律而非安全边界
    implication: 别把白名单误读成沙箱——越界防护仍落在审批与 Git Gate，传入数据须自行保证可序列化
  - finding_ref: F6 路由匹配次序：exact 优先，prefix 最长，fallback 唯一席位兜底
    implication: LDVH 注册路由须避开 /api 与 /plugins 已占前缀，且拿不到已被前端静态托管独占的 fallback 席位
  - finding_ref: F7 index 注入两段式：结构化行先，原始 HTML 变换后，经事件向订阅者收集
    implication: LDVH 注入脚本或样式应经结构化行而非自造字符串替换，且需意识到其后仍会被 raw tap 再加工
  - finding_ref: F8 Web 服务生命周期：init 内 listen，失败即 reject，disposer 全量清理
    implication: LDVH 无需自管服务关停，但端口不固定——任何写死端口的假设都会失效，须经 ctx.webServer.port 读取
  - finding_ref: F9 装配链与 DSH_WEB_URL 语义：它是发布出去的 bash 变量，不是读进来的环境输入
    implication: 不要试图通过设置环境变量改变 Web 地址；08 号规范应写明局域网部署当前不受支持
  - finding_ref: F10 前端资源声明：dsh.client 四字段各有类型校验，缺 client 导出即硬错误
    implication: LDVH 提供浏览器端 UI 必须同时给出 dsh.client 声明与 ./client 导出，这是前端代码被装载的唯一入口
  - finding_ref: F11 __DSH_BOOT__ 消费链：READY 门控 → 模块系统创建 → 预取 immediate 层 → 逐插件激活 → 审计 → 挂载（补 R1 缺口）
    implication: LDVH 前端装载时机与失败点变得可预测——插件卡 pending 时错误指向缺失服务；immediately 是预取层而非加速开关，滥用只增首屏负担
  - finding_ref: F12 HMR 通道：/plugins/events SSE，两帧驱动 fiber 换血
    implication: 开发期 LDVH 前端改动可热更新免重启，但 rebuilt 会换掉整个插件 fiber——有驻留状态的组件须自行处理状态迁移
  - finding_ref: F13 UI 挂载实战契约：设置页用三件套，sidebar 只有 footer.action 是安全增量席
    implication: LDVH Web 入口落点唯一化——设置页走 settings.plugins.tab、侧栏走 footer.action，其余位置误注册会抹掉官方界面
  - finding_ref: F14 数据通道：宿主只交裸 observable 源，渲染器合成 useXxx 选择器 prop
    implication: LDVH 前端组件按 scope 声明取用 useXxx 即可，不必自行订阅宿主服务；inject 返回的 hooks 还会自动生成组件自有 useName
urls:
  - ref: https://registry.npmjs.org/@deepseek-ai/dsh-client-connection/-/dsh-client-connection-0.1.2-rc.1.tgz
    summary: /api 唯一前缀路由、channel 白名单与信封、令牌生成、authenticatedUrl、authorizeIndex 与请求信任栅栏
    title: dsh-client-connection 0.1.2-rc.1（浏览器与宿主 RPC 及认证）
  - ref: https://registry.npmjs.org/@deepseek-ai/dsh-api-gateway/-/dsh-api-gateway-0.1.2-rc.1.tgz
    summary: Remote 命名空间网关、/api 端点分发、assertJsonValue 序列化校验、WebSocket mux 鉴权
    title: dsh-api-gateway 0.1.2-rc.1（RPC 网关与序列化边界）
  - ref: https://registry.npmjs.org/@deepseek-ai/dsh-cordis-client-runner/-/dsh-cordis-client-runner-0.1.2-rc.1.tgz
    summary: 动态插件 client 半 host.call 通道、CLIENT_SLOT_API 中 sidebar 与 settings.plugins.tab 契约
    title: dsh-cordis-client-runner 0.1.2-rc.1（动态插件 client 与 slot 目录）
  - ref: https://registry.npmjs.org/@deepseek-ai/dsh-cordis-host-runner/-/dsh-cordis-host-runner-0.1.2-rc.1.tgz
    summary: harness.handle 注册面与 invoke 四类错误语义
    title: dsh-cordis-host-runner 0.1.2-rc.1（动态插件 host 半）
  - ref: https://registry.npmjs.org/@deepseek-ai/dsh-host-webserver/-/dsh-host-webserver-0.1.2-rc.1.tgz
    summary: match 匹配次序、index 注入两段式与 webserver/index-inject 事件、listen 与 dispose 生命周期
    title: dsh-host-webserver 0.1.2-rc.1（Web 服务与路由生命周期）
  - ref: https://registry.npmjs.org/@deepseek-ai/dsh-host-frontend-static/-/dsh-host-frontend-static-0.1.2-rc.1.tgz
    summary: fallback 席位托管 dist、index 先鉴权后渲染、静态资产公开
    title: dsh-host-frontend-static 0.1.2-rc.1（前端静态托管）
  - ref: https://registry.npmjs.org/@deepseek-ai/dsh-web-app/-/dsh-web-app-0.1.2-rc.1.tgz
    summary: require.resolve 定位 dist、shellEnv 发布 DSH_WEB_URL、打印与开浏览器、拒绝 --host 0.0.0.0
    title: dsh-web-app 0.1.2-rc.1（Web 装配与 URL 发布）
  - ref: https://registry.npmjs.org/@deepseek-ai/dsh-client-modules/-/dsh-client-modules-0.1.2-rc.1.tgz
    summary: dsh.client 四字段校验、增量扫描无全量重扫、/plugins combo 路由、bootInjections 与两阶段批次、__ModuleLoader__ 定义
    title: dsh-client-modules 0.1.2-rc.1（前端资源声明与启动图）
  - ref: https://registry.npmjs.org/@deepseek-ai/dsh-web-frontend/-/dsh-web-frontend-0.1.2-rc.1.tgz
    summary: dist 启动内核消费 __DSH_BOOT__：READY 门控、prefetchImmediateTier、逐插件激活与 assertEntriesActive
    title: dsh-web-frontend 0.1.2-rc.1（前端 shell 与启动内核）
  - ref: https://registry.npmjs.org/@deepseek-ai/dsh-client-hmr/-/dsh-client-hmr-0.1.2-rc.1.tgz
    summary: /plugins/events SSE 端点、graph 与 rebuilt 两帧、invalidate+prefetch+refresh 换血链
    title: dsh-client-hmr 0.1.2-rc.1（HMR 通道）
  - ref: https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-settings-plugins/-/dsh-client-ui-settings-plugins-0.1.2-rc.1.tgz
    summary: settings.plugins.tab 官方注册实例（id/order/label）与 tablist 渲染
    title: dsh-client-ui-settings-plugins 0.1.2-rc.1（设置页标签实战）
  - ref: https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-slots/-/dsh-client-ui-slots-0.1.2-rc.1.tgz
    summary: standardHookPropName 命名规则、list slot 缺 id 抛错与注册校验
    title: dsh-client-ui-slots 0.1.2-rc.1（slot 注册与钩子命名）
  - ref: https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-renderer/-/dsh-client-ui-renderer-0.1.2-rc.1.tgz
    summary: 宿主交裸 observable 源、渲染器合成 useXxx prop 并组合 root 与 scope 两层绑定
    title: dsh-client-ui-renderer 0.1.2-rc.1（数据通道与绑定合成）
  - ref: https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-session/-/dsh-client-ui-session-0.1.2-rc.1.tgz
    summary: provideRoot 与 installScope 注册 session 域钩子源
    title: dsh-client-ui-session 0.1.2-rc.1（session 域绑定源）
object_uid: 11fbbd42-9cfc-4e67-80d8-10ddaf737b96
fact_type_key: research
created_at: 2026-09-08T19:32:10.474Z
change_log:
  - at: 2026-09-08T19:32:10.474Z
    provider: workbuddy
    model: hy4-preview
    summary: 受控创建 Research 对象（v5 调研计划 R2：DSH 官方插件接入面；四路子代理取证+主控核验，补上 R1 留下的 __DSH_BOOT__ 消费与浏览器认证两个缺口）
---

## 研究问题

DSH 宿主（0.1.2-rc.1）为插件提供哪些 Web 端接入机制——UI 挂载（Tab/Sidebar/面板 slot）、前端资源装载（dsh.client 与 __DSH_BOOT__ 启动图）、浏览器与宿主间 RPC 及其认证、Web 服务生命周期——各自的接入方法与边界在哪

本调研承接 R1（宿主能力全景对象 e7599c11）留下的两个 medium 缺口——__DSH_BOOT__ 消费细节与浏览器认证协议，并深化其索引级的 Web 接入面结论（三条径路）。支撑 LDVH 插件 cognition 端点与 Web UI 的宿主接入设计判断。

## 输入与边界

方法：四路只读调研子代理分面取证（前端启动图 / RPC 与认证 / Web 服务生命周期 / UI 挂载实战，各带 scope、验收标准与三态输出要求）+ 主控第一手核验（25 处 file:line 抽验；修正任务前提错误 1 处：组合清单实属 dsh-web-app 而非 dsh-web）。证据形式：逐字摘录 + 包内 file:line 锚点 + npm tarball URL 长期锚点。版本基线：涉读包全部 @deepseek-ai/*@0.1.2-rc.1。观察时点 2026-09-10。

不覆盖：LAN 部署实测（官方明示 --host 0.0.0.0 不受支持）、apps/cli 侧 DSH_WEB_URL 第二发布点（需 harness 仓库源码）、worker-local 直连载体的认证语义、动态插件 client 半装载路径（R1 已证动态侧 guardedSlots 与 guardedTheme）。

## 关键发现

### F1 浏览器与宿主间 RPC 走 /api 唯一前缀通道，channel 须匹配白名单正则且 /api 保留给 interceptor

connection 的 apply 把 /api 以 kind:"prefix" 注册到 webServer，是浏览器与宿主之间唯一的 RPC 挂载点；channel 必须匹配 `/^\/[A-Za-z0-9._~-]+$/`，且 /api 本身保留给 interceptor——用 register 直接注册 /api 会抛错。请求信封为 `client-request {type, rpcId, method, payload}`，响应为 `server-response {type, rpcId, result:{ok,value}|{ok:false,error}}`，handler 签名为 `(endpoint, payload, signal)`；同 path 的 GET/POST 差异须在 handler 内自行区分（match 无 method 维度）。

**对 LDVH 的价值**：LDVH cognition 端点与 Web UI 的后端通信只有这一条正路——不要另起端口或独立 HTTP 服务，应把 API 注册为 /api 下的 channel 或精确 Fetch 路由，天然继承宿主的认证与信任栅栏。

溯源：https://registry.npmjs.org/@deepseek-ai/dsh-client-connection/-/dsh-client-connection-0.1.2-rc.1.tgz（lib/index.js:12 API_PATH、:702-715 路由注册、:497 与 :660-662 channel 白名单、:605-631 handler 契约、:479-490 信封）

### F2 浏览器认证协议：每进程一枚启动令牌，校验后铸 HMAC 签名 cookie，未认证一律 401

令牌由 `randomBytes(32)` 生成并以进程根上下文为 WeakMap 键缓存——内存态、不落盘、进程存活期间恒定；`authenticatedUrl` 把它拼成 `/?token=` 供打印与打开浏览器；`authorizeIndex` 仅在 GET 根路径且单 token 匹配时铸 cookie（`dsh-auth-<hash(authority)>`，HMAC-SHA256 签名、HttpOnly、SameSite=Strict、30 天），随后 303 剥掉 token 回到干净根路径；其余情况一律 401，文案直指「重开 dsh web 打印的 URL」。签名密钥持久化在 `$DSH_HOME/.credentials.yaml`。

**对 LDVH 的价值**：LDVH 走官方 Web 通道即自动获得这套认证，无需自建登录；但令牌即凭据——打印出的 URL 等价于会话钥匙，须在 Human 可见面提示其敏感性，且凭据记录的删除与重启是唯一撤销路径。

溯源：https://registry.npmjs.org/@deepseek-ai/dsh-client-connection/-/dsh-client-connection-0.1.2-rc.1.tgz（lib/index.js:217-223 令牌生成、:347-354 authenticatedUrl、:363-402 authorizeIndex 分支、:200 COOKIE_PREFIX、:298-315 密钥存放）

### F3 请求信任栅栏三级：Host 与 Origin 先过，再判 cookie，/api 与 WebSocket 升级同受约束

`requestRejection` 先做信任判定：Host 必须是 loopback 或命中 trustedHosts，带 Origin 时须与 Host 相符，`sec-fetch-site: cross-site` 一律拒绝（403）；通过后 cookie 无效才 401。/api 路由与 WebSocket 升级（/api/remote.mux）都先过此栅栏再分发。

**对 LDVH 的价值**：这是 LDVH Web 端默认获得的边界，但也意味着任何跨站调用都会被拒——若 LDVH 前端需要与外部页面交互，必须走同源而非跨站。

溯源：https://registry.npmjs.org/@deepseek-ai/dsh-client-connection/-/dsh-client-connection-0.1.2-rc.1.tgz（lib/index.js:530-533 requestRejection、:100-192 isTrustedApiRequest、:419-425 401 文案）；WebSocket 侧：https://registry.npmjs.org/@deepseek-ai/dsh-api-gateway/-/dsh-api-gateway-0.1.2-rc.1.tgz（lib/index.js:462-468）

### F4 动态插件双向 RPC：client 的 host.call 复用 /api，不占独立命名空间

动态插件 client 半调用 `host.call(method, args)` 最终落到 `ctx.remote.dynamicCordisRunner.invoke(...)`，经 /api 共享通道以 `dynamicCordisRunner/invoke` 端点分发；宿主侧 `harness.handle(method, fn)` 把处理器注册进 `run.handlers`，invoke 有 plugin-not-running / stale-run / method-not-found / handler-error 四类错误语义。

**对 LDVH 的价值**：LDVH 插件的 Client→Host 私有方法走的就是这条——与页面数据请求共用一条通道与同一套认证，无需为插件 RPC 开额外口子。

溯源：https://registry.npmjs.org/@deepseek-ai/dsh-cordis-client-runner/-/dsh-cordis-client-runner-0.1.2-rc.1.tgz（lib/client.js:173-181、:4526-4534）；端点分发：https://registry.npmjs.org/@deepseek-ai/dsh-api-gateway/-/dsh-api-gateway-0.1.2-rc.1.tgz（lib/client.js:1601、lib/index.js:454-456）；宿主注册：https://registry.npmjs.org/@deepseek-ai/dsh-cordis-host-runner/-/dsh-cordis-host-runner-0.1.2-rc.1.tgz（lib/index.js:525-533、:2124-2157）

### F5 暴露面边界：白名单与 JSON-only 是纪律而非安全边界

channel 与 endpoint 各有正则白名单；网关侧 `assertJsonValue` 递归拒绝 undefined、NaN/Infinity、-0、循环引用、symbol、非 plain object 与稀疏数组；请求体上限 300 MiB。官方同时明言：这是 API 纪律而非安全边界——动态包的代码与其被接纳的宿主进程同等可信。

**对 LDVH 的价值**：LDVH 插件经此通道传数据时须自行保证可序列化（事实对象天然满足）；更要紧的是别把「有白名单」误读成「有沙箱」——越界防护仍落在审批与 Git Gate 上。

溯源：https://registry.npmjs.org/@deepseek-ai/dsh-api-gateway/-/dsh-api-gateway-0.1.2-rc.1.tgz（lib/index.js:1074-1103）；上限与白名单：https://registry.npmjs.org/@deepseek-ai/dsh-client-connection/-/dsh-client-connection-0.1.2-rc.1.tgz（lib/index.js:23、:497、:640-662）；非安全边界声明：https://registry.npmjs.org/@deepseek-ai/dsh-cordis-client-runner/-/dsh-cordis-client-runner-0.1.2-rc.1.tgz（lib/client.js:201-202）

### F6 路由匹配次序：exact 优先，prefix 最长，fallback 唯一席位兜底

`match()` 先查 exact 表，未命中再遍历 prefix 表取最长匹配（严格大于才替换，等长保留先注册者），两者皆未命中才交给 fallback；fallback 重复注册直接抛错，未注册时返回 404。exact 与 prefix 分表，同 path 跨 kind 不冲突。

**对 LDVH 的价值**：LDVH 注册路由时要预判与官方席位的冲突——/api 与 /plugins 已被占用，插件应取自己的前缀；fallback 席位已被前端静态托管独占，任何插件都拿不到。

溯源：https://registry.npmjs.org/@deepseek-ai/dsh-host-webserver/-/dsh-host-webserver-0.1.2-rc.1.tgz（lib/index.js:322-331 match、:176-183 register 分表与重复校验、:205-211 registerFallback、:228-244 handle 兜底）

### F7 index 注入两段式：结构化行先，原始 HTML 变换后，经事件向订阅者收集

`renderIndex` 是两段合成：先 `renderIndexInjections`（结构化行按 head/body 分组拼进对应标签之后，组内按表序，尾部追加 READY 标记），再 `applyIndexTaps`（原始 HTML 变换按注册顺序）。注入内容由一次 `webserver/index-inject` 事件广播收集，订阅者 push 各自行，因此每次渲染都读到模块图与主题偏好的实时状态。

**对 LDVH 的价值**：LDVH 若要向页面注入脚本或样式，应经结构化行而非自造字符串替换；两段顺序决定了「结构化注入」可被后续 raw tap 再加工。

溯源：https://registry.npmjs.org/@deepseek-ai/dsh-host-webserver/-/dsh-host-webserver-0.1.2-rc.1.tgz（lib/index.js:358-362 renderIndex、:349-353 collectIndexInjections、:74-93 结构化行、:338-342 applyIndexTaps）；订阅者实例：https://registry.npmjs.org/@deepseek-ai/dsh-client-modules/-/dsh-client-modules-0.1.2-rc.1.tgz（lib/index.js:485-487）

### F8 Web 服务生命周期：init 内 listen，失败即 reject，disposer 全量清理

`Service.init` 内建 server 并 listen，port 为 0 时由 OS 分配、`get port()` 返回实际端口；listen 失败直接 reject 初始化（宿主启动即报失败）。`ctx.effect` 的异步 disposer 依次关闭 server、断开全部连接、销毁已升级 socket 并等待全部完成。

**对 LDVH 的价值**：LDVH 插件随宿主进程生灭，无需自己管服务关停；但要意识到端口不固定——任何写死端口的假设都会失效，应经 `ctx.webServer.port` 读取。

溯源：https://registry.npmjs.org/@deepseek-ai/dsh-host-webserver/-/dsh-host-webserver-0.1.2-rc.1.tgz（lib/index.js:227-320 生命周期、:296-302 listen、:163-165 get port、:305-319 disposer）

### F9 装配链与 DSH_WEB_URL 语义：它是发布出去的 bash 变量，不是读进来的环境输入

dsh-web-app 用 `require.resolve` 定位前端 dist 的 index.html，再挂 frontend-static 插件托管；`DSH_WEB_URL` 由 shellEnv 注册发布（每次 shell 调用时解析，值为 `http://127.0.0.1:<port>`），全树检索无任何 `process.env.DSH_WEB_URL` 读取点——它是输出而非输入。CLI 显式拒绝 `--host 0.0.0.0`，原文称会向网络暴露远程代码执行。

**对 LDVH 的价值**：纠正一个易错认知——不要试图通过设置环境变量改变 Web 地址；同时 08 号规范应写明「局域网部署当前不受支持」，避免把它当作可配置项。

溯源：https://registry.npmjs.org/@deepseek-ai/dsh-web-app/-/dsh-web-app-0.1.2-rc.1.tgz（lib/index.js:116-124 resolveDistIndex、:189 挂载、:199-205 shellEnv 发布、:216-223 打印；lib/startup.js:38-41 拒绝 0.0.0.0）

### F10 前端资源声明：dsh.client 四字段各有类型校验，缺 client 导出即硬错误

`platform` 必须是字符串且只能为 web（否则静默判负）；`inject` 与 `external` 为可选字符串数组；`immediately` 为可选布尔。声明了 dsh.client 却没有 `exports["./client"]` 是硬错误。bundle 经 `/plugins` 前缀的 combo 路由服务，URL 形如 `/plugins/??<id>/client.js,...&rev=`，带不可变缓存头。

**对 LDVH 的价值**：LDVH 插件若要提供浏览器端 UI，必须同时给出 package.json 的 dsh.client 声明与 ./client 导出——这是前端代码被装载的唯一入口。

溯源：https://registry.npmjs.org/@deepseek-ai/dsh-client-modules/-/dsh-client-modules-0.1.2-rc.1.tgz（lib/index.js:144-147 四字段校验、:630-634 platform 判负、:635-636 缺导出抛错、:480-484 与 :181-184 路由与 combo URL）

### F11 __DSH_BOOT__ 消费链：READY 门控 → 模块系统创建 → 预取 immediate 层 → 逐插件激活 → 审计 → 挂载（补 R1 缺口）

shell 启动内核先 await `__DSH_BOOT_READY__`（由 webserver 的 READY 标记解析），随后用 `__ModuleLoader__.create({boot: __DSH_BOOT__, ...})` 建立模块系统并解析出 manifest，先预取所有 `immediately` 层的 bundle（到达不等于物化），再把模块系统装为 Loader 的 import 接缝，然后按插件 id 逐一创建插件 fiber 并等待稳定，经 `assertEntriesActive` 审计（非活跃条目聚合报错、pending 者列出缺失服务），最后注入 uiRenderer 并挂载到 #root。批次分两组：bootstrap 仅含 client-modules 的解析阻塞脚本，application 为 preload 提示加按需惰性装载，同一 combo URL 共享单 flight。

**对 LDVH 的价值**：R1 只确认了启动图的生成侧，本条补上消费侧——LDVH 前端的装载时机与失败点现在可预测：插件若卡在 pending，错误会指向缺失服务而非白屏；`immediately` 是预取层而非加速开关，滥用只会增加首屏负担。

溯源：https://registry.npmjs.org/@deepseek-ai/dsh-host-webserver/-/dsh-host-webserver-0.1.2-rc.1.tgz（lib/index.js:65 READY_MARKUP）；注入与图：https://registry.npmjs.org/@deepseek-ai/dsh-client-modules/-/dsh-client-modules-0.1.2-rc.1.tgz（lib/index.js:387-432 bootInjections、:373-375 与 :569-574 两阶段批次、:77 增量扫描无全量重扫）；消费内核：https://registry.npmjs.org/@deepseek-ai/dsh-web-frontend/-/dsh-web-frontend-0.1.2-rc.1.tgz（dist/assets/index-Df-65__b.js，prefetchImmediateTier 与 WebBootKernel 消费链）

### F12 HMR 通道：/plugins/events SSE，两帧驱动 fiber 换血

HMR 以 exact 路由注册 /plugins/events 作为 SSE 通道，连接即发 graph 帧，插件重建后发 rebuilt 帧（id 与 rev）。浏览器侧收到 rebuilt 后做 invalidate → prefetch → 旧 fiber 拆除并移除样式 → entry.refresh → 等待新 fiber 稳定；graph 帧在浏览器侧仅解析不驱动动作。

**对 LDVH 的价值**：开发期 LDVH 前端改动可经此通道热更新，无需重启宿主；但 rebuilt 会换掉整个插件 fiber——有驻留状态的组件须自己处理状态迁移。

溯源：https://registry.npmjs.org/@deepseek-ai/dsh-client-hmr/-/dsh-client-hmr-0.1.2-rc.1.tgz（lib/index.js:5 EVENTS_ENDPOINT、:122-125 graph 帧、:144-151 rebuilt 帧、lib/client.js:65-110 reload 链）

### F13 UI 挂载实战契约：设置页用三件套，sidebar 只有 footer.action 是安全增量席

往设置页加标签用 `settings.plugins.tab`（list 型）：options 为 `id`（必填，缺即抛错）、`order`（升序定位）、`label`（可为本地方言 thunk），由 PluginsSettingsSection 读 ledger 渲染 tablist，panel 内按 id 精确渲染。sidebar 侧：顶层与 brand.mark / brand.name / workspaces / settings 均为 single 且标注 shadows-shipped-ui（注册即整块替换并带走其声明的子 slot），只有 `sidebar.footer.action` 是 list 型且 replaceRisk 为 none——官方原句即「要往 sidebar 加东西，就注册到那些内席位之一」。

**对 LDVH 的价值**：LDVH 的 Web 入口落点已经唯一化——设置页走 settings.plugins.tab，侧栏走 footer.action；其余位置都是替换语义，误注册会抹掉官方界面。

溯源：https://registry.npmjs.org/@deepseek-ai/dsh-cordis-client-runner/-/dsh-cordis-client-runner-0.1.2-rc.1.tgz（lib/client.js:3616-3656 settings.plugins.tab、:3774-3795 sidebar 顶层与替换警告、:3846-3886 footer.action 增量席）；官方写法：https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-settings-plugins/-/dsh-client-ui-settings-plugins-0.1.2-rc.1.tgz（lib/client.js:1781-1792）；缺 id 抛错：https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-slots/-/dsh-client-ui-slots-0.1.2-rc.1.tgz（lib/index.js:90-94）

### F14 数据通道：宿主只交裸 observable 源，渲染器合成 useXxx 选择器 prop

宿主侧交出的是裸 observable 源（钩子不跨宿主契约），渲染器用 `use` 加首字母大写的规则把每个源合成为 `useXxx` 选择器 prop，再组合 root 与 scope 两层绑定，并叠加 t、useStore/actions、renderSlot 等套件。各域插件经 `provideRoot` 与 `provide` 注册自己的钩子源（workspaces、sessions、conversation、chat、input、trajectory 等）。

**对 LDVH 的价值**：LDVH 前端组件能拿到哪些数据、以什么形态拿到，现在有确定性答案——按 scope 声明取用 useXxx 即可，不必自行订阅宿主服务；组件注册时通过 inject 返回的 hooks 还会自动生成组件自有的 use<Name>。

溯源：https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-renderer/-/dsh-client-ui-renderer-0.1.2-rc.1.tgz（lib/client.js:538-549 合成、:551-573 两层绑定、:599-627 套件）；命名规则：https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-slots/-/dsh-client-ui-slots-0.1.2-rc.1.tgz（lib/index.js:7-9）；源注册：https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-session/-/dsh-client-ui-session-0.1.2-rc.1.tgz（lib/client.js:321-325）

## 未证实与缺口

未证实：
- 浏览器 fetch 是否显式携带 cookie 未由代码声明（未传 credentials 选项，依赖同源默认行为推断），且令牌无 TTL 与轮换机制——撤销仅靠删除凭据记录并重启。
- 第三方 UI 插件的静态 TS 类型来源未证：各包声明 types 字段，但产物目录内无实际 .d.ts 文件。
- 静态插件 dsh.client 声明到「设置页出现 UI」的端到端官方模板缺失（README 仅文案），第三方只能由官方包自有注册代码反推。
- 同 slot 双占用者的 priority 覆盖规则仅在 SlotCore 注释体现（升序、最低者渲染），未做运行时实测。

缺口：
- （medium）LAN 部署与真实局域网信任边界未验证——--host 0.0.0.0 被 CLI 显式拒绝。
- （medium）DSH_WEB_URL 与 DSH_WEB_MODE 的第二发布点（apps/cli 侧）不在 @deepseek-ai 包内，需 harness 仓库源码取证。
- （low）tapIndex 原始 HTML 变换逃离舱在官方装配中零使用方，注入约束强度未经组合场景验证。
- （low）路由匹配只按 pathname、无 method 维度，同 path 的方法差异须在 handler 内自行区分且未文档化。
- （low）精确 Fetch 路由（connection.fetch.register）的业务使用方未逐一枚举。
- （low）worker-local 直连载体是否绕过 HTTP 401 栅栏未确认。

## 建议

A1 LDVH 的 Web 后端只走 webServer 的 /api 与自有 prefix 路由，不另起端口或独立服务；验收条件：无插件自建 HTTP 监听，全部端点可在 ctx.webServer 路由表枚举。判断依据：F1/F6/F8。可被插件实现 WorkCase 承接。
A2 UI 入口固定为 settings.plugins.tab（设置页三件套）与 sidebar.footer.action（侧栏增量席），禁止注册 single 型已占用席位；验收条件：插件注册席位清单里无 replaceRisk 为 shadows-shipped-ui 的项。判断依据：F13。可被 10 号规范与 Web 挂载实现承接。
A3 前端资源用 package.json 的 dsh.client 声明加 exports["./client"] 导出，immediately 只给首屏必需包；验收条件：构建产物含 ./client 导出且启动无 pending 条目。判断依据：F10/F11。可被插件前端工程模板承接。
A4 在 08 号规范写明：启动令牌即会话凭据（打印即授权）、LAN 部署当前不受支持、白名单不等于安全边界；无需对象化——监测条件：DSH 升级到支持 LAN 或改动认证协议时回读本对象 F2/F3/F9 复核。判断依据：F2/F5/F9。
A5 LDVH 前端组件的数据获取按 scope 声明取用 useXxx 钩子，不自行订阅宿主服务；验收条件：组件层无直接 host.call 取渲染数据的调用。判断依据：F4/F14。可被 10 号规范修订承接。

## 后续分流

- A1/A2 → 10 号规范与 LDVH Web 挂载实现 WorkCase；信号：cognition 端点与前端面板进入实现阶段时。
- A3/A5 → 插件前端工程模板与 10 号规范修订；信号：插件前端脚手架搭建时。
- A4 → 08 号规范安全边界声明；信号：规范下次修订或 Human 复核安全假设时。
- 本对象与 R1（e7599c11）构成宿主接入的完整依据对：R1 给能力全景与索引级结论，本对象给 Web 端接入方法与边界；两者相互引用不互相复制。
- 无需为「Web 接入面」再建对象——本 Research 即承载；监测条件：DSH 版本实质变化（0.1.5 转正、/api 契约或 slot 目录变更）足以改变结论时，新建对象并按 superseded 处置本对象。
