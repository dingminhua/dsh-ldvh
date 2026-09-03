# DSH 宿主能力调查：交互面（问询/授权）与呈现面（Slot/theme/Web）事实报告

> 调查日期：2026-09-05
> 调查范围：DeepSeek Harness Desktop 版（app.asar.unpacked 解包源码）+ 本机 `~/.dsh` 实测
> 上游文档：`docs/dsh-host-capability-survey-data.md`（数据面/事件流调查，本文不重复其内容）
> 性质：纯事实盘点，不含设计建议

---

## §1 调查方法与置信度三分法

### 1.1 调查工具与对象

| 工具 | 用途 |
|------|------|
| `read` / `grep` / `glob` | 静态阅读宿主包源码（编译后 JS，保留完整 JSDoc） |
| 各包 `README.zh.md` | 官方包级文档（每个 @deepseek-ai 包均随附，本报告重要事实源） |
| `bash ls/grep` 实测 | `~/.dsh/settings.yaml`、`~/.dsh/profiles/desktop/node_modules/` 实际文件验证 |

### 1.2 源码路径约定

除另行注明，宿主源码路径前缀为：

```
HOST = /Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai/
PROFILE = ~/.dsh/profiles/desktop/node_modules/
```

### 1.3 置信度等级

| 等级 | 含义 | 适用条件 |
|------|------|---------|
| **A** 源码确认 | 直接读到实现/声明/官方 README 原文 | 附文件+行号 |
| **B** 间接推导 | 多文件交叉印证或从 Inspect 目录声明转录 | 附逻辑链 |
| **C** 推断 | 单一来源或命名推断 | 标【推断】 |

### 1.4 对前序结论的两处勘误（实测）

| 前序说法 | 实测结果 |
|---------|---------|
| "参照物 dsh-connect-workbuddy 在 ~/.dsh/profiles 下不存在" | **存在**，位于 `PROFILE/dsh-connect-workbuddy/`（含 README/docs/lib）。`~/.dsh/profiles/` 顶层只有 `desktop`、`node_modules`、`web` 三个目录，前一执行体查错了层级。按任务指示未对它做进一步调查 |
| 任务提示线索 "~/.dsh/settings.yaml 里 dsh-sub-cli 配置有 approval=ask 字段" | 实测存在（`~/.dsh/settings.yaml:1784-1786`），但它是**第三方插件 dsh-sub-cli 自己的设置字段**（`dsh-sub-cli.models.<cli>.approval`，语义为该 CLI 子代理工具的审批开关），**不是宿主 `ApprovalPolicy`**。宿主审批策略是会话级 `approval/policy` 事件 + 组合默认，与此字段无关 |
| 任务提示已知 slot 列表中的 "post-turnTail" | 宿主 Slot 目录中**不存在**此名；实际名称为 `conversation.chat.turnTail` |

---

## §2 交互面：问询与授权 API（核心交付）

### 2.1 API 总表

| # | 能力 | Service 名（ctx 键） | 定义包 | 核心方法 | 置信度 |
|---|------|---------------------|--------|---------|--------|
| 1 | 结构化问询 | `userQuestions` | `dsh-user-questions` | `ask(request)` | A |
| 2 | 审批（二值决策+审计） | `approval` | `dsh-user-approval` | `request(req)` / `setPolicy(agent, policy)` | A |
| 3 | 工具调用拦截网关 | `tools`（waterfall） | `dsh-tools` | `tools/pre-execute` 瀑布 | A |
| 4 | 凭据获取对话 | `authorization` | `dsh-authorization` | `registerFlow(flow)` / `begin(request)` | A |
| 5 | 沙箱策略解析 | `sandboxPolicy` | `dsh-sandbox-policy` | `resolve({session, mode?})` | A |
| 6 | 权限预设（捆绑开关） | `permissionPresets` | `dsh-permission-presets` | `select(...)` + `permission/preset` 事件 | A |
| 7 | 动态 Cordis 包运行授权 | `dynamicCordisRunner`（内部） | `dsh-tool-cordis` | `cordis_run` 工具 → `cordis/request-run` 事件 | A |

### 2.2 `ctx.userQuestions`：结构化问询（Human Gate 最接近的原语）

**服务定义**：`dsh-user-questions/lib/index.js:32-79`（Service 名 `userQuestions`，行 34）。

**方法签名**（README.zh.md:29 + 源码行 52）：

```ts
ctx.userQuestions.ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
```

**请求/回答类型**（类型声明转录自 `dsh-tool-cordis/lib/index.js:5440-5470` Inspect 目录；与 `dsh-user-questions/README.zh.md:33-36` 一致）：

```ts
AskUserQuestionRequest = { questions: AskUserQuestionItem[], agent?: Agent, signal?: AbortSignal }

AskUserQuestionItem = {
  id: string;          // 稳定 id，回答中回显
  question: string;    // 题目（必需）
  detail?: string;     // 辅助文本：UI 用 MarkdownText 随问题渲染，不进入选项标签
  header?: string;     // 可选眉题（eyebrow）
  options?: AskUserQuestionOption[];  // 选项列表
  multiSelect?: boolean;              // 多选开关，默认 false
  intent?: AskUserQuestionIntent;     // 呈现意图（见 2.2.3）
}
AskUserQuestionOption = { label: string; description?: string }  // description = 一句话权衡/影响说明
AskUserQuestionIntent = { kind: 'plan-review'; approve: string } // 唯一意图；approve 指名"批准"选项 label
AskUserQuestionAnswer = { answers: { id: string; selected: string[]; custom?: string }[] }
```

**回答约束语义**（README.zh.md:39）：单选题 `custom` 覆盖选中选项且 `selected` 为空；多选题 `custom` 补充 `selected`；跳过条目保留为 `{id, selected: []}`。

**错误码**（`dsh-user-questions/lib/index.js:14-30, 54, 62, 68-72, 94`）：`EMPTY_QUESTIONS`、`BAD_INTENT`、`NO_PROVIDER`、`ASK_ABORTED`、`CALLER_NOT_LIVE`、`DELEGATED_CALLER`。

**关键约束**（源码行 57-73）：

- 传入 `agent` 时必须是 `AgentRegistry` 中的**同一存活实例**（`CALLER_NOT_LIVE`），且必须是**运行时根**——被其他存活 agent 拥有的子代理调用直接拒绝（`DELEGATED_CALLER`），报错文案要求把未决问题放进子代理最终结果。持久化谱系不构成权限依据。
- 派发机制：带 agent 时走 Agent-scoped 瀑布 `user-questions/request`（行 96-98，`scopeTarget`），无 agent 时走全局瀑布；无人认领 → `NO_PROVIDER`。
- `intent` 校验（行 82-93）：`intent.approve` 必须命中该问题自身某个 `options[].label`，且声明 intent 的问题必须带 `detail`，否则 `BAD_INTENT`。意图只改呈现不改答案词汇（README.zh.md:45）。

#### 2.2.1 模型面工具 `ask_user_question`

**定义**：`dsh-tool-ask-user/lib/index.js:15-113`（工具名行 16）。

| 项 | 内容 | 出处 |
|----|------|------|
| 工具名 | `ask_user_question` | 行 16 |
| 参数 | `questions[]`：仅 `id` / `question` / `header` / `options{label,description}` / `multi_select` | 行 18-65 |
| **detail / intent 不可达** | 模型面 schema **不暴露** `detail` 与 `intent` 字段；execute 只映射五个字段（行 98-104），即使模型传入也会被丢弃 | 行 96-111 |
| 输出 schema | `{answers: [{id, selected[], custom?}]}` | 行 66-90 |
| 推荐约定 | "put it first and append \"(Recommended)\" to that label" | 行 42 |
| 挂载方式 | 属于 preset 可选行：`tool-ask-user` 行不在 UI 包全局注册（UI 包 Host 半刻意为空，见 `dsh-client-ui-user-questions/lib/index.js:5-14` 注释），由需要它的 preset 组合 | A |

**推论（B）**：需要 `detail`（依据正文）或 `intent`（决策卡呈现）的问询，**必须由宿主侧插件自带工具直调 `ctx.userQuestions.ask()`**——`dsh-plan-mode` 的 `exit_plan_mode` 就是这个先例（见 2.2.4）。动态 Cordis 插件的 Host 半可通过 `inject: ['userQuestions']` 访问该服务并 `ctx.tools.register` 注册自有工具（沙箱门禁按声明放行，`dsh-cordis-host-runner/lib/index.js:617-623, 636-642`；服务目录见 `dsh-tool-cordis/lib/index.js:4261-4273`）。

#### 2.2.2 Web 客户端渲染（谁在回答）

**客户端插件**：`dsh-client-ui-user-questions/lib/client.js`。

| 事实 | 出处（该文件行号） |
|------|------------------|
| 监听 Remote 瀑布：`ctx.remote.$on("user-questions/request", ...)` | 行 880 |
| 依赖注入：`["sessions","remote","uiSession","slots","locale"]` | 行 832-838 |
| 注册 pending 交互域：`ctx.uiSession.registerPendingInteraction(pending => pending.kind === "plan-review" ? 2 : 1)` —— 呈现优先级：plan-review=2 > 普通 question=1 | 行 873 |
| 占据 composer 座位：`ctx.slots.inject("conversation.composer", ...)`，`select` 匹配 `pendingInteraction instanceof PendingQuestion` | 行 874-879 |
| 通用流程 QuestionFlow：渲染 `detail` 为 MarkdownText；选项渲染为 radio/checkbox 按钮（label+description+推荐徽章）；自定义答案为自增高 textarea；支持翻页、跳过、取消（取消→ `ASK_CANCELLED`） | 行 640-646, 646-724, 388-397, 528-595 |
| 推荐后缀解析：`/\s*(?:\((?:recommended|推荐)\)|（...）)\s*$/i` 剥离并显示徽章 | 行 388-397 |
| 会话草稿：问题作答进度存于 Slot 注册时声明的 Session 级 store（`createQuestionDraftStore`） | 行 161-190 |
| 答案回传：`pending.answer({answers})` 解析 Remote 瀑布 | 行 113-119 |

**Remote 事件桥**：`user-questions/request` 与 `approval/request` 均在宿主转发白名单中且 mode=waterfall（`dsh-api-remotes/lib/types/remote-events.js:13-28`）；waterfall 转发**仅对带 Agent scope 的请求**（`dsh-api-remotes/lib/index.js:95-104`）；agentless 请求只能由本地未限定 scope 的瀑布监听者回答（README.zh.md:65）。

#### 2.2.3 plan-review 呈现意图与决策卡

**PlanReviewPanel**（`dsh-client-ui-user-questions/lib/client.js:38-56, 229-333`）：

- 收窄条件 `planReviewOf()`：恰好 1 个问题 + `intent.kind === 'plan-review'` + 带 `detail` + 非多选 + 选项 ≤ 2 + `intent.approve` 命中某选项。不满足则回落通用 question 流程（行 33-35 注释：意图改变布局，绝不改变可达答案）。
- 渲染：warn 色顶条"计划待审" + `detail` 整体 MarkdownText 渲染 + 按钮组（主按钮"确认执行"=approve label、描边"拒绝"=另一选项、ghost"去聊天里说"=取消整组问题）。
- "去聊天里说" → `pending.cancel()` → 拒绝码 `ASK_CANCELLED`（行 135-141）。

#### 2.2.4 `exit_plan_mode`：完整的"计划审查"先例

**定义**：`dsh-plan-mode/lib/types/index.js:272-361`。

| 事实 | 出处（该文件行号） |
|------|------------------|
| 工具参数：`plan: string`（markdown，必须 `#` 标题开头，行 295-297 校验） | 行 276 |
| 直调服务：`ctx.get('userQuestions')` 缺失则 fail-closed 报错（行 298-301） | 行 302 |
| 提请构造：单问题 `{id:'plan-review', header:'Plan review', question:'Approve this plan and leave plan mode?', detail: args.plan, options:[{label:APPROVE_LABEL,...},{label:KEEP_PLANNING_LABEL,...}], intent:{kind:'plan-review', approve:APPROVE_LABEL}}` | 行 302-318 |
| 批准判定：`selected.length===1 && selected[0]===APPROVE_LABEL && custom===undefined` —— **带自定义文本的批准不算批准**，按"继续规划+反馈"处理 | 行 336-343 |
| 用户取消（`ASK_CANCELLED`）转译为模型可读信息："The user dismissed the plan review to speak instead..." | 行 319-330 |
| 计划模式状态：`plan/mode` 会话事件（log-only 整值替换）；`/plan`、`/plan off` 命令；引导而非强制（README.zh.md:12, 81-93） | README |
| 计划模式徽章 UI：`dsh-client-ui-plan` 注册 `conversation.input.plan` slot（client.js:122），渲染 warn 色"Plan ×"按钮 | README.zh.md:6 |

#### 2.2.5 问询的持久化事实

- `ask()` 本身**不产生会话事件**；模型面调用经普通 `tool/call` + `tool/result` 事件进历史（答案 JSON 作为工具结果回流模型）。
- 与之相对，审批产生专用会话事件（见 2.3）。
- 【推断 C】`user/message` source.kind='plugin' 注入机制（`dsh-user-approval/lib/index.js:115-124` 的先例）可用于问询后向历史追加说明性消息，未在问询路径验证。

### 2.3 `ctx.approval`：审批服务

**服务定义**：`dsh-user-approval/lib/index.js:85-203`（Service 名 `approval`，行 89）。

**方法与签名**（源码 + `dsh-tool-cordis/lib/index.js:587-633` Inspect 目录）：

| 方法 | 签名 | 语义 |
|------|------|------|
| `request` | `async request(req: ApprovalRequest): Promise<ApprovalOutcome>` | 唯一授权途径；`allowed-once` 是唯一授权值 |
| `setPolicy` | `setPolicy(agent: Agent, policy: ApprovalPolicy): void` | 切换存活 agent 的策略并向其注入切换通知（user/message，source plugin） |
| `effectivePolicy` / `overrideOf` | `(session) => ApprovalPolicy` / `ApprovalPolicy \| undefined` | 会话折叠读取 |

**类型**（Inspect 目录转录，`dsh-tool-cordis/lib/index.js:5420-5435`）：

```ts
ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
ApprovalPolicy  = 'ask' | 'never'
ApprovalRequest = { agent: Agent; toolName: string; callId?: ToolCallId; reason?: string; signal?: AbortSignal }
```

**关键机制**（源码行号）：

- **审计对**：`request()` 先追加 `approval/asked`（`{id, toolName, callId?, reason?}`，行 148-153），决策后追加 `approval/decided`（`{id, outcome}`，行 155-158）。两者必须被同一 turn 包围（`hasOpenTurn` 行 62-69；无 open turn 直接抛错，行 146）。
- **策略先行**：`effectivePolicy === 'never'` → 直接 `rejected`，不进瀑布（行 188）。
- **fail-closed**：无回答者/回答者抛错/词汇外返回值 → `unavailable`（行 189）；abort → `cancelled`（行 187, 191-201）。
- **策略来源**：会话日志最后一条 `approval/policy` 事件折叠（行 49-54）→ 组合配置默认 `ask`（行 87, 169）。
- **模型可见性**：向 systemPrompt 注入 `approval:policy` 上下文段（order 115，行 92-102）；`never` 时注入本会话开头所见的那段"Approval prompts are disabled..."文字（行 38）。
- **瀑布**：`approval/request`（Agent-scoped，行 189）；Web 回答者见 2.3.1。

**审批事件总表**（载荷形状与发出者）：

| 事件 | 载荷 | 发出者 | 插件可否监听/干预 |
|------|------|--------|------------------|
| `approval/asked` | `{id, toolName, callId?, reason?}` | `ApprovalService.request()`（每问一次） | 会话事件（JSONL 持久化）；Cordis 侧可经宿主投影消费。不可否决——审计对是硬约束 |
| `approval/decided` | `{id, outcome}` | 同上（决策后） | 同上 |
| `approval/policy` | `{policy}` | `setApprovalPolicy()`/`setPolicy()`（唯一写路径，行 76-79） | 同上；策略变更同时经 `agent.inject()` 注入 user/message 通知模型 |
| `approval/request`（Cordis 瀑布，非会话事件） | `ApprovalRequestEvent` | `ApprovalService.decide()` 派发 | **可以**：注册瀑布监听者即可回答或 `next()` 转交；Agent-scoped 过滤 |

#### 2.3.1 Web 审批回答者（Allow once / Reject 二值卡）

**`dsh-client-ui-approval/lib/client.js`**：

| 事实 | 出处（行号） |
|------|------------|
| `ctx.remote.$on("approval/request", ...)` | 行 281 |
| pending 优先级 `() => 0`（低于 question=1 / plan-review=2） | 行 270 |
| composer 注册 `priority: 1`，select 匹配 `PendingApproval` | 行 271-280 |
| 决策卡：warn 顶条"等待审批" + headline（`reason ?? "工具 {toolName} 请求越权执行"`）+ 按钮仅两个："拒绝"(rejected) / "允许一次"(allowed-once) | 行 47-101, 208-222 |
| 子座位 `conversation.approval.detail`（single/session）：按 `callId` 渲染 Tool 自有审批详情 | 行 43, 276-279 |

**结论（A）**：宿主审批 UI 是**二值决策**（允许一次/拒绝），无选项列表；审批载荷只有 `toolName/callId/reason` 三个展示字段。LDVH Gate 需要"多选项"时审批原语不够用，问询原语（2.2）才有多选项。

### 2.4 `tools/pre-execute`：工具调用拦截网关

**派发点**：`dsh-tools/lib/types/index.js:869`——`prepareExecution()` 对每次工具调用先走 `tools/pre-execute` 瀑布（默认 `allow`）。

**决策类型**（Inspect 目录转录，`dsh-tool-cordis/lib/index.js:6496-6497`）：

```ts
PreToolDecision = { kind: 'allow' }
               | { kind: 'deny'; reason: string }
               | { kind: 'ask'; reason?: string }
```

**ask 的解析链**（`dsh-tools/lib/types/index.js:1078-1115`）：

```
tools/pre-execute 返回 {kind:'ask'}
  → serviceAsk(exec, ask)
    → 无 approval service 组合 → deny "requires approval (not yet supported)"   [fail-closed, 行 1080-1085]
    → exec.agent === undefined  → deny "no agent to route it through"           [行 1086-1091]
    → approval.request({agent, toolName, callId, reason?, signal})
       → allowed-once → allow（行 1100）
       → rejected     → deny "the user rejected tool X"（行 1101-1104）
       → cancelled    → deny "approval was cancelled"（行 1105-1108）
       → unavailable  → deny "no approval channel is available"（行 1109-1112）
```

**拦截点语义**（Inspect 目录 `dsh-tool-cordis/lib/index.js:5210-5219`）：`next()` 委托为 allow；异步 gate 须观察 `exec.signal`；scope 过滤——agent-scoped 监听者只收该 agent 的调用。

**配套瀑布**：`tools/post-execute`（accept/replace/block 结果，行 5196-5208）、`tools/result`（emit 观察，行 5232-5243）。

**插件可干预性（A）**：任何宿主插件/动态 Host 半都可注册 `tools/pre-execute` 监听者实现 allow/deny/ask 三态拦截——这是 LDVH 机械守护（事前设卡）的宿主原生挂点。

### 2.5 沙箱权限模型与一次性升权

#### 2.5.1 模式与会话覆盖

**`dsh-sandbox-policy/lib/index.js`**：

| 事实 | 出处（行号） |
|------|------------|
| `SandboxMode = 'read-only' \| 'workspace-write' \| 'danger-full-access'` | 行 26-30 |
| 会话覆盖：`sandbox/mode` 会话事件（log-only 折叠，最后一条即状态，行 39-44）；`setSandboxMode()` 是唯一写路径（行 54-56） | 行 31-56 |
| `ctx.sandboxPolicy.resolve({session, mode?})`：`mode = 显式批准 mode ?? 会话覆盖 ?? 组合默认`；`workspaceRoot = session.cwd ?? 配置根` | 行 138-145 |
| 组合默认 `read-only`（行 102-107）；fallback root = 配置 workspaceRoot 或 process.cwd() | 行 108-117 |
| 模型可见性：systemPrompt 上下文段 `sandbox:policy`（order 110）渲染三态策略文案（本会话开头"Current DSH file policy: workspace-write..."即此段） | 行 83-93, 118-127 |
| bash 与 fs 家族读同一解析结果（README/注释行 69-74） | 注释 |

#### 2.5.2 一次性升权（sandbox_permissions）

**共享实现**：`dsh-sandbox/lib/index.js`（`approveEscalation` 行 92-111）：

| 事实 | 出处（行号） |
|------|------------|
| 严格变宽表：`WIDER_MODES = {read-only: [workspace-write, danger-full-access], workspace-write: [danger-full-access]}` | 行 29-32 |
| 升权目标词汇：`ESCALATION_TARGETS = ['workspace-write', 'danger-full-access']` | 行 41 |
| 参数配对校验：`sandbox_permissions` 与 `justification` 必须成对且 justification 非空句 | 行 50-54 |
| 拒绝标记：`[sandbox: file access denied under <mode> mode]`（两个执法家族共用同一标记） | 行 63-65 |
| 升权提示标记（随拒绝附带）：`[sandbox: escalation available — retry this exact <subject> once with sandbox_permissions ...]` | 行 75-77 |
| 升权流程：严格变宽检查（非变宽直接抛错**不提示人类**，行 94）→ approval service 存在性检查 → agentless 拒绝 → `approval.request({reason: "escalate sandbox to <mode>: <justification>"})` → `allowed-once` 返回该 mode **仅盖印这一次调用** | 行 92-111 |

**工具面广告**（仅组合了沙箱执行器时才出现字段）：

- bash：`dsh-tool-bash/lib/index.js:286-295`（enum = ESCALATION_TARGETS；行 130 的工具描述含"one sanctioned exception"整段升权教义；行 390 执行前解析）。
- fs：`dsh-tool-fs/lib/index.js:1124-1131, 1148-1160`。

**结论（A）**：一次性升权 = 每次调用的 `sandbox_permissions`+`justification` 参数 → 走 2.3 审批服务（Allow once/Reject 卡）→ 授权仅当次有效。拒绝后"final for that command"（工具描述原文）。

#### 2.5.3 权限预设（捆绑开关）

**`dsh-permission-presets/lib/index.js`**：

| 事实 | 出处（行号） |
|------|------------|
| Service `permissionPresets`；把 sandbox 模式与 approval 策略捆绑成用户可选项 | 行 88-119 |
| `permission/preset` 会话事件；预设切换先记 preset 再经两个规范 setter 写旋钮 | 行 32-37, 286-317 |
| 默认预设：`workspace-write{sandbox:'workspace-write', approval:'ask'}`、`danger-full-access{sandbox:'danger-full-access', approval:'never'}` | 行 95-108 |
| 旋钮状态投影：`permission/preset` + `sandbox/mode` + `approval/policy` 三事件折叠为 KnobState | 行 38-82 |
| 设置命名空间 `permission`（默认值供未来会话） | 行 24-25 |
| 读侧 = `permissions` 会话投影；写侧 = `/permission` 命令 | 行 13-15 注释 |

### 2.6 动态 Cordis 包的运行授权（第四种授权流）

**`dsh-tool-cordis`**（Inspect 目录与工具描述）：

| 事实 | 出处（行号） |
|------|------------|
| `cordis_run` 对未授权 Client 包返回 `awaiting-approval`；授权包返回 `starting` 异步激活 | 行 8760 |
| `cordis/request-run`（emit 事件）转发到 Client："A Client-bearing activation needs a browser page, and may require a user decision" | 行 4872-4881 |
| 单勾 = 授权当前 Package；双勾 = 授权该 Plugin 未来版本；技术失败后 grant 保留 | 行 8357-8358 |
| 状态机：`awaiting-approval / client-pending / failed / waiting / running / defined / stopped` | 行 8962-8971 |
| Client UI：`dsh-client-ui-cordis` 渲染 Run 卡与全局插件面板（含 awaiting-approval 状态与授权操作） | `dsh-client-ui-cordis/lib/client.js:455, 490-491, 614-634` |

### 2.7 `ctx.authorization`：凭据获取对话流

**`dsh-authorization/lib/index.js:58-246`**（Service 名 `authorization`，行 64）：

| 方法 | 签名 | 语义 |
|------|------|------|
| `registerFlow` | `registerFlow(flow: {key, label, methods, run}): Disposer` | 每键一流；重复注册 `DUPLICATE_FLOW` |
| `begin` | `begin(request: {key, method?, interaction, signal?}) => {status:'authorized'\|'cancelled'}` | 每键一次一尝试；`ALREADY_IN_FLIGHT` 拒绝第二人 |
| `cancel` / `list` / `describe` | — | 撤回尝试 / 列流 |

流通过 `interaction.notify(notice)` 与 `interaction.prompt(prompt)` 与启动它的界面对话；人类拒绝 = `AuthorizationDeclinedError`（`DECLINED`，行 48-53）。结算事件 `authorization/settled`（行 171-191）。**定位（A，行 5-9 注释）**：获取"配置给不出来的凭据"（打开页面、贴码、选账号），不承载一般决策。

### 2.8 ★ Human Gate 需求差距表（任务一第 4 问的正面回答）

**三选一结论：需组合**——宿主提供了高度契合的结构化问询原语（问询侧）与审计化审批原语（授权侧），但 LDVH 的五元提请结构没有一对一的宿主字段，且呈现意图词汇表只有 plan-review 一词。

| LDVH Human Gate 需要（08 规范 §5.5 语境） | 宿主最接近原语 | 契合度 | 依据（出处） |
|-------------------------------------------|---------------|--------|-------------|
| 结构化提请：**对象**（决策针对什么） | `question.id` + `question.question` + `header`（眉题） | 原生 | `dsh-user-questions/README.zh.md:33` |
| **依据**（决定所依据的事实/规范） | `question.detail`：markdown，UI 用 MarkdownText 整体渲染 | 原生（字段存在且渲染） | client.js:640-646；类型 `dsh-tool-cordis/lib/index.js:5449` |
| **选项**（含推荐标记） | `options[]: {label, description}`；推荐约定 = 首位+“（推荐）"后缀，UI 解析出徽章 | 原生 | 工具描述 `dsh-tool-ask-user/lib/index.js:42`；解析 client.js:388-397 |
| **影响**（每个选项的后果） | `option.description`（官方语义即"一句话权衡/影响"） | 原生但仅一句话 | 工具 schema `dsh-tool-ask-user/lib/index.js:53-55` |
| **风险** | 无专用字段；只能并入 `detail` markdown 或 option.description | 需组合 | 类型声明无此字段（5449-5453） |
| 多问题批量提请 | `questions[]` 数组 + UI 翻页 + 逐题草稿 | 原生 | client.js:466-595 |
| **Human 回应约束范围**（只能就所列选项表态） | 半原生：`selected` 只能是所给 label（UI 按钮实现枚举）；但 `custom` 自由文本是内置逃逸口（单选时覆盖 selected） | 原生枚举 + 逃逸口需调用方自行收紧 | README.zh.md:39；收紧先例 = plan-mode 行 338 拒绝带 custom 的批准 |
| 计划审查（决策卡呈现：markdown 正文+批准/拒绝+反馈） | `intent: {kind:'plan-review', approve}` + PlanReviewPanel | 原生（唯一专用呈现） | 2.2.3/2.2.4 |
| 通用"Gate 决策卡"呈现意图 | `intent.kind` 词汇表**只有 `plan-review`**；其他 Gate 提请走通用 question 流程（仍是 markdown detail + 选项列表） | 需组合/受词汇限制 | `dsh-tool-cordis/lib/index.js:5444-5446`；README.zh.md:45,66 |
| 审计留痕（问询/决策入会话日志） | 审批侧原生（approval/asked+decided 审计对）；**问询侧不产生专用会话事件**，仅经 tool/call+tool/result 留痕 | 审批原生；问询靠工具事件 | `dsh-user-approval/lib/index.js:148-158`；§2.2.5 |
| 授权流（动作放行） | `ctx.approval.request`（二值）+ `tools/pre-execute`（allow/deny/ask）+ 沙箱升权流 | 原生（二值语义） | §2.3-2.5 |
| 验收交还 | 无专用原语；可组合：ask（约束式确认）+ 会话事件审计 + user/message plugin 注入 | 需组合 | 全目录无验收语义事件（`dsh-session/lib/types/known-event-types.js` 事件白名单） |
| 提请方约束（谁有权问 Human） | 原生：仅运行时根 agent 可问；被拥有子代理 `DELEGATED_CALLER` 拒绝 | 原生且与 LDVH 单一主控原则同构 | `dsh-user-questions/lib/index.js:57-73` |

**实现路径事实（B，综合）**：

1. 模型面 `ask_user_question` 工具**不含** detail/intent——LDVH 若要"依据正文+决策卡"级呈现，须像 `dsh-plan-mode` 那样注册自有工具直调 `ctx.userQuestions.ask()`（第一方插件或动态 Cordis Host 半均可，后者经 `inject` 声明访问，`dsh-cordis-host-runner/lib/index.js:617-642`）。
2. 宿主 UI 按 `pendingInteraction` 优先级路由 composer 接管：approval=0 < question=1 < plan-review=2（`dsh-client-ui-session/lib/client.js:160-177` + 两 UI 包注册处），LDVH 自定义呈现可注册 composer chain 条目参与。
3. 每次问询/审批期间 agent loop 挂起等待瀑布结果；abort 语义完整（signal 贯穿）。

---

## §3 呈现面：Slot 总表

### 3.1 Slot 注册与消费契约

**注册表**：`dsh-client-ui-slots/lib/index.js`（`SlotCore`，行 47-433）。

| 事实 | 出处（行号） |
|------|------------|
| `register(options, component)`：`options.name` 必须指向**已声明**的 slot（父条目 children 表声明），否则抛错 | 行 72-74 |
| kind 语义与校验：`single`（同 priority 占用冲突抛错）/ `keyed`（需 `key`）/ `list`（需 `id`）/ `chain`（需 `select`） | 行 78-99 |
| `options` 可带：`id`、`key`、`order`、`label`、`priority`、`locale`、`select`、`inject`（为组件注入 props 的函数）、`children`（声明子 slot）、`store`（Session 级草稿 store）、`registrant` | 行 113-128 |
| `root` slot 为框架先天种子（single/root，行 63-71），是整棵渲染树的根洞 |
| 消费 API：`inject(name, factory)`、`entries(key)`、`spec(key)`、`snapshot(root)`、`subscribe(key, fn)` | 行 172, 208, 226, 278 |
| 变更通知按微任务批处理；条目崩溃可"退位"（abdicated） | 行 38-45, 55-61 |

**Inspect 数据源**：`dsh-cordis-client-runner/lib/client.js:2103` 起的 `CLIENT_SLOT_API`（52 条，含 kind/scope/summary/doc/registerOptions/ownerProps/standardProps），是 `cordis_inspect_list` → `Slots.listSubTree` 的底层数据（行 4095-4123）；每条目带使用示例与源文件路径（`packages/client/*/src/client/contract/slots.ts:行号`）。

### 3.2 Slot 总表（52 个，全部 A 级，源自 CLIENT_SLOT_API）

kind：single（单占位）/ list（多条目）/ keyed（按 key 分发）/ chain（选择器路由）；scope：root / session / session-maybe（无会话态与有会话态同一组件）。

#### conversation.*（会话中心列）

| Slot | kind | scope | 用途摘要 |
|------|------|-------|---------|
| `conversation` | single | session-maybe | 整个中心列（无会话 hero + 会话体）；被 ui-conversation 的 ConversationRoot 占据 |
| `conversation.approval.detail` | single | session | 审批卡内按 callId 的 Tool 自有详情 |
| `conversation.chat.assistant-actions` | list | session | 单条 assistant 消息的有序操作 |
| `conversation.chat.commandview` | keyed | session | 命令行视图（按命令名 key） |
| `conversation.chat.node` | keyed | session | 聊天节点最终渲染器（按 ChatNodeKind key） |
| `conversation.chat.turnTail` | chain | session | 已完成 Turn 操作行之前的选择器路由扩展 |
| `conversation.composer` | chain | session | 当前会话常驻 composer 的**接管替换**（问询/审批卡即在此） |
| `conversation.composer.bar` | single | session-maybe | 常驻 composer 主体（含无会话惰性态） |
| `conversation.composer.dock` | list | session | composer 卡下方的环境条目 |
| `conversation.details.tool` | single | session | 详情面板选中的 Tool call 整体 |
| `conversation.hero.agentPreset` | single | root | 新会话 hero 的 preset 控件 |
| `conversation.hero.brand.mark` | single | root | hero 品牌标 |
| `conversation.hero.workspace` | single | root | hero 工作区选择器 |
| `conversation.hero.workspace.directoryFlow` | single | root | hero 选择器下的目录流洞 |
| `conversation.input.attachments` | single | session-maybe | 草稿图片栏与拖放目标 |
| `conversation.input.dock` | list | session | composer 卡上方全宽条目 |
| `conversation.input.left` | list | session | composer 工具行左侧紧凑控件 |
| `conversation.input.model` | single | session | composer 工具行内模型选择器 |
| `conversation.input.overlay` | list | session | composer 卡内浮动条目 |
| `conversation.input.plan` | single | session | composer 工具行内 Plan 控件 |
| `conversation.input.right` | list | session | 提交动作前的紧凑控件 |
| `conversation.message.images` | single | session | 消息图片组渲染器 |
| `conversation.session` | single | session | 严格会话体 |
| `conversation.session.header` | single | session | 标题/操作/视图导航 |
| `conversation.session.header.actions` | list | session | 标题侧会话操作 |
| `conversation.session.header.lineage` | single | session | 谱系面包屑替换 |
| `conversation.session.header.utilities` | list | session | 右对齐会话工具 |
| `conversation.trajectory.images` | single | session | Trajectory 台账图片组渲染器 |
| `conversation.view` | list | session | 会话目标视图 tab（一次渲染一个） |

#### shell / sidebar / details

| Slot | kind | scope | 用途摘要 |
|------|------|-------|---------|
| `root` | single | root | 框架渲染树根洞（先天种子） |
| `shell.overlay` | list | root | 全帧浮动层（所有列之上、滚动容器之外） |
| `sidebar` | single | root | 整个左列 |
| `sidebar.brand.mark` / `sidebar.brand.name` | single | root | 侧栏品牌标/名 |
| `sidebar.footer.action` | list | root | 侧栏脚 Settings 旁的可选操作 |
| `sidebar.settings` | single | root | 侧栏脚设置席位 |
| `sidebar.workspaces` | single | root | 工作区/会话浏览区 |
| `sidebar.workspaces.directoryFlow` | single | root | 浏览区下目录流洞 |
| `details` | single | session | 右侧详情列（布局展开时显示） |

#### settings.*

| Slot | kind | scope | 用途摘要 |
|------|------|-------|---------|
| `settings.section` | list | root | **每个条目一整个设置页**（mnemon 页即此） |
| `settings.general.item` | list | root | General 分区内单条偏好行（无需整页的设置加位） |
| `settings.plugin.item` | keyed | root | 插件配置区内单插件卡片 |
| `settings.plugins.tab` | list | root | Plugins 设置区内的一个页面 |
| `settings.models.footer` | list | root | 模型页 provider 行之后的扩展区 |
| `settings.models.provider-card` | keyed | root | provider 卡片的适配器扩展区（entryKey=settingsNs） |
| `settings.onboarding` | list | root | 设置功能贡献的引导步骤 |
| `settings.header` | single | root | 面板标题文本 |
| `settings.action` | list | root | 内容列头 Close 前的操作 |
| `settings.close` | single | root | 关闭按钮的可访问标签文本 |
| `settings.trigger` | single | root | 侧栏脚触发行内容 |

#### tool.*

| Slot | kind | scope | 用途摘要 |
|------|------|-------|---------|
| `tool.call.toolview` | keyed | session | 按工具名 key 的原子工具调用视图 |
| `tool.view.cordis` | keyed | session | `cordis_run` 卡内的交互 Package 区（动态 Client 代码注册 `key:'self'`，Guard 绑定到当前 Plugin/Package） |

### 3.3 已确认的占用者示例（消费者扫描）

对 `ctx.slots.inject("...")` 全包扫描（编译产物中出现的调用点）：

| Slot | 已确认占用者（包） |
|------|------------------|
| `conversation.composer` | ui-user-questions（问询/计划审阅卡）、ui-approval（审批卡） |
| `conversation.composer.dock` | ui-model-selection 等 |
| `conversation.chat.turnTail` | ui-deliverables（行 444-445） |
| `conversation.chat.node` | ui-chat（多个内置 node kind） |
| `conversation.view` | ui-trajectory（id 'trajectory'，order 10，`dsh-client-ui-trajectory/lib/client.js:8106-8133`）；chat 为默认视图 |
| `conversation.session.header.{actions,utilities,lineage}` | ui-session 等 |
| `settings.section` | ui-settings 各功能页；**mnemon**（id 'mnemon'，order 20，`PROFILE/dsh-mnemon/lib/client.js:12374-12408`） |
| `settings.general.item` | ui-theme（外观+字号两行，`dsh-client-ui-theme/lib/client.js:1490,1505`）、ui-conversation（Enter 行为行 15752-15763）、permission-presets 等 |
| `tool.call.toolview` | 各工具呈现（ui-tool 等） |
| `conversation.input.dock` / `conversation.input.plan` | ui-jobs / ui-plan（client.js:122） |
| `sidebar.workspaces.directoryFlow` / `conversation.hero.workspace.directoryFlow` | ui-workspace（目录选择流） |

### 3.4 theme token 体系

**定义处**：`dsh-client-ui-theme/lib/client.js:1050`（`design_platform_css_default`，内嵌 CSS 字符串）。

| 层 | 数量 | 说明 |
|----|------|------|
| `--dsw-static-*` 原始色板 | 73 个变量（浅色块） | 六个色阶系列：amber / blue / deepseek / green / red / neutral / neutral-bluish（行 1050 CSS 原文） |
| `--dsw-alias-*` 语义别名 | 78 个 | 分组：bg(13)、border(7)、brand(4)、button(15)、interactive(5)、label(9)、markdown(8)、scrollbar(4)、state(11)、toast(1)、tooltip(1) |
| `--dsw-specific-*` 组件级 | 11 个 | bubble/input-major/login-input/menu/selector/sidebar-*/tip 等 |

- **明暗切换**：浅色 = `body`，深色 = `body[data-ds-dark-theme]` 属性选择器（同一 CSS 字符串内两块）；另有 shiki 代码高亮变量与滚动条变量（行 1053, 1059）。
- **官方扩展面**：`BUILTIN_INSPECT_TOKENS`（行 1128 起）只登记 **13 个**带描述 token（bg-base/layer-1/layer-2/overlay、border-l1/l2、brand-primary、label-primary/secondary、state-error/success/warn-primary、specific-sidebar-fill），全部 `requiresLightAndDark: true`——这是 `Theme.listTokens` Inspect 与第三方主题的文档化契约。
- **服务 API**：`ctx.provide("theme", theme)`（行 1469）；`theme.register(definition)`（行 1332，注册带 alias token 覆盖的第三方主题 id）；`theme.overrideTokens(source, tokens)`（行 1360，把部分 token 覆盖层叠加进活动快照，按 seq 顺序折叠）。
- **持久化**：`ui-theme` 设置命名空间（preference + 字号）写入 `~/.dsh/settings.yaml`（实测 `ui-theme: {preference: light}`）；宿主在 index 响应中嵌入调色板引导（插件前调色板，README.zh.md 概述节）。

### 3.5 Web 路由与页面注入

#### 3.5.1 webServer 服务（`dsh-host-webserver/lib/index.js`）

| API | 签名 | 出处（行号） |
|-----|------|------------|
| 路由注册 | `register({kind:'exact'\|'prefix', path, handler}): Disposer` | 行 176 |
| upgrade 注册 | `registerUpgrade({path, handler})`（精确匹配） | 行 190 |
| 回退席位 | `registerFallback(handler)`（唯一；二次注册抛错） | 行 205 |
| index 转换 | `tapIndex(transform)`（原始 HTML 变换） | 行 219 |
| index 渲染 | `renderIndex(html)` = 注入行渲染 + 依序 tap | 行 360-361 |
| 注入事件 | `webserver/index-inject`（每次 `collectIndexInjections()` 发一次，订阅方推行；`script-preload` 行渲染为 preload 链接） | README「注册路由」节 |

**匹配顺序（固定）**：全表精确 → 最长前缀 → 回退 handler；upgrade 仅精确匹配，未命中直接关连接。handler 抛错 → 400 并告警（不退进程）。`host` 仅接受 `127.0.0.1` 或 `0.0.0.0`。

**谁注册了什么（A）**：

| 注册者 | 路由 | 出处 |
|--------|------|------|
| `dsh-client-modules` | prefix `/plugins`（每个客户端插件 bundle）+ index 注入行（`window.__DSH_BOOT__` 启动图） | `dsh-client-modules/lib/index.js:480-487` |
| `dsh-api-gateway` | `/api` 桥（Remote 传输） | README 分层说明 |
| `dsh-host-frontend-static` | 回退席位（SPA dist 服务 + `renderIndex`） | README「回退席位」 |
| `dsh-web-app` | Web GUI 应用层（token → 签名 cookie 认证、Host/Origin 检查） | `dsh-web-app/README.zh.md` 概述 |
| 用户插件 dsh-ldvh（先例） | prefix `/ldvh/api` + `/ldvh/`（SPA），另有不受 webEnabled 开关影响的 `/ldvh/state` 前缀 | `PROFILE/dsh-ldvh/lib/index.js:119-131, 154` |

#### 3.5.2 插件自有页面与原生视图 tab 的关系

| 通道 | 机制 | 与 LDVH 的关联事实 |
|------|------|-------------------|
| **原生视图 tab**（`conversation.view`） | list slot；条目 `{id, order, label}`；ui-conversation 把条目折叠为 tab 并一次渲染一个（`dsh-client-ui-conversation/lib/client.js:15764-15793, 14422`）；traject
ory 为先例 | 会话内的 React 视图，与聊天/轨迹 tab 并列；**无 iframe**，组件直接进 Slot 渲染树 |
| **插件 HTTP 页面**（`/ldvh/` 模式） | `webServer.register({kind:'prefix', path:'/ldvh/', handler})` 服务任意 HTML/SPA；浏览器直接访问或经 iframe 嵌入 | 独立于会话 UI 的整页；dsh-ldvh 已用此形态（`registerWebRoutes`） |
| **会话流内的交互卡**（`tool.view.cordis`） | keyed slot；动态 Cordis Client 包的运行卡内交互区（`key:'self'` 自动绑定） | LDVH 若走动态插件路线可直接获得会话流内 UI |
| **侧栏浏览器 iframe** | **宿主原生无此能力**；本会话可见的 `sidebar_open` 工具与沙箱 iframe（无 `allow-same-origin`）来自社区插件 `dsh-better-sidebar`（`PROFILE/dsh-better-sidebar/lib/client.js:17127-17192`，sandbox token 行 17145-17170） | iframe 打开 `/ldvh/` 页面的组合先例在社区插件，不在宿主 |

**index 注入链（A）**：宿主启动页 = index 注入行（含 ui-theme 调色板引导、client-modules 启动行）→ `renderIndex` → tap 转换 → SPA。插件 bundle 惰性执行（运行 bundle 只注册 factory，首次使用才物化，`dsh-client-modules/README.zh.md` 概述）。

---

## §4 设置面机制

### 4.1 Host 侧：`ctx.settings`（`dsh-settings/lib/index.js`）

**Service**：`settings`（行 269）。服务本身不存储——必须挂载提供方（如 `dsh-settings-file`）。

| API | 签名 | 语义 | 出处（行号） |
|-----|------|------|------------|
| 注册 | `register(ns, schema, {base?, applies?, validate?}) → {get, watch, update, replace}` | 注册即调用方 fiber 上的 effect（dispose 即移除）；重复注册抛错 | 行 311-346 |
| 读取 | `get(): 深冻结快照` / `watch(cb)` | 解析顺序 = schema 默认 → 组合 `base` → 用户文档分节 | 行 316-345 |
| 更新 | `update(ns, patch, expectedRevision?)` | 深合并入**用户层**（绝不进 base） | 行 402 |
| 整替 | `replace(ns, section, expectedRevision?)` | 整体替换用户分节；`replace({})` = 重置回 base/默认 | 行 415 |
| 编辑 | `mutate(ns, ops, expectedRevision?)` | `{op:'set'\|'unset', path}` 序列，按队首时刻分节施加 | 行 430 |
| 描述 | `describe({redactSecrets:true})` | 每 namespace 一条 descriptor：schema、解析值、base/user 分层（user 中出现即用户覆盖）、生效时机、revision；**协议接口必须传 redactSecrets**（剥离 `role('secret')` 字段并枚举只写 slot） | 行 352 起 + README「配置界面」 |
| 便捷接线 | `installSettingsSection(ctx, ns, schema, entry, hooks)` | settings 存在则注册 namespace，消失则回退组合配置 | 行 618-637 |
| 品牌函数 | `settingsNamespace(value)` | namespace 品牌构造 | 行 87 |

**事件**（README「事件与失败」+ 源码行 526, 562）：

| 事件 | 载荷 | 触发条件 |
|------|------|---------|
| `settings/updated` | `(ns, next, prev, source)` | 每次已提交变更后；`source: 'update'`（进程内写）或 `'provider'`（外部编辑）；**解析值深相等绝不触发** |
| `settings/document-updated` | `(ns, revision)` | 原始用户分节变化时（即使解析值没变）——已打开的编辑器靠它得知"继承变覆盖" |

**并发语义**：每 namespace 串行写队列；`expectedRevision` 在队首校验，过期 → `SettingsConflictError`（拒绝而非覆盖）。写入前拒绝 JSON 不兼容数据（Date/Map/BigInt/循环引用）。`settings/document-updated` 在 Remote 转发白名单中（emit 模式，`dsh-api-remotes/lib/types/remote-events.js:26`）。

### 4.2 存储提供方：`dsh-settings-file`

| 事实 | 出处 |
|------|------|
| 默认路径 `<harness home>/settings.yaml`（`$DSH_HOME` 或 `~/.dsh`）；扩展名决定 YAML/JSON | `dsh-settings-file/lib/index.js:26-31` |
| `watch: true`（默认）热发布外部编辑；`debounceMs: 100` | README 最小配置表 |
| 写入保留注释与排版 | README「何时选择」 |

**实测**（A）：`~/.dsh/settings.yaml`（2169 行）顶层 key 即 namespace，实测含：`ui-onboarding`、`dsh-community-market`、`llm-pi-ai`、`agent-default-model`、`session-pin`、`dsh-desktop`、`subagent-default-model`、`ui-theme`、`dsh-better-sidebar`、`agent-presets`、`dsh-sub-cli`、`locale`、`thinking-levels`、`free-search`、`dsh-ldvh`（含 `webRestartNonce: 1`）、`mnemon`（displayMode/taskAgentModel/embedding）、`dsh-rewind-snapshot-cleanup` 等 25+ 个。

### 4.3 Client 侧：`settingsScope` 服务

**定义**：`dsh-client-ui-settings/lib/client.js:1131-1182`（`SettingsScopeBinder`，Service 名 `settingsScope`，行 1145）。

| 事实 | 出处（行号） |
|------|------------|
| `settingsScope.bind({namespace, schema, decode?}) → SettingsScopeController`；scope 绑定在**调用方** fiber 生命周期上 | 行 1170-1181 |
| 持久化模式：`connection.isLoopback ? "host" : "memory"`（非回环页面设置不落 Host） | 行 1173 |
| Controller 提供 `subscribe/getSnapshot`（React useSyncExternalStore 适配）与 `set/unset/setPath/unsetPath/mutate`（内部走 wire `get`/`mutate`） | 行 1040-1123 一带 |
| `SettingsDescribeMirror`：浏览器里唯一的 `settings.describe` 读取器，所有设置消费方从它派生 | 行 1195-1219 |

### 4.4 mnemon 设置页参照摘要

| 事实 | 出处（`PROFILE/dsh-mnemon/lib/client.js` 行号） |
|------|---------------------------------------------|
| **未使用**宿主 `settingsScope.bind`；自实现 `MnemonSettingsScope`（走 `ctx.connection` 的 wire `get`/`mutate` 方法，12s 超时，含串行写队列） | 行 11650-11720（类定义）、12336-12337（两个 scope：`mnemon` 与 UI 命名空间） |
| 设置页注册：`settings.section` slot，id `'mnemon'`、order 20、locale 命名空间、`inject()` 注入 scope/connection/session/workspace/t | 行 12374-12408 |
| 页内可 `settingsScope.setPath(['persistenceStrategy'], ...)` 直写嵌套字段 | 行 9284 |
| 交互面单元按 `interactionSettings` 开关动态注入/撤除各 slot（`INTERACTION_UNITS` 表 + reconcile） | 行 12395-12417 |
| 设置值实际落在 `~/.dsh/settings.yaml` 的 `mnemon:` 分节（实测：displayMode/taskAgentModel/embedding） | `~/.dsh/settings.yaml:2155-2166` |

**对照（宿主自己的用法）**：`dsh-permission-presets` 用 `settingsNamespace("permission")` + `installSettingsSection`（`dsh-permission-presets/lib/index.js:6, 24-25`）；`ui-theme` 用 `ui-theme` 命名空间持久化偏好。两条路线（标准 settingsScope.bind / 自管 wire scope）在生态中并存。

---

## §5 未覆盖范围与信息不足项

| # | 项 | 状态 | 说明 |
|---|----|------|------|
| 1 | 52 个 slot 的**全部实际占用者**清单 | 部分 | 只统计了 `slots.inject` 调用点（§3.3）；个别 slot（如 `shell.overlay`、`settings.models.*`）的占用者未逐一列名 |
| 2 | theme token 深浅色逐项差异 | 未做 | 仅列分组与总数；逐 token 的 light/dark 映射未制表（CSS 原文在 `dsh-client-ui-theme/lib/client.js:1050` 可查） |
| 3 | `dsh-api-gateway` Remote 传输协议细节 | 未深入 | 认证（token→cookie）、stream mux、取消与重连只读了 README 概述 |
| 4 | Electron 表层（file:// + IPC fetch 桥） | 未调查 | webserver README 提及 Electron 经 IPC 桥承载 fetch；未读 Electron 层源码 |
| 5 | 动态 Cordis **Client 半**的 slots/theme 访问 guard 细节 | 部分 | `dsh-cordis-client-runner/lib/client.js:250-266`（guardedSlots 代理 + ledger）已读，完整行为（shadowing priority 语义）未展开 |
| 6 | TUI/ACP/headless 表层的问询承载 | 部分 | 仅从 `dsh-client-ui-user-questions/lib/index.js:5-11` 注释得知工具属 preset 组合（TUI 无 preset 也组它）；TUI 的回答器实现未查 |
| 7 | `webserver/index-inject` 的 `IndexInjection` 行类型完整字段 | 未展开 | 只确认 `script-preload` 行语义；类型定义在 `dsh-host-webserver/lib/injections` 源（编译产物行 9-14 注释） |
| 8 | 会话事件与 Cordis 事件的双轨对应 | 引用上游 | 见 `docs/dsh-host-capability-survey-data.md` §7.1（未结项） |
| 9 | `dsh-connect-workbuddy` 参照物内容 | 未调查 | 按任务指示跳过（存在性已勘误，见 §1.4） |
| 10 | `interaction`（authorization 流）的 UI 呈现包 | 未定位 | `dsh-client-ui-settings-models` 等可能承载；未逐一确认 |

### 信息不足项的置信度说明

- 本报告所有 A 级结论均给出 文件+行号 或 README 原文位置；行号基于 app.asar.unpacked 当前版本（Desktop 版随附），版本升级后行号会漂移。
- `AskUserQuestion*` 系列类型为 Inspect 目录内嵌声明文本转录（`dsh-tool-cordis/lib/index.js:5440-5470`），与 dsh-user-questions README 交叉印证一致（B→A）。
- 【推断 C】仅一处：问询路径能否用 user/message plugin 注入补充留痕（§2.2.5），未实测。

---

## 附录：关键源码速查表

| 主题 | 文件（HOST 前缀下） |
|------|--------------------|
| 问询服务 | `dsh-user-questions/lib/index.js`（服务 32-79；README 全文） |
| ask_user_question 工具 | `dsh-tool-ask-user/lib/index.js`（15-113） |
| 问询 Web 渲染 | `dsh-client-ui-user-questions/lib/client.js`（planReviewOf 38-56；QuestionFlow 466-787；remote 监听 880） |
| 计划模式 | `dsh-plan-mode/lib/types/index.js`（exit_plan_mode 272-361；README 全文） |
| 审批服务 | `dsh-user-approval/lib/index.js`（85-203） |
| 审批 Web 卡 | `dsh-client-ui-approval/lib/client.js`（47-101, 265-284） |
| 工具拦截网关 | `dsh-tools/lib/types/index.js`（prepareExecution 859-899；serviceAsk 1078-1115） |
| 沙箱策略 | `dsh-sandbox-policy/lib/index.js`（全 156 行） |
| 升权共享实现 | `dsh-sandbox/lib/index.js`（29-111） |
| bash 升权广告 | `dsh-tool-bash/lib/index.js`（124, 130, 239-295, 390） |
| 权限预设 | `dsh-permission-presets/lib/index.js`（全 323 行） |
| 凭据授权流 | `dsh-authorization/lib/index.js`（全 248 行） |
| Remote 转发白名单 | `dsh-api-remotes/lib/types/remote-events.js`（13-28） |
| Inspect 总目录（服务/事件/类型声明） | `dsh-tool-cordis/lib/index.js`（类型 5420-7700 一带；事件 4770-5300 一带） |
| Slot 目录数据源 | `dsh-cordis-client-runner/lib/client.js`（CLIENT_SLOT_API 2103 起；Slots inspect 4095-4131） |
| Slot 注册表 | `dsh-client-ui-slots/lib/index.js`（47-433） |
| theme token | `dsh-client-ui-theme/lib/client.js`（1050 CSS；1128 inspect；1332/1360 服务） |
| webServer | `dsh-host-webserver/lib/index.js`（176-361；README 全文） |
| 客户端 bundle 路由 | `dsh-client-modules/lib/index.js`（440-495） |
| 设置服务 | `dsh-settings/lib/index.js`（269-637；README 全文） |
| 设置文件提供方 | `dsh-settings-file/lib/index.js`（26-73；README） |
| Client settingsScope | `dsh-client-ui-settings/lib/client.js`（1131-1219） |
| pending 交互路由 | `dsh-client-ui-session/lib/client.js`（72-177） |
| 动态 Host 沙箱门禁 | `dsh-cordis-host-runner/lib/index.js`（600-674） |
| mnemon 设置页（参照） | `~/.dsh/profiles/desktop/node_modules/dsh-mnemon/lib/client.js`（11650-11720, 12336-12417） |
| dsh-ldvh Web 路由先例 | `~/.dsh/profiles/desktop/node_modules/dsh-ldvh/lib/index.js`（113-170） |
| 实测设置文档 | `~/.dsh/settings.yaml`（namespace = 顶层 key） |
