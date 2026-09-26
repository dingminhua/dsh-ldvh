# DSH 宿主编排能力与兄弟编排插件生态调研（LDVH 同步跟进判断）

> **数据源**：同级仓库 `/Users/dmh2002/DshProject/deepseek-harness`（git tag `dsh-v0.1.7-rc.2`，`477b4f4205`，2026-09-24，只读）；8 个兄弟编排插件仓（2026-09-26 拉取至最新）；运行中宿主（本会话工具面实测：subagent / subagent_fork / workflow / send_message / interrupt_agent / list_agents 均可用）
> **调研日期**：2026-09-26
> **方法**：两条子代理调研线（宿主能力线 / 兄弟插件线）+ 主控亲自核验关键结论（源码行级）。分线明细见附录 A
> **与前两轮调研的关系**：不重复 `docs/dsh-0.1.5-rc2-to-0.1.7-rc1-research.md`（契约面比对）与 `docs/dsh-0.1.7-rc1-to-0.1.7-rc2-research.md`（rc.1→rc.2 增量）已覆盖的内容；本文聚焦**编排能力语义**与**兄弟生态设计**两条新轴，规范影响判定以两轮前调研 + 本文为完整证据集
> **性质**：开发设计输入（docs/），非规范、非事实对象；规范影响结论的权威承载为受控 Research 对象（`updates` → research-c8746b85）

---

## TL;DR

| # | 结论 | 性质 | 对 LDVH 的影响 |
|---|---|---|---|
| 1 | 宿主原生子代理体系（subagent/fork/control 工具族）在 **standard 预设下默认可用** | 能力面 | 30 号调研线、32 号执行/复核的委派承载面已就绪，无需自建 |
| 2 | **maxDepth 默认 1、maxActiveSubagents 默认 8**（均 volatile） | 编排硬约束 | 子代理不可再委派孙代理——「实施者为子代理时无法再派独立复核子代理」；并行调研线 ≤8 |
| 3 | 宿主 **workflow 工具**（pipeline/parallel/phase）为原生默认可用能力 | 能力面 | LDVH 尚未定义其消费方式；大规模扇出调研可评估此形态 |
| 4 | **08 §5.4 事件面登记落后实现两代**：仍列 `agent/session-start`（emit）、核验标注停在 0.1.5-alpha.1；实现已迁 `agent/created`（serial） | 规范-实现矛盾 | A1 · 必须修（并入 B1 的 08 号修订） |
| 5 | **规范链存在编排契约承接断点**：02 §8、21 §3.2、32 §12 三处指向「08/09 承接」，08 §3.1 无对应条目 | 规范链断点 | B1 · 应当补（08 新增编排宿主契约章） |
| 6 | **Skill 管辖消费方未建立宿主缝**：07 号列 Skill 为四消费方之一，08 五类缝不含 skill、实现零命中 | 未消费缝 | B3 · 并入 B1 处置 |
| 7 | LDVH 会话数据消费面对 **v4 新载荷实测容忍** | 已消化 | event-stream / child.js 只消费 turn 号，未知 reason 无害——升级后无须适配 |
| 8 | 兄弟编排项目普遍采用**人工门禁 + 可审计流水 + 防自欺边界** | 生态共性 | 印证 LDVH 方向；工程化原语不跟进（已有语义等价物 + 反过度设计红线） |
| 9 | 当前会话的**专家团工具来自第三方 Agency 插件**（非宿主） | 归因澄清 | 专家团结论按第三方依赖对待，不归因宿主版本 |
| 10 | **auto-review**（三档模型终审）为实验插件且默认关闭 | 观察项 | 转正后可与 LDVH 预检/门禁互补——列入上游吸收跟踪 |

---

## 1. 宿主编排能力地图（0.1.7-rc.2）

### 1.1 子代理体系（packages/subagent/）

- **契约**：`subagent/src/types.ts` — `SubagentProvider` / `SubagentCapabilities`（agentOptions / outputSchema / depthLimit / toolFilter / persona）/ `SubagentStartRequest`（signal 取消、agentOptions 覆盖、toolFilter 双态可见、maxDepth 委托深度）。缺能力在 start 显式报错。
- **生命周期**：`lifecycle.ts`（createLifecycleEmitter / observeRun）、`child-agent.ts`（Activation / 结算 `run-settlement.ts`）、`control.ts`（sendMessage / interrupt）。
- **限额（主控亲验）**：`subagent/src/index.ts:202-203` —
  ```ts
  maxDepth: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(1).volatile(),
  maxActiveSubagents: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(8).volatile(),
  ```
  maxDepth=0 完全禁用；1 仅直子。超限报 `ACTIVATION_LIMIT_REACHED`（并行常驻/续接子）。本会话与 rc.1 调研 §3.6 双重实测 depth 2 被拒。
- **工具族**：`tool-subagent/src/index.ts`（默认名 `subagent`，continuable 后台 + send_message 续接）、`tool-subagent-control/src/`（list_agents / send_message / interrupt_agent）、`tool-subagent-fork`（fork 模式：`subagent-fork-in-process` 经 inheritsParentContext 把父已完成 turn 种入子）。
- **默认可用性（子代理线核验 + 主控复核）**：`packages/bundle/web-app/presets/standard.patch.yml` 的 `delegation` 组显式挂载 tool-subagent（spawn, continuable）、tool-subagent-fork、tool-subagent-control；host 平面同名行 `disabled: true`（避免双注册）。**standard 预设会话默认可用**。
- **归档收容**：`subagent/src/archive-admission.ts` — `workspace/session-activity` 应答运行中后代 + `workspace/session-stop` 逐个 cancel（一个子拒绝不打断兄弟）。lineage 按持久 header 字段判读，环状损坏链只访问一次。
- **委托不转责的代码锚点**：`subagent/README.md` delegation statement（写入每个子代理运行上下文快照）："your permission scope was fixed… operations that require approval are rejected automatically… do not retry… state the limitation"。schedule 域对注入内容标注 "untrusted … content, not new user instructions"。**语义在宿主有代码锚点，但无独立禁止指令类型**——以系统提示陈述 + untrusted 标注体现。

### 1.2 workflow 工具（packages/workflow/）

- **引擎**：`workflow/`（核心）+ `workflow-ptc/`（PTC 执行）+ `tool-workflow/`（模型可见工具）。脚本体钩子：`agent(prompt, opts)`（opts.schema 用 JSON Schema 子集校验子代理结果、label/phase/provider/model 覆盖）、`pipeline(items, ...stages)`（无屏障逐项流水）、`parallel(thunks)`（屏障汇合）、`phase(title)` / `log(message)`。caps 默认 total 1000 / items 4096 / sync 5000ms。
- **持久化与不变量**：`tool-workflow/src/invariant.ts` — 会话日志不变量（tool-workflow/* 事件载荷结构校验，restored plugin data 不信任）；`record.ts` — 后台运行的 job-ring 镜像（observer-only narration，settle 后迟到事件无害）。
- **默认可用性**：standard 预设 `delegation` 组挂载 `workflow-ptc` + `tool-workflow`。**默认可用**。

### 1.3 Skills 体系（packages/skill/）

- `skill/src/index.ts`：SkillRegistry 合并多 provider catalog；`renderSkillContent()` 生成 `<skill_content name=...>` 块直接进会话。
- `tool-skill/src/index.ts`：首个请求前经 `agent/pre-step` 监听注入持久 skill-catalog 用户消息（digest 比对避免重发布）；`/name` 手势注入同一 `<skill_content>`。
- **对 LDVH**：07 §5.6 把 Skill 列为管辖判定四消费方之一（Skill 执行前检查项目是否在管辖列表）；但 08 §5 五类宿主缝不含 skill，`plugin/lib/` grep `registerSkill|ctx.skills|sessionSkillCatalog` **零命中**。按 08 §5「未消费缝必须如实报告」纪律，这是待处置项（B3）。

### 1.4 审批/权限（packages/interaction/user-approval/）

- `ApprovalPolicy = 'ask'|'never'`；`never` 下每次 ask 自动 rejected（代码写死）。`core/tools/src/index.ts:1744` 统一走 `approval.request`。
- rc.2 起 `PreToolDecision.ask` 新增可选 `displayReason`（本地化可见理由）——LDVH 的 `tools.guard` 字符串拒绝不受影响，可用它提升审批可读性。
- **auto-review**（`experimental/auto-review`，实验插件、默认关）：三档风险（low 放行 / medium 需显式当前授权点名动作+目标+范围 / high 永拒含显式请求）；歧义或超范围 fail-closed；审查请求五分区（REVIEW_POLICY / ENVIRONMENT / PROJECT_INSTRUCTIONS / FILTERED_HISTORY / PENDING_ACTION）；主代理 V3 system/message 与 assistant 输出排除在外；非 durable 状态。**与 LDVH 04 §6.1 风险层理念平行，互不消费**（C3 观察项）。

### 1.5 专家团归因澄清

- `summon_expert*` / `list_experts` / `get_expert_team` / `summon_expert_team` 在 deepseek-harness 全仓源码**零命中**（grep expert 仅一处无关测试）。
- 实为第三方插件 `@michengai/dsh-agency-agents` v1.0.5（desktop profile bundles 已列；本地检出 `/Users/dmh2002/DshProject/dsh-agency-agents`，git 2026-09-25）。
- 宿主另有实验包 `experimental/agent-team` + `tool-agent-team`（spawn_teammate / team_task_* / 持久 mailbox + 共享任务 DAG），**不在 standard 预设**，默认不可用。
- 结论：**「专家团 = 插件层（Agency 插件），非宿主原生**；其结论按第三方依赖对待。

### 1.6 Git 提交门禁

宿主无 Git Gate / pre-commit 机制（grep 仅命中 session 事件内部 pre-commit 校验，与 git 无关）。受控提交完全由 LDVH 插件自供（`ldvh_precheck_git_commit` + commit-msg 钩子）。**这是 LDVH 在 DSH 生态中的独有价值确认。**

---

## 2. 兄弟编排插件设计调研（8 仓）

| 项目 | 定位 | 治理相关机制 | git 动态 | 对 LDVH |
|---|---|---|---|---|
| dsh-agent-teams v0.1.21 | Captain 领队 + 依赖感知任务 DAG | **计划冻结**（Approve & Run 才调度）；`docs/quality-gates.md` 机器可判定门禁（越界 changed_paths 禁 completed、自批禁令、repair-review 链）；`attempt_id` 防迟到写入 | 2026-09-25 | 印证 C2/Gate 1 钉扎方向；不跟进 |
| dsh-dag-orchestrator v0.2.1 | 可并行可重启 DAG | SQLite **哈希链事件日志**；`kind:"approval"` 门禁；**默认防注入**（任务子代理禁 dag_*/subagent*、上游输出置于数据标记间）；下游 schema 校验 | 2026-08-19 | 防注入理念值得 30 号评估（C2）；哈希链不跟进 |
| dsh_workflow（KodaX 对标） | 可治理可恢复工作流层 | 版本化 capsule；append-only `events.jsonl` + **不可变快照**；`approvalMode` 三级；capability-only VM（QuickJS WASM）+ JSON 边界 | 2026-08-13 | 印证 append-only（Git 受控提交等价）；不跟进 |
| dsh-mnemon v0.5.15 | 三层可组合记忆 | Source/Strategy/Core/Host 四层；**不可变 View + provenance**；**「历史记忆永不凌驾当前指令」铁律**；空闲有界复核（5 分钟下限/20 次上限） | 2026-09-26 | C1：35 号评估显式化该原则 |
| dsh-deep-research | 自适应研究闭环 | 先定答案空间 + 每子题 **acceptance**；coverage_gaps 覆盖自检；三态证据；边际增益零即停；对抗性审查 | 2026-08-12 | LDVH 30 号已有同构设计（三态证据/收敛判定），印证方向 |
| dsh-agency-agents v1.0.5 | 321 专家选取/召集 | 主会话收口裁决（核对证据、处理分歧、合并一结果）；专家不可二次召唤 | 2026-09-25 | 收口模式对应 LDVH 复核制度；发散上限控制可参考 |
| dsh-agent-conductor v0.3.0 | 外部 agent CLI 调度 | 产出署名「done by \<agent\>」 | 2026-09-17 | 署名托管对应 LDVH 代理身份；方向不同 |
| dsh-subagent-default-model v2.0.3 | 子代理模型路由/韧性 | 连接类错误自动切模型且隔离主循环 | 2026-09-26 | 已有调研文档复用；方向不同 |

**共性**：① 计划→执行→汇总闭环；② 人工门禁（Approve&Run / approval 节点 / approvalMode）；③ 可审计性（hash-chain / append-only / 不可变快照 / provenance）；④ 防自欺边界（防注入 / 沙箱 / 历史不凌驾指令 / 自批禁令）；⑤ 不可变/终态只读。

**与 LDVH 差异**：这批多为「调度/执行层治理引擎」；LDVH 以 Human 决定权为核心、以事实对象生命周期 + 规范读取 + git 受控提交承载**语义/规范层治理**。LDVH 已有等价物：Git 受控提交 + change_log（↔ append-only 流水）、C2/Gate 1 授权钉扎（↔ 计划冻结）、21 §15.2 attempt 令牌（↔ attempt_id）。按反过度设计红线，**不引入工程化原语，仅记录印证**。

---

## 3. 对 LDVH 的影响评估（A1–D）

### A1 · 必须修：08 §5.4 事件面登记落后实现两代

**证据链（全部主控亲验）**：
- 规范侧：`specs/08` §5.4 仍列 `agent/session-start`（emit {agent, source}），核验标注「DSH 0.1.2-rc.1 与 0.1.5-alpha.1 一致，2026-09-10」。08 号最后修订 2026-09-13（80e9524），早于 0.1.7 两轮调研。
- 上游事实：rc.1 调研 §3.4 证实 `agent/session-start` 已删除，语义并入 `agent/created`（serial，`source: 'startup'|'resume'|'clear'|'compact'`，监听器返回 Promise 被串行 await、抛错回滚创建事务）。
- 实现侧：`plugin/lib/lifecycle.js:293-299` 迁移注释 + `agent/created` 监听已就位；`child.js:119` 注释「0.1.7 起该事件已删除」；rc.2 调研 C15（8 事件全在且 mode 未变）。
- 判定：**规范文本与实现矛盾**。§5.4 的「已核验事件」清单是 08 §3.1 第 3 条职责的登记对象，登记失真直接违反档位诚实性。

**处置**：并入 B1（08 号修订批次）——原「搭车 Spark 门禁提案」方案经核验不可行：该提案属 open 工单 8f4742f5（Spark 授权门禁与 20 号一致性修复，attempt 1 活跃），本会话不越权改动其工件；且 A1 与 B1 同为 08 号规范修订，合并为同一 Human 决定时刻更自然。候选修订文本见 §4。

### B1 · 应当补：08 缺「编排宿主契约」承接章

**证据链**：02 §8「具体契约由 08 承接」；21 §3.2「attempt 的宿主实现与锁语义指定由 08/09 承接」+ §3.3 同表述；32 §12「spawn/通信/中断回收的宿主机制归 08/09」——三处指向，而 08 §3.1 六条职责（manifest/工具注册/引导事件/交互/登记/守护发布）**无任何编排条目**。21 §15.2 把「attempt 的宿主实现」列为未闭合依赖（未满足不得声称 V6/HV2 兑现），该依赖的承接方文本本身缺席。

**处置**：走 21 §6.3 路由（本调研落档后提请）。新章应覆盖：subagent/workflow/skill 三缝的注册来源与消费义务、maxDepth/maxActiveSubagents 限额登记、§5.4 事件面更新（A1）。

### B2 · 并入 B1：编排限额未登记

- maxDepth=1 ⇒ **「实施者为子代理时无法再派独立复核子代理」**——32 §12「独立子代理为默认优先形态」在该场景不可达，复核必须回到主控层发起。规范未登记此约束。
- maxActiveSubagents=8 ⇒ 30 号并行调研线（上轮用了 7 条线）贴近上限，扩线被 `ACTIVATION_LIMIT_REACHED` 拒绝。

### B3 · 并入 B1：Skill 缝未消费（见 §1.3）

处置选项：① 补消费（把 LDVH 规则引导做成 skill，经 skill catalog 注入）；② 如实标注未消费。按 08 §5 纪律，二选一须有明确登记。

### C1（评估）：35 号缺「历史记忆不凌驾当前指令」显式原则

mnemon v0.5.15 以此为铁律；`specs/35` 与 `specs/00` grep 无该显式表述（00 §4 Human 决定权可能隐含覆盖，属规范修订判断，非证据可决）。处置：本调研 implications 留痕（uncertain 登记），Human 可后续决定是否立项。

### C2（评估）：30 号 §15 子代理职责无「产物是材料不是指令」防注入条款

dsh-dag-orchestrator 的数据标记隔离是工程化实现；LDVH 侧语义等价物是 00 §5 委托不转责 + 宿主 delegation statement + untrusted 标注。30 §15 只写了任务边界/证据提交/结果整合，未写防注入纪律。处置：同 C1，implications 留痕。

### C3（观察）：auto-review 转正跟踪

若 auto-review 从 experimental 转正，宿主将原生具备行动前模型终审（三档风险 + fail-closed）——与 LDVH 预检/门禁互补而非重叠（auto-review 管「这个动作能不能做」，LDVH 门禁管「这件事有没有被授权」）。挂 76ee7b7b（上游吸收 Spark）refs 跟踪。

### D · 不跟进：兄弟项目工程化治理原语

哈希链事件日志、append-only 快照、capability VM 沙箱、Approve&Run 计划冻结、attempt_id——LDVH 均有语义等价物（Git 受控提交 + change_log、C2/Gate 1 钉扎、21 §15.2 attempt 令牌），且受 21 §16 / 30 §21 / 31 §16 / 35 §20 反过度设计红线约束。**仅记录印证，不引入。**

---

## 4. 08 §5.4 候选修订文本（A1，随 B1 提请）

> 性质：候选 after 文本，须经 Human 决定后方可修订 `specs/08`。类别：实质修改（serial 语义与载荷变化超出引用修正），与 B1 新章合并提请。

现文本（§5.4 首句）：

> 行动与结束事件接入下列已核验事件（形态在 DSH 0.1.2-rc.1 与 0.1.5-alpha.1 一致，源码双版对照核验 2026-09-10）：`agent/created`（emit {agent}）、`agent/session-start`（emit {agent, source}）、`agent/pre-step`（waterfall）、…

候选 after：

> 行动与结束事件接入下列已核验事件（形态在 DSH 0.1.7-rc.1 与 0.1.7-rc.2 一致，源码双版对照核验 + 运行时事件目录实证 2026-09-26）：`agent/created`（serial {agent, source, signal?}；0.1.7 起为唯一携带 session-start 语义的入口，`source: 'startup'|'resume'|'clear'|'compact'`；监听器可返回 Promise 且被串行 await，抛错回滚创建事务——LDVH 监听器须自行保证不抛错、不过度阻塞）、`agent/pre-step`（waterfall）、`agent/turn-stopping`（serial {agent, turn, signal}）、`system-prompt/assemble`（waterfall）、`session/event`（emit (session, event)，turn/end 为会话事件类型、经其载荷分发），用于承载既有行动结构路由、执行状态更新、交还处理和资源清理。`agent/session-start` 已于 0.1.7 删除（语义并入 `agent/created` 载荷）。工具生命周期观察可经官方 `tools/change`（emit）挂载（LDVH 当前未消费）。中断恢复共同语义由 02 定义，08 只承接宿主接入时机；终止时机无已验证原生事件，维持不接入。

依据：rc.1 调研 §3.4 + §2.3（事件面 77 项、mode 分布）、rc.2 调研 C7/C15、`plugin/lib/lifecycle.js:293-299`。

---

## 5. 未证实与缺口

| # | 类型 | 内容 |
|---|---|---|
| U1 | uncertain | 35 号是否需要显式「历史不凌驾当前指令」原则——属规范修订判断，00 §4 可能隐含覆盖，须走修订路径定论 |
| U2 | uncertain | maxDepth=1 在其他 profile 的实际取值——该配置 volatile 可变，本会话与 rc.1 调研实测为 1，未遍历本机全部 profile |
| G1 | gap | auto-review 转正时间线与稳定承诺未知 |
| G2 | gap | Agency 插件 v1.0.5 与宿主 subagent 限额组合的行为未逐行核对（子代理线报告基于 desktop profile 装载事实） |
| G3 | gap | workflow 工具与 30 号调研线的组合使用未实测（本会话用 subagent 形态完成调研） |

---

## 附录 A：调研线与核验记录

- **线 1（子代理）**：DSH 宿主编排能力——packages/subagent、workflow、skill、interaction/user-approval、experimental/auto-review、experimental/agent-team、bundle 装配。关键点经主控复核：maxDepth/maxActiveSubagents 源码行、standard 预设 delegation 组、agency 归因。
- **线 2（子代理）**：兄弟编排插件 8 仓——README/docs/git log 提炼，治理机制聚焦。
- **主控亲验清单**：`subagent/src/index.ts:202-203`（限额默认值）；`web-app/presets/standard.patch.yml` delegation 组（默认可用性）；`plugin/lib/lifecycle.js:293-299`、`child.js:135-165`、`event-stream.js:18`（事件迁移 + v4 载荷容忍——三处均只消费 `data.turn`，不解析 reason 细分）；`specs/08` §3.1/§5.2-§5.6（缝清单无编排条目）；`specs/21` §3.2/§3.3/§15.2（三处指向 + 未闭合依赖表）；`specs/30` §15（子代理职责无防注入条款）；`specs/35`+`specs/00` grep（无「凌驾」表述）；`tool-workflow/src/{record,invariant}.ts`（workflow 持久化与不变量）；`experimental/auto-review` 决策记录（三档策略原文）；workcase 8f4742f5 状态（open、attempt 1 活跃——A1 搭车方案调整的依据）。
- **拉取记录**：19+ 仓 `git pull --ff-only`（deepseek-harness 本地已等于 origin/master @ 0.1.7-rc.2，fetch 零增量；agent-conductor/mnemon/assembly.resume/plugin-product-subagents/routed-subagent/smart-scenario-router 有更新，均已纳入调研）。
