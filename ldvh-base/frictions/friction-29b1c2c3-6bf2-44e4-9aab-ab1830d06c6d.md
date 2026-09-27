---
title: 子进程回收后呈现不自愈
status: open
phenomenon: plugin/web/api 目录被写入触发源码热刷新回收子进程后，宿主 /ldvh/api/health 仍返回 ok:true 与 webPort，客户端据此判定就绪并指向已死端口，LDVH 面板白屏且不自愈。
attribution: plugin/lib/index.js:157-162 的 health 短路应答与 plugin/lib/client.js:375-382/388-400 的就绪判据共同构成判据错位：宿主 health 回答「宿主侧 Web 路由与配置是否在」（与子进程解耦的静态应答），客户端把它当作「端到端可服务」；唯一的子进程活性检测（web-mount.js:332 代理路径内的 ensureReady）不被就绪探测覆盖；而回收子进程的 web-mount.js:200-208 源码热刷新是常规开发行为。
impact: medium
serves: SG-3
object_uid: 29b1c2c3-6bf2-44e4-9aab-ab1830d06c6d
fact_type_key: friction
created_at: 2026-09-27T05:22:01.110Z
change_log:
  - at: 2026-09-27T05:22:01.110Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Friction 对象
---

# 子进程回收后呈现不自愈

## 现象

plugin/web/api 目录被写入触发源码热刷新回收子进程后，宿主 /ldvh/api/health 仍返回 ok:true 与 webPort，客户端据此判定就绪并指向已死端口，LDVH 面板白屏且不自愈。

具体链路（三处实现事实，均已实读核实）：

1. **宿主 health 分支直接应答，不触子进程**：`plugin/lib/index.js:157-162` 中 `/health` 与 `/health/` 在 `apiHandler` 内被**短路**——直接 `json(res, 200, { ok: true, service: "dsh-ldvh", status: "ok", prefix: API_PREFIX, webPort: WEB_API_PORT })` 后 `return`。第 165-167 行的 `webApiProxy` 调用是**后续语句**，故 health 请求永不会抵达代理。
2. **唯一的子进程重拉入口在代理路径**：`plugin/lib/web-mount.js:332` 的 `createProxyHandler` 内 `await manager.ensureReady()` 是重拉时机（`web-mount.js:169` 注释：「意外退出后下次 ensureReady 重拉」）。health 既不经过它，就**不构成重拉触发**。
3. **子进程回收是常规事件，不是异常**：`web-mount.js:200-208` 以 `fs.watch(join(webRoot, "api"), { recursive: true })` 监听 `web/api` 目录，源码一变即在 1s 去抖后 `SIGTERM`（3s 后补 `SIGKILL`）杀掉子进程，日志记 `source change detected, recycling child for next request`。该目录下的任何写入（编辑源码、跑测试、构建）都会触发——**是设计行为，不是故障**。

**实测证据（2026-09-27）**：`plugin/web/api/app.ts` 于 11:29 因修复 `app.handle` 类型错误被写入 → 子进程被回收。13:04 实测：`lsof -nP -iTCP:3299 -sTCP:LISTEN` **无监听**（子进程已死）；宿主 `/ldvh/api/health` 仍返回 `200 {"ok":true,...,"webPort":3299}`；客户端 iframe 指向 `http://127.0.0.1:3299/ldvh/`（`plugin/lib/client.js:968-971` 的 `LDVH_WEB_PORT_DEFAULT = 3299` 与 `ldvhWebOrigin`），该地址无响应 → iframe 内 `#root` 长度为 **0**，LDVH 面板全白。对照：对**真实数据端点** `http://127.0.0.1:59896/ldvh/api/objects/workcase` 发起一次请求后，代理路径的 `ensureReady()` 被触发，子进程立即被重拉（新 pid 96675 监听 3299），随后直连 `/ldvh/`、`/ldvh/api/health`、`/ldvh/assets/index-*.js` 均 200，iframe 场景实测 `#root` 长度 **616,383**、零 pageerror。

**客户端判据同样只看 health**：`plugin/lib/client.js:375-382` 的 `checkHealth` 明写其语义为「the view is "ready" only when /ldvh/api/health answers」，并以 `body.ok === true` 作为就绪判据、从中取 `webPort` 拼 iframe 地址；`client.js:388-400` 的 `probeWeb`（设置卡的状态探测）同样以 `/ldvh/api/health` 的 `ok` 作 `api` 项。两个探测**都无子进程活性判据**——health 是假阳性，探测不出真实故障。

**本现象的可复现性**：只要有人改 `plugin/web/api/` 下的文件（改源码、跑会写入该目录的工具链、重建产物等），子进程即被回收；此后客户端在**下一次真实 API 调用发生之前**一直显示「就绪」并指向死端口。这不是偶发——它与「改该目录的代码」这一常规开发动作一一对应。

## 入账依据

三条件逐项核对：

**重复出现**——本机制对每一次 `plugin/web/api/` 目录的写入都成立，不是单次卡顿。本轮已实际触发**两次**：2026-09-27 上午修 `app.handle`（11:29 写入 `app.ts`）与随后多次构建/测试，均使子进程处于「已回收待重拉」态；其中一次被用户以「ldvh 又看不了了」报告。第二次（13:04 复核时）经实测复现：无监听 + health 200 + iframe 白屏三者并存。**触发条件（该目录被写入）是常规开发动作**，故重复性由设计决定，不依赖巧合。

**可归因**——归因到 `plugin/lib/index.js` 的 health 短路与 `plugin/lib/client.js` 的就绪判据共同构成的一处**判据错位**：宿主 health 回答的是「**宿主侧的 Web 路由与配置是否在**」（它本就与子进程解耦，逻辑上是一条无副作用的静态应答），而客户端把它当作「**端到端是否可服务**」的判据。二者之间缺一个「子进程是否活着」的环节。而唯一的活性检测（`ensureReady`）被放在代理路径上——**只有真实请求才会走到，而客户端在「就绪」判断阶段不会发出真实请求**。于是形成一个自锁：客户端等 health 说就绪 → health 永不说「子进程死了」→ 客户端永不发真实请求 → 重拉永不触发。`web-mount.js:169` 注释所声明的「意外退出后下次 ensureReady 重拉」在**代理路径上成立**，但该路径不被就绪探测覆盖。

**修了会更好**——若 health（或客户端的就绪判据）能反映子进程的真实活性，则子进程被回收后的首次探测即可触发重拉或如实降级（显示「Web 服务未就绪·重试」而非白屏），用户无需手动访问一个真实端点来唤醒。**本账目不预设修复形态**（health 内联 `ensureReady()` 探测、客户端改探真实端点、或在 `/ldvh/` 静态托管路径加活性校验均属候选），仅登记该判据错位。

**未决事项与转化条件**（登记于此，非处置承诺）——修复形态与层级（宿主 `index.js` 的 health 语义 / 客户端 `client.js` 的就绪判据 / `web-mount.js` 的重拉入口）须经 Human 定案，本账目不自行选定。另需注意一处**边界**：health 被设计为不触子进程或有其理由——它是**冷启动前的唯一稳定应答**（客户端靠它取得 `webPort` 才能拼出 iframe 地址；若让 health 依赖子进程，则子进程未起时客户端可能连端口都拿不到，反而失去重拉契机）。故任何修复都必须在「暴露真实活性」与「保持端口发现可用」之间取得兼顾，不得只把 health 改成依赖子进程而不处理端口发现。该权衡属 Human 决定范围。

**与既有账目的区别**（`26 §6.2` 查重结论）——对照当前账本 3 笔：`bf73fad4`（open 工单无法写入结果节，工单 writer 领域）、`bdbab9ab`（serves 归属缺少反查复核，归属校验领域）、`3048937d`（事实对象载体内聚校验后置，校验次序领域，已 deferred）。本条的现象（子进程回收后呈现层不自愈）、归因对象（`index.js` health 短路 × `client.js` 就绪判据）、影响面（Web 面板可用性，非事实源完整性）与三者均不同，**判无重复**。

**本账目与一次「同症状不同根因」的区分（如实登记，防止后续误并）**——2026-09-27 更早一次「LDVH 显示不了」的根因是**前端代码缺陷**（`plugin/web/src/i18n/context.tsx` 的 `localStorage` 无 `try/catch`，沙箱 iframe 下抛 `SecurityError` 致 React 树挂载失败），已由提交 `3cfa4fe` 修复。**本账目记载的是另一个根因**（运行时状态：子进程被回收后不自愈），二者症状同为「面板白屏」但机制无关。后续若再遇白屏，须先区分二者：前者在独立标签页与原面板**同时**失败；本条目在独立标签页正常（子进程重拉后）而**内嵌 iframe** 失败。
