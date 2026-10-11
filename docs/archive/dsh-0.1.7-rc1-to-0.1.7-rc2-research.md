# DSH 0.1.7-rc.1 → 0.1.7-rc.2 变更调研报告

> **对比对象**：`@deepseek-ai/dsh` `0.1.7-rc.1` → `0.1.7-rc.2`
> **数据源**：同级仓库 `/Users/dmh2002/DshProject/deepseek-harness`（`deepseek-ai/deepseek-harness`），git tag `dsh-v0.1.7-rc.1`（`46a7f68b09`，2026-09-23 21:03:33 +0800）与 `dsh-v0.1.7-rc.2`（`477b4f4205`，2026-09-24 21:39:59 +0800）；官方 GitHub Release 发布说明；npm registry 元数据；以及**本机运行中宿主**（`/Applications/DSH NEXT.app`，app `dsh-desktop-next@2.0.15-next`，其 153 个 `@deepseek-ai/dsh-*` 依赖全部为 `0.1.7-rc.2`）
> **调研日期**：2026-09-26
> **范围口径**：**全量**——rc.2 相对 rc.1 的全部变更清单（Human 裁定，2026-09-26）
> **变更规模**：区间 **346 commits**（224 非 merge）；全仓 3429 files `+136,313 / −24,518`；工作区包数 307 → 312
> **方法**：git 双标签只读差分；对**官方生成式目录**（服务/事件/类型/槽位/工具/配置/持久化）做机械化集合与签名比对；官方发布说明对照；12 条并行取证线，逐条经主控复核与冲突裁决
>
> **勘误（2026-09-26）**：①§6.4 的锁约束对象原记为「事实源目录」，实为**管辖登记载体所在的 DSH 用户配置根**——该包的 `withFileLock`/`writeFileAtomic` 只写 `$DSH_HOME/ldvh/governed-projects.yaml`，事实源 `ldvh-base/` 不经该包（8 个 fact writer 各自无锁原子替换）；②「153 个 dsh 包」原挂在 `node_modules` 上，实为宿主 `package.json` 的**声明依赖数**，`node_modules/@deepseek-ai` 下实测为 **275 个 `dsh*` 包**（版本同为 rc.2）。受控事实对象 `c8746b85-daf2-4191-aa37-d005d1fbdecd` 已同步勘误。

---

## 0. 阅读指引与证据分级

本报告证据分三级，正文以标记区分：

- **【机械】**：对官方**生成物**做集合/签名/哈希级比对所得，可逐字复现（最强——这些文件带 CI 新鲜度门禁，与源码同源同步）。
- **【源码】**：git 差分与源码/README/决策记录原文（强，代表发布内容）。
- **【运行时】**：本机运行中宿主（`0.1.7-rc.2`）的实读观察。

**判定口径**：`ctx.<name>` = Cordis `Service` 公开服务名；事件 = `api-catalog.ts` 声明的 listener 契约（含 `mode`）；「默认是否可用」以 **bundle patch 的行状态**为准（不是包的声明，也不是决策记录的叙述）。

**引用闭环**：正文关键声明后附 `[E#]` 编号，逐字引文、来源与精确锚点集中在 **§10 证据库**；`[E#]` 只指向证据库，不在正文复制引文。三态标注：**confirmed**（有来源支持）/ **uncertain**（线索不足，见 §8.1）/ **gap**（未获取，见 §8.2）。

---

## TL;DR（先看结论）

| # | 结论 | 性质 | 对 dsh-ldvh 的影响 |
|---|---|---|---|
| 1 | **会话持久化面基本静止**：`SESSION_FORMAT_VERSION` 仍为 `4`，无 v4→v5；持久化根 **62 → 62 零增删** `[E2][E5]` | 无变化 | **无需任何数据面动作**；本区间不是又一个「单向门」 |
| 2 | **宿主公开服务零删除、事件零删除**：服务 88 → 89（+`schedule`）`[E6]`，事件 77 → 81（+4，全为 `emit`）`[E8]`，既有事件 `mode` **零变化** | 增量 | LDVH 消费的 8 个事件、12 个服务全部仍在且形态未变 |
| 3 | **客户端槽位零删除**：86 → 89（+3 纯新增）`[E9][E10]` | 增量 | LDVH 注册的 `conversation.chat.node`、`conversation.view` 未受影响 |
| 4 | **`@deepseek-ai/dsh-llm-deepseek` 被拆包改名**：`→ dsh-llm-deepseek-api-key` + 新增 `dsh-llm-deepseek-account` `[E13]` | **破坏性（组合面）** | 不直接击中 dsh-ldvh，但**击中本机 profile 里依赖该包名的第三方插件** |
| 5 | **`ctx.deepseekAccount` 四个方法签名破坏性变更**：`getProfile/getBalance/signOut` 由无参改为必填 `client: AccountClientMetadata`，`startSignIn` 首参由 `locale` 改为 `client`；**无兼容层** `[E7]` | **破坏性** | LDVH 未消费该服务 → 不击中；但消费它的插件会编译/运行期失败 |
| 6 | **工具动态更新机制落地**：新增 `Session.toolHistory()` 与 `ToolHistory`/`ToolUpdate`；`request/header.tools` 记录有效工具并以 `developer/message` 表达增删 | 增量（能力面） | 解释「进行中的对话可直接使用新启用的工具」；LDVH 的 `tools.register` 无需改动 |
| 7 | **`dsh-atomic-write` 新增「已退出持有者锁接管」**：读 `<pid>` 记录，对 `ESRCH` 持有者接管锁 `[E18]` | 行为变更 | ⚠️ **击中 LDVH**：`governed-projects.js` 用 `withFileLock`/`writeFileAtomic` `[E19]`；**明确不支持**跨宿主/跨 PID namespace 共享文件 |
| 8 | **审批面新增本地化字段**：`PreToolDecision.ask` 与 `ApprovalRequestEvent` 新增 `displayReason?`（可见语义） | 向后兼容的新增 | LDVH 的 `tools.guard` 返回字符串拒绝，不受影响；可用它提升审批可读性 |
| 9 | **权限预设 Auto 由 `never` 改为 `ask`**：Auto 现为 `danger-full-access` + `ask`（并兼容 `never`）`[E29]` | 行为翻转 | 影响 LDVH 的 Human Gate 语境：**越权动作会回到用户审批**，不再静默放行 |
| 10 | **schedule 默认关闭**（`schedule` / `time-context` / `ui-schedule` 三行均 `disabled: true`）`[E14][E15]`，且**官方决策记录与代码不一致** `[E16][E17]` | 配置面 | 无需动作；但**不可信决策记录的叙述**，必须以 patch 行为准 |
| 11 | **官方发布说明存在且完整**（中文/英文四节），是本区间的权威全量清单 `[E27]` | 证据源 | 后续同类调研应**先取 GitHub Release**，再回源码取证 |
| 12 | **本机宿主已在 rc.2 上运行 LDVH**（app 2.0.15-next，其声明依赖 153 个 `@deepseek-ai/dsh*`、实测 275 个 `dsh*` 包全为 rc.2）`[E32]` | 运行时 | 这是 LDVH 兼容 rc.2 的**强旁证**（但按 `specs/08 §8`，不等于「已验证支持」） |

**一句话**：rc.1→rc.2 是一个**以产品面与组合面为主、宿主公开契约近乎只增不改**的小版本；真正的破坏面集中在**账号服务签名**与**LLM 适配器拆包**两处，dsh-ldvh 恰好都不消费——**它对 LDVH 的直接冲击只有两处：`atomic-write` 锁接管语义与审批本地化字段**。

---

## TL;DR 索引：已证实声明（confirmed）

以下 22 条（C1–C22）为本报告的**已证实声明索引**。每条均有 `[E#]` 证据支撑（来源、逐字引文与锚点见 §10 证据库），且与正文对应章节逐字一致。判定为 `confirmed` 的三项条件（`specs/30 §10.1`）均满足：来源为长期可访问的 HTTP(S) URL 或已确认存在的文档、逐字摘录已入证据库并标注锚点、质量分级明确。

| # | 已证实声明 | 证据 | 正文 |
|---|---|---|---|
| C1 | 区间为 346 commits（224 非 merge）、3429 files `+136,313 / −24,518` | `[E1]` | §1.1 |
| C2 | 会话格式版本在 rc.1 与 rc.2 同为 `4`，无 v4→v5 迁移 | `[E2]` | §2.5 |
| C3 | 持久化变更记录标记 `decision: same-version`，且兼容性说明为「旧日志无 title 仍可解码」 | `[E3][E4]` | §2.5 |
| C4 | 持久化根 62 → 62（零增删），可达类型定义 577 → 577，变化仅限 schedule 域 | `[E5]` | §2.5 |
| C5 | 宿主服务 88 → 89，唯一新增 `schedule`，无删除 | `[E6]` | §2.1 |
| C6 | `ctx.deepseekAccount` 四个方法首参改为必填 `client: AccountClientMetadata`，无兼容层 | `[E7]` | §2.1 |
| C7 | 宿主事件 77 → 81，新增 4 项全为 `emit`，无删除、无 mode 变化 | `[E8]` | §2.2 |
| C8 | 客户端槽位 86 → 89，新增 3 项，无删除、无 kind/scope 变更 | `[E9][E10]` | §2.3 |
| C9 | 模型可见 Tool 唯一净变化为 `+schedule_update`，无工具删除 | `[E11]` | §2.4 |
| C10 | `dsh-llm-deepseek` 被移出 base/sdk-minimal 默认组合，由 api-key 与 account 两包取代（包本身仍在） | `[E13]` | §3.1 |
| C11 | rc.2 上 `schedule` / `time-context` / `ui-schedule` 三行均 `disabled: true`，README 明示默认禁用 | `[E14][E15]` | §3.2 |
| C12 | 官方决策记录 `2026-09-24-web-default-schedule-composition` 在 rc.2 上仍写「leaves ui-schedule enabled」，与实际装配相反 | `[E16][E17]` | §3.3 |
| C13 | `dsh-atomic-write` 新增已退出持有者锁接管，且明确不支持跨宿主/跨 PID namespace | `[E18]` | §6.4 |
| C14 | LDVH 经 `governed-projects.js` 直接消费 `withFileLock` / `writeFileAtomic` | `[E19]` | §6.4 |
| C15 | LDVH 消费的 8 个宿主事件在 rc.2 全部存在且 mode 未变 | `[E8][E20]` | §6.2 |
| C16 | LDVH 注册的 `conversation.chat.node` / `conversation.view` 槽位在 rc.2 未被删除或改名 | `[E10][E21]` | §6.1 |
| C17 | 权限预设 Auto 由 `danger-full-access + never` 改为 `+ ask`（并兼容 `never`） | `[E29]` | §4.3 |
| C18 | LDVH 的 peer 范围 `>=0.1.7-rc.1 <0.2.0` 已覆盖 `0.1.7-rc.2` | `[E30]` | §6.6 |
| C19 | 生成式目录门禁由 `docSyncLeafGates()` 编排，并被 `ciPrimaryGates()`/`ciStaticGates()` 引入 CI | `[E26]` | §1.4 |
| C20 | 官方 Release 说明存在且完整（中英四节），`prerelease: true`、非 draft | `[E27]` | §1.2 |
| C21 | npm `dist-tags.next` 指向 `0.1.7-rc.2`，发布时间 `2026-09-24T14:18:11.337Z` | `[E28]` | §1.3 |
| C22 | 本机宿主 `DSH NEXT.app` 为 `2.0.15-next`，其声明依赖 153 个 `@deepseek-ai/dsh*`、实测 275 个 `dsh*` 包全为 `0.1.7-rc.2` | `[E32]` | §1.3、§6.6 |

未列入本表的实质结论均为 **uncertain**（§8.1）或 **gap**（§8.2），不构成已证实声明。

---

## 1. 版本、范围与环境基线

### 1.1 版本序列与区间规模【源码】

| tag | 日期 | 提交 | 说明 |
|---|---|---|---|
| `dsh-v0.1.7-rc.1` | 2026-09-23 21:03:33 +0800 | `46a7f68b09` | **基线** |
| `dsh-v0.1.7-rc.2` | 2026-09-24 21:39:59 +0800 | `477b4f4205` | **本次目标**（与已安装宿主一致） |

区间：**346 commits**（224 非 merge）；**3429 files**，`+136,313 / −24,518`；新增 565 文件、删除 17 文件。

提交类型分布（非 merge，含少数标题未结构化者）：

| 类型 | 数量 | 类型 | 数量 |
|---|---|---|---|
| `fix` | 117 | `docs` | 14 |
| `test` | 36 | `chore` | 4 |
| `feat` | 26 | `revert` | 3（+2 标题式 revert） |
| `refactor` | 14 | `build` | 3 |

按模块改动量前 10：

| 模块 | 文件 | + | − |
|---|---|---|---|
| `packages/client` | 875 | 46,782 | 3,902 |
| `.agents/notes` | 681 | 16,731 | 2,965 |
| `snapshots/session` | 171 | 4,359 | 2,211 |
| `apps/web` | 144 | 6,164 | 431 |
| `apps/desktop` | 96 | 4,995 | 364 |
| `docs/subsystems` | 91 | 2,537 | 512 |
| `packages/experimental` | 82 | 1,683 | 275 |
| `packages/llm` | 81 | 2,711 | 477 |
| `packages/api` | 62 | 1,025 | 263 |
| `packages/schedule` | 43 | 8,352 | 3,163 |

### 1.2 官方权威变更源（本区间的正确入口）【源码】

**该仓根目录没有 `CHANGELOG`**（实读核对）。版本变更语义由三处承载，且**只有第一处是本区间的全量产品清单**：

1. **GitHub Release 发布说明**——`dsh-v0.1.7-rc.2` 有**完整中英文四节说明**（✨新增 / 🐛修复 / ⚠️调整 / 🎨优化），`prerelease: true`、`draft: false`、`published_at: 2026-09-24T14:10:21Z`、`reactions.total_count: 243`。**这是本报告全量分线的官方对照基准。**
2. **`docs/persistence-changes/`**——带 `schemaVersion` 的日期化持久化变更记录（含 `.schema.json`），本区间新增 1 份（见 §3.2）。
3. **`.agents/notes/`**——决策记录（Agent Note），本区间新增 26 份、修改 30 份（英文正文计）。

> **方法教训**：本区间绝大多数 `.agents/notes` 改动（566 个 `.i18n.yaml` + 114 个 `.md`）是**双语配对元数据刷新**，不是决策内容变化。**只读 `.md` 会误判改动规模；只读 i18n.yaml 会误判有实质决策。** 判定「有无实质决策」须看 `.md`→`.zh.md` 正文对。

### 1.3 npm 与运行环境基线【源码】【运行时】

**npm registry**（`https://registry.npmjs.org/@deepseek-ai/dsh`）：

```
dist-tags: { latest: "0.1.5-rc.3", alpha: "0.1.7-alpha.2", next: "0.1.7-rc.2" }
```

`0.1.7-rc.2` 发布时间 `2026-09-24T14:18:11.337Z`（先 tag、后 publish：Release `14:10:21Z` → npm `14:18:11Z`）。

**本机运行中宿主**：`/Applications/DSH NEXT.app` = `dsh-desktop-next@2.0.15-next`，其 `dependencies` 中 **153 个 `@deepseek-ai/dsh-*` 全部为 `0.1.7-rc.2`**。实测存在且版本一致的关键包：

| 包 | 版本 | 包 | 版本 |
|---|---|---|---|
| `dsh-host-webserver` | 0.1.7-rc.2 | `dsh-llm-deepseek-api-key` | 0.1.7-rc.2 |
| `dsh-client-ui-primitives` | 0.1.7-rc.2 | `dsh-llm-deepseek-account` | 0.1.7-rc.2 |
| `dsh-client-ui-conversation` | 0.1.7-rc.2 | `dsh-schedule` | 0.1.7-rc.2 |
| `dsh-atomic-write` | 0.1.7-rc.2 | `dsh-client-shortcuts` | 0.1.7-rc.2 |

> ⚠️ 与上一份调研（`docs/dsh-0.1.5-rc2-to-0.1.7-rc1-research.md`）所载基线**已漂移**：该报告的 `DSH Desktop.app 2.0.14 / 0.1.7-rc.1 / desktop+web profile` 在本机已不存在，现为 `DSH NEXT.app 2.0.15-next / 0.1.7-rc.2`。**按旧报告的复现路径在当前环境下不成立。**

### 1.4 官方生成物：本报告的主要机械化证据源【机械】

DSH 仓内置**生成式目录**，由脚本从源码 AST / 运行时装配产出，并经 CI **新鲜度门禁**强制与源码同步。它们比人工阅读源码更可靠，因为「源码搜得到」与「声明的是这个契约」常不一致：

| 生成物 | 生成脚本 | 新鲜度门禁 | 覆盖 |
|---|---|---|---|
| `packages/extensions/tool-cordis/src/api-catalog.ts` | `scripts/gen-cordis-api.ts` | `verify-cordis-api` | **服务** + **事件**（含 mode/signature） + **类型** |
| `packages/extensions/cordis-client-runner/src/client/api-catalog.ts` | `gen-client-catalog.ts` | `verify-client-catalog` | **客户端服务** |
| `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` | 同上 | 同上 | **客户端槽位**（kind/scope/键域） |
| `docs/tool-catalog.md` | `gen-tool-catalog.ts` | `verify-tool-catalog` | **模型可见 Tool**（真实 boot 后读 `ctx.tools.schemas()`） |
| `docs/config-catalog.md` | `gen-config-catalog.ts` | `verify-config-catalog` | **每个插件的 Config 声明** |
| `docs/persistence-catalog.md` | `gen-persistence-catalog.ts` | `verify-persistence-catalog` | **持久化根 + 可达类型指纹**（SHA-256） |

**各生成物的脚本与门禁名**见表 `[E22]`。**门禁确实在 CI 主路径中**（已逐行核验，非推断）`[E26]`：这些 `verify-*` 由 `scripts/run-gates.ts` 的 `docSyncLeafGates()` 统一编排，而该函数**同时被 `ciPrimaryGates()`（`run-gates.ts:381`）与 `ciStaticGates()`（`:479`）引入** `[E26]`，对应 `package.json` 的 `check:ci` / `check:ci:static`，并由 `.github/workflows/ci.yml` 实际调用（`pnpm run check:ci:static` 等）。

> **一处更正（对取证线的裁决）**：子代理曾报告「`verify-*` 未出现在 `.github/workflows`，故不在 CI」——这是**误判**：工作流只调用聚合入口 `check:ci:*`，具体门禁在 `run-gates.ts` 内部展开，**不能以「workflow 文件里搜不到门禁名」推断门禁不存在**。仅 `verify-translation-pairing` / `verify-archived-agent-notes` 额外挂在 `lefthook.yml`（提交前钩子）。

---

## 2. 宿主公开契约面：逐维机械化比对

### 2.1 服务：+1 新增，**0 删除**，4 处签名变更【机械】

**服务总数 88 → 89。** `[E6]` 新增唯一一项：

| 服务 | 摘要（逐字） |
|---|---|
| `schedule` | `Shared management service; reads, deletion, and timing edits never activate a Session.` |

**删除：0。** 方法数变化仅两处服务：

| 服务 | 方法数 | 新增/变更 |
|---|---|---|
| `deepseekAccount` | 9 → 12 | 见 §2.5（破坏性） |
| `sessionController` | 21 → 22 | `+ @Remote async initializeDefaultModel(): Promise<void>` |

**全部 4 处签名级变更（逐字前后对比）：**

```diff
  // ctx.deepseekAccount —— 破坏性
- abstract getProfile(): Promise<AccountDetails['profile'] | null>
+ abstract getProfile(client: AccountClientMetadata): Promise<AccountDetails['profile'] | null>
- abstract getBalance(): Promise<AccountDetails['balance'] | null>
+ abstract getBalance(client: AccountClientMetadata): Promise<AccountDetails['balance'] | null>
- abstract startSignIn(locale: string, callbackOrigin: string, loginSource: 'web' | 'desktop'): Promise<AccountView>
+ abstract startSignIn(client: AccountClientMetadata, callbackOrigin: string, loginSource: 'web' | 'desktop'): Promise<AccountView>
- abstract signOut(): Promise<AccountView>
+ abstract signOut(client: AccountClientMetadata): Promise<AccountView>
+ abstract getUnnotifiedBonuses(client: AccountClientMetadata): Promise<AccountBonusBatch | null>
+ abstract ackBonusNotified(accountId: AccountUserId, orderId: AccountBonusOrderId, client: AccountClientMetadata): Promise<boolean>
+ abstract rejectToken(token: string): Promise<void>

  // ctx.workspaceController —— 破坏性（参数移除）
- @Remote('initializeDefault') async initializeDefault(request: WorkspaceInitializeDefaultRequest, signal: AbortSignal): Promise<WorkspaceValue | undefined>
+ @Remote('initializeDefault') async initializeDefault(signal: AbortSignal): Promise<WorkspaceValue | undefined>

  // ctx.workspaceRegistry —— 破坏性（回调返回类型简化）
- initializeDefault(resolveDirectory: () => Promise<{ path: string; title: string }>): Promise<Workspace | undefined>
+ initializeDefault(resolveDirectory: () => Promise<string>): Promise<Workspace | undefined>
```

配套的类型面：`WorkspaceInitializeDefaultRequest` **被删除**；新增 `AccountClientMetadata`、`AccountBonusBatch`、`AccountBonusNotification`、`AccountBonusOrderId`、`ScheduleUpdate*`、`ToolHistory`、`ToolUpdate` 等 98 个类型定义，删除 10 个。

> **账户签名变更无兼容层**：`AccountClientMetadata`（`{ version, locale, timezoneOffsetSeconds }`）是**新增必填类型**，基线不存在；仓库内调用点已全部改写。**任何直接调 `ctx.deepseekAccount.getProfile()` 等旧签名的插件将编译/运行期失败，必须改为传入 `client` 元数据对象**；`startSignIn` 的 `locale` 参数被移除，语言信息改由 `client.locale` 承载。

### 2.2 事件：+4 新增，**0 删除**，既有事件 **mode 零变化**【机械】

**事件总数 77 → 81。** `[E8]` 新增 4 项，**全部为 `emit`**：

| 事件 | mode | 类别 |
|---|---|---|
| `deepseek-account/model-sign-in-required` | emit | 账户 |
| `deepseek-account/session-expired` | emit | 账户 |
| `deepseek-account/signed-out` | emit | 账户 |
| `schedule/changed` | emit | 日程 |

**删除 0；`mode` 变化 0。** 这直接否证了「本区间有事件模式退化」的猜测。

> **与上一份调研的对比**：`0.1.5-rc.2 → 0.1.7-rc.1` 区间删除过 `agent/session-start` 并把 `agent/created` 由 `emit` 改为 `serial`——那类**静默失效**是本区间**没有**发生的破坏形态。

### 2.3 客户端槽位：+3 新增，**0 删除/改名**【机械】

**槽位总数 86 → 89。** `[E9][E10]` 新增：

| 槽位 | kind | scope |
|---|---|---|
| `shell.quota-notice` | `chain` | `root` |
| `sidebar.session.row.leading` | `list` | `root` |
| `sidebar.session.row.hover` | `list` | `root` |

**删除 0；kind/scope 变更 0。** 另有多处**契约能力扩充（非键级变化）**，例如 `sidebar.right.tab` 新增 `bindCommands`/`refreshShortcut`、`settings.launcher` 新增 `settingsOpen`/`settingsShortcut`、`conversation.composer.bar` 新增 `stopShortcut`、`approval` 新增 `displayReason`/`answerable`。

**客户端服务目录 8 → 8，零增删改名**：`layout`、`locale`、`sessions`、`slots`、`theme`、`timer`、`uiWorkspace`、`workspaces`。

> 注意：`configForms` / `uiConversation` / `betterSidebar` **本就不在**客户端服务目录中（前者由 `@deepseek-ai/dsh-client-ui-settings` 侧提供、`uiConversation` 由 `ui-conversation` 内部 `super(ctx, 'uiConversation')` 提供、`betterSidebar` 属第三方），因此「目录里没有」不等于「不可用」。**判定客户端接缝只有服务目录与 Slot 拓扑两条路**（服务缺失是静默失效：`inject` 未满足则 `apply` 不执行）。

### 2.4 Tool 与 Config：+1 工具，Config 面 4 增 1 删【机械】

**模型可见 Tool**：30 个工具包**零增删**；工具名净变化仅 **`+schedule_update`**（`@deepseek-ai/dsh-schedule`）`[E11]`。**无任何工具被删除。**

**Config 目录**：140 → 143 个插件条目。

- **新增 4**：`dsh-client-shortcuts`、`dsh-llm-deepseek-account`、`dsh-llm-deepseek-api-key`、`dsh-schedule`（后者含 `deliveryHistoryDays?` / `deliveryHistoryRecords?`）
- **删除 1**：`dsh-llm-deepseek`（由上述 account/api-key 两包取代）
- **`inject`/`Requires` 变更 0**：**没有任何插件的服务依赖集发生变化**
- **Config 声明实质变化 6**：

| 插件 | 变化要点（逐字） |
|---|---|
| `dsh-agent-preset-registry` | **移除** `modeSelectionEnabled: Volatile<boolean>`（「原独立模式选择开关移除」） |
| `dsh-session-log-deepseek` | **新增** `maxBytes?: number` —— `Largest serialized dsh_session_log field, in UTF-8 bytes, that one request carries. ... Defaults to 8 MiB.`；`enabled` 仍 `Defaults to 'true'`（**隐私默认值未再翻转**） |
| `dsh-time-context` | `refreshIntervalMs` 语义由「省略/0 = 每步注入」改为 **默认 600000 ms（10 分钟）** |
| `dsh-client-ui-settings-account` | `Config` 由 `{contactFormUrl, contactSource}` 扩为 `extends ContactConfig`，新增奖励确认重试与 onboarding 字段 |
| `dsh-deepseek-account-platform` | 字段集合未变 |
| `dsh-llm-replay` | **新增** `toolUpdate?: ToolUpdate` —— `Optional mid-conversation tool declaration mode for a keyless replay route.`（与 §4.1 第 4 项「工具动态更新」同主题，供测试重放路由声明该能力）`[E12]` |

> 说明：上表 6 项为 **Config 代码块**（`Config` 接口声明）发生实质变化者；`dsh-llm-replay` 的 `source` 链接行同时被补上（rc.1 该行缺失），故集合比对与代码块比对须分别进行——只比集合会漏掉字段新增。

### 2.5 持久化：**根零增删，格式版本未再升级**【机械】

**`SESSION_FORMAT_VERSION = 4`** —— rc.1 与 rc.2 **同值**（`packages/core/session/src/types.ts`）。格式目录迁移链止于 `sessionFormatV3ToV4`，**不存在 v4→v5**。

**持久化根：62 → 62** `[E5]`，仅 **1 条** 哈希变化：

```diff
- | `event:schedule/change` | event | `2a7f86849ae54b3398ee49661a757c4fcb59a6192b7036ee2ff514617e13fb42` |
+ | `event:schedule/change` | event | `a0a2e5c42e1c929445ecd1cd70f49be6b66441894ec72c08e8ae332821d4a3cb` |
```

**可达持久化类型定义：577 → 577**，变化**全部限于 schedule 域**：

- **改名 4 对**：`ScheduleRecord`→`LegacyScheduleRecord`、`AfterScheduleRecord`→`LegacyAfterScheduleRecord`、`AtScheduleRecord`→`LegacyAtScheduleRecord`、`EveryScheduleRecord`→`LegacyEveryScheduleRecord`（各新增 `title: optional string`）
- **哈希变化 3**：`ScheduleChange`、`ScheduleCreateChange`、`{ type: "schedule/change" }`

对应官方持久化变更记录 `docs/persistence-changes/2026-09-18-schedule-optional-title.md`：

```yaml
baseline: false
changes:
  - root: "event:schedule/change"
    previous: "2026-09-11-initial"
    after: "a0a2e5c42e1c929445ecd1cd70f49be6b66441894ec72c08e8ae332821d4a3cb"
    decision: same-version
```

兼容性原文（逐字）：

> A version-1 Session event written before titles existed has no title member, so those logs decode and fold without one instead of being refused. ... The Host task record still requires the member: the storage decoder rejects a stored task without it, and creation, update, and the schedule tools still require it.

**判定**：`baseline: false` = 未作为格式基线变更；`decision: same-version` = **同版本内向后兼容，无需迁移**。这是**内部事件层放宽**，与**工具层收紧**方向相反且不冲突（见 §4.3）。

> **结论：rc.1→rc.2 没有发布级持久化格式变更。** `docs/persistence-changes/releases/` 最新只到 `dsh-v0.1.5-rc.2`（无 rc.1/rc.2 发布文档），与上述机械结论一致。

### 2.6 整包面：+5 新包，**0 删除**【源码】

**工作区包数 307 → 312。** `[E31]` 新增：

| 包 | 描述（逐字） |
|---|---|
| `@deepseek-ai/dsh-client-shortcuts` | `Application keyboard command registry and physical-key routing` |
| `@deepseek-ai/dsh-client-ui-shortcuts` | `Keyboard shortcut reference, recording, and local preference editing` |
| `@deepseek-ai/dsh-llm-deepseek-account` | `DeepSeek account provider authentication and discovery` |
| `@deepseek-ai/dsh-llm-deepseek-api-key` | `DeepSeek api-key provider authentication and discovery` |
| `@deepseek-ai/dsh-util-code-language` | `Single file-extension to syntax-highlighting language table shared by Client cod…` |

**删除：0。** 被删除的 17 个文件全部是脚本文档示例，**无整包消失**（见 §5.2）。

---

## 3. 组合与默认装配：本区间的主战场【源码】

> **判定纪律**：本仓「默认是否可用」**必须同时看三处 patch**——`bundle/base` + `bundle/web-app` + `bundle/web-app/presets/*`。只看 base 会系统性误判；只看决策记录会读到与代码相反的话（§3.3 即为一例）。本区间 `presets/{cordis,minimal,ptc,standard}.patch.yml` **零 diff**。

### 3.1 LLM 适配器拆包（base + sdk-minimal）

`packages/bundle/base/cordis.patch.yml`：

```diff
     - id: llm-deepseek
-      name: '@deepseek-ai/dsh-llm-deepseek'
+      name: '@deepseek-ai/dsh-llm-deepseek-api-key'
+
+    - id: llm-deepseek-account
+      name: '@deepseek-ai/dsh-llm-deepseek-account'
```

`packages/bundle/sdk-minimal/cordis.patch.yml` 同步改为 `dsh-llm-deepseek-api-key`；两 bundle 的 `package.json` 依赖同步替换。

**⚠️ 一处易误判的更正**：`packages/llm/llm-deepseek` 这个**包本身在 rc.2 仍然存在**（版本 `0.1.7-rc.2`），只是**不再被 base/sdk-minimal 的 patch 引用**。因此这不是「npm 包被删除」，而是「**默认组合不再装载该包名**」。

**后果**：任何在 profile patch 或用例里**按 `@deepseek-ai/dsh-llm-deepseek` 包名引用**它的部署/插件，在 rc.2 上要么装载失败，要么装载了一个不再被 base 支持的包。**这是本区间对第三方组合面最实际的破坏点。** 官方发布说明的对应条目：「账号任务与 API Key 任务使用独立的模型入口」。

### 3.2 web-app：新增四行，其中三行默认关闭

```diff
+    # Durable Host-wide reminders. ...
+    - id: time-context
+      name: '@deepseek-ai/dsh-time-context'
+      disabled: true
+
+    - id: schedule
+      name: '@deepseek-ai/dsh-schedule'
+      disabled: true
...
+    - id: shortcuts
+      name: '@deepseek-ai/dsh-client-shortcuts'
+
+    - id: ui-shortcuts
+      name: '@deepseek-ai/dsh-client-ui-shortcuts'
```

| 行 | rc.2 状态 |
|---|---|
| `time-context` | **`disabled: true`** |
| `schedule` | **`disabled: true`** |
| `ui-schedule` | **`disabled: true`**（注释改写，状态维持） |
| `shortcuts` / `ui-shortcuts` | 无 `disabled` → **默认启用** |

`web-app/package.json` 相应新增 `dsh-schedule`、`dsh-time-context`、`dsh-client-shortcuts`、`dsh-client-ui-shortcuts` 依赖，并把 `@deepseek-ai/libreoffice-kit` 由 `^0.1.0` 升到 `^0.1.1`。

### 3.3 ⚠️ 官方决策记录与实际装配**不一致**（重要陷阱）

`.agents/notes/implemented/architecture/2026-09-24-web-default-schedule-composition.md` 的 Decision 段（rc.2 标签上仍是这段文字）逐字写着：

> `packages/bundle/web-app/cordis.patch.yml` inserts `time-context` and `schedule` in its Host row list **and leaves `ui-schedule` enabled**; ... The `web` profile consequently ships the Automation tasks page, ... and `schedule_create`, `schedule_list`, `schedule_update`, and `schedule_delete` on every live root Agent.

但 rc.2 的实际状态相反。经落地时序核验：

| 提交 | 时间 | 内容 |
|---|---|---|
| `e896737840` | 09-24 16:11 | `feat(schedule): ship Schedule in the default Web composition` |
| `cad6fef2fd` | 09-24 **20:27** | `feat(web): disable shipped schedule and time context plugins` ← **推翻上一提交** |
| `374b9cc1fb` | 09-24 20:41 | `test(web): align shipped composition fixtures with disabled scheduling` |
| `f9564a0d48` | 09-24 20:55 | 合并 PR #5175 |
| `787b746b80` | 09-24 **21:24** | `release(dsh): 0.1.7-rc.2` |

`cad6fef2fd` **是 rc.2 tag 的祖先**（机械核验 `git merge-base --is-ancestor` 通过）。

**权威判定以 patch 与 README 为准**——`packages/bundle/web-app/README.md`（rc.2）逐字：

> The shipped composition disables `schedule`, `ui-schedule`, and `time-context` by default.

官方发布说明亦印证：「**Web 和桌面端默认关闭定时任务与时间上下文，需要时可手动启用。**」

> **方法教训（对 LDVH 有普适价值）**：`.agents/notes/implemented/` **只保证「记录与实际交付同步」是纪律，不保证它已做到**。在本区间，同一份记录的内部叙述被同日更晚的提交推翻而未同步更新。**判定默认可用性必须读 patch（机械真相），不可读决策记录（语义叙述）。**

### 3.4 `apps/cli` 与实验能力

- **删除** `apps/cli/config/examples/schedule/cordis.yml`——该 opt-in overlay 的功能已并入 `web-app` 默认 patch；**保留会造成 `insert` 列表 id 重复挂载**（`applyEntryPatches` 不去重）。CLI 命令面（`dsh plugin` / profile / install）**未见破坏性移除**。
- `OPTIONAL_BUNDLES` 由 2 项增至 3 项，新增 `@deepseek-ai/dsh-experimental-auto-review`；`experimental/inspector` 改造为可安装 bundle（patch 由相对路径改为包名）但**不**进 `OPTIONAL_BUNDLES`（保持显式安装）——对应发布说明「Inspector 不再默认提供，需要单独安装」。
- `packages/experimental/{browser-use,computer-use}/*`：区间**仅补 locale 与 icon**，**非能力首次引入**。
- `client-ui-voice-input/VoiceSetupDialog.tsx` 为**区间新增文件**——语音输入设置对话框首次引入。

---

## 4. 产品面变更清单（官方发布说明 × 源码交叉）

官方发布说明共四节，以下逐节列全，并标注与源码/机械证据的交叉核验结果。

### 4.1 ✨ 新增（6 项）

| # | 官方条目 | 源码交叉核验 |
|---|---|---|
| 1 | 定时任务提醒/运行记录/重启保留/最短每分钟 | `packages/schedule` 存储重写；`MIN_EVERY_INTERVAL_SECONDS` 300→**60**；新增 `catalog`/`history`/`update` 方法与 `schedule_update` 工具 |
| 2 | 桌面首次使用引导 | `2026-09-16-desktop-onboarding`（仅当 preload + 已存凭证 + 未完成时挂载） |
| 3 | 快捷键查看/搜索/自定义/恢复 | 新增 `client/shortcuts` + `client/ui-shortcuts` 两包，web-app 默认启用；偏好**设备本地**存储 |
| 4 | 进行中对话可直接使用新启用工具 | **`Session.toolHistory()` + `ToolHistory`/`ToolUpdate`**；`request/header.tools` + `developer/message` 表达增删 |
| 5 | Auto review 拒绝后可由用户决定是否继续 | `2026-09-24-auto-review-user-approval-fallback`；Auto 捆绑改 `ask` |
| 6 | 关闭桌面窗口后任务后台运行 | `2026-09-23-desktop-close-to-background-and-quit-confirmation` |

### 4.2 🐛 修复（19 项，按面归类）

| 面 | 条目要点 | 源码锚点 |
|---|---|---|
| **插件/启动** | 插件详情与设置页显示插件信息；启动失败错误提示；**崩溃或安装中断后持续失败**；不兼容插件跳过提示每启动仅一次；安装时辨认官方源/镜像 | `apps/cli`、`packages/boot/plugin-manager`（+704/−127）；`2026-09-24-exited-holder-lock-takeover` |
| **账号/计费** | 账号模型可在设置页编辑；记住已确认提示；额度提示匹配当前任务；余额刷新更稳；**登录密码误填入 API Key 框** | `packages/credentials`（+1859/−213）；余额超时延至 30s |
| **Windows** | 文件菜单图标更准确并优先关联应用；目录链接（junction）可进入 | `packages/util/native-command`（+145/−24）；`2026-09-18-windows-directory-junction-listing` |
| **桌面** | 部分安装包启动失败；Windows 更新提示；**macOS 窗口顶部可稳定拖动**；本地 Markdown 图片预览 | `apps/desktop`（+4995/−364）；`2026-09-19-window-drag-coverage-contract` |
| **对话/输出** | **过长工具输出的残缺字符并致后续对话失败**；部分长对话持续无法发送 | `packages/client`、`packages/session`（surrogate 截断） |
| **工作区** | 切换界面语言不再改变默认工作区文件夹名 | `2026-09-23-language-neutral-default-workspace-naming`（固定为 `default-workspace`） |
| **Agent 引导** | 改善帮助用户启用插件/功能的指引；语音输入未就绪时点击麦克风给出引导 | `packages/experimental/client-ui-voice-input`（新增 `VoiceSetupDialog.tsx`） |

### 4.3 ⚠️ 调整（6 项，含 2 项默认值翻转）

| # | 官方条目 | 判定 |
|---|---|---|
| 1 | 插件管理页可启用自动审阅；**Inspector 不再默认提供，需单独安装** | `OPTIONAL_BUNDLES` +auto-review；inspector 改可安装 bundle 但不入列表 |
| 2 | **账号任务与 API Key 任务使用独立模型入口**；退出账号确认并停止运行中账号任务 | **§3.1 拆包**；`account-tasks.ts` 在 `signed-out` 时 `agent.cancel({...})`；`signOut` 描述删去 "and tasks" |
| 3 | 「代码工作工具」统一控制；**原独立模式选择开关移除** | `AgentPresetRoster` **移除 `modeSelectionEnabled`** |
| 4 | 启用时间上下文后**默认每十分钟**更新 | `time-context.refreshIntervalMs` 默认 **600000** |
| 5 | **Web 和桌面端默认关闭定时任务与时间上下文** | §3.2 patch 三行 `disabled: true` |
| 6 | 减少标准模式每轮固定提示的 token 开销 | 发布说明独有，未在源码面单列 |

### 4.4 🎨 优化（12 项）

归档三态筛选（隐藏/全部/仅归档）· 语法高亮统一并支持更多类型（新增 `util/code-language` 包）· 文档预览加载提示与浅色主题 · 圆角/菜单/悬停统一，单文件与纯增删 diff 更紧凑 · 焦点环一致且鼠标操作后不再误显（`focusWithoutRing`/`--dsw-focus-ring-color`）· 切换模型显示进度 · 不兼容插件跳过提示去重 · 插件安装源辨识 · **审批卡片跟随界面语言并引导 Agent 用提问语言解释** · 中文「子智能体」名称统一 · **折叠的网页抓取卡片可直接点网址打开**。

---

## 5. 其余分线（全量口径补充）

### 5.1 子代理与编排面

| 发现 | 性质 |
|---|---|
| **子代理枚举语义重写**：由「Session 语料库全量后代」改为「**可达 parent catalog 前序递归**」，`uncataloged Sessions are outside discovery` | **行为收窄**；不可读分支降为 `diagnostic` 而非整体失败 |
| `listDescendants` 新增 `SessionQueryError`；`mode === 'unknown'` 产生 `unsupported` 诊断行 | 契约面 |
| `.agents/notes/proposed/architecture/2026-09-19-timed-user-question-two-settlements.md` | **唯一新增 proposed，未落地**（全仓 `askTimed` 0 处命中）→ `ctx.userQuestions.ask` 的**阻塞语义与 `ask()` 路径原样保留** |
| LLM 模型目录语义：由「advisory，不约束路由」改为「**GUI 选择/提交需 catalog 成员资格**」，核心解析仍接受未列 id（降级 text-only） | 语义变化 |
| `packages/llm` API 请求扩展：合并体序列化失败时**退化为无扩展字段并告警**（不再失败） | 稳健化 |

### 5.2 测试、快照与构建流程

- **`snapshots/` 在 rc.1 已存在**（1194 文件），是**提交进仓库的 Session 回放语料**（`snapshots/AGENTS.md`：`This tree contains only tests whose committed session JSONL is replay input and expected persisted output.`）。区间改动 285 个文件（session 171 / sdk 54 / web 53 / acp 7）为**改写而非新增**。
- **被删除的 5 个脚本/文件**：`scripts/translation-pairing-merge.{ts,spec.ts}`、`scripts/merge-translation-pairing.{ts,driver.sh}`、`scripts/gen-cordis-catalog-record.spec.ts`、`apps/cli/config/examples/schedule/cordis.yml` —— 前四者由**分节键翻译配对**机制取代（见 §5.3）。
- **根 `package.json`**：`version: 0.1.7-rc.1 → 0.1.7-rc.2`；`build:lib:host` 追加 `&& pnpm --filter @deepseek-ai/dsh-desktop run bundle`（对应 `2026-09-22-desktop-main-bundle-after-workspace-tsdown`：主进程 bundle 在工作区 lib 产出后**串行构建**）；**`engines` 未变**（`^22.19.0 || >=24.0.0`）；移除 `resolve-translation-pairing-conflicts` 脚本。
- `packages/test-support/`（29 files）与 36 个 `test` 提交：新增测试支撑与夹具，**无对外契约变化**。

### 5.3 文档与 i18n 体系

- **翻译配对机制变更**：由整文件 blob 配对改为**按标题分节键**存放（`2026-09-23-section-keyed-translation-pairing-records`），键即**英文标题 slug 路径**（如 `/plugin-config-catalog/loadable-plugins-with-no-config`，重复路径加 `~2`/`~3`），冲突范围由「整文件」缩到「同分节」。**问题原文** `[E24]`：`A consistency record held the full blob hash of each language file. Any edit to a pair changed both lines, so two branches that edited different parts of the same pair always conflicted on the record, even when Git merged both Markdown files cleanly.`
- **`*.i18n.yaml` 的正式语义** `[E25]`（`docs/i18n/README.md`）：一个双语对是**三个同级文件**——`foo.md`、`foo.zh.md` 与一致性记录 `foo.i18n.yaml`；记录**每个仍含语言特有内容的章节一条**。**双语文档具有同等规范效力**（`Both languages carry equal authority. ... what binds them is that they must say the same thing.`），一致性由 `pnpm run verify-translation-pairing`（`doc-sync` 一环）机械强制。
- `.agents/notes` 的 681 文件改动中，**566 个是 `.i18n.yaml` + 114 个 `.md` + 57 个 `.zh.md` + 1 个 `json`** `[E23]`——绝大多数是**配对记录格式切换导致的全部重录**。`docs/subsystems/*.i18n.yaml` 同理（如 `jobs.i18n.yaml` 新增 `/background-job-runtime/ids-and-status` 分节哈希），而 `jobs.md`/`goal.md`/`workflow.md`/`deliverables.md` **0 行变更**。
- **顶层新增文档**：`docs/ui-radius.{md,zh.md}`（+ 配对记录，三文件对）。`docs/user/` 22 文件中仅 `guide/python-sdk`、`guide/schedule` 中英正文实质更新，其余 18 份为配对记录刷新。
- `docs/` 面共 **236 文件**变更；`docs/subsystems/` 91 文件修改（其中 63 为 `.i18n.yaml`）。

> ⚠️ **一处更正**：`docs/persistence-changes/` 目录**在 rc.1 就已存在**（`git ls-tree dsh-v0.1.7-rc.1 docs/` 可验），非本区间新增目录；本区间只在该目录下**新增 1 份变更记录**及其 schema/i18n 文件。

### 5.4 其余包（无对外契约变化）

经逐包核对，以下包的区间改动仅为 **`README.i18n.yaml` 翻译配对刷新 + `package.json` 版本号**，**无服务方法、事件、Tool、Config 字段或持久化根变化**：

`packages/shell`（+948/−173 但全为测试与 i18n）· `packages/fs` · `packages/boot` · `packages/context` · `packages/web` · `packages/host`（含 **`webserver`：`src` 零变更**）· `packages/core`（`tools` 与 `session` 除外，见 §6.3）· `packages/interaction` · `packages/session-query` · `packages/core/session` 之外的 `packages/session/*` · `packages/extensions`（契约面见 §1.4）· `packages/util/native-command`（Windows 应用关联，见 §4.2）· `packages/credentials` 之外的 `packages/api/*`。

---

## 6. 对 dsh-ldvh 的影响评估（消费面逐条核对）

> 本节按 `specs/08 §5` 登记的消费面逐条核对。判定原则：**「宿主缝存在」不等于「LDVH 受其保护」**；下表只回答「LDVH 实际消费的东西是否变化」。

### 6.1 服务面：**全部仍在，零删除**【机械】

| LDVH 消费的服务 | rc.1 | rc.2 | 判定 |
|---|---|---|---|
| `ctx.agents` | ✓ | ✓ | 未变（方法集未变） |
| `ctx.commands` | ✓ | ✓ | 未变 |
| `ctx.fs` | ✓ | ✓ | 未变 |
| `ctx.invariants` | ✓ | ✓ | 未变（`register` 未变） |
| `ctx.sessionPersistence` | ✓ | ✓ | 未变 |
| `ctx.tools` | ✓ | ✓ | 方法集未变（见 §6.3） |
| `ctx.userQuestions` | ✓ | ✓ | 未变（`ask` 语义未变） |
| `ctx.webServer` | ✓ | ✓ | **`packages/host/webserver/src` 零变更** |
| `ctx.systemPrompt` | ✓ | ✓ | 未变 |
| `ctx.shellEnv` | ✓ | ✓ | 未变 |
| `ctx.approval` | ✓ | ✓ | 未变 |
| `ctx.sandboxPolicy` | ✓ | ✓ | 未变 |

> `ctx.dshHomePath` 与 `ctx.remote` 不在 `api-catalog` 中（前者 boot 时 `provide`、后者是 Typert Remote 通道），**两版一致**，无变化证据。

### 6.2 事件面：**全部仍在，mode 未变**【机械】

LDVH 实际监听（`lib/event-stream.js`、`lib/lifecycle.js`、`lib/client.js`）与机械核验结果：

| 事件 | LDVH 用途 | rc.2 mode | 判定 |
|---|---|---|---|
| `agent/created` | 生命周期入口（`source` 载荷） | `serial` | ✓ 未变 |
| `agent/pre-step` | 行动前引导注入 | `waterfall` | ✓ 未变 |
| `agent/turn-stopping` | 交还处理 | `serial` | ✓ 未变 |
| `session/event` | 会话事件分发 | `emit` | ✓ 未变 |
| `system-prompt/assemble` | 最小规则引导注入 | `waterfall` | ✓ 未变 |
| `fs/observed` | 读观察 | `emit` | ✓ 未变 |
| `fs/edit-intent` | 写版本守卫 | `waterfall` | ✓ 未变 |
| `fs/write-intent` | 写意图守卫 | `waterfall` | ✓ 未变 |

> 另注：`session/reprime`、`tools/registered`、`tools/registration-defect`、`tools/registration-failed`、`tools/unregistered`、`user/message` **不是宿主事件**，而是 LDVH **自己写入活动流（`activity.record(...)`）并自行消费的内部标签**（`lib/lifecycle.js:88/108/116/179`、`lib/client.js:1104`）。它们不构成宿主接缝，因此不在比对面内。

### 6.3 代码面：LDVH 依赖的宿主包中，**仅两个有源码改动**【机械】

对 LDVH 注入/依赖的全部宿主包做 `src/` 级差分，结果：

| 包 | `src/` 变更 | 影响判定 |
|---|---|---|
| `packages/host/webserver` | **无** | webServer 接缝完全静止 |
| `packages/interaction/user-questions` | **无** | Human Gate 问询面静止 |
| `packages/core/invariants` | **无** | 不变量缝静止 |
| `packages/fs/fs` | **无** | 读观察/写守卫缝静止 |
| `packages/session/session-persistence` | **无** | 会话日志定位静止 |
| `packages/util/home-paths` | **无** | `dshHomePath` 静止 |
| `packages/core/agents` · `prompt/system-prompt` · `shell/shell-env` | **无** | 静止 |
| `packages/core/tools` | **+5 / −3**（2 文件） | **纯增量、向后兼容**（见下） |
| `packages/core/session` | **+97 / −4**（3 文件） | **纯增量、向后兼容**（见下） |
| `packages/util/atomic-write` | **+85 / −8**（1 文件） | ⚠️ **行为变更，击中 LDVH**（见 §6.4） |

**`packages/core/tools` 的改动**（对 LDVH 的 `tools.guard` / `tools.register` 均**无破坏性**）：

```diff
-  | { kind: 'ask'; reason?: string }
+  | { kind: 'ask'; reason?: string; displayReason?: { readonly en: string; readonly [locale: string]: string } }
```

即 `PreToolDecision.ask` 新增**可选** `displayReason`；另 `run_code` 的 `justification` 描述追加「使用用户当前请求的语言」。LDVH 的守卫返回**字符串拒绝**（`(execution) => string | undefined`），与 `ask` 分支无关。

**`packages/core/session` 的改动**：新增 `Session.toolHistory()` 与 `ToolHistoryProjection`（+75 行新文件 `tool-history.ts`），`RequestHeaderReason` **仅文档注释澄清**（`startsSeries` 语义说明），字段本身未增删。

**`packages/client/ui-primitives` 导出面**（LDVH 声明 inject 该包）：

- 导出名 **155 → 165**（含 `export *` 行的计数口径；仅计具名导出为 156 → 166）；**删除 1 项**：`OnboardingSurface`；新增 11 项（`MenuSurface`、`ShortcutKeys`、`observeComposition`、`focusWithoutRing`、`closeTopModal`、`isBehindModal`、`modalSelector`、`useModalLayer`、`GuideArtwork*`）
- **LDVH 实际使用的 4 个符号全部仍在且未变**：`IconChevronDownOutline`、`IconChevronDownOutlineMedium`、`IconChevronDownOutlineRegular`、`Toast`
- `packages/client/ui-conversation` 的 `exports` **无变化**

> 该删除项**不击中 LDVH**（未使用）。但它复现了上一份调研记录的同一风险形态——**宿主具名导出改名/删除对「按名取用」毫无韧性**：应保持按名探测 + 回退，把硬崩溃降级为视觉降级。

### 6.4 ⚠️ 唯一实际击中 LDVH 的接缝：`dsh-atomic-write` 锁接管

LDVH 的 `lib/governed-projects.js:7` 直接：

```js
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
```

区间该包新增「**已退出持有者锁接管**」（`packages/util/atomic-write/src/index.ts`，+85/−8；提交 `7e7ba139fd` + `910711e6c1`）：

- 锁文件记录 **`<pid>`**；`holderExited()` 用信号探针判定持有者进程确实不存在，则**接管**该锁
- 逐字注释：`A lock whose recorded holder process no longer exists is taken over.`
- **明确的适用边界（逐字）**：`A holder whose PID a live process reused keeps its lock until an operator removes it. ... PIDs are compared on the contender's host, so writers on other hosts or in other PID namespaces sharing the file are unsupported`

**判定**：

| 维度 | 结论 |
|---|---|
| 锁的约束对象 | ⚠️ **只作用于管辖登记载体**（勘误，2026-09-26）：`governed-projects.js` 中 4 处 `withFileLock` / `writeFileAtomic` 的目标全部是 `registrationPath(dshHomePath)`，即 `$DSH_HOME/ldvh/governed-projects.yaml`。事实源 `ldvh-base/` **不经该包**——8 个 fact writer（workcase / norm / spark / adr / pitfall / research / friction / goal）各自带本地「`writeFile` + 回读校验 + `rename`」的**无锁**原子替换，`initializeFactSource` 亦只用普通 `mkdir`。原表述把约束记在事实源目录上，属对象误挂 |
| 对 LDVH 的正向价值 | ✅ **改善**：此前进程崩溃/安装中断遗留的锁需人工清理；现在自动接管。对应官方修复条目「修复应用异常退出或安装中断后，后续插件安装和配置保存持续失败的问题」 |
| 对 LDVH 的风险 | ⚠️ **条件性**：若**登记载体所在的 DSH 用户配置根**位于**网络文件系统**或**跨 PID namespace 的共享卷**（容器/多宿主同挂），PID 探针会**在竞争者主机上**判定，可能误判**存活**持有者为已退出并双重持有。**LDVH 当前部署为单机单 PID namespace，不触发该边界**，但这是**部署形态改变时须重新评估的条件** |

### 6.5 未击中的破坏面（明确排除）

| 破坏面 | 为何不击中 LDVH |
|---|---|
| `ctx.deepseekAccount` 四方法签名变更（无兼容层） | **LDVH 不消费 `deepseekAccount`**（消费面清单中无此项） |
| `ctx.workspaceController.initializeDefault` / `workspaceRegistry.initializeDefault` 签名变更 | **LDVH 不消费 workspace 初始化** |
| `@deepseek-ai/dsh-llm-deepseek` 拆包 | **LDVH 不依赖该包**；`plugin/package.json` 的 peer/dep 清单中无它 |
| 子代理枚举语义收窄 | **LDVH 走 `ctx.agents` 内存态**（`agents.get/has/set/delete`），**不走** `listDescendants` 目录枚举 |
| `AgentPresetRoster.modeSelectionEnabled` 移除 | LDVH 不消费该类型 |
| schedule 相关全部变更 | LDVH 不消费 `ctx.schedule` |
| `.i18n.yaml` 分节键重构 | LDVH 不消费内核文档配对元数据 |

### 6.6 运行时旁证【运行时】

本机 `/Applications/DSH NEXT.app`（`dsh-desktop-next@2.0.15-next`，**其声明依赖 153 个 `@deepseek-ai/dsh*`、`node_modules` 实测 275 个 `dsh*` 包全部为 `0.1.7-rc.2`**）上，dsh-ldvh 以 `link:/Users/dmh2002/DshProject/dsh-ldvh/plugin` 装载于 `desktop` profile，本次会话即为证据：

- `ldvh_*` 工具（含本次使用的 `ldvh_norm_*`、`ldvh_workcase_*`、`ldvh_read_specification_*`、`ldvh_*_write`）**逐回合正常注册与调用**
- 管辖判定（`governed`）与每回合最小规则引导注入**正常**
- `fs/observed`、`fs/write-intent`、`agent/pre-step` 等事件缝**正常工作**（本报告的每一次文件读写都经过它们）

> **证据边界（按 `specs/08 §8`）**：以上是**运行观察**，证明「插件在该宿主上加载并工作」这一机械事实；它**不构成**「已验证支持 rc.2」的正式声明。按本仓 `local-dev-workflow` 规范，支持声明须以**真实 UI 验收全项**（设置卡片、LDVH 会话视图、`/ldvh`、`/ldvh/api/health`、停用与重启、卸载清理）完成为前提；`/ldvh` 与 `/ldvh/api/health` 已具备本机实证，其余四项**尚未核对**。

---

## 7. 对 dsh-ldvh 的行动清单

### 7.1 必须动作：**无**

本区间**没有**强制 dsh-ldvh 适配的破坏面。消费面（12 个服务、8 个事件、相关槽位与包）**全部未变或纯增量**。

### 7.2 建议动作

| # | 动作 | 依据 | 优先级 |
|---|---|---|---|
| 1 | **支持基线登记推进到 `0.1.7-rc.2`**：`local-dev-workflow` 规范登记的目标环境（`DSH Desktop 2.0.13 / 0.1.5-rc.2`）与本机实测（`DSH NEXT.app 2.0.15-next / 0.1.7-rc.2`）**已不一致**；按该规范的「环境版本时效性」条款应走**受控更新修订** | §1.3 + `local-dev-workflow`「环境版本时效性」 | **高** |
| 2 | **补做真实 UI 验收的四项未核对项**（设置卡片、会话视图、停用与重启、卸载清理）——这是支持声明成立的**硬前提**，且 `app` 壳已换代（2.0.14-next → 2.0.15-next） | §6.6 + `local-dev-workflow` 红线 3 | **高** |
| 3 | **评估 `atomic-write` 锁接管的部署条件**：确认**登记载体所在的 DSH 用户配置根**（`$DSH_HOME/ldvh/`）**不在**网络文件系统 / 跨 PID namespace 共享卷上；若是，需在文档中登记该限制 | §6.4 | 中 |
| 4 | **为审批面补 `displayReason`（可选增强）**：LDVH 的 Human Gate 与写守卫目前只返回字符串拒绝理由；宿主已支持本地化 `displayReason`，可让审批卡片跟随界面语言 | §6.3 + 发布说明「审批卡片跟随界面语言」 | 中 |
| 5 | **保持「按名探测 + 回退」纪律**：本区间 `ui-primitives` 删除 `OnboardingSurface` 再次印证具名导出可被删除；对 LDVH 用到的 4 个符号建议加探测回退 | §6.3 | 低 |
| 6 | **对依赖 `@deepseek-ai/dsh-llm-deepseek` 包名的周边插件做一次清查**：本机 `desktop` profile 装有 12 个第三方依赖，若其中任何插件按该包名引用，rc.2 下会装载失败 | §3.1 | 中 |

### 7.3 后续调研方法建议

1. **先取 GitHub Release 发布说明**——本区间的官方全量清单存在且完整，可省去大量语义阅读。**先搜源码是低效路径。**
2. **优先对生成式目录做机械化比对**（§1.4 六张表）——集合与签名级比对可在**十几分钟**内给出「服务/事件/槽位/工具/Config/持久化」六维的确定性结论，远优于逐文件读 diff。
3. **判定「默认是否可用」只读 patch，不读决策记录**——本区间出现了决策记录与代码相反的实例（§3.3）。
4. **区分「包存在」与「包被装载」**：`llm-deepseek` 包存在但被移出默认组合（§3.1）；只看 `ls packages/` 会得出相反结论。
5. **判定破坏面须区分「签名变更」与「是否被消费」**：本区间 4 处签名破坏 + 1 处拆包，对 dsh-ldvh 的实际冲击为 **0**，全部由消费面比对排除。

---

## 8. 证据强度与限制（UNVERIFIED 与缺口）

### 8.0 待 Human 决定事项（Human Gate）

按 `specs/30 §20.1`，以下事项**不由 AI 自行定夺**，须提请你决定（即目标所述「待 Human 裁夺项」）：

| # | 待决定事项 | 为何须 Human 裁夺 | 选项与后果 |
|---|---|---|---|
| H1 | **支持基线登记是否推进到 `0.1.7-rc.2`** | 本仓 `local-dev-workflow` 规范登记的目标环境为 `DSH Desktop 2.0.13 / @deepseek-ai/dsh 0.1.5-rc.2`。该登记是一次**Human 决定**（规范原文标注「Human 决定，2026-09-20」），AI 不得自行改写；而其门禁条款又要求环境升级后须走受控更新。**事实与规定已不一致，改与不改都要 Human 点头。** | ①**推进**：走 `ldvh_norm_write` 受控更新该规范（含版本值与未成立声明部分）；②**暂缓**：保持登记值，但在规范中登记「本机已漂移」事实；③**改向**：改为对准 `0.1.5-rc.3`（npm `latest` 通道）而非 rc.2 |
| H2 | **是否补做真实 UI 验收四项未核对项** | `local-dev-workflow` 红线 3 与 `specs/08 §8` 规定：支持声明须以真实 UI 验收全项完成为前提。仅 AI 无法完成（需人工在桌面端实操） | ①**补做**（设置卡片、LDVH 会话视图、停用与重启、卸载清理）→ 支持声明可成立；②**不补做** → 维持「未验证支持」，报告中所有支持类结论继续不可主张 |
| H3 | **`atomic-write` 锁接管的部署条件是否约束本仓登记载体位置** | AI 只能确认「当前单机部署不触发该边界」，**无法替 Human 承诺未来部署形态**（是否会把用户配置根放到网络盘/容器共享卷） | ①**登记为部署约束**（写入规范）；②**不登记**（接受该风险，但升级部署形态时须重评）。注：约束对象为**登记载体所在的 DSH 用户配置根**，非项目内事实源（勘误，2026-09-26） |
| H4 | **是否清理 `docs/` 下与本次调研并列的未跟踪文件** | 工作区现存 `docs/proposal-spark-authorization-gate-2026-09-25.md`（未跟踪，非本次产物）。是否纳入版本控制属 Human 决定 | ①**提交**；②**保留未跟踪**；③**删除** |
| H5 | **本报告是否转为受控 Research 对象** | `specs/30 §13.2`：调研系统**不强制**写入事实源；仅当次会话使用的临时证据可不进入。需要跨会话保留时须经受控写入 | ①**写入**（`ldvh_research_write`，获得 `object_uid` 与指纹、可被 F0/F1 发现）；②**仅留 docs 报告**（当前状态，跨会话保留依赖 Git） |

> H1 与 H2 是**关联决定**：若 H2 选择「不补做」，则 H1 的选项①「推进」在规范口径下仍可成立（登记的是目标基线，非已验证支持），但须同时保留「支持声明未成立」的如实登记。

### 8.1 未证实（uncertain）

| # | 事项 | 原因 | 对本报告结论的影响 |
|---|---|---|---|
| U1 | `apps/web` / `apps/desktop` 的 CSP 与启动握手是否影响第三方插件挂载时序 | 144/96 文件未全量审阅，仅确认 `base: './'` 未变、无 CSP 文件结构性修改 | 不改变 §6 结论（LDVH 的注入面为 host 与 client service/slot，非 asset 路径） |
| U2 | `ui-primitives` 导出的**运行时**可用性（非导出名单） | 只比对了 `src/index.ts` 导出名集合，未在运行中的浏览器侧求值 | 影响 §6.3 的「低优先级建议 5」，不影响「LDVH 用到的 4 个符号未变」 |
| U3 | 根 `package.json` 之外各包的 `engines` 约束是否收紧 | 仅核对根 `engines` 未变 | 不影响结论 |
| U4 | `const` 字段级全量比对（config-catalog 其余 ~130 个插件） | 只对 6 处声明变化做了逐字对比，其余靠集合比对 | 已由「`inject` 变更 0」+「Config 条目净增 4/删 1」覆盖主要面；残余风险低 |

### 8.2 缺口（gaps）

| # | 缺口 | 优先级 | 阻塞的结论 |
|---|---|---|---|
| G1 | **未在 rc.2 上对适配前代码做受控启动复现**（LDVH 本身无需适配，故此缺口仅针对「第三方插件在 rc.2 的失败形态」） | low | 「依赖 `llm-deepseek` 包名或旧账户签名的插件会失败」目前为**源码必然推出**，非实测观察 |
| G2 | **本机 `desktop` profile 的 12 个第三方依赖未逐一核对 rc.2 兼容性** | medium | 「本机插件族在 rc.2 整体可用」类结论**不被本报告主张**；本次只主张 dsh-ldvh 自身 |
| G3 | **真实 UI 验收四项未核对**（设置卡片、会话视图、停用重启、卸载清理） | **high** | **「dsh-ldvh 已验证支持 0.1.7-rc.2」不成立**。本报告只主张「在运行中的 rc.2 宿主上正常加载并工作」 |
| G4 | 各桌面壳变更（2.0.14-next → 2.0.15-next）无上游文本对照 | low | 壳层行为变化结论 |
| G5 | `docs/user/` 与部分顶层文档未逐篇审阅 | low | 面向用户的文档变更细节 |

> 按 `specs/30 §10.3`，`high` 优先级缺口（G3）未关闭 —— 但本报告的 `research_purpose` 是「变更事实认定与影响面评估」，**不是**「宣布支持成立」，故该缺口不阻塞本报告结论，而**恰好构成 §7.2 行动项 2 的输入**。

### 8.3 机械锚点可复现清单

本报告全部机械结论可经以下命令复现（工作目录 `/Users/dmh2002/DshProject/deepseek-harness`）：

```bash
git rev-list --count dsh-v0.1.7-rc.1..dsh-v0.1.7-rc.2        # 346
git diff --shortstat dsh-v0.1.7-rc.1 dsh-v0.1.7-rc.2          # 3429 files, +136313, -24518
git diff dsh-v0.1.7-rc.1 dsh-v0.1.7-rc.2 -- packages/bundle/base/cordis.patch.yml
git diff dsh-v0.1.7-rc.1 dsh-v0.1.7-rc.2 -- packages/bundle/web-app/cordis.patch.yml
git diff dsh-v0.1.7-rc.1 dsh-v0.1.7-rc.2 -- packages/extensions/tool-cordis/src/api-catalog.ts
git diff dsh-v0.1.7-rc.1 dsh-v0.1.7-rc.2 -- packages/extensions/cordis-client-runner/src/client/slot-catalog.ts
git diff dsh-v0.1.7-rc.1 dsh-v0.1.7-rc.2 -- packages/util/atomic-write/src
git show dsh-v0.1.7-rc.2:packages/bundle/web-app/README.md    # "disables ... by default"
git log --format='%h %ci %s' -5 --all -- packages/bundle/web-app/cordis.patch.yml
git merge-base --is-ancestor cad6fef2fd dsh-v0.1.7-rc.2 && echo IN_RC2
```

---

## 9. 来源

| ref | 说明 | 限制 |
|---|---|---|
| `https://github.com/deepseek-ai/deepseek-harness` | 全部源码侧发现的对照源：两 tag 只读差分、生成式目录、决策记录 | 静态差分只证明「发布内容」，不证明运行时装了什么；根无 CHANGELOG |
| `https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.7-rc.1...dsh-v0.1.7-rc.2` | 区间对照（GitHub compare）。API 返回 `ahead_by: 346`、`total_commits: 346`、`behind_by: 0` | 只给发布线差异，不含运行时装配 |
| `https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2` | **官方发布说明**（中英四节，本区间权威全量清单）；`prerelease: true`、`published_at: 2026-09-24T14:10:21Z` | 面向用户措辞，不含 API 契约细节；须与源码交叉 |
| `https://registry.npmjs.org/@deepseek-ai/dsh` | npm 元数据：`dist-tags` = `{latest: 0.1.5-rc.3, alpha: 0.1.7-alpha.2, next: 0.1.7-rc.2}`；rc.2 发布 `2026-09-24T14:18:11.337Z` | 只给版本与标签，不给变更内容 |
| 本机 `/Applications/DSH NEXT.app`（`dsh-desktop-next@2.0.15-next`） | 运行中宿主观察：其声明依赖 153 个 `@deepseek-ai/dsh*`、`node_modules` 实测 275 个 `dsh*` 包全为 `0.1.7-rc.2`；LDVH 在该宿主上逐回合正常工作 | 观察时点为 2026-09-26；壳层改动无上游文本对照 |
| 受辖仓 `dsh-ldvh`（`/Users/dmh2002/DshProject/dsh-ldvh`） | 消费面核对发生地：`plugin/package.json` 的 peer/dep 清单、`lib/host-seams.js` 的缝消费清单、`lib/event-stream.js` 的事件清单、`lib/governed-projects.js` 的 atomic-write 用法 | 本次工作区有 1 个未跟踪文件；消费面比对基于工作树 HEAD `dd7f443` |

---

## 10. 证据库（引用闭环）

**用法**：正文的 `[E#]` 指向本表；`来源` 为可复核的绝对路径或 URL，`锚点` 为行号或章节。所有逐字引文保留原文，未作改写或概括（`specs/30 §11.1`）。`confidence` 采用 `specs/24` 闭集（`high`/`medium`/`low`）。

| # | 逐字引文 / 数据 | 来源 | 锚点 | confidence | 三态 |
|---|---|---|---|---|---|
| E1 | `3429 files changed, 136313 insertions(+), 24518 deletions(-)`；`346` commits（`224` 非 merge） | 本地仓 `/Users/dmh2002/DshProject/deepseek-harness`（`git diff --shortstat` / `git rev-list --count`） | tag `dsh-v0.1.7-rc.1`..`dsh-v0.1.7-rc.2` | high | confirmed |
| E2 | `export const SESSION_FORMAT_VERSION = 4` | `packages/core/session/src/types.ts` | 两 tag 均 L89 | high | confirmed |
| E3 | `decision: same-version`（`root: "event:schedule/change"`，`after: "a0a2e5c42e1c929445ecd1cd70f49be6b66441894ec72c08e8ae332821d4a3cb"`） | `docs/persistence-changes/2026-09-18-schedule-optional-title.md` | `## 声明` 段 | high | confirmed |
| E4 | `A version-1 Session event written before titles existed has no title member, so those logs decode and fold without one instead of being refused.` | 同上 | `## 兼容性` 段 | high | confirmed |
| E5 | 持久化根表 62 行；可达类型定义 577 个；唯一哈希变化根为 `event:schedule/change`（`2a7f868…` → `a0a2e5c…`） | `docs/persistence-catalog.md` | `## Persistence type fingerprints` 表；`## Resolved persistence types` | high | confirmed |
| E6 | `key: 'schedule'`，摘要 `Shared management service; reads, deletion, and timing edits never activate a Session.` | `packages/extensions/tool-cordis/src/api-catalog.ts` | rc.2 L1812 | high | confirmed |
| E7 | `abstract getProfile(client: AccountClientMetadata): Promise<AccountDetails['profile'] \| null>`（同形：`getBalance`/`signOut`/`startSignIn`） | 同 E6 | `SERVICE_API` → `deepseekAccount` | high | confirmed |
| E8 | 事件 `name:` 条目 77 → 81；新增 `deepseek-account/model-sign-in-required`、`deepseek-account/session-expired`、`deepseek-account/signed-out`、`schedule/changed`，`mode: 'emit'` | 同 E6 | `EVENT_API`（rc.2 L3683 起） | high | confirmed |
| E9 | 客户端服务 8 个：`layout`/`locale`/`sessions`/`slots`/`theme`/`timer`/`uiWorkspace`/`workspaces`（两 tag 同集） | `packages/extensions/cordis-client-runner/src/client/api-catalog.ts` | `SERVICE_API` | high | confirmed |
| E10 | 槽位 86 → 89；新增 `shell.quota-notice`(`chain`/`root`)、`sidebar.session.row.leading`(`list`/`root`)、`sidebar.session.row.hover`(`list`/`root`)；`conversation.chat.node`/`conversation.view` 两版均存在 | `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` | 各 `key:` 条目 | high | confirmed |
| E11 | 工具包 30 个（两 tag 同数）；工具名净增 `schedule_update`；无删除 | `docs/tool-catalog.md` | `## Tool Package Map` 表 | high | confirmed |
| E12 | `Config` 新增 `toolUpdate?: ToolUpdate`（`Optional mid-conversation tool declaration mode for a keyless replay route.`） | `docs/config-catalog.md` | `## @deepseek-ai/dsh-llm-replay` 代码块 | high | confirmed |
| E13 | `- name: '@deepseek-ai/dsh-llm-deepseek'` → `+ name: '@deepseek-ai/dsh-llm-deepseek-api-key'`，并新增 `id: llm-deepseek-account` | `packages/bundle/base/cordis.patch.yml`；`packages/bundle/sdk-minimal/cordis.patch.yml` | base L522–527；sdk-minimal L27 | high | confirmed |
| E14 | `- id: time-context` / `- id: schedule` / `- id: ui-schedule` 三行各带 `disabled: true` | `packages/bundle/web-app/cordis.patch.yml`（rc.2） | L121–127、L370–372 | high | confirmed |
| E15 | `The shipped composition disables `schedule`, `ui-schedule`, and `time-context` by default.` | `packages/bundle/web-app/README.md`（rc.2） | 正文段 | high | confirmed |
| E16 | `...and leaves `ui-schedule` enabled; ...` | `.agents/notes/implemented/architecture/2026-09-24-web-default-schedule-composition.md`（rc.2） | `## Decision` 段 | high | confirmed |
| E17 | `cad6fef2fd`（2026-09-24 20:27）`feat(web): disable shipped schedule and time context plugins`；`git merge-base --is-ancestor cad6fef2fd dsh-v0.1.7-rc.2` 通过 | 本地仓 git | 提交 `cad6fef2fd`；release `787b746b80`（21:24） | high | confirmed |
| E18 | `whose recorded holder process no longer exists is taken over.`；`other PID namespaces sharing the file are unsupported and could both hold` | `packages/util/atomic-write/src/index.ts`（rc.2） | L10；L228 | high | confirmed |
| E19 | `import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";` | `plugin/lib/governed-projects.js`（dsh-ldvh） | L7 | high | confirmed |
| E20 | 消费事件名 `'agent/created'`、`'agent/pre-step'`、`'agent/turn-stopping'`、`'session/event'`、`'system-prompt/assemble'`、`'fs/observed'`、`'fs/edit-intent'`、`'fs/write-intent'` | `plugin/lib/event-stream.js`、`plugin/lib/host-seams.js`（dsh-ldvh） | 事件注册处 | high | confirmed |
| E21 | `ctx.slots.inject("conversation.chat.node", …)`；`ctx.slots.inject("conversation.view", …)` | `plugin/lib/client.js`（dsh-ldvh） | L1174；L1278 | high | confirmed |
| E22 | 服务/事件/类型/槽位/工具/配置/持久化七张生成表的生成脚本与门禁名 | `scripts/gen-{cordis-api,client-catalog,tool-catalog,config-catalog,persistence-catalog}.ts` | 各文件头注释 | high | confirmed |
| E23 | `.agents/notes` 改动构成：`.i18n.yaml` 566、`.md` 114、`.zh.md` 57、`json` 1 | 本地仓 `git diff --name-only` | `.agents/notes/` | high | confirmed |
| E24 | `A consistency record held the full blob hash of each language file. Any edit to a pair changed both lines, so two branches that edited different parts of the same pair always conflicted on the record, even when Git merged both Markdown files cleanly.` | `.agents/notes/implemented/process/2026-09-23-section-keyed-translation-pairing-records.md` | `## Problem` 段 | high | confirmed |
| E25 | `A pair is three sibling files.` / `Both languages carry equal authority.` | `docs/i18n/README.md` | L10–11；L7–8 | high | confirmed |
| E26 | `...docSyncLeafGates({` 出现于 `ciPrimaryGates()` 与 `ciStaticGates()` 内 | `scripts/run-gates.ts` | L381（ciPrimaryGates）；L479（ciStaticGates） | high | confirmed |
| E27 | Release `v0.1.7-rc.2`：`prerelease: true`、`draft: false`、`published_at: 2026-09-24T14:10:21Z`，正文含 `✨ 新增 / 🐛 修复 / ⚠️ 调整 / 🎨 优化` 与英文四节 | `https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2`（API `releases/tags/dsh-v0.1.7-rc.2`） | body 各节 | high | confirmed |
| E28 | `"dist-tags":{"latest":"0.1.5-rc.3","alpha":"0.1.7-alpha.2","next":"0.1.7-rc.2"}`；`0.1.7-rc.2` 时间 `2026-09-24T14:18:11.337Z` | `https://registry.npmjs.org/@deepseek-ai/dsh` | `dist-tags` / `time` | high | confirmed |
| E29 | `This service fixes the `auto` identity and its `danger-full-access` plus `ask` bundle, and a recorded Auto selection also matches the `never` policy that delegated children pin` | `docs/subsystems/permission-presets.md` | L49 | high | confirmed |
| E30 | `"@deepseek-ai/dsh-client-ui-primitives": ">=0.1.7-rc.1 <0.2.0"`；`"@deepseek-ai/dsh-host-webserver": ">=0.1.7-rc.1 <0.2.0"` | `plugin/package.json`（dsh-ldvh） | L72–74（peerDependencies） | high | confirmed |
| E31 | workspace 包数 307 → 312；新增 5 包（`client-shortcuts`、`client-ui-shortcuts`、`llm-deepseek-account`、`llm-deepseek-api-key`、`util-code-language`）；删除 0 | 本地仓 `git ls-tree` 对 `(packages\|apps)/*/*/package.json` | 两 tag 比对 | high | confirmed |
| E32 | app `dsh-desktop-next` `2.0.15-next`；其 `dependencies` 中 153 个 `@deepseek-ai/dsh-*` 全部为 `0.1.7-rc.2` | `/Applications/DSH NEXT.app/Contents/Resources/app/package.json` | `version` 与 `dependencies` | high | confirmed |

**引用闭环自检**（`specs/30 §11.3`）：正文全部 `[E#]` 编号在本表均有对应条目（E1–E32）；本表每条引文均标注来源与锚点；正文无未入库引文。§8.1 与 §8.2 的条目**不挂** `[E#]`，因为它们分别是 **uncertain** 与 **gap**，按纪律不得冒充 confirmed。

**审计边界**：本表的「引文与证据库逐字一致」由 AI 自查完成，**未经独立程序化审计**；`specs/30 §11.3` 要求的程序化审计工具在本仓尚不存在，故此处为**主控自查**而非机械审计结论，不主张后者。
