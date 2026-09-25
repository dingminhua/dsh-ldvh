# DSH 0.1.5-rc.2 → 0.1.7-rc.1 升级调研报告

> **对比对象**：`@deepseek-ai/dsh` `0.1.5-rc.2` → `0.1.7-rc.1`
> **数据源**：同级仓库 `/Users/dmh2002/DshProject/deepseek-harness`（`deepseek-ai/deepseek-harness`），git tag `dsh-v0.1.5-rc.2`（`fb2c4b9e69`，2026-09-10）与 `dsh-v0.1.7-rc.1`（`46a7f68b09`，2026-09-23）；以及**运行中宿主**（`/Applications/DSH NEXT.app`，app `dsh-desktop-next@2.0.14-next`，宿主包 `0.1.7-rc.1`）经 `cordis_inspect_*` 的只读取证
> **调研日期**：2026-09-25
> **变更规模**：区间 **3304 commits**；全仓 7872 files `+1,206,215 / −127,437`；`packages/` 4518 files `+259,252 / −95,276`；`apps/` 835 files `+65,289 / −10,600`；包数 267 → 307
> **方法**：git 双标签静态 diff（只读）+ 运行中宿主的 Inspect 服务/事件/Slot 目录取证 + 对 dsh-ldvh 自身消费点的逐条核对。分 7 条并行调研线，明细见附录 A

---

## TL;DR（先看结论）

| # | 结论 | 性质 | 对 dsh-ldvh 的影响 |
|---|---|---|---|
| 1 | **会话格式 V3 → V4**（`SESSION_FORMAT_VERSION` 3→4），新增 v3→v4 迁移包 | **破坏性持久化变更** | 新读旧可、**旧读新不可**；一旦新版本写打开过旧会话，0.1.5-rc.2 再也打不开（"影子遮蔽"），**回退是单向门** |
| 2 | **设置模型整体重建**：`SettingsProvider` → `SettingsForms`，`register()/installSection()/SettingsScope` 全部删除，`settings.yaml` 退场 | **架构级破坏** | `ctx.settings` 公开面不再有 `register`；设置必须改为「插件自己的 Config + `.volatile()`」，命名空间 = profile 条目 id |
| 3 | **客户端 `settingsScope` 服务删除**，替代品 `ctx.configForms`；`settings.plugin.item` 槽位删除 | **破坏性** | dsh-ldvh 客户端插件 `inject` 落空 → **整个 Web 面板不装载** |
| 4 | **`agent/session-start` 事件删除**（语义并入 `agent/created` 的 `source` 载荷），`agent/created` 由 `emit` 改为 **`serial`** | **破坏性** | dsh-ldvh 的两处监听静默失效（不报错、不触发） |
| 5 | **`@deepseek-ai/dsh-settings` 命名导入失效**：`installSettingsSection` / `settingsNamespace` 自 `0.1.2-alpha.2` 起已不在仓库中 | **加载期阻断** | 插件在该 peer 上解析到宿主副本 → **ESM 链接错误，dsh-ldvh 整体加载失败** |
| 6 | **隐私默认值翻转**：`session-log-deepseek.enabled` `false → true` | 行为翻转 | 默认把完整会话日志（消息正文、工具入参与结果、工作区路径）随 DeepSeek 请求上传；**须由 Human 决定是否显式关闭** |
| 7 | 新能力面：`ctx.workspaceChanges`、`ctx.pluginManager`、`ctx.hmr`、`ctx.configEditor`、`ctx.ssh`、`ctx.officeToPdf`、`ctx.ptcRuntime`、browser/computer-use | 增量 | 可直接利用（`workspaceChanges` 默认已启用，是最有价值的只读观察点） |
| 8 | **"默认是否可用"须同时看三处 patch**：`bundle/base` + `bundle/web-app`（大量 `disabled: true`）+ `bundle/web-app/presets/*.patch.yml` | 判定规则 | 只看 base 会误判（例：`workflow-ptc` 三处状态各异） |

**一句话**：0.1.7-rc.1 把"设置"从独立文档改成 **profile 配置的一等公民**、把"预设"从专用 API 改成 **普通 bundle patch**、把会话格式推进到 **v4**；对第三方宿主插件而言，**设置接入层与客户端设置面被整体替换**，而 dsh-ldvh 恰好把这两处都建在旧契约上。

---

## 0. 阅读指引与证据分级

本报告的证据分三级，正文用标记区分：

- **【运行时】**：在本机运行中的 0.1.7-rc.1 宿主上经 `cordis_inspect_list` / `cordis_inspect_query` 或 `node` 直接内省所得（最强，代表"实际装载的东西"）。
- **【源码】**：git tag 上的源码/生成物 diff（强，代表"发布内容"，但不排除运行时装配差异）。
- **【推断】**：由上述两类推导的判断，标明待验证点。

**判定口径**：`ctx.<name>` 指 Cordis `Service`（`super(ctx, '<name>')`）或 `ctx.provide()` 注册的公开服务名；事件指 `api-catalog.ts`（由 `scripts/gen-cordis-api.ts` 生成、CI 新鲜度门禁）声明的 listener 契约。

---

## 1. 版本、范围与环境基线

### 1.1 版本序列【源码】

| tag | 日期 | 说明 |
|---|---|---|
| `dsh-v0.1.5-rc.2` | 2026-09-10 | **基线** |
| `dsh-v0.1.5-rc.3` | — | 区间内 |
| `dsh-v0.1.6-alpha.1` / `.2` | — | 上一份调研（`docs/dsh-0.1.5-rc2-to-0.1.6-research.md`）的对象 |
| `dsh-v0.1.7-alpha.1` / `.2` | — | — |
| `dsh-v0.1.7-rc.1` | 2026-09-23 | **本次目标**（与已安装宿主一致） |
| `dsh-v0.1.7-rc.2` | — | 已发布；较 rc.1 另有 **346 commits / 3429 files**，`packages/session` 无格式迁移变化 |

> **版本选择提示**：已安装宿主为 `0.1.7-rc.1`，本次调研以此为对齐目标；若后续改以 rc.2 为准，需对 rc.1→rc.2 再核一遍（重点：plugin-manager 与 settings 面）。

### 1.2 本机环境基线【运行时】

- **app**：`/Applications/DSH NEXT.app`，包 `dsh-desktop-next@2.0.14-next`，其 `dependencies` 全部 `@deepseek-ai/dsh-*` 固定为 **`0.1.7-rc.1`**。
- **宿主包安装位**：`~/.dsh/profiles/node_modules/@deepseek-ai/*`（实测 `dsh-settings` = `0.1.7-rc.1`）；app 内 `node_modules/@deepseek-ai/*` 同为 0.1.7-rc.1。
- **profile 分布**：`desktop`（**未装 dsh-ldvh**，bundles = `dsh-base` / `dsh-web-app` / `dsh-bridge-next` / `dshmarket`）、`test`（**dsh-ldvh 安装于此**，`dsh-ldvh: link:/Users/dmh2002/DshProject/dsh-ldvh/plugin`）、`web`。
- **test profile 同时装载**：`dsh-better-sidebar@0.19.1`、`dshmarket@1.59.0`、`dsh-sub-cli`、`dsh-vision-router`、`dsh-free-search` 等 19 个 bundle；patch 将 `desktop-shell` 配为 `mode: compatibility` / `networkExposure: loopback`。
- **工具链**：`node` / `npm` 位于 `/opt/homebrew/bin`，当前会话 PATH 默认不含 → 验证命令需显式加 PATH。
- **命名空间提醒**：`test` profile 的 `dsh.profile.patchReload: "live"` 在新版**已无对应字段**（该配置项被删除），属遗留键。

### 1.3 运行中的宿主能力采集入口（本次调研的主要工具）【运行时】

宿主自带 **9 个 Inspect provider**，无需读源码即可枚举自身能力（`cordis_inspect_list` 返回清单，`cordis_inspect_query` 取值）：

| platform | provider | method | 作用 |
|---|---|---|---|
| host | `Service` | `listService` | 省略 `service` → 全部 `ctx.<key>` 服务 + 方法签名目录；给 `service` → 单个服务完整契约（含引用类型声明） |
| host | `Event` | `listEvents` | 省略 `event` → 全部事件 + mode + listener 签名；给 `event` → 单事件契约 |
| host | `Config` | `listConfigs` | **live 插件条目目录**（分页）+ 单条目的投影 JSON Schema |
| host | `Tool` | `listTools` | 当前 Agent 可调用的全部 Tool schema |
| client | `Service` | `listService` | 浏览器侧服务目录 / 单服务契约 |
| client | `Event` | `listEvents` | 浏览器侧事件目录 |
| client | `Builtin` | `listBuiltins` | 动态 Client 半边可用的 plain-JS 符号 |
| client | `Slots` | `listSubTree` | **live Slot 与 Factory 拓扑**（含 kind/scope/replaceRisk/键域） |
| client | `Theme` | `listTokens` | 当前主题 token 名与明暗覆盖要求 |

**这是 dsh-ldvh 后续开发应当固化使用的能力发现通道**：写插件前先查 Service/Event/Slots，而不是猜 API。本次三张能力表（§2.2 / §2.3 / §2.4）即由此生成。

---

## 2. 宿主能力地图（0.1.7-rc.1）

### 2.1 装配模型：bundle → profile patch → Loader

- 出厂有 6 个可安装 bundle：`base`、`web-app`、`headless`、`acp-app`、`sdk-app`、`sdk-minimal`（与旧版集合相同）。
- `packages/bundle/base/cordis.patch.yml` 条目 **84 → 92**；`web-app` 层用大量 `- id: X / disabled: true` 关闭 base 行，把能力**从 host 平面搬到 preset 平面**。
- **判定"某能力默认是否可用"必须同时看三处**：`bundle/base` + `bundle/web-app`（+ 其他所选 bundle）+ `bundle/web-app/presets/*.patch.yml`。典型例：`workflow-ptc` 在 base 启用、被 web-app 关掉、最终由 `standard` preset 启用、在 `ptc` preset 内又是 disabled。
- Loader YAML 方言（`insert` / 按 id 覆盖 / `group` / `disabled` / `isolate` / `!!js`）与 `applyEntryPatches` 语义**两版本逐字未变**（【源码】，线 2）。

### 2.2 宿主服务面：88 个 `ctx.*` 服务【运行时】

运行时枚举得 **88 个服务**（完整表见附录 B.1）。按领域分组（★ = 本区间新增/改名）：

| 领域 | 服务 |
|---|---|
| Agent / 会话 | `agentLoop`、`agentDefaultModel`、`agents`、`agentPresets`、`agentTeams`、`sessions`、`sessionController`、`sessionPersistence`、`sessionProjections`、`sessionProjectionCache`、`sessionQuery`、`sessionTitle`、`sessionFileReferences`、`sessionReferenceResolver`、`sessionSkillCatalog`、`sessionFeedback`、`sessionTelemetry`、`tokenMeter` |
| 工具与上下文 | `tools`、`systemPrompt`、`skills`、`planMode`、`compaction`、`toolResultPruner`、`goals`、`jobs`、`jobController`★ |
| 设置与配置 | `settings`、`settingsController`、`configEditor`★、`profileContext`★ |
| 插件 / 引导 | `pluginManager`★、`pluginRegistryProbe`、`hmr`★、`clientModules`、`invariants`、`inspector` |
| 文件 / 执行 | `fs`、`subprocess`、`shell`、`shellEnv`、`sandbox`、`sandboxPolicy`、`terminals`、`terminalController`★、`ssh`★、`ptcRuntime`★ |
| 人机交互 | `userQuestions`、`approval`、`permissionPresets`、`commands`、`messageFeedback` |
| 凭据 / 账号 | `credentials`、`credentialsController`、`authorization`、`deepseekAccount`★ |
| 网络 / 集成 | `web`、`webServer`、`connection`、`mcpResources`★、`webhookRuntime`、`deepseekLlmApiExtensions`、`llm`、`lsp` |
| 工作区 / 交付 | `workspaceRegistry`、`workspaceController`、`workspaceFiles`、`workspaceChanges`★、`storage`、`storageDomain`、`attachments`、`fileUploads`、`fileReferences`、`directoryPicker`、`directoryPickerController`、`spillStore` |
| 能力席位 / 其他 | `browserUse`★、`computerUse`★、`speechToText`★、`speechController`★、`officeToPdf`★、`workflowEngine`、`typert`、`typertGateway`、`productTelemetry`★、`timer`、`hmr` |

> 与旧版相比，README 层面的 `ctx.*` 提及新增 30+、消失 7：`ctx.codeRuntime`（→`ptcRuntime`）、`ctx.e2b`、`ctx.remote.agentTeams`、**`ctx.settings`**、**`ctx.settingsScope`**（【源码】）。注意 `ctx.settings` 服务本身**仍然存在**，只是公开面被替换（见 §3.2）。

### 2.3 事件面：77 个事件【运行时 + 源码】

新版 **77** 个已声明事件（旧版 68），mode 分布：`emit` 55 / `waterfall` 17 / `parallel` 3 / `serial` 2。完整差异表见附录 B.2。

**新增 11 个**：
`app-boot/config-reload`(emit)、`compaction/summary-error`(waterfall)、`connection/request`(waterfall)、`hmr/change`(emit)、`hmr/reload`(emit)、`permission-presets/catalog-changed`(emit)、`plugin-manager/changed`(emit)、`plugin-manager/install-log`(emit)、`plugin-manager/install-state`(emit)、`workspace/session-activity`(waterfall)、`workspace/session-stop`(parallel)

**移除 2 个**：
- **`agent/session-start`**(emit) —— 语义并入 `agent/created` 的 `source` 载荷
- **`settings/updated`**(emit) —— 设置文档事件消失，改为 `settings/document-updated`(ns, revision)

**mode 变更 1 个**：
- **`agent/created`：`emit` → `serial`**。新签名 `'agent/created'(this: Scoped<Agent>, payload: { agent: Agent; source: SessionStartSource; signal?: AbortSignal }): undefined | Promise<undefined>`，**监听器可返回 Promise 且被串行 await，失败会回滚创建事务**。`SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'`。

### 2.4 客户端面：92 个 Slot + 客户端服务【运行时】

- **Slot 共 92 个**（`single` 39 / `keyed` 18 / `list` 32 / `chain` 2 / `factory` 1），每个 Slot 带 `kind` / `scope` / `purpose` / `replaceRisk` / 键域，完整表见附录 B.3。
- 客户端服务目录（当前 realm）只有基础 9 个：`layout`、`locale`、`sessions`、`slots`、`theme`、`timer`、`uiWorkspace`、`workspaces`（+ 按 composition 装配的插件服务，如 `configForms`）。
- **对 dsh-ldvh 直接相关**：
  - `conversation.view` ✅ **仍存在**（list / session）—— 对话 Tab 投放面可用；
  - **`settings.plugin.item` ❌ 已不存在** —— 原设置面板插槽失效；
  - `plugins.item`、`plugins.bundle.config`、`plugins.row.config`、`plugins.detail.*`、`settings.section`、`settings.plugins.tab` ✅ 存在 —— 设置面新家。
- **主题 token（14 个，全部要求同时提供明/暗两套）**：`--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1`、`--dsw-alias-bg-layer-2`、`--dsw-alias-bg-overlay`、`--dsw-alias-border-l1`、`--dsw-alias-border-l2`、`--dsw-alias-brand-primary`、`--dsw-alias-label-primary`、`--dsw-alias-label-secondary`、`--dsw-alias-state-error-primary`、`--dsw-alias-state-idle-primary`、`--dsw-alias-state-success-primary`、`--dsw-alias-state-warn-primary`、`--dsw-specific-sidebar-fill`。前缀为 **`--dsw-`**（非 `--dsh-`）；客户端主题服务提供 `getTheme` / `setTheme` / `setFontSize` / `register` / `overrideTokens`。dsh-ldvh 的自建 SPA 当前不使用这些 token（自带样式，见线 7 结论），如需与宿主视觉一致应改用上表。

### 2.5 出厂能力变化（`bundle/base` patch 84 → 92 逐条）【源码】

1. 新增 `plugin-manager`（`@deepseek-ai/dsh-plugin-manager`，`disabled: !!js "!ctx.get('profileContext')"`）与 `tool-plugin-manager`（模型可见工具，默认 `disabled: true`）。
2. HMR：`@deepseek-ai/cordis-plugin-hmr`（`disabled: true`、`root: ['.']`）→ `@deepseek-ai/dsh-hmr`（`disabled: !!js "!ctx.get('profileContext')"`、`root: []`）——**有 profile 时默认开启热重载**。
3. 新增 `config-editor`（`@deepseek-ai/dsh-config-editor`）。
4. **settings 行：`@deepseek-ai/dsh-settings-file` → `@deepseek-ai/dsh-settings`**（设置持久化改走 profile patch）。
5. 新增 `authorization`（`@deepseek-ai/dsh-authorization`）。
6. 新增 `deepseek-account`（`@deepseek-ai/dsh-deepseek-account-platform`，desktop 平台条件启用）。
7. `workflow-worker-thread` → `ptc-runtime`（`@deepseek-ai/dsh-ptc-runtime-node`）+ `workflow-ptc`。
8. 工具结果内联阈值 `maxInlineBytes: 50000` → **`maxInlineTokens: 12500`（键名与单位双变）**。
9. 新增 `image-offload`（`@deepseek-ai/dsh-compaction-image-offload`）。
10. `tool-ralph` 默认 **`disabled: true`**。
11. 新增 `mcp-resources`（`@deepseek-ai/dsh-mcp-resources`）。

### 2.6 能力家族地图变化（`packages/README.md` 组表）【源码】

- 新增组：`ssh/`、`ptc-runtime/`、`computer-use/`、`browser-use/`、`deliverables/`、`document/`、`mcp/`；移除组：`e2b/`。
- `code-runtime/` → `ptc-runtime/`（"Code-execution" → "PTC execution"，worker-thread 引擎 → 沙箱化 Node 引擎）。
- `experimental/` 定位由 "Private prototypes and internal-only plugins" → **"Pre-stable prototypes with explicit private exceptions"**（实验包**可公开发布**）。
- `host/` 由 "API gateway + HTTP route server" → "Web GUI host services, directory picking, application launch, plugin inventory, and product telemetry"。

---

## 3. 破坏性变更（按严重度排序）

### 3.1 P0-A｜会话格式 V3 → V4（唯一的破坏性持久化变更）

**事实**【源码，线 1】：

- `packages/core/session/src/types.ts`：`SESSION_FORMAT_VERSION` **3 → 4**。
- `packages/session/session-format-catalog/src/generated.ts` 四项逐字变化：`currentVersion` 3→4、`codecs` 追加 v4、`currentEncoder` → `releasedV4SessionFormatCodec`、`migrations` 追加 `sessionFormatV3ToV4`。
- 新包 `packages/session/session-format-v3-to-v4/`（17 个 src + 20 个 test）：header-only 迁移 + 正文 stage，stage 必须经 `createSessionFormatV3ToV4(children)` 绑定子会话证据，否则 `SessionFormatUnsupportedMigrationError`。迁移动作：tool-result 扁平化、消息 source 改名（`compact`→`compact-checkpoint`、`tools-ptc`→`ptc-mode`、`system-prompt`→`runtime-context`、未知→`plugin:<名>`）、未知 ignorable 事件命名空间化、补写中断 `turn/end{interrupted}`、密集重编号与引用重映射、补写父级 `subagent/catalog`。
- JSONL 路径/后缀/目录结构**逐字未变**；无新索引或游标文件；`attachment` 持久根不变（请求图像变体缓存迁到 `<DSH_HOME>/cache/attachments`）。

**兼容性判定**【源码】：

| 方向 | 结论 |
|---|---|
| 旧 → 新 | 架构上可读（catalog 链 v0→v1→v2→v3→v4 完整）。**读打开只在内存准备**；写打开才发布 `session.v4.jsonl[.zstd]` 后继，前代文件保持原样 |
| 新 → 旧 | **不可读**。`session-persistence/src/errors.ts` 的 `sessionFormatVersionRefusal` 以运行中的 `SESSION_FORMAT_VERSION`（旧=3）判定 v4 为"更新代"，命中即 `SessionFormatUnsupportedError` |

**最严重的放大效应：影子遮蔽（回退是单向门）**。`resolveGenerationInDirectory` 两版本逐字相同，选**版本号最大**的文件。因此 0.1.7-rc.1 只要对某旧会话做过**一次写打开**（发布 `session.v4.jsonl.zstd`），0.1.5-rc.2 之后**再也打不开它**——即使可读的 `session.v3.jsonl.zstd` 仍完好同目录。【源码 + 推断】

**并非所有 V3 都能被新版读**：嵌套 `tool-result`、未知非 ignorable 事件、未 seeded 却带 inherited 标记等会被**硬拒绝**（且不改源文件、不发布后继）。【源码】

**事件载荷破坏**（会话事件类型新增 3、删除 0，但载荷有破坏）【源码，线 1】：

- `ContentBlockMap['tool-result']` **整个删除**；
- `tool/result` 的 message role `'user'` → **`'tool'`**，`toolCallId`/`isError` 提升到 message 顶层；
- 新增根事件 `developer/message`、`image/offload`、`workspace/changes`；
- `turn/end.reason.kind` 新增 `'forked'`；
- `docs/persistence-changes/` 旧 tag **不存在**（0 → 155 文件）；区间内 `version-bump` 共 **14 条，全部集中在 `2026-09-16-session-format-v4.md`**。

**对 dsh-ldvh 的直接含义（本次核实新增）**：dsh-ldvh **确实直接消费会话数据面**，因此 v4 迁移不是"与它无关"的上游事件：

| 消费点 | 机制 | 新版核验 |
|---|---|---|
| `lib/session-signature.js`（+ 7 处 `currentRouteValues(...)` 调用：`adr-tools`/`friction-tools`/`goal-tools`/`ldvh-tools`/`norm-tools`/`pitfall-tools`/`research-tools`） | `ctx.get("sessionPersistence")` → `sessionPersistence.locate(agent.session.header)` → 要求 `location.kind === 'jsonl'` → **tail-read 会话 JSONL**，取最后一个 `model/selection` 或 `request/context` 事件作为 commit trailer（`LDVH-Provider` / `LDVH-Model`） | `model/selection`（10 文件）与 `request/context`（26 vs 24 文件）**两版均存在**，且**不在** v4 的 14 条 version-bump 载荷变更清单内 → 事件类型与载荷面兼容 ✅ |
| `lib/event-stream.js` | 扫描 `turn/start` → `turn/end` 找未闭合 turn、按 turn 归档消息、从 `tool/call` 计数 | `turn/start`、`turn/end`、`tool/call` 均仍存在 ✅；但 `turn/end` **在 version-bump 清单内**（载荷变化），且 v4 迁移会**补写中断的 `turn/end{interrupted}`**、`reason.kind` 新增 `'forked'` → **解析器必须容忍新 reason/新补写事件** ⚠️ |
| `lib/lifecycle.js:239`、`lib/child.js:142` | `ctx.on("session/event")`，`child.js:137` 明确按 `turn/end` 的 `{turn, reason}` 判定 | 同上 ⚠️ |
| `sessionPersistence.locate()` | 两版均为 TS `private`（非公开契约），dsh-ldvh 以 `?.` 可选调用 | **升级后必须回归验证**：签名或返回结构变化会**静默失败**（`reason` 文案走 `ok:false` 分支）⚠️ |

结论：**v4 不会让 dsh-ldvh 的会话读取立刻失效，但会让它的两个解析器（session-signature 的路由值、event-stream 的 turn 扫描）面临"新载荷 + 新补写事件"的兼容压力**；且它读的是"权威 JSONL 文件"这一物理事实，因此在**回退单向门**面前与其它消费者同等暴露（§5 阶段 0 的整目录备份同样保护它）。

### 3.2 P0-B｜设置模型整体重建（`SettingsProvider` → `SettingsForms`）

**事实**【源码 + 运行时】：

| 维度 | 0.1.5-rc.2 | 0.1.7-rc.1 |
|---|---|---|
| 服务实现 | `SettingsProvider`（抽象类，默认导出）+ `settings-file` 提供者 | **`SettingsForms`**（`inject: ['configEditor','profileContext']`） |
| 公开方法 | `register<T>(ns, schema, options)`（0.1.2-alpha.1 时代）→ 0.1.5-rc.2 仅 `get/watch/update/replace` + `installSection` | `configure` / `prepareDocument` / `describe` / `update` / `replace` / `mutate` / `write` / `schema`（**无 `register`**） |
| 存储 | `$DSH_HOME/settings.yaml`（`settings-file` 包，热重载） | **profile 的 `cordis.patch.yml`**（经 `configEditor`） |
| 命名空间 | 独立 settings 命名空间 | **= profile 插件条目 id** |
| 可热改字段 | 命名空间 schema | 插件 Cordis `Config` 中标记 `.volatile()` 的字段 |
| `applies` | `'live' \| 'restart'` | 仅 `'live'` |

- 运行时 `ctx.settings` 实测方法集（【运行时】，`cordis_inspect_query host/Service settings`）：`configure(presentation, owner?)`、`prepareDocument()`、`describe(options?)`、`update(ns, patch, expectedRevision?)`、`replace(ns, section, expectedRevision?)`、`mutate(ns, ops, expectedRevision?)` —— **确认无 `register`**。
- 旧 `$DSH_HOME/settings.yaml` 在 Settings 启动、Loader 稳定后**一次性导入**：section id → entry id（`ui-developer-tools`→`ui-settings`、`ui-onboarding`→`ui-settings-general`、`shell`→平台 shell 执行器条目），随后文件改名 `settings.yaml.imported` 以保证不重复导入；被组合拒绝的段落只留在改名后的文件里。
- 权威决策记录：`.agents/notes/implemented/architecture/2026-09-19-profile-owned-live-configuration.md`。
- 关联事件：`settings/updated` 删除，新增 `settings/document-updated`(ns, revision)。

**对第三方插件的正确写法**（新版唯一路径）：把可配置值声明进**本插件 Loader 条目的 `Config`**，需要热改的字段包 `.volatile()`；写设置走 `configEditor.edit(entry, …)`（宿主侧）或 `ctx.configForms.get(<entry id>)`（客户端侧）。

### 3.3 P0-C｜客户端设置面双删除（`settingsScope` 与 `settings.plugin.item`）

- **服务**：`ctx.settingsScope` 在 0.1.7-rc.1 的 `packages/` 内 **0 命中**（全仓仅 `.agents/notes/**` 文档提及）。替代品为 **`ctx.configForms`**，由 `packages/client/ui-settings/src/client/config-form.ts:266` 的 `super(ctx, 'configForms')` 提供，API 包含 `get(ns)`、`whileServed(namespaces, register)`、`developerTools.enabled`。【源码 + 运行时】
- **槽位**：`settings.plugin.item` 在运行时的 92 个 Slot 中**不存在**（【运行时】）；设置页注册面迁到 Plugins 页的 `plugins.item` / `plugins.bundle.config`（key = bundle 包名）/ `plugins.row.config`（key = `<包名>#<row id>`）/ `plugins.detail.*`，并用 `view: 'page'` + 自带保存控件。
- 决策记录：`.agents/notes/implemented/architecture/2026-09-17-settings-pages-as-companion-packages.md`（"社区插件的设置页放在自己包的浏览器半侧，经 `ctx.settingsScope`→ 实际为 `ctx.configForms` 读写"）。

### 3.4 P1-D｜`agent/session-start` 事件删除

- 旧版由 `packages/core/agent-loop/src/index.ts:675` 发射；新版 agent 事件面中**已无此名**（【源码】），运行时事件目录同样无（【运行时】）。
- 替代：**`agent/created` 载荷 `{ agent, source, signal? }`**，`source: SessionStartSource`；且该事件由 `emit` 改为 **`serial`**——监听器可返回 Promise，被串行 await，**抛错会回滚 agent 创建事务**。
- 影响面：任何"会话开始/恢复/清空/压缩时做一次性初始化"的插件逻辑必须迁移到 `agent/created` 并读取 `payload.source`；原本"发射后不管"的监听现在**处在创建事务的关键路径上**，必须自己保证不抛错、不过度阻塞。

### 3.5 P1-E｜模块解析规则：linked-root peer 拦截

权威记录：`.agents/notes/implemented/architecture/2026-09-19-profile-resolution-lookup-order.md`（实现 `packages/boot/app-boot/src/profile-resolution/resolver.ts`）。【源码】

- profile 内祖先链：① `<profile>/node_modules/<pkg>/node_modules` ② `<profile>/node_modules` ③ `$DSH_HOME/profiles/node_modules`（**拦截层**）④ `$DSH_HOME/node_modules` ⑤ `/node_modules`。
- **拦截层规则**：运行中的安装闭包（installation closure）在 ③ 处**占据同名包目录位置**；旧版 link 后端写入的投影软链被一次性清理。
- **linked root 规则（对 dsh-ldvh 直接相关）**：当 `<profile>/node_modules/<pkg>` 链接到 profiles 树外的真实目录 R（如 `link:/Users/.../dsh-ldvh/plugin`），在每个候选 `D/node_modules` 位置：**若该包名在 `D/package.json` 的 `peerDependencies` 中声明，且运行时解析表提供该名字，则使用运行时（宿主安装）的包**，物理副本不被读取；更近的物理候选优先于更远的 peer 声明。
- 三模式中 **`link` 与 `dual` 已删除，`runtime` 为唯一后端**（"no mode selector or disk materializer"）；`dsh.profile.patchReload` 字段删除；新增 `sanitizeProfile()`（仅 Desktop 致命恢复调用）与 `compatibility.json` + `evaluatePluginCompatibility()` 门禁。

### 3.6 P1-F｜隐私与行为默认值翻转（节选，全表见附录 A.6）

| # | 配置键 | 旧 → 新 | 影响 |
|---|---|---|---|
| 1 | `session-log-deepseek.enabled` | `false` → **`true`** | **默认上传完整会话日志**（消息正文、工具入参与结果、工作区路径、反馈）到 DeepSeek 端点 |
| 2 | `subagent.maxDepth`（实际生效默认） | `3` → **`1`** | 默认只允许一层子代理；`0` 完全禁止（【运行时】本会话实测：派生 depth-2 被拒 `subagent depth 2 exceeds maxDepth 1`） |
| 3 | `subagent.maxActiveSubagents` | （新键）→ **`8`** | 每根代理树最多 8 个常驻/延续子代理；超限 `ACTIVATION_LIMIT_REACHED` |
| 4 | `tool-jobs.maxConsecutiveWakes` | `3` → **无上限** | 空闲所有者每次后台完成都会开一轮 |
| 5 | `ui-settings.enabled`（developer tools） | `false` → **`true`** | 新装即暴露 Trajectory、工具 Inspect、preset 选择、**可执行脚本的 HTML 预览** |
| 6 | `tool-ralph` 行 | 启用 → **`disabled: true`** | base 与 standard/ptc/cordis 预设均默认关闭 |
| 7 | `spill-policy` | `maxInlineBytes: 50000` → **`maxInlineTokens: 12500`** | 键名与单位双变 |
| 8 | `compaction-basic` | `maxTokens: 8192` → `headroomTokens: 65536`；阈值分母改为"窗口 − 预留输出" | 摘要预算提高 8×，压力阈值更晚触发 |
| 9 | `ui-chat` 记录视图 | `'compact'` → **`'standard'`** | 新装默认更完整视图 |
| 10 | `llm-deepseek DEFAULT_MODELS` | 4 个 → **2 个** | 移除 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` |
| 11 | `hmr` 行 | `disabled: true` → 按 `profileContext` | **有 profile 时默认开 HMR**；`patchReload` 配置项消失 |
| 12 | `mcp-client.maxInstructionBytes` | （新键）→ `32768` | 服务器 instructions 超限则拒绝连接 |

### 3.7 P2｜其他值得注意的契约变化

- `shell` 服务：`run()` + `start()` 删除 → **`execute()`**；`SHELL_SETTINGS_NAMESPACE` 删除（【源码】，线 3）。使用 `shellEnv` 的插件不受影响（`ctx.shellEnv` API 未变，仅新增内置变量 `DSH_PROFILE` / `DSH_PROFILE_DIR`）。
- `sandbox.confine()` **改为 async**；`sandboxPolicy.workspaceRoot` 必须是绝对路径（不再 canonicalPath）。
- `attachments`：`ImageRequestPolicy` → `ImageRequestTarget`；`fs` 新增 `watch()`（默认实现抛错）；`subprocess` 新增 `terminalEnvironment()`。
- **`MessageSourceMap` 删除 `{kind:'plugin'}` catch-all 分支**（`llm/llm/src/message.ts`），`ui-chat` 的 `contextProducer`（由 `contextProvenance` 改名）同时删除 `case 'plugin'`：插件注入的上下文行**仍会渲染**，但 label 由插件 id（如 `dsh-ldvh`）**退化为裸 kind `"plugin"`**。注意新 `context-producer.ts` 的文档注释仍宣称 label 可取 plugin id，**文档与实现不一致**（【源码】，线 7）。
- `agent-preset` 重构：`preset/agent-presets` 删除 → `agent-preset-registry`（`ctx.agentPresets`，只认必填 `default`，不扫描目录）+ `agent-preset`（声明插件，config = `{id, plugins[], name?, description?, order?}`）；预设文件迁到 `packages/bundle/web-app/presets/{standard,minimal,ptc,cordis}.patch.yml`。**最大陷阱：用户覆盖会整表替换 children，不合并后续内置变更**；服务行必须放在带 `isolate` 的 group 内，否则 root realm 冲突被拒。
- `deliverables/tool-present` 是 `fs/tool-present` 的**纯移动**（包名 `@deepseek-ai/dsh-tool-present`、工具名 `present`、`types.ts` 均不变，仅 9 行 description 文案差异）→ 只需改 import 路径。
- **`dsh-client-ui-primitives` 图标命名族改名**（尺寸数字后缀 → 粗细语义后缀，导出 75 → 186）：`IconChevronDownOutline14` → `IconChevronDownOutlineRegular` 等（【运行时】核实，详见 §4.3 致命点 B）。
- **`@deepseek-ai/dsh-settings` 的自由函数 `installSettingsSection` / `settingsNamespace` 已于 `dsh-v0.1.2-alpha.2`（commit `f4e49ccf8f`）从仓库移除**：`0.1.2-alpha.1` 全仓 18 个文件命中，`0.1.2-alpha.2` 起 0 命中（本次逐 tag 复核）。`0.1.2-alpha.1` 的 `SettingsProvider` 仍提供 `register<T>(ns, schema, options)`——**这正是 `DEVELOPMENT.md` 记录的目标环境**。（【源码】复核，修正线 7 的 "alpha.5" 说法。）
- **`frontend-static` 的 `<base>` 由 `href="/"` 改为 `href="./"`**：插件向宿主索引注入资源引用时应改用**文档相对** URL（`plugins/...` 而非 `/plugins/...`）。
- `connection` 新增 `admit()`，`ConnectionRpcHandler` 增加第 4 个参数 `peer`（dsh-ldvh 的 handler 忽略入参，运行时安全）；`subprocess` 终端契约的 `terminalType` 变为必填。
- 桌面端不再是薄壳（默认监听 19387、macOS vibrancy 全新、继承 `NODE_OPTIONS`/`NODE_PATH` 并执行依赖生命周期脚本 → **安全边界放宽，建议复核**）。
- CLI：新增 `dsh <profile>` 简写、`--dump-config-schema`（JSON Schema 2020-12 + `x-cordis` volatile 元数据）、启动诊断写 `$DSH_HOME/logs/startup-*.log`（**未脱敏，可能含凭证**）；headless 新增 `--json` / `--session-id` / stdin 任务；**无 TUI**。

---

## 4. 对 dsh-ldvh 的影响评估

### 4.1 现状与消费面盘点【运行时 + 源码】

dsh-ldvh 作为宿主插件消费的 DSH 接缝（`plugin/lib/*.js` 全量统计）：

| 类别 | 具体项 | 次数 |
|---|---|---|
| host 硬注入 | `inject = ["tools", "settings", "systemPrompt"]` | — |
| host 软注入 | `ctx.inject(["webServer"], …)`、`ctx.inject(["connection"], …)` | 2 |
| 工具接缝 | `ctx.tools.register`(14)、`ctx.tools.guard`(6) | 20 |
| 不变式 | `ctx.invariants.register` | 6 |
| 人机问答 | `ctx.userQuestions.ask` | 16 |
| 事件 | `system-prompt/assemble`(2)、`session/event`(2)、`agent/session-start`(2)、`agent/pre-step`(2)、`agent/turn-stopping`、`agent/created`、`fs/write-intent`、`fs/edit-intent`、`fs/observed`（listen+emit） | 15 |
| HTTP | `webServer.register({kind:'prefix'|…})` × 3（`/ldvh/api`、`/ldvh`、`/ldvh/state`） | 3 |
| 其他 | `ctx.get`(15)、`ctx.logger`(14)、`ctx.effect`(8)、`ctx.remote`、`ctx.commands`、`ctx.emit` | — |
| client 侧 | `inject = ["slots", "locale", "settingsScope"]`、`ctx.settingsScope.bind`、`ctx.locale.register/bind`、`ctx.slots.inject/register`（`conversation.view`、`settings.plugin.item`）、`ctx.inject(["betterSidebar"])`、`require("@deepseek-ai/dsh-client-ui-primitives")` | — |
| 宿主包依赖 | `dependencies`: `dsh-atomic-write`、`dsh-home-paths`、`schemastery`、`yaml`；`peerDependencies`: **`dsh-settings`**、`dsh-host-webserver`、`dsh-client-ui-primitives`；`devDependencies`: `dsh-settings@0.1.0-rc.6` 等 | — |

### 4.2 P0-1｜加载期阻断：`@deepseek-ai/dsh-settings` 命名导入

**证据链（四段闭合）**：

1. **代码**：`plugin/lib/index.js:31` `import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings"`；`:76` `settingsNamespace("dsh-ldvh")`；`:338` `installSettingsSection(ctx, ns, schema, {}, {…})`。
2. **声明**：`plugin/package.json` 把 `@deepseek-ai/dsh-settings` 同时列入 **`peerDependencies`**（范围 `^0.1.0-rc.6 || ^0.1.1-rc.2 || >=0.1.2-alpha.1 <0.2.0`）与 `devDependencies`（固定 `0.1.0-rc.6`）。
3. **解析**：按 §3.5 的 linked-root peer 拦截规则，`/Users/dmh2002/DshProject/dsh-ldvh/plugin` 是 linked root，该包名被声明为 peer 且运行时解析表提供 → **使用宿主副本 `0.1.7-rc.1`**（【运行时】实测 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-settings` = `0.1.7-rc.1`）。
4. **宿主公开面**：`0.1.7-rc.1` 实测导出仅 `SettingsConflictError, SettingsForms, default, redactSecrets`（【运行时】node 内省）—— **`installSettingsSection` 与 `settingsNamespace` 均不存在**。

**推论**：模块链接期抛 `SyntaxError: The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'installSettingsSection'`，**整个 dsh-ldvh 宿主插件无法装载**（工具、守护、引导、Web 路由全部不生效）。【推断，待运行时复现】

**历史坐标（关键背景）**：这两个导出**自 `dsh-v0.1.2-alpha.2`（commit `f4e49ccf8f`）起已从 DSH 仓库移除**；它们仅存活于 dsh-ldvh 自己 `devDependencies` 里的 `0.1.0-rc.6` 副本。而 `0.1.2-alpha.1` 的 `SettingsProvider` **确有** `register<T>(ns, schema, options)`（源码第 435 行）。`DEVELOPMENT.md` 记录的目标环境恰为 `@deepseek-ai/dsh 0.1.2-alpha.1` —— **即该 API 的最后一个可用版本**。可推断：设置接入层在该基线之后、按新版解析规则会取宿主副本时即失效；旧解析行为下"能 import 但 `ctx.settings.register` 不存在"表现为**设置面静默失效**，新解析规则下升级为**插件整体加载失败**。

**版本范围陷阱**：peer 范围 `>=0.1.2-alpha.1 <0.2.0` 在语义上**允许** `0.1.7-rc.1`，但 API 已不兼容。**半开区间不能替代 API 兼容性判断**——这是本次升级最值得记录的一条工程教训。

### 4.3 P0-2｜客户端半侧整体不工作（两处独立致命点）

**致命点 A：`settingsScope` 服务不存在**（见 §3.3）。`plugin/lib/client.js:953` 的 `inject = ["slots", "locale", "settingsScope"]` 在 0.1.7-rc.1 中永久无法满足。失败形态有两条可能路径，**结果一致、机制待运行时复现收口**：

- 路径一（Cordis 语义）：声明式 `inject` 未满足 → `apply` **根本不被调用**，插件保持未激活；
- 路径二（代码结构）：`apply` 被执行 → 第 962 行 `ctx.settingsScope.bind({namespace:"dsh-ldvh"})` 抛 `TypeError` → **被 `apply` 自身的 `try { … }` 捕获**（`client.js:956` 起为整段 try 包裹）→ apply 提前返回。

两条路径都导致：**客户端插件的全部插槽注册不会发生**（`conversation.view` 对话 Tab、设置卡、`betterSidebar` 侧栏 Tab），表现为"LDVH 在 Web 上整体消失"，且不给出显式错误——最坏只有控制台一行报错。【推断，待运行时复现】

**致命点 B：`dsh-client-ui-primitives` 图标命名族整体改名**。【运行时核实】

| 维度 | 结论 |
|---|---|
| 旧名 | `IconChevronDownOutline14`（尺寸数字后缀族） |
| 新名 | `IconChevronDownOutlineRegular` / `…Medium`（粗细语义后缀族；导出总数 75 → 186） |
| 核实 | 已安装 `0.1.7-rc.1` 的 `dsh-client-ui-primitives/lib` 中 `IconChevronDownOutline14` **0 命中**，`IconChevronDownOutlineRegular` **存在** |
| dsh-ldvh 用法 | `client.js:25` 等引用旧名 → 取到 `undefined` → `React.createElement(undefined, …)` → **渲染期崩溃**（在 apply 的 `try/catch` 之外，不会被吞掉） |

> 这是**与设置面无关的独立回归**：即便修好 `settingsScope`，只要渲染到使用该图标的设置卡就会崩溃。凡从 `dsh-client-ui-primitives` 取用的具名导出都应按新命名族对齐；建议改为**运行时按名探测 + 回退**，而非硬编码尺寸后缀。

即便完成上述修复，`settings.plugin.item` 槽位也已不存在（【运行时】），设置面板必须迁到 Plugins 页的 `plugins.*` 面。

### 4.4 P1｜事件面静默失效

| 位置 | 用途 | 新版状态 |
|---|---|---|
| `lib/lifecycle.js:240` | `agent/session-start` → `onPreStep.prime()` + 记录 session→scope 映射 | **事件已删除 → 永不触发**（静默） |
| `lib/child.js:119` | 子代理会话开始的 stop 注册 | 同上 |
| 迁移方向 | 改用 `agent/created`，读 `payload.source ∈ startup\|resume\|clear\|compact`；注意该事件现为 `serial` 且**抛错会回滚 agent 创建** | — |

### 4.5 已确认兼容的接缝（独立核对，可放心使用）

| 接缝 | 判定 | 证据 |
|---|---|---|
| `ctx.tools.register` / `ctx.tools.guard` | ✅ 公开方法集完全一致；guard 仍为同步 `(exec) => string \| undefined` | 运行时服务目录 + 源码 `core/tools/src/index.ts` 两版同构 |
| `ctx.invariants.register(packageName, installer)` | ✅ 签名一致 | 【运行时】`invariants` 服务目录 |
| `ctx.userQuestions.ask(request)` | ✅ 无变化 | 线 3 结论速览 + 运行时目录 |
| `ctx.webServer.register(route) → () => void` | ✅ 逐字一致（`kind` exact/prefix；重复路径抛错）；另有 `registerUpgrade` / `registerFallback` / `tapIndex` / `renderIndex` 可用 | 运行时目录 + 源码两版相同 |
| `ctx.commands` / `ctx.approval` / `ctx.jobs` / `ctx.workflowEngine` / `ctx.webhookRuntime` | ✅ 无变化 | 线 3 |
| `ctx.shellEnv` | ✅ API 不变（新增 `DSH_PROFILE` / `DSH_PROFILE_DIR`） | 线 3 |
| 事件 `system-prompt/assemble`、`agent/pre-step`、`agent/turn-stopping`、`session/event`、`fs/write-intent`、`fs/edit-intent`、`fs/observed`、`agent/created` | ✅ 全部仍存在（mode 与签名未变，`agent/created` 除外——见 §3.4） | 附录 B.2 事件表 |
| 槽位 `conversation.view` | ✅ 仍存在（list / session） | 【运行时】Slot 拓扑 |
| 客户端 `ctx.slots` / `ctx.locale` | ✅ 服务仍在，`register` / `inject` / `bind` 签名存在 | 【运行时】客户端服务目录 |
| Loader 方言与 `cordis.patch.yml` 契约 | ✅（`insert` / 覆盖 / `group` / `disabled` / `isolate` / `!!js` 逐字未变；`dsh.bundle.patch` 由 string 放宽为 string\|string[]，旧写法仍有效） | 线 2 |
| peer 包存在性 | ✅ 三个 peer 包均在（`dsh-settings`、`dsh-host-webserver`、`dsh-client-ui-primitives`，皆 `0.1.7-rc.1`）——**但 `dsh-settings` 的 API 已不兼容** | 【运行时】 |
| `link:` 本地安装方式 | ✅ 仍受支持（`anchorPathSpec` 语义保留） | 线 2 |
| `ctx.invariants` / `ctx.userQuestions` 整包 | ✅ **整包字节一致**（`invariants` 全包、`user-questions` 154 行） | 线 7 |
| `fs` 服务与 `fs/observed` / `fs/write-intent` / `fs/edit-intent` | ✅ 事件声明与 `FsWriteIntent` **逐字相同** | 线 7 |
| `ctx.get("dshHomePath")`、`dsh-atomic-write`、`dsh-home-paths` | ✅ 可用 | 线 7 |
| `system-prompt/assemble` + `PromptAssembly`、`agent/pre-step` + `PreStepDecision` | ✅ 类型逐字相同 | 线 7 |
| `plugin/web` 自建 SPA 的独立性 | ✅ 不使用 `--dsh-*` token、不依赖 `window.__DSH_BOOT__`、无跨包 import → 与宿主前端解耦，升级面小 | 线 7 |

> **注意一个非 DSH 的依赖**：`ctx.inject(["betterSidebar"])` 指向第三方插件 `dsh-better-sidebar@0.19.1`（`test` profile），其命名空间**两版 DSH 仓库中都不存在**。DSH 升级不直接涉及它，但该插件自身对新宿主的兼容性需单独确认。

### 4.5.1 一处静态结论被运行时证据推翻（证据分级示例）

线 3 的静态核对给出"`agentDefaultModel` 服务名消失（包还在）"，但**运行时服务目录中 `ctx.agentDefaultModel` 明确存在**（`currentSelection(): ModelSelection` / `async saveSelection(next): Promise<void>`）。按 §0 的证据分级，**以运行时为准：该服务在 0.1.7-rc.1 仍然存在**。

这条分歧本身值得记录：在同一区间里，`packages/core/agent-default-model` 的服务注册方式可能经过重构（例如由 `ctx.provide` 或不同基类注册），导致"按 `super(ctx,'<name>')` 静态搜索"的方法漏判。**凡涉及"服务是否存在"的断言，应以 `cordis_inspect_query host/Service` 的运行时目录为准。**

### 4.6 风险矩阵

| 风险 | 严重度 | 现状 | 处置 |
|---|---|---|---|
| dsh-ldvh 宿主插件加载失败（settings import） | **P0** | 推断已断（旧基线起设置面即失效） | 重写设置接入层（§5 阶段 1） |
| dsh-ldvh 客户端半侧不工作（`settingsScope` + 槽位双缺） | **P0** | 服务与槽位双缺 | 迁移 `configForms` + `plugins.*`（§5 阶段 2） |
| **客户端图标命名族改名 → 渲染期崩溃** | **P0** | 旧名 0 命中、新名存在（运行时已核实） | 按新命名族对齐 / 运行时探测回退（§4.3 致命点 B） |
| 会话历史不可回退（v4 单向门） | **P0** | 与 dsh-ldvh 无直接耦合，但影响整机 | 升级前**整目录备份**；确认 dsh-ldvh 是否读写会话流 |
| 隐私默认上传开启 | **P0（Human 决策）** | 默认 `true` | 显式 `{id:'session-log-deepseek', config:{enabled:false}}` 或接受 |
| `agent/session-start` 静默失效 | P1 | 2 处监听 | 迁移到 `agent/created` + `source` |
| 会话行 label 退化（`plugin` catch-all 取消） | P2 | 行仍渲染，label 变化 | 接受或在新 source 契约下重命名 |
| subagent 深度默认 3→1 | P1（行为） | 影响 LDVH 的子代理编排假设 | 显式配置 `subagent.maxDepth` |
| 设置写入路径改变（profile patch 而非 settings.yaml） | P1 | 影响安装事务与用户可见行为 | 重设计设置面 |
| `tool-ralph` 默认关闭、`spill-policy` 键变更 | P2 | 与本插件无直接关系 | 记录 |

---

## 5. 适配工作清单（建议顺序）

### 阶段 0：升级前（Human 决策与不可逆保护）

1. **整目录备份会话根**（v4 单向门；回退唯一保险）。【线 1 待确认 C】
2. **决定隐私默认**：是否显式 `session-log-deepseek.enabled=false`。【线 1 待确认 D —— 必须由 Human 定，不是技术默认】
3. 确认现存会话日志中是否存在嵌套 `tool-result` 或非 ignorable 未知事件（会导致新版**拒绝打开**而非迁移）。【线 1 待确认 B】
4. 确认 dsh-ldvh 是否直接读取会话事件流/会话文件（若读，需按线 1 §7.1 的 10 项适配）。【线 7 待确认】

### 阶段 1：恢复可加载（P0，最小改动）

5. **移除 `installSettingsSection` / `settingsNamespace` 依赖**，按新模型改造设置面：
   - 在 `cordis.patch.yml` 的 `dsh-ldvh` 条目上声明 `config`（schemastery/zod schema），可热改字段标 `.volatile()`；
   - 宿主侧读写改走宿主注入的 `ctx.settings`（`describe` / `update` / `mutate`）或 `ctx.configEditor`；
   - 设置命名空间 = **profile 条目 id**（即 `dsh-ldvh`）。
6. 或（临时手段）把设置接入层**内联进本包**，彻底断开对 `@deepseek-ai/dsh-settings` 的命名导入——但这只解决加载，不解决"设置无处可存"。
7. 校正 `peerDependencies` 范围与语义（不要再用宽范围掩盖 API 破坏）。

### 阶段 2：恢复功能面（P0/P1）

8. **客户端插件**：`inject` 去掉 `settingsScope`，改注入 `configForms`（或直接不注入、用 `ctx.get` 软取）；`ctx.settingsScope.bind(ns)` → `ctx.configForms.get(<entry id>)` + `whileServed` 注册规则。
9. **设置卡迁移**：`settings.plugin.item` → `plugins.bundle.config`（key = `dsh-ldvh`）或 `plugins.row.config`（key = `dsh-ldvh#<row id>`），带 `view: 'page'` 与自带保存控件。
10. **事件迁移**：`agent/session-start` → `agent/created`（读 `payload.source`；注意 serial 语义与"不得抛错"约束）。
11. `betterSidebar` 侧栏 Tab 的兼容性单独验证（第三方插件，非 DSH 责任）。

### 阶段 3：能力升级（可选，收益明确）

12. 接入 **`ctx.workspaceChanges` + `workspace/changes`**（默认已启用）：LDVH 的"本轮改了什么 + 单文件 diff"审查/审计面可直接复用，无需自建。
13. **`ctx.pluginManager`**（`listPlugins` / `installBundle` / `setPluginEnabled` / `waitForInstall` / 安装事件流）：把 LDVH 的安装/升级动作从"手工 CLI"升级为 profile 事务化操作，并获得 `plugin-manager/install-*` 事件做进度呈现。
14. **`ctx.hmr`**（有 profile 时默认开启）：开发期改 `cordis.patch.yml` 即时生效；客户端插件已支持免刷新重建。
15. `ctx.configEditor`：设置文档的持锁编辑 + 普通 Loader 协调路径，是设置持久化的正确入口。
16. `ctx.officeToPdf`、`ctx.ssh`、`ctx.ptcRuntime`、`ctx.browserUse` / `ctx.computerUse`、`mcp-resources`、`test-support/remote-mock`（客户端插件测试基建）—— 按需选型，均在附录 A.5 有语义与 opt-in 说明。

---

## 6. 待确认项与证据边界

**方法边界**：本次为静态 diff + 运行时版本/接口核对，**未做 dsh-ldvh 在 0.1.7-rc.1 上的受控启动复现**（避免干扰当前会话）。所有"加载失败/不装载"结论均为推断，应以下述验证收口：

1. **运行时复现**：在 `test` profile 上做一次受控启动，采集 dsh-ldvh 的真实错误（预期：`does not provide an export named 'installSettingsSection'`）。【P0 验证】
2. ~~dsh-ldvh 是否读取会话事件流/会话文件~~ → **本次已核实：是**（`session-signature.js` 的 JSONL tail-read + `event-stream.js` 的 turn 扫描 + `session/event` 监听）。事件类型面兼容、载荷面需回归，详见 §3.1 末表。剩余待确认：升级后对真实 v4 日志跑一次 `session-signature` 与 `event-stream` 的解析回归。
3. **dsh-ldvh 的 Loader entry id 是否等于 `dsh-ldvh`** —— 它决定 `ctx.configForms.get(<entry id>)` 的 key，也决定旧 `settings.yaml` 中 `dsh-ldvh:` 段落的迁移归宿（线 3）。
4. `settings/updated` 的替代路径：README 提到 `loader/volatile-update`，但该事件不在本次提取的事件清单内，**未确证**（线 3）。
5. `agent/created` 的 `serial` 模式与 `packages/core/scope/src/scoped-events.generated.ts` 的交互未逐行核对（线 3）。
6. 第三方 prefix 路由仍**不经** `connection` 的 Host/Origin 认证（两版本一致，但新版是否要求经 `connection/request` 自建 gating 未见文档）（线 3）。
7. `agent_preset` 工具未在本 tag 定位到注册（线 5）；`ctx.webServer.register` 选项 schema 未逐字段比对（线 2 自陈）。
8. ACP app 默认模型 `deepseek-v4-flash` 已不在 `DEFAULT_MODELS`，是否为遗漏（线 6）。
9. `session-projection-cache` 的 `val` 校验由 `z.json()` 收紧为 `isJsonValue`，是否会拒掉现存 checkpoint 行（线 1）。
10. 语音五件套的 opt-in 入口为 Web Plugins 页启用 default-disabled 的 `voice-input-bundle`，不需付费账号；`credentials/deepseek-account` 确需账号凭据且凭据 Host-only（`api/account-controller` 有意不导出 `resolveToken`）（线 5）。
11. `experimental/` 的"外部不得依赖"声明是否有机械门禁（线 5 未找到）。
12. 若目标改为 `0.1.7-rc.2`，需对 rc.1→rc.2 的 346 commits 复核（尤其 plugin-manager 与 settings）。
13. `tool-plugin-manager` 的启用条件与 `plugins.*` 槽位 `view` 取值全集、保存时机（线 2）。

**本报告不主张**：任何未经运行时复现的"dsh-ldvh 当前必然崩溃"断言；任何对第三方插件（`dsh-better-sidebar` 等）兼容性的判断；`0.1.7-rc.2` 的结论。

---

## 附录 A：分线调研明细

见本文件后半部分（附录 A.1–A.7），以及主调研员工作笔记 A.0。

## 附录 B：运行时能力数据表

- **B.1** 宿主服务表（88 个 `ctx.*`，含职责与公开方法数）
- **B.2** 事件差异表（79 行，含 mode 与新旧判定）
- **B.3** 客户端 Slot 表（92 个，含 kind/scope/replaceRisk/用途）

---

# 附录 A：分线调研明细

> 本附录为 7 条并行调研线的一手交付原文（未经改写，保留其原始证据与自陈的待确认项）。
> 各线独立作业、只读 git；正文结论已由主调研员做交叉核对，凡与正文冲突处，**以正文（含 §4.5.1 的证据分级判定）为准**。

## A.0 主调研员一手发现（独立验证的工作笔记）

### 主调研员一手发现（独立验证，非子代理产出）

<!-- line: own-findings -->

调研日期：2026-09-25（本机）
仓库：`/Users/dmh2002/DshProject/deepseek-harness`（deepseek-ai/deepseek-harness，fetch 后 tag 齐全）
安装宿主：`/Applications/DSH NEXT.app`（app 包 `dsh-desktop-next@2.0.14-next`，依赖 `@deepseek-ai/dsh@0.1.7-rc.1`）

#### A. 版本序列与范围

| tag | 日期 | 备注 |
|---|---|---|
| `dsh-v0.1.5-rc.2` | 2026-09-10 | 基线（`fb2c4b9e69`，本地工作树 HEAD） |
| `dsh-v0.1.5-rc.3` | — | 区间内 |
| `dsh-v0.1.6-alpha.1` / `.2` | — | 上一份调研报告的对象 |
| `dsh-v0.1.7-alpha.1` / `.2` | — | |
| `dsh-v0.1.7-rc.1` | 2026-09-23 | **本次目标**（`46a7f68b09`，与已安装宿主一致） |
| `dsh-v0.1.7-rc.2` | 最新 | `dsh-v0.1.7-rc.1..rc.2` 另有 346 commits / 3429 files，会话格式无迁移变化 |

区间规模（`dsh-v0.1.5-rc.2..dsh-v0.1.7-rc.1`）：**3304 commits**，全仓 7872 files `+1,206,215 / -127,437`；`packages/` 4518 files `+259,252 / -95,276`；`apps/` 835 files `+65,289 / -10,600`。

#### B. 包级结构变化（`packages/`）

新增组：`browser-use`、`computer-use`、`deliverables`、`document`、`ptc-runtime`、`ssh`；移除组：`code-runtime`、`e2b`；package.json 计数 267 → 307。

新增包（52 个，摘要）：`api/account-controller`、`api/job-controller`、`api/terminal-controller`、`boot/config-editor`、`boot/hmr`、`boot/plugin-manager`、`browser-use/browser-use`、`client/ui-plugin-manager`、`client/ui-settings-account`、`client/ui-settings-agent-loop`、`client/ui-settings-shell`、`client/ui-settings-subagent`、`client/ui-settings-web-search`、`client/ui-sidebar-browser`、`client/ui-sidebar-terminal`、`compaction/compaction-image-offload`、`computer-use/computer-use`、`credentials/deepseek-account{,-platform}`、`deliverables/{tool-present,workspace-changes}`、`document/office-to-pdf`、`experimental/*`（auto-review、browser-use-*、computer-use-*、ptc-runtime-python、speech-to-text*、voice-input*）、`host/product-telemetry-otel`、`mcp/mcp-resources`、`preset/agent-preset{,-registry}`、`ptc-runtime/{ptc-runtime,ptc-runtime-node}`、`session/session-format-v3-to-v4`、`skill/{skill-office,tool-workspace-dependencies}`、`ssh/{ssh,fs-ssh,sandbox-ssh,subprocess-ssh}`、`util/lazy-require`、`workflow/workflow-ptc`。

移除包：`code-runtime/*`、`e2b/*`、`experimental/{agent-team-web-profile,code-runtime-python}`、`fs/tool-present`（→ `deliverables/tool-present`）、`preset/agent-presets`（→ `preset/agent-preset*`）、`settings/settings-file`、`workflow/workflow-worker-thread`。

#### C. 出厂能力变化（`packages/bundle/base/cordis.patch.yml`，条目 84 → 92）

逐条 diff（`git diff dsh-v0.1.5-rc.2..dsh-v0.1.7-rc.1 -- packages/bundle/base/cordis.patch.yml`）：

1. 新增 `tool-plugin-manager`（`@deepseek-ai/dsh-plugin-manager/tools`，`disabled: true`）与 `plugin-manager`（`@deepseek-ai/dsh-plugin-manager`，`disabled: !!js "!ctx.get('profileContext')"`）。
2. HMR：`@deepseek-ai/cordis-plugin-hmr`（`disabled: true`，`root: ['.']`）→ `@deepseek-ai/dsh-hmr`（`disabled: !!js "!ctx.get('profileContext')"`，`root: []`）——**profile 配置默认热重载**。
3. 新增 `config-editor`（`@deepseek-ai/dsh-config-editor`）。
4. **settings 行：`@deepseek-ai/dsh-settings-file` → `@deepseek-ai/dsh-settings`**（配置文档从 `$DSH_HOME/settings.yaml` 改为经 profile patch 持久化的 Config 表单）。
5. 新增 `authorization`（`@deepseek-ai/dsh-authorization`）。
6. 新增 `deepseek-account`（`@deepseek-ai/dsh-deepseek-account-platform`，desktop 平台条件启用）。
7. `workflow-worker-thread` → `ptc-runtime`（`@deepseek-ai/dsh-ptc-runtime-node`）+ `workflow-ptc`（`@deepseek-ai/dsh-workflow-ptc`）。
8. 工具结果内联阈值：`maxInlineBytes: 50000` → **`maxInlineTokens: 12500`（单位由字节改为 token）**。
9. 新增 `image-offload`（`@deepseek-ai/dsh-compaction-image-offload`，超图像预算时以占位符替换最旧图像并重试）。
10. `tool-ralph` 默认 **`disabled: true`**（行为翻转；注释给出 overlay 恢复写法）。
11. 新增 `mcp-resources`（`@deepseek-ai/dsh-mcp-resources`）。

#### D. 能力家族地图变化（`packages/README.md` 组表 diff）

- 移除组行：`e2b/`；新增组行：`ssh/`、`ptc-runtime/`、`computer-use/`、`browser-use/`、`deliverables/`、`document/`、`mcp/`。
- 措辞变化：`code-runtime/` → `ptc-runtime/`（"Code-execution capability family" → "PTC execution capability family"，引擎 worker-thread → sandboxed Node）；`experimental/` 由 "Private prototypes and internal-only plugins" → "Pre-stable prototypes with explicit private exceptions"（**实验包可公开发布**）；`host/` 由 "API gateway + HTTP route server" → "Web GUI host services, directory picking, application launch, plugin inventory, and product telemetry"。

#### E. 宿主 ctx 服务面变化（从 `packages/**/README.md` 抽取 `ctx.*` key，164 vs 136）

新增（选择集）：`ctx.browserUse(.providerName)`、`ctx.computerUse(.providerName)`、`ctx.configForms(.get/.whileServed/.developerTools)`、`ctx.documentPreviews`、`ctx.feedbackUi`、`ctx.hmr`、`ctx.invocation`、`ctx.jobController`、`ctx.officeToPdf`、`ctx.plugin`、`ctx.pluginPackages(.packageOf)`、`ctx.productTelemetry`、`ctx.profileContext`、`ctx.ptcRuntime(.language)`、`ctx.remote.job`、`ctx.remote.terminal`、`ctx.sidebarRight.mounted/.openResource`、`ctx.speechController`、`ctx.speechToText`、`ctx.ssh(.bootstrapPath/.nodeExecutable)`、`ctx.subprocess.spawnTerminal`、`ctx.terminalController`、`ctx.workspaceChanges`。

消失（README 不再提及）：`ctx.codeRuntime`、`ctx.e2b`、`ctx.remote.agentTeams`、**`ctx.settings`**、**`ctx.settingsScope`**。

#### F. 决定性的 LDVH 影响链（主调研员独立验证）

##### F1. 设置模型架构级重构 → `@deepseek-ai/dsh-settings` 公开面被替换（P0）

| 事实 | 证据 |
|---|---|
| 旧公开面 | `git show dsh-v0.1.5-rc.2:packages/settings/settings/src/index.ts`：`export abstract class SettingsProvider extends Service`（默认导出），`SettingsRegisterOptions`、`SettingsScope`、`SettingsSectionHooks`、`SettingsProvider.installSection` |
| 新公开面 | `git show dsh-v0.1.7-rc.1:packages/settings/settings/src/index.ts`：`export class SettingsForms extends Service`（默认导出）、`SettingsConflictError`、`redactSecrets`、`SettingsDescriptor`、`SettingsDescribeOptions` |
| 已安装宿主实测 | `node --input-type=module -e "import('@deepseek-ai/dsh-settings')"`（cwd = app 目录）→ exports: `SettingsConflictError, SettingsForms, default, redactSecrets`；`SettingsForms.inject = ["configEditor","profileContext"]`；原型方法 `constructor, importLegacyDocument, configure, invalidate, writable, documentPath, prepareDocument, describe, update, replace, mutate, write, schema` |
| **无 `register`** | 旧 `installSettingsSection` 内部调用 `sctx.settings.register(ns, schema, {base, validate})` 与 `scope.get()/scope.watch()`（`plugin/node_modules/@deepseek-ai/dsh-settings/lib/index.js:618-636`）→ 新服务无 `register`，必然失败 |
| LDVH 用法 | `plugin/lib/index.js:31` `import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings"`；`:76` `settingsNamespace("dsh-ldvh")`；`:338` `installSettingsSection(ctx, ns, schema, {}, {...})` |
| 新模型 | `.agents/notes/implemented/architecture/2026-09-19-profile-owned-live-configuration.md`：插件在**自己的 Cordis Config** 中声明每个可配置值，可热改字段用 `.volatile()`；Settings 只把这些字段枚举成表单（`SettingsForms.whileServed` / `configForms.get`）；profile 编辑器写 `cordis.patch.yml`；旧 `$DSH_HOME/settings.yaml` 在 Settings 启动后一次性导入（section id = entry id；`ui-developer-tools`→`ui-settings`、`ui-onboarding`→`ui-settings-general`、`shell`→平台 shell executor entry），文件先改名为 `settings.yaml.imported` 保证不重复导入 |

##### F2. 解析顺序把 LDVH 的 peer 请求指向宿主运行副本（P0 放大）

- 规则来源：`.agents/notes/implemented/architecture/2026-09-19-profile-resolution-lookup-order.md`（同日决策，实现位于 `packages/boot/app-boot/src/profile-resolution/resolver.ts`）。原文要点：profile 内部祖先链 ①`<profile>/node_modules/<pkg>/node_modules` ②`<profile>/node_modules` ③`$DSH_HOME/profiles/node_modules`（拦截层）④`$DSH_HOME/node_modules`；**linked root**（`link:` 到 profiles 树外的目录）在每个候选 `D/node_modules` 位置应用一条规则：该名字若在 `D/package.json` 的 `peerDependencies` 声明且运行时解析表提供该名字，则**使用运行时（宿主安装）的包**，物理副本不被读取；更近的物理候选仍优先于更远的 peer 声明。
- LDVH 现状（`plugin/package.json`）：`peerDependencies` 含 `@deepseek-ai/dsh-settings`（`^0.1.0-rc.6 || ^0.1.1-rc.2 || >=0.1.2-alpha.1 <0.2.0`）、`@deepseek-ai/dsh-host-webserver`、`@deepseek-ai/dsh-client-ui-primitives`；`devDependencies` 固定 `@deepseek-ai/dsh-settings: 0.1.0-rc.6`；安装形态为 `dsh-ldvh: link:/Users/dmh2002/DshProject/dsh-ldvh/plugin`（`~/.dsh/profiles/test/package.json`），profile 内 `node_modules/dsh-ldvh` 为指向该真实目录的符号链接 → 构成 linked root。
- 结论：运行时 `@deepseek-ai/dsh-settings` 解析到**宿主 0.1.7-rc.1**（`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-settings` 版本实测 `0.1.7-rc.1`），静态 import 的 `installSettingsSection` 不存在 → **ESM 链接期报 "does not provide an export named ..." → 整个 dsh-ldvh 单元加载失败**（不只是设置面失效）。
- 兜底情形（若某部署未启用 peer 拦截、退回物理副本 0.1.0-rc.6）：`installSettingsSection` 可加载，但调用 `ctx.settings.register()` 在新服务上不存在 → **运行时 TypeError**。两条路径都不成立，设置面必须重写。
- 版本范围陷阱：peer range `>=0.1.2-alpha.1 <0.2.0` **在语义上"允许"0.1.7-rc.1**，却在 API 上不兼容——半开区间不能替代 API 兼容性判断。

##### F3. 客户端服务改名 → `ctx.settingsScope` 不存在（P0）

- 旧：`ctx.settingsScope.bind(namespace, ...)`（LDVH `plugin/lib/client.js:962`；client 注入声明 `var inject = ["slots", "locale", "settingsScope"]`，`:953`）。
- 新：全仓 `packages/` 内 `settingsScope` 命中 **0 处**（`git grep -rn settingsScope dsh-v0.1.7-rc.1` 仅命中 `.agents/notes/**` 文档）；新机制为 `ctx.configForms`：`packages/client/locale/src/client/index.ts:554` `export const inject = ['slots','remote','configForms']`；`ui-settings-agent-loop/src/client/index.ts:47` `ctx.effect(() => ctx.configForms.whileServed([AGENT_LOOP_NS], () => ctx.slots.inject('plugins.item', ...)))`；`ui-settings-shell/src/client/index.ts:50` 同型。

##### F4. 已验证仍然兼容的接缝（主调研员独立核对，非子代理结论）

| 接缝 | 核对结果 | 证据 |
|---|---|---|
| `ctx.tools.guard` | ✅ 兼容（同步 guard，返回 string 拒绝、undefined 不变；有 disposer） | `packages/core/tools/src/index.ts:1126-1140`(新) vs `:1091-1105`(旧)，逐字同构 |
| `ctx.invariants.register` | ✅ 兼容（`ctx.invariants.register(PACKAGE_NAME, install)`） | `packages/core/agent-loop/src/invariant.ts:16,65`(新) vs `:16,64`(旧) |
| `ctx.webServer.register(route) -> ()=>void` | ✅ 逐字一致（`kind` exact/prefix，重复路径抛错） | `packages/host/webserver/src/index.ts:166-173` 两版本相同 |
| `@deepseek-ai/dsh-settings` 等 peer 包存在性 | ✅ 包都在（0.1.7-rc.1）：`dsh-host-webserver`、`dsh-client-ui-primitives`、`dsh-tools`、`dsh-client-ui-slots`、`dsh-client-locale` | app `node_modules/@deepseek-ai/*` 逐包实测版本 |
| `ctx.slots.inject('conversation.view')` / `settings.plugin.item` | ✅ 槽位名仍存在 | `packages/client/ui-chat/src/client/apply.ts:146-148`；`ui-settings-models/src/client/slot-contract.ts:11` |
| `ctx.inject(["betterSidebar"])`（LDVH 软依赖） | ⚠️ 宿主仓内两版本都无此名——它来自第三方插件 `dsh-better-sidebar@0.19.1`（`~/.dsh/profiles/test/package.json`），DSH 升级不直接涉及，但其自身对新宿主的兼容性需单独确认 | `git grep betterSidebar` 两 tag 均 0 命中 |

##### F5. 运行时环境基线（本机实测）

- LDVH 未装于 `desktop` profile；装于 **`test` profile**：`dsh-ldvh: link:/Users/dmh2002/DshProject/dsh-ldvh/plugin`，并同时装有 `dsh-better-sidebar@0.19.1`、`dshmarket@1.59.0`、`dsh-sub-cli`、`dsh-vision-router` 等 19 个 bundle。
- `test` profile patch 将 `desktop-shell` 配为 `mode: compatibility`、`networkExposure: loopback`。
- 宿主包安装位：`~/.dsh/profiles/node_modules/@deepseek-ai/*`（`dsh-settings` 实测 `0.1.7-rc.1`）；app 内 `node_modules/@deepseek-ai/*` 同为 0.1.7-rc.1。
- 工具链：`node`/`npm` 仅在 `/opt/homebrew/bin`，当前 shell PATH 默认不含 → 验证命令需显式加 PATH。

#### G. 待确认项（主调研员）

1. LDVH 在 0.1.7-rc.1 上的**真实加载失败形态**未做运行时复现（本次为静态调研 + 运行时版本核对；未启动宿主以免干扰本机会话）。建议以 `test` profile 做一次受控启动验证，收集真实错误码。
2. `ctx.userQuestions.ask` 的返回结构与选项语义（LDVH 依赖 `selected` 为数组）在新版是否变化——由第 7 线核对，需人工复核其结论。
3. `dsh-better-sidebar` 等第三方插件对 0.1.7-rc.1 的兼容性不在 DSH 仓范围内，需按其自身仓库评估。

## A.1 会话格式、持久化与数据兼容性

<!-- line: session-format -->
### 会话格式、持久化与数据兼容性调研（dsh-v0.1.5-rc.2 → dsh-v0.1.7-rc.1）

- 仓库：`/Users/dmh2002/DshProject/deepseek-harness`
- 基线：旧 `dsh-v0.1.5-rc.2` = `fb2c4b9e69`（2026-09-10），新 `dsh-v0.1.7-rc.1` = `46a7f68b09`（2026-09-23）
- 区间 commit 数：3304（`git rev-list --count dsh-v0.1.5-rc.2..dsh-v0.1.7-rc.1`）
- 全程只读：仅使用 `git log/show/diff/ls-tree/rev-list/grep`，未触碰工作树与索引。

#### 结论速览（表格）

| 主题 | 旧（0.1.5-rc.2） | 新（0.1.7-rc.1） | 性质 |
|---|---|---|---|
| `SESSION_FORMAT_VERSION` | `3` (`packages/core/session/src/types.ts:88`) | `4` (`…/types.ts:89`) | **破坏性** |
| catalog `currentVersion` | `3` | `4` | **破坏性** |
| catalog `currentEncoder` | `releasedV3SessionFormatCodec` | `releasedV4SessionFormatCodec` | **破坏性** |
| catalog `migrations` | `[v0→v1, v1→v2, v2→v3]` | `[…, v3→v4]`（新增 `@deepseek-ai/dsh-session-format-v3-to-v4`） | 兼容扩展 |
| 新包 `session-format-v3-to-v4` | 不存在 | 17 个 `src/*.ts` + 20 个 `tests/*.ts` | **新增** |
| V3 日志在新版可读 | — | ✅ 可读（链式迁移到 V4，读时内存准备） | 兼容 |
| V3 日志在新版**一定**可读 | — | ❌ 嵌套 `tool-result`、未知必需事件会拒绝 | **风险** |
| V4 日志在旧版可读 | — | ❌ `sessionFormatVersionRefusal` 直接拒绝 | **破坏性 / 不可回退** |
| 会话事件类型集合 | 56 个 | 59 个（+`developer/message`、`image/offload`、`workspace/changes`；无删除） | 兼容扩展 |
| `tool-result` content block | 存在于 `ContentBlockMap` | **已删除**；改为 `role:'tool'` 消息 | **破坏性** |
| 消息 `source` 形状 | `{kind:'plugin', plugin:'x'}` | `{kind:'x'}`（含重命名表） | **破坏性** |
| JSONL 路径/后缀/目录结构 | `session.jsonl` / `session.vN.jsonl[.zstd]` | **逐字未变** | 兼容 |
| 迁移后继文件 | — | 写打开时发布 `session.v4.jsonl[.zstd]` | **新增副作用** |
| `docs/persistence-changes/` | 不存在（0 文件） | 155 文件，6 条记录 | 新增 |
| 记录决策统计 | — | `same-version` 76 条（其中 59 条来自 baseline 全量清单）；`version-bump` **14 条** | — |
| 新包 `compaction-image-offload` | 不存在 | `image/offload` + message projection | 新增 |
| 新包 `workspace-changes` | 不存在 | `workspace/changes`（log-only，只带 turn） | 新增 |
| `session-log-deepseek` `enabled` 默认 | `false` | **`true`** | **隐私默认值翻转** |
| `host/product-telemetry-otel` | 不存在 | 新包，无 `enabled`，默认指向 DeepSeek collector | 新增 |
| `Session.eventAt/snapshotEvents/ownEvents` | 正常 API | 标记 `@deprecated`（新增 3 处） | **需适配** |

#### 1. 会话格式版本迁移

##### 事实

**1.1 版本常量与 catalog（逐字差异）**

`packages/core/session/src/types.ts`：`export const SESSION_FORMAT_VERSION = 3`（`:88`）→ `= 4`（`:89`）。

`packages/session/session-format-catalog/src/generated.ts` 由"直接组装"改为"静态选项 + 组装"两步，四项逐字变化：

| 字段 | 旧 | 新 |
|---|---|---|
| `currentVersion` | `3` | `4` |
| `codecs` | `[v0,v1,v2,v3]` | `[v0,v1,v2,v3,v4]`（追加 `releasedV4SessionFormatCodec`） |
| `currentEncoder` | `releasedV3SessionFormatCodec` | `releasedV4SessionFormatCodec` |
| `migrations` | `[v0→v1, v1→v2, v2→v3]` | `[…, sessionFormatV3ToV4]` |

新版导出 `sessionFormatCatalogOptions: SessionFormatCatalogOptions` 后再 `sessionFormatCatalog = createSessionFormatCatalog(sessionFormatCatalogOptions)`；三个 `restore*` 回调改为 `restoreReleasedV4Artifact` / `assertReleasedV4Header`。

`packages/session/session-format-catalog/src/index.ts` 新增三个导出：`createSessionFormatCatalogWithChildren`、`historicalSessionFormatCatalog`、`SessionFormatUnsupportedMigrationError`。

`…/src/current.ts` 唯一实质变化：`Session.fromRestore(...)` 多传第 6 个参数 `currentSessionMessageProjections`（来自新增的 `src/message-projections.ts`，内容为 `[imageOffloadProjection]`）。

catalog 新增 3 个源文件：

- `src/children.ts` → `createSessionFormatCatalogWithChildren(children)`：把某个父会话的历史子证据绑定进静态 catalog，替换 v3→v4 这一条边。
- `src/historical.ts` → `historicalSessionFormatCatalog`：`currentVersion: 3`，只用于收集迁移前置事实，**绝不发布也不补全父 catalog**。
- `src/message-projections.ts` → `currentSessionMessageProjections = [imageOffloadProjection]`。

**1.2 新包 `packages/session/session-format-v3-to-v4/`**

`package.json` 里声明了 `dsh.sessionFormatMigration`：

```json
"dsh": { "sessionFormatMigration": {
  "from": 3, "to": 4, "export": ".",
  "migration": "sessionFormatV3ToV4",
  "sourceCodec": "releasedV3SessionFormatCodec",
  "targetCodec": "releasedV4SessionFormatCodec",
  "targetHeaderValidator": "assertReleasedV4Header",
  "targetRestorer": "restoreReleasedV4Artifact" } }
```

`src/migration.ts` 的 `sessionFormatV3ToV4` 是 **header-only** 声明：

```ts
migrateHeader(header) { assertReleasedV3Header(header); return { ...header, version: 4 } },
createStage() {
  throw new SessionFormatUnsupportedMigrationError(
    'V3 catalog migration requires explicit historical child facts, including an empty array for a parent without children')
},
```

正文迁移必须经 `createSessionFormatV3ToV4(children)` 绑定子证据后才能构造 stage（空数组表示"显式声明无子会话"）。

迁移做了什么（`src/{migration,tool-role,sources,extension-identities,references,facts}.ts`）：

1. 逻辑 header `version: 3 → 4`（其余字段逐字保留）。
2. **扁平化 tool result**：`tool/result` 的 `data.message.role` 由 `'user'` 改 `'tool'`，去掉 `{type:'tool-result',toolCallId,content,isError?}` 包装，`toolCallId`/`isError` 提升到 message 顶层，`content` 直接取包装内数组；包装其它字段改名为 `plugin:result:<原名>`，message 其它字段改名为 `plugin:message:<原名>`。
3. **消息 source 改名**（`sources.ts` 的 `RENAMED_PRODUCERS`）：`compact→compact-checkpoint`、`tools-code-mode|tools-ptc→ptc-mode`、`dsh-compaction-basic→compact-basic`、`@deepseek-ai/dsh-system-prompt`（system 角色→`system-prompt`，其它角色→`runtime-context`）；25 个同名 first-party 生产者保留原名；其余 `plugin:x → plugin:plugin:x`。
4. **未知 ignorable 事件命名空间化**：`ignorable===true && !RELEASED_V3_EVENT_TYPES.has(type)` → `type='plugin:'+原type`。
5. **补写被中断的 turn 结束**：仅当"未关闭 step 的 open turn"后紧跟 `agent/inbox/spliced{target:'next-turn'}` 再跟下一个编号 `turn/start` 时，在其前插入 `turn/end{reason:{kind:'interrupted'}}`（commit `ad83cce36a`）。
6. **插入后密集重编号 + 引用重映射**（`references.ts`）：`sourceEventSeqs`、替换 `startSeq/endSeq`、`command/done.sourceEventSeq`、`session/title[.‑llm‑request].messageSeqs`、`compaction/summary|prune` 的 `shadowedRange/shadowedSeqs`、`image/offload.targets[].seq`。
7. **补写父级 `subagent/catalog`**：按 `childCreatedAt` → `childId` 排序；有 `subagent/descriptor` 写 version-0 事实，否则写 `{version:1,childId,childCreatedAt,mode:'unknown'}`；与已有条目冲突（时间戳/mode/label）直接拒绝。
8. **Delivery generation 守卫**：`session-log-deepseek/delivery-accepted` 若声称 `sessionFormatVersion===4` 则拒绝。

**1.3 明确的拒绝清单（即"并非所有 V3 都能读"）**

`src/tool-role.ts`：结果内再嵌 `tool-result` → `SessionFormatUnsupportedMigrationError('… contains a nested tool-result unsupported by this converter')`。
`src/migration.ts`：`!RELEASED_V3_EVENT_TYPES.has(event.type)` → `format v3 contains unknown event type …`；未 seeded 会话出现 `inherited:true` 标记；`sourceCut` 与标记不一致。
`src/retired-syntax.ts`（V4 原生准入也复用）：被解释位置出现 `type:'tool-result'` 的 block / `blockType:'tool-result'` 的 stream-start → 拒绝；`request/header.header.system` 存在（哪怕空）→ `format v4 request/header rejects retired header.system`；`tool/code-dispatch-start|tool/code-dispatch` 且非 ignorable → 拒绝。

##### 证据（路径 + commit）

- `packages/core/session/src/types.ts:88`（旧 `SESSION_FORMAT_VERSION = 3`）→ `:89`（新 `= 4`）
- `packages/session/session-format-catalog/src/generated.ts`（两版本 `git show` 对比，`currentVersion`/`codecs`/`currentEncoder`/`migrations` 四项逐字不同）
- `packages/session/session-format-catalog/src/{children,historical,message-projections}.ts`（新增）
- `packages/session/session-format-v3-to-v4/src/{index,codec,migration,tool-role,sources,extension-identities,references,facts,retired-syntax,validation}.ts`
- `packages/session/session-format-v3-to-v4/README.md`（"V3-to-V4 specification" 全表）
- 关键 commit：`669b724a78 feat(session): add the V4 integration format and retain V3 replay inputs`（2026-09-16）、`f4a32dbd0a refactor(llm): flatten tool results and validate native V4 sessions`（2026-09-18）、`0112eaf3a8 feat(session): finalize the accepted V4 compatibility baseline`（2026-09-18）、`ad83cce36a fix(session): repair missing turn ends during V3 migration (#4689)`

##### 对升级的影响

- **这是本次区间唯一的破坏性持久化变更**；`docs/persistence-changes/2026-09-16-session-format-v4.md` 的 14 条 `version-bump` 全部指向它。
- V3 及更早**在架构上可读**：catalog 的 `codecs` 覆盖 v0–v4，`migrations` 是完整相邻链 v0→v1→v2→v3→v4。
- V4 在旧版**不可读且不可回退**（详见 §3.5）。

#### 2. 新增 / 移除 / 改名的会话事件类型

##### 事实

`packages/core/session/src/known-event-types.ts` 是一份 **生成**（`scripts/gen-persistence-catalog.ts`）的全仓库事件词表。对两版本的 `KNOWN_SESSION_EVENT_TYPES` 集合做 `comm` 精确差集：

- **新增 3 个**：`developer/message`、`image/offload`、`workspace/changes`
- **删除 0 个**（56 → 59；文件行数 60 是因为新文件多了 `MESSAGE_PROJECTION_EVENT_TYPES` 里的一次 `'image/offload'`）

新文件末尾新增一个导出 `MESSAGE_PROJECTION_EVENT_TYPES: ReadonlySet<string> = new Set(['image/offload'])`，注释为"Event types whose model-visible effects require an explicit pure interpreter"。

`packages/core/session/src/types.ts` 的 `SessionEventMap` 变更：

- 新增 `'developer/message': { turn: number; step: number; message: DeveloperMessage; headerSeq?: SessionSeq }`——`headerSeq` 在存在 tool 新增时必须存在，指向更早的 `request/header` 以绑定历史 ToolSchema。
- 新增 `TurnEndReasonMap.forked: { kind: 'forked' }`（`turn/end.reason.kind` 取值由 3 个变 4 个）。
- 新增保留位 `EpochHeader.system?: never`（带 `@persistenceReserved`）。
- `tool/result.data.error` 由 `{name, code}` 扩展为 `{name, code, reason?}`。
- `SurfaceEventType` 联合新增 `'developer/message'`；`tool/result` 的 `data.message` 类型由 wrapper 变为 `ToolResultMessage`。
- 另有内容块层面的**删除**（同一破坏面）：旧 `packages/llm/llm/src/types.ts:102,118` 定义 `ToolResultBlock { type:'tool-result'; toolCallId; content; isError? }` 且 `ContentBlockMap` 含 `'tool-result'` 键；新版该文件内 `git grep "'tool-result'"` **零命中**。

V3 词表被冻结为新包内的一张常量表（不随当前 writer 漂移）：

`packages/session/session-format-v3-to-v4/src/extension-identities.ts` → `RELEASED_V3_EVENT_TYPES`。注意它**包含** `image/offload` 与 `workspace/changes`（二者是在 writer 仍为 v3 时加入的），但**不含** `developer/message`（V4 新增）。

##### 证据（路径 + commit）

- `packages/core/session/src/known-event-types.ts`（两版本 `grep -oE "^  '[^']+'," | sort` 后 `comm` 差集）
- `packages/core/session/src/types.ts`（`git diff … -- packages/core/session/src/types.ts`）
- `packages/llm/llm/src/types.ts`（旧版 `:102` `type: 'tool-result'`、`:118` `'tool-result': ToolResultBlock`；新版无命中）
- `packages/compaction/compaction-image-offload/src/projection.ts`（`declare module '@deepseek-ai/dsh-session/types'` 注入 `'image/offload'`，带 `@messageProjection`）
- `packages/deliverables/workspace-changes/src/types.ts`（注入 `'workspace/changes': { turn: number }`）
- commit：`f4a32dbd0a`、`e0bd7e1960 feat(session): add developer changes using historical tool schemas`（2026-09-18）

##### 对升级的影响

- 只有**新增**，没有改名或删除的事件名字符串 → 旧事件名读取端不需要改名适配。
- 但事件**载荷**发生了破坏性重写（见 §7.1），这才是真正的适配点。
- 新事件都是 log-only（`workspace/changes` 只带 `turn`；`image/offload` 只带 `targets`），不带 `surfaceOp`/`sourceEventSeqs`；一个把它们当作 surface 事件的旧插件会踩到"surface 事件必须带 surfaceOp"的校验。

#### 3. 持久化布局

##### 3.1 目录与文件名（逐字未变）

`packages/session/session-persistence-jsonl/src/format.ts` 的完整 diff 只有 4 个 hunk：2 处 import 变化 + `assertV3RowAdmission`→`assertV4RowAdmission` + `finish()` 增加 `assertReleasedV4Relationships`。所有路径构造函数逐字相同：

- `projectDir(root, cwd)` → `root/<projectKey(cwd)>`，`cwd` 为 `undefined` 时为 `root/_no-cwd`
- `sessionDir(root, cwd, id)` → `projectDir(root,cwd)/encodeSegment(id)`
- `generationLogFilename(version, compression)` → `session.jsonl`（v0）/ `session.v<N>.jsonl`，zstd 追加 `.zstd`
- `generationLogPath` / `logPath`（`logPath` = `SESSION_FORMAT_VERSION` 那一代 → 新版写到 `session.v4.jsonl[.zstd]`）
- `logSuffix(compression)` → `.jsonl.zstd` | `.jsonl`

`packages/session/session-format/src/filename.ts` 的 `sessionFormatLogFilename` / `parseSessionFormatLogFilename` 两版本逐字相同。

##### 3.2 迁移后继文件（新副作用）

`packages/session/session-persistence-jsonl/src/index.ts`：
- **读打开**只做内存准备（`prepareStoredMigration`），不落盘；测试 `tests/v3-restart-migration.spec.ts` 断言 `reader.header.version === 4` 且 `prepared` 长度比源多 1、`prepared[7].data.messageSeqs` 由 `[5]` 重映射为 `[6]`。
- **写打开**在 `this.publishStoredMigration(id, prepared)`（`index.ts:387`）发布 `session.v4.jsonl[.zstd]` 后继，**前代 `session.v3.jsonl` 保持原样**。

新增 `packages/session/session-persistence-jsonl/src/catalog-migration.ts`：收集直接子会话的 catalog 事实（`prepareCatalogFacts`），并对每个子文件记录 `dev/ino/size/mtimeNs/ctimeNs` 物理身份，在准备返回前与发布前各校验一次（`validateRelatedSources`）。

##### 3.3 索引 / 游标 / 其他持久化存储

- 未引入任何新的索引或游标文件；`findLog` / `resolveGenerationInDirectory` / `assertStoredIdentity` 逐字未变（仅在 `index.ts` 中行号位移）。
- `SessionPersistence`（`packages/session/session-persistence/src/index.ts`）新增 `readonly identity: symbol = Symbol('sessionPersistence')`（进程内实例身份，服务替换后会变）。
- `session-projection-cache` 的持久化文档版本仍是 `version: 7`（`src/spec.ts:103` 两版本相同）；`src/spec.ts` 唯一变化：行内 `val` 校验由 `z.json()` 改为 `z.custom<JsonValue>(isJsonValue, …)`（更严格的**无损 JSON** 校验）。新增 fixture `tests/fixtures/v7-opaque-session-doc.json`（含 `__proto__` / `constructor` 字面键）。
- `session-stats`、`session-checkpoint-policy` 仅有 README/package.json 与测试变动，无持久化布局变化。

##### 3.4 attachment 存储

- **持久**附件根目录未变：`packages/attachment/attachment-local/src/index.ts` 中 `this.root = join(dshHome, 'attachments', 'v1')`（旧版写法是 `resolve(join(resolveDshHome(...), 'attachments', 'v1'))`，解析结果等价）。
- **新增** 请求期图像变体缓存根：`this.cacheRoot = dshCachePath({ dshHome }, 'attachments')`，由 `packages/util/home-paths/src/index.ts:108` 定义为 `join(resolveDshHome(dshHome), 'cache', 'attachments')`，即 `<DSH_HOME>/cache/attachments`。变体 id 计算改用 `requestImageVariantId(ref, target)`（旧名 `ImageRequestPolicy` → 新名 `ImageRequestTarget`）。
  → 这是**派生缓存搬迁**，旧的请求变体缓存不会再被复用（会重新生成），但不影响持久数据可读性。
- 新增 `src/sharp.ts`（延迟加载 sharp）与 `tests/lazy-sharp-failure.spec.ts`。

##### 3.5 V4 日志在旧版的不可读性（含"影子遮蔽"放大效应）

旧 `packages/session/session-persistence/src/errors.ts:133-137`：

```ts
return version > SESSION_FORMAT_VERSION
  ? `session "${id}" uses log format v${version}, but this harness reads only v${SESSION_FORMAT_VERSION}: the log was written by a newer harness — upgrade the harness to open it`
  : `…older than the supported v${SESSION_FORMAT_VERSION}, and this build ships no upgrade path for it`
```

旧版 `SESSION_FORMAT_VERSION = 3`，所以读到 v4 header 必然落入 `SessionFormatUnsupportedError`（旧 `index.ts` 的 `if (selected.sourceVersion > SESSION_FORMAT_VERSION)` 分支，注释明写 `// v8 ignore next -- readGenerationHeader rejects every future version.`）。

**放大效应**：`resolveGenerationInDirectory`（两版本逐字相同）用 `generations.sort((l,r) => r.version - l.version)[0]` 选**版本号最大**的文件。因此只要 0.1.7-rc.1 对某旧会话做过一次**写打开**（发布 `session.v4.jsonl.zstd`），此后用 0.1.5-rc.2 打开它就会命中最高的 v4 文件并被拒绝——**即使可读的 `session.v3.jsonl.zstd` 仍完好地躺在同一目录里**。

##### 证据（路径 + commit）

- `packages/session/session-persistence-jsonl/src/format.ts`（diff 仅 4 hunk）
- `packages/session/session-persistence-jsonl/src/index.ts:387`（`publishStoredMigration` 调用点）、`:1447-1483`（`resolveGenerationInDirectory`）、`:624-691`（`prepareStoredMigration`）、`:692-717`（`publishStoredMigration`）
- `packages/session/session-persistence-jsonl/src/generation.ts`（`PrepareJsonlMigrationOptions.validateRelatedSources`、`readDecodedJsonlSource`）
- `packages/session/session-persistence-jsonl/tests/v3-restart-migration.spec.ts`（读准备 → 写发布 → 重开不重复修复）
- `packages/session/session-persistence/src/errors.ts:133-137`、`…/src/index.ts`（`identity` symbol）
- `packages/attachment/attachment-local/src/index.ts`、`packages/util/home-paths/src/index.ts:108-111`
- commit：`1d1ae1a5af fix(session): migrate historical subagents to V4`（2026-09-16）、`f44b78a622 fix(session): complete parent catalogs while isolating child failures`

##### 对升级的影响

- 路径布局零迁移成本：不需要移动或重命名任何会话文件。
- **回退是单向门**：一旦 0.1.7-rc.1 写过某个会话，0.1.5-rc.2 就打不开它了（除非人工删除 v4 后继文件）。升级前必须做整目录备份。
- 请求图像变体会在 `<DSH_HOME>/cache/attachments` 重建，不丢失数据但会重算一次。

#### 4. `docs/persistence-changes/` 区间新增记录统计

##### 事实

`git ls-tree -r --name-only dsh-v0.1.5-rc.2 -- docs/persistence-changes/` → **0 个文件**（旧 tag 完全没有这个目录）；新 tag → **155 个文件**。因此目录内全部内容都是区间新增。

目录构成：6 条带日期的记录 + `README*` + `finalized/v4.json` + `historical-formats/{v0,v1,v2,v3}` + `releases/`（37 个历史版本记录）。

**6 条记录逐条决策数（英文机器声明 `decision:` 计数）**

| 记录 | same-version | version-bump | 备注 |
|---|---:|---:|---|
| `2026-09-11-initial.md` | 59 | 0 | `baseline: true`，是全量清单（`JsonlHeaderLine`、`SessionEventEnvelope`、`SessionHeader` + 全部事件根） |
| `2026-09-12-auto-review-error-metadata.md` | 2 | 0 | PTC dispatch 结构化错误元数据、原生 tool error 的可选 reason |
| `2026-09-14-image-offload.md` | 13 | 0 | `image/offload`（含被 `Message`/`ContentBlock` 传递影响的根） |
| `2026-09-14-workspace-changes-event.md` | 1 | 0 | `workspace/changes` |
| **`2026-09-16-session-format-v4.md`** | **0** | **14** | 全部 version-bump |
| `2026-09-20-unknown-child-catalog.md` | 1 | 0 | `subagent/catalog` 用 `data.version` 增加未知 mode 变体 |
| **合计** | **76** | **14** | 其中 59 条是 baseline 清单，非真实变更 |

**14 条 version-bump 的具体条目**（root / previous / decision）

1. `SessionHeader` ← `2026-09-11-initial` → **version-bump**（version 3→4）
2. `event:agent/inbox/spliced` ← `2026-09-14-image-offload`
3. `event:assistant/attempt` ← `2026-09-14-image-offload`
4. `event:assistant/message` ← `2026-09-14-image-offload`
5. `event:compaction/summary` ← `2026-09-14-image-offload`
6. `event:developer/message` ← `null`（**全新根**）
7. `event:request/header` ← `2026-09-11-initial`（记录被禁用的 `header.system`）
8. `event:session/title-llm-request` ← `2026-09-14-image-offload`
9. `event:system/message` ← `2026-09-14-image-offload`
10. `event:team/message/queued` ← `2026-09-14-image-offload`
11. `event:tool/ptc-dispatch` ← `2026-09-14-image-offload`
12. `event:tool/result` ← `2026-09-14-image-offload`
13. `event:turn/end` ← `2026-09-14-image-offload`（新增 `forked` reason）
14. `event:user/message` ← `2026-09-14-image-offload`

记录自身解释了为什么"10 个事件根"一起动：它们都内嵌共享的 `Message` / `ContentBlock` 声明，移除 `tool-result` 联合分支并细化 message role 会同时改变这些可达 schema。

另有 `docs/session-format-status.md` 新增 `## Finalization record` 段：`latestFinalizedVersion: 4`，并把 `latestReleasedVersion: 3` / `evidenceTag: dsh-v0.1.5-alpha.1` 的表述改为只引 tag + 路径（不再外链 GitHub）。

##### 证据（路径 + commit）

- `git ls-tree -r --name-only <tag> -- docs/persistence-changes/ | wc -l` → `0` / `155`
- `git show dsh-v0.1.7-rc.1:docs/persistence-changes/<record>.md | grep -c 'decision: same-version'`（逐条计数）
- `docs/persistence-changes/README.md`（兼容规则表：新增可选属性 / 新增普通事件 / 新增更高 `data.version` 分支 → `same-version`；必选化、类型变更、删除改名、header 或 envelope 变更 → `version-bump`）
- `docs/session-format-status.md`（`+## Finalization record` 与 `latestFinalizedVersion: 4`）
- 新增 commit：`1e9b05d356`(09-11)、`ee9ae1d0e0`(09-12)、`aea077ac75`(09-12)、`38070996c1`(09-13)、`669b724a78`(09-16)、`0112eaf3a8`(09-18)、`17a52a8fe3`(09-20)

##### 对升级的影响

- 兼容性判定有**机器可校验的一手来源**：`version-bump` 只有 14 条且全部集中在 V4 那一条记录 → 本次升级的破坏面被官方收敛为"一次 header 版本跃迁 + 一个记录在案的新事件根"。这条结论可以被独立复核（重跑上面两条计数命令即可）。
- `finalized/v4.json` 是"已接受的 V4 基线"，意味着 V4 之后可以继续做**同版本**的向后兼容新增，不必每次再升版本。

#### 5. 压缩与卸载（`compaction-image-offload` / `workspace-changes`）

##### 事实

**5.1 `packages/compaction/compaction-image-offload`（新包）**

插件名 `compaction-image-offload`，`inject = ['agents','sessions']`，无 Config（挂载即生效）。写入会话的内容只有一种形态：

```ts
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** @messageProjection */
    'image/offload': { targets: ImageOffloadTarget[] }
  }
}
export interface ImageOffloadTarget { seq: SessionSeq; imageIndexes: number[] } // 严格递增的图像序号
```

- 追加点：`offloadOldestImages(session, sourceEventSeqs, count)` → `session.append('image/offload', { targets })`（`src/image-offload.ts:44`）。
- 触发点两处（`src/index.ts`）：`agent/request-error` 的 `IMAGE_OFFLOAD_REQUIRED_CODE` + `failure.offloadImages`；`compaction/summary-error` 的同类 `LlmError`。两者都返回"重试"且**不消耗重试预算、不写 retry 事件**。
- 它注册 message projection：`ctx.sessions.registerMessageProjection(imageOffloadProjection)`。`project()` 校验 `data` 只有 `targets`、每个 target 只有 `seq`/`imageIndexes`、`seq` 必须是当前 surface 的 `user/message|tool/result` 节点、序号严格递增，再返回把这些图像块标记为 `offloaded: true` 的消息副本。
- 关键结论：**日志只记录"哪些序号被卸载"，消息改写是纯函数重放**。这正是 `MESSAGE_PROJECTION_EVENT_TYPES = {'image/offload'}` 与 catalog `currentSessionMessageProjections` 的由来。

**5.2 `packages/deliverables/workspace-changes`（新包）**

插件名 `workspace-changes`，`inject = ['subprocess']`，`ctx.provide('workspaceChanges', service)`；Config 默认 `timeoutMs:30_000`、`outputMaxBytes:8MiB`、`maxFiles:500`、`maxFileBytes:2MiB`、`diffTimeoutMs:100`。

- **只对顶层会话生效**：`eligible()` 在 `origin==='subagent' || delegationDepth>0` 时跳过。
- 写入会话的内容只有一行：`this.session.append('workspace/changes', { turn: state.turn })`（`src/recorder.ts:354`）。
- **摘要本身不落盘**（`src/types.ts` 注释："the summary itself stays on the Host and is served by `workspaceChanges.summary` for the event's sequence while the Session lives"）。摘要含 `turn/cwd/files[]/total/added/deleted/snapshot?`；`diff(sessionId, seq, index, signal)` 按需返回前后对比。
- 同一 turn 的**最新事件取代更早的**；turn 内最终为空列表且已有记录时不再追加。
- 数据来源：turn 起止 git 工作树快照 + 每个文件工具编辑前后的整文件捕获；不在 git 仓库或无 git 时只列文件工具编辑。

##### 证据（路径 + commit）

- `packages/compaction/compaction-image-offload/src/{index,projection,image-offload,project-message}.ts`、`package.json`
- `packages/deliverables/workspace-changes/src/{index,types,recorder}.ts`
- `packages/session/session-format-catalog/src/message-projections.ts`、`packages/core/session/src/index.ts`（`registerMessageProjection`/`messageProjections`）
- 记录：`docs/persistence-changes/2026-09-14-image-offload.md`、`docs/persistence-changes/2026-09-14-workspace-changes-event.md`（均为 `same-version`）

##### 对升级的影响

- 两者都只**新增** log-only 事件，对旧读取端是纯增量；但**依赖 projection 才能还原模型可见内容**：任何自己从事件流推导消息的插件，如果不应用已注册的 message projection，就会**把被卸载的图片重新塞回请求**（`deriveEventMessage` 在 V4 已改为经 `surfaceManager` 走 projection）。
- `workspace/changes` 的**变更文件清单不在日志里**。任何离线分析、跨进程回放、或事后审计工具都无法仅凭会话文件还原"这一轮改了哪些文件"——必须在线通过 `workspaceChanges` 服务取。这是设计取舍，需要在会话归档/上传场景里显式确认（会话日志上传会给 DeepSeek 发 `workspace/changes{turn:N}` 这个空壳）。

#### 6. 会话日志上传 / 遥测默认值

##### 事实

**6.1 `session-log-deepseek`（默认值翻转）**

`packages/session/session-log-deepseek/src/index.ts`：

```ts
// 旧
/** Contribute `dsh_session_log` to official DeepSeek requests. Defaults to `false`. */
export interface Config { enabled?: boolean }
export const Config: z<Config> = z.object({ enabled: z.boolean().default(false) })

// 新
/** Contribute `dsh_session_log` to official DeepSeek requests. Defaults to `true`. */
export const Config: z<Config> = z.object({ enabled: z.boolean().default(true) })
```

配套文档同步翻转：

- `packages/session/session-log-deepseek/README.md` 配置表：`| enabled | false | 注册…设为 true 选择启用` → `| enabled | true | 注册…设为 false 停止上传`；正文 `Enable it only when…` → `Disable it only when…`。
- `apps/cli/reference/README.md:129`：`Enable the [DeepSeek session-log contributor] to send…` → `The [DeepSeek session-log contributor] sends complete unaccepted log suffixes with subsequent DeepSeek requests **by default**, including requests sent through configured gateways; set its enabled configuration to false to opt out.`
- 同一 commit 内 `wireEvent` 的 `switch` 新增 `case 'developer/message':`（与 `system/message`/`user/message`/`tool/result` 同组，即 V4 的 developer 事件也会随日志上传）。
- 上传字段语义同步更新：仅 `system`、`user`、`tool` 事件可携带 `sourceEventSeqs`（旧文档写"仅 user 与 tool"）。

**6.2 `host/product-telemetry-otel`（新包）**

`packages/host/product-telemetry-otel/src/index.ts` 在旧 tag **不存在**（`git show dsh-v0.1.5-rc.2:…` → `fatal: path … does not exist`），是本区间新增。其 `Config` 默认值：`endpoint: 'https://dsh-otel-collector.deepseeksvc.com/v1/logs'`、`channel: 'dsh_otel_report'`、`compression`（可选 `none|gzip`）、`maxExportBatchSize: 512`、`maxQueueSize: 2048`、`scheduledDelayMillis: 30000`、`timeoutMillis: 15000`、`exportTimeoutMillis: 20000`、`shutdownTimeoutMillis: 21000`；`serviceName` / `serviceVersion` 为 `required()`。

**没有任何 `enabled` 字段**——"是否启用"完全等于"是否被组合挂载"；`serviceName`/`serviceVersion` 必填意味着未显式配置时挂载会失败，属于"必须显式选择加入"的设计。在 `apps/` 下没有找到 `product-telemetry-otel` 的挂载点（只有 `packages/host/product-telemetry-otel/tests/fixtures/telemetry.patch.yml` 这个测试夹具），基础 CLI 组合挂载的是 `session-telemetry-otel`（`apps/cli/composition.md:77-78`、`:232`）。

**6.3 `session-telemetry-otel`（默认值未变）**

仅两处适配改动（`Session.fromRestore` 多传 `ctx.sessions.messageProjections`、`eventAt` 加 lint 抑制注释）与测试变化；OTel 行 id `session-telemetry-otel`、`DSH_TELEMETRY_MODE`（默认 `FEEDBACK_ONLY`）、`DSH_TELEMETRY_DISABLED`、`DSH_TELEMETRY_OTLP_URL` 语义两版本一致。

##### 证据（路径 + commit）

- `packages/session/session-log-deepseek/src/index.ts`（`enabled: z.boolean().default(false)` → `default(true)`，diff hunk `@@ -36,13 +36,13 @@`）
- `packages/session/session-log-deepseek/README.md` / `README.zh.md` 配置表；`apps/cli/reference/README.md:129`（两版本逐字对比）
- `packages/host/product-telemetry-otel/src/index.ts`（新文件，171 行）；`apps/cli/composition.md:77-78,232`（基础组合只挂 `session-telemetry-otel`）

##### 对升级的影响

- **隐私默认值是本次升级最容易被忽略的行为变化**：升级后只要宿主仍挂载 `session-log-deepseek`（shipped profile 一直挂载），就会**默认**把尚未确认接收的完整会话日志后缀随 DeepSeek 请求上传，包含消息文本、工具参数与结果、工作区路径；旧版默认不上传。
- 想保持旧行为必须显式配置 `{ id: 'session-log-deepseek', config: { enabled: false } }`（`apps/web/tests/scaffold.ts:569` 就是这个写法）。
- `host/product-telemetry-otel` 无 `enabled`，是"不挂载就不启用"；升级不会被动引入它，但其存在意味着需要人工确认是否纳入部署。
- `session-telemetry-otel` 的 OTel 开关**不控制** DeepSeek 贡献（文档原文："These OTel settings do not enable or disable the DeepSeek contribution"），必须单独用 `enabled:false` 关。

#### 7. 对下游插件（宿主侧 Cordis 插件）的影响

##### 7.1 读取会话事件流的插件：**必须适配的破坏性项**

| # | 变化 | 旧写法 | 新写法 | 证据 |
|---|---|---|---|---|
| 1 | `tool/result` 消息 role 由 `'user'` 改 `'tool'`，`tool-result` 包装被移除，`toolCallId`/`isError` 提升到 message 顶层 | `event.data.message.content[0].isError` | `event.data.message.isError`（`toolCallId` 同理） | `packages/session/session-telemetry/src/coordinator.ts` 的 `severityOf()` diff 就是这个改法 |
| 2 | `ContentBlockMap['tool-result']` 类型已删除 | `if (block.type === 'tool-result')` | 只能按 `role:'tool'` 的消息处理 | 旧 `packages/llm/llm/src/types.ts:102,118`；新版该文件内 `'tool-result'` 零命中 |
| 3 | 消息 `source` 由插件包装改为生产者归属 | `{kind:'plugin', plugin:'tools-ptc'}` | `{kind:'ptc-mode'}`（改名表见 §1.2 第 3 条；未知插件为 `{kind:'plugin:<原名>'}`） | `packages/session/session-format-v3-to-v4/src/sources.ts` |
| 4 | 创建/恢复 Session 需要显式 message projections | `Session.fromRestore(id, events, header, count, 'detached')` | 第 6 个参数 `projections`（用 `ctx.sessions.messageProjections`） | `packages/session/session-format-catalog/src/current.ts`、`session-telemetry-otel/src/index.ts`、`session-persistence-jsonl/src/generation.ts` 三处 diff |
| 5 | 同步事件读取 API 被弃用 | `session.eventAt(seq)` / `snapshotEvents()` / `ownEvents()` | 新代码禁止使用（3 处新增 `@deprecated`，见 `packages/core/session/src/index.ts:628,641,660`） | 旧版该文件 `@deprecated` 计数 0，新版 3；策略见 `.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md` |
| 6 | `turn/end.reason.kind` 新增 `'forked'` | `switch` 只处理 `completed/error/interrupted` | 必须处理 `forked`（fork 精确切点会用 `TOOL_NOT_STARTED`/`TOOL_OUTCOME_UNKNOWN` 合成结果） | `packages/core/session/src/types.ts` `TurnEndReasonMap` |
| 7 | 遥测/lifecycle 游标语义由 `firstLiveSeq` 改为 `firstLifecycleSeq` | `session.firstLiveSeq` 判断起点 | `session.firstLifecycleSeq`（fork seed 可能已含子自有标记与合成收尾） | `packages/session/session-telemetry/src/coordinator.ts` diff |
| 8 | `image/offload` 必须经 projection 才能还原模型可见消息 | 自己拼 content | 用注册过的 `SessionMessageProjection`（`deriveEventMessage` 已走 `surfaceManager`） | `packages/compaction/compaction-image-offload/src/projection.ts`、`core/session/src/index.ts` |
| 9 | `SessionEventMap` 新增 3 个成员 | 穷举 `switch` 无 default 会编译失败 | 必须显式处理或 `default` 分支兜底 | `known-event-types.ts` 差集 |
| 10 | `SessionPersistence` 新增 `identity: symbol` | 用对象引用比较后端 | 用 `identity` 比较（Context 代理下引用会变） | `packages/session/session-persistence/src/index.ts` diff |

##### 7.2 自行写入 JSONL 或复制会话文件的插件

- 版本 3 不再是合法写入代；`logPath` 现在落在 `session.v4.jsonl[.zstd]`。
- 迁移后的引用会被**重编号**：如果插件在日志里写过 `sourceEventSeqs`、`shadowedRange`、`messageSeqs`、`image/offload.targets[].seq`、`command/done.sourceEventSeq`，V3→V4 迁移会重写它们，插件自己缓存过的序号会失效。
- 读旧会话时不要假设 `header.version` 等于磁盘文件名里的版本号：新版读打开后 `header.version` 恒为 4，而物理文件仍是 `session.v3.jsonl`。

##### 7.3 兼容性判断

- **旧版读新版**：不行（§3.5），且由于 `resolveGenerationInDirectory` 取最高版本文件，v4 后继会**遮蔽**同目录里仍可读的 v3 文件。
- **新版读旧版**：架构上可行，但有明确的拒绝清单（§1.3）。若某条 V3 会话日志里含嵌套 `tool-result`（例如某个第三方工具曾经把结果再包一层），新版会以 `SessionFormatUnsupportedMigrationError` 拒绝且**不发布后继、不修改源文件**——即该会话在 0.1.7 下彻底打不开。
- **第三方插件自定义事件**：V3→V4 迁移对 `ignorable === true` 的未知事件做 `plugin:<原名>` 命名空间化并保留 payload；`ignorable !== true` 的未知事件直接拒绝。所以第三方插件写的自定义事件**必须**带 `ignorable: true`，否则会阻塞整条会话的迁移。

##### 证据（路径 + commit）

- `packages/session/session-telemetry/src/coordinator.ts`（`isError` 与 `firstLifecycleSeq` 的 diff）
- `packages/core/session/src/index.ts`（`@deprecated`×3、`messageProjections`、`registerMessageProjection`、`firstLifecycleSeq`）
- `packages/session/session-format-catalog/src/current.ts`、`packages/session/session-format-v3-to-v4/src/extension-identities.ts`
- `docs/persistence-changes/2026-09-16-session-format-v4.md` 的 Compatibility 段

#### 待确认项

1. **本仓库（LDVH）自己的宿主侧插件是否直接读会话事件流或会话文件**——需要逐个体检插件 inventory。任何用到 `event.data.message.content[0].isError`、`block.type === 'tool-result'`、`source.plugin`、`session.eventAt`、`Session.fromRestore(...5 args)` 的地方都必须改。
2. **本地现存会话日志中是否存在嵌套 `tool-result` 或非 ignorable 的未知事件**（会导致迁移直接拒绝）。建议在升级前用一个只读脚本扫描 `~/.dsh`（或实际 `DSH_HOME`）下所有 `session*.jsonl*`，统计 header `version` 分布与可疑 payload。
3. **升级前是否已备份整个会话根目录**——回退是单向门。一旦 0.1.7-rc.1 写过某会话，0.1.5-rc.2 会因"最高版本文件"规则被 v4 后继挡住。
4. **是否要显式保留 `session-log-deepseek.enabled = false`**——默认值已翻转为 `true`，涉及把会话完整后缀（含消息文本、工具参数与结果、workspace 路径）发往 DeepSeek 官方 API，包括经网关的请求。这是必须由人决定的产品/隐私决策，不是技术默认值。
5. **部署是否引入 `host/product-telemetry-otel`**——它是本区间新增、无 `enabled` 开关、默认 endpoint 指向 `dsh-otel-collector.deepseeksvc.com`，基础 CLI 组合未挂载；若下游 profile 会挂载，需要单独确认。
6. **`workspace/changes` 的变更清单不落盘**——若有"会话归档 / 事后审计 / 跨机回放需要列出每轮改了哪些文件"的需求，这个设计不满足，需要另建持久化。
7. **`docs/persistence-changes/` 是否要纳入下游的兼容性门禁**——它提供了可机器复核的一手来源（`decision` 字段 + `finalized/v4.json`），但仓库内验证脚本（`scripts/persistence-finalization.ts`、`pnpm run verify-persistence-catalog`）是否在下游 CI 运行尚未确认。
8. **`session-format-v3-to-v4` 的 `RELEASED_V3_EVENT_TYPES` 是硬编码冻结表**——如果区间内还有第三方向 V3 写入过自定义事件名，它们不在表内，会被命名空间化为 `plugin:<原名>`。需要确认是否存在这类历史日志。
9. **`session-projection-cache` 的 `val` 校验收紧**（`z.json()` → `isJsonValue`）——现存 checkpoint 行若含非无损 JSON（如 `undefined`、函数残留、`NaN`）会从"可读"变为"读失败"。建议扫描现有 `storage-domain` 数据。

## A.2 插件体系、bundle/profile/loader、CLI 与安装生命周期

<!-- line: plugin-system -->

### 插件体系、bundle/profile/loader、CLI 与安装生命周期

基线：旧 = `dsh-v0.1.5-rc.2`，新 = `dsh-v0.1.7-rc.1`（3304 commits）。全部结论来自只读 `git log/show/diff/ls-tree/grep`，未改动工作树。

#### 结论速览（表格）

| 主题 | 0.1.5-rc.2（旧） | 0.1.7-rc.1（新） | 对第三方插件的影响 |
|---|---|---|---|
| 插件管理服务 | 仅桌面独立界面 `apps/desktop/renderer/plugin-manager.*` | 新包 `packages/boot/plugin-manager`，服务名 **`ctx.pluginManager`** | 新增能力，非破坏 |
| `ctx.pluginPackages` | 不存在（app-boot 仅 2 个源文件） | **存在但属于 app-boot**（包元数据/运行时解析），与 plugin-manager 无关 | 易混淆，勿当作安装器 |
| Optional Bundles | 不存在 | `OPTIONAL_BUNDLES` 常量，2 个官方实验组合包 | 封闭列表，第三方无法加入 |
| `dsh.bundle.patch` | `string` | `string \| string[]`（**加宽，向后兼容**） | 旧写法仍有效 |
| `dsh.client` | `platform/inject/immediately/external` | **完全不变** | 无影响 |
| `cordis.patch.yml` 方言 | `insert/override/group/disabled/isolate/!!js` | **完全不变**（`PatchOptions` 逐字相同） | 无影响 |
| profile 解析模式 | link / runtime / dual 三模式并存 | **仅 runtime**，link 与 dual 删除 | 开发者 `npm link` 需改声明方式 |
| `dsh.profile.patchReload` | `live` / `startup` | **字段删除** | 写了该字段的 profile 需清理 |
| `sanitizeProfile()` | 不存在 | 新增，仅供 Desktop 致命恢复 | 第三方不应调用 |
| HMR | 无独立包，app-boot 内 `watchUserPatches` | 新包 `packages/boot/hmr`，`ctx.hmr` | 新增能力 |
| 配置编辑 | 无 | 新包 `packages/boot/config-editor`，`ctx.configEditor` | 新增能力 |
| **设置体系** | `ctx.settings.register()` + `settings-file` | **`settings-file` 删除；`register()` 消失** | **最严重破坏性变更** |
| 客户端设置槽位 | `settings.plugin.item` + `ctx.settingsScope` | **两者均删除**，改到 Plugins 页 `plugins.*` | **客户端面板需重写** |
| CLI | `dsh plugin --profile X <pnpm-args>` | 同上 + `dsh <name>` 简写 + 3 个版本豁免子命令 | 基本兼容 |
| `file:`/`link:` 安装 | 支持（相对路径锚定） | **仍支持**（`anchorPathSpec` 迁移到 plugin-manager） | 无影响 |

---

#### 1. 新增 `packages/boot/plugin-manager`

##### 事实

- 新包名 `@deepseek-ai/dsh-plugin-manager`，版本 `0.1.7-rc.1`，位于 `packages/boot/plugin-manager/`。
- **服务名是 `ctx.pluginManager`**（`super(ctx, 'pluginManager')`），`static inject = ['loader', 'profileContext']`。
- **`ctx.pluginPackages` 是另一个包的服务**：`packages/boot/app-boot/src/profile-resolution/service.ts:66` 的 `PluginPackages`，负责包元数据查询（`packageOf` / `metaOf` / `replace`）与运行时解析拦截，**不是安装器**。调研中极易把两者混为一谈，必须区分。
- 对外 API（`src/index.ts`）：

| 方法 | 作用 |
|---|---|
| `listPlugins()` | 当前 profile 的行清单，带 `patchId` 或 `readOnlyReason` |
| `listBundles()` | 组合包清单（含 `optional` / `removable` / `rows` / `overrides` / `error`） |
| `registries()` | 配置的注册表集合 |
| `inspect(spec, options?, signal?)` | 安装前读 spec（`pnpm view` / 读 package.json） |
| `setPluginEnabled(id, enabled)` | 写 profile patch 的 `disabled` |
| `setBundleEnabled(name, enabled)` | 改 `dsh.profile.bundles` |
| `installBundle(spec, options?)` | 安装（带 `requestId`） |
| `waitForInstall(requestId)` / `cancelInstall(requestId)` | 恢复丢失响应 / 取消 |
| `removeBundle(name)` | 卸载 |
| `listVersionExemptions()` / `setVersionExemption(pkgVer, rtVer, enabled, acceptRisk?)` | 版本兼容豁免 |

- 事件：`plugin-manager/changed`、`plugin-manager/install-log`、`plugin-manager/install-state`。
- 配置项：`pnpmCommand`、`outputBytes`(16384)、`lockWaitMs`(120000)、`inspectTimeoutMs`(20000)、`githubConnectionTimeoutMs`(5000)、`idleTimeoutMs`(600000)、`registry`、`fallbackRegistries`(默认 `['https://registry.npmmirror.com/']`)。
- 与 Web `packages/client/ui-plugin-manager`（`@deepseek-ai/dsh-client-ui-plugin-manager`）的关系：后者是**侧边栏 "Plugins" 页**，是前者的消费者。其 Host 半边只提供一个独立服务 `ctx.pluginRegistryProbe`（`pluginRegistryProbe`），做 npm/npmmirror 并行 ping。
- **旧版桌面独立 plugin manager 已删除**：旧版存在于 `apps/desktop/renderer/plugin-manager.html` + `plugin-manager.js` + `plugin-manager.css`；新版 `apps/desktop/renderer/` 只剩 welcome / mandatory-update / policy-login 等文件。
- 管理组件受保护：`src/index.ts` 的 `protectedModules` 集合列出 `@deepseek-ai/dsh-plugin-manager`、`dsh-hmr`、`dsh-host-webserver`、`dsh-tools` 等，管理器不能卸载自己或这些组件。

##### 证据（路径+commit）

- `packages/boot/plugin-manager/src/index.ts:176`（类）、`:171`（Context 声明）、`:186`（Config）、`:232-660`（API）、`:788`（`plugin-manager/changed`）
- `packages/boot/plugin-manager/src/types.ts:59`（`optional` 字段）、`:107-140`（`ChangeResult`）
- `packages/boot/plugin-manager/README.md`
- `packages/client/ui-plugin-manager/src/index.ts`、`README.md`
- `apps/desktop/renderer/plugin-manager.js`（旧版，新版不存在）
- commit `98b92b683c` `feat: add current-profile plugin manager service and Web controls`（新增 plugin-manager）
- commit `08974835d7` `refactor(web): rename ui-settings-plugin-manager to ui-plugin-manager`
- commit `4b6474133a` `refactor(desktop): remove standalone plugin manager`
- commit `d06e6b5519` `feat: coordinate profile management through dsh-hmr`
- 设计依据 `.agents/notes/implemented/architecture/2026-09-14-current-profile-plugin-management.md`

##### 对第三方插件的影响

非破坏性，但第三方插件现在是**被管理对象**：会出现在 Plugins 页；其行可被 `setPluginEnabled` 单独开关（前提是该行 id 在 profile patch 中唯一可寻址）；其组合包不可被自己卸载。`dsh-ldvh` 以 `- insert: [{id: dsh-ldvh, name: 'dsh-ldvh'}]` 插入，正好落在「可单独寻址的行」上。

---

#### 2. Optional Bundles 机制

##### 事实

- 定义位置：`packages/boot/app-boot/src/profile.ts:190`，紧邻 `PROFILE_TEMPLATES`；由 `packages/boot/app-boot/src/index.ts:60` 再导出。
- 内容（0.1.7-rc.1 恰为 2 项）：
  ```ts
  export const OPTIONAL_BUNDLES: readonly string[] = [
    '@deepseek-ai/dsh-experimental-voice-input-bundle',
    '@deepseek-ai/dsh-experimental-agent-team-profile',
  ]
  ```
- 语义（**四个硬条件**，由 CI 门禁强制）：
  1. 必须是 `apps/cli`（`@deepseek-ai/dsh`）的**运行时依赖**；
  2. 必须声明 `dsh.bundle.patch`；
  3. **不得**被任何随附 profile 模板选中；
  4. 必须是实验性隔离规则的唯一例外。
- `listBundles()` 对这类包报 `optional: true`、`removable: false`、默认 `enabled: false`；从安装目录解析（`installed: false`）。
- 历史上曾用 `apps/cli/package.json` 的 `dsh.optionalBundles` 字段，后改为代码内常量（理由：产品决定放在有类型、只读一次、门禁共用的代码里）。

##### 证据（路径+commit）

- `packages/boot/app-boot/src/profile.ts:190`
- `packages/boot/plugin-manager/src/index.ts:290`（`const optional = OPTIONAL_BUNDLES.includes(name)`）
- `packages/boot/plugin-manager/src/types.ts:55-62`（`optional` 文档）
- `scripts/check-workspace-constraints.ts:548-564`、`scripts/verify-default-product-isolation.ts:85-286`、`scripts/release/installed-product-isolation.ts:22`
- commit `fa320209ab` `refactor(plugins): name the optional bundles in the launcher, not the installation manifest`
- 设计依据 `.agents/notes/implemented/process/2026-09-15-shipped-optional-bundles.md`

##### 对第三方插件的影响

**封闭列表**：第三方包无法进入 `OPTIONAL_BUNDLES`——它是产品自有决定，且要求包成为 `apps/cli` 的运行时依赖，第三方不满足。第三方组合包只能通过在 profile 的 `dsh.profile.bundles` 中被选中来生效（即 `dsh plugin add` 时自动 append，或用户手动开启）。唯一可见影响是 Web Plugins 页 "Official" 分组会先列出这两个官方包，第三方包排在 "Installed" 分组。

---

#### 3. bundle patch 契约

##### 事实

**插件包 `package.json` 字段：**

| 字段 | 旧 | 新 | 兼容性 |
|---|---|---|---|
| `dsh.bundle.patch` | `string` | `string \| string[]` | **加宽，旧写法有效** |
| `dsh.client.platform` | `string` | 不变 | — |
| `dsh.client.inject` | `string[]` | 不变 | — |
| `dsh.client.immediately` | `boolean` | 不变 | — |
| `dsh.client.external` | `string[]` | 不变 | — |
| `dsh.profile.patchReload` | `'live' \| 'startup'` | **删除** | **破坏**（见 §4） |
| `dsh.configTrees` | 有 | **删除** | 仅实验镜像打包器使用 |
| `dsh.sessionFormatMigration` | 有 | **删除** | 仅仓库内迁移包使用 |
| `dsh.moduleFallback` | 有（内部） | **删除** | link 后端产物，已废弃 |

- 新增导出 `bundlePatchFiles(bundle)` / `bundlePatchPaths(packageDir, bundle)`（`packages/boot/app-boot/src/profile.ts:58,73`），支持数组形式并按序应用。

**loader YAML 方言：完全未变。**

- `PatchOptions` 在 `vendor/include/src/index.ts` 两版本**逐字相同**：`id?`、`insert?: EntryOptions[]`、`name?`、`config?`、`group?: boolean|null`、`disabled?: boolean|null`、`inject?`、`intercept?`、`isolate?`、`[key: string]: any`。
- `entryListSchema = yaml.JSON_SCHEMA.extend(JsExpr)` 保留 → **`!!js` 表达式仍受支持**。
- `applyEntryPatches` 语义未变：`insert` 无 `id` 时推入顶层、有 `id` 时要求目标是 `group` 并推入其 `config`；非 `insert` patch 必须带 `id`；插入行边插边入索引，故同一 patch 列表内的后续 patch 可以命中它。
- 仅内部实现差异：`structuredClone` 调用顺序调整（无 patch 时返回 `[...data]`）、删除 `ConfigFileError`/`ConfigUpdateStage`/`applyQueue`（读写错误处理与队列上移到 HMR）。

##### 证据（路径+commit）

- `packages/util/package-manifest/src/types.ts`（`git diff dsh-v0.1.5-rc.2 dsh-v0.1.7-rc.1 -- packages/util/package-manifest/src/types.ts` 可见 `patchReload`/`configTrees`/`sessionFormatMigration`/`moduleFallback` 删除与 `patch: string | string[]` 加宽）
- `packages/boot/app-boot/src/profile.ts:40`（`PROFILE_PATCH_FILENAME = 'cordis.patch.yml'`）、`:58`、`:73`
- `vendor/include/src/index.ts:132-142`（新版 `PatchOptions`）、`:23`（`entryListSchema`）
- `vendor/include/src/index.ts` 两版本 diff 仅 59 insertions / 93 deletions，且均在错误处理与队列

##### 对第三方插件的影响

**组合包与 patch 写法整体安全**。`dsh-ldvh` 的 `cordis.patch.yml` 用 `- insert: [{id: dsh-ldvh, name: 'dsh-ldvh'}]` 是顶层 insert（无 `id` 字段在 patch 项上，`id` 在插入行内），语义不变；`dsh.bundle.patch: "./cordis.patch.yml"` 字符串形式仍有效。唯一需要清理的是若 profile 或包中残留 `dsh.profile.patchReload`。

---

#### 4. profile 解析：link / runtime / dual 三模式

##### 事实

- **旧版 `packages/boot/app-boot/src/profile-resolution/` 目录不存在**；旧版 `app-boot/src/` 只有 `index.ts` 与 `profile.ts` 两个文件。新版是 19 个文件（新增 `profile-resolution/`、`config-schema/`、`compatibility-preflight.ts`、`plugin-compatibility.ts`、`profile-compatibility.ts`、`profile-context.ts`、`profile-plugins.ts`、`profile-sanitize.ts`、`package-meta.ts`）。
- **三模式的现状：link 与 dual 已删除，runtime 是唯一后端。** 设计说明原文：「Runtime is the only resolution backend; there is no mode selector or disk materializer.」
- 旧 link 后端的痕迹：`PROFILE_MODULE_FALLBACK_DIR = '.dsh-module-fallback'`、`healProfilesModuleFallback()`（旧版 `profile.ts`）→ 新版改为 `LINK_PROJECTION_DIR = '.dsh-module-fallback'` + `removeLinkProjections()`，**只在 profile 加载时一次性清除 0.1.5 link 后端写入的投影符号链接**，不再生成。
- 新的解析规则（供第三方插件作者理解依赖选择）：
  - 祖先链 ①②③④⑤：① 插件私有 `node_modules` → ② profile 的 `node_modules` → ③ `$DSH_HOME/profiles/node_modules`（**拦截层**，安装闭包包名在此占位）→ ④ `$DSH_HOME/node_modules` → ⑤ 根。
  - 被 link 的外部目录 R：在每一层 `D/node_modules`，**只有 `D/package.json` 的 `peerDependencies` 声明且运行时表有该包名时**才占用为运行时包；否则退回物理内容。更近的物理候选优先于更远的 peer 声明。
  - `require.resolve(req, { paths })`、相对/绝对路径、URL、builtin 一律直通 Node。
- `sanitizeProfile(binName, profileDir, bundles)`：**新函数，旧版不存在**，位于 `packages/boot/app-boot/src/profile-sanitize.ts:18`。把 profile 的 `cordis.patch.yml` 重命名为 `.bak-<timestamp>` 并恢复给定 bundle 列表，保留已安装包与其他 manifest 字段。**当前唯一生产调用方是 Desktop 原生致命恢复**（`apps/desktop/src/project-manager.ts:77`），plugin-manager 与 CLI 都不调用。调用前必须已停止 profile 并排除并发写。
- Profile 锁：`withFileLock`（`@deepseek-ai/dsh-atomic-write`）；CLI 与 `ctx.pluginManager` 共享 profile manifest 写锁（`lockWaitMs` 默认 120000）。**HMR 不获取该锁**，故安装不会阻塞无关的文件驱动配置变更。
- 安装事务：`const RESTORED_FILES = ['package.json', 'pnpm-lock.yaml'] as const`（`packages/boot/plugin-manager/src/index.ts`）。失败、被取消、或 pnpm 装入的包没有 bundle patch 时，两个文件**逐字还原**；`pnpm-workspace.yaml` 刻意不还原（pnpm 在其中记录 `allowBuilds`），已下载文件留在 `node_modules`/store。移除操作**保留**部分变更（与安装相反）。
- pnpm 11 build approval：`packages/boot/plugin-manager/src/build-approval.ts` 的 `approveBuilds` / `readPendingBuilds`；`ChangeResult.pendingBuilds` / `approvedBuilds`。批准按**精确包名**持久化在 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 下，拒绝 YAML 锚点/别名，只能批准「仍未决」的名字（陈旧请求无法覆盖后续拒绝）。**旧版完全没有这套机制。**
- 新增版本兼容门禁：`PROFILE_COMPATIBILITY_FILENAME = 'compatibility.json'`（`packages/boot/app-boot/src/profile-compatibility.ts:10`）；`evaluatePluginCompatibility(manifest, exemptions, runtimeVersion)`（`plugin-compatibility.ts`）把**每一个 `@deepseek-ai/dsh` 或 `@deepseek-ai/dsh-*` 的 `peerDependencies` 范围**与运行版本比对；不满足则整个安装/启用被拒（`incompatible-version`），除非 profile 自己的 `compatibility.json` 中有该 `name@version` → 精确运行时版本的豁免。预检入口 `prepareProfileEntries` / `prepareProfilePatches`（`compatibility-preflight.ts`）。

##### 证据（路径+commit）

- `git ls-tree -r --name-only dsh-v0.1.5-rc.2:packages/boot/app-boot/src/` → 仅 `index.ts`、`profile.ts`
- `packages/boot/app-boot/src/profile-resolution/{service.ts,resolver.ts,worker-bootstrap.ts,legacy-links.ts}`
- `packages/boot/app-boot/src/profile-sanitize.ts:18`
- `packages/boot/app-boot/src/profile-compatibility.ts:10`
- `packages/boot/app-boot/src/plugin-compatibility.ts`（`evaluatePluginCompatibility`）
- `apps/desktop/src/project-manager.ts:77`
- commit `15e07d2721` `refactor(boot): rename the profile resolution generation to the runtime resolution`
- commit `3e7af9cfbb` `feat(boot): resolve linked plugin peers from the running installation`
- commit `c9d4b7561d` `fix(boot): apply linked peers at each native lookup position`
- commit `2c67633990` `feat(plugins): enforce DSH peer compatibility with exact exemptions`
- 设计依据 `.agents/notes/implemented/architecture/2026-09-09-profile-resolution-generations.md`、`2026-09-19-profile-resolution-lookup-order.md`、`2026-09-19-remove-desktop-profile-core-cleanup.md`

##### 对第三方插件的影响

1. **`dsh.moduleFallback` 与 `.dsh-module-fallback` 投影不再被生成**，只被清理一次。依赖旧 link 布局的插件会失效。
2. **开发者 `npm link` 工作流仍受支持，但必须正确声明 peer**：想让 dsh 的包与宿主共享同一模块实例，必须**同时**把 `@deepseek-ai/dsh-*` 声明在 `peerDependencies` 和 `devDependencies`；只写在 `dependencies` 会让 pnpm 在 profile 内装一份副本，产生第二实例（这正是「一个包若把有模块级身份的 dsh 包声明为真实依赖，就是为自己做了这个打包选择」的后果）。
3. **版本兼容门禁是新增的硬门**：`dsh-ldvh` 的 peer 范围 `@deepseek-ai/dsh-host-webserver: >=0.1.2-alpha.1 <0.2.0`、`@deepseek-ai/dsh-client-ui-primitives: ... <0.2.0`、`@deepseek-ai/dsh-settings: ... <0.2.0` 对 `0.1.7-rc.1` **均满足**，故不会被拒。但任何声明了过窄 `@deepseek-ai/*` peer 范围的第三方插件会被新门禁挡下，且门禁检查的是 **peer**（不是 dependency）。
4. `isolate` 与 `intercept` 仍在 `PatchOptions` 中，但本次区间对第三方插件无新约束。

---

#### 5. HMR / config 重载

##### 事实

- **新包** `packages/boot/hmr`（`@deepseek-ai/dsh-hmr`），服务名 `ctx.hmr`。旧版**没有独立 HMR 包**：配置重载逻辑在 app-boot 内（`watchUserPatches()`、`tests/hmr-config.spec.ts`、`tests/config-reload.spec.ts`），由 profile manifest 的 `patchReload: live|startup` 字段决定是否监视。
- **精确路径监听**：`src/watch-config.ts` 的 `watchConfig(ctx, filename, options, refresh, inTransaction?)`。
  - `findWatchRoot()` 逐级向上找到**存在的**父目录作为 watch root，再用 `realpath` 规范化，`depth` 限定为到目标文件的那一层。
  - `awaitWriteFinish: true` 默认开启——注释明确说明「Stabilized events bypass Chokidar's lossy 50 ms change-event throttle」（普通 change 处理器会丢弃 50ms 内的第二个事件，导致激活后立即写入可能留下旧 bundle 在跑）。
  - 同一 ctx 下重复注册同一路径抛 `config path already registered`。
- **监视对象**（`src/index.ts:214-236`）：
  - `join(profile.dir, 'package.json')` → `refresh(true)`
  - `profile.patchPath`（即 profile 的 `cordis.patch.yml`）与 `join(profile.home, PROFILE_PATCH_FILENAME)`（home 级）→ `refresh(false)`
  - manifest 通知**只比较有序 bundle 列表**；仅依赖变更不触发配置重载。
- **串行化重载**：`ctx.hmr.runExclusive(operation)`（`src/index.ts:139`）是唯一队列，承载模块替换、Include 刷新、profile 重组与管理器配置变更。pnpm **在队列之外**运行。
- 事件：`hmr/change`（监视文件无模块/配置处理器）、`hmr/reload`（模块替换完成）。配置 schema 为 `HmrConfig extends ChokidarOptions`：`base`、`root`（默认 `['.']`）、`debounce`（默认 100）、`ignored`。
- **客户端免刷新生效**：新包 `packages/client/hmr` + 客户端模块图（见 ui-plugin-manager README：「the page follows the client module graph without reloading」）。插件行的 host 半边卸载/挂载时，客户端通过模块图跟随，不刷新页面。
- **`packages/boot/config-editor`**（`@deepseek-ai/dsh-config-editor`）职责：服务名 `ctx.configEditor`，`static inject = ['loader', 'profileContext']`。它是**profile patch 文档的持久编辑器**：`documentPath`、`entries()`（只返回在 profile patch 中 id 唯一可寻址的行）、`configuration()`（继承值 vs 覆盖值）、`update/replace`。写盘用 `withFileLock` + `writeFileAtomic`，然后**走普通 Loader 协调路径**应用（不搞旁路重载）。
- 最终决定 HMR 是否运行的依据是**组合出的 YAML**，launcher 不安装 fallback。

##### 证据（路径+commit）

- `packages/boot/hmr/src/index.ts:139`（`runExclusive`）、`:160`（`watchConfig`）、`:214-236`（监视对象）、`:90-99`（Config 默认值）
- `packages/boot/hmr/src/watch-config.ts`（`awaitWriteFinish`、`findWatchRoot`）
- `packages/boot/config-editor/src/index.ts`（`ctx.configEditor`、`withFileLock`）
- `packages/boot/hmr/README.md`、`packages/boot/config-editor/README.md`
- commit `d06e6b5519` `feat: coordinate profile management through dsh-hmr`（新增 hmr 包）
- commit `601d6761e4` `feat(settings): project volatile Config through profile-backed forms (#4587)`（新增 config-editor）
- commit `b77c19c376` `fix(hmr): retain consecutive profile configuration changes`
- commit `08021a16d8` `fix(plugin-manager): keep package operations outside HMR`
- commit `3f7016a422` `feat(config): add volatile schemas and watcher-driven updates (#4579)`
- 旧版对照：`git show dsh-v0.1.5-rc.2:packages/boot/app-boot/src/index.ts` 的 `watchUserPatches`（第 250 行）与 `DEFAULT_PROFILE_PATCH_RELOAD = 'live'`（旧 `profile.ts:142`）

##### 对第三方插件的影响

- **`dsh.profile.patchReload` 字段被删除**（见 §3 表）。旧 profile 中若写了 `dsh.profile.patchReload`，新版本不再读取；`ProfileManifest` 类型已无该字段。对自定义 profile 的实际效果：以前可显式写 `startup` 关闭监视，现在**监视由组合中是否含 hmr 行决定**——`dsh-base` 默认插入的模块 HMR 行是 `disabled`，自定义 profile 默认 `live` 语义由 hmr 行是否存在决定。
- 第三方插件**无需也不应**自己监听 patch 文件；订阅 `app-boot/config-reload` 或使用 `ctx.configEditor` 即可。
- 若第三方插件原来在自己的 watchdog 里改 `cordis.patch.yml`，现在必须走 `ctx.configEditor`（否则绕过串行队列，且 HMR 之外的 patch 代不会发 `plugin-manager/changed`，Web 页要等下次读取才知道）。

---

#### 6. settings 存储变化（最严重的破坏性变更）

##### 事实

- **`packages/settings/settings-file` 包已删除**（旧版含 `FileSettingsProvider`：`Config`、`resolveSpec()`、`FileSettingsProvider extends SettingsProvider`）。新版 `packages/settings/` 下只剩 `settings/` 一个包。
- **`ctx.settings` 的服务实现完全换了**：
  - 旧：`packages/settings/settings/src/index.ts` 导出**抽象类** `SettingsProvider`（default export），插件调用 `ctx.settings.register(ns, schema, options)` 得到 `SettingsScope<T>`，用 `get()` / `watch(cb)` / `update(patch)` / `replace(section)` 读写；配套类型 `SettingsRegisterOptions`、`SettingsScope`、`SettingsApplies = 'live' | 'restart'`、`SettingsUpdateSource = 'update' | 'provider'`。落盘在 `$DSH_HOME/settings.yaml`。
  - 新：`packages/settings/settings/src/index.ts:223` 导出 `SettingsForms extends Service`（default export），`super(ownerContext, 'settings')`，`static inject = ['configEditor', 'profileContext']`。
- **新版 `ctx.settings` 上不存在 `register()`**。新版全部公开面：`configure(presentation, owner?)`（只登记「是否自动生成页面」的策略）、`describe(options?)`、`update(ns, patch, expectedRevision?)`、`replace(ns, section, expectedRevision?)`、`writable`、`documentPath`、`prepareDocument()`。
- 新版 `SettingsProvider`、`SettingsScope`、`SettingsRegisterOptions`、`SettingsApplies`、`SettingsUpdateSource` **全部不存在**；`SettingsNamespaceView.applies` 只剩字面量 `'live'`。
- **新的设置模型**（`2026-09-19-profile-owned-live-configuration.md`）：
  - 插件把**每一个可配置值声明在自己的 Cordis `Config` schema 里**；不需要重挂载即可变的字段用 `.volatile()`。
  - Settings 只负责把这些字段投影成表单，**不再承载业务配置**。
  - **命名空间 = profile 插件条目 id**（不再是插件自取的任意字符串）。
  - **存储 = profile 的 `cordis.patch.yml`**，由 `configEditor` 写入并走普通 Loader 协调。
  - 表单写入只能落到当前 profile；home patch 与命令行 overlay 仍是更高优先级的部署输入，被它们遮蔽的编辑会在持久化前失败。
  - 嵌套 Include 有独立所有权，不能通过 profile 表单写。
  - Cordis patch 的 `config` 是**整体替换**：一次编辑会存入该条目的完整 config（写入时组合出的普通字段 + 所有 volatile 字段），因此后续 bundle 对这些字段的修改不再到达该 profile，直到移除该条目的 config 覆盖。
- **`$DSH_HOME/settings.yaml` 一次性迁移**：Settings 启动且 Loader 结算后，把旧文件各 section 按 id 导入当前 profile，然后**先改名**为 `settings.yaml.imported` 再写，保证不重复导入。遗留映射：`ui-developer-tools` → `ui-settings`，`ui-onboarding` → `ui-settings-general`，`shell` → 平台对应的 shell executor 条目。
- 新增 `packages/settings/settings/src/schema.ts`。

##### 客户端（对 `dsh-ldvh` 的设置面板尤其关键）

- 旧：`ctx.slots` 槽位 **`settings.plugin.item`**（按设置命名空间作 key），配合客户端服务 **`ctx.settingsScope`**（`bind({namespace})` → `SettingsScopeController`，`describe()`、`getSnapshot`/`subscribe`/`ensure`/`acceptView`）。旧 `packages/client/ui-settings-plugins` 用 `ctx.settingsScope.bind({ namespace: SHELL_NS })` 等驱动 4 张卡片。
- 新：**`settings.plugin.item` 槽位与 `ctx.settingsScope` 服务都不再声明**。新 Host 端 `packages/client/ui-settings/` 只声明 `settings.header`、`settings.trigger`、`settings.close`。插件配置页迁到 **Plugins 页**，由 `packages/client/ui-plugin-manager` 声明三个槽位：
  - `plugins.item`——官方插件卡片（按 `label` 列在 Official 分组）
  - `plugins.bundle.config`——按**组合包包名**作 key，渲染在组合包页的描述与行列表之间
  - `plugins.row.config`——按 `<包名>#<行id>` 作 key，给该行一个 **Configure** 入口
  - 另有三组详情页扩展点：`plugins.detail.actions`、`plugins.detail.badge`、`plugins.detail.section`，每项以 `subject: {kind:'bundle'|'row'|'item', ...}` 渲染。
- `packages/client/ui-settings-plugins` 已被掏空为 `export function apply(): void {}` 的空宿主壳；`ui-settings-plugin-inventory` 保留为**只读**清单（Settings 里那个 Plugin list）。

##### 证据（路径+commit）

- `git ls-tree -r --name-only dsh-v0.1.5-rc.2:packages/settings/` 含 `settings-file/`；新版不含
- `packages/settings/settings/src/index.ts`（旧 default export `SettingsProvider`；新 default export `SettingsForms`）
- `packages/settings/settings/src/types.ts`（新：`SettingsNamespace` 注释改为「Nominal id of one profile plugin entry」；`applies: 'live'`）
- `packages/settings/settings/src/schema.ts`（新增）
- `packages/client/ui-plugin-manager/README.md`（`plugins.item` / `plugins.bundle.config` / `plugins.row.config` / `plugins.detail.*`）
- `packages/client/ui-settings-plugins/src/index.ts`（新版仅空 `apply`）
- `packages/client/ui-settings-plugins/src/client/index.ts`（旧版 `ctx.settingsScope.bind(...)`，第 57/68-71 行）
- commit `601d6761e4` `feat(settings): project volatile Config through profile-backed forms (#4587)`（**同时**新增 config-editor、删除 settings-file）
- commit `90af3110b7` `feat(web): host plugin configuration on the Plugins page`
- 设计依据 `.agents/notes/implemented/architecture/2026-09-19-profile-owned-live-configuration.md`、`2026-09-17-settings-pages-as-companion-packages.md`、`2026-09-16-plugin-configuration-on-the-plugins-page.md`

##### 对第三方插件的影响

**这是本次升级对第三方插件最严重的一处。** 任何按老写法 `ctx.settings.register(ns, schema, ...)` / `ctx.settings.bind(...)` / `ctx.settingsScope` 注册设置命名空间的插件都会在**运行时直接失败**（`register` 不是函数），需要整体改写为「声明 Cordis Config + `.volatile()` + 在 Plugins 页注册 `plugins.*` 槽位」。同时旧的 `$DSH_HOME/settings.yaml` 会被一次性搬进 profile patch，插件的旧设置在迁移后位于 profile 的 `cordis.patch.yml` 中，key 由命名空间字符串变成**插件条目 id**。

---

#### 7. CLI

##### 事实

- **旧写法仍受支持**：`dsh plugin --profile <name> <pnpm-args...>` 仍是薄转发器，`add` / `remove` / `list` / `update` 都是 **pnpm 自己的子命令**，DSH 只透传。
- **新增 DSH 自有子命令**（在转发 pnpm 之前拦截，`apps/cli/src/plugin.ts:13`）：
  - `dsh plugin [--profile <name>] version-exemptions`
  - `dsh plugin [--profile <name>] allow-version <package@version> --dsh-version <exact> --accept-risk`
  - `dsh plugin [--profile <name>] revoke-version <package@version> --dsh-version <exact>`
- **新增 profile 简写**：前导非选项参数（除 `plugin` 外）展开为 `--profile <name>`。
  - `dsh web` ≡ `dsh --profile web`（**不再是专用命令**；"Removing the dedicated `web` command also lets an already selected profile receive `web` as an app argument"）。
  - `plugin` 仅在**第一个参数**位置保留命令优先级；`dsh --profile plugin` 选同名 profile；profile 选定之后 `plugin` 作为 app 参数转发。
  - **重复选择 profile 会被拒绝**（`select a profile only once`）。
- 帮助文案（`args.ts` 的 `HELP_EXAMPLES`）：
  ```
  dsh web                                   boot the web profile (same as: dsh --profile web)
  dsh rescue --from-default-profile web     create rescue from the shipped web template, then boot it
  dsh tui --patch ./extra.yml               boot a custom profile with one extra overlay
  dsh web --help                            the web app's own flags and help
  dsh plugin --profile tui add <package>    install a plugin into the tui profile
  ```
- launcher 自身 flag：`--profile <name>`、`--from-default-profile <name>`、`--patch <path>`（可重复）、`--dump-config`、`--dump-config-schema`、`--dump-default-config`。`dsh --profile web -h` 打印 **web app 自己的 help**（launcher 关掉 `helpOption`/`helpCommand`），只有裸 `dsh -h` 打印 launcher help。
- rejection：`--profile desktop` 被显式拒绝（`profile "desktop" is managed exclusively by the Electron application`）。
- 新增启动诊断文件 `apps/cli/src/startup-diagnostics.ts`、`dump-config-schema.ts`。
- **本地 `file:` / `link:` 安装仍受支持**：`anchorPathSpec()` 从旧 `apps/cli/src/plugin.ts` **迁移**到 `packages/boot/plugin-manager/src/operations.ts:62`，语义逐字保留——只重写形如 `^(?:(file|link):)?(\.{1,2}([/\\].*)?)$` 的相对路径，**绝对路径、注册表名、其他 pnpm 参数原样通过**，且保留 `file:`/`link:` 前缀以免改变 pnpm 的 link-vs-copy 语义；锚定基准是 `process.cwd()`（调用目录），不是 profile 目录。
- 但**服务侧（Web / agent 工具）的路径 spec 必须绝对**：`packages/boot/plugin-manager/src/install-spec.ts` 的 `parseInstallSpec()` 对 `^(?:file|link):` 剥前缀后要求 `isAbsolute`，否则抛 `a local path must be absolute`。接受 4 种形态：`registry` / `path` / `tarball` / `git`。
- `dsh plugin` 的 CLI 调用继承终端与认证环境（`execution: 'cli'`），不做输出捕获；服务调用用脱敏环境 + 有界输出。

##### 证据（路径+commit）

- `apps/cli/src/args.ts:13`（简写注释）、`:89-99`（HELP_EXAMPLES）、`:154-176`（commander 定义）、`:79`（重复 profile 拒绝）、`:83-86`（desktop 拒绝）
- `apps/cli/src/bin.ts:23-57`（`profile` / `plugin` / dump 分支）
- `apps/cli/src/plugin.ts:13`（自有子命令判定）、`:62-85`（`runPlugin`）
- `packages/boot/plugin-manager/src/operations.ts:62`（`anchorPathSpec`）、`:304-305`（透传 argv）
- `packages/boot/plugin-manager/src/install-spec.ts`（`parseInstallSpec`、`ParsedInstallSpec`）
- commit `1d6534a810` `feat(cli): support profile command shorthand`、`7d4188b450` `fix(cli): address profile shorthand review feedback`
- 设计依据 `.agents/notes/implemented/feature/2026-09-15-profile-command-shorthand.md`

##### 对第三方插件的影响

`dsh plugin --profile <p> add <本包>` 与 `dsh plugin --profile <p> add file:../dsh-ldvh/plugin` 都仍然有效。文档中若写 `dsh plugin add <pkg>`（省略 `--profile`），在新版仍可用某些简写形式但语义依赖首参数；建议统一写成 `dsh plugin --profile <name> add ...`。Web 安装对话框的路径输入必须是绝对路径。

---

#### 8. 对第三方插件的破坏性变更清单（旧写法 → 新要求）

| # | 旧写法 | 新要求 | 证据（文件 + commit） |
|---|---|---|---|
| 1 | `ctx.settings.register(ns, schema, opts)` 拿 `SettingsScope`，用 `get/watch/update/replace` | 把可配置值声明进插件自己的 Cordis `Config`；可热改字段用 `.volatile()`；设置**不再**是业务配置的存储 | `packages/settings/settings/src/index.ts`（新无 `register`）；commit `601d6761e4` |
| 2 | 依赖宿主包 `@deepseek-ai/dsh-settings` 提供 `installSettingsSection` / `settingsNamespace` | 这两个导出在 **0.1.2-alpha.2 起就已从宿主删除**，0.1.5-rc.2 与 0.1.7-rc.1 都没有 | `git grep` 两 tag 均无；仅存在于 `@deepseek-ai/dsh-settings@0.1.0-rc.6` |
| 3 | 客户端 `ctx.slots.inject('settings.plugin.item', ...)` + `ctx.settingsScope.bind()` | 改用 Plugins 页槽位 `plugins.item` / `plugins.bundle.config`（key = 包名）/ `plugins.row.config`（key = `<包名>#<行id>`）；详情扩展用 `plugins.detail.*` | `packages/client/ui-plugin-manager/README.md`；commit `90af3110b7`、`08974835d7` |
| 4 | 设置落盘 `$DSH_HOME/settings.yaml`，命名空间自取字符串 | 设置落 profile 的 `cordis.patch.yml`；命名空间 = profile 插件条目 id；旧文件一次性导入后改名 `settings.yaml.imported` | `2026-09-19-profile-owned-live-configuration.md`；commit `601d6761e4` |
| 5 | profile manifest 写 `dsh.profile.patchReload: 'live' \| 'startup'` | **字段删除**；是否监视由组合中是否含 hmr 行决定 | `packages/util/package-manifest/src/types.ts`（旧有 `ProfilePatchReload`，新无）；commit `d06e6b5519` |
| 6 | `dsh.moduleFallback` / 依赖 `.dsh-module-fallback` 投影 | 不再生成；加载时一次性清理旧投影；依赖解析改走运行时拦截 | `packages/boot/app-boot/src/profile.ts`（`LINK_PROJECTION_DIR` + `removeLinkProjections`）；commit `15e07d2721`、`3e7af9cfbb` |
| 7 | `dsh.bundle.patch` 只写字符串 | 字符串**仍有效**；新增数组形式按序应用 | `packages/util/package-manifest/src/types.ts`（`patch: string \| string[]`） |
| 8 | 把 dsh 包写在 `dependencies` 里 | 想共享模块实例必须**同时**写 `peerDependencies` + `devDependencies`；写进 `dependencies` 会在 profile 内装第二份副本并各自运行 | `2026-09-19-profile-resolution-lookup-order.md` 第 3 节与「开发者集成指南」 |
| 9 | 无版本门禁 | 每个 `@deepseek-ai/dsh*` **peer** 范围必须满足运行版本，否则安装/启用被拒（`incompatible-version`），需 `compatibility.json` 精确豁免 | `packages/boot/app-boot/src/plugin-compatibility.ts`、`profile-compatibility.ts:10`；commit `2c67633990`、`747c98b0db`、`51d70c5f5c` |
| 10 | 桌面独立插件管理界面 | 删除，统一到 Web Plugins 页 / `ctx.pluginManager` / `plugin_manager` 工具 | `apps/desktop/renderer/plugin-manager.*`（旧）；commit `4b6474133a` |
| 11 | `dsh web` 作为专用命令 | `web` 现在只是通用 profile 简写 `--profile web`；profile 选定后 `web` 会被当作 app 参数转发 | `apps/cli/src/args.ts:92`；commit `1d6534a810` |
| 12 | 直接手改 `cordis.patch.yml` 后自行重载 | 改配置走 `ctx.configEditor`（持锁 + 串行队列）；否则绕过 HMR 队列且不发 `plugin-manager/changed` | `packages/boot/config-editor/src/index.ts`；commit `601d6761e4` |
| 13 | `dsh.configTrees` / `dsh.sessionFormatMigration` 字段 | 删除（均为仓库内部用途） | `packages/util/package-manifest/src/types.ts` diff |

**未变（可放心）**：`cordis.patch.yml` 的 `insert`/按 id 覆盖/`group`/`disabled`/`isolate`/`!!js` 方言与 `applyEntryPatches` 语义；`dsh.client` 的 `platform`/`inject`/`immediately`/`external`；`dsh.bundle.patch` 字符串形式；`dsh plugin` 作为 pnpm 转发器；`file:`/`link:` 本地安装；`ctx.webServer` 服务名与 `ctx.shellEnv` 注入面（`packages/host/webserver/src/index.ts` 两版本分别为第 144 / 145 行的 `super(ctx, 'webServer')`，服务名一致；`shellEnv` 引用面两版本同为 15 处——但 `register()` 的选项 schema 未逐字段核对，见「待确认项」第 2 条）。

---

#### 对 dsh-ldvh 的适配建议

`dsh-ldvh` 现状（只读核对：`plugin/package.json`、`plugin/cordis.patch.yml`、`plugin/lib/index.js`、`plugin/lib/client.js`）：

1. **【最高优先，且是既有缺陷而非本次回归】`installSettingsSection` / `settingsNamespace` 在宿主不存在。**
   `plugin/lib/index.js:31` 写 `import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings"`，但这两个导出在**宿主 0.1.5-rc.2 与 0.1.7-rc.1 中都不存在**（它们只存在于 `@deepseek-ai/dsh-settings@0.1.0-rc.6`，即 `plugin/node_modules` 里那份，自 `dsh-v0.1.2-alpha.2` 起已从仓库删除，删除 commit `f4e49ccf8f refactor(services): move shared values behind service APIs`）。由于 `@deepseek-ai/dsh-settings` 同时写在 `peerDependencies`，新版解析规则会让它解析到**宿主副本**，命名导入将得到 `undefined`，模块加载即失败。**升级前必须先把设置接入层改成宿主真实存在的 API，或把该模块内联进本包。** 这不是 0.1.7 引入的，0.1.5-rc.2 上同样不成立。
2. **设置命名空间改写**：把 LDVH 的可配置项声明进插件自己的 Cordis `Config` schema（可热改的用 `.volatile()`），删掉自建 settings 命名空间；由 `ctx.settings.describe()` / `ctx.configEditor` 托管，值落到 profile 的 `cordis.patch.yml`。
3. **客户端设置面板改写**：`lib/client.js:968` 的 `ctx.slots.inject("settings.plugin.item", ...)` 在新版是**死槽位**。改为 `plugins.bundle.config` 且 `key: 'dsh-ldvh'`（本包是组合包，`cordis.patch.yml` 在顶层 insert 了一行），或按行 key `dsh-ldvh#dsh-ldvh` 注册 `plugins.row.config`；表单需用 `view: 'page'` 形态并自带保存控件（页面只用 `view: 'summary'` 时不给保存）。
4. **补 `engines.dsh`**：当前 `package.json` 只有 `engines.node`，无 `engines.dsh`。新增的兼容门禁查的是 `peerDependencies` 中 `@deepseek-ai/*` 的范围，现有三个 peer 范围对 `0.1.7-rc.1` 均满足，**不会被拒**；但建议把 `@deepseek-ai/dsh-host-webserver` / `dsh-settings` / `dsh-client-ui-primitives` 的范围在验证通过后收紧到 `>=0.1.7-rc.1 <0.2.0`，以免在更旧的宿主上静默半可用。
5. **组合包与 patch 无需改动**：`dsh.bundle.patch: "./cordis.patch.yml"` 字符串形式仍有效；`- insert: [{id: dsh-ldvh, name: 'dsh-ldvh'}]` 方言未变；该行在 Plugins 页可被单独开关，符合预期。
6. **`inject` 需要复核**：`lib/index.js:74` 是 `export const inject = ["tools", "settings", "systemPrompt"]`，而 `webServer` 走软 `ctx.inject(["webServer"], ...)` 子上下文。新宿主下 `settings` 服务名仍在，但**其 API 已换**（见建议 2），故该 inject 仍会成功而调用面失效——这正是建议 1 的运行时表现。`webServer` 的软注入与 `/ldvh/api`、`/ldvh`、`/ldvh/state` 三个 prefix 路由注册面**未发现契约变更**。
7. **`ctx.effect` 生命周期**：`ctx.effect(() => () => {...})` 的写法在新版仍受支持（`PluginPackages`、`PluginRegistryProbe` 等官方包都用同一形态），无需改动。
8. **本地安装**：`dsh plugin --profile <p> add file:../dsh-ldvh/plugin` 仍有效（相对路径由 `anchorPathSpec` 锚到调用目录）；Web 安装框里则必须填绝对路径。

---

#### 待确认项

1. **`installSettingsSection` 的确切消失版本**：已确认 `dsh-v0.1.2-alpha.1` 有、`dsh-v0.1.2-alpha.2` 无，但未逐 commit 定位到唯一提交（`f4e49ccf8f` 是 `-S` 搜索结果，可能只是触及该区段的多个提交之一）。建议用 `git log -p -S` 精确复核，因为它决定 dsh-ldvh 是「从 0.1.2-alpha.2 起就已损坏」还是更晚。
2. **`ctx.webServer` / `ctx.shellEnv` 的完整契约**：本线只确认了两版本都存在该服务且注入方式未变，未逐字段比对 `register({...})` 的选项 schema（`prefix` / `path` / handler 签名）。若 dsh-ldvh 的 `webServer.register` 参数在 0.1.7 有增减，本文件未覆盖——建议单独一条线核对 `packages/host/webserver`。
3. **`plugins.bundle.config` 槽位的 `view` 取值全集与保存时机**：README 提到 `view: 'page' | 'summary'` 与「只有 save 才写」，但未逐个核验组件签名；实现 dsh-ldvh 面板前应读 `packages/client/ui-plugin-manager/src/client/slot-contract.ts` 与 `PluginManagerPage.tsx` 的类型定义。
4. **`tool-plugin-manager` 行与 Creator 模式的启用条件**：README 说「enabled in Creator mode and disabled by default in the base bundle」，未核对 `packages/bundle/*/cordis.patch.yml` 中该行的确切 `disabled` 取值与 preset 归属。
5. **`config` 整体替换的迁移代价**：新模型下一次编辑会固化该条目的完整 config（含所有 volatile 字段），本文件未评估 dsh-ldvh 现有用户在 `$DSH_HOME/settings.yaml` 中的实际 section 名映射结果（只知三条内置映射规则，`ldvh` 相关的自定义命名空间走 `LEGACY_SECTION_ENTRIES[section] ?? section` 回退，即以 section 名直接当条目 id，可能落空）。
6. **`dsh-v0.1.7-rc.2` 已存在**：本任务指定新基线为 `dsh-v0.1.7-rc.1`，但本地 tag 列表显示 `dsh-v0.1.7-rc.2` 也已 fetch。若最终要升级到 rc.2，本文件的结论需对 rc.1→rc.2 再核一遍（尤其 plugin-manager 与 settings）。

## A.3 宿主服务契约与扩展点 API

<!-- line: host-services -->
### 宿主服务契约与扩展点 API（Host plane）：`dsh-v0.1.5-rc.2` → `dsh-v0.1.7-rc.1`

调研对象：本地 checkout `/Users/dmh2002/DshProject/deepseek-harness`，区间 `dsh-v0.1.5-rc.2..dsh-v0.1.7-rc.1`（3304 commits）。
下游消费者：第三方宿主侧 Cordis 插件 `dsh-ldvh`（`/Users/dmh2002/DshProject/dsh-ldvh/plugin`）。
**下文未注明 OLD 的行号均为 `dsh-v0.1.7-rc.1` 下的行号。** 全程只读（`git show` / `git grep` / `git diff` / `git ls-tree`），未改动工作树。

---

#### 结论速览（服务变化表）

| 服务 | OLD | NEW | 变化性质 | 包路径（NEW） |
|---|---|---|---|---|
| `webServer` | ✅ | ✅ | **API 逐字不变**（仅 gzip filter 内部改动） | `packages/host/webserver` |
| `settings` | ✅ `SettingsProvider` | ✅ `SettingsForms` | **破坏性重建**：`register`/`installSection`/`SettingsScope` 全删 | `packages/settings/settings` |
| `settingsScope`（client） | ✅ | ❌ **删除** | **破坏性**：替代品 `configForms` | 原 `packages/client/ui-settings/src/client/settings-scope.ts` 已删 |
| `settings-file`（包） | ✅ | ❌ **整包删除** | 持久化改由 `configEditor` 承担 | 新：`packages/boot/config-editor` |
| `shellEnv` | ✅ | ✅ | **API 不变**；新增 `DSH_PROFILE`/`DSH_PROFILE_DIR` | `packages/shell/shell-env` |
| `tools` | ✅ | ✅ | 公开方法集**完全一致**；`ToolDefinition` 增量扩展 | `packages/core/tools` |
| `sessions` | ✅ | ✅ | 方法集一致；新增 `registerMessageProjection` | `packages/core/session` |
| `agents` | ✅ | ✅ | 新增 `announce()`；`agent/created` 语义改变 | `packages/core/agent` |
| `agentLoop` | ✅ | ✅ | 签名小改 | `packages/core/agent-loop` |
| `attachments` | ✅ | ✅ | 方法名一致；`ImageRequestPolicy`→`ImageRequestTarget` | `packages/attachment/attachment` |
| `llm` | ✅ | ✅ | `ToolSchema` 增 `deferLoading`；`MessageSourceMap` 扩充 | `packages/llm/llm` |
| `authorization` | ✅ | ✅ | `AuthorizationSession.commit()` **新增** | `packages/credentials/authorization` |
| `approval` | ✅ | ✅ | 无变化 | `packages/interaction/user-approval` |
| `sandbox` | ✅ | ✅ | `confine()` **改 async + signal** | `packages/sandbox/sandbox` |
| `sandboxPolicy` | ✅ | ✅ | `workspaceRoot` 必须绝对路径、不再 canonicalPath | `packages/sandbox/sandbox-policy` |
| `fs` | ✅ | ✅ | 新增 `watch()`（默认抛错） | `packages/fs/fs` |
| `subprocess` | ✅ | ✅ | 新增 `terminalEnvironment()`；terminal 契约扩展 | `packages/subprocess/subprocess` |
| `shell` | ✅ | ✅ | **破坏性**：`run()`+`start()` → `execute()`；`SHELL_SETTINGS_NAMESPACE` 删除 | `packages/shell/shell` |
| `skills` | ✅ | ✅ | `SkillSummary.path` 上移 | `packages/skill/skill` |
| `workflowEngine` / `webhookRuntime` / `commands` / `jobs` / `goals` / `terminals` / `invariants` / `userQuestions` | ✅ | ✅ | 无变化 | 见 §10 |
| `codeRuntime` | ✅ | ❌ **改名** | → `ptcRuntime`（`packages/code-runtime/*` → `packages/ptc-runtime/*`） | `packages/ptc-runtime/ptc-runtime` |
| `e2b` / `agentDefaultModel` | ✅ | ❌ **删除** | 后端移除 / 服务名消失 | — |
| `configEditor` / `configForms` / `pluginManager` / `pluginPackages` / `hmr` / `productTelemetry` / `ssh` / `browserUse` / `computerUse` / `ptcRuntime` / `terminalController` / `webTerminals` / `mcpResources` | ❌ | ✅ **新增** | 见 §10 | — |

---

#### 1. `webServer` —— HTTP/Web 接缝（第三方插件最关键）

##### 事实

`packages/host/webserver/src/index.ts` 两版本**只有 3 行差异**，全部在 gzip 中间件内部；公开 API 逐字未变：

```ts
export type WebRouteKind = 'exact' | 'prefix'                       // :39
export interface WebRoute {                                          // :42
  kind: WebRouteKind
  path: string   // 绝对路径，无尾斜杠
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}
export interface WebUpgradeRoute {                                   // :51
  path: string
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}
export class WebServer extends Service {                             // :145  super(ctx,'webServer')
  get port(): number                        // :151
  get host(): Config['host']                // :156
  register(route: WebRoute): () => void      // :166
  registerUpgrade(route: WebUpgradeRoute): () => void  // :181
  registerFallback(handler): () => void      // :197
  tapIndex(transform: (html: string) => string): () => void  // :212
  applyIndexTaps(html: string): string       // :336
  collectIndexInjections(): IndexInjection[] // :348
  renderIndex(html: string): string          // :360
}
// Event 'webserver/index-inject'(table: IndexInjection[]): void      // :34
```

匹配规则（`private match()`）：exact 表命中优先，否则 prefix 表**最长前缀优先**；`p` 匹配 `p` 与 `p/<anything>`。

##### 证据

- **不存在 `addPrefixRoute`**（两版本全仓 grep 均无）。prefix 路由写法一直是 `webServer.register({ kind:'prefix', path, handler })`：
  `packages/client/modules/src/index.ts:649`（NEW）vs `:572`（OLD，硬编码 `'/plugins'`，NEW 提为常量 `PLUGIN_ROUTE='/plugins'`，值不变）；`packages/client/connection/src/index.ts:146`/`:126`（`/api`）；`packages/client/connection/src/rpc-host.ts:179`/`:166`；`packages/host/open-in-app/src/index.ts:207`（两版本同）。
- 唯一实质 diff：gzip filter 增 `multipart/form-data` 直通，类型断言 `as unknown as NodeMiddleware` → `as NodeMiddleware`。
- `IndexInjection` 联合（`src/injections.ts`）两版本一致（`global`/`script`/`script-src`/`script-preload`/`style`/`html`）。

##### 相邻接缝的真实变化

1. **`frontend-static` 的 `<base>` 由 `/` 改为 `./`** —— `packages/host/frontend-static/src/index.ts:118`：
   `return body.replace(/<head(?:\s[^>]*)?>/i, open => \`${open}<base href="./">\`)`。
   base 插在**所有 index transform 之后**，冻结"页面被加载时所在的入口目录"，使宿主注入的 plugin-resource 行**相对文档解析**。`packages/client/modules/src/client/manifest.ts` 中 `WebBootEntry.url`/`WebBootBatch.url` 的 JSDoc 同步改为 "document-relative"。
   → **插件经 `webserver/index-inject` 或 `tapIndex` 注入的 URL 应用文档相对路径（`plugins/...`），不要用根绝对路径（`/plugins/...`）**，否则被 prefix-strip 代理挂载时会 404。
2. **`registerFallback` 单一所有者**（`:198-200` 第二次注册抛 `webserver: fallback already registered`）、**非 GET/HEAD 返回 405**、**dist 内缺失路径返回 404 而非 index.html**（`frontend-static/src/index.ts:63-105`）。这些两版本一致，非新变化。
3. `connection` 服务：新增 `admit(request): PeerAdmission`（`packages/client/connection/src/rpc-host.ts:110`），OLD 只有 `requestRejection`（`:104`，NEW 仍在）。`ConnectionRpcHandler` 新增第 4 参数 `peer: PeerScope`，返回类型放宽为可带 `attachments` 的 `ConnectionRpcHandlerResult`（`src/rpc.ts`）。新增 `connection/request` waterfall 事件（`src/index.ts:67`）。
   注意：**第三方用 `webServer.register` 注册的 prefix 路由不经过 `connection` 的 Host/Origin 认证**——`admit()` 只作用于 connection 自注册的 `/api` route。该事实两版本相同。

##### 影响（对 dsh-ldvh）

`registerWebRoutes()`（`dsh-ldvh/plugin/lib/index.js:146-160`）用 `webServer.register({...})` 注册 `/ldvh/api` 与 `/ldvh` SPA —— **签名不变，可直接继续用**。

---

#### 2. `settings` —— 本区间最大的破坏性变更

##### 事实（OLD）

`packages/settings/settings/src/index.ts`（OLD）`super(ctx,'settings')` 在 `:350`。契约是**运行时注册命名空间**：

```ts
register<const Namespace extends string, T>(ns, schema: z<T>, options?: SettingsRegisterOptions<T>): SettingsScope<T>  // OLD :419
installSection<const Namespace extends string, T>(owner, ns, schema, entry, hooks): void                                // OLD :472
describe(options?)  // OLD :505      get(ns)      // OLD :546
update(ns, patch, expectedRevision?) // OLD :562
replace(ns, section, expectedRevision?) // OLD :581
mutate(ns, ops, expectedRevision?)      // OLD :602
```
`SettingsScope<T>` = `get(): T` / `watch(cb)` / `update(patch)` / `replace(section)`（OLD `:117-140`）。`SettingsRegisterOptions` 含 `base?` / `applies?: 'live'|'restart'` / `validate?`。
事件：`settings/updated(ns, next, prev, source)` **和** `settings/document-updated(ns, revision)`。
持久化：`@deepseek-ai/dsh-settings-file`（`$DSH_HOME/settings.yaml`）。

##### 事实（NEW）

`packages/settings/settings/src/index.ts` 重写为 `SettingsForms`：

```ts
export class SettingsForms extends Service {          // :224
  static inject = ['configEditor', 'profileContext']  // :224
  constructor(ownerContext) { super(ownerContext, 'settings') }
  configure(presentation: { auto?: boolean }, owner: Fiber = this.ctx.fiber): () => void  // :266
  get writable(): boolean                             // :290（恒 true）
  get documentPath(): string                          // :292
  prepareDocument(): Promise<string>                  // :296
  describe(options?: SettingsDescribeOptions): SettingsDescriptor[]                       // :302
  async update(ns: string, patch: object, expectedRevision?: number): Promise<void>       // :347
  async replace(ns: string, section: object, expectedRevision?: number): Promise<void>    // :357
  async mutate(ns: string, ops: readonly SettingsPathOp[], expectedRevision?): Promise<void> // :367
}
```

- **`register` / `installSection` / `get` / `watch` / `SettingsScope` 全部不存在。**
- `SettingsNamespace` 语义改变：OLD 是"插件注册的命名空间"，NEW 是 **profile 中 Loader entry 的 id**（`src/types.ts:7`："Nominal id of one profile plugin entry"）。
- `SettingsDescriptor` 增 `autoGenerate: boolean`；`applies` 收窄为字面量 `'live'`；`update/replace/mutate` 的 `ns` 参数类型由 branded `SettingsNamespace` 放宽为 `string`。
- 事件只剩 `settings/document-updated(ns, revision)`（`src/types.ts:75`）；**`settings/updated` 已删除**。
- 面板只暴露 **`.volatile()` 标记过的 Config 字段**（`src/schema.ts` 的 `volatileForm` / `isVolatilePath` / `plainConfig`）。

##### 设置的新写法（权威示例）

```ts
// packages/shell/bash-local/src/index.ts:100（NEW）
import type { Volatile } from '@deepseek-ai/cordis'
static Config = z.object({
  cwd: z.string().volatile(),
  timeoutMs: z.number().default(120_000).volatile(),
  maxTimeoutMs: z.number().default(600_000).volatile(),
  maxOutputBytes: z.number().default(64_000).volatile(),
  maxSpillBytes: z.number().default(DEFAULT_MAX_SPILL_BYTES).volatile(),
  graceMs: z.number().default(DEFAULT_GRACE_MS).volatile(),
})
constructor(ctx: Context, readonly config: Config) { super(ctx) }
// 读取：this.config.timeoutMs.get()
```
对照 OLD（`packages/shell/bash-local/src/index.ts:105-135`）：普通 `z.object({...})` + `ctx.inject(['settings'], s => s.settings.installSection(ctx, SHELL_SETTINGS_NAMESPACE, Config, entry, { validate, setSource, onChange }))`。OLD `packages/shell/shell/src/index.ts:21` 导出 `SHELL_SETTINGS_NAMESPACE = 'shell'`，**NEW 已删除**。

##### 客户端侧：`settingsScope` → `configForms`

- `ctx.settingsScope`（OLD，由 `packages/client/ui-settings/src/client/settings-scope.ts` 提供）**整文件删除**。
- 新服务 `configForms`：`packages/client/ui-settings/src/client/config-form.ts:266`，
  `describe()` `:285`、`get<T>(entryId): ConfigForm<T>` `:293`、`whileServed(namespaces, register: (served: ReadonlySet<string>) => () => void): () => void` `:317`；
  `ConfigFormController<T>`（`:50`）：`getSnapshot()` / `subscribe()` / `set(field,value)` / `unset(field)` / `mutate(ops, expectedRevision?)` / `dispose()`。
- 旧 keyed 槽 **`settings.plugin.item` 已删除**；插件设置页改注册到新包 `packages/client/ui-plugin-manager` 的 **`plugins.item`** 槽。
- 权威范式（`packages/client/ui-settings-shell/src/client/index.ts`）：
  ```ts
  export const inject = ['slots', 'locale', 'configForms']
  const bash = new ShellCardController(ctx.configForms.get(BASH_NS))   // BASH_NS = 'bash-sandbox'
  ctx.effect(() => ctx.configForms.whileServed([BASH_NS, PWSH_NS], served => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: 'shell', order: 10, label: () => t('title'), locale: NS,
    inject: () => (served.has(PWSH_NS) ? pwsh : bash).inject(),
  }, ShellCard))), 'ui-settings-shell: page')
  ```
- 宿主侧关闭自动页：在 `apply` 内可选子 fiber `ctx.inject(['settings'], (s) => s.settings.configure({ auto: false }, ctx.fiber))`（`packages/settings/settings/README.md`）。
- 新包拆分：`client/ui-settings-{shell,agent-loop,subagent,web-search,account}`；`ui-settings-plugins` 只剩 section 骨架与 `settings.plugins.tab` 槽。

##### 持久化迁移

- `packages/settings/settings-file` **整包删除**。
- 新：`@deepseek-ai/dsh-config-editor`（`packages/boot/config-editor`），服务 `configEditor`：`Context.configEditor`（`src/index.ts:17`）、`entries(): Entry[]`（`:39`）、`configuration()`（`:49`）、`async edit(...)`（`:75`）、`get documentPath()`（`:34` = `profileContext.patchPath`）。
- `SettingsForms` 构造时一次性导入旧文档（`importLegacyDocument()`）：把 `$DSH_HOME/settings.yaml` 各 section 写入**同 id 的 profile entry**，随后重命名为 `settings.yaml.imported`。映射表 `LEGACY_SECTION_ENTRIES`：`ui-developer-tools`→`ui-settings`、`ui-onboarding`→`ui-settings-general`、`shell`→（win32 ? `pwsh-sandbox` : `bash-sandbox`）。
  → **`dsh-ldvh` 的段不在映射表内**，会按"section 名 = entry id"直接尝试写入；不匹配则记 warning 并留在 `.imported` 文件里。

##### 影响（对 dsh-ldvh）

**必改**：`dsh-ldvh/plugin/lib/client.js:962` 的 `ctx.settingsScope.bind({ namespace: "dsh-ldvh" })` 在 0.1.7-rc.1 **会因服务缺失而使整个 inject 块落空**；`lib/client.js:953` 的 `inject = ["slots","locale","settingsScope"]` 同步需改。宿主侧需在插件 `Config` 上给要暴露的字段加 `.volatile()`。

---

#### 3. `shellEnv` —— API 未变，内置变量扩充

`packages/shell/shell-env/src/index.ts` 公开方法逐个对齐：`register(contributor: BashEnvContributor)` `:114`（OLD `:108`）、`collect(execution: ToolExecution): DshEnvironment` `:156`（OLD `:150`）、`list(): BashEnvVariableInfo[]` `:193`（OLD `:182`）。`BashEnvContributor`（`name`/`variables`/`resolve(execution)`）与 `Config`（`dshHome?`）均未变。

新增内置事实：`DSH_PROFILE`（`:74`）、`DSH_PROFILE_DIR`（`:75`），并加入 `RESERVED_BASH_ENV_KEYS`（`:77-83`）；取值来自新增的 `ctx.get('profileContext')`（`packages/boot/app-boot/src/profile-context.ts:35`，字段 `name`/`dir`/`home`）。

**影响**：`ctx.shellEnv.register(...)` 无需改动；若曾占用 `DSH_PROFILE` / `DSH_PROFILE_DIR` 键，会与保留键冲突。

---

#### 4. `tools` —— 工具注册与呈现契约

##### 公开方法集完全一致

| 方法 | NEW `packages/core/tools/src/index.ts` | OLD |
|---|---|---|
| `presentAs(mode: ToolPresentationMode): () => void` | `:973` | `:938` |
| `register(definition: ToolDefinition): () => void` | `:1062` | `:1027` |
| `restrict(filter: ToolRestriction): () => void` | `:1096` | `:1061` |
| `guard(guard: ToolGuard): () => void` | `:1135` | `:1100` |
| `get(name, scope?)` | `:1229` | `:1194` |
| `schemas(scope?): ToolSchema[]` | `:1259` | `:1224` |
| `executionMode(exec)` | `:1302` | `:1266` |
| `async execute(exec): Promise<ToolExecutionResult>` | `:1368` | `:1332` |

`ToolDefinition` / `defineTool` 的**必需字段未变**：`name` / `description` / `parameters` / `output: { schema, render }` / `execute(args, exec)`。**普通对象直接 `register()` 依然合法**。

##### 增量扩展（非破坏）

- `ToolDefinition.projectContent?(exec, result): ContentBlock[] | undefined` —— 在 `tools/post-execute` 之前安装内容的新钩子。
- `PreToolDecision` → `{kind:'allow'} | {kind:'deny'; reason: string; info?: ToolErrorInfo} | {kind:'cancel'} | {kind:'ask'; reason?}`（新增 `cancel` 与 `deny.info`）。
- `ToolErrorInfo.reason?: string`；`ToolExecutionInput.schema?: ToolSchema`；`PtcDispatchEventData.error?: {name; code; reason?}`（`src/types.ts`）。
- `ToolSchema.deferLoading?: true`（`packages/llm/llm/src/types.ts:461`），`defineTool` 选项同步新增（`packages/core/tools/src/schema.ts`）。

##### 工具呈现 / 结果契约

- **`tool-present` 迁址**：`packages/fs/tool-present`（OLD）→ **`packages/deliverables/tool-present`（NEW 新包）**。包名与工具名（`present`）不变，`Config.maxFiles` 默认 8。其实现可作"结果 → durable 附件"范式：`ctx.on('tools/result', (exec, result) => ...)` → `session.append('deliverables/presented', { turn, callId, files })`。
- 新包 `packages/deliverables/workspace-changes`。
- 呈现词汇导出（`ToolCallView` / `ToolResultView` / …）清单**无差异**（`packages/core/tools/src/index.ts` 的 re-export 块）。
- `packages/core/agent-tool-presentation/src/index.ts`：`ctx.inject(['codeRuntime'], ...)` → `ctx.inject(['ptcRuntime'], ...)`。

**影响**：`ctx.tools.register(descriptor)` 与 `ctx.tools.guard(fn)` **零改动**。

---

#### 5. `sessions` / `sessionLog`

`packages/core/session/src/index.ts:934`（构造器）/`:935` `super(ctx,'sessions')`。公开方法逐个对齐：`create` `:968`（OLD `:930`）、`prepare` `:1000`（`:962`）、`enter` `:1067`（`:1028`）、`announce` `:1122`（`:1083`）、`flush` `:1176`（`:1137`）、`get` `:1209`（`:1170`）、`list` `:1217`（`:1178`）、`fork` `:1237`（`:1196`）。
`Session.append<T>(type, data, ...opts): SessionEvent<T>`（`:720`）与 OLD（`:703`）**签名一致**（含 `SurfaceIntent` 可变参数）。
**新增**：`Session.registerMessageProjection(projection): () => Promise<void>`（`:924`）、`Session.messageProjections`（`:913`）。
**`sessionLog` 不是服务名** —— 两版本都不存在 `ctx.sessionLog`；相关能力在 `packages/session-query/session-log-export`（函数式，无 Service 声明）。

**SessionEventMap 差异**：新增 `image/offload`、`workspace/changes`；删除无。
`packages/core/session/src/known-event-types.ts` 新增白名单项 `developer/message`、`image/offload`、`workspace/changes`，并新增导出 `MESSAGE_PROJECTION_EVENT_TYPES = new Set(['image/offload'])`。
新包 `packages/session/session-format-v3-to-v4`（Session 格式 3→4 迁移，属持久化研究线）。

**影响**：`session.append` 与 `session/event` 监听无需改动；新增自定义事件类型必须登记进 `KNOWN_SESSION_EVENT_TYPES`（两版本规则相同）。

---

#### 6. `agents` / `agentLoop`

`packages/core/agent/src/index.ts:256` `super(ctx,'agents')`；新增 `async announce(agent, source: SessionStartSource, signal?: AbortSignal): Promise<void>`（`:537`）。
`packages/core/agent-loop/src/index.ts:355` `super(ctx,'agentLoop')`；`publish(source): Promise<AgentHandle>`（`:210`）。

##### ⚠ 破坏性：`agent/session-start` 被删除

```ts
// OLD packages/core/agent/src/runtime-types.ts:316   @mode emit
'agent/session-start'(this: Scoped<Agent>, payload: { agent: Agent; source: SessionStartSource }): void

// NEW packages/core/agent/src/runtime-types.ts:261   @mode serial
'agent/created'(this: Scoped<Agent>, payload: {
  agent: Agent; source: SessionStartSource; signal?: AbortSignal
}): undefined | Promise<undefined>
```
`SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'`（NEW `:125`）。

语义变化（NEW JSDoc）：由 `emit`（失败被包含）改为 **`serial`** —— 监听器按序 await，全部完成后 creation 才 resolve，AgentLoop 期间持有排队输入；**抛出或 reject 会使 agent 创建失败并跳过后续监听器**；监听器不得 `await agent.whenIdle()` 或自身 owner 的 disposal。

**影响**：`dsh-ldvh` 监听了 `agent/session-start`，在 0.1.7-rc.1 **永不触发**；必须迁移到 `agent/created`（用 `payload.source` 区分四态），且**必须保证不抛异常**。

---

#### 7. `attachments` / `llm`

- `packages/attachment/attachment/src/index.ts:55` `super(ctx,'attachments')`；方法名两版本完全一致（`saveImages` / `admitPromptContent` / `admitEncodedFile` / `isAttachmentError` / `imageHostPath` / `saveFile` / `saveFileStream` / `fileHostPath` / `readImageRequest`）。
- 类型变更：`ImageRequestPolicy { maxPixels, maxBytes }` → **`ImageRequestTarget { width, height, maxBytes }`**（`src/types.ts`）。
- `packages/llm/llm/src/index.ts:346` `super(ctx,'llm')`；`ToolSchema` 在 `name` 前新增 `deferLoading?: true`（`src/types.ts:461`）。
- `MessageSourceMap` 成为新扩展点：`packages/core/tools/src/index.ts` 声明 `'tool-registry'`；`packages/interaction/user-approval/src/index.ts` 声明 `'user-approval': { kind: 'user-approval' } & ContextFormed`，**替代旧字面量 `source: { kind: 'plugin', plugin: 'user-approval' }`**。

---

#### 8. 权限与沙箱

##### `authorization`
`packages/credentials/authorization/src/index.ts:197` `super(ctx,'authorization')`。
- **新增** `AuthorizationSession.commit(record: CredentialRecord): Promise<void>`（`:100`）：在流内部提交记录并拒绝已取消的尝试；提交后取消需等待完成。
- `cancel(key)` 跳过正在提交的尝试：`if (running !== undefined && !running.committing) running.controller.abort()`（`:263`）；`InFlight` 增 `committing: boolean`（`:182`）。
- 新增强制约束：流必须 commit，否则报 `NOT_COMMITTED`（`:444`）/ "deleted its credential record instead of committing one"（`:450`）。

##### `approval`
`packages/interaction/user-approval/src/index.ts:156` `super(ctx,'approval')`；`setPolicy`（`:184`）、`async request(req): Promise<ApprovalOutcome>`（`:215`）、`overrideOf(session)`（`:252`）**均未变**。仅有消息 `source` 由 `{kind:'plugin', plugin:'user-approval'}` 改为 `{kind:'user-approval'}`。

##### `sandbox`
- `packages/sandbox/sandbox/src/index.ts:158` `abstract class SandboxProvider`，`:161` `super(ctx,'sandbox')`。
- **破坏性**：`confine()` 同步 → 异步且新增 signal：
  `abstract confine(argv: readonly string[], policy: SandboxPolicy, signal?: AbortSignal): Promise<ConfinedArgv>`（`:176`）。
- `src/escalation.ts` 的 `approveEscalation()` 新增短路 `if (mode === effectiveMode) return effectiveMode` —— **重复请求调用方已有的有效模式不再需要人工审批**（OLD 会走审批通道）。
- 新增 `src/diagnostics.ts`，再导出 `classifyRunnerFailure` / `isRunnerSpawnFailure` / `matchesSignature`。
- **文件策略模式串未变**：`danger-full-access` / `workspace-write` / `read-only` 两版本都在 `packages/sandbox/sandbox-policy`（`SANDBOX_MODES`，`session-mode.ts`）。

##### `sandboxPolicy`
`packages/sandbox/sandbox-policy/src/index.ts:126` `super(ctx,'sandboxPolicy')`。
- 破坏性：`resolveWorkspaceRoot()` 由 `resolvePath(canonicalPath(path))` 改为
  ```ts
  if (!isAbsolute(path)) throw new Error('sandbox-policy: workspace root must be an absolute execution-world path')
  return path
  ```
  → **`Config.workspaceRoot` 必须是绝对路径**，且不再做路径规范化（符号链接/身份解析下移到具体 provider）。
- `Config.mode`（默认 `read-only`）与 `Config.workspaceRoot`（默认 `process.cwd()`）字段名未变。

##### `fs`
`packages/fs/fs/src/index.ts:89` `super(ctx,'fs')`。**新增** `watch(target, changed, signal): Promise<() => Promise<void>>`（`:100`），默认实现抛 `FsError('Filesystem watching is not supported by this provider.', 'FS_IO_ERROR')`。`fs/edit-intent` / `fs/observed` / `fs/write-intent` 两版本均在。

---

#### 9. `shell` / `subprocess`

##### 破坏性：`ShellExecutor.run()` 与 `start()` 被 `execute()` 取代

```ts
// OLD packages/shell/shell/src/index.ts
export const SHELL_SETTINGS_NAMESPACE = 'shell'                 // :21
abstract resolve(request: ShellExecRequest): ShellExecSpec      // :84
abstract run(spec: ShellExecSpec): Promise<ShellRunResult>      // :92
abstract start(spec: ShellExecSpec): ShellProcess               // :99

// NEW packages/shell/shell/src/index.ts
abstract resolve(request: ShellExecRequest): ShellExecSpec      // :84
abstract execute(spec: ShellExecSpec): Promise<ShellExecution>  // :93
```
新增 `ShellExecution extends ShellProcess { result(): Promise<ShellRunResult> }`；`ShellProcess` 增 `observed: ShellObservedStreams`（非消费型 offset 读取器）；新增 `ShellExpiryPolicy = 'kill' | 'none'` 与 `ShellExecRequest/Spec.onExpiry`。`SHELL_SETTINGS_NAMESPACE` 删除（见 §2）。

##### `subprocess`
`packages/subprocess/subprocess/src/index.ts:119` `super(ctx,'subprocess')`。
- 新增抽象方法 `terminalEnvironment(signal?): Promise<SubprocessTerminalEnvironment>`（`:143`），返回 `{ platform: 'posix'|'windows'; defaultShell?: string }`。
- 新增 `SubprocessExecutableNotFoundError`（`:173`）。
- `SubprocessStdio.control?: 'pipe'`、`SubprocessHandle.control: Duplex | undefined`、`SubprocessTerminalHandle.resize(cols, rows)`、`inspectActivity(): Promise<SubprocessTerminalActivity>`、`SubprocessTerminalSpawnSpec.terminalType`（**新增必填**）/ `shellActivity`。
- 新增 `shell-activity.ts` / `output.ts` / `control.ts`。

**影响**：`dsh-ldvh` 未直接调用 `ctx.shell.run/start`；但若其 Web API 子进程逻辑经 `ctx.subprocess` 派生终端，需补 `terminalType`。

---

#### 10. 其余服务与事件面

##### 未变（可直接继续用）
`skills`（`packages/skill/skill/src/index.ts:374`；仅 `SkillSummary.path?` 由子类型上移到 `SkillSummary`）、`workflowEngine`（`packages/workflow/workflow/src/index.ts:159`）、`webhookRuntime`（`packages/webhook/webhook/src/index.ts:73`）、`commands`（`packages/interaction/commands/src/index.ts:277`，`register`/`registerFileReceiptResolver`/`list`/`find`/`execute` 逐个对齐）、`jobs`（`packages/jobs/jobs/src/index.ts:93`）、`goals`（`:251`）、`terminals`（`packages/terminal/terminal/src/index.ts:116`）、`storage`、`spillStore`、`credentials`、`lsp`、`invariants`（`register(packageName, installer)` 一致）、`userQuestions`（`async ask(request)` 一致）、`modelDirectories`、`permissionPresets`、`planMode`、`compaction`、`subagents`、`agentPresets`、`sessionPersistence`、`sessionProjections`、`sessionQuery`、`workspaceRegistry`、`directoryPicker`、`cordisInspect`。

##### 新增服务
`accountController`、`browserUse`、`computerUse`、`configEditor`、`configForms`、`deepseekAccount`、`hmr`、`jobController`、`mcpResources`、`officeToPdf`、`pluginManager`、`pluginPackages`、`pluginRegistryProbe`、`productTelemetry`、`ptcRuntime`、`speechController`、`speechToText`、`ssh`、`terminalController`、`webTerminals`。

##### 事件面（Cordis `Context['Events']`）
自动提取：OLD 90 个事件名 → NEW 99 个。

**新增（11）**

| 事件 | 声明处 |
|---|---|
| `app-boot/config-reload(): void` | `packages/boot/app-boot/src/index.ts:52` |
| `compaction/summary-error(payload, next): boolean`（waterfall） | `packages/compaction/compaction/src/index.ts:106` |
| `connection/request(req, res, next): Promise<void>`（waterfall） | `packages/client/connection/src/index.ts:67` |
| `hmr/change(url: string): void` | `packages/boot/hmr/src/index.ts:30` |
| `hmr/reload(...)` | `packages/boot/hmr/src/index.ts` |
| `permission-presets/catalog-changed(): void` | `packages/interaction/permission-presets/src/types.ts:48` |
| `plugin-manager/changed(change: PluginChange): void` | `packages/boot/plugin-manager/src/types.ts:243` |
| `plugin-manager/install-log(chunk): void` | `packages/boot/plugin-manager/src/types.ts:249` |
| `plugin-manager/install-state(progress): void` | `packages/boot/plugin-manager/src/types.ts:256` |
| `workspace/session-activity(...)` | `packages/workspace/workspace/src/index.ts:129` |
| `workspace/session-stop(request): Promise<void> \| void` | `packages/workspace/workspace/src/index.ts:147` |

**删除（2）**：`agent/session-start`（合并进 `agent/created`）、`settings/updated(ns, next, prev, source)`（只剩 `settings/document-updated`，值变化需自行 diff）。

**签名变更（1）**：`agent/created`（见 §6）。

**未变的关键事件**（对第三方生命周期最重要）：`tools/pre-execute` / `tools/execute` / `tools/post-execute` / `tools/ptc-dispatch-log` / `tools/result` / `tools/change`、`session/created`（`packages/core/session/src/index.ts:53`）/ `session/disposed`（`:63`）/ `session/event`（`:75`）、`agent/disposed` / `agent/status` / `agent/pre-step` / `agent/request` / `agent/assistant-stream` / `agent/turn-stopping` / `agent/inbox/*`、`system-prompt/assemble` / `system-prompt/change`、`fs/edit-intent` / `fs/observed` / `fs/write-intent`、`approval/request`、`authorization/settled`、`credentials/*`、`webserver/index-inject`、`commands/change`、`workflow/*`、`subagent/*`、`skills/change`、`api-session/*`、`goal/*`、`slots/changed`、`theme/change`、`locale/change`。

> 提取含测试夹具事件（`demo/*`、`fixture/*`、`meta-fixture/*`、`scope-test/ping`、`invariants-test/ping`），上表已排除。

---

#### 11. 包清单变化

`git ls-tree` 统计：`packages/<area>/<pkg>/package.json` 由 **267 → 307**，**新增 51 个、删除 11 个**。

**删除**：`code-runtime/code-runtime`、`code-runtime/code-runtime-worker-thread`、`e2b/e2b`、`e2b/fs-e2b`、`e2b/subprocess-e2b`、`experimental/agent-team-web-profile`、`experimental/code-runtime-python`、`fs/tool-present`（迁至 `deliverables/`）、`preset/agent-presets`（拆为 `agent-preset` + `agent-preset-registry`）、**`settings/settings-file`**、`workflow/workflow-worker-thread`。

**新增（与宿主插件相关）**：`boot/config-editor`、`boot/hmr`、`boot/plugin-manager`、`deliverables/tool-present`、`deliverables/workspace-changes`、`ptc-runtime/ptc-runtime`、`ptc-runtime/ptc-runtime-node`、`client/ui-plugin-manager`、`client/ui-settings-{shell,agent-loop,subagent,web-search,account}`、`mcp/mcp-resources`、`api/{account-controller,job-controller,terminal-controller}`、`host/product-telemetry-otel`、`session/session-format-v3-to-v4`、`ssh/*`、`util/{package-manifest,lazy-require}`。

**清单契约**：`package.json` 的 `dsh.bundle.patch`（`string | string[]`）与 `dsh.client.{platform,inject,external,immediately}` 语义**保留**，新增统一校验器 `@deepseek-ai/dsh-package-manifest`（`packages/util/package-manifest/src/types.ts`）；`packages/client/modules/src/client/manifest.ts` 新增 `parseDshClient()` / `exactPackageSpecifier()`。

**相关小改**：`packages/host/plugin-inventory/src/types.ts` —— `PluginInventoryEntry.meta?` / `AgentPresetPluginRow.meta?` 新增，`AgentPresetPluginGroup.trust` **删除**，`PluginInventorySnapshot.managementAvailable?` 新增。`packages/boot/plugin-manager` 引入 `pluginManager` 服务（`src/index.ts:206`）与三个 `plugin-manager/*` 事件。

---

#### 对 dsh-ldvh 的适配建议

按优先级。每条为「旧写法 → 新要求」+ 证据。

##### P0 —— 必改，否则功能失效

1. **`settingsScope` → `configForms`（客户端设置面板）**
   - 旧：`plugin/lib/client.js:962` `ctx.settingsScope.bind({ namespace: "dsh-ldvh" })`；`plugin/lib/client.js:953` `inject = ["slots","locale","settingsScope"]`。
   - 新：`inject` → `["slots","locale","configForms"]`；`ctx.configForms.get('<entryId>')` 取 `ConfigForm`；`ctx.configForms.whileServed([...], served => ctx.slots.inject('plugins.item', () => ctx.slots.register({ name:'plugins.item', id:'ldvh', order, label, locale, inject }, Component)))` 注册页面。
   - 证据：`packages/client/ui-settings/src/client/config-form.ts:266/285/293/317`；范式 `packages/client/ui-settings-shell/src/client/index.ts`。旧文件 `settings-scope.ts` 已删；旧槽 `settings.plugin.item` 已不存在。

2. **宿主侧设置命名空间注册 → `Config` + `.volatile()`**
   - 旧：`ctx.settings.register(ns, schema)` 或 `ctx.settings.installSection(ctx, ns, schema, entry, hooks)`。
   - 新：在插件 Loader entry 的 schemastery `Config` 上给要暴露的字段加 `.volatile()`（类型变 `Volatile<T>`，读取用 `.get()`）；`ctx.settings` **没有 `register`**，只有 `describe/update/replace/mutate/configure`。
   - 证据：`packages/settings/settings/src/index.ts:224/266/302/347/357/367`；对照 `packages/shell/bash-local/src/index.ts:100-107`（NEW）vs `:105-135`（OLD）。

3. **`agent/session-start` 监听器迁移到 `agent/created`**
   - 旧：`ctx.on('agent/session-start', ({ agent, source }) => ...)`。
   - 新：`ctx.on('agent/created', ({ agent, source, signal }) => ...)`，**回调必须不抛异常**（`@mode serial`，抛错使 agent 创建失败），可返回 Promise（AgentLoop await 后才放行排队输入）。
   - 证据：`packages/core/agent/src/runtime-types.ts:261`（NEW）vs `:316`（OLD）。

##### P1 —— 需要核查

4. **`webServer.register` 无需改动**（`packages/host/webserver/src/index.ts:166`，两版本逐字一致）。`/ldvh` 与 `/ldvh/api` 两条 prefix 路由写法保留。
5. **索引注入 URL 改为文档相对**：若用 `webserver/index-inject` 或 `webServer.tapIndex` 注入资源引用，改用 `plugins/...` 而非 `/plugins/...`，配合 `frontend-static` 的 `<base href="./">`（`packages/host/frontend-static/src/index.ts:118`）。
6. **`connection.handle()` 回调新增第 4 参数 `peer`**（`packages/client/connection/src/rpc.ts` 的 `ConnectionRpcHandler`）。`plugin/lib/rpc.js` 的 `connection.handle(endpoint, () => ...)` 忽略入参，运行时安全；类型化实现需同步。
7. **`ctx.tools.register` / `ctx.tools.guard` / `ctx.invariants.register` / `ctx.userQuestions.ask` / `ctx.commands.register` 全部无需改动**（逐方法对齐，见 §4/§10）。
8. **`peerDependencies` 需重新评估**：
   - `@deepseek-ai/dsh-host-webserver`: `>=0.1.2-alpha.1 <0.2.0` 可保留（API 未变）。
   - `@deepseek-ai/dsh-settings`: 现有范围 `^0.1.0-rc.6 || ^0.1.1-rc.2 || >=0.1.2-alpha.1 <0.2.0` 覆盖的旧 `ctx.settings` 契约在 0.1.7-rc.1 已不存在 —— 该 peer 的语义需重写（可能改为依赖 `@deepseek-ai/dsh-client-ui-settings` 的 client 面）。
   - `devDependencies` 中 `@deepseek-ai/dsh-{llm,scope,tools}` = `0.1.5-rc.1`，建议升到 `0.1.7-rc.1`。

##### P2 —— 可选增强

9. `ctx.tools.register` 可用 `deferLoading?: true` 延迟加载工具定义（`packages/llm/llm/src/types.ts:461`）。
10. `PreToolDecision` 新增 `{kind:'cancel'}`，guard 中可表达"取消"而非"拒绝"。
11. 若给 `sandboxPolicy` 传 `workspaceRoot`，确保是绝对路径。
12. 新增 `ctx.fs.watch()` 可替换自建文件轮询（`packages/fs/fs/src/index.ts:100`）。

---

#### 待确认项

1. **`dsh-ldvh` 的 Loader entry id**。`plugin/cordis.patch.yml` 声明 `- id: dsh-ldvh`，但该 id 是 bundle patch 的 insert 行 id，不必然是 profile 中 entry 的最终 `options.id`。新版 `settings` 以 `entry.options.id` 为 `ns`，`configForms.get()` 也按它取用 —— **必须在实际 profile 中确认**，否则取不到表单。
2. **现有 `settings.yaml` 中 `dsh-ldvh:` 段的归宿**。`importLegacyDocument()` 只映射三个已知 section；其余按"section 名 = entry id"直接写入，不匹配则记 warning 并留在 `settings.yaml.imported`。未实测。
3. **第三方 prefix 路由的认证边界**。NEW 新增 `connection.admit()` 与 `connection/request` waterfall，但 `admit()` 只作用于 connection 自注册的 `/api` route；`/ldvh/api` 这类第三方 prefix 路由仍不经宿主 Host/Origin 认证。两版本行为一致，但 NEW 是否提供了"插件应经 `connection/request` 自建 gating"的官方路径，未见文档明确 —— 待确认。
4. **`agent/created` 的 `@mode serial` 与 `Scoped<Agent>` 的交互**：OLD 的 `packages/core/scope/src/scoped-events.generated.ts:21` 有 `'agent/session-start'` 条目；NEW 该生成文件的对应条目与 `serial` 模式的组合行为未逐行核对（本次提取未覆盖生成文件）。
5. **`settings/updated` 的替代路径**：NEW 无"值变化"事件；`packages/settings/settings/README.md` 提到消费者可改用 `loader/volatile-update`，但该事件未出现在本次提取的 `Context['Events']` 清单中（可能在 `vendor/cordis` 的 Loader 类型内），**未确证**。
6. **`tool-present` 迁址是否伴随行为变化**：包名/工具名/参数未变，但 NEW 文件为区间新增，未与 OLD 的 `packages/fs/tool-present/src/index.ts` 逐行比对。
7. **事件清单提取的完整性**：本次基于 `declare module '@deepseek-ai/cordis' { interface Events { ... } }` 块的正则扫描；多行声明与 JSDoc 内含事件名的情况可能漏检（新旧提取条目数 99/90 自洽，但多行感知版本给出 86/80）。§10 的 11 个新增与 2 个删除事件已用直接 `git grep` 逐条复核。
8. **`webServer` 是否仍是 web 路由的唯一推荐接缝**：`git grep "kind: 'prefix'"` 在 NEW 只有 4 处消费者（connection ×2、client-modules、open-in-app），未见新的替代服务；但 `packages/api/gateway` 的 Remote 命名空间路径未纳入本次调研范围。
## A.4 Client / Web 插件契约与 UI 扩展点

### Client / Web 插件契约速查（主调研员补齐）

> **来源说明**：原定负责本主题的并行调研线未在本次会话时限内交付，为不留下空白，本节由主调研员以**运行中宿主 Inspect 取证**（`client/Service`、`client/Slots`、`client/Theme`）与线 2/3 已确证的源码结论补齐。凡未标注【运行时】的条目均来自 git tag 源码；未覆盖项列在文末。

#### 1. client 插件入口契约

- `package.json` 的 `dsh.client` 契约字段（`platform` / `inject` / `external` / `immediately`）**两版本保留未变**（线 2/3），`dsh.bundle.patch` 由 `string` 放宽为 `string | string[]`（旧写法仍有效）。
- 客户端半边由宿主 `clientModules` 服务承担：`graph()` / `clientPath(id)` / `fetchBundle(request)` / `artifactBaseline(id)` / `rebuilt(id)` / `onRebuilt(listener)` / `onGraphChanged(listener)`（【运行时】host/Service 目录）。即：`dsh.client` 扫描 → boot graph → bundle 路由下发。
- 客户端确有独立的 HMR 通道（`packages/client/hmr`，`client/hmr/src/invariant.ts` 两版皆在）；宿主 HMR 服务（`ctx.hmr`）的 `hmr/reload` 事件在模块替换装载完成后触发。
- **注入声明在客户端侧与宿主侧语义不同**：宿主侧为 Cordis 服务依赖；客户端侧还可能是"必须存在的服务名列表"（dsh-ldvh 的 `inject = ["slots","locale","settingsScope"]` 即因此整体落空，见 §4.3）。

#### 2. Slot 系统

- 客户端服务 `ctx.slots` 三件套：`register`（`SlotCore['register']`）、`registerFactory`、`inject(key, callback)`（【运行时】client/Service 目录）。
- **全树 92 个 Slot**：`single` 39 / `keyed` 18 / `list` 32 / `chain` 2 + `factory` 1，每个带 `kind` / `scope`（`root` / `session` / `session-maybe`）/ `purpose` / `replaceRisk`（`none` / `shadows-shipped-ui`）/ 键域，完整表见**附录 B.3**。
- 与插件作者最相关的注册形状（由 B.3 的 `registration` 字段给出）：
  - `list` 类：`{ id: string(必填), order?: number, label?: string | (() => string) }`
  - `keyed` 类：`{ key: string(必填) }`，键域可能是**开放**（任意字符串）或**固定**（由 owner 键表决定）
  - `chain` 类：`{ select: (owner) => unknown | null }`（选择性替换）
- **dsh-ldvh 相关槽位现状**（【运行时】）：
  | 槽位 | 0.1.7-rc.1 | 说明 |
  |---|---|---|
  | `conversation.view` | ✅ 存在（list / session） | 对话 Tab 投放面，注册形状 `{id, order?, label?}` 未变 |
  | `settings.plugin.item` | ❌ **不存在** | 旧设置卡插槽已删 |
  | `plugins.item` | ✅ 存在（list / root） | 官方插件卡位，`{id, order?, label?}` |
  | `plugins.bundle.config` | ✅ 存在（keyed / root） | key = bundle 包名，`view: 'page'` |
  | `plugins.row.config` | ✅ 存在（keyed / root） | key = `<包名>#<row id>` |
  | `plugins.detail.actions` / `.badge` / `.section` | ✅ 存在 | 详情页扩展位 |
  | `settings.section` / `settings.plugins.tab` / `settings.general.item` | ✅ 存在 | 设置页 / 行扩展位 |

#### 3. 客户端可注入服务清单【运行时】

当前 realm 的基础客户端服务共 9 个（其余按 composition 由插件装配）：

| 服务 | 职责 | 关键方法 |
|---|---|---|
| `layout` | 面板导航与几何 | `selectPanel` / `beginNavigation` / `toggleSidebar` / `openRightbar` / `closeRightbar` |
| `locale` | 字典注册与语言偏好 | `getLocale` / `setLocale` / `addLanguage` / `register(ns, dicts)` / `bind(ns)` |
| `sessions` | 会话服务客户端面 | `retain` / `using` / `search` / `fork` / `scope` / `binding` |
| `slots` | 槽位系统服务层 | `register` / `registerFactory` / `inject` |
| `theme` | 主题注册与偏好 | `getTheme` / `setTheme` / `setFontSize` / `register` / `overrideTokens` |
| `timer` | 计时辅助 | `timeout` / `interval` / `throttle` / `debounce` |
| `uiWorkspace` | 工作区归档与目录操作 | `openSession` / `openWorkspace` / `forkSession` / `startSession` / `archiveSession` / `pickDirectory` / `listDirectory` / `createDirectory` |
| `workspaces` | 工作区控制器客户端面 | `create` / `rename` / `delete` / `archiveSession` / `unarchiveSession` / `insertSessionBefore` |

**插件装配的服务**（本区间新增，dsh-ldvh 需要）：**`configForms`**（由 `packages/client/ui-settings/src/client/config-form.ts:266` `super(ctx, 'configForms')` 提供）。

#### 4. 客户端设置读写：`ctx.configForms`

| 方法 | 用途 |
|---|---|
| `get(entryId)` | 绑定一个 profile 条目（= 设置命名空间）的表单作用域 |
| `describe()` | 跨命名空间的共享读面（快照 / 订阅 / 失效） |
| `whileServed(namespaces[], register)` | **注册规则**：仅当 Host 正在服务其中某个命名空间时执行注册，全部停止服务时注销（`ui-settings-shell` / `ui-settings-agent-loop` 的范式） |
| `developerTools.enabled` | 开发者工具开关（新版默认 `true`） |

范式代码：`packages/client/ui-settings-agent-loop/src/client/index.ts:47`、`packages/client/ui-settings-shell/src/client/index.ts:50` —— 二者都写作
`ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({…}))))`。

#### 5. 主题 token【运行时】

共 **14 个**，全部要求同时提供明/暗两套取值，前缀为 `--dsw-`（非 `--dsh-`）：

`--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1`、`--dsw-alias-bg-layer-2`、`--dsw-alias-bg-overlay`、`--dsw-alias-border-l1`、`--dsw-alias-border-l2`、`--dsw-alias-brand-primary`、`--dsw-alias-label-primary`、`--dsw-alias-label-secondary`、`--dsw-alias-state-error-primary`、`--dsw-alias-state-idle-primary`、`--dsw-alias-state-success-primary`、`--dsw-alias-state-warn-primary`、`--dsw-specific-sidebar-fill`。

覆盖方式：`ctx.theme.overrideTokens(source, tokens)`。

#### 6. 对 dsh-ldvh 的客户端适配建议（按优先级）

1. **先解决加载/执行**：`inject` 去掉 `settingsScope`；`ctx.settingsScope.bind({namespace})` → `ctx.configForms.get(<entry id>)`（见 §4.3）。
2. **图标族改名**：`dsh-client-ui-primitives` 的具名导出按新命名为准，并改为运行时探测 + 回退（见 §4.3 致命点 B）——这是渲染期崩溃点。
3. **设置卡换家**：`settings.plugin.item` → `plugins.bundle.config`（key = `dsh-ldvh`）或 `plugins.row.config`（key = `dsh-ldvh#<row id>`），带 `view: 'page'` 与自带保存控件；注册时机用 `configForms.whileServed`。
4. **`conversation.view` 可原样保留**（槽位与注册形状均未变），但注意其父链与 Session 作用域（session）语义。
5. **侧栏 Tab**：`betterSidebar` 属第三方服务，**不在 DSH 仓库契约内**，需按该插件自身版本确认。
6. **样式统一（可选）**：自建 SPA 当前自带样式；如需与宿主视觉一致，改用上表 `--dsw-*` token 并支持明暗两套。

#### 7. 本节未覆盖（原调研线未交付的部分）

- `ui-*` 各包的 Slot **props 契约**逐字段对照（本次只取证到槽位拓扑与注册形状，未逐字段比对 props 类型）。
- 客户端跨端 RPC 通道（`ctx.remote.*` 生成面）在**客户端插件自有命名空间**下的注册细节。
- 客户端插件构建产物契约（bundle 格式、externals、`web/dist` 约定）的逐项核对。
- `packages/client/ui-*` 各包的**包级**新增/删除清单（本次以运行时服务与槽位为准，未做包级 diff）。

## A.5 新增/移除能力面的能力语义与可用性

<!-- line: capabilities -->

### DSH 0.1.5-rc.2 → 0.1.7-rc.1：新增/移除能力面的能力语义与可用性

调研范围：`dsh-v0.1.5-rc.2` → `dsh-v0.1.7-rc.1`（3304 commits）。所有结论基于只读 `git show/diff/grep/ls-tree`，每个论断附包路径 + 关键字段 + 注册代码位置 + commit。

#### 结论速览

1. **`fs/tool-present` 不是被重写，而是被移动**：包名 `@deepseek-ai/dsh-tool-present` 与工具名 `present` 在两版完全一致，仅目录从 `packages/fs/` 迁到 `packages/deliverables/`，源码只改了 `description` 文案（commit `f800ea46e5`）。下游无需迁移代码，只需改 import 路径/依赖声明。
2. **真正的新能力在 `deliverables/workspace-changes`**：新增 `ctx.workspaceChanges` 服务 + `workspace/changes` 持久事件，提供「每轮工作区变更 + 单文件 diff」的 host 侧契约。这是 0.1.7 对第三方插件价值最高的**新只读观察点**。
3. **Office 走「外部 npm 运行时 + 工具入口」而非仓库内捆绑 Python**：`libreoffice-kit@^0.1.0` 是独立发布的 npm 包（独立仓库），`prepare:primary-runtime` 负责组装 Python/Node/pnpm 载荷，`load_workspace_dependencies` 工具只负责把绝对路径告诉模型。根 `native/`、`python/`、`pytest.ini` **在旧 tag 已存在**，不是新增；新增的根 `Makefile` 仅是开发快捷方式。
4. **ssh 家族（4 包）整体替代被移除的 e2b**：`ctx.ssh` 是唯一新服务名，另外三个包是**既有** `ctx.fs` / `ctx.subprocess` / `ctx.sandbox` 的远端 provider 实现。默认**不启用**，纯 opt-in composition。
5. **ptc-runtime 是 code-runtime 的改名 + 分层**：`ctx.ptcRuntime` 抽象 seam + `ptc-runtime-node`（base 默认启用）+ `experimental/ptc-runtime-python`；`workflow-ptc` 取代 `workflow-worker-thread`。被移除的 `code-runtime*` 无独立遗留空缺。
6. **agent preset 从「目录 + 专用 API」变成「普通 Cordis YAML 声明」**，这是对第三方插件扩展方式影响最大的一处：preset 现在是 profile 配置，新增/覆盖 = 安装一个 bundle patch。**代价：用户覆盖会整表替换 children，不合并后续内置变更。**
7. **browser-use / computer-use 是「单 provider 名额注册中心 + experimental rider」**：`ctx.browserUse` / `ctx.computerUse`，二者均**不在任何 bundle 中**，必须显式组合。macOS 权限与 cursor overlay 在 0.1.7-rc.1 **不是 DSH 的 deferred 项**，而是上游 Cua Driver SDK 的已实现能力 + 已文档化限制。
8. 会话格式细节（`session/session-format-v3-to-v4`，V3→V4 流式 tool-role 迁移）由另一条线负责，本文不展开。
9. **一个贯穿性的架构动作：web-app 把多类能力从「host 平面」搬到「preset 平面」。** `packages/bundle/web-app/cordis.patch.yml` 用大量 `- id: X / disabled: true` 关掉 base 的 host 平面行（`command-goal`、`tool-goal`、`plan-mode`、`compaction-basic`、`command-compact`、`tool-result-pruner`、`tool-subagent*`、`workflow-ptc`、`tool-workflow`、`tool-ralph`），让 preset 在自己的 `isolate` realm 里声明它们。**因此判断「某能力是否默认可用」不能只看 base 或 web-app 的 patch，必须同时看 preset patch。** 第三方插件选择挂载位置时也应遵循同一判据（注释中给出的原则：进程单例/跨会话查询/全局唯一注册名的能力留在 host 平面；每 Session 可不同的能力交给 preset）。

---

#### 1. deliverables：工具呈现与工作区变更卡

##### 1.1 是什么

新增 `packages/deliverables/` 包组，职责是「一轮对话交付给用户的东西」，以**只有客户端读取的持久 Session 事件**形式记录：

| 包 | 角色 | ctx key |
|---|---|---|
| `deliverables/tool-present` | 声明既有文件为最终交付物 | 注册到 `ctx.tools` |
| `deliverables/workspace-changes` | 记录每轮变更文件 + 行数 + 单文件对比 | 提供 `ctx.workspaceChanges`；监听 `session/event`，追加 `workspace/changes` |

##### 1.2 对外接口

- **`present` 工具**：`files: [{ path, description? }]`，配置 `maxFiles`（默认 `8`）。成功时 `tools/result` 追加 `deliverables/presented` 事件；嵌套调用也记录；已完成的声明不因外层程序失败而撤销。`./types` 纯入口导出 `PresentedFile` 与事件类型，不 import host 运行时。
- **`ctx.workspaceChanges`（workspace-changes）**：
  - `summary(sessionId, seq)` → 该 seq 事件所宣布的摘要，Session 销毁后为 `undefined`
  - `diff(sessionId, seq, index, signal)` → 单文件对比，含三行上下文 hunk；`binary` / `oversized` / `coarse`（超过 `diffTimeoutMs` 退化为整文件替换）
  - 配置：`timeoutMs` 30000、`outputMaxBytes` 8388608、`maxFiles` 500、`maxFileBytes` 2097152、`diffTimeoutMs` 100
- **覆盖机制**：turn 起止各做一次 git working-tree 快照（`GIT_OBJECT_DIRECTORY` 指向 Session 私有临时对象目录，仓库 index/objects/work tree/refs 不被写入），另外对 `write`/`edit`/变更型 `str_replace_editor` 的路径做整文件前后拷贝，以覆盖 git 管不到的文件。无 git 或无仓库时只列文件工具编辑。

##### 1.3 与旧 `fs/tool-present` 的差异（关键）

**是重命名/移动，不是重写。** 证据：

- 包名相同：两者都是 `"name": "@deepseek-ai/dsh-tool-present"`，`description` 也逐字相同。
- `src/types.ts` 在两版**完全相同**（`git diff` 无输出）。
- `src/index.ts` 仅 9 行差异，全部是工具 `description` 文案：旧版是强制语气（"you must call present after writing it"），新版改为选择性语气（"Use present when the user needs a separate file deliverable… at most 4 files in a single present call"）。
- 挂载集合不变：旧 tag 挂载在 `packages/preset/agent-presets/presets/{standard,ptc,cordis}/agent.cordis.yml`；新 tag 挂载在 `packages/bundle/web-app/presets/{standard,ptc,cordis}.patch.yml`，`minimal` 两版都不含。
- 变化只有 `directory` 字段、`workspace:^` → `workspace:*`/`workspace:~` 的版本区间写法，以及新增 `dsh-session-projection` 到 peerDependencies。

commit：`f800ea46e5 refactor(deliverables): group tool-present and workspace-changes under packages/deliverables`。

##### 1.4 默认与 opt-in

- `tool-present`：**默认启用**（web-app 的 standard/ptc/cordis 三个 preset 各挂一次），`minimal` 不挂。
- `workspace-changes`：**默认启用**，位于 `packages/bundle/web-app/cordis.patch.yml`（web-app 层，非 base）。
- 客户端渲染：`packages/client/ui-deliverables`（turn 尾卡 + ReviewTab + FileDiff）。

##### 1.5 对下游的意义

- 迁移成本极低：改 import 路径 `packages/fs/tool-present` → `packages/deliverables/tool-present`。包名未变，因此 `package.json` 依赖无需改。
- `ctx.workspaceChanges` 是新增的**只读**观察点：第三方插件可以读取「本轮改了什么、每个文件怎么改的」，而不必自己跑 git 或劫持文件工具。这是做审查/审计/自动化提交类插件最直接的抓手。
- 限制：摘要与快照只活在当前 host 进程的 Session 生命周期内；host 重启后旧轮次无卡也无 diff（这是**有意设计**，不是缺陷）。

---

#### 2. document / office：Office 转换与捆绑运行时

##### 2.1 是什么

| 包 | 角色 | ctx key |
|---|---|---|
| `document/office-to-pdf` | 授权 Office 字节 → 完整 PDF，带限流队列与缓存 | `ctx.officeToPdf` |
| `skill/skill-office` | 捆绑的 Word/PowerPoint/Excel 工作流与结构检查 | 注册 skill provider |
| `skill/tool-workspace-dependencies` | `load_workspace_dependencies` 工具：返回捆绑 Python/Node/pnpm 的绝对路径 | 注册到 `ctx.tools` |

##### 2.2 对外接口

- **`ctx.officeToPdf.convert()`**：入参为授权来源身份、version、可选字节大小、延迟有界读取、Office 扩展名、调度优先级；来源 version 变化即拒绝转换。返回 PDF 字节、缺失字体名、cache key、conversion generation。`OfficeToPdfError` 为失败类型；取消以原因 reject。
- **Remote 面**：`officeToPdf.render`（浏览器请求，需 Session 身份 + Office 路径 + 优先级，经 `workspaceFiles` 授权，PDF 字节走二进制 multipart）、`officeToPdf.generation`。包导出 `./remote`（`lib/typert.remote-client.js`）与 `./typert`（`lib/typert.host.js`）——**这是双平面包**（host 服务 + 生成的客户端描述符）。
- **`load_workspace_dependencies`**：配置 `source`（必填，绝对路径，含 `runtime.json` 与 `dependencies/`）、`root`（可选，Harness home 下的安装目录；设置则首次调用时拷贝，未设置则原地只读使用）。返回绝对路径与分布版本；**不改 `PATH`**、不改包管理器设置。
- **skill-office**：暴露 `office-docx`、`office-pptx`、`office-xlsx` 三个 skill；载荷为 `assets/office-*/SKILL.md` 与 `assets/scripts/check_office.py`。

##### 2.3 运行时是否随包分发 Python / 原生运行时？

**部分更正任务简报的前提**：根 `native/`、`python/`、`pytest.ini` 在**旧 tag 已存在**，两版 `pytest.ini` 无差异。真正的新增项是：

- 根 `Makefile`（新增）：仅 `build` / `web` / `desktop` / `dev-web` / `dev-desktop` 的 pnpm 快捷别名，**与运行时无关**。
- `python/sdk-runtime/`：Python 运行时载荷（`hatch_build.py`、新增 `_resources.py`、`runtime-bootstrap.mjs`、`pyproject.toml` 变更），是 SDK profile 的捆绑运行时。

Office 引擎的**实际分发路径**是：

- 外部 npm 依赖 `@deepseek-ai/libreoffice-kit@^0.1.0`（独立仓库 `github.com/deepseek-harness/libreoffice-kit`），由 kit 的 `optionalDependencies` 选择原生包，未声明原生包的目标平台回退 WASM。
- `prepare:primary-runtime` 脚本（`scripts/primary-runtime/lock.json` 为共享下载锁，覆盖 linux-x64/linux-arm64/mac-arm64/mac-x64/win-x64）在构建时组装 `primary-runtime/` + `office-skills/`，带哈希校验的归档缓存。
- 因此：**不是把 Python 解释器签进 TS 包**，而是「独立 kit + 构建期下载/组装载荷 + 工具把路径告知模型」。

##### 2.4 默认与 opt-in

- `office-to-pdf`：**默认启用**（web-app 层）。平台引擎选择不是运行时回退：声明了原生引擎却缺失 → 打包失败，不会静默用 WASM。
- `skill-office`：由 SDK profile 捆绑；`DSH_PRIMARY_RUNTIME` 覆盖资源位置，**空值即 opt-out**；无载体的源码启动默认 opt-in。
- `tool-workspace-dependencies`：需显式挂载并提供 `source`；配置校验要求 `source` 非空、`root` 非空（若给出），二者必须绝对路径。

##### 2.5 对下游的意义

- 第三方插件可经 `ctx.officeToPdf.convert()` 在 host 内直接复用「Office → PDF」能力，无需自带转换器；缓存按 SHA-256 内容身份共享，跨不同源路径也命中。
- `officeToPdf.render` 让浏览器端插件能按 Session 授权渲染 PDF（`api/remotes` 挂载生成的客户端描述符）。
- 若做 Office 类插件，应复用 `load_workspace_dependencies` 而非硬编码解释器路径；`runtime.json` 的 `platform`/`arch` 与进程不符会被拒绝。

---

#### 3. ssh：POSIX 远端执行 provider 家族

##### 3.1 是什么与职责划分

四个包共同把「文件 / 普通进程 / 终端 / 沙箱强制」搬到**一台 POSIX SSH 主机**上执行，Harness 本身留在本地：

| 包 | 职责 | 服务 |
|---|---|---|
| `ssh/ssh` | 连接、helper 身份、传输生命周期 | **`ctx.ssh`**（唯一新服务名） |
| `ssh/fs-ssh` | 远端文件身份、读取、受保护的原子变更 | `ctx.fs`（替代 provider） |
| `ssh/subprocess-ssh` | 可执行文件查找、进程、控制流、终端 | `ctx.subprocess`（替代 provider） |
| `ssh/sandbox-ssh` | 远端文件效果隔离与强制事实 | `ctx.sandbox`（替代 provider） |

关键区别：只有 `ssh` 引入**新服务名**；其余三个是**既有服务的远端实现**，因此对消费方是「换 provider」而不是「学新 API」。

依赖方向：`fs-ssh` / `sandbox-ssh` / `subprocess-ssh` 都以 `@deepseek-ai/dsh-ssh` 为 peerDependency；`ssh` 自身 peer 依赖 `dsh-fs` / `dsh-fs-local` / `dsh-sandbox` / `dsh-sandbox-local` / `dsh-subprocess` / `dsh-subprocess-local` / `dsh-session-projection` / `dsh-brand`。四者均为 `"access": "public"` 公开包（非 private）。

##### 3.2 是否替代被移除的 e2b / code-runtime？

**是，替代 e2b。** commit：`c49db8bc8c refactor(e2b): retire remote execution providers`，同区间删除 `packages/e2b/{e2b,fs-e2b,subprocess-e2b}` 与 `.github/workflows/e2b-e2e.yml`。`ssh` 家族用 OpenSSH + 安装的版本化 POSIX helper 承担了原本 e2b 的「远端执行」角色，但形态不同：e2b 是托管沙箱服务，ssh 是自备 POSIX 主机。

`code-runtime*` 的移除与 ssh 无关，属 PTC 改名（见第 4 节）。

##### 3.3 默认与 opt-in

**默认不启用。** 证据：`packages/bundle/base/cordis.patch.yml` 与 `packages/bundle/web-app/cordis.patch.yml` 的新增清单中都没有这四个包；`git grep 'dsh-ssh\|dsh-fs-ssh\|dsh-sandbox-ssh\|dsh-subprocess-ssh' -- packages/bundle apps packages/preset` 只命中 `packages/preset/agent-preset/skills/.../references/packages.md` 的生成表格。

Opt-in 方式：在自定义 composition 里挂载 `@deepseek-ai/dsh-ssh` 加所需 provider。适用场景由包组 README 明确为「headless 或自定义 profile，且消费方尊重 provider 自有的路径」。

##### 3.4 对下游的意义

- 为「把 Harness 当控制面、把执行放到远端主机」提供了**不依赖第三方沙箱厂商**的路径。
- 迁移要求（包组 Dev Note 原文）：远端能力实现必须保留共享的异步终端与取消接口；**本地路径访问绝不能从远端路径字符串推断**。这对任何缓存路径、比较路径或做本地 stat 的插件是硬约束。
- 需注意 `api/terminal-controller` 的语义：用户终端以执行环境的系统用户权限运行，**独立于 Agent 的沙箱模式与审批策略**。

---

#### 4. ptc-runtime：执行 seam 的分层与改名

##### 4.1 是什么

| 包 | 角色 | 服务/位置 |
|---|---|---|
| `ptc-runtime/ptc-runtime` | 抽象 PTC 执行 seam | **`ctx.ptcRuntime`** |
| `ptc-runtime/ptc-runtime-node` | 沙箱化 Node 进程实现 | 实现 `ctx.ptcRuntime` |
| `experimental/ptc-runtime-python` | CPython 子进程实现 | 实现 `ctx.ptcRuntime` |
| `workflow/workflow-ptc` | 在共享沙箱化 Node PTC 运行时里跑 workflow 编排 | 注册到 `ctx.workflowEngine` |

依赖方向清晰：`ptc-runtime` 只 peer 依赖 `cordis` + `dsh-sandbox`（零 dependencies，是纯契约包）；`ptc-runtime-node` peer 依赖 `ptc-runtime` + `session` + `timeout` + `fs` + `subprocess` + `sandbox` + `sandbox-policy`；`workflow-ptc` peer 依赖 `ptc-runtime` + `workflow` + `subagent` + `agent` + `llm` + `session` + `tools` + `sandbox` + `sandbox-policy`。`experimental/ptc-runtime-python` 是独立实现，peer 依赖 `ptc-runtime` + `timeout` + `util-values`。

##### 4.2 被移除者由谁承担

- `code-runtime/code-runtime`、`code-runtime/code-runtime-worker-thread`、`experimental/code-runtime-python` → 由 `ptc-runtime/ptc-runtime`、`ptc-runtime/ptc-runtime-node`、`experimental/ptc-runtime-python` 一对一对位承接。commit：`7c9bb5914c refactor(ptc): align runtime packages and services with PTC naming`——**是改名与分层，不是能力消失**。
- `workflow/workflow-worker-thread` → 由 `workflow/workflow-ptc` 承接。commit：`35af8698c2 fix(workflow): execute orchestration in the sandboxed PTC runtime`。语义升级：旧包是「每脚本一个 worker thread，只是把同步工作挪出事件循环，**明确不是安全边界**」；新包改为「在**共享沙箱化** Node PTC 运行时中执行，受调用 Session 的文件策略约束」——从「隔离以免阻塞」升级为「沙箱 + 复用」。

##### 4.3 默认与 opt-in

- `ptc-runtime-node`：**默认启用**，位于 `packages/bundle/base/cordis.patch.yml`（`- id: ptc-runtime / name: '@deepseek-ai/dsh-ptc-runtime-node'`），并被 `apps/cli/package.json` 依赖。
- `workflow-ptc`：**在 base 层新增为启用行，但 web-app 用 `- id: workflow-ptc / disabled: true` 关掉它**——原因是 web-app 把这类行从「host 平面」搬到「preset 平面」，由 preset 自己拥有（同一段还关掉了 `tool-workflow`、`tool-ralph`、`tool-subagent*`、`compaction-basic`、`plan-mode` 等）。真正生效的挂载在 preset 里：`presets/standard.patch.yml` 以 **启用**状态挂 `workflow-ptc` + `tool-workflow`，而 `presets/ptc.patch.yml` 里同一对是 `disabled: true`。由于 base 的 `agent-preset-registry` 默认 preset 是 `standard`，**shipped Web 应用最终是启用状态**。
- web-app 层**移除**了 `dsh-code-runtime-worker-thread`（属 PTC 改名的配套清理），并以 `workflow-ptc` 的 by-id 禁用行取代了旧 `workflow-worker-thread` 的禁用行。
- `experimental/ptc-runtime-python`：experimental 组，需显式组合；`apps/cli/package.json` 已声明依赖（供 profile 选用），但不在 base/web-app 的 patch 清单内。

##### 4.4 对下游的意义

- 想换执行后端（Python 而非 Node）的下游，现在有**稳定契约** `ctx.ptcRuntime` 可依，不必依赖具体实现包。
- `workflow-ptc` 让 workflow 脚本获得与 PTC 一致的沙箱与文件策略，做「脚本化 fan-out」类插件的第三方可复用同一运行时，而不是自建 worker thread。
- 迁移要求：从 `code-runtime*` / `workflow-worker-thread` 迁移到 PTC 命名的包与服务名；配置项由 `docs/config-catalog.md#deepseek-aidsh-workflow-ptc` 提供。

---

#### 5. agent preset 重构：从目录到声明

##### 5.1 是什么（这是本次影响最大的扩展点变更）

旧 `@deepseek-ai/dsh-agent-presets` 已被**删除**（commit `d1e22a7e24 feat(preset): declare Agent compositions in profile YAML (#4569)`），拆成两个包：

| 新包 | 角色 | ctx key |
|---|---|---|
| `preset/agent-preset-registry` | 选择、修订保留、profile 编辑 | **`ctx.agentPresets`** |
| `preset/agent-preset` | 声明式 child plugins + 元数据 | —（注册定义） |
| `preset/persona` | 可组合 Agent persona（保留） | — |

##### 5.2 preset 的 schema、注册表与文件位置

**加载/解析方式彻底改变**：preset 不再是「目录扫描 + 专用 metadata/specifier API」，而是**普通 Cordis YAML 声明，作为 profile 配置的一部分**。

- **新 schema**（`@deepseek-ai/dsh-agent-preset` 的 `config`）：

| 字段 | 默认 | 含义 |
|---|---|---|
| `id` | 必填 | 稳定 preset 标识 |
| `plugins` | 必填 | child plugin 条目列表 |
| `name` | 未设 | 显示名 |
| `description` | 未设 | 显示描述 |
| `order` | 未设 | roster 排序 |

- **声明行自身的 `id` 用于寻址 Loader 编辑；`config.id` 才是被 Session 保存的 preset 身份。** child 条目的 `id` 可省略，由 Loader 分配。
- **文件位置**：`packages/bundle/web-app/presets/{standard,minimal,ptc,cordis}.patch.yml`——是 Loader `insert` patch，不是包内目录。旧位置 `packages/preset/agent-presets/presets/<id>/{preset.yml,agent.cordis.yml}` 已不存在。
- **注册表**：`agent-preset-registry` 的配置只有 `default`（必填，无请求时使用的 preset ID）。它**不扫描目录、不接受 preset 路径**。`selectedDefault` 与 `modeSelectionEnabled` 作为 volatile 字段保留用户默认与选择器可见性；隐藏选择器则用部署 `default`。
- **registry 不写声明**：`read` Remote 把一个声明的 child 列表渲染回 entry-list YAML（含 `!!js` 条件）供客户端展示，但**没有任何接口接受 YAML 回写**。
- **生命周期**：每个声明**急切**创建 registry 所有的 scope 与内存 Loader 树；更新或移除声明会「退休」旧修订，Agent/child/临时历史读保留引用，最后一个引用释放才销毁。**激活失败仍留在 roster 并拒绝新绑定，但不阻止应用启动。** 激活审计检查 import、缺失服务、全局泄漏服务；失败/泄漏会拒绝挂载。
- **Session 数据仍记录 preset 身份**；重启按当前配置解析该身份，缺失则拒绝。旧的可执行修订是进程本地的，不序列化。

##### 5.3 新增 Authoring 路径（对第三方最有价值）

> 「A new preset or an override of a shipped one is a bundle patch: an `insert` of a `@deepseek-ai/dsh-agent-preset` row, or a patch keyed by that row's id, installed into the profile with `plugin_manager`; Creator mode authors such bundles in conversation.」

- **opt-in / 新增方式**：写 bundle patch → 用 `plugin_manager` 装入 active profile（`packages/boot/plugin-manager`）。Web 编辑器与 `agent_preset` 工具只接受 child plugin YAML；保存写入 active profile 的 user patch，保留显示元数据与无关配置。
- **并发保护**：修订检查 + profile 锁防止覆盖并发保存；校验会拒绝「优先级更高的 override 反而使编辑失效」的情况。持久化结果与激活结果**分别**报告。
- **权限**：工具写入需要审批或 full access，因为配置在 Host 内执行。
- **包内附带的 Creator skills**（`packages/preset/agent-preset/skills/`，由 Creator 模式经 `skill-filesystem` 挂载）：`cordis-plugin-development`（含 `references/` 按需读 + 可复制 `templates/`）、`editing-cordis-compositions`、`cordis-composition-reference`（其 `references/packages.md` 由 `scripts/gen-plugin-packages.ts` 生成，并在 `doc-sync` 中做新鲜度门禁）。
  - **位置语义变化**：旧 tag 里 `cordis-plugin-development` 与 `editing-cordis-compositions` 位于 `packages/preset/agent-presets/presets/cordis/skills/`——即**归属于 `cordis` 这一个 preset**；新 tag 移到包级 `packages/preset/agent-preset/skills/`，**不再绑定某个 preset**，而是由 Creator 模式统一挂载，因此任何 preset 下的 Agent 都能读到。`cordis-composition-reference` 是**全新** skill。两个过程类 skill 要求 Agent 先读 inspection 结果，再读 `Config.listConfigs` 报告的 `packageDir` 下的包 README，最后才读构建后的 `lib/` 或 checkout 源码；每个 `SKILL.md` 渲染为 `skill` 工具结果时须保持在 8192 字符阈值以内（超过会被 standard preset 的 tool-result pruner 裁剪）。
- `experimental/agent-team-web-profile` 已被移除（commit `9f21d7842a fix(agent-team): enable tools and Web UI with one bundle`），合并为单一 `experimental/agent-team-profile` bundle。

##### 5.4 对「preset 是第三方插件主要扩展点」的影响

**扩展能力增强，但迁移代价与语义陷阱明确：**

- ✅ 好处：preset 就是普通 profile 配置，因此**持久化、分层、编辑、插件管理全部复用既有机制**，不再需要一套平行的 discovery/authoring API。第三方可以用「装一个 bundle」的方式新增或覆盖 preset。
- ✅ 一个进程可跑不同能力的 Agent，且各自共享所选修订；Host/Loader 仍共享，只有 preset 的 service provider/consumer 需要隔离 realm。
- ⚠️ **最重要陷阱**：note 原文——「a user override replaces the **entire child list** rather than merging future builtin changes」。第三方一旦覆盖内置 preset，**后续内置新增的 child 不会自动合并进来**，必须自行跟踪上游变更。
- ⚠️ preset **不提供安全沙箱**。
- ⚠️ `isolate` realm 语义仍须遵守：服务行必须放在带 `isolate` 的 group 内，否则发布到 root realm（进程全局）会与其它 preset 冲突，被 registry 在挂载时拒绝。三个包的 `agent-preset` group README 与本仓库 skill 文档一致。
- ⚠️ `packages.md` 中 `Config` 列只表示「该行接受 `config` 映射」，**不是**默认启用标志；查实际 schema 应经 `cordis_inspect_query` 过滤 name 后查 entry id。

---

#### 6. browser-use / computer-use：单名额提供方注册

##### 6.1 是什么与服务名

两组都是「**独占单名额注册中心** + 各自独立的 experimental provider」：

| 包 | 服务 | 语义 |
|---|---|---|
| `browser-use/browser-use` | **`ctx.browserUse`** | 部署同一时刻只能启用一个 browser-use provider |
| `computer-use/computer-use` | **`ctx.computerUse`** | 部署同一时刻只能启用一个 computer-use provider |

**关键设计：核心包本身不提供任何模型可见的工具或浏览器/桌面操作。** `browser-use/src/index.ts` 原文说明它「contains no browser object, operation interface, resource lifecycle, or provider selector」。provider 插件 inject 服务后调用 `ctx.browserUse.register(BrowserUseProviderName(name))` / `ctx.computerUse.register(ComputerUseProviderName(name))`，brand 从 `@deepseek-ai/dsh-browser-use/brand` 与 `@deepseek-ai/dsh-computer-use/brand` 导出。

##### 6.2 单 provider 名额约束

- **加载第二个 provider 会失败，并在错误里报出已注册的 provider 名字。**
- 实现：一个 private name 拥有该名额；依赖 Cordis effect 在插件卸载时移除贡献；**重复调用 disposer 不能移除后来的注册**（防误删）。
- provider 释放前必须：停止接受工具调用 → 关闭资源 → 等待自有工作结束 → 释放注册。`ctx.browserUse.providerName` 在释放前报告已注册名。
- 无 runtime invariant companion 发布：registry 只有一个权威字段，不存在会分叉的独立观察。
- computer-use 额外注意：若 native shutdown 失败，**注册名额会保持被占用**，需重启 host 才能挂载另一个 computer-use provider。
- 核心包「不协调并发 Session」——会话级资源归属由 provider 自理。

##### 6.3 rider 包清单与依赖方向

**browser-use riders（`packages/experimental/`）**：

| 包 | 上游依赖 | provider/tool 面 |
|---|---|---|
| `browser-use-runtime` | schemastery（+ peer `dsh-mcp-client`、`dsh-scope`、`dsh-agent`） | Session 所有的浏览器资源生命周期 + MCP 集成，**被其它 rider 依赖** |
| `browser-use-playwright-mcp` | **dependencies**: `browser-use-runtime`, `@playwright/mcp` | Playwright 浏览器工具 |
| `browser-use-chrome-devtools-mcp` | **dependencies**: `browser-use-runtime`, `chrome-devtools-mcp` | Chromium 检查与控制 |
| `browser-use-stagehand-native` | **dependencies**: `@browserstagehq/stagehand`, `browser-use-runtime`, `dsh-mcp-client`, `@puppeteer/browsers`, … | 工具前缀 **`stagehand_`**；需单独配置原生模型 |

依赖方向：三个具体 provider **dependencies** 依赖 `browser-use-runtime`，`runtime` 以 **peerDependencies** 依赖 `dsh-browser-use` 核心与 `dsh-mcp-client`。即 rider → runtime → core，core 不依赖任何 rider。

**computer-use riders（`packages/experimental/`）**：

| 包 | 上游依赖 | provider 名 / 配置 |
|---|---|---|
| `computer-use-cua-driver-mcp` | `dsh-mcp-client`, schemastery | 经**已安装的 Cua Driver MCP 可执行文件**；配置 `command` 默认 `cua-driver` |
| `computer-use-cua-driver-native` | `@trycua/cua-driver`（npm 原生 SDK）, `dsh-mcp-client`, zod | provider 名 **`cua-driver-native`**；无配置字段；工具前缀 **`cua_driver_native__`** |

##### 6.4 默认与 opt-in

**两组都默认不启用。** 证据：`git grep -l 'dsh-browser-use\|dsh-computer-use' -- packages/bundle apps` **无任何命中**；base 与 web-app 的新增清单里也没有它们。

opt-in 方式是显式 composition（包 README 的最小配置）：

```yaml
# browser-use：核心 + 任选一个 provider
- name: '@deepseek-ai/dsh-browser-use'
- name: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'

# computer-use：核心 + 任选一个 provider
- name: '@deepseek-ai/dsh-computer-use'
- name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'
```

两项系统提示配置注意（来自 playwright / chrome-devtools provider README）：为整个进程配置 `toolOrder` 时，**应把浏览器工具留在 `<unlisted-tools>` 下**；显式列举浏览器工具名可能使没有浏览器连接的 Session 的 prompt 组装失败。

##### 6.5 macOS 权限与 cursor overlay 的 deferred 状态（重点核实）

**结论：在 `dsh-v0.1.7-rc.1` 中，macOS 权限与 cursor overlay 都不是 DSH 的未实现项。** 它们是上游 Cua Driver SDK 的**已交付能力**，DSH 侧只做透传并文档化限制。证据（`packages/experimental/computer-use-cua-driver-native/README.md` 的「Known Limitations and Deferred Work」节）：

- **Host permissions and graphics session** — 「npm installation does not grant desktop access or create a graphical session.」DSH provider 原文：「Grant desktop permissions to the application that launches DSH; this provider **neither installs a permission-owning app nor changes OS grants**.」→ 权限**不在 DSH 侧管理**，是用户/宿主的责任。
- **Native cursor overlay** — 「a headless macOS Node host **can** receive `facility_unavailable` for overlay operations while screenshots and background input remain usable.」→ 这是**上游在特定宿主形态（headless macOS Node）下的运行时限制**，不是「overlay 未实现」。系统提示中也有对应一行："On macOS, cursor-overlay operations may return `facility_unavailable` even when screenshots and input work."
- 权限**查询**能力确实可用：MCP 变体的验证命令明确「discovers tools, calls `check_permissions` with `prompt: false`, and verifies teardown」；native 变体的 opt-in e2e（`DSH_COMPUTER_USE_NATIVE_E2E=1`）同样「reads permission status with `prompt: false`」且「requests no OS permissions」。→ **读权限状态已实现；申请/变更 OS 授权被有意排除在 provider 之外。**
- 选择建议（README 原文）：当希望**独立 Cua Driver 应用拥有权限与执行**时，用 MCP 变体；native 变体共享 host 进程，**原生崩溃可能终止该进程**。
- 其余已文档化限制：共享桌面不预留窗口/不保证工作流原子性；取消不回滚已送达输入；实验性发布不承诺 DSH 稳定性。

##### 6.6 对下游的意义

- 0.1.5-rc.2 没有这两个服务，第三方无法「提供浏览器/桌面能力」；0.1.7-rc.1 给了**稳定的单名额注册契约**，第三方可以写自己的 provider（或按 brand 校验），核心不必改。
- 但独占名额意味着**同一进程内无法并存两个浏览器后端**；产品若要「本地 Chromium + 云浏览器」双后端，必须做进程级或 profile 级切分，而非插件级共存。
- 明确约束（experimental 组 README 原文）：「**Released products outside this group must not depend on experimental packages**」——browser-use/computer-use 的 provider 全部是 experimental，只有核心注册包是非 experimental。

---

#### 7. experimental 其他与基础设施

##### 7.1 auto-review

- 包：`experimental/auto-review` → `@deepseek-ai/dsh-experimental-auto-review`，描述「Per-tool LLM authorization review for the DeepSeek Harness **Auto permission preset**」。
- 对外接口：无新服务名；它为 **Auto 权限预设**提供「每次原生或 PTC 内层工具调用前，同模型复核」的 Web 层。peer 依赖 `dsh-permission-presets`、`dsh-agent-instructions`、`dsh-llm`、`dsh-tools` 等。
- opt-in：包导出 `./cordis.patch.yml`，内容为 `- insert: [{ id: auto-review, name: '@deepseek-ai/dsh-experimental-auto-review' }]`——即**通过插件管理器安装该 patch** 启用。**不在任何 bundle 中**（`git grep` 仅命中 `apps/web/package.json` 与插件管理器的 locale/测试）。
- 对下游意义：把「工具调用审批」从静态策略推进到**模型自审**，是审核类插件可参考或可替换的参考实现。注意它是 experimental，不承诺稳定性。

##### 7.2 语音输入五件套

| 包 | 角色 | 服务/入口 |
|---|---|---|
| `experimental/speech-to-text` | 命名语音识别 provider 的 Service Definition | **`ctx.speechToText`** |
| `experimental/speech-to-text-sensevoice` | 本地 SenseVoice ONNX，托管 sherpa-onnx 进程 | provider |
| `experimental/api-speech-to-text` | 认证的瞬时转写 Remote | **`ctx.speechController`** |
| `experimental/client-ui-voice-input` | 麦克风采集与受保护的草稿插入 | **client plane** |
| `experimental/voice-input-bundle` | **默认禁用**的可选语音输入 composition | bundle |

- **契约**：`ctx.speechToText` 需 `defaultProvider`（必填，精确匹配已注册 id；bundle 提供 `sensevoice-local`）与 `language`（省略时提供语言提示）。provider 通过 `downloadSources` 广告准备来源；`prepare(id, options)` 可转发单任务的 `downloadSource`，provider 校验选择并**拒绝准备过程中切换来源**；来源选择**不持久化**为识别偏好。缺失或重复 provider 显式失败。
- **opt-in（唯一路径）**：Web 侧栏 Plugins 页启用 **Voice Input**（蓝色波形图标）。若模型需要准备，弹窗给「Go to setup / Later」；选 Go to setup 打开 bundle 详情 → Download and prepare。就绪后模型选择器与 Send 之间出现麦克风。bundle 详情经 Settings 服务保存识别器与语言。**禁用 bundle 会取消活动工作；缓存资产留在磁盘。**
- 实现要点：静态 `cordis.patch.yml` 插入四行 voice 配置，选 `sensevoice-local` 为默认识别器，并用 `dshHomePath` 提供 provider 缓存目录。**可选 bundle 安装使包对管理可见，但不默认选中。**「stable API Remotes do not import experimental code」——浏览器贡献自带生成的 Remote 挂载。
- **是否需要付费账号**：不需要。默认路径是**本地 SenseVoice ONNX** 推理；`api-speech-to-text` 的「认证」是 Remote 传输层认证（Session/连接身份），不是付费账户门槛。

##### 7.3 mcp/mcp-resources

- 包：`mcp/mcp-resources` → `@deepseek-ai/dsh-mcp-resources`。三个**共享模型工具**（`src/tools.ts`）：
  - `list_mcp_resources`
  - `list_mcp_resource_templates`
  - `read_mcp_resource`
  另有 `mcp-resource-servers`（`src/index.ts:61`）。
- 语义：让模型按需发现并读取已配置 MCP 服务器的文档。**每个工具都要求显式服务器名**，只在被调用时读内容。资源文本进入对话历史；二进制载荷对程序化调用方可见，对模型只显示为描述。
- 默认与 opt-in：**默认启用**——「Shipped profiles already mount this package once」，位于 base bundle；使用者只需配置 `mcp-client` 条目。三工具在调用方 scope 内配置了服务器时自动可用。
- 对下游意义：MCP 集成从「只有工具」扩展到「工具 + 资源」，做 MCP 类插件时资源面已由框架统一提供，无需自行注册工具。

##### 7.4 api/job-controller、api/terminal-controller、api/account-controller

三者都是**双平面包**（Host 服务 + 生成的 Client Remote 面），且**都在 web-app 层默认启用**。

**`api/job-controller`**（`@deepseek-ai/dsh-api-job-controller`）
- Host：`ctx.jobController`；Client：生成的 `ctx.remote.job` 命名空间。
- `job.list({sessionId})` → 该 Session 可见 job 集合的整集帧（打开时一次 + 每次合并的生命周期提交后；**输出追加不刷新 roster**）。
- `job.follow({sessionId?, jobId, from?})` → 一个 `opened` 锚点 + 合并的 `output` 帧 + 一个终态 `status`，随后正常关闭；流中移除则以被移除 job 的终态投影关闭。
- `job.kill({sessionId, jobId})` → 以原因 `cancelled by the user` 取消；返回 `{outcome:'requested'|'already-finished'}`，不可见 id 以 `job/not-found` 拒绝。
- **关键语义：两条流都不触碰模型的消费游标与完成通知**——人类 kill 不是模型自己的 kill，所属 agent 的完成通知仍应到达，等待中的 shell 工具会以 `[stopped: cancelled by the user]` 读到原因。
- Client 侧安装 `ctx.jobs`（`IJobs`，`ClientJobsModel`）：`kill`、`watchRows(sessionId)`（每会话单流、最后释放才丢行、重连首帧即全量真值）、`observe(sessionId, jobId)`（每 job 单 Gateway 流、有界渲染尾 + `gapBefore` 标记驱逐/续传间隙）。
- Host 侧需 live Agent registry + job registry（shipped composition 用 `dsh-jobs-local`），否则加载失败。

**`api/terminal-controller`**（`@deepseek-ai/dsh-api-terminal-controller`）
- `remote.terminal` 暴露 `environment`、`shells`、`list`、`create`、`retain`、`follow`、`write`、`resize`、`rename`、`close`，每个操作按 Session 身份限定。
- shell 发现：先列执行环境声明的默认 shell；provider 未声明时才回退 `/bin/sh`（POSIX）或 `cmd.exe`（Windows）。可选 `shell` profile 用 `path`/`name`/`args` 覆盖。`shellCandidates` 经执行 provider 探测，只省略**确认查找失败**者；创建时接受发现的 `shellPath` 并再次校验，解析或传输失败即报告而**不启动另一个 shell**。环境查询返回工作目录与限制且**不解析 shell**，因此默认 shell 不可用也不妨碍重连既有进程。
- 沙箱语义：沙箱策略**只为没有 cwd 的 Session 提供回退工作目录**；**用户终端以执行环境的系统用户权限运行，独立于 Agent 的沙箱模式与审批策略**；DSH 不提权；OS/容器限制仍然生效；subprocess provider 保留凭据环境擦洗。
- 依赖 `@deepseek-ai/dsh-lazy-require`、`@xterm/headless`、`@xterm/addon-serialize`、`dsh-deque`。

**`api/account-controller`**（`@deepseek-ai/dsh-api-account-controller`）
- 描述「Expose **safe** account operations over authenticated Remote」。peer 依赖 `dsh-deepseek-account` + `dsh-typert-protocol`。
- 安全性设计：凭据是 **Host-only**；API controller 只导出 state 与命令，**不含 `resolveToken`**（`packages/credentials/deepseek-account/README.md` 原文："Credentials are Host-only; the API controller exports state and commands without resolveToken."）。
- 对下游意义：这是「如何把敏感能力暴露给浏览器而不泄露凭据」的**可复用范式**——服务分层（Host 持有凭据 / controller 只暴露状态与命令）。

##### 7.5 credentials/deepseek-account 与 deepseek-account-platform

| 包 | 角色 | 是否需付费账号/凭据 |
|---|---|---|
| `credentials/deepseek-account` | 读账号状态、解析官方 API 凭据 | 需要：`resolveToken` 解析官方 API 凭据；`getPlatformSession` 在登录态外返回 null |
| `credentials/deepseek-account-platform` | 经**浏览器 PKCE** 授权 DeepSeek 账号 | 需要：登录 DeepSeek（Platform）账号并保有余额 |

关键细节：

- `credentials/deepseek-account`：`getPlatformSession` 返回 Host-only 的 origin/token 快照供原生 Platform 嵌入使用，**或**在登出时为 `null`；它**不出现在 account-controller RPC 与 Client state 中**。消费者必须在账号变化时销毁持有快照的文档。`AccountProfile.avatarUrl` 为可选头像 URL。
- `desktopClientHeaders` 把原生 `darwin`/`win32` 映射到共享的 Desktop 账号与更新策略请求头；`null` 不加头。`desktopPlatform` 默认 `null`，此时每个 profile 在 Host 的授权/资料/余额/登出请求上都发 `x-client-platform: web`；Desktop profile 传 `darwin`/`win32` 则替换为 `desktop-mac`/`desktop-win`。**该头由 provider 拥有，部署配置不可覆盖。** 嵌入的 Platform 文档与 API 请求在配置 origin 处收到同样的平台头。
- `credentials/deepseek-account-platform`：经**系统浏览器**登录，凭据保存在既有本地凭据存储；**本地取消可阻止迟到的回调与交换响应把用户登录**。新尝试把调用方 UI 语言映射为 Platform `en_US` 或 `zh_CN`，活动中的尝试保留初始语言。`getPlatformSession` 仅当 issuer 匹配 `platformOrigin` 时才导出存储的 grant。
- 默认：`deepseek-account-platform` **默认启用**（在 base bundle 新增清单中：`@deepseek-ai/dsh-deepseek-account-platform`）；`api/account-controller` 默认启用（web-app 层）。
- 对下游意义：模型路由的凭据获取从「用户自己配 API key」扩展到「登录账号后由框架解析」，**第三方插件不应自行绕过**——用 `credentials/deepseek-account` 的服务，且不要期望能从 client 侧拿到 token。

##### 7.6 host/product-telemetry-otel

- 包：`host/product-telemetry-otel` → `@deepseek-ai/dsh-host-product-telemetry-otel`，描述「Explicit product usage events exported through OpenTelemetry HTTP logs」。
- 语义（README 原文）：「Mounting the plugin **collects nothing automatically**; applications **explicitly submit each event**.」事件含 name、string summary、发生时间、标量或一层对象属性。投递是 best-effort，**不确认仓库摄取**。
- 依赖：`@opentelemetry/api`、`api-logs`、`core`、`otlp-exporter-base`、`otlp-transformer`、`resources`、`sdk-logs`。
- 默认与 opt-in：**不在任何 bundle 中**（`git grep` 只命中 `packages/host/README.md` 与包自身）→ **面向集成方的显式 opt-in**，由宿主应用挂载并主动提交事件。
- 对下游意义：给了发行版一条**合规、显式、不隐式采集**的遥测通道；对插件作者意味着「遥测不是插件职责」，插件不应自建上报。

##### 7.7 util/lazy-require

- 包：`util/lazy-require` → `@deepseek-ai/dsh-lazy-require`，描述「Caller-relative, success-cached lazy loading for CommonJS-compatible Host dependencies」。**零 dependencies**，peer 仅 `cordis`。
- 完整 API（`src/index.ts` 全文只有一个导出）：

```ts
export function createLazyRequire<T>(specifier: string, parentURL: string | URL): () => T
```

  用 `createRequire(parentURL)` 建立**调用方相对**的 `require`；返回零参 loader，**首次使用时**解析依赖；**成功结果被缓存，失败不缓存**，因此修正安装后可重试。`parentURL` 传调用方的 `import.meta.url`，由它拥有包解析。
- **解决的问题**：把「可能不存在 / 仅特定平台可用 / 重型原生」的 CJS 依赖移出模块加载路径，使插件在缺少可选依赖时仍能 import 而不炸，并让失败可重试。
- **消费方**（`git grep -l 'dsh-lazy-require'`）：`api/terminal-controller`（terminal.ts）、`attachment/attachment-local`（sharp.ts）、`sandbox/sandbox-windows-acl`（ffi.ts）、`subprocess/subprocess-local`（index.ts、linux-execve.ts、windows-inspector.ts）、`subprocess/win32-process`（koffi.ts）、`terminal/terminal-bash`（session.ts）。
- 对下游意义：第三方插件若要依赖可选原生模块（sharp / koffi / FFI / 平台专用二进制），应直接复用此工具，而不是自己写 `createRequire` 缓存或把依赖做成硬依赖。

##### 7.8 test-support/remote-mock

- 包：`test-support/remote-mock` → `@deepseek-ai/dsh-remote-mock`，描述「Endpoint-named mock for Typert Remote traffic: unary answers and stream scripts per `<namespace>/<method>`, live stream control, a log, and the Connection carrier face whole-client specs install」。
- **非 private（`"access": "public"`，可发布）**，但 README 明确「consumed from `devDependencies` only」。
- 用法：测试用原生 Vitest mock 方法经 `mock.remote.<namespace>.<method>` 配置 Host 响应；同一组函数同时服务直接调用与**真实 Connection 流量**；可复用表提供默认响应，显式声明的 stream 支持测试驱动帧与取消。**缺失响应会让调用失败，并在 teardown 时由 `assertNoUnmatched()` 再次报告。**
- 端点名是 Gateway 的 wire 名（如 `session/page`、`settings/describe`）；`args` 是调用方位置参数列表且**去掉尾部 `AbortSignal`**；返回注册值原样应答。唯一声明是端点属 `unary` 还是 `stream`。`mock.rpc` 绑定到 Connection 实例后供 whole-client spec 使用；单元 spec 可直接调 `mock.remote`、`dispatch`、`open`。
- 运行环境：**不需要业务 Host**，在 Node 或浏览器页均可运行，**不 import DOM、React 或 Node 模块**。
- 与 ssh 的关系：**不配对 ssh**。它面向 Typert Remote（`dsh-typert-protocol`）流量，服务对象是 api/*-controller 与 client/* 的测试；ssh 家族的 e2e 不依赖它。
- 对下游意义：第三方写**客户端 UI 插件或 Remote 消费方**时，可在没有 Host 的情况下启动真实浏览器客户端并脚本化 Host 侧响应——这是 0.1.5-rc.2 没有的测试基建。

---

#### 能力面总表

「默认启用」依据：`packages/bundle/base/cordis.patch.yml` 与 `packages/bundle/web-app/cordis.patch.yml` 的实际 Loader 行 + 包组 README 的原文声明。plane 判定依据：`package.json` 的 `exports`/`dsh` 字段、是否 import 客户端模块、以及 README 对 Host/Client 的明确表述。

| 能力 | 包 | plane | 默认启用 | opt-in 方式 | 需付费账号/凭据 | 对第三方插件的意义 |
|---|---|---|---|---|---|---|
| 文件交付声明 | `deliverables/tool-present` | host | 是（web-app: standard/ptc/cordis；minimal 否） | 随 preset 挂载 | 否 | 仅路径迁移；`present` 契约与包名不变 |
| 工作区变更卡 | `deliverables/workspace-changes` | host | 是（web-app 层） | 随 web-app 挂载 | 否 | **新只读观察点** `ctx.workspaceChanges` + `workspace/changes` 事件 |
| Office→PDF | `document/office-to-pdf` | host + remote(typert) | 是（web-app 层） | 随 web-app 挂载 | 否（引擎本地） | 复用 `ctx.officeToPdf.convert()`；浏览器走 `officeToPdf.render` |
| Office skills | `skill/skill-office` | host | SDK profile 捆绑 | `DSH_PRIMARY_RUNTIME`；空值 opt-out | 否 | 三个 skill：`office-docx/pptx/xlsx`；提供指令与脚本，解释器由部署提供 |
| 捆绑运行时路径 | `skill/tool-workspace-dependencies` | host | sdk profile 默认；源码启动 opt-in | 挂载并给 `source` | 否 | 工具 `load_workspace_dependencies`；勿硬编码解释器路径 |
| SSH 远端执行 | `ssh/ssh` | host | **否** | 自定义 composition | 否（需自备 SSH 主机与凭据） | 新服务 `ctx.ssh`；替代 e2b 的远端角色 |
| 远端文件系统 | `ssh/fs-ssh` | host | **否** | 自定义 composition | 否 | 替换 `ctx.fs` provider；勿从远端路径推断本地路径 |
| 远端进程/终端 | `ssh/subprocess-ssh` | host | **否** | 自定义 composition | 否 | 替换 `ctx.subprocess` provider |
| 远端沙箱 | `ssh/sandbox-ssh` | host | **否** | 自定义 composition | 否 | 替换 `ctx.sandbox` provider |
| PTC 执行 seam | `ptc-runtime/ptc-runtime` | host | 契约包（随实现） | peer 依赖 | 否 | **稳定契约** `ctx.ptcRuntime`，可换后端 |
| PTC Node 后端 | `ptc-runtime/ptc-runtime-node` | host | 是（base 层） | 随 base 挂载 | 否 | 承接被删 `code-runtime*` |
| PTC Python 后端 | `experimental/ptc-runtime-python` | host | **否** | 显式组合 | 否 | CPython 子进程实现同一 seam |
| 工作流编排 | `workflow/workflow-ptc` | host | 是（经 `standard` preset 挂载；web-app 关掉 base 行交由 preset 平面；`ptc` preset 内为 disabled） | 随 `standard` preset；其他 preset 显式挂 | 否 | 取代 `workflow-worker-thread`；沙箱 + 复用 |
| Agent preset 选择/修订 | `preset/agent-preset-registry` | host | 是（web-app 层） | 随 web-app 挂载 | 否 | **`ctx.agentPresets`**；`default` 必填；不扫描目录 |
| Agent preset 声明 | `preset/agent-preset` | host | 是（随各 preset patch） | 插一个 `insert` 行或按 id patch | 否 | **主扩展点**：普通 Cordis YAML；覆盖会整表替换 children |
| Agent persona | `preset/persona` | host | 是（preset 内） | 随 preset 挂载 | 否 | 可组合 persona（`{{model}}`/`{{cwd}}`） |
| 浏览器能力注册 | `browser-use/browser-use` | host | **否** | 显式组合核心 + 一个 provider | 否 | **`ctx.browserUse`** 单名额；核心不含任何工具 |
| 浏览器 provider（Playwright） | `experimental/browser-use-playwright-mcp` | host | **否** | 显式组合 | 否 | experimental，不承诺稳定 |
| 浏览器 provider（Chrome DevTools） | `experimental/browser-use-chrome-devtools-mcp` | host | **否** | 显式组合 | 否 | 同上 |
| 浏览器 provider（Stagehand） | `experimental/browser-use-stagehand-native` | host | **否** | 显式组合 | 否（原生模型另配） | 工具前缀 `stagehand_` |
| 浏览器资源运行时 | `experimental/browser-use-runtime` | host | **否** | 被 rider 依赖 | 否 | provider 作者应复用 |
| 桌面能力注册 | `computer-use/computer-use` | host | **否** | 显式组合核心 + 一个 provider | 否 | **`ctx.computerUse`** 单名额；核心不含任何操作 |
| 桌面 provider（Cua MCP） | `experimental/computer-use-cua-driver-mcp` | host | **否** | 显式组合；配 `command`（默认 `cua-driver`） | 否（需已安装 Cua Driver） | 由独立 Cua Driver 应用拥有权限与执行 |
| 桌面 provider（Cua 原生） | `experimental/computer-use-cua-driver-native` | host | **否** | 显式组合；provider 名 `cua-driver-native` | 否（需宿主桌面授权） | 共享 host 进程；崩溃可能终止进程；工具前缀 `cua_driver_native__` |
| 工具调用自审 | `experimental/auto-review` | host | **否** | 安装其 `./cordis.patch.yml` | 否 | Auto 权限预设的同模型复核参考实现 |
| 语音识别 seam | `experimental/speech-to-text` | host | **否**（随 bundle） | 经 voice-input-bundle | 否 | **`ctx.speechToText`**；`defaultProvider` 必填 |
| 本地语音识别 | `experimental/speech-to-text-sensevoice` | host | **否**（随 bundle） | 经 voice-input-bundle | 否 | 本地 ONNX，托管 sherpa-onnx 进程 |
| 转写 Remote | `experimental/api-speech-to-text` | host + remote | **否**（随 bundle） | 经 voice-input-bundle | 否（传输层认证） | **`ctx.speechController`** |
| 语音输入 UI | `experimental/client-ui-voice-input` | **client** | **否**（随 bundle） | 经 voice-input-bundle | 否 | 麦克风采集 + 草稿插入 |
| 语音输入 bundle | `experimental/voice-input-bundle` | bundle | **否**（显式 default-disabled） | Web Plugins 页启用 Voice Input | 否 | 唯一推荐 opt-in 入口；禁用即取消活动工作 |
| MCP 资源 | `mcp/mcp-resources` | host | 是（base 层） | 随 base；仅配 mcp-client 条目 | 否 | 三工具 `list_mcp_resources`/`list_mcp_resource_templates`/`read_mcp_resource` |
| Job 控制 | `api/job-controller` | host + **client** | 是（web-app 层） | 随 web-app 挂载 | 否 | `ctx.jobController` + `ctx.remote.job` + `ctx.jobs`；不触碰模型游标 |
| 用户终端 | `api/terminal-controller` | host + **client** | 是（web-app 层） | 随 web-app 挂载 | 否 | `remote.terminal` 十个操作；**独立于 Agent 沙箱与审批** |
| 账号控制 | `api/account-controller` | host + **client** | 是（web-app 层） | 随 web-app 挂载 | 是（承载账号操作） | 只暴露 state/命令，**不含 `resolveToken`** |
| 账号状态/凭据 | `credentials/deepseek-account` | host | 是（随 platform provider） | 随 base 挂载 | **是**（官方 API 凭据） | Host-only 凭据；client 拿不到 token |
| 账号登录（PKCE） | `credentials/deepseek-account-platform` | host | 是（base 层） | 随 base 挂载 | **是**（DeepSeek Platform 账号） | 系统浏览器 PKCE；`desktopPlatform` 头由 provider 独占 |
| 产品遥测 | `host/product-telemetry-otel` | host | **否** | 集成方显式挂载并主动提交事件 | 否 | 挂载不自动采集；插件不应自建上报 |
| 懒加载 CJS 依赖 | `util/lazy-require` | host（工具库） | 随消费方 | 直接依赖 | 否 | `createLazyRequire<T>(specifier, parentURL)`；成功缓存/失败不缓存 |
| Remote 测试替身 | `test-support/remote-mock` | 测试（Node/浏览器） | devDependencies | 加入 devDependencies | 否 | 无 Host 启动真实客户端；`assertNoUnmatched()` |
| UI/设置包（8 个） | `client/ui-plugin-manager`、`ui-settings-{account,agent-loop,shell,subagent,web-search}`、`ui-sidebar-{browser,terminal}` | **client** | 是（web-app 层） | 随 web-app 挂载 | 否 | 新增可挂载的设置页与侧栏席位 |
| 会话格式迁移 | `session/session-format-v3-to-v4` | host | 迁移工具 | —— | 否 | V3→V4 流式 tool-role 迁移（细节见会话格式线） |

---

#### 待确认项

1. **`office-to-pdf` 的 `./remote` / `./typert` 消费方边界**：包 README 说 `api/remotes` 挂载生成的 Client 描述符，但未逐条确认哪些 client 包直接 import `./remote`。已确认 `packages/client/ui-sidebar-documentpreview` 存在，但其与 office-to-pdf 的 import 关系未逐行核对。
2. **`workspace-changes` 在 headless / acp / sdk profile 中的可见性**：已确认 base 与 web-app 两个 patch 的清单；`packages/bundle/{headless,acp-app,sdk-app,sdk-minimal}` 是否间接引入未逐一展开。
3. **`agent-preset` 的 `agent_preset` 工具具体归属**：note（`2026-09-18-declarative-agent-presets.md`）提到「The Web editor and `agent_preset` tool accept only child plugin YAML」，但在 `dsh-v0.1.7-rc.1` 中 `git grep 'agent_preset'` 只命中 `session-query-sqlite` 的 schema/index（疑似同名字段），**未定位到名为 `agent_preset` 的 Tool 注册**。该工具可能属于 Creator/实验路径或 note 描述的是更晚期实现 → 需在后续版本或 Creator 相关包中复核。
4. **browser-use / computer-use 的 profile 级启用入口**：已确认不在 base/web-app bundle；但 Desktop（`apps/desktop`）与 Creator 模式是否有额外的启用入口未完整展开。
5. **`product-telemetry-otel` 的实际宿主**：`git grep` 只命中 `packages/host/README.md` 与包自身，未发现任何 app 挂载它；推测面向外部发行版集成方，但无发行版内证据 → 需与发行/桌面线交叉确认。
6. **`test-support/remote-mock` 与 ssh 的关系**：已确认它面向 Typert Remote 而非 ssh；但 `ssh/*` 的 e2e 是否使用它未逐一核对。
7. **`util/lazy-require` 是否允许第三方插件跨包使用**：它是 public 包且零依赖，但「第三方插件从自身 `node_modules` 解析本包」的解析行为（`parentURL` 语义）在插件以外部包形式安装时的表现未实测。
8. **`experimental/*` 的「发布但不得被非 experimental 产品依赖」约束**如何被机械保证：experimental 组 README 声明了该规则，但未找到对应的 lint/CI 门禁脚本（可能存在于 `scripts/` 的依赖审计中）→ 待确认。
9. **macOS overlay 的 `facility_unavailable` 是否在 0.1.7-rc.1 之后被上游修复**：当前结论基于 `@trycua/cua-driver`（上游 `cua-driver-rs-v0.28.0` 文档）与包 README 的 pins；上游版本演进需跟踪。

## A.6 Agent 循环、Subagent、默认值翻转、桌面端与平台

<!-- line: agent-defaults -->

### 第 6 线：Agent 循环、Subagent、模型／设置默认值翻转、桌面端与平台

- 对比区间：`dsh-v0.1.5-rc.2`（旧）→ `dsh-v0.1.7-rc.1`（新），3304 commits
- 仓库：`/Users/dmh2002/DshProject/deepseek-harness`（全程只读：仅 `git log/show/diff/ls-tree/grep/rev-list`）
- 读取方式：`git show <tag>:<path>`；工作树未被改动

#### 结论速览

1. **设置模型被整体替换**。旧版是「插件调用 `ctx.settings.installSection(ns, schema, entry, hooks)` 注册具名命名空间 + `$DSH_HOME/settings.yaml` 文档」；新版改为「Config 字段加 `.volatile()`，表单由 profile 条目 id 寻址，写入经 `config-editor` 落到该 profile 的 `cordis.patch.yml`」。`settings.yaml` 只在首次启动被**一次性导入**并改名为 `settings.yaml.imported`。这是本区间对下游插件最大的破坏性变更。证据：`packages/settings/settings/README.md`（新）。
2. **Subagent 委派深度默认从 3 降到 1**。`tool-subagent` 的 `maxDepth` 不再有默认值，省略时读取 host `subagent` 设置的 `maxDepth`，后者默认 `1`。**这是本区间最容易造成"嵌套委派突然失败"的翻转**——我本人作为 depth-1 子代理尝试派生 depth-2 子代理时被直接拒绝（`Error: subagent depth 2 exceeds maxDepth 1`），现场复现。
3. **会话日志上传默认从关到开**。`session-log-deepseek.Config.enabled` 默认由 `false` 变为 `true`：搭默认配置的 DeepSeek 请求会把**完整未确认的 canonical 日志后缀**（含消息正文、工具入参与结果、工作区路径、反馈）发往解析出的 DeepSeek 端点或网关。
4. **新增并发容量上限**：`maxActiveSubagents` 默认 `8`（延续性 subagent 的进程内槽位池 `ActivationPool`）。
5. **新增 4 个 client 设置页包**：`ui-settings-agent-loop` / `ui-settings-subagent` / `ui-settings-shell` / `ui-settings-web-search`（另有 `ui-settings-account`），host 侧不再是旧式的 `settings.yaml` 段落，而是各自插件的条目 id。
6. **桌面端不再是"薄壳"**。旧版是「Electron 包一层 dsh Web UI + 自造无端口 framed pipe 传输」；新版改为「加载打包好的 Web 入口 + 共享 profile runner + 认证 HTTP/WebSocket」，`apps/desktop` 自己新增约 5.7k 行原生逻辑（更新协调、强制更新、欢迎流、runtime tree、崩溃报告、平台视图）。
7. **CLI 新增 `dsh <profile>` 简写与 `--dump-config-schema`**；`patchReload` 配置项被 HMR 插件是否存在取代。
8. **MCP 新增 `mcp-resources` 包**，默认随 base/sdk-minimal 挂载；协议升到 2026-07-28 优先。

---

#### 1. Agent loop（`packages/core/agent-loop`、`packages/core/agent`）

##### 事实

- **设置命名空间机制变更**：旧版 `packages/core/agent-loop/src/index.ts` 导出 `AGENT_LOOP_SETTINGS_NAMESPACE = 'agent-loop'`、`AGENT_LOOP_SETTINGS_SCHEMA`，并在构造器里 `settings.installSection(...)`。新版全部删除，改为 `static Config` 上的 `volatile()` 标记：
  `maxParallelToolCalls: z.number().step(1).min(1).default(DEFAULT_MAX_PARALLEL_TOOL_CALLS).volatile()`（`packages/core/agent-loop/src/index.ts:335`）。
- **默认值未变**：`DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10`（`packages/core/agent-loop/src/constants.ts`），新旧一致。
- **新增 client 包 `ui-settings-agent-loop`**：暴露的唯一配置项就是 `maxParallelToolCalls`（"Parallel tool calls"），绑定 host 侧条目 id `agent-loop`（`packages/client/ui-settings-agent-loop/src/client/index.ts:45` `ctx.configForms.get(AGENT_LOOP_NS)`），默认 `10`，越界/非整数阻止保存。
- **`agent` 包的创建契约异步化**：`AgentRegistry.announce(agent)` → `announce(agent, source: SessionStartSource, signal?)`，返回 `Promise<void>`；`register()` 的 disposer 变为可 await。`agent/created` 载荷变为 `{ agent, source, signal? }`，`source ∈ 'startup' | 'resume' | 'clear' | 'compact'`（`packages/core/agent/src/runtime-types.ts:125,261`）。
- **`agent/session-start` 事件被移除**（新 tag 源码中已无引用，仅存于 `.agents/notes/archived/**`）。commit `9b7a8ccc9f feat(agent): await initialization through agent/created`。
- **新增归档准入**：`packages/core/agent/src/archive-admission.ts`（新文件）安装 `workspace/session-activity` 的 `turn` family 与 `workspace/session-stop`，归档会话时按用户停止语义 `agent.cancel({ kind: 'user' })`（不带 `keepInbox`，排队输入被丢弃）。
- `packages/core/agent-loop/src/index.ts` 的 `Config.agents[]` 字段集不变（`id/provider/model/reasoningEffort/maxTokens/cwd/sessionId/resumeSessionId`）。

##### 证据 / commit

- `git show dsh-v0.1.7-rc.1:packages/core/agent-loop/src/index.ts`（Config 定义）
- `git diff dsh-v0.1.5-rc.2 dsh-v0.1.7-rc.1 -- packages/core/agent-loop/src/index.ts packages/core/agent/src`
- `packages/client/ui-settings-agent-loop/README.md`

##### 影响

- 任何依赖 `ctx.settings.register/installSection('agent-loop' | 'agent-default-model' | 'shell' | ...)` 的第三方插件在新版**编译/运行都会失效**；须改为 `volatile()` Config 字段。
- 订阅 `agent/session-start` 的插件必须迁移到 `agent/created`，并注意其监听器现在会被 **串行 await**，抛错会拒绝创建。

---

#### 2. Subagent 语义与上限

##### 事实

- **新增容量配置**：`SubagentRuntime.Config`（`packages/subagent/subagent/src/index.ts:201-204`）：
  ```ts
  maxDepth: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(1).volatile(),
  maxActiveSubagents: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(8).volatile(),
  ```
  **这是 0.1.7-rc.1 的权威默认值：`maxDepth = 1`，`maxActiveSubagents = 8`。**
- **`maxDepth` 默认值从 3 降到 1**：旧版 `packages/subagent/tool-subagent/src/index.ts` 为
  `maxDepth: z.union([...]).default(3)`；新版**删掉了 `.default(3)`**，省略时走
  `SubagentRuntime.resolveMaxDepth()`（`packages/subagent/subagent/src/index.ts:244-250`）读取 host `subagent` 段的 `maxDepth`。
- **`ActivationPool`（新增）**：`packages/subagent/subagent/src/continuation-activation.ts:41-57`，以 `Set<symbol>` 记槽；超限抛
  `SubagentError('subagent limit reached (active child limit: N); ...', 'ACTIVATION_LIMIT_REACHED')`。
  每个"活着的非延续父代理"拥有一个进程内池，沿**未中断的延续父子链**按引用共享；池所有者自身不计数；一次性（one-shot）运行与外部 provider 工作**不进入**该池；跨 one-shot 父代理的容量继承暂不实现。
- **语义要点**（`.agents/notes/implemented/feature/2026-09-15-continuable-activation-capacity.md`）：
  - 冷恢复（cold resume）会在重建前预留槽位；失败或未发布的回滚可安全释放同一 token。
  - 向已存在的 Activation 发消息**复用**其槽位；空闲但有 pending inbox / 拥有子代理的 Activation 仍占槽。
  - 容量在**每次预留时重新采样**：调大立即放行更多子代理；调小不会驱逐常驻子代理，只会拒绝新的准入直到用量低于上限。
  - 满池**直接拒绝**而不排队（避免所有槽位属于等待后代的父代理时死锁）。
  - 冷恢复可能因容量被拒，前端表现为 `subagent/delivery-unavailable`。
- **延续/常驻子代理**：新增 `packages/subagent/subagent/src/continuation-activation.ts`、`archive-admission.ts`；`sendMessage` 不暴露子代理是否常驻；`interrupt_agent` 语义见 `tool-subagent-control`。
- **新增 client 包 `ui-settings-subagent`**：一页管两个命名空间——
  - `subagent`（`SUBAGENT_NS = 'subagent'`，`packages/client/ui-settings-subagent/src/client/index.ts:50`）：**Maximum recursion depth**（字段 `maxDepth`，下限 0）与 **Subagent parallelism limit**（字段 `maxActiveSubagents`，下限 1），各自可 reset 回组合默认。
  - `subagent-model-selection`：`enabled`（默认 `false`）与 `allowedModels`（默认 `[]`），属 `SubagentModelSelectionConfig`（`packages/subagent/tool-subagent/src/model-selection-settings.ts`），默认**关闭**，新旧一致。

##### 证据 / commit

| 项 | commit |
|---|---|
| 委派上限改由 backend 拥有、`tool-subagent` 去掉 `.default(3)` | `a69bcf3636 feat(subagent): own editable delegation limits in the backend` |
| 引入 `maxActiveSubagents`（先为 16） | `16620a3a70 feat(subagent): cap live continuable activations per root at 16` |
| 默认改为 8 | `d7f9d3a773 fix(subagent): default to eight live continuable children` |

##### 影响

- **默认只允许一层嵌套委派**。任何"主代理 → 子代理 → 孙代理"的组合在默认配置下会在第二层被拒；旧版默认允许 3 层。
- 默认并发 resident/continuable 子代理上限 8（每主代理树）。一次性 `subagent_*` 与外部 provider 不受此限。
- 需要恢复旧行为的部署：在 host `subagent` 条目上设 `maxDepth: 3`（或让具体委派工具显式指定 `maxDepth`），并可调 `maxActiveSubagents`。

---

#### 3. 模型与输入能力

##### 事实

- **`agent-default-model` 重写**：旧版导出 `AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = 'agent-default-model'` + `installSection`；新版改为纯 `Volatile` Config：
  ```ts
  static Config = z.object({
    provider: z.string().required().volatile(),
    model: z.string().required().volatile(),
    reasoningEffort: z.string().volatile(),
  })
  ```
  新增 `reasoningEffort` 作为可为空的 volatile 字段（旧版只在 settings 段落里有）。`saveSelection()` 由 `ctx.settings.replace(ns, ...)` 改为 `ctx.get('configEditor')?.edit(entry, ...)`（写 profile patch）。
- **DeepSeek 默认模型目录缩编**：`packages/llm/llm-deepseek/src/models.ts` 的 `DEFAULT_MODELS` 由 4 项减为 2 项：
  - 保留 `deepseek-flash`（DeepSeek-V41-Flash，`inputModalities: ['text','image']`、`systemPromptUpdate: 'in-history'`）与 `deepseek-v4-pro`；
  - **移除** `deepseek-v4-flash` 与 `deepseek-v4-flash-vision-exp`。
  `catalog.ts`/`config.ts` 的每模型 `imagePixelBudget` / `imageMaxBytes` 字段在默认目录中不再出现（`inputModalities` 仍在 schema 中，目录模型可声明）。
- **视觉/图像输入**：`inputModalities: z.array(z.union(MODEL_MODALITIES)).min(1).default(['text'])` 仍然存在（`packages/llm/llm-deepseek/src/config.ts:86`），**默认仍是纯文本**，需模型目录显式声明 `['text','image']`。新增/新暴露的图像相关 volatile 配额（`config.ts:99` 起）：`maxRequestFilesBytes`、`maxInlineRequestImageBytes`、`maxImagesPerRequest`、`imageOffloadByteQuantum`、`inlineImageOffloadByteQuantum`、`imageOffloadCountQuantum`、`filesApiTimeoutMs`、`fileExpiresAfterSeconds`、`fileRefreshMarginSeconds`、`fileQuotaCleanupBatch`、`retryPolicy`。
- **新增默认启用的图像卸载插件**：`packages/bundle/base/cordis.patch.yml` 新增 `image-offload` 行 → `@deepseek-ai/dsh-compaction-image-offload`（无 `disabled`，即默认开）：图像超预算时把最老图像替换为占位符后重试。
- **`ui-settings-shell`**（新包，条目 `bash-sandbox` / `pwsh-sandbox`）：
  - **Command timeout (ms)** → `timeoutMs`，默认 `120_000`
  - **Output cap per stream (bytes)** → `maxOutputBytes`，默认 `64_000`
  - （未暴露但同样 volatile：`maxTimeoutMs` 600_000、`maxSpillBytes`、`graceMs`、`cwd`）
  - 证据：`packages/shell/bash-local/src/index.ts:100-107`
- **`ui-settings-web-search`**（新包，条目 `web-search-deepseek`）：
  - **API key** → 走 credentials 域，引用由段落的 `apiKeyEnv` 指定，缺省 `DEEPSEEK_API_KEY`
  - **Endpoint** → `baseURL`（缺省走 provider 默认）
  - **Max searches per request** → `maxUses`，默认 `5`（`DEEPSEEK_DEFAULT_MAX_USES`）
  - 其他 volatile：`model`（`deepseek-v4-flash`）、`apiVersion`（`2023-06-01`）、`maxTokens`（`4096`）
- **web search / shell 默认启用状态**：base 默认挂 `web` + `web-search-deepseek` + `web-fetch-http` + `tool-web`（`config: { fetch: true, searchTimeoutMs: 60000 }`）；Web app 在 host 平面禁用 `tool-web`，由 `cordis`/`ptc`/`standard` 预设逐代理提供。**新旧一致，未翻转。**

##### 影响

- 若下游依赖 `deepseek-v4-flash` 或 `deepseek-v4-flash-vision-exp`：新版默认目录不含它们。注意 `packages/bundle/acp-app/cordis.patch.yml` 仍写 `model: deepseek-v4-flash`——见「待确认项」。
- `agent-default-model` 不再有 settings 命名空间；直接写 `settings.yaml` 的 `agent-default-model:` 段落在新版不会生效（见 §7）。

---

#### 4. 桌面端（`apps/desktop`）与平台

##### 事实

- **是否仍是薄壳：不是。** 决策记录 `.agents/notes/implemented/architecture/2026-09-10-desktop-web-wrapper.md`：Desktop 调用 CLI 的**共享 profile runner** 跑独立拥有的 Desktop profile，完整 Web 组合负责 auth / HTTP 路由 / 客户端资源 / RPC / 响应流；Electron 只拥有窗口、菜单、原生目录选择、恢复与发布更新。旧版则自造了无端口的 framed byte pipe 传输与"离线 seed 安装包"体系（`seed-store.ts` 在区间内被删除）。
- **传输翻转**：旧 README「opens no listening port」→ 新 README「Desktop defaults to port `19387`, separate from Web's `3080`」。Electron 把应用 HTTP 请求转发给认证过的 Web Host；丢弃 `transfer-encoding`/`connection`/`keep-alive`；插件 bundle 响应标 `no-store`。
- **启动流新增**：`host-process.ts`（Electron RunAsNode 子进程启动共享 runner）、`welcome-window.ts`/`welcome-backend.ts`/`welcome-api.ts`/`client/WelcomePage.tsx`（欢迎/引导流）、`runtime-tree.ts`、`backend-controller.ts`、`fatal-recovery.ts`、`startup-error.ts`、`crash-report.ts`。
- **更新流大幅新增**：`update-schedule.ts`（默认轮询 `600_000` ms = 10 分钟，`maxBackoffMs` 缺省 `3_600_000`，`jitter` 缺省 `0.2`；可用 `DSH_DESKTOP_UPDATE_CHECK_INTERVAL_MS` 等环境变量覆盖）、`update-journal.ts`、`update-dialog.ts`、`update-overlay.ts`、`update-presentation.ts`、`update-attention.ts`、`update-http-executor.ts`、`update-error.ts`、`mandatory-update-policy.ts`、`mandatory-update-window.ts`、`mandatory-update-ipc.ts`、`forceUpdate` 系列 preload。
- **native 恢复**：`fatal-recovery.ts` 与 `backend-controller.ts` 让 Electron 在 Host 不可用时仍能准备 profile 与恢复；`runtime-tree.ts` 管理打包运行时树。
- **asar / 签名**：新增 `apps/desktop/src/runtime-tree.ts`、`core-package-set.ts`；测试侧新增 `windows-asar-unpack.spec.ts`、`primary-runtime-signing.spec.ts`、`windows-sign*` 系列。新 README：签名 Windows 打包会扫描 primary runtime 与应用生产依赖的 PE 内容（含无扩展名文件），保留有效厂商签名、为未签名代码签名后才封存 runtime 哈希。
- **macOS vibrancy（全新）**：`apps/desktop/src/main.ts:193-203` → `titleBarStyle: 'hiddenInset'`、`trafficLightPosition: { x: 16, y: 18 }`、`vibrancy: 'sidebar'`，并用 `'active'` 保持失焦时材质稳定；`welcome-window.ts:29-31` → `vibrancy: 'menu'`。**旧 tag 中 `vibrancy`/`trafficLightPosition` 完全不存在。**
- **macOS 菜单**：新增 `preload-menu.ts` 与完整本地化菜单（File/Window/Application、Hide/Hide Others/Show All/Quit 本地化标签，保留 ⌘W/⌘M/⌘H）；F12 / ⌘⌥I / Ctrl+Shift+I 在打包构建中也能开 DevTools（更新遮罩与打包的浏览器 guest 除外）。
- **其它平台项**：`browser-guests.ts`（lease 限定的侧栏 `<webview>` guest，仅主窗口启用）、`microphone-permissions.ts`（限定 `dsh-app://app` 主帧）、`platform-view.ts` / `preload-platform*.ts`（嵌入式 Platform 文档，非持久会话 + 同步 IPC 读凭证）、`windows-layout.ts`（Windows 40-DIP 标题栏）、`policy-test-auth.ts`。
- **Office/Python 运行时**：新增 `resources` + `installer` 目录；打包 Python/Node/pnpm 发行版，`load_workspace_dependencies` 工具首次使用时离线安装到 `$DSH_HOME/dsh-runtimes/dsh-primary-runtime`；Desktop 默认注册 `office-docx`/`office-pptx`/`office-xlsx`。

##### 证据

`git diff --stat dsh-v0.1.5-rc.2 dsh-v0.1.7-rc.1 -- apps/desktop`（56 文件、+5698/−1898，仅 `src/`+README）；`apps/desktop/README.md` 全文重写（375 行变更）。

##### 影响

- 桌面版不再是"无端口"应用：本机 19387 端口被监听（可用 `webserver.config.port` patch 覆盖）。
- 桌面版与 Web 版共享 Plugins 页面与插件管理（旧版的独立插件管理 renderer/preload/IPC 已删除）；第三方插件只需按 Web 方式打包即可在两端工作。
- 桌面版**不再**对插件来源施加比 Web 更严的限制（决策记录明确"取代 Desktop-specific source, environment, and build restrictions"）。这放宽了安全边界，值得人工复核。

---

#### 5. CLI 与交互层

##### 事实

- **新增 profile 简写**：`dsh <name>` ≡ `dsh --profile <name>`；简写名必须紧跟 `dsh`。`plugin` 仍是命令（因此要启动名为 `plugin` 的 profile 需用 `--profile plugin`）。`web` 不再是"第一个 app 参数即子命令"（旧版是），`dsh web` 现在走简写。重复 `--profile`（含简写后再给显式选项）被拒。
- **新增 `--dump-config-schema`**：第三个 dump 模式，输出单个 JSON Schema 2020-12 文档；三种 dump 互斥，拒绝 app 参数与保留的 `desktop` profile。角色元数据（`secret`/`credential-ref`/`ms`）与 **`volatile` 实时更新元数据**保留在 `x-cordis` 注解中。commit `4eb26f0e71 feat(cli): export JSON Schema for Cordis configuration (#4705)`。
- **`patchReload` 配置项被移除**：新参考写「The final YAML composition controls whether `dsh-hmr` watches configuration; without HMR, changes require restart」。对应 base patch 里 `hmr` 行由 `disabled: true` 改为 `disabled: !!js "!ctx.get('profileContext')"`，并把包由 `@deepseek-ai/cordis-plugin-hmr` 换成 `@deepseek-ai/dsh-hmr`。
- **新增启动诊断报告**：启动失败时把报告写到 `$DSH_HOME/logs/startup-<timestamp>-<uuid>.log`（POSIX 上目录 `0700`/文件 `0600`），stderr 打印 `Full diagnostics: <path>`，退出码 1。**报告含未脱敏的原始插件错误，可能包含配置或凭证值。**
- **headless / CI 能力大幅增强**（`packages/bundle/headless`）：
  - 任务可来自**位置参数或 stdin**（省略参数或 `-` 表示 stdin；空管道报用法错误）。
  - 新增 `--session-id <id>`：采用已持久化的会话继续对话；未知 id、跨目录、子代理/分叉会话、当前 profile 未组合的 agent preset、或进程内已活着的同 id 都会**在任务运行前拒绝**。需要组合了 `sessionPersistence` 与 `sessionQuery`。
  - 新增 `--json`：stdout 输出 NDJSON 事件流（`session` 开头、`final` 结尾，中间 `status`/`text`/`thinking`/`tool_call`/`tool_result`/`error`）。除 `final` 外每个字符串上限 8 KiB，单行上限 32 KiB，嵌套深度上限 64。用法错误在 `--json` 下也会先写一条 `error` 事件。
  - `headless`/`sdk-app` bundle 显式 `hmr disabled: true`（新增）。
- **TUI**：无独立 TUI 组件。`tui` 仅作为 README/示例中的**用户自建 profile 名**出现（`dsh plugin --profile tui add github:deepseek-harness/turtle-ui`），交互面仍是 Web/桌面。
- **`sdk-app` 新增默认关闭的运行时行**：`workspace-dependencies` 与 `skill-office`，由 `DSH_PRIMARY_RUNTIME ?? DSH_BUNDLED_PRIMARY_RUNTIME` 决定启用。

##### 影响

- 依赖 `patchReload: live|startup` 的部署/脚本需要改写：现在由是否挂 `dsh-hmr` 决定。
- 自动化脚本可改用 `--json` 做流式消费；注意它是**投影而非完整日志**。
- 旧的 `dsh --profile <name>` 形式仍然有效；简写是纯增量。但"第一个 app 参数等于 `web` 就选子命令"的旧行为已取消。

---

#### 6. MCP

##### 事实

- **新增包 `packages/mcp/mcp-resources`**（旧 tag 只有 `mcp-client`）。默认随 `packages/bundle/base/cordis.patch.yml` 与 `packages/bundle/sdk-minimal/cordis.patch.yml` 各挂一行 `mcp-resources`（无 `disabled`，即默认启用）。
- 暴露 3 个共享工具：`list_mcp_resources`、`list_mcp_resource_templates`、`read_mcp_resource`，**每次调用都必须显式给 `server` 名**；按调用方 agent 作用域解析服务器；无配置服务器的调用方看不到任何 MCP 提示文本或工具。资源文本进入对话历史，二进制载荷只对程序化调用方可见（对模型表现为描述）。该包本身**无配置字段**。
- **`mcp-client` 契约变化**：
  - 摘要由「bridges tools only; MCP resources and prompts are unsupported」改为「lets the model use tools **and resources**」；MCP **prompt templates 仍不支持**。
  - 服务器 `instructions` 现在作为**字面文本**加入并记入 system prompt；新增上限字段 `maxInstructionBytes`，**默认 `32,768`**，超限则拒绝该连接（`packages/mcp/mcp-client/src/index.ts:129`，`src/connection.ts:320`）。
  - `toolCallTimeoutMs` 默认仍 `60_000`，但语义扩大到「每次 `tools/call` **或资源请求**」。
  - 协议协商：官方 SDK 优先选 **2026-07-28**，可回退到支持的旧修订；stdio 协商会先起一个**临时探测进程**再起服务进程。
  - 工具列表变更：由自有 `notifications/tools/list_changed` 处理改为「SDK 通过 legacy 通知或现代 subscription 接收」；**分页交给 SDK**（旧的"重复非空 continuation cursor 立即拒绝"逻辑被删除，见 `tests/fixtures/pagination-limit*` 重命名）。
  - 执行路径：`finalizeContent` → `projectContent`，图像在 `tools/post-execute` **之前**安装，使保留策略能看到真实图像。
  - 新导出 `createMcpToolDefinition(ctx, options)` 适配器（native Cua Driver provider 用它但不开 MCP 传输）。
- 工具命名契约不变：`mcp__<serverName>__<tool>`，`serverName` 匹配 `[A-Za-z0-9_-]{1,32}` 且在同一注册作用域内唯一。`failOnStartupError` 默认仍 `false`；`reconnect.enabled` 默认仍 `true`（`initialDelayMs` 500）。

##### 影响（第三方插件经 MCP 接入）

- 若插件自建 MCP 服务器并发布 resources：新版客户端的 `tools/list` 分页行为交给 SDK，旧的 cursor 链校验不再生效，需自测分页。
- 服务器 `instructions` 超过 32 KiB 会**直接拒绝连接**；请拆分或精简。
- 资源读取现在是模型可见的默认能力；若插件不希望模型读取其资源，需要改走 tools 而非 resources。

---

#### 7. 对下游插件的影响

| 变更 | 破坏性 | 说明 |
|---|---|---|
| `ctx.settings.register/installSection(ns, schema, base, hooks)` | **破坏性** | 新设置模型由 `volatile()` Config 字段 + `config-editor` + profile patch 组成；`packages/settings/settings/src/index.ts` 由 964 行重构（−4135/+1527 总变更），`invariant.ts` 被删除 |
| `$DSH_HOME/settings.yaml` 作为可写文档 | **破坏性** | 新版只在 Loader 稳定后**一次性导入**（`ui-developer-tools` → `ui-settings`、`ui-onboarding` → `ui-settings-general`、`shell` → 平台 shell 执行器条目），随后把文件改名为 `settings.yaml.imported`；被组合拒绝的段落只留在改名后的文件里 |
| 设置命名空间改名 | **破坏性** | `agent-loop`、`agent-default-model`、`subagent-model-selection` 等仍可寻址，但语义变为 **profile 条目 id**，不再是独立文档键 |
| `agent/session-start` 事件 | **破坏性** | 移除；改用 `agent/created`（新增 `source`/`signal`，监听器可返回 Promise 并被串行 await） |
| `AgentRegistry.register()` 返回类型 | 行为性 | 由同步 disposer 变为可 await 的 Cordis effect disposer |
| `tool-subagent.Config.maxDepth` 默认 3 → 无默认（回落 host `subagent.maxDepth = 1`） | **破坏性行为** | 默认只允许一层嵌套 |
| `tool-jobs.Config.maxConsecutiveWakes` 默认 3 → 未设置（无上限） | 行为性 | 空闲所有者会被**每次**后台完成唤醒；插件若依赖"最多 3 次"的封顶需显式配置 |
| `spill-policy` 配置键 `maxInlineBytes` → `maxInlineTokens` | **破坏性** | 旧键在新版不存在；base patch 由 `maxInlineBytes: 50000` 改为 `maxInlineTokens: 12500` |
| `tool-ralph` 行 | 行为性 | base + `standard`/`ptc`/`cordis` 预设全部 `disabled: true`；恢复需 overlay 行。`ptc` 同时禁用 `workflow-ptc` |
| `workflow-worker-thread` 行 | **破坏性** | 被 `ptc-runtime`（`@deepseek-ai/dsh-ptc-runtime-node`）+ `workflow-ptc` 取代；旧 row id 消失 |
| `packages/preset/agent-presets` | **破坏性** | 拆分为 `agent-preset-registry` + `agent-preset`；新增 volatile 字段 `selectedDefault`、`modeSelectionEnabled`（默认 `true`）；预设声明移到 `packages/bundle/web-app/presets/*.patch.yml` |
| `code-runtime` 包 | 移除 | `packages/code-runtime` 与 `packages/e2b` 目录消失，改由 `packages/ptc-runtime` 承担 |
| MCP `mcp-client` 的 `finalizeContent` 时点 | 行为性 | 图像投影现在早于 `tools/post-execute` |
| 工具注册契约 | 行为性 | `packages/core/tools/src/index.ts`、`ptc.ts`、`schema.ts`、`types.ts` 均有改动（+224/−67）；PTC 模式工具面显著变化 |
| 会话日志上传默认开启 | **隐私相关** | 默认把完整 canonical 日志后缀（含工具入参与结果、工作区路径、反馈）随 DeepSeek 请求发出 |

---

#### 默认值翻转清单（表）

> 说明：本表只列**已在新旧两版源码中核对过**的翻转。「未变」项单列于表后，避免误读。

| # | 配置键 / 常量 | 位置（新 tag） | 旧默认 | 新默认 | 影响 | 证据 commit |
|---|---|---|---|---|---|---|
| 1 | `session-log-deepseek.Config.enabled` | `packages/session/session-log-deepseek/src/index.ts:39,45` | `false` | `true` | 默认随 DeepSeek 请求发送完整未确认 canonical 日志后缀（消息正文、工具入参与结果、工作区路径、反馈）。请求体显著变大；OTel 开关独立，关 OTel 不影响它 | `2389b65246 feat(session): default session-log upload on outside recorded-session lanes`；`6ce915d3fc`；`31ec6bc7e3` |
| 2 | `SubagentRuntime.Config.maxDepth` | `packages/subagent/subagent/src/index.ts:202` | （无此键） | `1` | 委派树默认只允许直接子代理一层；`0` 完全禁止 | `a69bcf3636` |
| 3 | `tool-subagent.Config.maxDepth` | `packages/subagent/tool-subagent/src/index.ts:130` | `3` | 无默认（读 host `subagent.maxDepth`，即 `1`） | 与 #2 合并效果：**旧默认 3 层 → 新默认 1 层** | `a69bcf3636` |
| 4 | `SubagentRuntime.Config.maxActiveSubagents` | `packages/subagent/subagent/src/index.ts:203` | （无此键） | `8` | 每个非延续根代理树下最多 8 个常驻/延续子代理槽位；超限直接拒绝（`ACTIVATION_LIMIT_REACHED`） | `16620a3a70`（16）→ `d7f9d3a773`（8） |
| 5 | `ToolJobs.Config.maxConsecutiveWakes` | `packages/jobs/tool-jobs/src/index.ts:63` | `3` | 未设置 = 无上限 | 空闲所有者的每次后台作业完成都会开一轮；不再出现"第 4 条通知静默停在 inbox"的停滞 | `b6775f6d4f fix(tool-jobs): wake an idle owner for every completion by default` |
| 6 | `ui-settings.enabled`（developer tools） | `packages/client/ui-settings/src/developer-tools-settings.ts:15` | `false` | `true` | 新装即暴露 Trajectory 视图、工具 Inspect、preset 选择、变更文件卡与**可执行脚本的 HTML 预览**；已保存的 `false` 仍生效 | `cdaafbc456`（加入，false）→ `93caf245b4` / `c7c900a912`（true） |
| 7 | `tool-ralph` 行 `disabled` | `packages/bundle/base/cordis.patch.yml` | 启用 | `true`（base + `standard`/`ptc`/`cordis` 预设） | 默认 Web/headless/sdk/acp/自定义 base profile 不再提供 `ralph`；`ptc` 同时禁用 `workflow-ptc` | `73985344cd feat(presets): disable ralph in the default compositions` |
| 8 | `spill-policy` 内联预算键与值 | `packages/spill/spill-policy/src/index.ts:27,34` | `maxInlineBytes: 50000` | `maxInlineTokens: 12500` | 溢出判定由 UTF-8 字节改为 token；base 组合的等效阈值下降 | `ab102138c8 fix: retain ordered tool text and images within a token budget` |
| 9 | `compaction-basic.Config.headroomTokens` | `packages/compaction/compaction-basic/src/config.ts:75` | （无此键） | `65_536` | 压力阈值同时受 window 比例与「window − 预留输出 − headroom」约束；阈值更晚触发 | 见 `packages/compaction/compaction-basic/src/config.ts` diff |
| 10 | `compaction-basic.Config.maxTokens`（摘要生成上限） | `packages/compaction/compaction-basic/src/config.ts:76,104` | `8192` | `headroomTokens`（默认 `65536`） | 摘要生成预算提高 8×；`maxTokens` 显式值必须为正整数 | 同上 |
| 11 | `compaction-basic` 阈值/保留基数 | `resolveCompactSpec()` | `contextWindow × ratio` | `(contextWindow − reservedCompletionTokens) × ratio`，并以 `pressureBudgetTokens` 封顶 | 保留比例的分母变为"消息预算"而非整个窗口 | 同上 |
| 12 | `ui-chat` `DEFAULT_TRANSCRIPT_VIEW_MODE` | `packages/client/ui-chat/src/chat-settings.ts:32` | `'compact'` | `'standard'` | 新装默认展示更完整的对话记录；同时新增 `linkOpening`（默认 `'sidebar'`）与 `performanceUsage`（默认 `'detailed'`） | `015a9b202c feat(chat): add four work detail modes and legacy mappings` |
| 13 | `llm-deepseek` `DEFAULT_MODELS` | `packages/llm/llm-deepseek/src/models.ts` | 4 个模型（含 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`） | 2 个模型（`deepseek-flash`、`deepseek-v4-pro`） | 模型选择器更短；`deepseek-v4-flash` 需自行加入目录 | 见 `docs/config-catalog.md` diff（"defaults to V41 Flash and V4 Pro"） |
| 14 | `agent-loop` `hmr` 行 | `packages/bundle/base/cordis.patch.yml` | `disabled: true`（`cordis-plugin-hmr`，`root: ['.']`） | `disabled: !!js "!ctx.get('profileContext')"`（`dsh-hmr`，`root: []`） | 有 profile 上下文时 **默认开启 HMR**：改 `cordis.patch.yml` 热生效；`patchReload` 配置项消失 | base patch diff |
| 15 | `compaction-image-offload` 行 | `packages/bundle/base/cordis.patch.yml` | 不存在 | 默认启用（无 `disabled`） | 图像超预算时自动把最老图像替换为占位并重试 | base patch diff |
| 16 | `mcp-resources` 行 | `packages/bundle/base/cordis.patch.yml`、`packages/bundle/sdk-minimal/cordis.patch.yml` | 不存在 | 默认启用 | 只要配置了 MCP 服务器，模型就能 `list/read` MCP resources | base / sdk-minimal patch diff |
| 17 | `mcp-client.maxInstructionBytes` | `packages/mcp/mcp-client/src/index.ts:129` | （无此键） | `32_768` | 服务器 instructions 超限则拒绝连接 | mcp-client diff |
| 18 | `settings` 行 | `packages/bundle/base/cordis.patch.yml` | `@deepseek-ai/dsh-settings-file`（`settings.yaml` 文档） | `@deepseek-ai/dsh-settings` + 新 `config-editor` 行，二者 `disabled: !!js "!ctx.get('profileContext')"` | 设置持久化改到 profile patch；`settings.yaml` 仅一次性导入 | base patch diff |
| 19 | `agent-preset-registry.modeSelectionEnabled` | `packages/preset/agent-preset-registry/src/index.ts:56` | （包不存在） | `true` | 新会话界面默认暴露预设选择，并应用保存的默认预设 | `packages/preset/agent-preset-registry` 为新增包 |
| 20 | `tool-plugin-manager` 行 | `packages/bundle/base/cordis.patch.yml` | 不存在 | 新增但 `disabled: true` | 插件管理工具默认不对模型开放 | base patch diff |
| 21 | `plugin-manager` 行 | 同上 | 不存在 | 新增，`disabled: !!js "!ctx.get('profileContext')"` | 有 profile 时默认启用插件管理器 | base patch diff |
| 22 | `ui-settings-models.credentialOnboarding` | `packages/client/ui-settings-models/src/onboarding-config.ts` | （无此键） | `true` | 新装默认进入凭证引导 | catalog diff |
| 23 | `ui-plugin-manager.registryProbeEnabled` | `packages/client/ui-plugin-manager/src/index.ts` | （无此键） | `true`（超时 1500 ms，缓存 TTL 300000 ms） | 插件页默认探测注册表 | catalog diff |
| 24 | `headless` 行 `hmr` / `sdk-app` 行 `hmr` | `packages/bundle/headless/cordis.patch.yml`、`sdk-app/cordis.patch.yml` | 不存在 | `disabled: true`（新增行） | headless/sdk 一次性进程明确关 HMR | bundle patch diff |
| 25 | 桌面更新轮询 | `apps/desktop/src/update-schedule.ts` | 旧版无 `update-schedule.ts` | `intervalMs 600_000`、`maxBackoffMs 3_600_000`、`jitter 0.2` | 桌面默认每 10 分钟检查更新并带退避/抖动 | 文件为新增 |
| 26 | 桌面监听端口 | `apps/desktop/README.md` | 不开监听端口（framed pipe） | 默认 `19387` | 桌面版现在监听本机 HTTP；可用 `webserver.config.port` patch 覆盖 | README 重写 + `2026-09-10-desktop-web-wrapper.md` |

##### 明确核对为「未变」的候选点

| 候选 | 结论 |
|---|---|
| `agent-loop.maxParallelToolCalls` | 仍为 `10`（仅是加了 `.volatile()`） |
| `sandbox-policy` 默认模式 | 仍为 `'read-only'`（`packages/sandbox/sandbox-policy/src/index.ts:113`，新旧一致） |
| shell 执行器 `timeoutMs` / `maxTimeoutMs` / `maxOutputBytes` | 仍为 `120_000` / `600_000` / `64_000`（只是变为可编辑） |
| `ui-theme` 主题偏好 / 字号 | 仍为 `'system'` / `14` |
| `web-search-deepseek` `maxUses` / `apiVersion` / `maxTokens` | 仍为 `5` / `2023-06-01` / `4096` |
| OTel 遥测（`session-telemetry-otel`） | 仍为 feedback-gated + `FEEDBACK_ONLY`；`FULL` 仍被拒 |
| `web_search` / `web_fetch` / shell 工具默认启用集合 | base 仍默认挂载；Web app 仍由预设逐代理提供 |
| `agent-default-model` 默认 provider/model | base 仍为 `deepseek-flash`；ACP app 仍写 `deepseek-v4-flash` |
| MCP `failOnStartupError` / `toolCallTimeoutMs` / `reconnect.*` | 仍为 `false` / `60_000` / `true,500,×2` |
| `mcp-client` 工具命名 `mcp__<server>__<tool>` | 不变 |

---

#### 待确认项

1. **ACP app 默认模型与目录不一致**：`packages/bundle/acp-app/cordis.patch.yml:21` 仍写 `model: deepseek-v4-flash`，但该 id 已从 `DEFAULT_MODELS` 移除。`packages/llm/llm-deepseek/src/model-info.ts:74` 对未知模型有 `{ provider, id, name, inputModalities: ['text'] }` 回退，因此**大概率仍能启动但退化为纯文本**。需人工确认是否属有意（ACP 只跑文本）还是遗漏。
2. **`maxActiveSubagents` 的最终值**：决策记录写 8，早期 commit 写 16，源码为 8。若下游按决策记录文字实现会不一致；以 `packages/subagent/subagent/src/index.ts:203` 为准。
3. **`docs/config-catalog.md` 未逐条核对**：本表依据 TS 源码与 bundle patch，未逐行比对生成目录中每个字段的 `default` 注解；若有仅存在于 catalog 的默认值差异需另跑一次 `git diff ... -- docs/config-catalog.md` 全量审阅。
4. **`packages/core/tools` 与 PTC 的完整工具契约**：`src/index.ts`、`ptc.ts`、`schema.ts`、`types.ts` 共 +224/−67，本线只做了统计级确认，未逐项核对工具注册/事件签名。若下游插件注册工具或拦截 `tools/pre-execute`/`tools/post-execute`，建议单开一条调研线。
5. **`agent-preset-registry` 的挂载语义**：新增的 `selectedDefault`/`modeSelectionEnabled` volatile 字段与 `settings.configure({ auto: false })` 的交互未完全展开；预设声明从包内置改为 `packages/bundle/web-app/presets/*.patch.yml`（`cordis`/`minimal`/`ptc`/`standard` 四个新文件）需要单独核对行级差异。
6. **桌面版安全边界放宽**：决策记录明确 Desktop 改为继承 `NODE_OPTIONS`/`NODE_PATH`/npm-pnpm 环境变量并执行依赖生命周期脚本（旧版有 Desktop 专属限制）。这是行为性放宽，需人工判断是否符合部署要求。
7. **`session-log-deepseek` 上传范围**：新版默认开启，但 `packages/bundle/headless`、ACP、Web scaffold 的录制语料显式关闭。生产 profile 是否全部显式声明关闭策略，本线未逐一核对所有 bundle patch。
## A.7 dsh-ldvh 宿主接缝逐条核对

<!-- line: ldvh-seams -->

### LDVH 宿主 API 接缝核对（dsh-v0.1.5-rc.2 → dsh-v0.1.7-rc.1）

核对对象：第三方插件 `dsh-ldvh`（`/Users/dmh2002/DshProject/dsh-ldvh`，版本 `1.0.0-dev.1`）实际消费的 DSH 宿主 API。

- 旧版基线 = `dsh-v0.1.5-rc.2`（tag `fb2c4b9e69`，本仓库 HEAD detached 于此，工作树即旧版）
- 新版目标 = `dsh-v0.1.7-rc.1`（tag `46a7f68b09`）
- 全部核对通过 `git show <tag>:<path>` / `git grep -n <pat> <tag> -- <path>` 完成，**未对 DSH 仓库工作树或索引做任何变更**。
- 判定纪律：不能确证为「兼容」的一律写「未确证」，不猜测。

---

#### 结论速览

| 接缝 | 旧（0.1.5-rc.2） | 新（0.1.7-rc.1） | 判定 | 严重度 |
|---|---|---|---|---|
| 设置命名空间注册（Host） | `ctx.settings.register(ns, schema, opts)` + `ctx.settings.installSection(...)` | `SettingsForms`：无 `register` / 无 `installSection`；命名空间改由**插件自身 Cordis `Config` schema** 派生（entry id 即 ns） | **已移除/改名 + 语义重构** | **致命** |
| `installSettingsSection` 自由函数（LDVH import 名） | 宿主包已无此导出（0.1.2-alpha.5 起移除）；LDVH 靠自带 `node_modules/@deepseek-ai/dsh-settings@0.1.0-rc.6` 取得 | 新版仍无；且其内部调用的 `settings.register` 在新版不存在 → 抛错 | **已移除** | **致命** |
| 设置卡 slot | `settings.plugin.item`（`kind:'keyed'`，由 `ui-settings-plugins` 声明） | 已无此 slot；新 slot 为 `plugins.item`（`kind:'list'`，由 `ui-plugin-manager` 声明） | **已移除/改名** | 高 |
| client 设置服务 | `ctx.settingsScope.bind({namespace})` → `SettingsScope<T>` | `ctx.settingsScope` 整个服务不存在；新服务 `ctx.configForms.get(entryId)` → `ConfigForm<T>`，另加 `whileServed(ns[], register)` | **已移除/改名 + 签名变化** | 高 |
| `@deepseek-ai/dsh-client-ui-primitives` 图标导出 | `IconChevronDownOutline14`（尺寸后缀命名，75 个导出） | 整族改名（粗细后缀命名，186 个导出）：`IconChevronDownOutlineRegular` / `...Medium` | **已移除/改名** | 高 |
| `agent/session-start` 事件 | 存在（`packages/core/agent/src/runtime-types.ts:316`） | **全树 0 处**；`source: SessionStartSource` 并入 `agent/created` payload | **已移除** | 高 |
| `{kind:'plugin'}` 消息来源 → 会话行 label | `contextProvenance` 显式分支：label = `source.plugin` | `MessageSourceMap` 取消 catch-all `plugin` kind；`contextProducer` 删除该分支 → label 退化为裸 kind `"plugin"` | **存在但语义变化** | 中 |
| profile 插件模块解析 | bare row 经 `$DSH_HOME/profiles/node_modules` 修复回退 | 改为「computed runtime resolution」，在 Node resolver 上装拦截 | **存在但语义变化** | 中 |
| `ctx.tools.register` | `register(definition): () => void` | 同签名（`ToolDefinition` 仅新增可选 `projectContent?`） | 兼容 | — |
| `ctx.tools.guard` | `guard(guard: ToolGuard): () => void`；`ToolGuard = (exec) => string \| undefined` | 逐字相同 | 兼容 | — |
| `ctx.invariants.register` | `register(pkg, installer)` | `packages/runtime-diagnostics/invariants/src/index.ts` **两版字节完全一致** | 兼容 | — |
| `ctx.userQuestions.ask` | `ask(request)` | `packages/interaction/user-questions/src/index.ts` **两版字节完全一致**（154 行） | 兼容 | — |
| `fs` 服务 + `fs/observed` / `fs/write-intent` / `fs/edit-intent` | `resolve` / `stat(target, signal)`；三事件与 `FsWriteIntent` 已声明 | 事件声明、`FsWriteIntent`、`resolve`、`stat` 逐字相同 | 兼容 | — |
| `ctx.webServer.register` prefix 路由 | `register({kind:'prefix', path, handler})` | `packages/host/webserver/src/index.ts` 仅 2 处非语义 diff | 兼容 | — |
| `ctx.effect` / `ctx.on` / `ctx.inject` / `ctx.get` / `ctx.emit` / `ctx.logger` | Cordis 4 | 同（LDVH 自带 cordis 4.0.1） | 兼容 | — |
| `system-prompt/assemble` + `PromptAssembly.sections` | `{name, text}` | `packages/core/system-prompt/src/index.ts` `PromptAssembly` 逐字相同 | 兼容 | — |
| `agent/pre-step` + `PreStepDecision` | `{kind:'enter', messages}` | 逐字相同（`runtime-types.ts:112-119`） | 兼容 | — |
| `agent/turn-stopping` / `session/event` / `agent/created` | 存在 | 存在 | 兼容 | — |
| `agents` 服务（`roots()` / `get()`） | 存在 | 存在 | 兼容 | — |
| `sessionPersistence.locate(header)` | TS `private`，运行时可达 | 同（仍 `private`） | 兼容（非公开契约） | 低 |
| `ctx.commands.register` / `connection.handle` | 存在 | 存在 | 兼容 | — |
| `ctx.get("dshHomePath")` | 存在（`app-boot` 声明） | 声明逐字相同 | 兼容 | — |
| `ctx.locale.register` / `bind` | 存在 | 逐字相同 | 兼容 | — |
| `ctx.slots.register` / `inject` / `entries` / `subscribe` | 存在 | 存在（`ui-slots` 内部重构，五个方法签名不变） | 兼容 | — |
| `remote.directoryPicker.pick()` | `{ok, value}` | 同 | 兼容 | — |
| `@deepseek-ai/dsh-atomic-write` | `writeFileAtomic` / `withFileLock` | 同签名，仅 Windows 锁重试行为变化 | 兼容 | — |
| `@deepseek-ai/dsh-home-paths` | `resolveDshHome` | 同；新增 `dshCachePath` | 兼容 | — |
| bundle patch `insert:` 方言 | 支持 | 支持（`{ insert: rows }`） | 兼容 | — |
| `dsh.client` 契约字段 | `platform` / `inject` / `external` / `immediately` + 必须有 `./client` 导出 | 校验器字段集相同 | 兼容 | — |
| `plugin/web`（自建 Vite SPA） | 仅经 `/ldvh` prefix 路由 + 自建 `/api/cognition` | 无 DSH token / boot 全局 / 跨包 import 依赖 | 兼容 | — |
| `window.__DSH_DESKTOP_PICK_DIRECTORY__` | **两个 tag 中均不存在** | 新版 Desktop 暴露的是 `__DSH_DIRECTORY_PICKER__` | 未确证（两版皆失效） | 低 |
| `@deepseek-ai/schemastery` | 外部包 `^3.18.1` | 未在本次核对范围内 | 未确证 | 低 |
| `betterSidebar`（第三方服务） | 非 DSH 契约 | 非 DSH 契约，不在此仓库 | 未确证 | 中 |
| `DSH_SESSION_JSONL` 环境变量 | 两个 tag 中仅见于归档笔记 | 同 | 未确证（两版皆未确证） | 低 |

**统计**（按上表 34 行接缝计）：**兼容 22 条 / 存在但签名或语义变化 2 条 / 已移除或改名 6 条 / 未确证 4 条**。

- 兼容 22 条中含 1 条标注「逐字相同」（`ctx.invariants.register`）与 1 条标注「兼容（非公开契约）」（`sessionPersistence.locate`），两者均计入兼容。
- 6 条移除中，严重度**致命 2 条**（设置命名空间注册、`installSettingsSection`）、**高 4 条**（设置卡 slot、client 设置服务、图标导出、`agent/session-start`）。

---

#### LDVH 宿主 API 使用点清单

##### A. 宿主声明（inject / 依赖 / 契约）

| 文件:行 | API | 用途 | 新版权判定 |
|---|---|---|---|
| `plugin/lib/index.js:74` | `export const inject = ["tools","settings","systemPrompt"]` | 声明三个硬依赖服务 | 兼容（三服务均存在） |
| `plugin/lib/index.js:274` | `ctx.inject(["webServer"], cb)` | 软挂载 Web 路由，headless 组合不阻塞 | 兼容 |
| `plugin/lib/index.js:324` | `ctx.inject(["connection"], cb)` | 软挂载 RPC / slash 命令面 | 兼容 |
| `plugin/lib/client.js:953` | `inject = ["slots","locale","settingsScope"]` | client 半侧声明 | **变化**：`settingsScope` 已不存在 |
| `plugin/package.json:53-58` | `dsh.bundle.patch` / `dsh.client.{platform,inject}` | 打包契约 | 兼容 |
| `plugin/package.json:60-63` | deps：`dsh-atomic-write` / `dsh-home-paths` / `schemastery` | 运行时依赖 | 兼容 / 未确证（schemastery） |
| `plugin/package.json:64-69` | peers：`dsh-client-ui-primitives` / `dsh-host-webserver` / `dsh-settings` | 宿主包版本区间 | 兼容（包名均存在） |
| `plugin/cordis.patch.yml:14-16` | `- insert: [{id: dsh-ldvh, name: 'dsh-ldvh'}]` | 作为一行 host-plane 插件接入 | 兼容（`insert` 方言仍在） |

##### B. 从宿主包 import

| 文件:行 | API | 用途 | 新版权判定 |
|---|---|---|---|
| `plugin/lib/index.js:30` | `import z from "@deepseek-ai/schemastery"` | 设置 schema 构造 | 未确证（外部包，未核） |
| `plugin/lib/index.js:31` | `import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings"` | 设置命名空间注册 | **已移除**（旧版基线亦已无此导出） |
| `plugin/lib/bin.js:5` | `import { resolveDshHome } from "@deepseek-ai/dsh-home-paths"` | CLI 解析 DSH home | 兼容 |
| `plugin/lib/governed-projects.js:7` | `import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write"` | 登记载体原子写 + 文件锁 | 兼容 |
| `plugin/lib/client.js:23` | `require("@deepseek-ai/dsh-client-ui-primitives")` | client 半侧 UI 原子件 | 部分**已移除**（见 D 段） |

##### C. tools / invariants / userQuestions 三大声明缝

| 文件:行 | API | 用途 | 新版权判定 |
|---|---|---|---|
| `plugin/lib/ldvh-tools.js:873` | `ctx.tools.register(toolDescriptor(...))` | 注册 LDVH 工具批次 | 兼容 |
| `plugin/lib/subagent-result.js:80` | `ctx.tools.register({...})` | 注册子代理结果工具 | 兼容 |
| `plugin/lib/{adr,friction,goal,norm,pitfall,research,spark,workcase}-tools.js:537/526/295/522/523/804/559/863` | `ctx.tools.register(...)` | 各事实类型工具批次 | 兼容 |
| `plugin/lib/host-seams.js:177` | `ctx.get("tools")` | 取 tools 服务以装 guard | 兼容 |
| `plugin/lib/host-seams.js:181` | `tools.guard((execution) => string \| undefined)` | 单调 guard：写形态 `ldvh_*` 工具在 `unavailable` 时拒绝 | 兼容（签名逐字相同） |
| `plugin/lib/host-seams.js:224` | `ctx.get("invariants")` | 取 invariants 服务 | 兼容 |
| `plugin/lib/host-seams.js:228` | `invariants.register("dsh-ldvh", async (_ictx, fail) => ...)` | 安装期断言：登记载体满足 v5 schema | 兼容（该包两版字节一致） |
| `plugin/lib/host-seams.js:323` | `ctx.get("userQuestions")` | 取 Human 问答入口 | 兼容 |
| `plugin/lib/host-seams.js:353` | `userQuestions.ask({questions, signal, agent})` | 承载 07 §5.6 登记同意 / 21 §6.3 路由决策 | 兼容 |
| `plugin/lib/workcase-tools.js:364` | `agent: exec?.agent` | 路由询问必须携带 live agent | 兼容（`ToolExecutionInput.agent` 仍在） |

##### D. `fs/observed` 读写两半 + fs 服务

| 文件:行 | API | 用途 | 新版权判定 |
|---|---|---|---|
| `plugin/lib/host-seams.js:271` | `ctx.on("fs/observed", (target, obs) => ...)` | 读半：镜像观测版本 | 兼容 |
| `plugin/lib/host-seams.js:287` | `ctx.on("fs/write-intent", writeIntent)` | 写半：按已观测版本要求 `replaceIfVersion` | 兼容 |
| `plugin/lib/host-seams.js:288` | `ctx.on("fs/edit-intent", writeIntent)` | 写半：同上（edit 路径） | 兼容 |
| `plugin/lib/host-seams.js:131` | `ctx.emit("fs/observed", target, {kind:'present',version}, undefined)` | 自观测广播 | 兼容 |
| `plugin/lib/host-seams.js:293` | `ctx.get("fs")` | 取 fs 服务以获得真实 `FsVersion` | 兼容 |
| `plugin/lib/host-seams.js:509` | `fs.resolve(path, {cwd, signal})` | 路径→稳定 `FsTarget` | 兼容 |
| `plugin/lib/host-seams.js:510` | `fs.stat(target, signal)` | 取 `{version, type}`；`undefined` = 缺席 | 兼容 |

##### E. webServer 路由

| 文件:行 | API | 用途 | 新版权判定 |
|---|---|---|---|
| `plugin/lib/index.js:183` | `webServer.register({kind:"prefix", path:"/ldvh/state", handler})` | 常驻治理状态端点（不受 webEnabled 影响） | 兼容 |
| `plugin/lib/index.js:149` | `webServer.register({kind:"prefix", path:"/ldvh/api", handler})` | 后端 API（health + 治理端点 + 代理子进程） | 兼容 |
| `plugin/lib/index.js:154` | `webServer.register({kind:"prefix", path:"/ldvh", handler})` | SPA 静态挂载（`web/dist`） | 兼容 |
| `plugin/lib/index.js:310` | `webCtx.effect(() => () => ...)` | 路由 + 子进程随 fiber 回收 | 兼容 |
| `plugin/lib/web-mount.js:60-381` | Node `http` 代理 / 流式转发 / 子进程 | SPA 与 Express 子进程桥 | 兼容（不依赖宿主内部 API） |

##### F. 设置接缝（Host + Client）

| 文件:行 | API | 用途 | 新版权判定 |
|---|---|---|---|
| `plugin/lib/index.js:76` | `settingsNamespace("dsh-ldvh")` | 校验并品牌化命名空间 | **已移除** |
| `plugin/lib/index.js:78-88` | `z.object({webEnabled, showInConversationTab, showInSidebarTab}).default({})` | 设置 schema | 兼容（schemastery 侧） |
| `plugin/lib/index.js:135` | `state.settingsSource?.()` | 读实时设置值 | 兼容（本地 thunk） |
| `plugin/lib/index.js:338` | `installSettingsSection(ctx, ns, schema, {}, {setSource, onChange})` | 注册设置命名空间 | **已移除** |
| `plugin/lib/client.js:962` | `ctx.settingsScope.bind({namespace:"dsh-ldvh"})` | 绑定命名空间 scope | **已移除/改名** |
| `plugin/lib/client.js:342,345` | `scope.getSnapshot()` / `scope.subscribe(fn)` | 订阅设置变更 | 兼容（新 `ConfigForm` 同形） |
| `plugin/lib/client.js:579-581` | `scope.set(field, value)` | 写设置字段 | **签名变化**（返回 `Promise<void>` → `Promise<boolean>`） |
| `plugin/lib/client.js:968` | `ctx.slots.inject("settings.plugin.item", cb)` | 订阅设置卡 slot | **已移除/改名** |
| `plugin/lib/client.js:969-974` | `ctx.slots.register({name:"settings.plugin.item", key:"dsh-ldvh", priority:30, inject})` | 注册设置卡（keyed） | **已移除/改名** |

##### G. 事件面

| 文件:行 | API | 用途 | 新版权判定 |
|---|---|---|---|
| `plugin/lib/lifecycle.js:270` | `ctx.on("agent/created", ({agent}) => install(agent))` | 每 agent 生命周期安装 | 兼容 |
| `plugin/lib/lifecycle.js:236` / `child.js:105` | `agent.ctx.on("system-prompt/assemble", fn)` | 注入 LDVH 指引 section | 兼容 |
| `plugin/lib/lifecycle.js:237` / `child.js:118` | `agent.ctx.on("agent/pre-step", fn, {prepend:true})` | 注入可见判定行（上下文注入行） | 兼容 |
| `plugin/lib/lifecycle.js:238` | `agent.ctx.on("agent/turn-stopping", fn)` | 回合级触发器 | 兼容 |
| `plugin/lib/lifecycle.js:239` / `child.js:142` | `agent.ctx.on("session/event", fn)` | 读 `turn/end` + 回溯 assistant/message | 兼容 |
| `plugin/lib/lifecycle.js:240` | `agent.ctx.on("agent/session-start", fn)` | prime pre-step 通道 + 重判 scope | **已移除** |
| `plugin/lib/child.js:119` | `agent.ctx.on("agent/session-start", fn)` | 刷新委派子代理的父级治理态 | **已移除** |
| `plugin/lib/host-seams.js:271,287,288` | `ctx.on("fs/observed"/"fs/write-intent"/"fs/edit-intent")` | 见 D 段 | 兼容 |

##### H. 消息 / 上下文注入形状

| 文件:行 | API | 用途 | 新版权判定 |
|---|---|---|---|
| `plugin/lib/guidance.js:143-155` | `source: {kind:"plugin", plugin, form:"notice", summary}` | 构造「上下文注入 · dsh-ldvh」行 | **存在但语义变化**（label 退化） |
| `plugin/lib/guidance.js:210-213` | `{kind:"enter", messages:[...]}` | pre-step 决策形状 | 兼容 |
| `plugin/lib/guidance.js:91-93` | `assembled.sections` 过滤 / push `{name, text}` | system-prompt section 注入 | 兼容 |

##### I. 其余宿主服务

| 文件:行 | API | 用途 | 新版权判定 |
|---|---|---|---|
| `plugin/lib/index.js:231` | `ctx.get("dshHomePath")` | 解析 `$DSH_HOME` 下的载体路径 | 兼容 |
| `plugin/lib/lifecycle.js:71` | `ctx.get("sessionPersistence")` | 传递会话日志持久化服务 | 兼容 |
| `plugin/lib/lifecycle.js:176,275` / `child.js:50` | `ctx.get("agents")` → `.roots()` / `.get(id)` | roots-only 门 + 子代理血缘解析 | 兼容 |
| `plugin/lib/index.js:328` | `ctx.get("commands")` → `commands.register` | slash 命令面（当前为空实现） | 兼容 |
| `plugin/lib/rpc.js:19-33` | `connection.handle("ldvh/*", handler)` | 4 条只读 RPC 通道 | 兼容 |
| `plugin/lib/index.js:242,370` / `lifecycle.js:182` / `child.js:77` | `ctx.effect(fn, label)` / `agent.ctx.effect(fn, label)` | 生命周期与清理 | 兼容 |
| 全文件 | `ctx.logger.{info,warn,error}` | 诊断日志 | 兼容 |

##### J. Client 侧其余

| 文件:行 | API | 用途 | 新版权判定 |
|---|---|---|---|
| `plugin/lib/client.js:958` | `ctx.locale.register(LDVH_NS, {zh, en})` | 注册字典 | 兼容 |
| `plugin/lib/client.js:961` | `ctx.locale.bind(LDVH_NS)` | 取翻译函数 | 兼容 |
| `plugin/lib/client.js:1009-1016` | `ctx.slots.inject("conversation.view")` + `slots.register({name:"conversation.view", id:"ldvh", order:20})` | 对话 Tab 投放面 | 兼容 |
| `plugin/lib/client.js:985-1006` | `ctx.inject(["betterSidebar"])` → `betterSidebar.registerTab({...})` | 侧边栏 Tab 投放面 | 未确证（第三方服务） |
| `plugin/lib/client.js:964` | `ctx.get("remote.directoryPicker")` | 原生目录选择器 | 兼容 |
| `plugin/lib/client.js:480-486` | `directoryPicker.pick()` → `{ok, value}` | 选取项目目录 | 兼容 |
| `plugin/lib/client.js:24` | `primitives.Toast` | 提示条 | 兼容 |
| `plugin/lib/client.js:25,846` | `primitives.IconChevronDownOutline14` | 设置卡折叠箭头 | **已移除/改名** |
| `plugin/lib/client.js:455-457` | `window.__DSH_DESKTOP_PICK_DIRECTORY__` | Win32 Desktop 原生弹窗桥 | 未确证（两 tag 皆无） |
| `plugin/lib/client.js:55-62` | `window.parent.postMessage({type:'ldvh:navigate'})` | iframe 路由记忆（接收端是 better-sidebar） | 未确证（非 DSH 端） |
| `plugin/lib/session-signature.js:191-235` | `DSH_SESSION_JSONL` / `DSH_SESSION_ID` / `DSH_HOME` | shell 侧会话日志定位 | 未确证（`DSH_SESSION_JSONL` 两 tag 皆仅见归档笔记） |
| `plugin/web/src/**` | 无任何 `@deepseek-ai/*` import、无 `--dsh-*` token、无 `__DSH_BOOT__` | 自建 SPA，只走 `/ldvh` 路由与自建 `/api/cognition` | 兼容 |

---

#### 破坏性变更明细

##### 1.〔致命〕设置命名空间注册整体重构：`ctx.settings.register` / `installSection` 消失

**旧写法**（LDVH `plugin/lib/index.js:338`）：

```js
installSettingsSection(ctx, LDVH_SETTINGS_NAMESPACE, LDVH_SETTINGS_SCHEMA, {}, {
  setSource: (current) => { state.settingsSource = current; state.syncRoutes?.(); },
  onChange: () => { state.syncRoutes?.(); }
});
```

旧版基线（`dsh-v0.1.5-rc.2:packages/settings/settings/src/index.ts`）提供：

```ts
// :419
register<const Namespace extends string, T>(
  ns: Namespace & SettingsNamespaceInput<Namespace>,
  schema: z<T>,
  options?: SettingsRegisterOptions<T>,
): SettingsScope<T>

// :472
installSection<const Namespace extends string, T>(
  owner: Context, ns: ..., schema: z<T>, entry: T, hooks: SettingsSectionHooks<T>,
): void
```

**新写法**（`dsh-v0.1.7-rc.1:packages/settings/settings/src/index.ts`）：`SettingsForms`（:223）**没有 `register`，也没有 `installSection`**（`^  register|^  installSection` 计数为 0）。可用方法仅 `configure`(:266) / `describe`(:302) / `update`(:347) / `replace` / `mutate` / `writable` / `documentPath` / `prepareDocument`。

新版模型：命名空间 = **profile 里该插件的 Loader 条目 id**，schema = **插件自身的 Cordis `Config`**（`private schema(entry)`，:425-428：`entry.fiber?.runtime?.Config`）。`describe()` 对没有 Config 的条目直接 `return []`（:302-305 `const form = volatileForm(schema); if (form === undefined) return []`）。

**为什么现在才炸**：LDVH 的 `import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings"` 解析到的是**它自己 `node_modules` 里的 `@deepseek-ai/dsh-settings@0.1.0-rc.6`**（该版本 `lib/index.js:618,638` 仍导出这两个名字）。宿主包从 `dsh-v0.1.2-alpha.5` 起已移除自由函数（0.1.0-rc.7 有、0.1.2-alpha.1 有、0.1.2-alpha.5 起为 0），但 vendored 副本让旧基线仍能工作——它内部调用的 `sctx.settings.register(...)` 在 0.1.5-rc.2 存在。

**影响**：在新版，`SettingsForms` 上没有 `register`，vendored `installSettingsSection` 内部的 `sctx.settings.register(ns, schema, {...})` 抛 `TypeError`。该 throw 发生在 `ctx.inject(["settings"], cb)` 回调内（Cordis 的 `inject(inject, callback)` 等价于 `plugin({inject, apply: callback})`，见 `plugin/node_modules/@deepseek-ai/cordis/lib/index.js:1599-1605`，即**子 fiber**），因此 LDVH 的 `apply()` 本身不中断，但设置子 fiber 失败 → **`dsh-ldvh` 设置命名空间永不注册，插件设置面板消失**，`state.settingsSource` 恒为 `undefined`（`webEnabled` 回落默认 `true`，投放开关从此不可用）。

**替代方案**：删除 `installSettingsSection` 调用；在 `plugin/lib/index.js` 导出 `export const Config = z.object({webEnabled: ..., showInConversationTab: ..., showInSidebarTab: ...}).default({})`，并由 `apply(ctx, config)` 的 `config` 参数作为设置来源（新版 `describe()` 会从该 Config 自动生成表单）。

**证据路径**：
- `dsh-v0.1.7-rc.1:packages/settings/settings/src/index.ts:223,266,302,347,425`（新 API 全貌）
- `dsh-v0.1.5-rc.2:packages/settings/settings/src/index.ts:333,419,472`（旧 API）
- `dsh-v0.1.5-rc.2:packages/settings/settings-file/package.json` 存在 / `dsh-v0.1.7-rc.1` 下该路径 **不存在**（`fatal: path ... exists on disk, but not in 'dsh-v0.1.7-rc.1'`）；新版 `packages/settings/` 下仅剩 `settings/`
- `dsh-v0.1.7-rc.1:packages/settings/settings/src/index.ts:200-207`（`LEGACY_SECTION_ENTRIES` + `importLegacyDocument()`，:241-...：把 `settings.yaml` 改名 `.imported` 后逐段 `update(ns, values)` 导入 profile）
- `dsh-v0.1.7-rc.1:.agents/notes/implemented/architecture/2026-09-17-settings-pages-as-companion-packages.zh.md`（迁移决策）
- `plugin/node_modules/@deepseek-ai/dsh-settings/lib/index.js:618,638`（vendored 0.1.0-rc.6 仍导出旧函数）

##### 2.〔高〕client 设置服务改名：`ctx.settingsScope` → `ctx.configForms`

**旧写法**（`plugin/lib/client.js:962`）：

```js
var ldvhScope = ctx.settingsScope.bind({ namespace: "dsh-ldvh" });
```

旧版（`dsh-v0.1.5-rc.2:packages/client/ui-settings/src/client/settings-scope.ts:232` `class SettingsScopeBinder extends Service`，服务名 `settingsScope`；`bind<T>(spec: SettingsScopeSpec<T>): SettingsScope<T>`）。

**新写法**（`dsh-v0.1.7-rc.1:packages/client/ui-settings/src/client/config-form.ts:241` `class ConfigForms extends Service`，服务名 `configForms`）：

```ts
get<T>(entryId: string): ConfigForm<T>                                    // :284
whileServed(namespaces: readonly string[], register): () => void          // :317
describe(): SettingsDescribeFace                                          // :285
```

`bind({namespace})` → `get(ns)`；且 `ns` 语义从「插件自有设置命名空间」变成「**Host 插件条目 id**」。`ConfigForm` 的 `getSnapshot()` / `subscribe()` 与旧 `SettingsScope` 同形，但写入返回值由 `Promise<void>` 变为 `Promise<boolean>`。

**影响**：`ctx.settingsScope` 在新版不存在 → `ctx.settingsScope.bind(...)` 抛 `TypeError`。该行位于 LDVH `apply()` 的 `try { ... } catch (error) { console.error(...) }` 内，异常被**静默吞掉**（仅 console 输出），整个 client 半侧（设置卡 + 两个投放面 Tab）全部不注册。

**替代方案**：`ctx.configForms.get("dsh-ldvh")` + `ctx.configForms.whileServed(["dsh-ldvh"], served => ctx.slots.inject("plugins.item", () => ctx.slots.register({id:"dsh-ldvh", order:30}, Card)))`；并须先在 Host 半侧声明 `Config`（见第 1 条），否则命名空间永不被 serve。

**证据路径**：
- `dsh-v0.1.7-rc.1:packages/client/ui-settings/src/client/config-form.ts:241,284,317`
- `dsh-v0.1.7-rc.1:packages/client/ui-settings/src/client/config-form-types.ts:39-75`（`ConfigForm<T>` + `set` 返回 boolean）
- `dsh-v0.1.5-rc.2:packages/client/ui-settings/src/client/settings-scope.ts:232,268`
- `dsh-v0.1.5-rc.2:packages/client/ui-settings/src/client/settings-contract.ts:54-84`
- `git grep -ln settingsScope dsh-v0.1.7-rc.1 -- 'packages/client/'` → **0 个文件**

##### 3.〔高〕设置卡 slot 改名：`settings.plugin.item` → `plugins.item`

**旧写法**（`plugin/lib/client.js:968-974`）：

```js
ctx.slots.inject("settings.plugin.item", function () {
  return ctx.slots.register({
    name: "settings.plugin.item", key: "dsh-ldvh", priority: 30, inject: rowInjected
  }, LdvhSettingsCard);
});
```

旧声明：`dsh-v0.1.5-rc.2:packages/client/ui-settings-plugins/src/client/index.ts:164` → `{ 'settings.plugin.item': { kind: 'keyed', scope: 'root' } }`，按设置命名空间分键（`:100,104,37`）。

**新声明**：`dsh-v0.1.7-rc.1:packages/client/ui-plugin-manager/src/client/index.ts:91` → `'plugins.item': { kind: 'list', scope: 'root' }`；类型见 `packages/client/ui-plugin-manager/src/client/slot-contract.ts:88`。`settings.plugin.item` 在新版全树仅剩 1 处**注释性提及**（`packages/client/ui-settings-models/src/client/slot-contract.ts`），**无 slot 声明**。

**影响**：keyed slot 注册在新版无声明者渲染 → 设置卡不再出现。`kind` 由 `keyed` 变 `list`，注册选项字段也随之不同（旧 `key`，新 `id` + `label`）。

**替代方案**：注册进 `plugins.item`，通过 `ctx.configForms.whileServed([...])` 保证只在 Host serve 该命名空间期间存在（参考 `packages/client/ui-settings-shell/src/client/index.ts:50`、`ui-settings-agent-loop/src/client/index.ts:47`、`ui-settings-subagent/src/client/index.ts:85`）。

**证据路径**：
- `dsh-v0.1.5-rc.2:packages/client/ui-settings-plugins/src/client/index.ts:100,104,164`
- `dsh-v0.1.7-rc.1:packages/client/ui-plugin-manager/src/client/index.ts:91`、`slot-contract.ts:88`
- `git grep -ln "settings.plugin.item" dsh-v0.1.7-rc.1 -- 'packages/'` → 1 文件（注释）

##### 4.〔高〕`@deepseek-ai/dsh-client-ui-primitives` 图标整族改名

**旧写法**（`plugin/lib/client.js:25,846`）：

```js
var IconChevronDownOutline14 = primitives.IconChevronDownOutline14;
// ...
React.createElement(IconChevronDownOutline14, { size: 14 })
```

旧：`dsh-v0.1.5-rc.2:packages/client/ui-primitives/src/icons/index.tsx:161` `export const IconChevronDownOutline14`（整族 75 个导出，统一 `<名字><尺寸>` 后缀；`src/index.ts:73` `export * from './icons/index.tsx'` 全量再导出）。

新：该名字在 `packages/` 下 **0 处**。整族改为粗细后缀命名（186 个导出）：`IconChevronDownOutlineRegular`(:174) / `IconChevronDownOutlineMedium`(:179)，`src/index.ts:101` 仍全量再导出。

**影响**：`primitives.IconChevronDownOutline14` 在新版为 `undefined` → `React.createElement(undefined, ...)` 在渲染设置卡时抛 "Element type is invalid"，**设置卡渲染崩溃**（渲染期错误，不在 `apply()` 的 try/catch 覆盖范围内）。注意该图标名同样**未**从旧版 `ui-primitives` 的包索引导出过别名，故这是纯改名，需按新名替换。

**替代方案**：改用 `primitives.IconChevronDownOutlineRegular`（14px 语义等价）或 `...Medium`。

**证据路径**：
- `dsh-v0.1.5-rc.2:packages/client/ui-primitives/src/icons/index.tsx:161`、`src/index.ts:73`
- `dsh-v0.1.7-rc.1:packages/client/ui-primitives/src/icons/index.tsx:174,179`、`src/index.ts:101`
- `git grep -c "IconChevronDownOutline14" dsh-v0.1.7-rc.1 -- 'packages/'` → 空

##### 5.〔高〕`agent/session-start` 事件被移除

**旧声明**（`dsh-v0.1.5-rc.2:packages/core/agent/src/runtime-types.ts:316`）：

```ts
'agent/session-start'(this: Scoped<Agent>, payload: { agent: Agent; source: SessionStartSource }): void
```

**新版**：`agent/session-start` 在 `dsh-v0.1.7-rc.1` **全树 0 处**（仅存于 `.agents/notes/archived/**` 历史笔记）。`source: SessionStartSource` 被并入 `agent/created`（`packages/core/agent/src/runtime-types.ts:261`）：

```ts
'agent/created'(this: Scoped<Agent>, payload: { agent: Agent; source: SessionStartSource; signal?: AbortSignal }): undefined | Promise<undefined>
```

**LDVH 受影响的两处监听**：

- `plugin/lib/lifecycle.js:240-250`：`prime()` 预置 pre-step 通道（原语：每个 session-start 来源 startup/resume/clear/compact 都让下一个 step-1 重新评估），并重判 scope 写入 `sessionScopes`。
- `plugin/lib/child.js:119-125`：按父级最新判定刷新委派子代理的治理态（`record.applyParentScope(..., {source:"session-start"})`）。

**影响**：Cordis 事件按字符串派发，监听一个已不存在的事件**不报错、静默永不触发**——属于 fail-quiet（不是 fail-closed）：

- 根会话在 `resume` / `clear` / `compact` 后不再 prime，pre-step 的可见判定行可能在恢复会话的首个 step 丢失（`lifecycle.noticeText` 靠 assemble 更新，首轮 fallback 依赖 `lastScope`）；
- 子代理的委派治理态不再随父级判定移动刷新（`record.scopeState` 停在安装时/继承时值）。

`agent/created` 全局监听（`lifecycle.js:270`）与「收养已存活 agent」（`:275-277`）仍工作，故**工具与 hook 的安装不受影响**，损失的是 session-start 时刻的刷新语义。

**替代方案**：并入/改用 `agent/created`（其 payload 现有 `source: SessionStartSource`），按 `source` 区分 startup/resume/clear/compact；若需要「每次会话开始」而非「每次创建」，需在新版中另找语义等价点（本次核对**未确证**存在等价事件——`session/event` 的 `turn/end` 不是同一语义）。

**证据路径**：
- `dsh-v0.1.5-rc.2:packages/core/agent/src/runtime-types.ts:316,325`（`SessionStartSource` 定义）
- `dsh-v0.1.7-rc.1:packages/core/agent/src/runtime-types.ts:261`
- `git grep -ln "agent/session-start" dsh-v0.1.7-rc.1` → 仅 `.agents/notes/archived/**` 命中

##### 6.〔中〕`{kind:'plugin'}` 消息来源的 catch-all kind 取消，会话行 label 退化

**旧写法**（`plugin/lib/guidance.js:143-155`）：

```js
source: { kind: "plugin", plugin: LDVH_PLUGIN_SOURCE, form: "notice", summary }
```

旧契约（`dsh-v0.1.5-rc.2:packages/llm/llm/src/message.ts:104`）：

```ts
export interface MessageSourceMap {
  user: { kind: 'user' }
  plugin: { kind: 'plugin'; plugin: string } & ContextFormed   // ← 显式声明
  model: ModelMessageSource
  tool: ToolMessageSource
}
```

旧 client 投影（`dsh-v0.1.5-rc.2:packages/client/ui-chat/src/client/conversation-nodes/event-projection.ts:60-78` `contextProvenance`）含显式分支：

```ts
case 'plugin':
  return { role: 'inject', label: readString(record, 'plugin') ?? kind }
```

**新契约**（`dsh-v0.1.7-rc.1:packages/llm/llm/src/message.ts:103-115`）：

```ts
/**
 * Where a message (or injected content) came from ... Merge-extensible sum type — each producer declares its own
 * `kind` in its own module; there is no shared catch-all `plugin` kind.
 * Model and tool sources answer their role messages; user messages carry any
 * producer's kind, and consumers fall through unknown kinds.
 */
export interface MessageSourceMap {
  user: { kind: 'user' }
  model: ModelMessageSource
  tool: ToolMessageSource
  'system-prompt': SystemPromptMessageSource
}
```

新 client 投影（`dsh-v0.1.7-rc.1:packages/client/ui-chat/src/client/conversation-nodes/event-projection.ts:60-76` `contextProducer`，**已改名**）**删除了 `case 'plugin'`**，落入：

```ts
default:
  // MessageSourceMap is merge-extensible; keep an unknown producer visible by its durable kind.
  return { role: 'inject', label: kind }
```

**影响（分两层，须分清）**：

- **仍然工作**：`ContextForm` 的 `'notice'` 值、`form`/`summary` 字段、`ContextInjectionRow` 渲染路径与 `data-context-summary`（`packages/client/ui-chat/src/client/chat/ContextBody.tsx` 的 notice 分支两版**字节相同**：`:414,417,419,533,534,545,569,570,573`）。运行时 build-in 插件自己也仍在发 `{kind:'plugin', ...}`（`packages/context/time-context/README.zh.md:67`、`packages/guard/repeat-tool-reminder/README.zh.md:91`），所以行照旧出现、role 仍为 `inject`。
- **退化**：行头 producer label 由 **`dsh-ldvh`** 变成裸 kind **`"plugin"`**。LDVH 文档化的 UX「上下文注入 · dsh-ldvh · 本会话受 LDVH 管辖」（`guidance.js:126-142` 注释、`client.js` 相关文案）不再成立，显示为「上下文注入 · plugin · …」。

注意：新版 `ContextProducerView` 的文档字符串仍宣称 label 可取自「the plugin id」（`packages/client/ui-conversation/src/client/contract/context-producer.ts:19`），但实现未读取 `source.plugin`——**文档与实现不一致**，此处以实现为准。

**替代方案**：在 LDVH 侧无法单方面修好 label（实现里没有 plugin id 分支）。可选：(a) 接受 label 为 `plugin`；(b) 改用 `form:'snapshot'` + `sections[{name:'dsh-ldvh', text}]`（旧版 `ContextSnapshotSection` 两版同形，`message.ts:69-75`），让 producer 名走 section name；(c) 向 DSH 提 issue 恢复 plugin id 读取。

**证据路径**：
- `dsh-v0.1.5-rc.2:packages/llm/llm/src/message.ts:104`
- `dsh-v0.1.7-rc.1:packages/llm/llm/src/message.ts:103-115`
- `dsh-v0.1.5-rc.2:packages/client/ui-chat/src/client/conversation-nodes/event-projection.ts:60-78`
- `dsh-v0.1.7-rc.1:packages/client/ui-chat/src/client/conversation-nodes/event-projection.ts:60-76`
- `dsh-v0.1.7-rc.1:packages/client/ui-conversation/src/client/contract/context-producer.ts:14-23`

##### 7.〔中〕profile 插件模块解析机制改变（影响第三方插件的 client 半侧装载）

**旧**（`dsh-v0.1.5-rc.2:packages/client/AGENTS.md:139`）：「profile boots resolve bare row names through the healed `$DSH_HOME/profiles/node_modules` fallback, which mirrors the app's and each bundle's declared dependencies — a row whose package no manifest declares fails to import.」

**新**（`dsh-v0.1.7-rc.1:packages/client/AGENTS.md:141`）：「profile boots resolve bare row names through **the computed runtime resolution, which is installed as an interception on Node's resolvers** — a row whose package no manifest declares fails to import.」

**影响**：`plugin/cordis.patch.yml` 的 `name: 'dsh-ldvh'`（bare 包名行）在新解析机制下要求该包被某个 manifest 声明为依赖，否则 import 失败。`dsh.client` 声明本身的字段校验未变（`dsh-v0.1.7-rc.1:packages/client/modules/src/client/manifest.ts:162-186` `parseDshClient`：`platform` 必填 string，`inject`/`external` 可选 string 数组，`immediately` 可选 boolean；仍要求包有 `./client` 导出——LDVH 有 `"./client": "./lib/client.js"`）。

**判定理由与限度**：这是**文档级**证据（两侧 AGENTS.md 的措辞差异），我未逐行核对 resolver 实现，故判为「存在但语义变化」而**不是**确证的破坏；对 LDVH 的具体影响属**未确证**。

**证据路径**：`dsh-v0.1.5-rc.2:packages/client/AGENTS.md:139`；`dsh-v0.1.7-rc.1:packages/client/AGENTS.md:141`；`dsh-v0.1.7-rc.1:packages/client/modules/src/client/manifest.ts:162-186`；`dsh-v0.1.7-rc.1:packages/boot/app-boot/src/compatibility-preflight.ts:172-186`

##### 8.〔低〕`packages/settings/settings-file` 消失（与第 1 条同源，单独列出）

旧版存在 `packages/settings/settings-file`（`@deepseek-ai/dsh-settings-file`，file-backed settings provider，`settings.yaml`）；新版 `packages/settings/` 下**只剩 `settings/`**，该包路径 `fatal: path 'packages/settings/settings-file/package.json' exists on disk, but not in 'dsh-v0.1.7-rc.1'`（注："exists on disk" 指本地 `deepseek-harness` 工作树仍停在旧版 tag）。

新版由 `SettingsForms` 直接承担：`importLegacyDocument()`（`packages/settings/settings/src/index.ts:241-256`，在构造函数 `:235` 中经 `ctx.root.loader.await()` 触发）把 `$DSH_HOME/settings.yaml` 改名为 `settings.yaml.imported` 并逐段 `update(ns, values)` 导入 profile；`LEGACY_SECTION_ENTRIES`（`:201-207`）映射已删节的旧 section（如 `ui-developer-tools` → `ui-settings`、`ui-onboarding` → `ui-settings-general`、`shell` → `bash-sandbox`/`pwsh-sandbox`）。

LDVH 不直接 import 该包，故**不构成直接破坏**；但它意味着「设置以 `settings.yaml` 为事实源」的假设已失效——LDVH 若有任何外部脚本/文档依赖 `settings.yaml` 中 `dsh-ldvh` 段，需改为 profile 文档。本次核对**未在 LDVH 中发现对 `settings.yaml` 的引用**。

---

#### 无法确证项

以下各项**无法**从两个 tag 的证据中判定为兼容或破坏，明确列出，不作猜测：

1. **`betterSidebar` 服务**（`plugin/lib/client.js:985-1006`，`ctx.inject(["betterSidebar"])` → `betterSidebar.registerTab({id, title, icon, order, single, component})`）
   这是第三方服务（对应 DSH 生态的 `dsh-better-sidebar` 类插件），**不在 `deepseek-harness` 仓库内**。它在 `dsh-v0.1.7-rc.1` 下是否仍提供 `registerTab`、`tabProps.scope` 形状是否变化、以及是否随 DSH 运行时重构而失效，本仓库无从查证。LDVH 对它是软注入（服务缺失即跳过），故最坏后果是侧边栏投放面消失而非插件失败。

2. **`window.__DSH_DESKTOP_PICK_DIRECTORY__` 桥**（`plugin/lib/client.js:455-457`）
   `git grep -c "DSH_DESKTOP_PICK" dsh-v0.1.5-rc.2` 与 `dsh-v0.1.7-rc.1` **均为空**；旧版 `apps/desktop/src/preload-app.ts:5` 只暴露 `dshDesktop`，新版改为暴露 `__DSH_DIRECTORY_PICKER__`(`:39`)、`__DSH_HOST_PATHS__`(`:45`)、`dshDesktopBoot`(`:48`)、`dshPlatform`(`:52`)、`dshDesktop`(`:63`)。因此该全局在**两个 tag 中都不存在**；若它由本仓库之外的 Desktop 构建注入，我无法核对。**两版皆失效**，不构成升级引入的回归；LDVH 会静默落到第 ③ 梯级 `remote.directoryPicker.pick()`（该梯级已确证兼容）。

3. **`@deepseek-ai/schemastery ^3.18.1`**
   `plugin/lib/index.js:30` 与 `:78-88` 使用 `z.object(...).default({})`。schemastery 是独立发布的包，**不在本次两个 tag 的核对范围内**（DSH 仓库以 `workspace:~` 引用）。其 `.default({})` 语义在新版 DSH 所解析到的版本上是否一致，未核。

4. **`DSH_SESSION_JSONL` 环境变量**（`plugin/lib/session-signature.js:191-235`，shell 侧会话日志定位，配合硬编码 `session.v3.jsonl.zstd`）
   `DSH_SESSION_JSONL` 在两个 tag 中**仅见于 `.agents/notes/archived/**` 归档笔记**，未见于 `packages/` 任何产码。`DSH_SESSION_ID`（旧 11 文件 / 新 12 文件）与 `DSH_HOME`（旧 104 / 新 107）在两版均存在。因此 `DSH_SESSION_JSONL` 是否为当前 DSH 真实注入的变量**未确证**；日志文件名 `session.v3.jsonl.zstd` 在 `packages/session/session-persistence-jsonl/README.md:65` 仍被记为当前格式，但命名由 `logSuffix()` 拼装（`format.ts:40-42` 两版同形），LDVH 是硬编码拼接——该硬编码在两版的**一致性未确证**（我未核对 session 目录名的拼装来源）。

5. **`sessionPersistence.locate(agent.session.header)` 的公开性**（`plugin/lib/session-signature.js:93,170`）
   `locate` 在 `packages/session/session-persistence-jsonl/src/index.ts` 中两版均为 `private`（旧 `:293` / 新 `:299`），LDVH 用可选调用 `sessionPersistence.locate?.(...)` 依赖 TS `private` 只是编译期约束。运行时两版都可调用，故判为**兼容**；但它**不是公开契约**，未来任何重构可无预警移除。是否属于"可依赖的宿主缝"未确证。

6. **`agent/session-start` 的语义等价替代**
   新版把 `source: SessionStartSource` 并入 `agent/created`（`runtime-types.ts:261`），但 `agent/created` 是**创建**语义、`agent/session-start` 是**每次会话开始**语义（startup/resume/clear/compact）。是否存在触发时机等价的新事件，本次核对**未确证**（`session/event` 的 `turn/end` 与 `agent/turn-stopping` 都不是同一时机）。

7. **Cordis 子 fiber 抛错的确切外部表现**
   第 1 条中「`apply()` 不中断、仅设置子 fiber 失败」这一结论基于 `ctx.inject(inject, callback)` ≡ `ctx.plugin({inject, apply: callback})`（`plugin/node_modules/@deepseek-ai/cordis/lib/index.js:1599-1605`）以及 Cordis 对子 fiber 错误的常规处理。我**未**逐行核对 Cordis 的错误捕获与上报路径，故「插件其余部分照常加载」这一具体表现的严重度定级保留 ±1 档的不确定性；但**「设置命名空间不会注册」**这一结论由 `SettingsForms` 无 `register` 方法直接确证，不受此影响。

8. **`dsh.client` 第三方插件装载路径的实际可用性**
   第 7 条仅证实**文档措辞**变化与 manifest 校验器字段未变。第三方插件（非 `packages/client/**`）在新解析机制下能否被 `dsh.client` 行正确装载，需实机安装验证，本次核对**未确证**。

---

#### 复核方法备注

- 所有「兼容」判定均要求两侧源码片段一致或仅新增可选成员；凡只见文档、只见历史笔记、或只见外部包者，一律进「未确证」。
- 逐字一致（byte-identical）的三个服务：`packages/runtime-diagnostics/invariants/src/index.ts`、`packages/interaction/user-questions/src/index.ts`（154 行）。
- 近似一致：`packages/host/webserver/src/index.ts`（仅 2 处非语义 diff：`multipart/form-data` 判断 + 类型断言去 `as unknown`）、`packages/util/atomic-write/src/index.ts`（仅 Windows EPERM 单次重试）、`packages/util/home-paths/src/index.ts`（仅新增 `dshCachePath`）。
- 本次核对**未修改** DSH 仓库工作树/索引，**未修改** LDVH 仓库任何文件。

# 附录 B：运行时能力数据表（0.1.7-rc.1 实测）

> 采集方式：`cordis_inspect_query`（host/Service、host/Event、client/Slots），采集时间 2026-09-25，宿主为已安装的 `0.1.7-rc.1`。

## B.1 宿主服务表（88 个 `ctx.*`）

| # | ctx 服务 | 职责 | 公开方法数 |
|---|---|---|---|
| 1 | `ctx.agentDefaultModel` | Owns the default model selection independently of any Host or transport. | 2 |
| 2 | `ctx.agentLoop` | Concrete agent factory and driver service. | 4 |
| 3 | `ctx.agentPresets` | Registry of YAML-declared presets and the revisions live Agents retain. | 13 |
| 4 | `ctx.agents` | Agent service (`ctx.agents`): tracks live agents and carries the initiating Agent through one process-local asynchronous driver chain. | 14 |
| 5 | `ctx.agentTeams` | Agent Teams service backed by the exact live Lead Session log. | 11 |
| 6 | `ctx.approval` | Approval service that applies session policy before answerers and logs every ask/outcome pair to the requesting session. | 3 |
| 7 | `ctx.attachments` | Immutable binary attachment service. | 14 |
| 8 | `ctx.authorization` | `ctx.authorization`: a registry of credential-obtaining flows, one attempt at a time per key. | 5 |
| 9 | `ctx.browserUse` | Owns one optional provider registration in the shared browser-use service. | 1 |
| 10 | `ctx.clientModules` | The web plugin table service: incremental `dsh.client` scan + wire composition + bundle route + index injection rows. | 7 |
| 11 | `ctx.commands` | Human-command registry. | 5 |
| 12 | `ctx.compaction` | Abstract compaction service. | 3 |
| 13 | `ctx.computerUse` | Owns one optional provider registration in the shared computer-use service. | 1 |
| 14 | `ctx.configEditor` | Persist complete raw configs and apply them through the normal Loader path. | 3 |
| 15 | `ctx.connection` | Host `ctx.connection` members consumed by transport-independent adapters. | 8 |
| 16 | `ctx.credentials` | Abstract credential service over two key spaces that answer two questions. | 9 |
| 17 | `ctx.credentialsController` | Host service backing the generated `ctx.remote.credentials` namespace. | 3 |
| 18 | `ctx.deepseekAccount` | Account operations; only Host consumers can obtain a request credential. | 9 |
| 19 | `ctx.deepseekLlmApiExtensions` | Registry of independently owned top-level fields for official DeepSeek requests. | 2 |
| 20 | `ctx.directoryPicker` | Abstract directory-picking service. | 1 |
| 21 | `ctx.directoryPickerController` | Host service backing the generated `ctx.remote.directoryPicker` namespace. | 3 |
| 22 | `ctx.fileReferences` | Host capability for cancellable file-reference discovery. | 1 |
| 23 | `ctx.fileUploads` | Host service owning upload storage and Agent-scoped staged receipts. | 6 |
| 24 | `ctx.fs` | Abstract filesystem provider. | 15 |
| 25 | `ctx.goals` | Goal service (`ctx.goals`) backed exclusively by the owning session log. | 10 |
| 26 | `ctx.hmr` | Hot reload service with Cordis-compatible module configuration and events. | 5 |
| 27 | `ctx.inspector` | Shared Host/Client service façade over the realm's source publisher. | 2 |
| 28 | `ctx.invariants` | Package-owned invariant registry with global and regex-based selection. | 1 |
| 29 | `ctx.jobController` | Host service backing the generated `ctx.remote.job` namespace. | 3 |
| 30 | `ctx.jobs` | Abstract background job registry. | 10 |
| 31 | `ctx.llm` | The abstract `llm` service: an adapter registry plus a streaming model-call API, interceptable via the `llm/stream` waterfall. | 15 |
| 32 | `ctx.lsp` | The LSP capability seam (`ctx.lsp`). | 2 |
| 33 | `ctx.mcpResources` | Scoped resource access plus three tools shared by configured MCP servers. | 1 |
| 34 | `ctx.messageFeedback` | Session-log service; cold operations never construct a Session or Agent. | 3 |
| 35 | `ctx.officeToPdf` | A provider lifetime owns all converters, queued calls, and temporary files. | 4 |
| 36 | `ctx.permissionPresets` | Owns the deployment's configured permission presets, the fixed Auto integration hook, and their write path. | 6 |
| 37 | `ctx.planMode` | `ctx.planMode`: owns logged plan state, applies and narrates selected state at step start, the `plan:policy` section, the `/plan` command, and the stable exit tool. | 2 |
| 38 | `ctx.pluginManager` | Manage profile files and apply their declared reload lifecycle. | 12 |
| 39 | `ctx.pluginRegistryProbe` | Compares public registry responses on the Host; the Client owns the initial selection. | 1 |
| 40 | `ctx.productTelemetry` | Host analytics sender. | 1 |
| 41 | `ctx.profileContext` | Current profile facts; scheduling and mutation belong to their callers. | 4 |
| 42 | `ctx.ptcRuntime` | Registers one `ctx.ptcRuntime` implementation. | 4 |
| 43 | `ctx.sandbox` | Abstract process-sandbox service. | 1 |
| 44 | `ctx.sandboxPolicy` | The sandbox-policy service (`ctx.sandboxPolicy`). | 4 |
| 45 | `ctx.sessionController` | Host service backing the generated `ctx.remote.session` namespace. | 21 |
| 46 | `ctx.sessionFeedback` | Host Remote through which a product surface records a Session-level remark. | 1 |
| 47 | `ctx.sessionFileReferences` | Host Remote adapter over the composed file-reference provider. | 1 |
| 48 | `ctx.sessionPersistence` | Durable append-only session storage addressed through per-session handles. | 6 |
| 49 | `ctx.sessionProjectionCache` | The persisted projection cache service. | 5 |
| 50 | `ctx.sessionProjections` | `ctx.sessionProjections`: the projection unit table and its drive. | 11 |
| 51 | `ctx.sessionQuery` | Unified live-preferred session query service. | 15 |
| 52 | `ctx.sessionReferenceResolver` | Exact-read consumer that prepares immutable cross-session message context. | 3 |
| 53 | `ctx.sessions` | In-memory session store (`ctx.sessions`). | 9 |
| 54 | `ctx.sessionSkillCatalog` | Host service backing `ctx.remote.skills` without activating a cold Agent. | 1 |
| 55 | `ctx.sessionTelemetry` | Loadable form of the backend contract: one implementation per context — the cordis `Service` registration under the `telemetry` key throws on a duplicate, cordis' standard behavior. | 4 |
| 56 | `ctx.sessionTitle` | Log-backed title fold plus asynchronous fallback generation. | 4 |
| 57 | `ctx.settings` | Project Config schemas into forms and own optional instance-level UI policy. | 6 |
| 58 | `ctx.settingsController` | Host service backing the generated `ctx.remote.settings` namespace. | 5 |
| 59 | `ctx.shell` | Abstract bash execution service. | 2 |
| 60 | `ctx.shellEnv` | Registry (`ctx.shellEnv`) for trusted, per-execution `DSH_*` variables. | 3 |
| 61 | `ctx.skills` | Layered registry of skill providers, the host+per-scope shape the tools registry established. | 5 |
| 62 | `ctx.speechController` | Speech calls never activate or submit to an Agent. | 6 |
| 63 | `ctx.speechToText` | Registry shared by all transcription consumers in one Host composition. | 9 |
| 64 | `ctx.spillStore` | Abstract spill storage service. | 1 |
| 65 | `ctx.ssh` | One non-reconnecting SSH session; loss invalidates all active operations. | 4 |
| 66 | `ctx.storage` | The storage hub service. | 3 |
| 67 | `ctx.storageDomain` | The mounted domain facility. | 3 |
| 68 | `ctx.subagentModelSelection` | Singleton settings owner read when delegation tools are composed for a Session. | 1 |
| 69 | `ctx.subagents` | Named provider registry with one-shot runs, durable discovery, and continuable-child operations. | 14 |
| 70 | `ctx.subprocess` | Abstract subprocess service. | 4 |
| 71 | `ctx.systemPrompt` | Registry service for the prompt inputs assembled before each model step. | 8 |
| 72 | `ctx.terminalController` | Typed Remote control of transient Session-owned terminal processes. | 10 |
| 73 | `ctx.terminals` | In-process registry for replaceable PTY backends and exact-Agent sessions. | 9 |
| 74 | `ctx.timer` | Disposable timer helpers mixed into Cordis contexts. | 6 |
| 75 | `ctx.tokenMeter` | Replay owner for one service-wide estimator and isolated per-session folds. | 2 |
| 76 | `ctx.toolResultPruner` | Deterministic head/middle/tail pruning for current tool-result surface nodes. | 4 |
| 77 | `ctx.tools` | Tool registry and execution pipeline. | 8 |
| 78 | `ctx.typert` | Registry of generated schemas, package reflection, invocations, and Remote dependency providers. | 7 |
| 79 | `ctx.typertGateway` | Resolve strict generated definitions or conservative SRC markers against current Cordis Services and Typert providers. | 4 |
| 80 | `ctx.userQuestions` | `ctx.userQuestions`: validation plus the scoped answerer waterfall. | 1 |
| 81 | `ctx.web` | The web access service. | 4 |
| 82 | `ctx.webhookRuntime` | Fire-and-forget rule runtime. | 2 |
| 83 | `ctx.webServer` | The browser HTTP carrier service. | 7 |
| 84 | `ctx.workflowEngine` | Workflow Service Definition contract. | 1 |
| 85 | `ctx.workspaceChanges` | Serves the summaries and file comparisons the recorder keeps for live Sessions. | 2 |
| 86 | `ctx.workspaceController` | Host service backing the generated `ctx.remote.workspace` namespace. | 11 |
| 87 | `ctx.workspaceFiles` | Host Remote file reads and workspace directory observations over the composed filesystem. | 5 |
| 88 | `ctx.workspaceRegistry` | Durable workspace registry. | 11 |

## B.2 事件差异表（79 行，含 mode 与新旧判定）

| 事件 | mode | 0.1.7-rc.1 | 0.1.5-rc.2 | 判定 |
|---|---|---|---|---|
| `agent-loop/config-start-failed` | emit | ✅ | ✅ | ✅ 未变 |
| `agent-preset/selected` | emit | ✅ | ✅ | ✅ 未变 |
| `agent/assistant-stream` | emit | ✅ | ✅ | ✅ 未变 |
| `agent/created` | serial | ✅ | ✅ | ⚠️ mode 变更 |
| `agent/disposed` | emit | ✅ | ✅ | ✅ 未变 |
| `agent/error` | emit | ✅ | ✅ | ✅ 未变 |
| `agent/inbox/claimed` | emit | ✅ | ✅ | ✅ 未变 |
| `agent/inbox/discarded` | emit | ✅ | ✅ | ✅ 未变 |
| `agent/inbox/inserted` | emit | ✅ | ✅ | ✅ 未变 |
| `agent/pre-step` | waterfall | ✅ | ✅ | ✅ 未变 |
| `agent/request` | waterfall | ✅ | ✅ | ✅ 未变 |
| `agent/request-error` | waterfall | ✅ | ✅ | ✅ 未变 |
| `agent/session-start` | emit | — | ✅ | ❌ 已移除 |
| `agent/status` | emit | ✅ | ✅ | ✅ 未变 |
| `agent/turn-stopping` | serial | ✅ | ✅ | ✅ 未变 |
| `api-session/activity` | emit | ✅ | ✅ | ✅ 未变 |
| `api-session/added` | emit | ✅ | ✅ | ✅ 未变 |
| `api-session/error` | emit | ✅ | ✅ | ✅ 未变 |
| `api-session/removed` | emit | ✅ | ✅ | ✅ 未变 |
| `api-session/status` | emit | ✅ | ✅ | ✅ 未变 |
| `app-boot/config-reload` | emit | ✅ | — | 🆕 新增 |
| `approval/request` | waterfall | ✅ | ✅ | ✅ 未变 |
| `authorization/settled` | emit | ✅ | ✅ | ✅ 未变 |
| `commands/change` | emit | ✅ | ✅ | ✅ 未变 |
| `compaction/summary-error` | waterfall | ✅ | — | 🆕 新增 |
| `connection/request` | waterfall | ✅ | — | 🆕 新增 |
| `cordis/dynamic-package` | emit | ✅ | ✅ | ✅ 未变 |
| `cordis/dynamic-retract` | emit | ✅ | ✅ | ✅ 未变 |
| `cordis/inspect-query` | emit | ✅ | ✅ | ✅ 未变 |
| `cordis/inspect-query-resolved` | emit | ✅ | ✅ | ✅ 未变 |
| `cordis/request-run` | emit | ✅ | ✅ | ✅ 未变 |
| `cordis/request-run-resolved` | emit | ✅ | ✅ | ✅ 未变 |
| `credentials/record-updated` | emit | ✅ | ✅ | ✅ 未变 |
| `credentials/reference-updated` | emit | ✅ | ✅ | ✅ 未变 |
| `domain/changed` | emit | ✅ | ✅ | ✅ 未变 |
| `feedback/committed` | parallel | ✅ | ✅ | ✅ 未变 |
| `fs/edit-intent` | waterfall | ✅ | ✅ | ✅ 未变 |
| `fs/observed` | emit | ✅ | ✅ | ✅ 未变 |
| `fs/write-intent` | waterfall | ✅ | ✅ | ✅ 未变 |
| `goal/activation-changed` | emit | ✅ | ✅ | ✅ 未变 |
| `goal/changed` | emit | ✅ | ✅ | ✅ 未变 |
| `hmr/change` | emit | ✅ | — | 🆕 新增 |
| `hmr/reload` | emit | ✅ | — | 🆕 新增 |
| `llm/adapters-updated` | emit | ✅ | ✅ | ✅ 未变 |
| `llm/stream` | waterfall | ✅ | ✅ | ✅ 未变 |
| `permission-presets/catalog-changed` | emit | ✅ | — | 🆕 新增 |
| `plugin-manager/changed` | emit | ✅ | — | 🆕 新增 |
| `plugin-manager/install-log` | emit | ✅ | — | 🆕 新增 |
| `plugin-manager/install-state` | emit | ✅ | — | 🆕 新增 |
| `session-telemetry/record` | waterfall | ✅ | ✅ | ✅ 未变 |
| `session/created` | emit | ✅ | ✅ | ✅ 未变 |
| `session/disposed` | emit | ✅ | ✅ | ✅ 未变 |
| `session/event` | emit | ✅ | ✅ | ✅ 未变 |
| `session/flush` | parallel | ✅ | ✅ | ✅ 未变 |
| `settings/document-updated` | emit | ✅ | ✅ | ✅ 未变 |
| `settings/updated` | emit | — | ✅ | ❌ 已移除 |
| `skills/change` | emit | ✅ | ✅ | ✅ 未变 |
| `subagent/end` | emit | ✅ | ✅ | ✅ 未变 |
| `subagent/provider-added` | emit | ✅ | ✅ | ✅ 未变 |
| `subagent/provider-removed` | emit | ✅ | ✅ | ✅ 未变 |
| `subagent/start` | emit | ✅ | ✅ | ✅ 未变 |
| `system-prompt/assemble` | waterfall | ✅ | ✅ | ✅ 未变 |
| `system-prompt/change` | emit | ✅ | ✅ | ✅ 未变 |
| `tools/change` | emit | ✅ | ✅ | ✅ 未变 |
| `tools/execute` | waterfall | ✅ | ✅ | ✅ 未变 |
| `tools/post-execute` | waterfall | ✅ | ✅ | ✅ 未变 |
| `tools/pre-execute` | waterfall | ✅ | ✅ | ✅ 未变 |
| `tools/ptc-dispatch-log` | waterfall | ✅ | ✅ | ✅ 未变 |
| `tools/result` | emit | ✅ | ✅ | ✅ 未变 |
| `user-questions/request` | waterfall | ✅ | ✅ | ✅ 未变 |
| `webserver/index-inject` | emit | ✅ | ✅ | ✅ 未变 |
| `workflow/agent-end` | emit | ✅ | ✅ | ✅ 未变 |
| `workflow/agent-start` | emit | ✅ | ✅ | ✅ 未变 |
| `workflow/end` | emit | ✅ | ✅ | ✅ 未变 |
| `workflow/log` | emit | ✅ | ✅ | ✅ 未变 |
| `workflow/phase` | emit | ✅ | ✅ | ✅ 未变 |
| `workflow/start` | emit | ✅ | ✅ | ✅ 未变 |
| `workspace/session-activity` | waterfall | ✅ | — | 🆕 新增 |
| `workspace/session-stop` | parallel | ✅ | — | 🆕 新增 |

## B.3 客户端 Slot 表（92 个）

| Slot | kind | scope | replaceRisk | 用途 |
|---|---|---|---|---|
| `root` | single | root | shadows-shipped-ui | The built-in render-tree root hole (seeded by SlotCore): the one slot the shell itself renders, and the ancestor of every other seat. |
| `main` | keyed | root | shadows-shipped-ui | Central panel selected by sidebar entry id. |
| `plugins.bundle.config` | keyed | root | shadows-shipped-ui | A bundle's own configuration, keyed by the bundle's package name and rendered on the bundle's page between its description and its rows (`view: 'page'` only). |
| `plugins.detail.actions` | list | root | none | Controls at the head of a detail page, before the page's own switch and uninstall, rendered with the page's subject. |
| `plugins.header.leading` | single | root |  |  |
| `plugins.overview` | list | root |  |  |
| `plugins.bundle.hidden` | keyed | root |  |  |
| `plugins.item.hidden` | keyed | root |  |  |
| `plugins.bundle.actions` | keyed | root |  |  |
| `plugins.item` | list | root | none | One official plugin the Plugins page lists in its Official group after the official bundles: `label` is the card's title and `order` its place. |
| `plugins.bundle.activation` | keyed | root | shadows-shipped-ui | Optional guidance after the user enables a bundle from the list, keyed by npm package name. |
| `plugins.row.config` | keyed | root | none | The configuration of one row a bundle declares, keyed by `<package name>#<row id>` with the row id as the bundle's patch declares it: the row on the bundle's page gains a configure control that opens the entry's page, headed by the plugin's display title and description. |
| `plugins.detail.badge` | list | root | none | Tags beside a detail page's title, after the version, beta, and problem tags the page draws itself, rendered with the page's subject. |
| `plugins.detail.section` | list | root | none | Sections under a detail page's own content: after the rows on a bundle's page, after the configuration on a row's or an official plugin's page. |
| `main.conversation` | single | session-maybe | shadows-shipped-ui | Conversation shell beneath its root-scoped main-panel entry. |
| `conversation.header` | single | session-maybe | shadows-shipped-ui | Resident navigation container, including when no Session is selected. |
| `conversation.header.leading` | single | root | none | Global navigation before the Session title, available without a Session. |
| `conversation.session.header` | single | session | shadows-shipped-ui | Strict per-Session title, actions, and View navigation. |
| `conversation.session.header.actions` | list | session | none | Title-adjacent Session actions in ascending order. |
| `conversation.session.header.utilities` | list | session | none | Right-aligned Session utilities in ascending order. |
| `conversation.session.header.corner` | single | session | shadows-shipped-ui | The header's far-right corner, past the utilities' edge and into the header's own padding, for one control. |
| `conversation.session.header.lineage` | single | session | shadows-shipped-ui | Optional replacement for one Session breadcrumb title. |
| `shell.overlay` | list | root | none | Frame-wide floating layer, above every column and outside their scroll containers. |
| `sidebar` | single | root | shadows-shipped-ui | The whole left column. |
| `sidebar.brand.mark` | single | root | shadows-shipped-ui | Brand mark rendered in the expanded brand row and collapsed rail. |
| `sidebar.footer.action` | list | root | none | Optional actions beside Settings at the sidebar foot. |
| `sidebar.panellist` | list | root | none | Global panel icons. |
| `sidebar.toggle.badge` | single | root | shadows-shipped-ui | Non-interactive notification inside the collapsed sidebar expand button. |
| `sidebar.settings` | single | root | shadows-shipped-ui | The settings seat at the sidebar foot. |
| `settings.section` | list | root | none | One settings page per list entry. |
| `settings.general.item` | list | root | none | One preference row inside the General section — the additive seat for a single setting that needs no page of its own (a whole page is `settings.section`), contributed by the feature plugin that owns the preference (locale → Language, ui-theme → Appearance, ui-conversation → Composer Enter). |
| `settings.plugins.tab` | list | root | none | One page inside the Plugins settings section. |
| `settings.models.provider-card` | keyed | root | none | One provider card's adapter extension area, dispatched with `entryKey = settingsNs` on every card that renders a directory row: a saved row's card (its first-run setup posture included) and the add-provider draft card. |
| `settings.models.footer` | list | root | none | Ordered extension area after the provider rows and the add controls. |
| `settings.onboarding` | list | root | none | Root-scoped onboarding steps contributed by settings features. |
| `settings.models.sign-in` | single | root | shadows-shipped-ui | Optional account login choice before the credential editor. |
| `settings.trigger` | single | root | shadows-shipped-ui | The sidebar-foot trigger row content: icon + label, supplied as slot content (the accessible name comes from the content — rail state renders the label visually hidden). |
| `settings.header` | single | root | shadows-shipped-ui | The panel title text seat. |
| `settings.action` | list | root | none | Optional actions rendered in the content-column header before Close. |
| `settings.close` | single | root | shadows-shipped-ui | The close button's visually-hidden label text (the button itself — icon, geometry, focus — is shell chrome). |
| `settings.launcher` | single | root | shadows-shipped-ui | Optional sidebar account launcher; opens the shell-owned settings panel. |
| `sidebar.workspaces` | single | root | shadows-shipped-ui | The workspace/session browsing region: section header, search, the grouped/flat session list, and every workspace dialog. |
| `sidebar.workspaces.session.menu.item` | list | root | none | The rows of one Session's "..." menu, in ascending `order`. |
| `sidebar.workspaces.session.row.action` | list | root | none | The hover buttons at the end of one Session row, in ascending `order`, after the "..." menu trigger. |
| `sidebar.workspaces.directoryFlow` | single | root | shadows-shipped-ui | Directory-flow hole under the sidebar browsing region (declared by the WorkspaceBrowser entry). |
| `sidebar.brand.name` | single | root | shadows-shipped-ui | Brand name rendered beside the expanded mark. |
| `rightbar` | single | root | shadows-shipped-ui | The right column: a track the centre makes room for, or nothing. |
| `rightbar.session` | single | session | shadows-shipped-ui | Session content selected by the root-scoped right Sidebar controller. |
| `sidebar.right.pane.tab` | keyed | session | none | One tab's body, dispatched with the `id` of the type in force for `tab.kind`. |
| `sidebar.right.tab.document.actions` | list | session | none | Header toolbar contributions acting on the previewed file, rendered after the preview's own controls once the file's Host path is known. |
| `sidebar.right.tab.document.unpreviewable` | list | session | none | Empty-state contributions for a file this preview cannot render, offered where Retry would stand once the file's Host path is known. |
| `deliverables.review.file.actions` | list | session | none | The same file actions owned by a changed-file review tab. |
| `sidebar.right.tab.guide.entry` | keyed | session | none | One provider's guide card, with the standard card as the owner's fallback. |
| `sidebar.right.tab.guide` | chain | session | none | The guide tab's body. |
| `sidebar.right.tab.document` | keyed | session | none | Document body selected by a registered implementation id. |
| `sidebar.right.tab.document.office.pdf` | keyed | session | none | PDF presentation supplied with Office-owned converted bytes. |
| `sidebar.right.tab.document.action` | keyed | session | none | Renderer-specific controls before the document toolbar's reload button. |
| `sidebar.chat.conversation` | single | session | shadows-shipped-ui | Session-scoped Conversation occurrence hosted by one Sidebar chat tab. |
| `sidebar.right.pane.tab.title` | keyed | session | none | A tab's title as its chip (and a floating panel's header) shows it, dispatched with the same key and information hook as the body. |
| `sidebar.right.tab.menu.item` | list | session | none | Extra items at the end of one tab's actions menu, in registration order. |
| `shell.leading` | single | root | shadows-shipped-ui | Window-chrome seat at the frame's top-left, over every main panel. |
| `factory:conversation.content` | factory | session-maybe |  |  |
| `conversation.composer` | chain | session | none | Selector-routed replacements for the current Session's resident composer. |
| `conversation.approval.detail` | single | session | shadows-shipped-ui | Optional detail for the Tool call correlated with an approval request. |
| `conversation.plan-review.actions` | list | session | none | Actions for the exact plan under review; approval remains with the question composer. |
| `conversation.hero.workspace` | single | root | shadows-shipped-ui | Workspace picker shown by the blank-session Hero. |
| `conversation.hero.workspace.directoryFlow` | single | root | shadows-shipped-ui | Directory-flow hole under the conversation empty-state picker (declared by the WorkspacePicker entry). |
| `conversation.session` | single | session | shadows-shipped-ui | Strict per-Session Conversation body. |
| `conversation.view` | list | session | none | Registered Conversation target Views, rendered one at a time. |
| `conversation.chat.node` | keyed | session | shadows-shipped-ui | Final Chat node renderer, keyed by `ChatNodeKind`. |
| `tool.call.toolview` | keyed | session | shadows-shipped-ui | Keyed Tool call view dispatched by wire Tool name. |
| `tool.call.images` | single | session | shadows-shipped-ui | Durable images of a settled image-bearing Tool call, rendered through the attachment presentation plugin. |
| `tool.view.cordis` | keyed | session | none | Interactive Package-owned region rendered inside the latest eligible `cordis_run` card in the conversation flow. |
| `conversation.chat.assistant-actions` | list | session | none | Ordered actions for one finalized assistant message. |
| `conversation.chat.commandview` | keyed | session | none | Command row keyed by the command name. |
| `conversation.chat.turnTail` | list | session | none | Ordered feature contributions before a completed Turn's action row. |
| `deliverables.file.actions` | list | session | none | Open one file through its authorized Session event coordinates. |
| `conversation.message.images` | single | session | shadows-shipped-ui | Renderer for one consecutive group of durable message images. |
| `conversation.trajectory.images` | single | session | shadows-shipped-ui | Renderer for one group of durable record images in the Trajectory ledger. |
| `conversation.composer.bar` | single | session-maybe | shadows-shipped-ui | Resident composer body, including the no-Session inert state. |
| `conversation.input.attachments` | single | session-maybe | shadows-shipped-ui | Optional draft-attachment rail and drop target. |
| `conversation.input.overlay` | list | session | none | Floating entries rendered inside the resident composer card. |
| `conversation.input.permission` | single | session | shadows-shipped-ui | Current-session permission control inside the composer tool row. |
| `conversation.input.left` | list | session | none | Compact controls at the left of the composer tool row. |
| `conversation.input.plan` | single | session | shadows-shipped-ui | Plan control inside the composer tool row. |
| `conversation.input.right` | list | session | none | Compact controls before the composer submit action. |
| `conversation.input.model` | single | session | shadows-shipped-ui | Model selector inside the composer tool row. |
| `conversation.input.activity` | single | session | shadows-shipped-ui | Compact action after the model selector; it can expand across the toolbar while retaining the editor and submit action. |
| `conversation.composer.dock` | list | session | none | Ambient entries below the composer card. |
| `conversation.input.dock` | list | session | none | Full-width entries above the composer card. |
| `conversation.hero.brand.mark` | single | root | none | Brand mark shown before the blank-session headline. |
| `conversation.hero.agentPreset` | single | session-maybe | shadows-shipped-ui | Agent-preset control staged for a New Session. |
