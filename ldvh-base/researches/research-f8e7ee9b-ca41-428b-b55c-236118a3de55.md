---
title: 交还设计的业界做法与 LDVH 七项结构的对照
status: active
research_question: 对话任务闭环中交还的设计，业界插件与项目是如何做的，LDVH §7.4 的七项结构化交还是否属于多余设计
research_purpose: 支撑 00 §2 根方案第四条对交还控制点的义务与判据表述，并为 §7.4 交还结构是否保留、是否调整提供业界依据，回答交还是否为多余设计
stopping_reason: round-cap
confirmed_statements:
  - 业界主流是结构化交还而非压缩式总结，且已有公开协议
  - 状态分层是共识，Handover 拆得比 LDVH 更细
  - 结构化交还不自动脱敏，逐项筛选仍是义务
  - LDVH 相比业界协议缺三项，恰是协议强调的
  - 多家框架把交还做成编排原语，宿主只提供时机与通道
  - 业界亦有更精简的取向，粒度可按风险分级
gaps:
  - blocked_scope: 七项与八字段的一一映射
    description: 本次比对是逐字段语义对齐，非来源自身的对照声明，缺权威映射依据
    priority: medium
  - blocked_scope: 各协议的实证效果
    description: Handover 提供 benchmark 页面，但未见其对长程任务接续成功率的对照数据
    priority: medium
  - blocked_scope: 未决复核是否适用于 LDVH
    description: LDVH 事实对象有 review 机制，但交还层是否需要承载未决复核属设计判断
    priority: medium
  - blocked_scope: blocked 与 inProgress 在 LDVH 内的归类
    description: WorkCase 已有 attempt 与状态闭集，二者与交还状态如何映射未核
    priority: low
  - blocked_scope: Sanna Governance Envelopes 论文的完整主张
    description: 论文提出跨越观察边界时需可独立验证的证据，本次未展开
    priority: low
implications:
  - finding_ref: 业界主流是结构化交还而非压缩式总结，且已有公开协议
    implication: §7.4 的结构化方向可保留，不必退回压缩式总结。
  - finding_ref: 状态分层是共识，Handover 拆得比 LDVH 更细
    implication: 可考虑把交还状态由两分扩为已完成／进行中／阻塞／未证实四类。
  - finding_ref: 结构化交还不自动脱敏，逐项筛选仍是义务
    implication: 支持 §7.4 保留已证实与未证实分开的判断要求。
  - finding_ref: LDVH 相比业界协议缺三项，恰是协议强调的
    implication: 可考虑增补证据与约束／边界两项，缺的是业界强调的而非多余的。
  - finding_ref: 业界亦有更精简的取向，粒度可按风险分级
    implication: 七项可与 §7.1 粒度原则对齐，改为按风险匹配的必含项。
urls:
  - ref: https://handover.sh/protocol
    summary: 核心依据：开放协议的八字段规范表述、JSON Schema（Draft 2020-12）、合法示例与零依赖验证器；限制：自述为 Handover 创造的开放格式，非 MCP 或 A2A 官方标准
    title: "AI Agent Handoff Protocol: Handoff Continuity Record v1.0 · Handover"
  - ref: https://handover.sh/templates/agent-handoff
    summary: 支持状态四分法：明确要求已完成、进行中、被阻塞与未经验证分开保存；限制：为该协议的配套模板，与协议同源非独立来源
    title: AI agent handoff checklist and template · Handover
  - ref: https://openai.github.io/openai-agents-python/handoffs
    summary: 支持「结构化不等于自动安全」：明确警告结构化交还不脱敏，工具参数与输出可能仍留在摘要中；限制：为框架文档，绑定 OpenAI SDK 的具体实现
    title: Handoffs - OpenAI Agents SDK
  - ref: https://www.taskade.com/blog/agent-handoff-explained
    summary: 支持「LDVH 缺约束项」：六字段版独立列 BOUNDARY，与 Handover 的 constraints 对应；限制：博客来源，为精简取向的代表而非权威标准
    title: "Agent Handoff Explained: How AI Agents Pass Work (2026)"
  - ref: https://cellcog.ai/blog/ai-agent-handoff-protocols
    summary: 支持「粒度可按风险分级」：主张传递最小必要集并把交接失败归为八类；限制：博客分析，未提供接续成功率的对照数据
    title: "AI Agent Handoff Protocols: What Must Travel With the Task"
  - ref: https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/handoff
    summary: 支持「交还是编排原语、宿主只给时机与通道」：交还是交互式编排，agent 不交接时需人类输入才能继续；限制：绑定 Microsoft Agent Framework 的编排模型
    title: Microsoft Agent Framework Workflows Orchestrations - Handoff
  - ref: https://github.com/club-cog/devin-handoff
    summary: 支持「多家工具把交还做成可复用流程」：开源插件与 skill，自动收集仓库、分支与未提交改动后创建会话并可轮询；限制：为 Devin 专用实现，非通用协议
    title: "GitHub - club-cog/devin-handoff: Hand off tasks to Devin"
  - ref: https://mindstudio.ai/blog/what-is-agent-handoff-pattern
    summary: 支持「交还是契约而非对话修辞」：强调输出应结构化以供下游消费；限制：博客分析，与前述来源观点重叠非独立验证
    title: What Is the Agent Handoff Pattern? | MindStudio
object_uid: f8e7ee9b-ca41-428b-b55c-236118a3de55
fact_type_key: research
created_at: 2026-10-07T03:15:17.809Z
change_log:
  - at: 2026-10-07T03:15:17.809Z
    provider: workbuddy
    model: space-bunny
    summary: 登记交还设计的业界调研，支撑 00 §7.4 结构化交还的存废判断
---

## 研究问题

对话任务闭环中交还的设计，业界插件与项目是如何做的，LDVH §7.4 的七项结构化交还是否属于多余设计

## 输入与边界

**输入**：00 §2 根方案第四条（五个控制点含交还）、§7.4 交还与撤回（七项下限）、§1 人的四大短板中的进展断续与经验离散、02 §20 交还（含 Output Envelope）、08 §5.4 事件面（宿主提供的 turn-stopping 与 turn/end）。

**边界**：只调研交还的内容结构与判据，不调研传输与路由；不修改 00 任何条文。

## 关键发现

### 业界主流是结构化交还而非压缩式总结，且已有公开协议

Handover Continuity Record v1.0（2026-08-05 更新，MIT 许可）是平台中立的开放协议，用 JSON Schema（Draft 2020-12）定义八个接续字段：objective（目标与验收标准）、currentState（complete／inProgress／blocked／unverified 四类分开）、decisions（active 与 superseded 并带理由）、evidence（文件、URI、contentType 与可选 SHA-256 完整性摘要）、constraints（权限、安全规则、期限、预算、依赖与排除）、nextAction（一个具体接续步骤与其可观察结果）、ownership（下一个负责的人或代理及可选复核者）、openReview（未决反馈与已决发现并链接到处理它的修订）。该协议明确说明它使这些字段机器可读，而不规定 agent 如何被路由、认证或托管，并提供可下载的 schema、合法示例与零依赖 Node.js 验证器。

对 LDVH 的意义：LDVH §7.4 的结构化方向与业界一致，且有可参照的公开 schema 与验证器，不是闭门造车。

溯源：https://handover.sh/protocol（八字段的规范表述、JSON Schema 与验证器说明）

### 状态分层是共识，Handover 拆得比 LDVH 更细

Handover 把 currentState 拆为 complete、inProgress、blocked、unverified 四类，明确要求已完成的、进行中的、被阻塞的与未经验证的主张分开保存。Taskade 的六字段版亦含 STATE SETTLED、OPEN、BLOCKED 三个状态位。LDVH §7.4 的已证实范围与未证实范围与残留风险正对应其中的 complete 与 unverified，但缺 inProgress 与 blocked 两类。

对 LDVH 的意义：LDVH 的两分法方向正确，但状态维度可考虑补入进行中与阻塞两类。

溯源：https://handover.sh/templates/agent-handoff（四状态分离的交接检查表与模板）

### 结构化交还不自动脱敏，逐项筛选仍是义务

OpenAI Agents SDK 的 handoff 文档明确警告：嵌套的交接历史会改变 transcript 的表示方式，但不脱敏敏感数据；工具调用参数与工具输出可能仍留在生成的 assistant 摘要中，即使对应的结构化工具项已不再单独转发。该文档要求接收方把交接视为上下文交接来对待。

对 LDVH 的意义：支持 §7.4 保留已证实与未证实分开这类判断要求——结构化不等于自动安全，仍需逐项筛选。

溯源：https://openai.github.io/openai-agents-python/handoffs（结构化交还不自动脱敏的警告与接收方处置要求）

### LDVH 相比业界协议缺三项，恰是协议强调的

逐字段比对 Handover v1.0 与 LDVH §7.4 七项：LDVH 覆盖 objective（部分，未含验收标准）、currentState 的 complete 与 unverified、decisions（未含被取代的旧决定）、nextAction、ownership（偏待决事项而非归属）；未覆盖 evidence（含完整性摘要）、constraints（权限、安全、期限、预算、依赖与排除）、openReview（未决反馈与已决发现）。Taskade 的六字段版亦独立列出 BOUNDARY，与 constraints 对应。

对 LDVH 的意义：LDVH 缺的是业界协议强调的证据、约束与未决复核三项，不是过多；其中约束与边界对长程项目的授权范围判断尤其相关。

溯源：https://www.taskade.com/blog/agent-handoff-explained（六字段版含 BOUNDARY，与 LDVH 缺约束项互证）

### 多家框架把交还做成编排原语，宿主只提供时机与通道

Microsoft Agent Framework 的 Handoff 编排把交接做成工作流原语，并指出交还是交互式的，因为 agent 未必在每轮后决定交接；若 agent 不交接，则需要人类输入才能继续对话。Devin Handoff 是开源插件与 skill，把同一交接工作流带给任意编码 agent，其流程是自动收集当前仓库、分支与未提交改动、创建会话并可轮询至完成。AffinityBots 的技术分析则给出原则：交接改变责任，应当作契约而非会话修辞，传递已验证事实、约束、出处与定义的输出 schema，不要传递一堆神秘对话历史。

对 LDVH 的意义：印证 §7.4 把交还定义为契约性内容义务而非对话收尾是对的；也印证宿主提供时机与通道、内容义务须由 LDVH 定义这一分工。

溯源：https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/handoff（交还是交互式编排原语，agent 不交接时需人类输入）

### 业界亦有更精简的取向，粒度可按风险分级

除八字段的 Handover 外，Taskade 采用六字段（OBJECTIVE、STATE SETTLED、OPEN、BLOCKED、EVIDENCE、BOUNDARY），CellCog 则强调与任务一同传递最小必要集并把交接失败归类为八种类型，主张只重试改变了的条件，把同一份包重发给同一接收方不构成修复计划。这些取向表明交还内容可按风险与场景裁剪，而非一律最全。

对 LDVH 的意义：与 00 §7.1 已有原则「验证、审核、预检和交还粒度应与潜在影响相适应」一致，七项可考虑改为按风险匹配的必含项，而非每次一律七项。

溯源：https://cellcog.ai/blog/ai-agent-handoff-protocols（最小必要集与八类交接失败的默认响应）

## 未证实与缺口

- **七项与八字段的一一映射无权威依据**：本次比对是逐字段语义对齐，非来源自身的对照声明。
- **各协议的实证效果未见系统评估**：Handover 提供 benchmark 页面，但未见其对长程任务接续成功率的对照数据。
- **未决复核是否适用于 LDVH 未证实**：LDVH 的事实对象有 review 机制（如 WorkCase 的 reviews），但交还层是否需要承载未决复核，取决于 §7.4 是否要覆盖复核流转，属设计判断。
- **blocked 与 inProgress 在 LDVH 内的归类未验证**：WorkCase 已有 attempt 与状态闭集，二者与交还状态如何映射未核。
- **Sanna 的 Governance Envelopes 论文提出跨越观察边界时需要可独立验证的证据，本次未展开其完整主张**。

## 建议

1. §7.4 的结构化方向可保留——已有公开 schema 与验证器为据，不必退回压缩式总结。
2. 考虑把交还状态由已证实／未证实两分扩为已完成／进行中／阻塞／未证实四类，与 Handover 对齐。
3. 考虑增补证据与约束／边界两项——前者对应证据可回指，后者对应授权范围，Taskade 独立列 BOUNDARY 可佐证。
4. 未决复核是否纳入交还，按 LDVH 自身是否需要承载复核流转决定，不宜直接照搬。
5. 七项的必含程度可与 §7.1 的粒度原则对齐，改为按风险匹配。

## 后续分流

- 状态四分法与证据／约束两项，供 §7.4 修订使用的候选。
- 未决复核是否纳入，保留为设计判断，不在本次定论。
- 七项是否改为按风险匹配，与 §7.1 既有原则的合并处理留待 §7 修订。
