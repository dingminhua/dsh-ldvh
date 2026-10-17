---
title: DSH 0.2.1-rc.1→0.2.1-rc.2 变更调研（零契约破坏）
status: active
research_question: DSH 从 0.2.1-rc.1 到 0.2.1-rc.2 有哪些变更，其中哪些需要 dsh-ldvh 适配宿主对接或调整 LDVH 消费面的契约假设？
research_purpose: 为 dsh-ldvh 提供从 0.2.1-rc.1 到 0.2.1-rc.2 的升级判断依据：运行中宿主已实际跃迁到该版本（本机 DeepSeek Harness.app 内核 0.2.1-rc.2，进程 2026-10-17T21:18:06+08:00 启动），需判定是否需要代码适配、兼容声明是否仍覆盖、以及上一轮登记的两处未适配破坏在本区间的状态。
stopping_reason: sufficient
confirmed_statements:
  - F1 区间规模 456 files +4,921/−845，非文档部分集中在 DeepSeek Search/Fetch 与一处模型标签徽标
  - F2 契约三表零变化：`SERVICE_API` 1233 条、`EVENT_API` 82 条、`TYPE_API` 1053 条，增删改全部为 0
  - F3 服务 `subagents` 保留 `startActivation`，rc.1 的两处破坏在本区间既未被修复、也未被加重
  - F4 包集合 349→351（+2/−0）：`dsh-web-deepseek-api` 与 `dsh-client-ui-deepseek-model-label-1017`
  - F5 零包丢失、零 peer/engines 收窄：342 个包内容变化中 338 个是纯版本行，4 个是 bundle 依赖追加与两个新包
  - F6 `web` seam 的 provider 选择配置改为可运行时抑制（`Volatile`），`SERVICE_API` 不变但语义变了
  - F7 持久化格式仍 v4、schema `formatVersion` 仍 2、`roots` 65→65，唯一 digest 变化落在 LDVH 不读的事件上
  - F8 客户端槽位目录 89 条公共槽位中仅 1 条元数据变更，注册契约零变化
  - F9 两份 bundle 补丁皆是纯新增行，无删除行，默认可用性未翻转
  - F10 零份新升级指南；与 LDVH 相关度最高的两份中，一份已处置、另一份仍是未销缺口
  - F11 宿主已实际跃迁到 0.2.1-rc.2，LDVH 在该基座上测试套件 1581 项全通过，两条路由 HTTP 200
  - F12 两份适配改动在 rc.2 上已完成端到端验证，其中一份已提交、一份待提交
uncertain:
  - issue: 真实 UI 验收六项中四项仍未核对
    reason: 本轮仅实证 `/ldvh` 与 `/ldvh/api/health` 两项 HTTP 200；设置卡片、LDVH 会话视图、停用与重启、卸载清理四项自上一轮起未变，本区间无相关变更，故仍未核对。
  - issue: "`invariants` 静默失效未获得替代通道"
    reason: "运行宿主 asar 内仍零 invariant 包，`host-seams.js` 仍走 `consumed: false` 降级分支；本区间未引入任何替代断言通道。"
  - issue: 本区间提交计数未独立取得
    reason: 本地为深度 1 的浅克隆，父子关系不完整；本对象不引用任何提交计数，只用文件级差分量。
  - issue: 全部 456 个变更文件未逐字审阅
    reason: 覆盖策略为集合级机械比对加消费点定向核对；残余风险在 `ui-settings-web-search` 控制器与 `web-deepseek-api` 传输层，二者均在 LDVH 消费面外。
  - issue: 闲时辅助在 rc.2 当前进程上的端到端实跑未取得
    reason: "F12 引用的 `stage: partial` 记录早于当前进程启动；当前进程尚无一次完整的闲时检查点成功记录。"
gaps:
  - description: 真实 UI 验收四项跨两轮未执行（设置卡片、LDVH 会话视图、停用与重启、卸载清理）；是当前唯一阻塞「已验证支持」声明的缺口
    priority: medium
  - description: "`invariants` 静默失效未处置：须 Human 裁决「补通道」或「降级并在规范写明理由」"
    priority: medium
  - description: 仓库根目录仍无 CHANGELOG，变更语义须由 Release 说明与升级指南反推
    priority: low
implications:
  - finding_ref: F2 契约三表零变化：`SERVICE_API` 1233 条、`EVENT_API` 82 条、`TYPE_API` 1053 条，增删改全部为 0
    implication: 「每轮都必须重新核对服务集合的删除方向」在本区间给出零结果；零删除是零破坏的必要条件，但不充分——F6 证明语义变化可以完全不在三表里。
  - finding_ref: F5 零包丢失、零 peer/engines 收窄：342 个包内容变化中 338 个是纯版本行，4 个是 bundle 依赖追加与两个新包
    implication: 候选版内的版本号整体推进会把「342 个包变了」误读为「依赖面广泛变更」；必须剥掉版本行再比 peer/engines 才能得出「零收窄」。
  - finding_ref: F6 `web` seam 的 provider 选择配置改为可运行时抑制（`Volatile`），`SERVICE_API` 不变但语义变了
    implication: 签名不变不等于行为不变；契约三表是必要条件而非充分条件，配置生命周期类变更须另看源文件差分。
  - finding_ref: F11 宿主已实际跃迁到 0.2.1-rc.2，LDVH 在该基座上测试套件 1581 项全通过，两条路由 HTTP 200
    implication: 「测试全绿 + 路由 200」只证明代码与宿主内核能协同工作，不进宿主的闲时调度；功能完好性不能由测试套件替代。
  - finding_ref: F12 两份适配改动在 rc.2 上已完成端到端验证，其中一份已提交、一份待提交
    implication: 「本区间无需适配」与「本仓库无待办」是两件事：前者是上游结论，后者要看本地工作区，二者不能相互替代。
urls:
  - ref: https://github.com/deepseek-ai/deepseek-harness
    title: deepseek-ai/deepseek-harness（DSH 内核源码仓）
    summary: 内核侧发现的对照源：两 tag（dsh-v0.2.1-rc.1 = 1600d8a1e140dcde43a1a0941940a0480712c011、dsh-v0.2.1-rc.2 = 687f282e8625c6b8d11ff58211a90524be2e4317）只读差分，覆盖契约三表、槽位目录、包集合、peer/engines 声明、持久化 schema、bundle 补丁与升级指南目录。限制：仓库根无 CHANGELOG；静态差分只证明发布内容，不证明运行时装了什么
  - ref: https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2
    title: DSH v0.2.1-rc.2 官方发布说明
    summary: "本区间产品面变更的权威清单：中英各一节，prerelease: true、published_at 2026-10-17T08:16:33Z，新增功能仅两项。限制：面向用户措辞，不含 API 契约细节"
  - ref: https://registry.npmjs.org/@deepseek-ai/dsh
    title: "@deepseek-ai/dsh（npm registry 元数据）"
    summary: 版本通道事实：dist-tags 为 latest = 0.2.0-rc.2、next = 0.2.1-rc.2、alpha = 0.2.1-alpha.5。限制：只给版本号与标签，不能说明本机运行宿主的版本
  - ref: https://github.com/dingminhua/dsh-ldvh
    title: dsh-ldvh（受辖项目仓）
    summary: 消费面核对的发生地：plugin/package.json 的 peerDependencies 与 engines；派发调用点；pre_reviews 字段契约登记；npm test 输出 1581 项。限制：本机运行宿主的进程、端口与内核版本实证为本地观察，不由该 URL 承载
object_uid: f654b2b5-dac2-46d4-82c0-a97fc3e5a37e
fact_type_key: research
created_at: 2026-10-17T14:05:29.223Z
change_log:
  - at: 2026-10-17T14:05:29.223Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Research 对象
---

## 研究问题

DSH 从 0.2.1-rc.1 到 0.2.1-rc.2 有哪些变更，其中哪些需要 dsh-ldvh 适配宿主对接或调整 LDVH 消费面的契约假设？

本轮调研的对象是 DSH 内核仓 `deepseek-ai/deepseek-harness` 从 tag `dsh-v0.2.1-rc.1`（`1600d8a1e1`）到 tag `dsh-v0.2.1-rc.2`（`687f282e86`）的发布差量。选此区间的直接背景是**运行中宿主再次实际跃迁**：本机 `/Applications/DeepSeek Harness.app` 现为 `CFBundleShortVersionString` `0.2.1-rc.2`（进程 2026-10-17T21:18:06+08:00 启动），插件仍经 profile 的 `link:` 指向本仓库。

上一轮调研（`research-21ea3e9f`）的结论是**两处真实契约破坏**：`invariants` 服务被整体移除（静默失效）、`subagents.start` 被 `startActivation` 取代（硬失败）。那轮之后本仓库已落地适配（`3f4e78a`），本轮要回答两件事：**新区间是否又带来破坏**，以及**那处适配在 rc.2 上是否真的完好**。

## 输入与边界

- **DSH 内核源码仓**承担全部内核侧发现：两 tag 的只读差分，覆盖契约三表、客户端槽位目录、包集合、peer/engines 声明、持久化 schema、bundle 补丁与升级指南目录。
- **官方发布说明**承担产品面变更的权威骨架。
- **npm registry** 承担版本通道事实（`dist-tags`、各版本发布时间）。
- **受辖项目仓与运行时**承担消费面核对：`plugin/package.json` 的声明、派发调用点、以及本机运行宿主的实测。

方法为静态差分与集合级机械比对。**方法教训（本轮新踩）**：asar 的 `offset` 字段不含 pickle 头部，真正的数据起始点比 `16 + headerSize` 再少 8 字节；第一版脚本 755 个节点全错位、解析 0 个包而**不报错**——若只看「解析数」而不校验 digest 或抽样内容，会把「全错位」读成「没有这些包」。本轮改为只取包根目录的 `package.json` 节点，得到可复现的 530/550 解码数与 305 个 `@deepseek-ai` 包。

不覆盖：未做完备的真实 UI 验收；未逐字审阅全部 456 个变更文件；本区间提交计数未独立取得，故不引用任何提交计数。

## 关键发现

### F1 区间规模 456 files +4,921/−845，非文档部分集中在 DeepSeek Search/Fetch 与一处模型标签徽标

非文档、非测试、非 `package.json` 版本行的实质改动几乎全部落在两处新功能——`packages/web/web-deepseek-api/`（新增包）与 `packages/client/ui-deepseek-model-label-1017/`（新增客户端包），外加 `ui-settings-web-search` 的控制器改造（+206/−49）与 `web/src/index.ts` 的配置抑制化。

与前两轮的量级对照：`0.2.0-rc.2`→`0.2.1-rc.1` 是 8361 files（上一轮口径），本区间是四百余文件的量级——**候选版内的小步发布**。

对 LDVH 的意义：本区间的变更面窄到可以逐处点名，不像上一轮那样必须靠集合级机械比对去覆盖未知。

溯源：https://github.com/deepseek-ai/deepseek-harness（两 tag 的 `git diff --shortstat` 得 456 files +4,921/−845；`git diff --numstat` 按目录与路径过滤后逐项核对）

### F2 契约三表零变化：`SERVICE_API` 1233 条、`EVENT_API` 82 条、`TYPE_API` 1053 条，增删改全部为 0

以括号深度解析器抽取三张生成式契约目录的条目集合，逐条比对：`SERVICE_API` 1233→1233、`EVENT_API` 82→82、`TYPE_API` 1053→1053，**新增 0 / 删除 0 / 变化 0**。

**与前一轮形成鲜明对照**：上一轮三表首次出现净删除（服务 −1、类型 −9），本轮一条都没有动；`api-catalog.ts` 两 tag 均 8974 行。

对 LDVH 的意义：契约面的破坏风险在本区间为**零**。但注意**零删除不等于零行为变化**——F6 的配置语义变化不在三表里，三表只描述签名，不描述语义。

溯源：https://github.com/deepseek-ai/deepseek-harness（`packages/extensions/tool-cordis/src/api-catalog.ts` 两 tag 的三段常量：括号深度解析后按 key/name 建集合，逐条比对签名归一化文本）

### F3 服务 `subagents` 保留 `startActivation`，rc.1 的两处破坏在本区间既未被修复、也未被加重

- **`subagents`**：`SERVICE_API` 无变化，`startActivation` 两条重载仍在。本仓库已落地的适配（`friction-discovery-provider.js` 改调 `startActivation` 并传 `delivery: 'caller'`）本区间继续有效。
- **`invariants`**：仍不在 `SERVICE_API` 内；运行宿主 asar 内 305 个 `@deepseek-ai` 包中**仍零个含 `invariant`**。上一轮登记的「静默失效」原样保留，无任何替代通道被引入。

对 LDVH 的意义：两处破坏的状态是「一处已适配且仍成立、一处未适配且仍静默」——本轮不是「又一波破坏」，而是「上一轮的欠账没有新增，也没有被偿还」。

溯源：https://github.com/deepseek-ai/deepseek-harness（api-catalog.ts 两 tag 的 `subagents` 条目签名逐字相等；`invariants` 键在 rc.2 的 `SERVICE_API` 中不存在；本机 asar 的 `@deepseek-ai` 下 305 个包名中 `invariant` 命中数为 0）

### F4 包集合 349→351（+2/−0）：`dsh-web-deepseek-api` 与 `dsh-client-ui-deepseek-model-label-1017`

`packages/**/package.json` 的 `name` 集合 **349→351**，新增 2、**删除 0**：`dsh-web-deepseek-api`（DeepSeek Search/Fetch API 提供方，注册到既有 `ctx.web` seam）与 `dsh-client-ui-deepseek-model-label-1017`（DeepSeek-V4.1-Flash-1017 的临时发布徽标）。

对 LDVH 的意义：**零删除**意味着不会有任何既有依赖因包消失而失效；两个新增包都不在 LDVH 消费路径上（一个 web 搜索提供方、一个模型名徽标），不需要任何适配。

溯源：https://github.com/deepseek-ai/deepseek-harness（`packages/**/package.json` 的 name 集合两 tag 求差得 +2/−0；两新包 `package.json` 逐字读取）

### F5 零包丢失、零 peer/engines 收窄：342 个包内容变化中 338 个是纯版本行，4 个是 bundle 依赖追加与两个新包

把 351 个 `package.json` 节点逐个比对，**342 个内容变化**。剥掉版本行后重比：**338 个是纯版本号**（`0.2.1-rc.1`→`0.2.1-rc.2`），`peerDependencies` 与 `engines` 逐字段比对**零差异**；4 个有实质变化（两个 bundle 的 dependencies 追加，加两个新包各自的新声明）。新包带来的 peer 声明**只加重不删减**。

对 LDVH 的意义：**LDVH 的四条 peer 声明（三条 `>=0.1.7-rc.1 <0.3.0` 加 `schemastery ^3.18.4`）不受任何上游改动影响**；`schemastery` 在本机实测 `3.18.5`，仍落在 `^3.18.4` 内。

溯源：https://github.com/deepseek-ai/deepseek-harness（351 个 `package.json` 节点逐个 `git show` 后剥版本行比对得 342 变化 / 338 纯版本；`peerDependencies` / `engines` / `peerDependenciesMeta` 三字段集合求差；本机 asar 解码得 `@deepseek-ai/schemastery` 3.18.5）

### F6 `web` seam 的 provider 选择配置改为可运行时抑制（`Volatile`），`SERVICE_API` 不变但语义变了

`packages/web/web/src/index.ts` 把 `WebRuntimeConfig.searchProvider` / `fetchProvider` 由普通 `string | undefined` 改为 `Volatile<string | undefined>`，`Service.Config` 改为 `z.string().volatile()`，每次 `search()` / `fetch()` 读当前值——「设置变更对下一次搜索生效，无需重挂服务」。

对 LDVH 的意义：**这是本区间唯一一处「三表看不出来」的行为变化**。`SERVICE_API` 里 `web` 条目的方法签名没变，但配置读取语义从「构造时快照」变为「调用时读取」。LDVH 不消费 `ctx.web`、不配置 web provider、也不注册搜索提供方，故**不击中消费面**。登记在此是为说明 F2 的边界：三表描述签名，不描述配置生命周期。

溯源：https://github.com/deepseek-ai/deepseek-harness（`packages/web/web/src/index.ts` 两 tag 差分：`Volatile` 导入、Config 改 `.volatile()`、构造函数改持有 config、`search`/`fetch` 内改 `this.config.*.get()`）

### F7 持久化格式仍 v4、schema `formatVersion` 仍 2、`roots` 65→65，唯一 digest 变化落在 LDVH 不读的事件上

`SESSION_FORMAT_VERSION` 两 tag **均为 `4`**；持久化 schema `formatVersion` **2→2**、`roots` **65→65**（增 0、删 0）、`types` 612→614；**1 个 root 的 digest 变化**：`event:web/deepseek-search-llm-request`（因新增 `thinking` 字段）；新增持久化变更记录 1 份。

对 LDVH 的意义：会话格式未变、root 集合未变，作为会话消费者**无需迁移**。唯一 digest 变化的事件**不在 LDVH 消费的十个事件内**（`agent/created`、`agent/pre-step`、`agent/status`、`agent/turn-stopping`、`fs/edit-intent`、`fs/observed`、`fs/write-intent`、`session/event`、`subagent/end`、`system-prompt/assemble`）。

溯源：https://github.com/deepseek-ai/deepseek-harness（`packages/core/session/src/types.ts:90` 的 `SESSION_FORMAT_VERSION` 两 tag 均为 4；DSH 仓持久化 schema 清单（`persistence-schema.json`）两 tag 的 `formatVersion`、`roots` 集合与逐 root digest、`types` 计数）

### F8 客户端槽位目录 89 条公共槽位中仅 1 条元数据变更，注册契约零变化

`slot-catalog.ts` 差异只有 4 加 2 减，全部落在 **`conversation.input.model.label`**：`occupants` 由空数组变为含 `client-ui-deepseek-model-label-1017 DeepSeekModelLabel`，`replaceRisk` 由 `none` 变为 `shadows-shipped-ui`。**`registerOptions`（第三方注册契约）零变化**。

对 LDVH 的意义：LDVH 注册的槽位是 `conversation.chat.node`（`ldvh-notice`）与 `conversation.view`，均不在本次变更条目内。**客户端注册面安全**。

溯源：https://github.com/deepseek-ai/deepseek-harness（`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` 两 tag 差分仅上述两字段；`registerOptions` 未出现在 diff 中；LDVH 注册点见 `plugin/lib/client.js`）

### F9 两份 bundle 补丁皆是纯新增行，无删除行，默认可用性未翻转

`packages/bundle/base/cordis.patch.yml` **追加** `web-deepseek-api` 一行（含 `apiKeyEnv: DEEPSEEK_API_KEY`）并扩写一条注释；`packages/bundle/web-app/cordis.patch.yml` **追加** `ui-deepseek-model-label-1017` 一行。两份均无删除。

对 LDVH 的意义：上一轮「bundle 补丁有实质改动 → 默认可用性可能翻转」的担忧在本区间**不成立**——两份补丁只有 `+` 行，LDVH 依赖的默认装配面未被改动。

溯源：https://github.com/deepseek-ai/deepseek-harness（两份 `cordis.patch.yml` 两 tag 差分，过滤 `^[-+]` 行后仅见 `+` 行）

### F10 零份新升级指南；与 LDVH 相关度最高的两份中，一份已处置、另一份仍是未销缺口

本区间 DSH 仓的升级指南目录下**新增 0 份**指南、修改 0 份。上一轮点名的两份：`subagent-activations` **已由本仓库适配**（`3f4e78a`）；`remove-runtime-invariants` **仍未处置**——上一轮报告记载该项承载的是「08 §6 第 6 项」的「管辖注册载体满足 v5 schema」运行时断言，该断言在 rc.2 上仍不执行。

发布说明的两项用户面变更（适配 DeepSeek-V4.1-Flash-1017；适配 DeepSeek Search 与 Fetch API）分别对应 F4 的两个新包与 F6 的配置抑制化，**均不击中 LDVH**。

对 LDVH 的意义：本区间的适配范围是**空集**。

溯源：https://github.com/deepseek-ai/deepseek-harness（DSH 仓的升级指南目录两 tag `git diff --name-status` 为零行）

### F11 宿主已实际跃迁到 0.2.1-rc.2，LDVH 在该基座上测试套件 1581 项全通过，两条路由 HTTP 200

按红线 7 取四项实证：① 进程——`DeepSeek Harness.app` 运行中，PID 32784 启动于 **2026-10-17T21:18:06+08:00**；② 端口——GUI `55414` 与插件 web api `3299` 持有者均为该 app；③ 运行产物内核版本——`CFBundleShortVersionString` 为 **`0.2.1-rc.2`**，asar 内 `@deepseek-ai` 下实测 **305 个包**，其中 296 个为 `0.2.1-rc.2`；④ profile 安装形态——仍为 `link:` 指向本仓库 `plugin/`。

运行时实证：`/ldvh` 返回 **HTTP 200**，`/ldvh/api/health` 返回 `{"ok":true,"service":"dsh-ldvh",...,"webPort":3299}`；**测试套件在该宿主的 Node v25.9.0 上 1581 项（1580 pass / 0 fail / 1 skip）全部通过**。以 `includePrerelease: true` 语义求值，`0.2.1-rc.2` 对 `>=0.1.7-rc.1 <0.3.0` **匹配**，兼容声明**仍覆盖**。

**但「能加载 + 测试全绿」不等于「功能完好」**：测试跑的是本仓库的桩与真实模块，不进宿主的闲时调度；F3 的两处破坏状态仍如所述。

溯源：https://github.com/dingminhua/dsh-ldvh（`plugin/package.json` 的 peer 声明；`npm test` 输出；本机四项实证为 `CFBundleShortVersionString` 0.2.1-rc.2、asar 内 305 个包与版本分布、`ps` 显示 PID 32784 启动时刻、`lsof` 显示 55414 与 3299 持有者、profile 的 link 指向）

### F12 两份适配改动在 rc.2 上已完成端到端验证，其中一份已提交、一份待提交

1. **闲时辅助适配 `startActivation`**（`3f4e78a`，已提交）——派发路径。旁证：`idle-checkpoint-runs.json` 末条记录（`2026-10-17T11:15:49Z`）为 `stage: partial`、`friction-discovery` 任务 `outcome: landed`、水位推进到 15——**不再是 `stopped`、`per_task` 有产出**。
2. **`pre_reviews` 字段契约登记**（未提交）——`factFieldContract.ts` 补登记 21 §8 的建前审核轴字段，配合两个测试文件，已随 `npm test` 全绿。

对 LDVH 的意义：这两项不是本区间**要求**的适配（本区间适配范围为空集，F10），而是**上一轮欠账的偿还**。它们的存在说明「本区间无需适配」与「本仓库无待办」是两回事。

溯源：https://github.com/dingminhua/dsh-ldvh（`plugin/lib/friction-discovery-provider.js` 的 `startActivation` 调用点；`plugin/web/api/services/factFieldContract.ts` 的 `pre_reviews` 登记；`git status` 的未提交改动；本机 `~/.dsh/ldvh/idle-checkpoint-runs.json` 末条记录）

## 未证实与缺口

**未证实 1：真实 UI 验收六项中四项仍未核对。** `/ldvh` 与 `/ldvh/api/health` 两项已实证，设置卡片、LDVH 会话视图、停用与重启、卸载清理四项未核对。本区间无相关变更，但这不能替代实测。**与上一轮同源、至今未消，是「已验证支持」声明的唯一前提。**

**未证实 2：`invariants` 静默失效未获得替代通道。** 运行宿主 asar 内仍零 invariant 包，`host-seams.js` 仍走 `consumed: false` 降级分支；本区间未引入任何替代断言通道。该断言失效后「管辖注册载体不满足 v5 schema」是否被其它通道拦住，仍未实测。

**未证实 3：本区间的提交计数未独立取得。** 本地为深度 1 的浅克隆，父子关系不完整。故本对象不引用任何提交计数，只用文件级差分量。上一轮报告里的「1916 commits」是 `0.2.0-rc.2`→`0.2.1-rc.1` 的计数，不可挪用为 rc.1 自身的量级。

**未证实 4：全部 456 个变更文件未逐字审阅。** 覆盖策略为集合级机械比对加消费点定向核对；残余风险在 `ui-settings-web-search` 控制器与 `web-deepseek-api` 传输层，二者都在 LDVH 消费面外。

**未证实 5：闲时辅助在 rc.2 当前进程上的端到端实跑未取得。** F12 引用的 `stage: partial` 记录早于当前进程启动，是在另一个进程里取得的；当前进程尚无一次完整的闲时检查点成功记录。故「已适配的 `startActivation` 在 rc.2 上完好」由测试套件与契约保持支撑，不由本进程的实跑支撑。

**缺口 1（medium）：四项真实 UI 验收跨两轮未执行。** 是当前唯一阻塞「已验证支持」声明的缺口。

**缺口 2（medium）：`invariants` 静默失效未处置。** 须 Human 裁决「补通道 / 降级并在规范写明理由」。

**缺口 3（low）：仓库根目录仍无 CHANGELOG。** 变更语义须由 Release 说明与升级指南反推。

## 建议

1. **兼容声明无需改动，亦无需为本区间做任何代码适配。** 依据 F2、F5、F10。此条**不构成「已验证支持 0.2.1-rc.2」**——该声明仍需建议 4 的验收完成。

2. **支持基线登记值推进到 `0.2.1-rc.2`——须经 Human 决定。** 目标对象类型：规范受控更新（`local-dev-workflow` 的 Norm `a1b559a6`）。预期目标：使登记值与运行中宿主的实测版本一致（现登记 `0.2.0-rc.2`，实测 `0.2.1-rc.2`——**相差两个 rc**）。验收条件：Norm、README 双版与 CHANGELOG 三处一致推进，并**如实登记两处欠账**，不得因基线推进而暗示功能完好。创建/更新判断：`local-dev-workflow` 明载该值为 Human 制定，AI 不得自行改写。

3. **把 `invariants` 的处理提请 Human 裁决——须经 Human 决定。** 目标对象类型：WorkCase 或规范受控更新。预期目标：让「管辖注册载体满足 v5 schema」的断言在 0.2.1 线上仍被执行，或在规范中明确降级为「按需校验」。验收条件：二选一有据可查；若不补通道，则必须让该 seam 的「不可用」状态对 Human 可见，而非静默。

4. **补齐真实 UI 验收四项（承两轮同源缺口）。** 目标对象类型：WorkCase。预期目标：把 F11 的两项路由实证扩展为六项全数通过。验收条件：四项在运行宿主上逐项实操并记录。创建/更新判断：该缺口已跨两轮未消。

5. **`research-21ea3e9f` 的建议 1（subagents 适配）已由 `3f4e78a` 履行，并在 rc.2 上仍成立。** 不新增对象。

## 后续分流

- **建议 1 本身不对象化**：它是本对象的证据结论，由 F2、F5、F10 承载；跨越下一个 DSH 区间时须重新取证。
- **建议 2 → 规范受控更新。** 信号：Human 就「基线是否推进到 `0.2.1-rc.2`」给出答复时启动；答复前，相关判断不引用 `0.2.1-rc.2` 为已验证环境。
- **建议 3 → WorkCase 或规范受控更新。** 信号：Human 就「补通道 / 降级」给出答复时启动；在此之前，该 seam 的不可用状态须对 Human 可见。
- **建议 4 → WorkCase。** 信号：Human 或主控启动下一轮验证时创建。跨两轮未消。
- **建议 5 → 回填 `research-21ea3e9f` 的「后续分流」。** 信号：下一轮修订该对象时，把其「建议 1」的待决状态改为「已履行」；本对象不改写既有研究对象的结论。
- **本对象自身回查条件**：上游发布非预发布 `0.2.1`、运行宿主升级到 `0.2.2` 线、或 `invariants` 裁决落地时，须按 `24 §12` 做来源展开复核；在此之前其结论作为该区间的当前调研入口。
