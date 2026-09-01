# dsh_workflow 单项调研：可治理多 Agent Workflow 层对 LDVH 的参考价值

> 性质：开发设计输入，非规范、非事实对象。
> 调研对象：[omdsh-dev/dsh_workflow](https://github.com/omdsh-dev/dsh_workflow)（npm 名 `@dsh-external/workflow` v0.1.2，作者 icetomoyo，MIT）。已迁出至 `/Users/dmh2002/DshProject/dsh_workflow`（2026-09-01 克隆快照，5 commits，2026-08-13）。
> 方法：子代理深读 + 主控第一手源码核验（关键结论均有 file:line 证据；子代理报告已回收并与主控核验交叉印证一致，其增量发现——Session 级投影、cacheIdentity 五元组、catalog `link()` 发布、run.json 全量重写、scoped-review 评审细节、attempt 语义差异——已并入正文）。
> 与前一份调研（`investigation-report-context-plugins.md`，七个上下文类插件）的关系：**本项不属于"上下文管理"赛道**——它做的是执行编排与流程治理（可生成、可保存、可恢复、可审计的多 Agent 工作流），对应 LDVH 的执行维/写维/遵守维/复核维，与七插件调研的读维焦点互补。
> 对照框架：LDVH 八维（`specs/02`）、v5 四支柱（`docs/v5-handoff.md` §4：插件五件套 + Team 队长式执行 + turn/end 锁恢复 + 记忆预热）、Helper 受控写入判据（范围/身份/授权/基线/变化/回读/未验证）。

---

## 0. 执行摘要

1. **这是目前调研过的 DSH 插件里"治理密度"最高的一个**：审批分级、能力预检、运行时硬限制、证据化验证、不可变快照、append-only 事件图、effect cache 复用门槛、一次性显式授权——几乎每一项都与 LDVH 八维中的某一直接对应。它证明了"在 DSH 之上做受治理的执行层"在工程上完全可行。
2. **对 LDVH 最直接的价值是执行维四件套**：durable run graph（`run.json` + `events.jsonl` append-only + 不可变 capsule 快照）、effect cache 的"仅 completed 且零验证告警才可复用"门槛、有界同 actor 修复循环（最多 2 次验证修复 + 1 次结构化输出修复）、按 run-id 重跑/续跑的快照语义——可直接映射到 WorkCase 执行模型的 attempt 边界与冷恢复设计。
3. **验证证据模型是复核维的现成范本**：读路径必须被观测（子代理实际读过）、变更必须有"成功的 mutation 工具调用 ∧ Git workspace 指纹变化"双证据、每个 required path 有前后内容指纹对照、预备性文本（"我接下来会…"）直接拒绝——比"测试通过"更接近"实际发生了受控变化"的证明。
4. **一次性授权机制值得 LDVH 遵守维研究**：`/workflow create` 的显式意图授权绑定具体 user message id、turn 边界自动失效、消费即删除、失败脚本保留授权供修正重试——一个介于"工具参数级授权"与"Human Gate"之间的轻量形态。
5. **最大风险信号：兼容性钉在一个非主线 DSH 快照**（`dsh2026/test-icetomoyo` 分支，DSH `0.0.1-rc.2`，2026-08-12）——比其他已调研插件钉的 0.1.x 线旧一代；五 commits 单作者一天发布。工程成熟度与长期兼容性需分开评估。
6. **与 AgentTeams 的分工启示**：AgentTeams 是会话内任务 DAG（attempt_id 单调令牌、成员池），dsh_workflow 是跨会话持久流程库（catalog、快照重跑、effect cache、验证证据）——LDVH 的"WorkCase 执行模型"恰好需要两者的并集：Team 的调度 + workflow 的持久化与治理。

---

## 1. 项目概况

| 维度 | 现状 |
|---|---|
| 定位 | "把 DSH 的一次性多 Agent 调度，升级为可生成、可保存、可治理、可观察、可恢复的 Workflow 层"；自称 KodaX workflow parity（行为对标，不复制其受限许可源码，`reference.json` 记录参考 commit） |
| 规模 | src 12 模块共 5435 行 TS（engine.ts 1453 行、index.ts 698、scoped-review.ts 533、runtime.ts 497）；10 个 spec 文件 |
| 测试 | 11 个 spec 文件共约 2609 行；静态计数 113 处 `it(` + 10 处 `it.each`/`test.each` 参数化（README 徽章称 179 passing，应为运行时展开数，未实测）；全局覆盖率阈值 80%（语句/分支/函数/行，vitest.config.ts:28-34） |
| 文档 | 五篇 docs 分工明确：ARCHITECTURE（组件+11 条不变量）、SECURITY（三类信任模型）、CONFIGURATION、KODAX_PARITY（验收矩阵）、FEATURE_LIST |
| 发布 | 5 commits，2026-08-13 一天完成，单作者 icetomoyo；`compatibility.json` 钉 `dsh2026/test-icetomoyo` 快照分支 commit `7b9644f…`（DSH 0.0.1-rc.2） |
| 形态 | 官方 bundle（`cordis.patch.yml` insert 一行 `dsh-external-workflow`），零核心 patch，构建产物入库（git 安装免编译） |

**11 条架构不变量**（`docs/ARCHITECTURE.md:35-47`，值得整段研读）摘录：capability 脚本拿不到宿主对象（每次跨界都是分离 JSON）；task handle 只在 `ctx.subagents.start()` 发布子代理后才返回；每条 agent-start 边恰有一条 agent-end 边；每个子代理必有显式 AgentResult；pause 阻断未发布任务（含信号量已排队）；run-id 重跑执行不可变快照、saved-name 重跑执行当前条目；trusted-local 仅在显式授权后 import；provider/model/isolation/verification 字段**从不"接受后忽略"**（不接受就 fail）；部署级信号量跨所有 run 共享；Cordis 卸载时 abort 并等待所有活跃 run 退出。

---

## 2. DSH 接入机制（第一手核验）

### 2.1 服务与工具面

- **服务注册**（`src/index.ts:688-694`）：`ctx.plugin(DynamicWorkflowService, { config, subagents: ctx.subagents, approval?, jobs?, userQuestions? })`——三个可选服务用 `ctx.get` 探测后条件传入（缺席时降级而非崩）；`ctx.inject(['dynamicWorkflows'], ...)` 等服务就绪再装表面。Cordis Service 注册 `ctx.dynamicWorkflows`（`declare module` 扩展 Context 类型，service.ts:23-27），并经 `declare module 'dsh-jobs'` 扩展 `JobKindMap { workflow }`（service.ts:29-33）——插件向宿主 job 注册表声明自己的 job 种类。
- **Session 级投影（后台 run 不被误标"中断"）**：动态 run 的 `tool-workflow/run-start` 用 `turn: null` 的 **Session 级**事件（engine.ts:303-316），使后台流程越过启动它的 tool step 生命周期、直到真实 run-end 才落终态；配套 `scripts/check-dsh-workflow-projection.mjs` 用真实 DSH client assembler 验证投影形状——把"UI 会不会误标"当成可测试契约。
- **三个模型工具**（`src/index.ts:585-666`）：`workflow_list`（发现 built-in/pattern/项目/个人 workflow，无效条目报告不执行）、`run_workflow`（三选一：name 命名运行 / request 生成 / source 受限 inline；`wait` 默认 false 立即返回 durable process）、`workflow_manage`（14 个 action：runs/show/pause/resume/stop/rerun/resume-run/save/rename-run/rename-saved/revise/delete-run/delete-saved/prune）。
- **斜杠命令**（`src/index.ts:674-683`）：`ctx.inject(['commands'])` 注册 `/workflow` 全套子命令（`src/index.ts:145-160` 帮助文本）；命令经 `ctx.userQuestions` 做一次性人类确认，模型工具走当前 turn 的 `ctx.approval`。
- **systemPrompt 引导**（`src/index.ts:668-672`）：`systemPrompt.section` 注入一段克制引导——"只在用户显式要求 workflow 或工作确需可复用编排时用 run_workflow；优先命名 workflow；命令 handoff 场景用 source+manifest 不用 request 模式"。
- **与原生 workflow 工具的关系**：不替换前台 `ctx.workflows`（一次性并行脚本 seam）；本插件在其上加持久流程层（`docs/ARCHITECTURE.md:49-51` 明确"为什么要独立引擎"）。

### 2.2 一次性显式授权（handoff grant，`src/index.ts:199-248`）

`/workflow create <请求>` 与未知名称的自由文本走 handoff 路径：
1. `agent.inject` 注入 authoring contract（插件 relay 消息：先自己调查 workspace、用 source+manifest 而非 request 模式、把具体发现写入子提示而非重复委派侦察）；
2. `agent.steer` 一条真正的 user message（原始请求进会话历史、参与标题生成）；WeakMap 记录该消息 id；
3. **授权判定**（`hasCurrentWorkflowHandoff`）：从会话事件尾部倒序扫描——先遇 `turn/start|turn/end` 即失效（turn 边界即授权边界）；找到目标 id 且 `source.kind === 'user'` 即有效；先遇其它 user 消息即失效（消息级一次性）；
4. **消费即删除**（`consumeCurrentWorkflowHandoff`）；冒烟校验失败的脚本**保留**授权供主代理修正重试（`README.md:83`）；`approvalMode: always` 下不豁免（仍走审批）；内部 relay、后续消息、重复有效调用都不能复用。

### 2.3 兼容性钉扎（风险点）

`compatibility.json` 指向 `https://github.com/dsh2026/test-icetomoyo.git` 快照分支（`snapshots/20260812T172954Z-final-unwatermarked-5fa48343c7`，DSH 0.0.1-rc.2，2026-08-13 测试）。**这是一个 DSH fork/快照仓，不是主线 deepseek-ai/deepseek-harness**；README 致谢也指向该仓。与其它已调研插件钉 0.1.1-rc2+/0.1.2-alpha2+ 相比，本插件的兼容基线旧一代且非官方主线——LDVH 引用其模式时需自行在当前 DSH 上重验（其 engine 大量依赖的 `ctx.subagents` 形状、`toolFilter`、`outputSchema` 语义可能已变）。

---

## 3. Workflow 执行模型

### 3.1 capsule（`dsh.workflow` v1，`examples/review.workflow.json`）

版本化 JSON 文档，七要素：`manifest`（name/description/phases/readOnly/maxAgents/maxConcurrency/patterns，可选 plannedAgents/tokenBudget/mayUseWorktree/inputSchema）+ `source`（定义 `async function run(wf, args)` 的 JS）+ `intent`（taskClass/patterns/reusableFor/**notFor**——负向声明"不适用于什么"，罕见的诚实设计）+ `inputs`（描述与示例）+ `requires`（environment/modelTires/tools/mcp/skills 能力前置）+ `provenance`（createdAt/dshVersion/pluginVersion）。

### 3.2 三类信任模型（`docs/SECURITY.md`）

| 类 | 来源 | 权限 |
|---|---|---|
| trusted-package | 插件内置/pattern | 出厂代码；source 型同样走受限运行时 |
| capability-generated | `.workflow.json`/inline/run 快照 | **零宿主访问**：QuickJS WebAssembly 独立堆，效应只能经 WorkflowApi |
| trusted-local | 项目/个人 `.ts/.mjs/.js` | 完整 Node 宿主权限；import 前一次性显式确认 |

受限运行时（`runtime.ts`，497 行；静态 policy 在 `source-policy.ts:13-25`）：静态拒绝清单覆盖 import/require/process/fs/child_process/shell(exec|execFile|spawn)/network(fetch|WebSocket|XMLHttpRequest)/其它运行时(Deno|Bun)/timers/dynamic globals/内部桥标识（`__dsh*`）/动态代码（eval|Function|constructor|`__proto__`）；匹配前先做**字面量剥离**（`stripLiterals`，`source-policy.ts:28-50`——字符串/模板/注释内容替换为空白，防止字符串里的 "require()" 字样误报，同时保留行号）；冻结 guest API + 确定性 Math/Date 守卫；同步 CPU 片、墙钟、内存、栈四重上限；墙钟超时关闭 RPC 桥、abort run、等所有已接收宿主 RPC 与子代静默退出（`runtime.ts:449-454`）；所有跨界值 JSON 克隆。

### 3.3 WorkflowApi 与 agent 元数据

统一 `run(wf, args)`：`phase`、`runAgent`（普通子任务失败返回 `null` 供降级；显式 handle 的 `wait` 保留完整失败结果）、`parallel`（信号量并发限制）、`pipeline`（条目流式）、`synthesize`（专职综合子代理）、单层嵌套、`artifact`、预算视图。agent 元数据含：phase/scope/constraints/readOnly/provider/subagentType/**modelHint（fast|balanced|deep 三档路由）**/显式 model/isolation/token/evidenceRefs/**verification（后置条件契约）**/outputSchema/terseResult（`src/engine.ts:407` 精确键校验）。

路由三档由配置映射（`README.md:177-184`：fast/balanced/deep 各配 provider/transport/MaxTokens）；tier 结果被显式 selector 遮蔽时记录 `tierOutcome: shadowed-by-selector`（`src/engine.ts:1226-1234`）——**路由决策本身留痕**。

### 3.4 两个内置 workflow

- `parallel-investigation`：可参数化 rubric/agent/concurrency 的并行调查；
- `scoped-review`（`scoped-review.ts` 533 行）：完整评审流水线——`writeReviewPackets()`（scoped-review.ts:258-296）把调用方已捕获的 diff 按 `diff --git` 分文件→分类（源码/文档/测试/配置/cross-cutting）→分区键分组，写入 `.agent/tmp/sessions/<sessionId>/review-packets/<rangeId>/`，包头含 label/rangeId/diffStat/baseRef/headRef/requirements/测试证据；文件用 `wx` 内容寻址（`<stem>-<contentHash12>.md`，chunk 带 sha256）不可覆写；每 packet 的 read-contract 即 `verification: { enforcement: 'hard', requiredReadPaths: [packet 及各 chunk] }`（scoped-review.ts:460）——**评审者必须真的读过 packet** 才算完成；高风险时加第二个 deep primary（双 primary 防单评审者偏差，scoped-review.ts:501）；finding 先确定性归一（sha256(contentHash\0location\0claim)）再合并取最高 severity；逐 finding verifier 对每个 candidate 恰好处置一次 confirmed/refuted/unresolved，severity 变更须带 reason（scoped-review.ts:482-489）；产出 audit artifact `scoped-review-audit` 与 `unqualifiedApprovalAllowed` 门（actionable=0 且 compliant+approved+无 unverified 才许无保留通过，scoped-review.ts:495）。`/workflow review` 直接捕获当前 Git 范围（base/sha）启动，含 `--risk low|medium|high` 路由与 `--requirement/--test-evidence` 合同参数。

### 3.5 六个标准 pattern

classify-and-act / fan-out-and-synthesize / adversarial-verification / generate-and-filter / tournament / loop-until-done——manifest 必须声明且只能取这六个（`src/index.ts:203` authoring contract），作为流程词汇表收敛。

---

## 4. 持久化与恢复（对 LDVH 最重要）

### 4.1 run 目录（`README.md:124-133`，`src/store.ts:87-133`）

```
.dsh/workflow-runs/<run-id>/
├── run.json                    # 状态、结果摘要、成本（WorkflowRunSnapshot）
├── events.jsonl                # append-only 事件图（seq 单调 + time + type + data）
├── workflow.workflow.json      # 不可变执行快照（生成型）+ script.js + manifest.json
├── results/                    # effect cache：仅"已完成且验证通过"的任务结果
└── artifacts/                  # 命名证据（wx 不可覆写 + 运行内名字去重）
```

**写维工程细节**（`store.ts` 第一手核验）：
- `run.json`：**每次事件全量重写**当前快照（store.ts:115——非 append+checkpoint 增量，是工程取舍而非缺陷声明，但大 run 有写放大）；
- `events.jsonl`：`appendFileSync` 追加 append-only 事件图（seq 单调 + time + type + data，21 种事件类型，types.ts:267-271）；
- `artifact`：`writeFileSync flag: 'wx'`（存在即抛错）+ 运行内 Set 去重——**证据不可覆写**；
- **`cacheKey = sha256(JSON.stringify(cacheIdentity)).slice(0,32) + '-' + occurrence`（`store.ts:116-119`）——内容寻址 + 同输入第 N 次出现区分（防同输入不同语义位置的混淆）。cacheIdentity 是五元组确定性复合：version + workflow（manifest+source）+ runtime（pluginVersion+dshVersion+verificationAdapter.cacheIdentity）+ routing（默认 provider+modelTiers+readOnlyPolicy）+ input（engine.ts:1019-1029）——"同工作项 + 同输入 + 同配置版本"的完整判等；
- **effect cache 复用门槛**（`store.ts:120-130`）：跨 run 复用前一条结果仅当 `status === 'completed'` 且 `verificationWarnings` 为空；命中后**先复制到本 run 再返回**（不引用旧 run 的可变文件）；写入侧同样双重校验（engine.ts:1342 setCached 前再核一遍）——**"先验证后落盘"在读写两侧都有门**；
- `delete`：非终态 run 拒删（force 仅限重启后的陈旧记录，`store.ts:184-189`）；
- `list`：单条损坏记录不能遮蔽健康 run（`store.ts:159`）；
- **项目分区防混淆**（`store.ts:70-80`）：`.project.json` 标记 `wx` 写入 + EEXIST 容错，canonicalProjectDirectory 不匹配即抛错——run 分区属于哪个项目有落盘身份。

### 4.2 run 状态机与身份

`running → paused/completed/failed/denied/stopped`（`types.ts:22`）。快照字段（`types.ts:346-370`）含 `sourceRunId`（重跑来源）、`revisionOf`（修订来源）、`resumedFromRunId`（续跑来源）——**血缘三字段**。`resolveIdentity` 支持 run-id/显示名/保存名三态解析，歧义时显式报 `ambiguous` 而非猜（`store.ts:164-173`）。

### 4.3 重跑/续跑语义（`README.md:135-137`）

- **run-id 重跑**：执行该 run 的不可变 capsule 快照（所见即所跑）；
- **saved-name 重跑**：执行当前保存版本；
- **resume-run（effect cache 续跑）**：相同调用序号 + 相同 task input 命中缓存（含 effective read-only policy/runtime/verification 身份参与 cache key，KODAX_PARITY 声明），其余任务继续执行；重放保留原结果状态并带显式 replay origin。

### 4.4 成本与并发

token budget 在子代理**发布前预留**、结束后按 Session 实际值核算（差额补记，`engine.ts:1231-1245`）；结构化修复与验证修复期间的 usage 也入账且超预算即抛 `WorkflowControlError`；部署级信号量跨所有 run 与项目引擎共享（不变量 9）；Cordis 卸载 abort 并等待全部活跃 run（不变量 10）。

---

## 5. 治理与安全（第一手核验）

### 5.1 审批分级（`README.md:172`）

`approvalMode: never | generated-and-local | always`——生成型与 trusted-local 都要审批（默认）；`always` 全审批（handoff 豁免失效）；`never` 无人审批但 DSH 原生工具审批仍兜底。审批经 `ctx.approval.request({ agent, toolName: 'run_workflow', reason: preflight.approvalSummary })`（`engine.ts:646-650`），拒绝即 run 进入 `denied` 终态并记 `workflow-stopped` 事件——**授权结果本身入事件图**。

### 5.2 能力预检（preflight，`engine.ts:499-516`）

capsule 的 `requires.tools/mcp/skills` 对照部署清单 `availableTools/availableMcp/availableSkills` 逐项核验，**缺一即 fail，不偷偷降级**；同时静态校验 manifest 与 source 一致性（phases 匹配）、输入 schema。审批摘要由 preflight 生成（含 agent 数/并发/读写性/worktree 声明）——**授权请求携带真实影响面**。

### 5.3 readOnly 动态求交（`README.md:185-193`）

`readOnly: true` 时子代理工具面 = **当前父 Agent 可见工具 ∩ 可信只读 allow-list**（read/read_image/glob/grep/lsp/skill/web_search）——未来新增写工具默认不可见（闭集白名单语义）；provider 不支持 `toolFilter` 时直接失败（fail loud 而非静默放开）。

### 5.4 验证证据模型（`engine.ts:1096-1330`，复核维范本）

任务声明 `verification: { enforcement: hard|warn, requiresMutation, requiredChangedPaths, requiredReadPaths, minFinalTextChars, rejectPreparatoryFinalText }`。发布前快照 `gitWorkspaceState`（status+diff+staged+worktree 四段 sha256 指纹 + 每个 required path 的内容指纹，`engine.ts:274-299`）；完成后核验：
- **读证据**：requiredReadPaths 必须出现在子代理实际观测的读路径集合；
- **变更证据**：`成功 mutation 工具调用 ∧ workspace 指纹变化`（两者缺一不可——防"调了写工具但没写成"与"workspace 变了但不是这个 agent 干的"）；
- **路径级证据**：每个 requiredChangedPath 的前后内容指纹必须不同；
- **文本后置条件**：`minFinalTextChars` 最小实质内容 + `rejectPreparatoryFinalText` 用正则拒绝"我接下来会/准备/i will"式预备性文本（`engine.ts:1291`）；
- **有界同 actor 修复**：hard 失败时最多 2 次 `childRun.localAgent.followup`（同 actor relay 修复，非新起子代理）+ `whenIdle` 等待 + 刷新 finalText，第 3 次仍失败才抛错（`engine.ts:1285-1293`）；
- **结构化输出修复**：schema 校验失败或 rc.2 缺捕获时，恰好一次**同路由、零工具**（`toolFilter: { allow: [] }`）的格式修复，15s 超时（`engine.ts:1148-1210`）；修复成功标 `completed-after-structured-repair`，失败即任务失败——**修复本身留痕**。

### 5.5 catalog 治理（`catalog.ts` + `docs/SECURITY.md:27-35`）

发现顺序确定性（内置不可遮蔽 → 项目 `.dsh/workflows` → 个人 `$DSH_HOME/workflows`；项目覆盖个人；`.workflow.json` 优先于 `.ts/.mjs/.js`）；符号链接/路径逃逸/超大文件/未知字段/版本不兼容/manifest 与文件名不一致全部执行前失败；**保存走"临时文件 wx 写入 → `link()` 原子发布（EEXIST 即并发冲突，拒绝不覆盖）→ replace 时先 rename 到 `.archive/` 备份再换新、失败回滚"**（catalog.ts:281-318）；逐段 realpath 校验拒绝 junction/symlink（catalog.ts:211-246）；并发同名保存互不覆盖。

---

## 6. 工程质量

**亮点**：
1. **不变量文档化**：11 条不变量逐条可对应到实现与测试——"声明的架构就是验证的架构"；
2. **fail-loud 哲学贯彻到底**：不支持的 provider 能力（toolFilter/outputSchema）、不存在的 dispatch/isolation adapter、能力清单缺项、非终态删除——全部显式失败，无一静默降级（不变量 8"从不接受后忽略"）；
3. **KODAX_PARITY 验收矩阵**：23 行能力族对照表，"行为对标而非实现复制"有 `reference.json` 落盘（参考 commit 可查）；
4. **写维细节**：append-only + 不可覆写 artifact + 不可变快照 + 复用门槛 + 分区身份标记 + 原子发布——比 openwolf 的脑文件更完整的"运行即证据"设计；
5. 兼容快照 pin + `scripts/check-dsh-workflow-projection.mjs` 真实投影检查 + 80% 覆盖率门禁。

**缺陷/风险**：
1. **兼容基线旧且非主线**（DSH 0.0.1-rc.2 fork 快照，2026-08-12）：当前 DSH 2.0.4 上能否运行未验证；`engine.ts` 对 `ctx.subagents`/`toolFilter`/`outputSchema`/rc.2 缺陷的形状假设需要重验；
2. 五 commits 单作者单日发布，无 issue/PR 历史可评估社区使用反馈；
3. 测试计数徽章（179）与 grep 实测（133 处 it/test）存在差异（可能是参数化计数，如实记录）；
4. run 级事件图与 DSH 原生 Session 事件（`tool-workflow/*`）双写——两套事件源的边界与一致性维护成本长期存在；
5. QuickJS WASM 运行时是进程内隔离而非 OS 容器（SECURITY.md 自承）——对不可信 workflow 的防线仍依赖"别给它写工具"的运维纪律。

---

## 7. 对 LDVH 的参考价值（重点）

### 7.1 执行维：WorkCase 执行模型的直接参照（v5 四支柱之二）

| dsh_workflow 机制 | LDVH WorkCase 执行模型对照 |
|---|---|
| durable run graph（run.json + append-only events.jsonl） | WorkCase 的工作记录载体：**行动留痕用 append-only 事件而非改写快照**；快照只存当前状态摘要 |
| 不可变 capsule 快照（run-id 重跑 = 所见即所跑） | 事实对象 `content_fingerprint` 的执行层同类：重跑/复核的基线是**不可变快照**而非"当前可能已变的文件" |
| effect cache：仅 completed∧零告警可复用 + 先复制再引用 | LDVH 复核维通过的结果才能作为依据复用；复用**取副本不引用可变原**——对事实对象的"回读后引用"同样适用 |
| 三血缘字段（sourceRunId/revisionOf/resumedFromRunId） | WorkCase/事实对象溯源字段的执行层同类：每个派生行动可回指来源行动 |
| 部署级信号量 + 预算预留 + 实际核算 | 多会话并发访问同一 ldvh-base 时的预算与并发治理参照 |
| Cordis 卸载 abort 并等待全部 run | LDVH 插件生命周期的卸载语义：不留僵尸写入 |

**与 AgentTeams 的关系**（LDVH 需要的是并集）：AgentTeams 提供会话内任务 DAG + attempt_id 单调令牌 + 成员池（v4 study-01M0PQHMRVEA 已吸收）；dsh_workflow 提供跨会话持久化 + catalog 复用 + 快照重跑 + 验证证据。WorkCase 执行模型（v5-handoff §4 "work items 拆给 durable 成员并行；attempt 令牌做写回机械边界；冷恢复兜底"）应取 Team 的调度语义 + workflow 的持久化/证据语义，而非二选一。

**关键语义差异（子代理交叉印证的核心发现）**：workflow 的 attempt 概念（taskId `task-N` + cache occurrence）**只用于 run 内消歧与缓存键，没有"写回边界"语义**——子代理直接以父权限经 toolFilter/sandbox/approval 干活，不存在"写回前校验 attempt 单调"机制；这正是 LDVH attempt 令牌相对它的增量（防陈旧 attempt 覆盖新写入）。另外两者 durable 的对象不同：workflow durable 的是 run 目录与事件（执行账本），LDVH durable 的是成员会话与事实文件（业务资产）——可叠加而非替代；成员形态也不同（workflow 的一次性 spawn child vs LDVH 的可持续会话成员）。

### 7.2 写维：受控写入的第四个样本

写维样本链（前七个插件的结论 + 本项）：
- openwolf：原子写 + 跨进程锁（文件级）；
- session-surgeon：dry-run→apply→备份→回读验证（单文件修复级）；
- context-compressor：只读原文 + 派生新载体（会话级）；
- **dsh_workflow：append-only 事件图 + 不可覆写证据 + 不可变快照 + 复用门槛（运行记录级）**——LDVH Helper 受控写入的"事实域"最接近这一层：事实对象的生命周期变更本就该是 append-only 事件 + 不可变版本 + 受控修订（revisionOf 同类），而非原地改写。

**具体可吸收**：`wx` 不可覆写语义（证据/事实创建一旦落盘不可被同名覆盖）；分区身份标记（`.project.json` 的 EEXIST 检查——ldvh-base 归属哪个项目/worktree 的机械判定可同构）；"复用先复制"（引用他 run 结果先落自己目录）。

### 7.3 遵守维：一次性授权的中间形态

LDVH 授权谱系（工具参数级 → Human Gate）之间缺一个形态：**绑定消息、随 turn 失效、消费即删、失败保留**的显式意图授权（`src/index.ts:199-248`）。对应 LDVH 场景：Human 在对话中说"就按这个方案干"——当前模型里这句话只活在对话历史里（AI 靠引用），没有机械载体。handoff grant 证明了这种"意图消息 + 弱引用 + 生命周期边界"在 DSH 上可实现。注意其边界：这是**插件私有**的 WeakMap 授权，非宿主级授权——LDVH 若采用，授权记录应进事件图（它自己在 `denied` 时的做法）而非只留内存。

### 7.4 复核维：证据模型的五重启发

1. **双证据合取**（mutation 工具调用 ∧ workspace 指纹变化）：LDVH "实际变化"判据的机械实现——单看"调用了写工具"或单看"文件变了"都不够，合取才排除假阳/假阴；
2. **证据只能出自受控事件日志而非模型自述**：读路径/mutation 调用都是从 session `tool/result` 的**成功调用**中提取的（engine.ts:199-216）——LDVH 复核维可要求"证据必须来自 Helper 记录的事件，AI 的完成声明本身不算证据"；
3. **预备性文本拒绝**（rejectPreparatoryFinalText）：对 AI 自欺（"我做完了"实为"我准备做"）的直接机械检查——LDVH 复核维"完成声明不超过证据"的可测试化样本；
4. **有界同 actor 修复**：复核发现问题时回跳给**同一个**执行体修复（保留其上下文）而非新开一个，最多 2 次——与八维基线（`docs/eight-dimension-action-baseline.md` §3 转交不变量 4"复核转执行必须给出可修复发现"）的执行层吻合，且给了"有界"的具体数字（2 次）；
5. **`completed_unverified` 三态**：warn 级验证失败或修复后仍有问题时降级为"已完成但未验证"而非拦死流程——提示 LDVH 复核结果可以是 pass / needs-revision / **pass-with-unverified** 三态（结果保留但明确标记未验证范围，与 00 §9"区分已证实/未证实范围"同构）。

### 7.5 沉淀维：capsule 的"负向声明"

capsule 的 `intent.notFor`（不适用于什么）是罕见的诚实字段——LDVH 行动模板/事实对象的适用边界声明可借鉴：**声明"不适用"与声明"适用"同等重要**（对应 04 行动模板的触发/排除契约，study-absorption 已有此吸收项，此处得到工程实例）。

### 7.6 LDVH 应避免/警惕的

1. **非主线兼容钉扎**：LDVH 08 规范要求宿主能力现取 + 版本矩阵验证（dsh-context 的 baselines.ts 是正解），不能用 fork 快照当兼容事实；
2. **双事件源**（自家 events.jsonl + 宿主 tool-workflow/*）：LDVH 事实留痕应单一权威（事实源），宿主事件只做投影/触发，不构成第二份账本——否则一致性维护成本长期化；
3. **一次性授权的内存态**：WeakMap 授权重启即失——LDVH 授权若需跨会话（Human Gate 决定的作用范围核对），必须有落盘载体；
4. **QuickJS 隔离的边界诚实**：进程内隔离不是安全边界（其自承）——LDVH 的机械守护应依赖宿主沙箱/审批/Git Gate 组合，不依赖语言级隔离。

### 7.7 五件套执行层的选型启示

LDVH 插件五件套中"Helper 确定性执行"与"AI 工作引导"的分界在本插件得到又一验证：它把**确定性流程**（引擎/存储/验证/审批）全部放 Host 侧，把**语义决策**（何时用 workflow、怎么 scout、怎么写 capsule）通过 systemPrompt 引导 + authoring contract 交给主 Agent——"机器管流程，AI 管语义"与 LDVH "插件管能力（机械半边）、AI 管思维（语义半边）"（v5-handoff §7）的分工同构。其 systemPrompt 引导文本的克制程度（"只在显式要求或确需时用"）值得照抄语气。

---

## 8. 证据清单（主控第一手核验）

| 结论 | 证据 |
|---|---|
| 服务注册 + 可选服务探测传入 | src/index.ts:685-694 |
| 三工具（list/run/manage）与 14 action | src/index.ts:585-666 |
| systemPrompt 克制引导 | src/index.ts:668-672 |
| handoff 一次性授权（消息 id + turn 边界 + 消费即删） | src/index.ts:199-248（倒序扫描判定 227-242） |
| 冒烟失败保留授权 | README.md:83；src/index.ts:627 |
| run 目录结构与 append-only | README.md:124-133；src/store.ts:93-132 |
| artifact wx 不可覆写 + 名字去重 | src/store.ts:103-109 |
| cacheKey 内容寻址 + occurrence | src/store.ts:116-119 |
| effect cache 复用门槛（completed∧零告警）+ 先复制 | src/store.ts:120-130 |
| 非终态拒删；单条坏记录不遮蔽 | src/store.ts:184-189,159 |
| 项目分区身份标记（wx+EEXIST+不匹配抛错） | src/store.ts:70-80 |
| 状态机与三血缘字段 | src/types.ts:22,346-370 |
| 审批分级 + denied 入事件图 | README.md:172；src/engine.ts:646-650 |
| preflight 能力清单 fail 不降级 | src/engine.ts:499-516 |
| readOnly 动态求交 + fail loud | README.md:185-193；src/engine.ts:1114 |
| gitWorkspaceState 四段指纹 + 路径指纹 | src/engine.ts:274-299 |
| 双证据合取 + 路径前后指纹 + 文本后置条件 | src/engine.ts:1270-1292 |
| 有界同 actor 修复（最多 2 次） | src/engine.ts:1285-1293 |
| 结构化输出修复（同路由零工具 15s 一次） | src/engine.ts:1148-1210 |
| 预算预留 + 实际核算 + 修复期间也入账 | src/engine.ts:1231-1245 |
| tierOutcome 路由留痕 | src/engine.ts:1226-1234 |
| 11 条不变量 | docs/ARCHITECTURE.md:35-47 |
| 三类信任模型 | docs/SECURITY.md:3-21 |
| KODAX 验收矩阵 23 行 | docs/KODAX_PARITY.md |
| capsule 七要素 + notFor 负向声明 | examples/review.workflow.json |
| 兼容钉扎非主线 fork 快照 | compatibility.json；README.md:234 |
| 规模/测试/提交史 | wc -l 实测；grep it( 133 处；git log 5 commits 2026-08-13 |

### 未验证/残留风险

- 克隆快照，未运行 `pnpm check`（179 测试 + 类型检查 + 构建链）；测试计数徽章（179）与静态计数（113 处 it + 10 处 each）不一致，以实测为准。
- **在当前 DSH Desktop 2.0.4 / 0.1.2-alpha 线上的兼容性完全未验证**（其钉扎基线为 0.0.1-rc.2 fork 快照，引擎对 subagents/toolFilter/outputSchema 的形状假设可能过时）。
- scoped-review 的 packet 分区/预算算法细节与 finding 合并语义以子代理报告为准（主控核验了参数校验、wx 写入与 read-contract 装配）；
- 本报告为设计输入，不构成任何机制"已在 LDVH 实现"的证明。
