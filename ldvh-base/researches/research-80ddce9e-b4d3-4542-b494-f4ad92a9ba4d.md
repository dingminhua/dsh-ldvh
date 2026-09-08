---
title: dsh_workflow 可治理多 Agent 工作流层（0.1.2：脚本沙箱编排/事件加快照双写/有限修复/宿主原生调度）
status: active
research_question: dsh_workflow（0.1.2）的可治理多 Agent 工作流层如何构成——工作流脚本模型、阶段与并发编排、运行生命周期与持久化、多代理调度与交接、宿主接入与工具面——各自解决什么问题、边界在哪
research_purpose: 支撑 LDVH 编排技术支撑（02 §8）与工作流自动化设计：明确可治理多 Agent 工作流的脚本编排、阶段与并发模型、手交接管与宿主接入机制，为 LDVH 以脚本驱动多子代理执行提供外部依据（与 R4 分支探索互补）
stopping_reason: sufficient
confirmed_statements:
  - F1 脚本形态：纯 JS 源字符串，统一 run(wf, args) 模型
  - F2 加载执行二选一：QuickJS 沙箱或 trusted-local 逐次批准
  - F3 编排原语：parallel 与 pipeline 都逐项失败降级
  - F4 沙箱约束：确定性全局与静态政策
  - F5 上限硬约束：maxAgents 64 / maxConcurrency 8
  - F6 schema 校验：结构化输出强制验证
  - F7 多代理调度：完全寄生在 DSH 原生 subagents 之上
  - F8 结果收集：runAgent 失败返回 null，结构化校验
  - F9 宿主接入：patch 式插件、三工具、inject 依赖
  - F10 治理机制：scoped-review 多阶段评审与 cacheIdentity 五元组
  - F11 限制：单层嵌套、AbortSignal 取消、每 run 一信号量
  - F12 运行持久化双写：事件追加 + 快照覆盖
  - F13 生命周期状态机：六态加 TERMINAL 终态集
  - F14 attempt 语义：无 attempt 计数，重跑即新 run
  - F15 缓存与回放：只回放已完成且验证干净的结果
  - F16 修复与清理：task 级原地验证修复，卸载即停
uncertain:
  - issue: 宿主 workflow 工具描述（meta whenToUse/phases）与本插件 run_workflow 工具（source+manifest 参数）是否同一实现：本仓库 manifest 白名单无 whenToUse，src/docs/tests 零命中，疑为 DSH 原生另一工具或文档偏差
    reason: 本仓库无法证实
  - issue: 为何选全量重写 run.json 而非追加：仓库只有机制证据与文档分类描述，无设计理由文本；写放大（每事件全量重写+全量读 events 重建）是未被文档承认的代价
    reason: 无设计决策记录
  - issue: manifest.phases 与脚本 wf.phase 无静态一致性校验：capsule.ts 只校验非空字符串数组，source-policy 无 phase 检查，投影只能标 skipped
    reason: 未逐行穷尽 author 的语义 lint
  - issue: 进程异常退出后遗留 running 无自动 reconcile：全仓 grep 无 reconcil/stale/recover 命中，apply 未见启动扫描判终止；WorkflowOutcome.interrupted 仅由 stopped/denied 映射产生
    reason: 基于缺失证据的推断
gaps:
  - description: run.json 非原子写、无 fsync/tmp+rename：writeSnapshot 直接 writeFileSync，写中断可能损坏 run.json，list() 用 try/catch 吞掉从而静默隐藏该 run。不阻塞本次调研结论（结论是该机制存在及代价），属实现健壮性缺口，已由建议 A5 承接监测
    priority: medium
  - description: 无跨 run 唯一的 task 标识：task-N 每 run 从 1 计数，results 键为 sha256(input)-occurrence，occurrence 不表达第几次运行尝试
    priority: medium
  - description: 取消不撤回已 spawn 的远程/外部子 agent：stop 走 localAgent.cancel，对无 localAgent 的 dispatch 形态无本地取消路径
    priority: medium
  - description: 每次 persist 全量重读 events.jsonl：projectProcess 每次事件重建 process 都 getEvents 全量解析，长程 run 的事件数放大每事件成本
    priority: medium
  - description: 墙钟超时后 writeSnapshot 竞争与终态覆盖：超时经 onTimeout 置 stopped，finish 由 execute 统一写终态，未见显式序列化保证
    priority: low
implications:
  - finding_ref: F1 脚本形态：纯 JS 源字符串，统一 run(wf, args) 模型
    implication: 工作流是受控输入而非自由代码，meta 严格校验是防注入与防失控的第一道闸
  - finding_ref: F2 加载执行二选一：QuickJS 沙箱或 trusted-local 逐次批准
    implication: 信任分级是治理关键：默认受限、例外逐次批准，与 LDVH Helper 确定性执行取向一致
  - finding_ref: F3 编排原语：parallel 与 pipeline 都逐项失败降级
    implication: 批处理单项失败不拖垮整批、致命错误仍显形，是务实的编排语义
  - finding_ref: F4 沙箱约束：确定性全局与静态政策
    implication: 确定性全局是可复现运行的前提，禁 eval/网络直接服务安全边界
  - finding_ref: F5 上限硬约束：maxAgents 64 / maxConcurrency 8
    implication: 任何多代理能力都必须有硬上限且部署侧可收紧，与 R4 限额结论一致
  - finding_ref: F6 schema 校验：结构化输出强制验证
    implication: 结构化输出是强制校验而非建议，LDVH 子代理结果协议应升级为 schema 校验级
  - finding_ref: F7 多代理调度：完全寄生在 DSH 原生 subagents 之上
    implication: 复杂工作流引擎也只用 DSH 原生 subagents，LDVH 应明确子代理一律走宿主原生
  - finding_ref: F8 结果收集：runAgent 失败返回 null，结构化校验
    implication: 失败显式化为可处理值而非吞掉，与防自欺取向一致
  - finding_ref: F9 宿主接入：patch 式插件、三工具、inject 依赖
    implication: patch 式接入与 subagents 服务交叉印证，LDVH 插件交付应遵循宿主机制
  - finding_ref: F10 治理机制：scoped-review 多阶段评审与 cacheIdentity 五元组
    implication: 复核可以是确定性流程，缓存必须绑定环境指纹
  - finding_ref: F11 限制：单层嵌套、AbortSignal 取消、每 run 一信号量
    implication: 工作流递归应有深度上限，并发额度每 run 一个且跨阶段共享
  - finding_ref: F12 运行持久化双写：事件追加 + 快照覆盖
    implication: 事件日志（权威事实）+ 快照（可重建投影）是可靠运行记录的样板
  - finding_ref: F13 生命周期状态机：六态加 TERMINAL 终态集
    implication: 状态机显式化 + 唯一终态写入点是状态可信的前提
  - finding_ref: F14 attempt 语义：无 attempt 计数，重跑即新 run
    implication: 重试不覆盖历史、新 run 溯源旧 run，与 LDVH 事实对象新增不覆盖取向一致
  - finding_ref: F15 缓存与回放：只回放已完成且验证干净的结果
    implication: 缓存回放必须绑定验证状态，否则会回放未经验证的成果
  - finding_ref: F16 修复与清理：task 级原地验证修复，卸载即停
    implication: 修复是例外而非常态，清理有上限，有限修复+有界保留是节制的表现
urls:
  - ref: https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/source-policy.ts
    summary: 脚本形态校验：run(wf, args) 入口要求、FORBIDDEN 静态政策、phase 相关约定
    title: dsh_workflow source-policy.ts（脚本政策）
  - ref: https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/capsule.ts
    summary: WorkflowManifest 严格校验、限额与 meta 白名单
    title: dsh_workflow capsule.ts（manifest 校验）
  - ref: https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/runtime.ts
    summary: QuickJS 沙箱实现、冻结 wf 对象、parallel/pipeline 原语、超时与中断
    title: dsh_workflow runtime.ts（沙箱与运行时）
  - ref: https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/engine.ts
    summary: 工作流执行引擎：cacheIdentity、agent 分派、结构化校验、验证修复循环、终态写入
    title: dsh_workflow engine.ts（执行引擎）
  - ref: https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/store.ts
    summary: 运行目录与持久化：事件追加、run.json 快照、artifact wx、缓存键、保留清理
    title: dsh_workflow store.ts（运行存储）
  - ref: https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/service.ts
    summary: DynamicWorkflowService 构造与项目分区、rerun 溯源
    title: dsh_workflow service.ts（服务层）
  - ref: https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/index.ts
    summary: 插件入口：inject 依赖、三工具注册、限额配置、trusted-local 边界
    title: dsh_workflow index.ts（插件入口）
  - ref: https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/scoped-review.ts
    summary: 内建 scoped-review 工作流：primary/verifier 多阶段评审与 audit artifact
    title: dsh_workflow scoped-review.ts（治理工作流）
  - ref: https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/types.ts
    summary: WorkflowRunStatus 状态闭集与 WorkflowOutcome 类型
    title: dsh_workflow types.ts（类型定义）
  - ref: https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/cordis.patch.yml
    summary: patch 式插件接入配置
    title: dsh_workflow cordis.patch.yml（接入配置）
object_uid: 80ddce9e-b4d3-4542-b494-f4ad92a9ba4d
fact_type_key: research
created_at: 2026-09-08T21:29:58.700Z
change_log:
  - at: 2026-09-08T21:29:58.700Z
    provider: trae
    model: DeepSeek-V4-Flash-Official
    summary: 受控创建 Research 对象（v5 调研计划 R5：dsh_workflow 0.1.2 可治理多 Agent 工作流层；三路子代理取证+主控核验，含 store 双写、状态机与 attempt 语义逐项核对）
---

## 研究问题

dsh_workflow（0.1.2）的可治理多 Agent 工作流层如何构成——工作流脚本模型、阶段与并发编排、运行生命周期与持久化、多代理调度与交接、宿主接入与工具面——各自解决什么问题、边界在哪

本调研支撑 LDVH 编排技术支撑（02 §8）与工作流自动化设计，为「以脚本驱动多子代理执行」这一能力提供外部实现参照。基线为 dsh_workflow v0.1.2（提交 44b83c1）。

## 输入与边界

方法：三路只读调研子代理分面取证（脚本模型 / 运行生命周期与持久化 / 多代理调度与宿主接入）+ 主控第一手核验。核验中确认 storage 是事件追加 + 快照覆盖双写（store.ts:87-115、engine.ts:716-733），非单纯全量重写。证据形式：逐字摘录 + GitHub blob URL（ref 44b83c1）+ 文件行号锚点。观察时点 2026-09-10。

不覆盖：外部 sessionPersistence 实现、部署注册的 dispatch/isolation adapter 细节、author 语义 lint 全貌（manifest.phases 与脚本阶段一致性未逐行穷尽）。

## 关键发现

### F1 脚本形态：纯 JS 源字符串，统一 run(wf, args) 模型

工作流由纯 JavaScript 源字符串定义，统一入口 `async function run(wf, args)`；meta 为严格校验的 WorkflowManifest（name/description/phases/readOnly/plannedAgents/maxAgents/maxConcurrency/tokenBudget/mayUseWorktree/patterns/inputSchema），无 whenToUse 字段（宿主工具的 whenToUse 疑为另一工具或文档偏差，见未证实）。

**对 LDVH 的价值**：脚本即字符串、meta 即严格 schema——这是「可治理」的起点：工作流是受控输入而非自由代码。LDVH 若把流程固化为脚本，meta 校验是防注入与防失控的第一道闸。

溯源：https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/source-policy.ts（81-83）；https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/capsule.ts（118-156 validateWorkflowManifest）

### F2 加载执行二选一：QuickJS 沙箱或 trusted-local 逐次批准

source 字符串经 QuickJS 沙箱执行（guest 侧冻结 wf 对象 18 方法，经 JSON bridge 触达宿主）；或 host run 函数（trusted-local，每次执行需显式批准）。两种执行模式对应两种信任级别。

**对 LDVH 的价值**：信任分级是治理的关键——不信任的脚本进沙箱、信任的才给宿主权限且逐次批准。LDVH 的 Helper 确定性执行（05 规范）可借鉴这种「默认受限、例外逐次批准」的分层。

溯源：https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/engine.ts（656-668）；https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/runtime.ts（218-240）

### F3 编排原语：parallel 与 pipeline 都逐项失败降级

parallel 用游标并发 lanes=min(concurrency, parallelLimit, n)，逐项失败降级为 null、fatal 重抛；pipeline 每项顺序过全部 stages，失败同样降级为 null。失败不会中断整批，但致命错误会向上抛。

**对 LDVH 的价值**：批处理「单项失败不拖垮整批、致命错误仍显形」是务实的编排语义。LDVH 若做批量子代理（如目标分解后并行取证），应明确单项失败是降级 null 还是终止整批。

溯源：https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/runtime.ts（166-217）；https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/engine.ts（929-952）

### F4 沙箱约束：确定性全局与静态政策

QuickJS 独立堆 64MB/1MB stack；Math.random/Date.now 抛错（确定性）、console 空；静态 policy 禁 import/require/process/fs/shell/网络/timers/eval；bridge 仅白名单方法、全 JSON 边界。

**对 LDVH 的价值**：确定性全局（禁 Math.random/Date.now）是「可复现运行」的强约束——LDVH 若承诺工作流可复现，这是必须抄的机制；禁 eval/网络则直接服务于安全边界。

溯源：https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/runtime.ts（267-268、243-256）；https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/source-policy.ts（13-26）

### F5 上限硬约束：maxAgents 64 / maxConcurrency 8

config 默认 maxAgents 64、maxConcurrency 8，超限抛「workflow agent limit exceeded」；并发信号量取 manifest 与 config 的 min；manifest 不得超部署上限。

**对 LDVH 的价值**：与 R4 的 F10（solo-thinking 限额）一致——任何多代理能力都必须有硬上限且部署侧可收紧。LDVH 编排技术支撑应把「上限可配、超限显形」列为基本要求。

溯源：https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/engine.ts（469、859）；https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/index.ts（84-85）

### F6 schema 校验：结构化输出强制验证

agent 任务 input 经 exactKeys+assertObjectJsonSchema；结果经 structuredEvaluation 校验（原生 structured 优先，否则 fenced JSON 解析）；至多一次同路由无工具修复；仍失败则 task failed。

**对 LDVH 的价值**：结构化输出不是「建议」而是「强制校验 + 有限修复」。LDVH 的子代理结果协议（R1）应升级为 schema 校验级，而不是只靠提示词约定格式。

溯源：https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/engine.ts（165-180、405-440、1159-1226）

### F7 多代理调度：完全寄生在 DSH 原生 subagents 之上

agent() 经 ctx.subagents.start() 创建子代理（或部署注册的 dispatch.start() 支持 target/effort），provider/model 覆盖经 subagentProvider 与 agentOptions 传递。与 R1 已证的 subagents 服务（provider 名、能力广告）完全衔接。

**对 LDVH 的价值**：这是对 R1「宿主能力足够」结论的第三次印证（R4 同向）——复杂工作流引擎也只用 DSH 原生 subagents，不自建调度。LDVH 编排技术支撑应明确「子代理一律走宿主原生，不自建」。

溯源：https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/engine.ts（1076-1132）

### F8 结果收集：runAgent 失败返回 null，结构化校验

子代理结果经 childRun.result 获取，runAgent 失败返回 null；结构化结果经 structuredEvaluation 按 schema 校验，失败降级 null。

**对 LDVH 的价值**：失败显式化为 null 而非抛异常，让调用方可以处理部分成功——这与「防自欺」的取向一致：失败不是被吞掉，而是显式成为可处理的值。

溯源：https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/engine.ts（1145-1148、1246-1270）

### F9 宿主接入：patch 式插件、三工具、inject 依赖

经 package.json.dsh.bundle.patch 指定 cordis.patch.yml（与 R2 的插件接入面一致）；inject ['subagents','tools']；注册三个工具 workflow_list/run_workflow/workflow_manage。

**对 LDVH 的价值**：这是 R2「patch 式接入」与 R1「subagents 服务」的交叉印证——LDVH 作为插件交付时，接入面与依赖声明都应遵循这套宿主机制。

溯源：https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/index.ts（79-81、585-632）；https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/cordis.patch.yml（1-6）

### F10 治理机制：scoped-review 多阶段评审与 cacheIdentity 五元组

scoped-review 内建多阶段评审（独立 primary + 对抗式 verifier + audit artifact），验证循环 attempt 0-2 失败硬抛；cacheIdentity 五元组含 manifest/source/runtime（pluginVersion/dshVersion/verificationAdapter）/路由策略（defaultProvider/modelTiers/readOnlyPolicy）/input，环境或策略变更即失效。

**对 LDVH 的价值**：评审本身也是工作流（评审子代理化）、缓存身份把「环境/策略」纳入键——这两点对 LDVH 都有直接借鉴：复核可以是确定性流程，缓存/复用必须绑定环境指纹。

溯源：https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/scoped-review.ts（445-482、507-525）；https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/engine.ts（1019-1029、1274-1319）

### F11 限制：单层嵌套、AbortSignal 取消、每 run 一信号量

嵌套工作流仅限一层（WorkflowControlError）；取消经 AbortSignal 与 WorkflowControlError；每 run 一个信号量跨阶段共享（含嵌套复用同一信号量）；run 目录按 cwd 项目分区隔离。

**对 LDVH 的价值**：嵌套单层是对「工作流递归」的显式收敛——LDVH 若允许工作流调用工作流，应明确深度上限而非放任递归。

溯源：https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/engine.ts（962、930-946）；https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/service.ts（66-67、302-312）

### F12 运行持久化双写：事件追加 + 快照覆盖

events.jsonl 追加式（带 seq 递增）；run.json 每事件全量重写为当前态快照（projectProcess 全量读回 events 重建 process）；artifacts 用 wx 不可覆写；snapshotScript 固化 workflow.workflow.json/script.js/manifest.json。

**对 LDVH 的价值**：事件日志（权威事实）+ 快照（可重建投影）的分工是可靠运行记录的样板——事件不可变、投影可重建。LDVH 若做运行审计，应优先「追加式事实 + 快照投影」而非直接改事实。

溯源：https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/store.ts（87-125）；https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/engine.ts（716-733）

### F13 生命周期状态机：六态加 TERMINAL 终态集

WorkflowRunStatus 六态（running/paused/completed/failed/denied/stopped）；唯一终态写入点 finish()；审批非 allowed-once 则 denied；脚本正常返回则 completed；abort/异常则 stopped/failed。无「未开始」持久态（start 先写 running 再执行）。

**对 LDVH 的价值**：状态机显式化 + 唯一终态写入点是「状态可信」的前提。LDVH 若做运行管理，应保证终态只由一个权威路径写入，避免多方写状态导致不一致。

溯源：https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/types.ts（22-23）；https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/engine.ts（28、688-707）

### F14 attempt 语义：无 attempt 计数，重跑即新 run

run 级重跑/续跑都产生新 runId 与新目录，靠 sourceRunId（快照重跑）与 resumedFromRunId（缓存续跑）关联；不存在 attempt 计数器或 attempt 目录。

**对 LDVH 的价值**：重试不覆盖历史、新 run 溯源旧 run——这与 LDVH 事实对象「新增不覆盖、CAS 更新」的取向一致。LDVH 若做重跑机制，应保持每次运行可独立追溯。

溯源：https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/service.ts（206-209）；https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/engine.ts（496、524、543-546）

### F15 缓存与回放：只回放已完成且验证干净的结果

task 结果按 cacheKey（sha256(input)-occurrence）留存；只回放「已完成且验证干净（无 verificationWarnings）」的结果；resumeFromRunId 时相同调用序号+相同 input 命中缓存回放（emit cache-hit），其余任务继续执行。

**对 LDVH 的价值**：缓存回放的准入标准（完成 + 验证干净）很关键——不是所有结果都可回放。LDVH 若做结果缓存，必须绑定验证状态，否则会回放未经验证的成果。

溯源：https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/engine.ts（1030-1041）；https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/store.ts（120-130）

### F16 修复与清理：task 级原地验证修复，卸载即停

唯一带 attempt 变量的语义是 task 级原地验证修复循环（attempt 0-2，同一 task 同一 child run 上原地修复，不新建记录）；保留/清理按 TERMINAL 过滤且 maxRetainedRuns 默认 500；卸载即停（effect 清理时 disposeAll）。

**对 LDVH 的价值**：「修复不新建记录」与「清理按终态过滤」都是节制的表现——修复是例外而非常态，清理有上限。LDVH 的复核与沉淀机制可参照这种「有限修复 + 有界保留」。

溯源：https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/engine.ts（1272-1319）；https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/store.ts（184-200）；https://github.com/omdsh-dev/dsh_workflow/blob/44b83c1/src/service.ts（79）

## 未证实与缺口

未证实：
- 宿主 workflow 工具描述（meta whenToUse/phases）与本插件 run_workflow 工具（source+manifest 参数）是否同一实现：本仓库 manifest 白名单无 whenToUse，src/docs/tests 零命中，疑为 DSH 原生另一工具或文档偏差。
- 为何选全量重写 run.json 而非追加：仓库只有机制证据与文档分类描述，无设计理由文本；写放大（每事件全量重写+全量读 events 重建）是未被文档承认的代价。
- manifest.phases 与脚本 wf.phase 无静态一致性校验：capsule.ts 只校验非空字符串数组，source-policy 无 phase 检查，投影只能标 skipped。
- 进程异常退出后遗留 running 无自动 reconcile：全仓 grep 无 reconcil/stale/recover 命中，apply 未见启动扫描判终止；WorkflowOutcome.interrupted 仅由 stopped/denied 映射产生。

缺口：
- （medium）run.json 非原子写、无 fsync/tmp+rename：writeSnapshot 直接 writeFileSync，写中断可能损坏 run.json，list() 用 try/catch 吞掉从而静默隐藏该 run。不阻塞本次调研结论（结论是该机制存在及代价），属实现健壮性缺口，已由建议 A5 承接监测。
- （medium）无跨 run 唯一的 task 标识：task-N 每 run 从 1 计数，results 键为 sha256(input)-occurrence，occurrence 不表达第几次运行尝试。
- （medium）取消不撤回已 spawn 的远程/外部子 agent：stop 走 localAgent.cancel，对无 localAgent 的 dispatch 形态无本地取消路径。
- （medium）每次 persist 全量重读 events.jsonl：projectProcess 每次事件重建 process 都 getEvents 全量解析，长程 run 的事件数放大每事件成本。
- （low）墙钟超时后 writeSnapshot 竞争与终态覆盖：超时经 onTimeout 置 stopped，finish 由 execute 统一写终态，未见显式序列化保证。

## 建议

A1 任何多代理能力都必须有硬上限（agent 数/并发数）且部署侧可收紧、超限显形；验收条件：配置含 agent 数与并发上限，超限抛错且错误信息明确。判断依据：F5、F11。可被 02 §8 编排技术支撑承接。
A2 子代理结果协议升级为 schema 校验级：结构化输出强制校验，至多一次有限修复，失败显式化为可处理值而非吞掉；验收条件：结果校验失败时不产出「看起来成功」的空结果。判断依据：F6、F8。可被子代理协议承接。
A3 复核/评审本身流程化：评审可表述为确定性子代理流程，含独立评审与对抗式验证阶段；验收条件：评审流程有独立评审者与验证者角色，输出有固定结构。判断依据：F10。可被讨论系统与复核制度承接。
A4 缓存/复用必须绑定环境指纹（插件版本、宿主版本、验证适配器、路由策略、输入）；验收条件：复用结果时校验环境指纹，环境变化即失效。判断依据：F10、F15。可被事实对象查重与复用承接。
A5 运行记录采用「事件追加式事实 + 快照可重建投影」双写，且快照写入应原子化（tmp+rename 或 fsync）；验收条件：运行记录含不可变事件流与可重建投影，快照写入不因中断产生损坏文件。判断依据：F12、F13 与 run.json 非原子写缺口。可被 03 事实源与运行审计承接。
A6 重跑/续跑不覆盖历史：每次运行独立可追溯，新 run 溯源旧 run；验收条件：重跑产生新运行记录且含来源字段。判断依据：F14、F16。可被受控提交与版本管理承接。

## 后续分流

- A1、A6 → 02 §8 编排技术支撑；信号：多代理编排或运行管理设计时。
- A2 → 子代理协议；信号：委派协议设计时。
- A3 → 讨论系统与复核制度；信号：复核流程设计时。
- A4 → 事实对象查重与复用；信号：缓存或复用机制设计时。
- A5 → 03 事实源与运行审计；信号：运行记录或审计设计时。
- 与 R1（宿主能力）、R2（插件接入面）、R3（记忆平面）、R4（分支探索）共同构成 LDVH 五大外部依据；R5 与 R4 在编排主题上互补（R4 是分支探索、R5 是脚本化编排），共同支撑 02 §8。
- 无需为 dsh_workflow 再建对象——本 Research 即承载；监测条件：项目版本实质变化（脚本模型或运行生命周期变更）足以改变结论时，新建对象并按 superseded 处置本对象。
