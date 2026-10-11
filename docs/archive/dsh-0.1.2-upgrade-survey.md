# DSH 0.1.2-rc.1 升级调查（desktop 2.0.5）

> 性质：**开发设计输入（非规范、非事实对象）**——上游重大更新的全量差异记录，供四份宿主盘点文档重定基线与 LDVH 草案修订引用。
> 基准：`~/.dsh/profiles/node_modules/@deepseek-ai/`（符号链接树）→ 桌面解包 `/Applications/DSH Desktop.app/.../node_modules/@deepseek-ai/`，均确认 **@deepseek-ai/dsh 0.1.2-rc.1**（desktop 插件 2.0.5）。
> 方法：三路独立核对（数据面/交互呈现面/API 参考）+ 主控第一手源码快验。旧基线：dsh-platform-facts.md=0.1.1-rc.2（2026-08-24）、interaction-ui 盘点=旧解包（2026-09-05）、host-reference=旧解包（617 行）。npm 考古基准：0.1.1-rc.1/rc.2 tarball。
> 权威签名源：`dsh-tool-cordis/lib/index.js` 内嵌机器可读目录（**SERVICE_API 68 服务 / EVENT_API 65 事件**，gen-cordis-api 生成、与官方 catalog 同源）；`dsh-base/cordis.patch.yml`（83 行插件 row）= base 组合清单锚点。

## 0-bis. 事件计数的三个口径（数据面报告 npm 考古）

| 口径 | 数量 | 说明 |
|---|---|---|
| 相对旧盘点文档（46 唯一键） | **+5** | subagent/model-selection-policy + tool-workflow/* 四件 |
| 相对 npm 0.1.1-rc.x（48 键） | **+3** | subagent/model-selection-policy、model/selection、session-log-deepseek/delivery-accepted——tool-workflow/* 在 npm 0.1.1 已存在，旧文档漏记 |
| 当前白名单文件 | **51 唯一键**（Set 恰 51 行无重复，已改生成文件 gen-persistence-catalog.ts） | index.js 914–966 同步副本 51 条 |

**ignorable 豁免（新前向兼容机制）**：assertEventsSupported 现接受 `event.ignorable === true` 的未知事件——**白名单外事件可持久化**（LDVH 插件自定义会话事件的官方通道）。

## 0. 执行摘要：LDVH 影响面

| 影响等级 | 事项 |
|---|---|
| 🔴 **直接命中设计** | ①`registerContinuableSetup` **已删除**（底座白名单档候选实现不存在了——遗留 7 的实测对象没了，但有继任者见 §2.1）；②`followup`/`reportFrom` 已删除（审议/执行草案的宿主承载表引用）；③`skills.load`→`get`；④restrict **升级为执行层强制**（dsh-sub-cli 事故根因已修）；⑤新增 `interrupt_agent` 模型面工具+`ctx.subagents.interrupt(authority)`（执行用法点 4「turn-stopping 等价物」有了直接承载）；⑥goals 四相位（active/paused/blocked/complete）+pause/resume/clear |
| 🟡 **新能力可用** | ①`toolFilter:{allow,deny}` 成为持久化子代理描述符一等字段（白名单档新候选）；②`listChildren/listDescendants`（**委派送达对账轮询的机械基础**——本次「代理完成不送达」问题的机制解法入口）；③`ctx.uiConversation`（自定义聊天节点——Web 呈现新通道）；④jobs 家族（后台任务一等公民）；⑤workflow 一等公民（引擎+工具+事件+UI）；⑥schedule/invariants/webhook/acp/typert 新体系 |
| 🟢 **零破坏确认** | Slot 52 不变；userQuestions/approval/pre-execute 三态/settings.section/webServer/conversation.view/theme 三层全部不变；**LDVH 插件代码 grep 零依赖已删 API**（registerContinuableSetup/followup/reportFrom/skills.load/session.event 全无匹配）；`/ldvh/` 前缀路由不受影响 |
| ⚪ **悬案维持/升级** | TokenMeter 仍无 budget API（但 measure()+tokenUsage/contextPressure/contextBreakdown 三投影构成自建预算数据面——「须自建」结论不变、自建难度降）；Stop 事件→`agent/turn-stopping` 仍在且**监听者可经 inbox 注入续轮**（比「无 Stop 事件」旧结论强——turn 结束反射三件套：turn-stopping+inbox 注入+turn/end）；**ignorable 豁免=LDVH 自定义会话事件可持久化的官方通道**；team/* 事件仍无发射器（声明未实现维持） |

## 1. 事件面（主控第一手精确 diff）

`dsh-session/lib/types/known-event-types.js`：**46 → 51**（文档口径 47 是把 compaction/summary 变体计 1 的差异）。新增 5 个：

| 新事件 | 含义 |
|---|---|
| `subagent/model-selection-policy` | 子代理模型选择策略事件化（配 dsh-subagent-default-model 模型池机制 + `subagentModelSelection` 服务 + `list_subagent_models` 工具） |
| `tool-workflow/agent-start` / `agent-end` / `run-start` / `run-end` | 工作流运行/代理起止——workflow 从服务升格为模型可调工具+事件流+UI |

（SERVICE_API 目录口径 65 事件含更多：agent/request waterfall、session/flush parallel、tools/* 三瀑布、fs/*-intent、approval/request、user-questions/request、goal/changed、subagent/{start,end,provider-added,provider-removed}、workflow/*、api-session/*、commands/change、agent-preset/selected 等——入档以 dsh-tool-cordis 目录为准。）

## 2. subagents 服务全量重写（API 参考报告核对）

### 2.1 新 API 形态

```js
await ctx.subagents.startContinuable({ provider, label, childId?, signal,
  request: { parent, prompt: ContentBlock[], persona?, toolFilter?, maxDepth?, agentOptions? } })
  → { childId, messageId }        // 旧形态 {provider?,model?,prompt,signal} 已废
await ctx.subagents.sendMessage(sender, targetId, content, { signal }) → messageId
  // 替代旧 followup：模型署名消息、子↔父双向、运行中目标最近步边界准入、空闲目标开新轮
ctx.subagents.interrupt(targetSessionId, authority)
  // authority 结构化：{kind:'user',parentSessionId} | {kind:'ancestor',agent}
await ctx.subagents.drainContinuableDescendants(parents) / drainContinuableChildren(parent, childIds)
ctx.subagents.listChildren(parentSessionId, signal?)    // 不加载 Agent 的持久化直查
ctx.subagents.listDescendants(rootSessionId, signal?)   // 稳定前序全树
ctx.subagents.registerProvider(provider) / getProvider(name) / list()
await ctx.subagents.start(name, request) → SubagentRun  // one-shot 委派
// ❌ followup / reportFrom / registerContinuableSetup 全库 0 匹配——彻底删除
```

配套工具：`send_message` / `interrupt_agent`（dsh-tool-subagent-control，模型面全局名）、`list_subagent_models`；provider 实现三件（fork/spawn-in-process/in-process-driver）。

### 2.2 toolFilter + tools.guard（白名单档新候选，主控+数据面双源核验）

- **持久化描述符一等字段**：`toolFilter:{allow,deny}`（parse 强校验：allow/deny 至少一个、字符串数组；TOOL_FILTER_KEYS 闭集）；
- **组合应用机制**（数据面报告，dsh-subagent:699–712）：startContinuable 的 persona+toolFilter 在子代理**未发布创建窗口**经 `applyChildComposition` 执行——子先 join 父 preset 组合（composeFrom）→注册 delegation 范围→persona 节→`childCtx.tools.restrict(toolFilter)`；descriptor 事件持久化该组合供冷恢复；
- **restrict 语义精化**（重要）：restrict 只遮蔽该 scope **继承面**（全局+祖先/preset 层），**本层注册不受限**；且必须经 agent.ctx（全局 restrict 抛错）——"per-child capability filter" 正是设计场景；执行链 `resolveExecution` → `get`（view 经 restrictions 解析）→ 不可见工具**执行器报 UNKNOWN_TOOL**——0.1.1 时代「纯 schema 掩蔽」已升级为执行层拒绝；
- **`ctx.tools.guard(fn)`（宿主原生执行期单调拒绝层，新）**：pre-execute 放行后运行，任一 guard 返回 reason 即拒绝、**无人能强制放行**；经 agent.ctx 注册仅对该 agent 生效——**dsh-sub-cli 事故后自建的那种 guard 现在是宿主原生 API**（dsh-tools:2807–2832）；
- **委派策略钉死**（附带发现）：captureDelegatedPolicyOverrides 把子代理审批策略**钉死 'never'**、仅继承父显式沙箱 override（source:'delegation' 事件写子日志）——子代理默认不可再弹审批，越权面收窄；
- **白名单档新表述（替代遗留 7 原案）**：双缝——①toolFilter 声明式遮蔽（含 preset 面）+②tools.guard 执行期拒绝；实测项=toolFilter 覆盖面（preset 贡献工具/孙代传播）+guard 在 LDVH 语境的复现实测；
- **遗留风险（事故记忆对照）**：孙代理=新 scope，toolFilter 是否跨代传播未验；dsh-sub-cli 的执行层 guard 硬 allowlist 仍为纵深防御必要层（现在可平替为原生 tools.guard）。

### 2.3 对 LDVH 底座/用法草案的直接影响

1. **遗留 7 改写**：实测对象从 registerContinuableSetup 改为——①toolFilter（spawn 时声明+执行层 UNKNOWN_TOOL）；②dsh-sub-cli guard 模式复现（纵深）；实测问题从「API 能否介入工具注册」变为「toolFilter 覆盖面（preset 贡献工具/跨代传播）+ 执行层拒绝实测」。
2. **委派送达对账**（本次会话两次事故的机制解法）：`listChildren/listDescendants` 直查（不加载 Agent）+ `drainContinuable*`——主控对账轮询的宿主原生基础，无需自建轮询底座。
3. **中断/交还**：`interrupt_agent` 工具 + 结构化 authority + 「排队消息保持 parked、子代理保持可用、已完成是合法 no-op」语义——执行用法点 4 的「turn-stopping 等价物」直接承载。
4. **审议草案 §3 宿主承载表改写**：followup→sendMessage；封存回传→sendMessage+子终态（reportFrom 没了，封存层自建时改走 sendMessage 或 start one-shot 返回值）。

## 3. goals 家族（主控第一手核验 + API 报告）

- **四相位**：active/paused/blocked/complete（旧盘点只有三态——多了 paused）；
- edit/complete/block 收敛为 `(agent, ref:{id,revision}, …)`；block reason=`{code:小写kebab, message}`；**edit 不能改相位与 blocked reason**（结构化防线）；clear 留墓碑；Remote 装饰 create/edit/pause/resume/complete/clear；
- goal-round-driver：**race fences 源码确认**（`Install automatic same-session continuation and its race fences`，attempt 状态机）——底座遗留 3 的核对入口落地；
- `dsh-tool-goal` 注册 create_goal/get_goal/update_goal 模型面工具；`dsh-command-goal` /goal 命令；UI 家族见 §6。

## 4. 服务与 API 变更清单（API 参考报告全量）

**❌ 断裂**：subagents（§2）；goals ref 形态+四相位；skills `load`→`get(name,options?)`+provider 形态 `{name,list,get}`+`snapshot(options)`；jobs create→start/abort→kill；settings/updated **serial→emit(ns,next,prev,source)**；namespace 五键改名（session/skills/fileReferences/credentials/settings → sessionController/sessionSkillCatalog/sessionFileReferences/credentialsController/settingsController，经 `ctx.remote.*`）；tools 服务归属包 dsh-tool-cordis→**dsh-tools**；Session 对象无 flush/event（flush=ctx.sessions.flush；session/event 由 append 自动派发）；事件类型 model/message→**assistant/message**；Agent.options 无 cwd（在 session header/meta）。

**➕ 新增 ctx 服务键（本部署实际存在 26 个）**：userQuestions、approval、web（search/fetch 后端）、workflowEngine(start→WorkflowRun)、typert(+typertGateway/remote)、agentPresets(17 法)、agentDefaultModel、subagentModelSelection、permissionPresets(5 法)、sessionTitle、shell/shellEnv/subprocess/terminals、webhookRuntime、workspaceRegistry(+workspaceController/directoryPickerController)、authorization、codeRuntime、invariants、storageDomain、fileReferences、deepseekLlmApiExtensions 等。（agentTeams/e2b/lsp/inspector 四键**目录有、部署无**。）

**➕ 既有服务新方法**：sessionPersistence+listSnapshots+完整抽象面（13 法）；sessionQuery 15 法（observeSession/searchSessions/searchEvents…）；sessions+fork；systemPrompt+getSectionOrder/getContextOrder；webServer+registerUpgrade/tapIndex/applyIndexTaps/collectIndexInjections/renderIndex；agents+8 法（currentInitiator/withInitiator/setFactory/enter/announce/isOwnedBy/roots…）；sessionProjections 类型化注册+可选 wire+10 读法；PromptAssembly 四数组（sections/contexts/tools/variables）。

**事件 14→65**（目录口径）：关键新增 agent/request(waterfall，替换冻结 LLM 调用配置)、agent/status、agent/error、agent/inbox/{inserted,claimed,discarded}、session/flush(parallel)、approval/request、user-questions/request、tools/{pre-execute,execute,post-execute}、fs/{edit-intent,write-intent}、llm/stream、subagent/{start,end,provider-added,provider-removed}、workflow/*、api-session/*、commands/change、system-prompt/change、skills/change、tools/change、authorization/settled、agent-preset/selected；session-start 载荷+source('startup'|'resume'|'clear'|'compact')；pre-step next() +startsRequestSeries。

**失效符号链接（运行时 profile 4 个）**：dsh-agent-spine-demo、dsh-client-runtime、dsh-host-apiproxy、dsh-tool-subagent-report——已不随 desktop 2.0.5 发布。

## 5. 交互面（交互呈现报告全量）

**✅ 全部不变**：Slot 52（两基准逐字节一致；新 UI 包零新 Slot 全注既有）、SlotCore 契约、theme 三层（73/78/11）、13 inspect token、userQuestions.ask 全套、intent.kind 仍仅 plan-review、ask_user_question 五字段、approval 全套（二值审批卡）、pre-execute 三态、exit_plan_mode、pending 优先级、settings.section、webServer 核心 API、conversation.view 注册形态（+`ctx.uiConversation.views.register` 数据 builder 补充）。

**❌➕ 占用者表过时/新增**（3 处过时+5 处新增）：ui-jobs 迁 conversation.session.header.actions；composer.dock→ui-chat StatsLine；composer+ui-subagent(chain -10)；settings.section+ui-agent-preset；header.actions+ui-schedule；chat.node+ui-goal('command-input')+ui-workflow-run('workflow-run')；lineage+ui-subagent；input.dock+ui-goal('goal')。

**➕ 六个新 UI 包**：deliverables（turnTail 产出文件行+行内引用转链接+Host 半注册系统提示词段）、goal（composer 条带+四相位移+Remote CAS）、jobs（头部动作+jobsBySession 只读镜像+job_list/job_output/job_kill）、schedule（头部动作+projection+默认禁用）、workflow-run（独立聊天节点三层 disclosure+tool-workflow 回放）、subagent（谱系面包屑+只读编辑器+@引用）。

**➕ `ctx.uiConversation`（文档未记录，重要）**：`events.register/registerFallback`（ConversationNodeDefinition——**自定义聊天节点加法通道**）、`views.register`、`binding(sessionId)`、`imageUrl/peekImageUrl`。

**➕ commands 体系**：`ctx.commands.register`（不产生模型消息、agent-scoped 遮蔽、recordInput、input.images）+`ctx.commandUi`（popupSelect/decorate）；清单 /plan /permission /goal /compact /feedback。

**➕ webServer index 注入**：六类行（global/script/script-src/script-preload/style/html）+`__DSH_BOOT_READY__` 尾脚本。Remote 白名单新增 cordis/request-run-resolved、cordis/dynamic-package/retract、cordis/inspect-query(-resolved)、commands/change、agent-preset/selected 等。

## 6. 新体系入档（API 报告）

- **jobs**：`ctx.jobs`（start(spec)/get/list/kill/wait/onJobDone/onJobsChanged/attachController）；JobSnapshot={id,kind,label,status,detail,startedAt,finishedAt,...}；
- **schedule**：非服务，插件（projection+schedule_create/list/delete 三工具+schedule/change 事件+idle 驱动注入）；
- **invariants**：`ctx.invariants.register(packageName,installer)`（子 fiber 运行、fail 抛 InvariantError、package allow/blocklist）；
- **typert**：`ctx.typert`（register/get/resolve/list/getPackage/toJSONSchema）+typertGateway+remote——0.1.2 反射体系骨架（@Remote 装饰、wire 命名空间）；
- **webhook**：`ctx.webhookRuntime.register(rule)`（run 返回 SessionRequest 即自动建根会话）+GitHub 适配；
- **acp**：非服务，ACP 适配插件（编辑器把 DSH 会话当 ACP agent）；
- **mcpClient**：非 ctx 服务，组合行插件（每行连一个 MCP server 注入 tools）。

## 7. 待办（本次派生）

| # | 事项 | 去向 |
|---|---|---|
| U-1 | 四份宿主文档重定基线（0.1.2-rc.1）+ 按本调查逐节修订（host-reference §6 subagents 整节重写等） | 下一批文档工作 |
| U-2 | 底座 v5：遗留 7 改写（toolFilter+guard 双层）、§0.4 白名单档注新候选、§1.1/§1.2 API 引用更新 | 底座 v6 修订 |
| U-3 | 执行用法草案：点 4（interrupt_agent 承载）、宿主承载表、goals 四相位对齐 | v4 修订 |
| U-4 | 审议用法草案：§3 宿主承载表（followup→sendMessage、封存层新承载） | v3 修订 |
| U-5 | 八维表：47→51/65 事件、goals 家族、悬案结论刷新 | 随下一轮串联 |
| U-6 | toolFilter 实测（覆盖面/跨代传播/UNKNOWN_TOOL 行为） | 实现期（替代原遗留 7） |
| U-7 | 4 个失效符号链接清理 | profile 维护 |

## 8. 证据锚点

| 断言 | 证据（0.1.2-rc.1 路径） | 验证者 |
|---|---|---|
| 事件 46→51+5 新事件 | dsh-session/lib/types/known-event-types.js（主控 grep diff） | 主控 |
| registerContinuableSetup/followup/reportFrom 删除 | 全库 0 匹配（API 报告+主控 grep 复核 plugin/） | 双验 |
| toolFilter 持久化字段+强校验 | dsh-subagent/lib/index.js:438-480 | 主控 |
| restrict 执行层强制（UNKNOWN_TOOL） | dsh-tools/lib/index.js:2891-2911/3026-3032（resolveExecution+createExecution visible） | 主控 |
| scoped restrict 在子创建窗口 | dsh-subagent-spawn-in-process/lib/index.js:15-29 | 主控 |
| goals 四相位+edit 不改相位 | dsh-goal/lib/index.js:43/92/185 | 主控 |
| goal-round-driver race fences | dsh-goal-round-driver/lib/index.js:54/117-118 | 主控 |
| interrupt_agent 语义（parked/可用/no-op） | dsh-tool-subagent-control/lib/index.js:62-67 | 主控 |
| tools.guard 执行期单调拒绝（原生） | dsh-tools/lib/index.js:2807-2832 | 数据面子代理 |
| per-start 组合应用（composeFrom→restrict） | dsh-subagent/lib/index.js:699-712 | 数据面子代理 |
| 委派审批钉死 never | dsh-subagent/lib/index.js:723-747 | 数据面子代理 |
| agent/turn-stopping inbox 续轮语义 | dsh-agent-loop/lib/index.js:568-576 | 数据面子代理 |
| ignorable 豁免（白名单外事件可持久化） | dsh-session-persistence/lib/index.js:1297-1300 | 数据面子代理 |
| TokenMeter 三投影（自建预算数据面） | dsh-token-meter/lib/index.js:586-677 | 数据面子代理 |
| npm 考古（0.1.1=48 键、tool-workflow 已存在） | npm tarball 实测 | 数据面子代理 |
| Slot 52/交互面不变+占用者变化+六 UI 包+uiConversation | dsh-cordis-client-runner/lib/client.js:2135 等（交互报告全量） | 子代理 |
| 68 服务/65 事件目录+26 新键+断裂清单 | dsh-tool-cordis/lib/index.js SERVICE_API/EVENT_API（API 报告全量） | 子代理 |
| TokenMeter 无 budget API | dsh-token-meter/lib/index.js:671-711（仅 measure/estimateMessage） | 主控 |
| LDVH 插件零依赖已删 API | plugin/ grep 全无匹配 | 主控 |
