---
title: dsh-solo-thinking 独立 Session 思考树与显式 Handoff（0.1.19：分支隔离/三角色 Handoff/限额收敛/宿主原语接入）
status: active
research_question: dsh-solo-thinking（0.1.19）的独立 Session 思考树与显式 Handoff 机制如何构成——分支模型与独立会话、思考树数据结构与持久化、Handoff 的撰写与传递、分支导航与恢复、工具面与宿主接入——各自解决什么问题、边界在哪
research_purpose: 支撑 LDVH 编排技术支撑（02 §8）与讨论系统的多视角并研设计：明确独立 Session 思考树与显式 Handoff 的机制与边界，为 LDVH 子代理编排、分支隔离与上下文交接提供外部依据
stopping_reason: sufficient
confirmed_statements:
  - F1 一分支一独立 DSH Session，节点即会话
  - F2 树是扁平节点数组加 parentId 链
  - F3 状态机三态加休眠与两个瞬时旗标
  - F4 持久化走会话事件流，每个分支自带完整副本
  - F5 上下文隔离是硬不变量：父子绝不共享原始消息
  - F6 三种 Handoff 语义角色，配模板与 8000 字符硬限
  - F7 Handoff 由 Agent 主动撰写，失败不静默降级
  - F8 注入走动态系统提示段与回传消息两条路径
  - F9 工具面八个，输出契约统一
  - F10 限额硬约束防树爆炸
  - F11 宿主接入靠原生服务与生命周期钩子
  - F12 并发与顺序边界：运行中的分支拒绝回传与检查点
  - F13 建议分支把发散收敛为一次性动作
uncertain:
  - issue: 落盘路径与格式不在本仓库：持久化委托外部 DSH sessionPersistence 服务，本插件只调 load/append 与 Session.append，无法给出磁盘文件路径与格式
    reason: 注入的外部服务无本仓库实现，持久化细节属宿主侧
  - issue: 跨进程并发无锁：serializeWrite 的 Map 是 apply 闭包内每进程一份，不能串行化其他 DSH 实例的追加，仓库内无 CAS 或乐观锁
    reason: 代码中无跨进程锁或冲突检测，是否由持久层兜底不可见
  - issue: 无决策记录解释为何不做历史继承的动机论证，只有结果性陈述（不变量加 composeFrom 注释）
    reason: 仓库无设计决策记录类文档
gaps:
  - description: 崩溃中间态只覆盖两类：recoverIncompleteOperation 仅处理 returning 与 checkpointRefreshing，forkHandoffPending 无超时自动回收只能手动重试
    priority: medium
  - description: 重启后 AgentHandle 重建路径未显式：effect 清理时 dispose 全部句柄，冷启动如何重建仅 E2E 与 README 提及，源码未见显式重建逻辑
    priority: medium
  - description: 多分支回传后父会话仅收到多条 notice，模型需自行聚合，无跨分支冲突检测或合并机制
    priority: medium
  - description: 真实模型下的 Handoff 撰写质量未被端到端验证，仓库明确将其列为独立验收项
    priority: low
  - description: revision 冲突仅取最大覆盖，无合并或向量时钟，多分支并发推进时以最大 revision 为准
    priority: low
implications:
  - finding_ref: F1 一分支一独立 DSH Session，节点即会话
    implication: 与 DSH 原生 spawn/fork 构成对照，LDVH 需先在继承历史与独立会话间做明确选择，两者对上下文成本与串扰风险影响不同
  - finding_ref: F2 树是扁平节点数组加 parentId 链
    implication: 扁平全量快照在小规模时更简单，对比 LDVH 事实对象各自独立成文件，两种读取模式需在规范里说明取舍
  - finding_ref: F3 状态机三态加休眠与两个瞬时旗标
    implication: 把中间态显式化是崩溃可恢复的前提，LDVH 调研会话状态机可借鉴瞬时旗标加超时恢复的建模
  - finding_ref: F4 持久化走会话事件流，每个分支自带完整副本
    implication: 冗余换自治的取舍，与 LDVH 集中式事实源加 Git 相反，此对比应写进规范选择理由
  - finding_ref: F5 上下文隔离是硬不变量：父子绝不共享原始消息
    implication: 证明不继承是正当且被认真实现的选择，LDVH 多视角并研应明确采用哪种而非默认继承
  - finding_ref: F6 三种 Handoff 语义角色，配模板与 8000 字符硬限
    implication: 按语义角色分类型让回传内容有结构，LDVH 子代理结果协议可吸收此写法而非只用自由文本
  - finding_ref: F7 Handoff 由 Agent 主动撰写，失败不静默降级
    implication: 不代写不静默降级是防自欺的具体机制，宁可失败暴露也不伪造交接，与 00 §7 同向
  - finding_ref: F8 注入走动态系统提示段与回传消息两条路径
    implication: 稳定内容进提示段、事件性内容进消息流的分工，可作为 LDVH 上下文注入的参照
  - finding_ref: F9 工具面八个，输出契约统一
    implication: 八个工具覆盖完整生命周期且每动作对应显式工具，与 LDVH 偏好显式受控操作的取向一致
  - finding_ref: F10 限额硬约束防树爆炸
    implication: 发散型机制必须配收敛护栏，LDVH 任何多方向生成能力都应同时配可配置上限
  - finding_ref: F11 宿主接入靠原生服务与生命周期钩子
    implication: 完全寄生于 DSH 原生原语、无自建存储调度，印证 R1 宿主能力足够的结论，也提示 LDVH 应优先复用宿主原语
  - finding_ref: F12 并发与顺序边界：运行中的分支拒绝回传与检查点
    implication: 生命周期时序闸门与 LDVH 的 CAS 版本闸门互补，并行分支需同时具备两者
  - finding_ref: F13 建议分支把发散收敛为一次性动作
    implication: 建议休眠加显式启动的节奏可防止 AI 自行不断开枝，适用于目标分解与讨论扩散
urls:
  - ref: https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/domain.ts
    summary: ThinkingNode 与 ThinkingSpace 结构、状态机、限额强制、Handoff 归一化与分支上下文提示原文
    title: dsh-solo-thinking domain.ts（树模型与状态机）
  - ref: https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/index.ts
    summary: 八个 thinking_ 工具注册与契约、宿主注入与生命周期钩子、appendSpace 持久化与 serializeWrite 串行化、分支上下文注入与回传消息
    title: dsh-solo-thinking index.ts（宿主实现与工具面）
  - ref: https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/docs/ARCHITECTURE.md
    summary: 三条架构不变量、继承范围界定、Handoff 三角色语义、持久化与注入时机、失败与恢复语义
    title: dsh-solo-thinking ARCHITECTURE.md（架构不变量与语义）
  - ref: https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/client/index.tsx
    summary: openSession 显式导航与 sendToBranch 直接投递的客户端实现
    title: dsh-solo-thinking client/index.tsx（分支导航与投递）
  - ref: https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/README.md
    summary: 跨分支信息只来自显式 Handoff、发送目标由 DSH Session ID 隔离等边界说明
    title: dsh-solo-thinking README.md（使用与边界）
object_uid: 4bf178fc-a8f5-476a-b054-fcf0ac17dfbe
fact_type_key: research
created_at: 2026-09-08T20:54:26.729Z
change_log:
  - at: 2026-09-08T20:54:26.729Z
    provider: workbuddy
    model: hy4-preview
    summary: 受控创建 Research 对象（v5 调研计划 R4：dsh-solo-thinking 0.1.19 独立 Session 思考树与显式 Handoff；三路子代理取证+主控核验，含 serializeWrite 定义与限额逐项核对）
---

## 研究问题

dsh-solo-thinking（0.1.19）的独立 Session 思考树与显式 Handoff 机制如何构成——分支模型与独立会话、思考树数据结构与持久化、Handoff 的撰写与传递、分支导航与恢复、工具面与宿主接入——各自解决什么问题、边界在哪

本调研支撑 LDVH 编排技术支撑（02 §8）与讨论系统的多视角并研设计，为「多方向并行探索后收敛」这一工作流提供外部实现参照。基线为 dsh-solo-thinking v0.1.19（提交 a77f3bb）。

## 输入与边界

方法：三路只读调研子代理分面取证（分支模型与树持久化 / Handoff 协议 / 工具面与宿主接入）+ 主控第一手核验。核验中修正两处检索误差：serializeWrite 是非导出函数定义于文件末尾（src/index.ts 共 955 行、定义始于 938 行），并发串行化与限额配置均已逐项核对。证据形式：逐字摘录 + GitHub blob URL（ref a77f3bb）+ 文件行号锚点。观察时点 2026-09-10。

不覆盖：外部 DSH sessionPersistence 服务的磁盘格式与跨进程并发兜底（不在本仓库）、真实模型撰写 Handoff 的质量端到端验证（仓库自身列为独立验收项）。

## 关键发现

### F1 一分支一独立 DSH Session，节点即会话

根节点 id 与 sessionId 都等于根会话 ID；每个子分支经 ctx.agents.create 建立自己的 DSH Session，id 为 thinking 加 uuid，sessionId 由该 id 派生。也就是说分支不是一个逻辑标记，而是一个真实的独立会话实体。

**对 LDVH 的价值**：这与 DSH 原生 subagent 的 spawn 语义（F8 在 R1 中已证：spawn 零父上下文、fork 继承已完成回合前缀）形成对照——solo-thinking 选择了「独立会话 + 显式交接」这条第三条路。LDVH 若要支持多方向并研，需要先在「继承历史」与「独立会话」之间做出明确选择，两者对上下文成本与串扰风险的影响完全不同。

溯源：https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/index.ts（121-122 子节点 id 与 sessionId 生成、904-916 createChildHandle）

### F2 树是扁平节点数组加 parentId 链

树没有嵌套结构：所有节点平铺在 nodes 数组里，父子关系靠 parentId（根为 null）、兄弟顺序靠 sortOrder、层级靠 depth（子节点等于父 depth 加一）。这种表示让整棵树可以一次性序列化为一个快照对象。

**对 LDVH 的价值**：扁平化是它能把整棵树塞进一条状态事件的前提——对比 LDVH 事实对象各自独立成文件、关系靠 frontmatter 声明，两种做法对应不同的读取模式（全量快照 vs 按需召回）。若 LDVH 将来要表达「多分支探索」这类结构，扁平全量快照在小规模时更简单，但规模增长后需要像它一样配限额。

溯源：https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/domain.ts（9-29 节点字段、243-289 addChildNode 与 depth/sortOrder 计算）

### F3 状态机三态加休眠与两个瞬时旗标

节点状态为 active、returning、returned 三态流转，新建节点默认 dormant（休眠），由首次用户消息或 turn 开始事件激活；另有两个瞬时旗标：forkHandoffPending（等待父分支补写 Handoff）与 checkpointRefreshingAt（正在整理当前状态）。这两个旗标把「进行到一半」的中间态显式建模出来，而不是靠推断。

**对 LDVH 的价值**：把中间态显式化是崩溃可恢复的前提——LDVH 调研会话状态机（11 号规范）目前有收敛与轮次概念，但可以借鉴这种「瞬时旗标加超时恢复」的建模方式，尤其是 forkHandoffPending 这类等待外部补写的状态，需要明确的恢复路径（本项目此处恰是缺口，见后文）。

溯源：https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/domain.ts（7 状态类型、283 dormant、347-390 beginReturn/returnNode/cancelReturnNode）

### F4 持久化走会话事件流，每个分支自带完整副本

整棵树以 solo-thinking/state 事件快照写入每一个分支会话的追加式事件流；对未加载的会话则经宿主 sessionPersistence 服务补写；恢复时折叠事件重建空间，并通过 sessionProjections 注册视图（已结束的空间在视图里返回 null）。写入用进程内的 serializeWrite 串行化，并按 revision 幂等去重。

**对 LDVH 的价值**：「每个分支都存一份完整树」是冗余换自治的取舍——任一分支都能独立恢复全貌，代价是写入要广播到所有会话。LDVH 事实源走的是集中式（ldvh-base 单一目录加 Git），两者取舍相反：集中式靠 Git 保证一致性与可回退，分布式靠冗余保证分支自治。这个对比值得写进规范选择的理由里。

溯源：https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/index.ts（805-848 appendSpace 与 persistence 调用、782-792 定位空间、938-955 serializeWrite 定义）

### F5 上下文隔离是硬不变量：父子绝不共享原始消息

架构不变量第一条即为「一个思考节点映射一个 DSH 会话，父子永不共享原始消息」；上下文明文要求不得推断或索取其他分支的原始对话；子分支只通过 composeFrom 继承模型选项、工作区路径、工具与 preset，不复制对话历史。thinking_split 的工具描述也直写「原始历史从不被复制」。

**对 LDVH 的价值**：这条与 R1 已证的 DSH 原生 fork（继承已完成回合前缀）构成一组鲜明对照——它证明了「不继承」是一种正当且被认真实现的选择，其收益是分支间零串扰、单分支上下文成本低。LDVH 讨论系统若要做多视角并研，应明确采用哪种，而不是默认继承。

溯源：https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/docs/ARCHITECTURE.md（11 不变量一、39-41 继承范围）；https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/domain.ts（407 隔离原句）

### F6 三种 Handoff 语义角色，配模板与 8000 字符硬限

Handoff 是节点间唯一显式交换的语义上下文，纯 Markdown，分三种角色：inheritedHandoff（父到子，不可变）、checkpointHandoff（本分支当前状态给兄弟，可替换）、returnedHandoff（子到父，终态封存）。系统给出提示性结构模板（目标与范围、已确认结论、证据或产物、未决问题、风险与假设、推荐下一步），但只做非空与长度校验，不校验标题结构；长度默认上限 8000 字符，标题上限 80 字符。

**对 LDVH 的价值**：三角色分工很讲究——不可变的继承项保证方向不被篡改、可替换的检查点承载进展、终态回传用于收敛。LDVH 的子代理结果协议（R1 已证 send_message 只相邻、结果需带回父级）可以吸收这种「按语义角色分类型」的写法，让回传内容有结构而不只是自由文本。

溯源：https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/domain.ts（19-21 三字段、43-50 限额、491-504 normalizeHandoff 与标题校验）；https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/index.ts（705-729 模板提示）

### F7 Handoff 由 Agent 主动撰写，失败不静默降级

系统只生成控制轮提示，从不代写正文；分裂、检查点、回传三类时机都要求 Agent 主动调用工具撰写。若未写：回传失败直接抛错并把分支恢复为 active 可重试、fork 未补写则子节点保持只读的 pending 状态、pre-step 会拒绝 pending 与 returned 节点的步骤。空或超长直接抛错并回滚创建。

**对 LDVH 的价值**：「不代写、不静默降级」是防自欺的具体机制——宁可失败暴露，也不伪造一份看起来完整的交接。这与 LDVH 00 §7 的方向一致，可作为「AI 产出必须有据、缺失必须显形」的实现范例。

溯源：https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/index.ts（350-355 回传失败抛错、226-228 pending 保留、404-408 pre-step 拒绝）

### F8 注入走动态系统提示段与回传消息两条路径

分支上下文渲染进名为 solo-thinking:branch-context 的动态系统提示段（order 50），内容包含不可变的父继承 Handoff、直接兄弟的检查点与回传、直接子分支的回传，以及生命周期与工具规则；回传时另向父会话追加一条插件来源的用户消息，标题为「Handoff returned from 分支名」，使其持久、可见、模型可读。兄弟与父分支不会被后台唤醒，只在各自下一次显式模型轮消费。

**对 LDVH 的价值**：「回传消息持久化 + 上下文段动态渲染」的双通道，既保证了交接内容进入会话历史可追溯，又让每步上下文保持有界。LDVH 注入上下文时可参照这种分工：稳定内容进提示段、事件性内容进消息流。

溯源：https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/index.ts（393-402 上下文段、850-867 回传消息）；https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/docs/ARCHITECTURE.md（61-68 注入与消费时机）

### F9 工具面八个，输出契约统一

注册给模型的工具为 thinking_start、thinking_suggest、thinking_fork_handoff、thinking_split、thinking_checkpoint、thinking_return、thinking_end、thinking_status 八个，输出统一为 ok 加 message 加 revision 加可选 sessionId。

**对 LDVH 的价值**：八个工具覆盖「建空间—发散—补写—分裂—进展—回传—结束—查看」的完整生命周期，且每个动作都对应一个显式工具而非隐式行为——这与 LDVH 偏好显式受控操作的取向一致，可作为工具面设计的规模参照（对比 mnemon 的 16 个、LDVH ldvh 工具族）。

溯源：https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/index.ts（427-585 八个工具注册与契约）

### F10 限额硬约束防树爆炸

配置含 maxDepth、maxBranches、maxNodes、maxHandoffChars 四项并可在 domain 层强制：深度、节点总数、每个父的兄弟数、Handoff 长度，另加兄弟重名拒绝（大小写不敏感）与重复 id 拒绝。

**对 LDVH 的价值**：发散型机制必须有收敛护栏，否则探索树会失控。LDVH 若引入任何「多方向生成」的能力（如目标分解、讨论扩散），都应同时配可配置的深度与数量上限，而不是只靠提示词约束。

溯源：https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/index.ts（57-63 配置 schema）；https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/domain.ts（251-268 限额强制与重名拒绝）

### F11 宿主接入靠原生服务与生命周期钩子

硬注入 agents、sessions、systemPrompt、tools、workspaceRegistry，可选探测 sessionProjections、commands、sessionPersistence、agentPresets；生命周期方面用 effect 安装事件目录与清理句柄，用 pre-step 与 session/event 两个钩子做分支门禁、休眠激活与崩溃恢复，并用 sessionProjections 注册视图（已结束空间视图返回 null）。

**对 LDVH 的价值**：它完全寄生在 DSH 原生会话与代理服务之上，没有自建存储与调度——这印证了 R1 中「宿主能力足够支撑复杂插件」的结论，也说明 LDVH 插件应优先复用宿主原语而非自建基础设施。

溯源：https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/index.ts（45 硬注入、97-103 effect、384-391 projections、404-425 事件钩子）

### F12 并发与顺序边界：运行中的分支拒绝回传与检查点

请求回传或检查点时若分支 Agent 正在运行则直接阻塞；回传还要求所有直接子分支都已回传，避免父分支先于子分支收敛造成悬空。

**对 LDVH 的价值**：这是对「操作时序」的显式建模——与 LDVH 受控写入的 CAS 思路互补：CAS 管的是版本冲突，这里管的是生命周期时序。LDVH 编排若允许多分支并行，需要同时具备这两种闸门。

溯源：https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/index.ts（188-189、238、284 运行中阻塞）；https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/domain.ts（481-489 回传前置条件）

### F13 建议分支把发散收敛为一次性动作

thinking_suggest 只在根节点的首次扇出可用，一次建 2 到 4 个方向（优先 4 个），且一旦该分支已有子节点就不再建议；建议出来的分支是休眠态，不会自动运行。

**对 LDVH 的价值**：这是「发散有节制」的样板——允许一次性给出多个方向，但不允许无限生长，且建议不等于执行（休眠态必须由人选择才启动）。LDVH 目标分解与讨论扩散都可借鉴这种「建议休眠 + 显式启动」的节奏，避免 AI 自行不断开枝。

溯源：https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/domain.ts（162-171 仅首次扇出与数量约束）；https://github.com/fredalxin/dsh-solo-thinking/blob/a77f3bb/src/index.ts（467-498 thinking_suggest）

## 未证实与缺口

未证实：
- 落盘路径与格式不在本仓库：持久化委托外部 DSH sessionPersistence 服务，本插件只调 load/append 与 Session.append，无法给出磁盘文件路径与格式。
- 跨进程并发无锁：serializeWrite 的 Map 是 apply 闭包内每进程一份，不能串行化其他 DSH 实例的追加，仓库内无 CAS 或乐观锁，是否由持久层兜底不可见。
- 无决策记录解释「为何不做历史继承」的动机论证，只有结果性陈述（不变量加 composeFrom 注释）。

缺口：
- （medium）崩溃中间态只覆盖两类：recoverIncompleteOperation 仅处理 returning 与 checkpointRefreshing，forkHandoffPending 无超时自动回收，只能手动重试。
- （medium）重启后 AgentHandle 重建路径未显式：effect 清理时 dispose 全部句柄，冷启动如何重建仅 E2E 与 README 提及，源码未见显式重建逻辑。
- （medium）多分支回传后父会话仅收到多条 notice，模型需自行聚合，无跨分支冲突检测或合并机制。
- （low）真实模型下的 Handoff 撰写质量未被端到端验证，仓库明确将其列为独立验收项。
- （low）revision 冲突仅取最大覆盖，无合并或向量时钟，多分支并发推进时以最大 revision 为准。

## 建议

A1 LDVH 编排若引入多方向并研，先明确「继承历史」与「独立会话加显式交接」的选择并写入规范；验收条件：规范文本含该选择的理由与对上下文成本、串扰风险的影响说明。判断依据：F1、F5。可被 02 §8 编排支撑与讨论系统设计承接。
A2 子代理结果协议按语义角色分类型（继承项/进展态/终态回传），并为每类配长度与结构约束；验收条件：回传内容区分不可变继承与可替换进展，且有长度上限。判断依据：F6、F8。可被子代理协议与讨论系统承接。
A3 任何发散能力（目标分解、讨论扩散）必须同时配可配置的深度与数量上限，且建议态默认休眠不自动执行；验收条件：配置含深度、节点数、兄弟数上限，生成的建议分支需显式启动。判断依据：F10、F13。可被 30 号目标分解模板与讨论系统承接。
A4 交接内容由 AI 撰写、系统不代写、失败不静默降级，缺失即显形并可重试；验收条件：未撰写交接时工具报错且分支保留可重试，不产生空或占位交接。判断依据：F7。可被 05 Helper 与子代理协议承接。
A5 多分支并行需同时具备版本闸门（CAS）与生命周期时序闸门（运行中拒绝跃迁、父收敛需子先收敛）；无需对象化——监测条件：LDVH 引入并行分支能力时回读本对象 F12 复核。判断依据：F12。

## 后续分流

- A1、A3 → 02 §8 编排支撑与讨论系统、30 号目标分解模板；信号：多方向并研或目标分解能力设计时。
- A2、A4 → 子代理协议与 05 Helper 规范；信号：委派协议或 Helper 实现设计时。
- A5 → 编排与受控写规范；信号：并行分支能力引入时。
- 与 R1（宿主能力）、R2（插件接入面）、R3（记忆平面）共同构成 LDVH 四大外部依据，互不复制、互相引用；R5（dsh_workflow）与本对象在编排主题上互补（本对象是分支探索，workflow 是脚本化编排）。
- 无需为 dsh-solo-thinking 再建对象——本 Research 即承载；监测条件：项目版本实质变化（分支模型或 Handoff 协议变更）足以改变结论时，新建对象并按 superseded 处置本对象。
