---
title: dsh-mnemon 可组合记忆控制平面（0.5.5 基线 + 0.5.26 闲时机制增补：三层记忆/Provider 能力诚实/热记忆写回/图与工具信封/idle review）
status: active
research_question: dsh-mnemon（0.5.5）的可组合记忆控制平面由哪些机制构成——记忆空间与 Provider 体系、运行时记忆协议与压缩、文档检索、持久图关系与工具面——各自解决什么问题、边界在哪
research_purpose: 支撑 LDVH 记忆业务系统规范的建立（四大业务系统中唯一尚无专门规范的一支）：明确可组合记忆控制平面的机制与边界，为 LDVH runtime-memory/文档/持久空间三分提供外部依据。2026-11 增补：追加闲时机制专项，为 LDVH 32 章 §10 空闲维护与反思提供工程级外部依据。
stopping_reason: sufficient
confirmed_statements:
  - F1 三层记忆模型与统一存储根
  - F2 Source 拥有数据、Strategy 纯确定性、View 只给有界上下文
  - F3 九种可替换数据面与能力诚实原则
  - F4 自动放置的硬规则链：过滤在先、模型在后、Host 复核
  - F5 热记忆容量与计量口径
  - F6 USER.md 满走本地保守合并，用户画像绝不出本机
  - F7 MEMORY.md 满才写 Provider，且写的是原始条目原文
  - F8 压缩的 CAS 与不破坏性回滚
  - F9 快照是自有 recall 消息，不是系统提示段
  - F10 受管文档：index.json 为元数据真相源，单文档 2 MiB、active 总 10 MiB
  - F11 文档搜索：每回合一次且结果三层收紧
  - F12 冷归档门槛：先写冷引用并校验，才移动原文
  - F13 持久层关系四型与 link 契约
  - F14 准入机制：后续权限只给本轮实际返回的证据
  - F15 related 遍历：起点须已准入、深度可钳制、每轮一次
  - F16 forget 三重门槛：能力、精确 id、以及自主 worker 白名单剔除
  - F17 工具面实测 16 个，另加动态注册的一次性结果工具
  - F18 子代理信封：硬白名单加 persona 加一次性结果工具
  - F19 闲时机制只有一条调度路径：idle review，其余维护由容量驱动
  - F20 idle review 的写入边界：create-only 文档、一次一层、热记忆只认亲口断言
  - F21 失败处置：不重试、三态记账、部分成功也须对账
  - F22 v0.5.5 → v0.5.26：阈值算法未动，机制从裸定时器升级为受控配额
  - F23 容量驱动的归档是写入路径的同步职责，与闲时评审互不触发
uncertain:
  - issue: 归档血缘 lineage 在 runtime 侧不落盘：协调器把它传入 Source 边界后被丢弃，memories.json 只存 JSON 与 Markdown；归档条目的溯源改由 memory-spaces 侧的 provenance 字段承载
    reason: source-runtime 插件内检索 lineage 零命中，而 memory-spaces 的 source.ts 存在 provenance 字段
  - issue: 每回合一次文档搜索与一次 related 遍历均只由 default-three-tier 策略兑现，Source 协议层只有 route 调用预算，换策略语义可变
    reason: 策略可插拔，约束落点随策略实现而变，非协议硬约束
  - issue: link 的 weight 下游语义不闭合：仓内定义为置信度并透传给外部 CLI，但其如何影响排序与遍历在本仓不可见
    reason: 外部 CLI 不在本仓，需另查
  - issue: forget 工具描述称当前为 Native 软删除，与 provider 数据（多数 provider 声明支持 forget、模式 soft 与 hard 混杂）口径不完全一致
    reason: 描述与数据存在口径差异，无测试或注释钉死
  - issue: idle review 的失败残留只落在 lastReviewFailure 与告警文本，无跨会话可见的待处置队列；残留的可见范围是否只限当前进程，未见证据
    reason: 本次只取证了错误记账路径，未见持久化残留的载体
  - issue: v0.5.26 新增的 Git 自动备份调度器本次只确认其存在与基本形态，未取证其失败处置、冲突处置与凭据处理
    reason: 该文件为本次版本落差中全新增的 152 行，超出闲时机制专项范围未展开
gaps:
  - blocked_scope: ""
    description: smart 召回的图增强内部构成属外部 mnemon CLI，本仓只到透传与跨 Provider 融合
    priority: medium
  - blocked_scope: ""
    description: 无何时显式切换 keyword 或 basic 档的模型侧指引（smart 已内置一次 keyword 恢复查询）
    priority: medium
  - blocked_scope: ""
    description: 冷归档不可逆且无恢复路径的用户可见语义未交代
    priority: medium
  - blocked_scope: ""
    description: 容量驱动的批量归档无回滚，多候选部分成功的原子性未文档化
    priority: low
  - blocked_scope: ""
    description: weight 与 reason 是否回流影响后续召回评分，无仓内证据
    priority: low
  - blocked_scope: ""
    description: "idle review 的 agentTeams: scoped 分支语义未取证（本次只确认了 pause 路径与开关存在）"
    priority: medium
  - blocked_scope: ""
    description: 活动评分阈值 5 与实质准入 320/600 字符的取值依据无注释或文档说明，不知是经验值还是实测得出——LDVH 若要对齐须知道这是否可调
    priority: medium
implications:
  - finding_ref: F1 三层记忆模型与统一存储根
    implication: 三分结构可直接作为 LDVH 记忆业务系统的分层骨架；凭证单独存放且只回字段名不回值，是可照搬的敏感配置边界
  - finding_ref: F2 Source 拥有数据、Strategy 纯确定性、View 只给有界上下文
    implication: 把谁能碰数据与谁决定给模型看什么彻底切开，可作为记忆系统内部职责划分的模板
  - finding_ref: F3 九种可替换数据面与能力诚实原则
    implication: 契约稳定、数据面可换、能力诚实声明、缺失即降级——规范应固化能力声明驱动工具面，而非假定后端全能
  - finding_ref: F4 自动放置的硬规则链：过滤在先、模型在后、Host 复核
    implication: AI 参与但不最终裁断的样板：硬规则机器执行、模型只在收敛候选中做软选择、选择留痕可审计
  - finding_ref: F5 热记忆容量与计量口径
    implication: 热记忆按字节预算而非条数管理，LDVH 若引入容量概念须明确计量口径并将上限做成可校验配置项
  - finding_ref: F6 USER.md 满走本地保守合并，用户画像绝不出本机
    implication: 用户画像属最高敏感级，连压缩都不外发；若 LDVH 引入类似画像层应把不外发写成机械约束
  - finding_ref: F7 MEMORY.md 满才写 Provider，且写的是原始条目原文
    implication: 热到持久只有一条容量触发的单向通道且写原文，保证持久层证据价值
  - finding_ref: F8 压缩的 CAS 与不破坏性回滚
    implication: 失败即不动、冲突不破坏，证明 CAS 模式在高频记忆压缩场景同样成立
  - finding_ref: F9 快照是自有 recall 消息，不是系统提示段
    implication: 区分稳定规则与易变数据：协议进系统提示、快照进消息流，避免缓存失效
  - finding_ref: F10 受管文档：index.json 为元数据真相源，单文档 2 MiB、active 总 10 MiB
    implication: 受管文档与 LDVH 事实对象高度同构，差别在元数据集中还是随对象，需在规范里明确选择理由
  - finding_ref: F11 文档搜索：每回合一次且结果三层收紧
    implication: 查询配额做成 turn 级状态、有界性做成多层硬约束；只读仍会写访问时间提醒我们审慎使用只读一词
  - finding_ref: F12 冷归档门槛：先写冷引用并校验，才移动原文
    implication: 先留可回指证据再动原件，与 LDVH 先留痕后变更可回退完全一致
  - finding_ref: F13 持久层关系四型与 link 契约
    implication: 对比 LDVH 三型关系 key，需先想清要表达语义关系还是派生意图，避免型别混淆
  - finding_ref: F14 准入机制：后续权限只给本轮实际返回的证据
    implication: 只能操作刚真正看到的东西，可作为 03 受控读写补充先回读后改规则的候选
  - finding_ref: F15 related 遍历：起点须已准入、深度可钳制、每轮一次
    implication: 约束落在策略层而非协议层会随实现而变，提示 LDVH 写约束时须写明落点层次
  - finding_ref: F16 forget 三重门槛：能力、精确 id、以及自主 worker 白名单剔除
    implication: 破坏性操作移出自动流程只留显式 Human 意图，是 Human 决定权在工具面的落地样板
  - finding_ref: F17 工具面实测 16 个，另加动态注册的一次性结果工具
    implication: 写类多于读类说明写是一等公民且配多重闸门，可与 LDVH 工具族对照检视规模与闸门
  - finding_ref: F18 子代理信封：硬白名单加 persona 加一次性结果工具
    implication: 把纪律铸进角色定义而非指望模型自觉，LDVH 调研与讨论子代理协议可直接借鉴此信封形状
  - finding_ref: F19 闲时机制只有一条调度路径：idle review，其余维护由容量驱动
    implication: 闲时应实现为回合结束事件加计时器双锚并二次确认已空闲；门禁宜为多道可配置 AND；LDVH 须显式区分宿主事件触发与容量触发
  - finding_ref: F20 idle review 的写入边界：create-only 文档、一次一层、热记忆只认亲口断言
    implication: mnemon 的「至多一次、一层一片、只认亲口」与 LDVH 32 §10.3 几乎逐条同构，是该纪律可执行的外部实证；可移植的一半是运行期强制守卫而非 prompt 劝阻
  - finding_ref: F21 失败处置：不重试、三态记账、部分成功也须对账
    implication: 「取消后若已发生提交仍须对账」精确对应 LDVH 00 §5.7 与 32 §10.1 的 fail-closed；「失败不重置配额」可直接借用；但 mnemon 无跨会话待处置队列，是其相对 LDVH 的缺口而非可吸收项
  - finding_ref: F22 v0.5.5 → v0.5.26：阈值算法未动，机制从裸定时器升级为受控配额
    implication: 20 余个版本的演进方向全为收紧而无放宽，为 LDVH 32 §10 的收紧取向提供外部方向性支持；破坏性工具不在白名单时多道意图门自然全满足，能力面约束可替代流程约束
  - finding_ref: F23 容量驱动的归档是写入路径的同步职责，与闲时评审互不触发
    implication: 容量维护不属闲时调度，LDVH 32 §10.4 须显式说明否则会被混读；「无候选即抛错」是 fail-closed 的一种形态
urls:
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/docs/en/reference/storage-model.md
    summary: 三层记忆模型、统一存储根与目录结构、Runtime 容量、Documents 热冷分层、分支作用域、仅 active 空间参与召回
    title: dsh-mnemon storage-model.md（三层记忆与存储根）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/docs/en/development/architecture.md
    summary: Source/Strategy/View 三分及各自不拥有的职责清单
    title: dsh-mnemon architecture.md（三层架构）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/docs/en/guides/memory-providers.md
    summary: 九 provider 能力矩阵、官方默认与 opt-in、配置字段、手动与自动放置、能力诚实原句
    title: dsh-mnemon memory-providers.md（Provider 矩阵与放置）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/plugins/dsh-mnemon-source-memory-spaces/src/provider-placement.ts
    summary: 硬规则过滤（白名单、数据边界、必需能力）、prompt 限长、能力判定与 appliedRules
    title: dsh-mnemon provider-placement.ts（自动放置硬规则）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/plugins/dsh-mnemon-source-memory-spaces/src/contracts.ts
    summary: EdgeType 四型常量、Memory Space 字段、capabilities 与 placement 类型定义
    title: dsh-mnemon memory-spaces contracts.ts（关系与能力类型）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/plugins/dsh-mnemon-source-memory-spaces/src/source.ts
    summary: admittedByView 准入表、link/forget 的前置校验与能力门槛
    title: dsh-mnemon memory-spaces source.ts（准入与能力闸门）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/plugins/dsh-mnemon-source-memory-spaces/src/service.ts
    summary: related 深度钳制 boundedInteger(depth,2,1,5)、link 与 forget 的服务层实现
    title: dsh-mnemon memory-spaces service.ts（遍历与关系服务）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/plugins/dsh-mnemon-source-runtime/src/defaults.ts
    summary: 热记忆容量常量：MEMORY.md 10 KiB、USER.md 4 KiB、上限 1 MiB
    title: dsh-mnemon runtime defaults.ts（热记忆容量）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/plugins/dsh-mnemon-source-runtime/src/controller.ts
    summary: compactAndMutate 的 CAS 与冲突语义、投影与持久化实现
    title: dsh-mnemon runtime controller.ts（压缩与 CAS）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/src/host/subagent.ts
    summary: 热记忆归档与压缩协调、USER_COMPACTION_PERSONA、工具白名单与 AUTONOMOUS_WRITE_TOOLS、冷引用与 lineage、各 worker persona 与信封
    title: dsh-mnemon host subagent.ts（协调器与 worker persona）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/src/host/tools.ts
    summary: 16 个 mnemon 工具注册与描述、forget/link/document 管理的能力与子代理限制、只读闸门
    title: dsh-mnemon host tools.ts（工具面与闸门）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/src/host/lifecycle.ts
    summary: memorySnapshotMessage：快照以自有 recall 消息注入而非系统提示段
    title: dsh-mnemon host lifecycle.ts（快照注入）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/src/host/guidance.ts
    summary: ROUTING_GUIDANCE 与协议 section 注册（order 150）
    title: dsh-mnemon host guidance.ts（路由与协议注入）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/plugins/dsh-mnemon-strategy-default-three-tier/src/retrieval.ts
    summary: 每回合一次文档搜索 claim、召回预算常量、relatedDigest 状态机与有界参数
    title: dsh-mnemon default-three-tier retrieval.ts（配额与预算）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/docs/en/reference/workflows.md
    summary: 热记忆归档与压缩流程、用户画像永不送入 Memory Spaces、冷引用检索梯度
    title: dsh-mnemon workflows.md（记忆工作流）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/src/host/lifecycle.ts
    summary: idle review 触发链、30 秒计时器与最小间隔重排、八道门禁、实质内容准入、取消三处、不重试与 partial 记账、错误脱敏
    title: dsh-mnemon v0.5.26 lifecycle.ts（idle review 触发与门禁）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/src/host/review-activity.ts
    summary: 活动打分公式与阈值 5；与 v0.5.5 逐字相同，构成 F22「阈值算法未动」的证据
    title: dsh-mnemon v0.5.26 review-activity.ts（活动评分）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/src/host/review-tools.ts
    summary: v0.5.26 全新增文件：一层一片策略、agentTeams 阻塞原因、startGuardedReview 运行期工具守卫与因果标记
    title: dsh-mnemon v0.5.26 review-tools.ts（运行期守卫）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/src/host/subagent.ts
    summary: REVIEW_TOOLS 白名单、reviewPersona 四条硬约束、fork/spawn provider 与降级、IdleReviewError 三态、Reconcile 不自动应用、归档容量循环、冷归档可逆回执校验
    title: dsh-mnemon v0.5.26 subagent.ts（评审 persona、错误三态与归档门槛）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/src/host/auto-backup.ts
    summary: v0.5.26 新增的 Host 级 Git 自动备份计时器，本次只确认存在与基本形态
    title: dsh-mnemon v0.5.26 auto-backup.ts（Git 自动备份调度器）
  - ref: https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/tests/lifecycle.spec.ts
    summary: 失败运行仍受次数上限约束、中止评审须在新回合前结算两项断言，是 F21 与 F22 的测试级证据
    title: dsh-mnemon v0.5.26 tests/lifecycle.spec.ts（配额与中止结算断言）
object_uid: fa0cff9c-a8b9-4d65-983c-26ad991a6c10
fact_type_key: research
created_at: 2026-09-08T20:26:00.523Z
change_log:
  - at: 2026-09-08T20:26:00.523Z
    provider: workbuddy
    model: hy4-preview
    summary: 受控创建 Research 对象（v5 调研计划 R3：dsh-mnemon 0.5.5 可组合记忆控制平面；四路子代理取证+主控核验，刷新 v4 时期基于 v0.4.4 的旧调研）
  - at: 2026-10-09T18:03:22.332Z
    provider: workbuddy
    model: space-bunny
    summary: 增补闲时机制专项（F19–F23，基线升级至 v0.5.26）：初版仅两句附注，现展开为 idle review 的触发门禁、写入边界、失败三态记账、版本演进与容量维护分工五条正式发现；同时修正初版把「本地压缩/空闲评审」并列为闲时机制的误读，并复核 F12/F16 在新版本仍成立。
---

## 研究问题

dsh-mnemon（0.5.5）的可组合记忆控制平面由哪些机制构成——记忆空间与 Provider 体系、运行时记忆协议与压缩、文档检索、持久图关系与工具面——各自解决什么问题、边界在哪

本调研为 LDVH 记忆业务系统规范（四大业务系统中唯一尚无专门规范的一支）提供外部依据，也是对 v4 时期基于 dsh-mnemon v0.4.4 的旧调研的刷新——本次取证基线 0.5.5（提交 0d5f5fa），已比旧调研前进一个版本。

**2026-11 增补说明**：F19 至 F23 为第二次取证增补，基线升级至 v0.5.26（提交 7bd9659，2026-10-09），专门覆盖初版几乎未展开的闲时机制。F1–F18 的结论仍以 0d5f5fa 为准，其中 F12、F16 经 v0.5.26 复核仍成立（见 F22 溯源）。

## 输入与边界

方法：四路只读调研子代理分面取证（记忆空间与 Provider / 运行时记忆 / 文档检索 / 图关系与工具面）+ 主控第一手核验（25 处 file:line 抽验）。主控核验修正两处任务错误：工具面实测 16 个而非任务假设的约 12 个；runtime 实现分散在 source-runtime 插件与 host 多处而非单一 src/runtime-memory.ts。证据形式：逐字摘录 + GitHub blob URL（ref 0d5f5fa）+ 文件行号锚点。观察时点 2026-09-10。

增补方法：针对闲时机制的单路只读调研 + git 历史比对（v0.5.5 与 v0.5.26 的 review-activity.ts 逐字 diff、相关目录变更史、issue 编号引用），观察时点 2026-11。

不覆盖：外部 mnemon CLI 内部实现（smart 图增强构成与 weight 落点）、R7 业界 AI 长期记忆实践对照（独立方向）。

## 关键发现

### F1 三层记忆模型与统一存储根

记忆分三层并各占一个目录：Runtime（热记忆，memories.json 为唯一事实源并投影出 USER.md 与 MEMORY.md）、Documents（受管 Markdown 加 index.json）、Memory Spaces（持久层，data 目录下每个空间一个库）。storageScope 决定整根位置（global 跨工作区共享 / workspace 项目隔离 / custom 指定路径），`runtimeUserScope=global` 是唯一的分根例外——USER.md 从全局根读、其余留在所选根。第三方 Provider 连接控制面单独放在 state/memory-providers.json，模式 0600 并被排除出 Mnemon Packs，Host 只返回已配置字段名、从未返回已保存的凭证值。

**对 LDVH 的价值**：三分结构（热记忆 / 受管文档 / 持久空间）与 LDVH 的运行时记忆、事实源、持久知识三层天然对位，可直接作为记忆业务系统的分层骨架参照；凭证与内容分文件存放且只回字段名不回值，也是 LDVH 处理敏感配置可照搬的边界。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/docs/en/reference/storage-model.md（40-60 统一根目录、75 单根真相源、86 分支作用域、168 仅 active 空间参与召回）

### F2 Source 拥有数据、Strategy 纯确定性、View 只给有界上下文

架构由三个域概念组成：Source 拥有记忆及操作（存储与远程权限、事实、投影、授权、查询与变更）；Strategy 是纯确定性函数（请求加事实加自有槽位贡献产出 ViewSpec），不拥有原始数据、凭证、驱动与副作用；View 为模型提供有界上下文与交互形状，不持有私有授权与原始句柄。Memory Spaces Source 拥有自己的子 Fiber 与 Provider 协议。

**对 LDVH 的价值**：这条分层把「谁能碰数据」与「谁决定给模型看什么」彻底切开——与 LDVH 03 事实模型（数据层）与 05 Helper（确定性执行层）的分离同构，可作为记忆系统内部职责划分的模板。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/docs/en/development/architecture.md（Source/Strategy/View 三分与不拥有的清单）

### F3 九种可替换数据面与能力诚实原则

同一 Memory Space 契约下挂了 9 个 provider 包（mnemon-native、openviking、mem0、hindsight、holographic、retaindb、honcho、byterover、supermemory），每个都是 Memory Spaces Source 的显式安装子模块；官方原生（Mnemon Native，本地 mnemon.db 经官方 CLI）为优先默认，其余为 opt-in，九包默认全装但外部服务未配置即禁用、不捆绑任何外部后端。能力矩阵逐项声明（search/browse/graph/entities/related/remember/link/forget 加 writeMode 与 deletionMode），只有 Mnemon Native 给出完整类型化图与软删除。文档原文：Host 只暴露适配器能兑现的能力，UI 动作与 Agent 工具不虚构缺失的图、related、link、browse 或删除行为。

**对 LDVH 的价值**：这是本次调研最有迁移价值的一条——「契约稳定、数据面可换、能力诚实声明、缺失即降级且不假装」。LDVH 的记忆与 Helper 若绑定某个具体实现，就会失去这层弹性；规范层面应固化「能力声明驱动工具面」而非「假定后端全能」。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/docs/en/guides/memory-providers.md（1-25 官方默认与九包矩阵、能力诚实原句）

### F4 自动放置的硬规则链：过滤在先、模型在后、Host 复核

新建空间时若用 automatic 模式，Host 先执行硬规则三级过滤（白名单 allowedProviderIds、数据边界 local-only 先排除所有远端、必需能力 requiredCapabilities），若只剩一个候选则由规则直接决定（decidedBy 记为 rules），多个候选才交给独立任务 Agent——且模型只能看到过滤后的合格候选、只影响软偏好判断，不能覆盖硬规则；Prompt 本身也被限长（超 4000 字符抛错），Host 随后校验返回值是否在合格集合内。决策本身被记录为结构化 placement（providerId、decidedBy、reason、confidence、candidateProviderIds、appliedRules）。

**对 LDVH 的价值**：这是一个「AI 参与但不最终裁断」的样板——硬规则由机器执行、模型只在收敛后的候选里做软选择、选择结果留痕可审计。与 LDVH 00 §4（Human 决定权）与 §7（防自欺）的方向一致，值得在 Helper 与编排设计里复制。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/plugins/dsh-mnemon-source-memory-spaces/src/provider-placement.ts（47-64 硬规则过滤与 appliedRules、24-26 能力判定、31 prompt 限长）

### F5 热记忆容量与计量口径

MEMORY.md 默认 10240 字节（10 KiB）、USER.md 默认 4096 字节（4 KiB），上限各 1048576（1 MiB），单条上限 8192 字节；容量按投影正文的 UTF-8 字节计（含 § 分隔符）。配置值须为 1 到 1048576 的整数，超限即配置校验失败。

**对 LDVH 的价值**：热记忆是「按字节预算而非按条数」管理的——LDVH 运行时记忆若引入容量概念，应明确计量口径（字节而非条数）并把上限做成可校验的配置项，避免压缩行为不可预测。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/plugins/dsh-mnemon-source-runtime/src/defaults.ts（1-3 常量）；https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/src/host/config-values.ts（4-6 上限）

### F6 USER.md 满走本地保守合并，用户画像绝不出本机

USER.md 容量溢出时，Host 启动一个无工具权限的本地压缩 worker，persona 原文要求「never send user preferences to Mnemon Memory Spaces」，且必须保留每一条持久身份事实、偏好、纠正、习惯与协作要求，合并时取来源中最高的 importance，待写入的未提交变更不得出现在压缩输出里；Host 侧逐一校验 sourceIndexes 全覆盖、importance 不降级、候选在预算内，随后在 revision 栅栏下合并。文档另有一句硬承诺：用户画像永不送入 Memory Spaces。

**对 LDVH 的价值**：用户画像（USER.md 对应 LDVH 的 USER.md -hot memory）属于最高敏感级，这条设计把它锁在本机、连压缩都不外发——LDVH 若引入类似的画像层，应把「不外发」写成机械约束而非约定。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/src/host/subagent.ts（581 USER_COMPACTION_PERSONA、1307-1357 compactUserAndCommit）；https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/docs/en/reference/workflows.md（171 用户画像永不送入）

### F7 MEMORY.md 满才写 Provider，且写的是原始条目原文

与 USER.md 不同，MEMORY.md 溢出需要存在活动可写的 Memory Space，否则硬错误；Host 以 remember-many 把原始条目原文写入 Provider（importance 映射 critical 到 5、normal 到 3、low 到 1），单空间时免模型直写、多空间时 worker 只见有界摘录只做路由、模型失败则确定性回退默认空间；写回完成后才在 revision 栅栏下做本地压缩。普通 add/replace/remove 与整个 USER.md 路径永不写 Provider。

**对 LDVH 的价值**：热记忆与持久记忆之间只有一条单向的、由容量触发的通道，且写的是原文而非摘要——这保证了持久层的证据价值。LDVH 事实源若从运行时记忆吸收内容，也应保留原文而非压缩后的指针。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/src/host/subagent.ts（1171-1304 runtimeLocked 归档与压缩、1269 importance 映射）

### F8 压缩的 CAS 与不破坏性回滚

compactAndMutate 先比对 revision，不符即抛冲突错误且不改动任何本地文件；若合并后仍超限则抛容量错误。跨进程迟发冲突的场景下，本地不动、已落 Provider 的副本作为安全重复保留，不做破坏性回滚。压缩保留的是幸存条目全文（按 importance 优先级确定性装箱进字节预算），不是指针。

**对 LDVH 的价值**：「失败即不动、冲突不破坏」是受控写入应有的姿态——LDVH 03 受控读写与 06 提交契约已在用 CAS，这条证明了该模式在记忆压缩这种高频场景也成立。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/plugins/dsh-mnemon-source-runtime/src/controller.ts（96-102 与 526-601 CAS 与冲突语义）

### F9 快照是自有 recall 消息，不是系统提示段

运行时记忆协议文本作为系统提示 section（mnemon:strategy）注入，但记忆快照本体（含 Revision、字节用量与 USER.md/MEMORY.md 全文）并不在系统提示内——它是 dsh-mnemon 自有的一条用户消息（source.plugin=dsh-mnemon、form=recall），在每步之前、文本发生变化时追加到该插件块底部。实现注释说明这是从 systemPrompt.context 改为自有消息的结果。

**对 LDVH 的价值**：区分「协议（长期稳定的规则，进系统提示）」与「快照（每步变化的数据，进消息流）」——这个切法避免了把易变内容塞进提示词导致的缓存失效，也提示 LDVH 在注入上下文时应区分稳定规则与动态数据。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/src/host/lifecycle.ts（362-370 memorySnapshotMessage、396-398、413 preStep）；https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/src/host/guidance.ts（24-31 协议 section 注册）

### F10 受管文档：index.json 为元数据真相源，单文档 2 MiB、active 总 10 MiB

文档以工作区 .mnemon/documents 下的受管 Markdown 加 index.json 承载，index.json 管理 ID、标题、描述、状态、文件名、源路径、会话、时间戳、revision、SHA-256、大小与 Memory Space 引用；受管 Markdown 副本带生成 frontmatter。容量为单文档 2 MiB、active 总量 10 MiB（含生成 frontmatter），归档内容不计入 active 限额，且归档不可变——要改只能新建 active revision。

**对 LDVH 的价值**：受管文档与 LDVH 事实对象高度同构（都有 frontmatter 元数据加正文、都有 revision 与 contentHash、都要求不可变或受控更新）。差别在于它把元数据集中在单一 index.json 而 LDVH 把元数据放在每个对象的 frontmatter——两种做法各有取舍，值得在规范里明确选择理由。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/docs/en/reference/storage-model.md（121 与 48-51 元数据真相源、141-145 容量、147 归档不可变）

### F11 文档搜索：每回合一次且结果三层收紧

default-three-tier 策略用一个 turn 级状态位实现「每回合一次文档搜索」——第二次调用直接返回 notRun 且不再查盘，测试断言底层查询只执行一次。结果有界性由三层叠加：策略层 4 条与 6000 字符、source 层每文档 2600 字符、测试断言整体 JSON 小于 8000 字节且不泄露 contentHash、generatedAt、indexPath、directory 等内部字段。另需注意：功能只读不等于磁盘只读——命中会更新 lastAccessedAt 用于 LRU 排序。

**对 LDVH 的价值**：把「查询配额」做成 turn 级状态而非 AI 自觉，与把「结果有界」做成多层硬约束——这两条正好对应 LDVH 反过度设计和有界证据交付的要求；「只读仍会写访问时间」这一细节则提醒我们审慎使用「只读」这个词。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/plugins/dsh-mnemon-strategy-default-three-tier/src/retrieval.ts（207-213 claim、212-213 有界参数）；https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/tests/plugin.spec.ts（356-394 有界与单次断言）

### F12 冷归档门槛：先写冷引用并校验，才移动原文

归档不是简单移动文件：需同时具备 documents.archive 与 memory-spaces.write 双能力，且子代理直接调用被拒（原文 idle document workers cannot cold-archive directly）。流程上先经隔离子代理在 Mnemon 侧写入冷引用（必须包含冷的准确路径与 contentHash），Host 校验 lineage 指向的目标确实包含该路径与摘要后，才在 revision 未变的前提下移动原文；容量驱动的自动归档可循环批量，但单文档显式归档为一次一个。

**对 LDVH 的价值**：这是「先留可回指的证据、再动原件」的范例——与 LDVH 06 事实源与 Git Gate 的「先留痕、后变更、可回退」完全一致，可作为对象归档流程的参照实现。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/src/host/tools.ts（252-267 能力与子代理限制）；https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/src/host/subagent.ts（1123-1156 与 583-587 冷引用与 lineage）

### F13 持久层关系四型与 link 契约

insight 之间可建 typed 双向关系，四型为 temporal、semantic、causal、entity；link 的 weight 表示关系置信度，取值 0 到 1、默认 0.5、越界抛错，reason 经 --meta 透传给 Native。关系只在同一 Memory Space 内建立。

**对 LDVH 的价值**：LDVH 24 号 Research 的关系 key 目前是 inspired-by / informs / updates 三型——对比之下 mnemon 的四型更偏「关系语义」而非「引用意图」。若 LDVH 事实对象未来要支持图关系，需要先想清楚我们要表达的是语义关系还是派生意图，避免型别混淆。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/plugins/dsh-mnemon-source-memory-spaces/src/contracts.ts（253-254 EdgeType）；https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/src/host/tools.ts（336-348 link 与 weight）

### F14 准入机制：后续权限只给本轮实际返回的证据

link、related、forget 三类后续操作共享一个准入约束——操作的 id 必须是本轮 View 实际召回并被预算裁剪后保留下来的证据（admittedByView），且两端同属一个空间，否则直接抛错。设计注释把这条写得很直白：后续权限仅限于 View 预算下实际返回的证据。这防止了模型凭记忆里的 id 猜测去写入或删除未经验证的对象。

**对 LDVH 的价值**：这是防自欺的一条具体机制——「你只能操作你刚刚真正看到的东西」。LDVH 的受控写对象（如 Research 更新）若也要求「先回读再改」，与此同源；可作为 03 受控读写补充一条「操作须基于本轮已准入证据」的候选规则。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/plugins/dsh-mnemon-source-memory-spaces/src/source.ts（357-384 准入表与注释）；https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/src/host/tools.ts（336-337 描述）

### F15 related 遍历：起点须已准入、深度可钳制、每轮一次

related 的起点必须是本轮 recall 已准入的 insight，否则不发起 Provider 查询并直接提示；depth 默认 2、被钳制在 1 到 5；要求 capabilities.related=true，OpenViking 被明确点名不支持。所谓「每轮至多一次遍历」由 default-three-tier 策略的状态机兑现（第二次请求重放上次结果而不查 Provider），不是 Source 协议层的硬上限。

**对 LDVH 的价值**：又一次看到「约束落在策略层而非协议层」——提示我们在 LDVH 规范里写约束时，必须写明它落在哪一层可执行，否则会像这里一样出现「换一个策略就可能失效」的软约束。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/plugins/dsh-mnemon-source-memory-spaces/src/service.ts（989-996 起点与 boundedInteger(depth,2,1,5)）；https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/plugins/dsh-mnemon-strategy-default-three-tier/src/retrieval.ts（21-25 与 347-406 relatedDigest）

### F16 forget 三重门槛：能力、精确 id、以及自主 worker 白名单剔除

删除 insight 需同时满足：Provider 报告 capabilities.forget=true（否则硬拒，Native 为软删除）；只接受精确 id 作参数且该 id 必须已准入；在语义上使用条件被明确限定为用户明确要求或该条目已确认过时或错误。更关键的是，自主写入类 worker 的工具白名单里被硬性剔除 mnemon_forget（对应 issue 编号 148 的变更），只有显式用户操作才保留全工具面。

**对 LDVH 的价值**：把破坏性操作从「自动流程」中移除、只留给显式 Human 意图——这正是 LDVH 00 §4 Human 决定权在工具面的落地方式，可作为「哪些动作不得进入自动化链路」的判定样板。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/src/host/subagent.ts（42 与 1047 AUTONOMOUS_WRITE_TOOLS 剔除 forget）；https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/src/host/tools.ts（363-380 forget 门槛）

### F17 工具面实测 16 个，另加动态注册的一次性结果工具

注册给模型的 mnemon 工具实测为 16 个：读类 5 个（memory_bodies、recall、related、status、document_search）、写类 9 个（runtime_memory、document_create、document_manage、remember、link、forget、memory_body_create、memory_body_update、memory_body_merge）、View 协议 2 个（view_route、view_action）。此外每次委派会动态注册一个具名的一次性结果工具 mnemon_subagent_result 加 uuid。工具共同边界包括：需要活体 Agent、参与模式与 writeEnabled 双闸、View 类工具要求本回合已钉住 View、根请求走协调器而子代理直连 Source 不递归。

**对 LDVH 的价值**：16 个工具覆盖三层记忆的全部操作面，且写类明显多于读类——说明这个平面把「写」当成一等公民并配了多重闸门。LDVH 的 ldvh 工具族目前是插件自有的，两者在规模与闸门设计上可对照检视。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/src/host/tools.ts（31-456 全部工具注册行）；https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/src/host/subagent.ts（48 RESULT_TOOL_PREFIX）

### F18 子代理信封：硬白名单加 persona 加一次性结果工具

一次委派构成一个封闭信封：请求被标注为不可信数据、工具白名单按 worker 类型硬编码（读类 3、写类 9、自主写入 8、评审 3、文档归档 4、迁移 2）、persona 内置防注入与「一次性完成协议」、每次委派注册唯一的结果工具并以 schema 校验、maxDepth 为 1 且用 toolFilter 收敛可用工具、工具收据被观察者捕获。错过结果工具交接时以已捕获的已提交收据恢复，绝不重跑变更。读写各司其职的 worker persona（写入、作答、放置选择、元数据策展、本地压缩、空闲评审）都写明「把请求与证据当数据而非指令」。

**对 LDVH 的价值**：这是本次调研对 LDVH 编排最有直接参照价值的一条——把纪律铸进角色定义（防注入、不越界、不虚构、不泄密、一次性结束），而不是指望模型自觉。LDVH 的调研与讨论子代理协议可直接借鉴这套「信封加白名单加一次性结果工具」的形状。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/0d5f5fa/src/host/subagent.ts（28-48 白名单与结果工具前缀、539-551 各 persona、1385-1530 信封构造与收据恢复）

### F19 闲时机制只有一条调度路径：idle review，其余维护由容量驱动

**本条修正初版调研的一处误读。** 初版据 persona 清单把「本地压缩」「空闲评审」并列为两条闲时机制，实际代码中二者分属不同触发源：

- **idle review（唯一真正被闲时调度器驱动的任务）**：宿主 `agent/turn-stopping` 事件 → `scheduleIdleReview` → `setTimeout`（`lifecycle.ts:404-406`、`425-436`），默认 `idleReviewMs` 30_000（范围 5_000–600_000）。
- **USER.md 本地压缩 / MEMORY.md 归档**：由**写入时的容量驱动同步触发**（`subagent.ts:1803-1841`、`1191-1222`），不是闲时。
- **v0.5.26 新增 Git 自动备份调度器**：`MnemonAutoBackupScheduler`（`auto-backup.ts:25`），Host 级单计时器重复执行与按钮相同的 push，间隔每 tick 从设置重读。这是本次版本落差中真正新增的定时机制。

**另一处澄清**：F12 引用的 `idle document workers cannot cold-archive directly`（`tools.ts:257`）中，「idle document workers」实为任意子代理（判定条件是 `isSubagent(agent)`），并不存在专门的 idle worker 类。原文措辞具误导性，但结论（子代理不得直接冷归档）不受影响。

idle review 需同时满足八道门禁（全部 AND）：lifecycle 与 writeEnabled 与 `writebackMode==='guided'`、`idleReview.enabled`、本会话次数未超 `maxPerSession`（默认 20）、Agent Teams 未阻塞、策略为 `default-three-tier`、**该轮确由 default-three-tier 实际组合**（fallback 策略服务的轮次不评审）、活动分数 ≥5、实质内容准入。评分为用户文本 50 字/分（上限 3）+ 轮次数 + 工具调用 5 次/分（上限 2）+ 工具多样性 ≥3 另计（上限 2），阈值 5（`review-activity.ts:7-16`）。实质准入为显式候选句式（「记住/remember/save...memory」等）、用户文本累计 ≥320 字符、助手文本 ≥600 字符、或存在非 `mnemon_` 前缀的已完成工具调用；任一轮命中否定句式则整轮排除（`lifecycle.ts:122-135`、`527-552`）。新回合开始必取消待办与运行中的评审（`pre-step`、system-prompt assemble、dispose 三处）。

**对 LDVH 的价值**：三点可直接对照。其一，「闲时」被实现为**回合结束事件 + 计时器双锚**，且回调内二次校验 agent 确已 idle——与 LDVH 32 §10.2 的「会话检查点事件」形态一致，且多了一道「确已空闲」的确认。其二，门禁是**多道 AND 且全部可配置**，比 LDVH 32 §10.2 的「按预算轮换」更具体。其三，一个反面教训：mnemon 把三种不同触发源的维护放在同一 worker 家族下，容易被读成一条统一机制；LDVH 在写 §10 时须显式区分「宿主事件触发」与「容量触发」。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/src/host/lifecycle.ts（404-406 触发、425-436 计时器、445-458 门禁、527-552 实质准入）；https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/src/host/review-activity.ts（7-16 评分）；https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/src/host/auto-backup.ts（1-25 Git 备份调度器）

### F20 idle review 的写入边界：create-only 文档、一次一层、热记忆只认亲口断言

调度形态为子代理（`maxDepth: 1`、`toolFilter` 收敛、带专属 persona 与一次性终结工具），provider 可选 `fork`（继承父上下文）或 `spawn`（默认，非继承）；fork 不可用且 `fallback==='skip'` 则跳过，否则降级 spawn（`subagent.ts:1346-1360`、`2086-2100`）。

写入边界由四重构成：

1. **工具白名单**：`REVIEW_TOOLS = ['mnemon_document_search', 'mnemon_runtime_memory', 'mnemon_document_create']`（`subagent.ts:76`）——**没有 archive、没有 update、没有 forget**。`runtimeMemory: false` 时是移除工具本体而非口头劝阻（`subagent.ts:1361`）。
2. **create-only**：文档只能建不能改，且 persona 明确「先 search 查重，最多建一个」。
3. **一次一层**（issue #319）：一次评审只能写 Documents 或热记忆其中一层，第一层声明后另一层被拒（`review-tools.ts:41-52`）。
4. **只认亲口断言**：热记忆只接受用户亲口、明确、持久的断言，项目记录一律不入；每次至多一次热记忆增改删。

另有 persona 硬禁令：`Never move a document to cold archive in this pass.`（`subagent.ts:644`）——**闲时评审明确不参与冷归档**。

**运行期执行守卫**（v0.5.26 新增 `review-tools.ts:61-130`）：在 `agent/created` 时用 AsyncLocalStorage 因果标记加 `agents.isOwnedBy` 校验，对子代理调 `ctx.tools.guard(...)`，白名单外调用直接拒绝（`review-tools.ts:83-85`）；`run_code` 放行但仍过 policy。

**审批形态**：idle review **直接写、无审批流**，Human 介入点在独立的 `Reconcile` 角色，其注释写明「The proposal is never applied here, because the point of the feature is that a human reads it first」。

**对 LDVH 的价值**：这是本次增补对 LDVH 最有参照价值的一条。它与 LDVH 32 §10.3「每次至多一条变更提议、只认真人明确断言」**几乎逐条同构**——mnemon 的「至多一次」「一层一片」「只认亲口」正是 LDVH 已写入规范的纪律的工程实现，可作为 LDVH 判断该纪律是否真的可执行的实证。同时它的守卫机制（白名单外调用在运行期被拒，而非只在 prompt 里劝阻）提示 LDVH：闲置代理的工具约束应落在**运行期强制**而非仅 persona 文本。注意方向差异：mnemon 的闲时评审**直接落盘**，LDVH 32 §10.3 要求**只提议、由 Human 拍板**——LDVH 更严，但 mnemon 的运行期守卫是可移植的那一半。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/src/host/subagent.ts（76 白名单、638-644 persona 四条、1346-1363 provider 与工具过滤、2003-2015 信封）；https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/src/host/review-tools.ts（41-52 一层策略、61-130 运行期守卫）；https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/src/host/subagent.ts（1230-1234 Reconcile 不自动应用）

### F21 失败处置：不重试、三态记账、部分成功也须对账

idle review 的失败语义经 v0.5.26 建模为三态（`IdleReviewError`，`subagent.ts:135-140`）：`partial` 与 `failed`，按是否捕获到**已提交的工具回执**判定（`subagent.ts:2041-2047`）。关键纪律有四条：

- **绝不重试**：注释原文 "Never retry a failed child here, even when a different provider is available."（`lifecycle.ts:480-481`），失败的运行永不重放（`protocol.ts:217`）。
- **取消优先**：新回合、新 prompt、dispose 三处必 `cancelIdleReview(true)` → `reviewController.abort()`；测试断言「在新回合钉住同一 Agent runtime 之前先让被中止的评审结算」（`tests/lifecycle.spec.ts:1001`）。
- **部分成功也要记账**：即使已 abort，`partial` 仍进 `fail()`（`lifecycle.ts:483`），理由是 "Cancellation after a commit still needs reconciliation"——**提交之后再取消，仍需对账**。清理失败也被包装成 `IdleReviewError`（`subagent.ts:2066-2072`）。
- **失败不重置配额**：测试断言跨长会话（含失败运行）仍受次数上限约束（`tests/lifecycle.spec.ts:647`，对应 issue 100/255）。

错误信息脱敏并截断至 500 字符（`lifecycle.ts:580-582`），告警保留到下次成功才清除。CAS 保护散布在下游：文档归档有 revision 与 contentHash 冲突检查（`subagent.ts:1462-1465`）、Runtime 提交携带 `plan.revision`（`subagent.ts:1205`）、归档索引写后失败会清理自建索引并用 `AbortSignal.timeout(30_000)`（`subagent.ts:1517-1520`）。

**对 LDVH 的价值**：**「取消后若已发生提交，仍须对账」是本次增补最有价值的一条**，它精确对应 LDVH 00 §5.7 与 32 §10.1 的 fail-closed「保留已发生副作用并如实登记、不把部分写入当完成」。mnemon 把它写成了代码注释与测试名，可作为 LDVH 该条款的外部实证。另一条可直接借用：**失败不重置配额**——否则反复失败的任务会无限占用预算。另需注意 mnemon 的「绝不重试」与 LDVH 的「不自行重试」一致，但 mnemon **没有**待处置队列——失败的残留只落在 `lastReviewFailure` 与告警文本里，这是它相对 LDVH 规范（32 §10.1 要求进入跨会话可见的待处置队列）的**缺口**，不是可吸收项。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/src/host/subagent.ts（135-140 错误三态、2041-2047 回执判定、2066-2072 清理失败）；https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/src/host/lifecycle.ts（480-483 不重试与 partial 记账、492-496 取消、580-582 脱敏）；https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/tests/lifecycle.spec.ts（647 配额跨失败、1001 中止结算）

### F22 v0.5.5 → v0.5.26：阈值算法未动，机制从裸定时器升级为受控配额

git 比对结论：**评分与准入门完全未变**——`review-activity.ts` 两版本逐字相同，320/600 字符实质准入与 `reviewAdmitted` 结构亦同（无相关 hunk）。实质变化全部集中在**收紧与限额**：

1. 新增 `idleReview` 配置命名空间（v0.5.5 只有单个 `idleReviewMs`）：`enabled / runtimeMemory / provider / fallback / agentTeams / minIntervalMs / maxPerSession / maxContextChars / maxTokens`（`config.ts:119-128`）。
2. 新增每会话次数上限 `idleReviewAttempts < maxPerSession`（`lifecycle.ts:455`）——v0.5.5 无此门。
3. 最小间隔：v0.5.5 是裸 `setTimeout(..., idleReviewMs)`，现为 `Math.max(idleReviewMs, 上次尝试 + minIntervalMs - now)`，并在回调内二次校验与冷却重排（`lifecycle.ts:428-436`）。
4. 门禁抽取为 `idleReviewAllowed()` 加 `composedByDefault()`，新增「必须由 default-three-tier **实际组合**」一条（`lifecycle.ts:445-451`）。
5. 新增 Agent Teams 兼容开关 `agentTeams: pause|scoped`（`review-tools.ts:18-21`）。
6. 新增 `src/host/review-tools.ts` 整个文件（diff 131 行全新增），含一层策略与运行期守卫。
7. 一层一片（issue #319，commit `3eb6eb7d`）。
8. 部分成功建模（v0.5.5 只有 `if (!aborted) this.fail(error)`）。
9. 新增无 Memory Space 时的本地冷归档降级路径（issue #336，commits `a419666a`/`96a3364e`/`714e9f4f`）。
10. 新增 Git 自动备份调度器与 git-sync / github-auth。

**F12 复核（冷归档门槛）——仍成立**：`archiveDocumentLocked`（`subagent.ts:1417-1520`）流程未变——先经 `remember-many` 写入含冷路径与 SHA-256 的冷引用并要求恰好 1 条合格回执（`skipped` 须由精确内容证据补证，否则抛 `document archive received no reversible committed index receipt`），移动前复查 revision、contentHash 与目标 space 资格，归档写 lineage，写后失败回滚自建索引。`tools.ts:257` 的子代理禁令仍在。**补充**：`archiveDocumentLocally` 是无 Memory Space 时的例外降级，此时不走「先写引用」，但仅在「整个目录都没有可索引 space」且二次确认后才允许（`archivableElsewhere`）。

**F16 复核（forget 三重门槛）——仍成立且与旧版一致**：三重为 provider 能力门（`tools.ts:364`、`373`）、意图门（自主蒸馏与受监督回写的工具集剔除 `mnemon_forget`，`subagent.ts:73`，issue #148）、工具描述层门。**idle review 的工具集里根本没有 forget，故闲时路径天然满足全部三重**——这是 F20 的白名单设计带来的一个附加性质。

**对 LDVH 的价值**：版本史本身是一条证据——同一机制在 20 多个 minor 版本里的演进方向是**从宽松到受限**（补配额、补冷却、补运行期守卫、补部分成功建模），没有一个方向是「放宽自动化」。这为 LDVH 32 §10 的收紧取向提供了外部方向性支持。同时 F16 复核给出一条设计性质值得 LDVH 注意：**当破坏性工具不在白名单内时，多道意图门会自然全部满足**——能力面约束可以替代流程约束，且更廉价。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/src/host/subagent.ts（1417-1520 冷归档、1478-1510 冷引用与回执、73 forget 剔除）；https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/src/host/review-activity.ts（与 v0.5.5 逐字相同，佐证阈值未动）；https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/tests/lifecycle.spec.ts（配额与中止结算断言）

### F23 容量驱动的归档是写入路径的同步职责，与闲时评审互不触发

文档容量溢出时读 `capacity-plan`，`!plan.fits` 则取未归档过的候选调 `archiveDocumentLocked`，**循环直到 fit**；无候选则抛 `Document capacity exceeded with no archive candidate`（`subagent.ts:1378-1390`）。这就是初版调研所记「可循环批量」的准确含义。撞上并发写者报 `document-capacity` 时**重试一次**同样的先归档后淘汰路径（`subagent.ts:1396-1403`）——这是全仓少见的「有重试」例外。MEMORY.md 的容量归档则在同一次 commit 内完成「压缩 + 落选条目追加到本地归档 + 待写变更」，且 archive 先于 store 提交（`controller.ts:595-597`）；旧版 Source 无 `localArchive` 能力时**拒绝并提示**（`subagent.ts:1198-1199`）。

与 idle review 的衔接是**互斥**的：idle review 明确禁止冷归档（`subagent.ts:644`），且其 create-only 工具在容量不足时只能返回 skipped（`subagent.ts:638`）。即闲时评审不触发容量归档，容量归档由写入路径单独负责。

**对 LDVH 的价值**：LDVH 32 §10.4「容量维护代理」被写在「空闲维护与反思」章内，容易被读成由空闲调度驱动。mnemon 的分工显示这是两条独立路径——**容量维护属写入路径的同步职责，不属闲时**。LDVH 若要保持现状，须在规范里显式说明这一点，否则会像初版调研那样把两者混为一谈。另注意「无候选即抛错」而非静默跳过：容量溢出会显式失败，这是 fail-closed 的一种形态。

溯源：https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/src/host/subagent.ts（1378-1390 归档循环、1396-1403 并发重试、638 与 644 评审不触发归档、1198-1199 能力缺失即拒）；https://github.com/omdsh-dev/dsh-mnemon/blob/7bd9659/plugins/dsh-mnemon-source-runtime/src/controller.ts（548-601 压缩与归档同 commit）

## 未证实与缺口

未证实：
- 归档血缘 lineage 在 runtime 侧不落盘：协调器把它传入 Source 边界后被丢弃，memories.json 只存 JSON 与 Markdown；归档条目的溯源改由 memory-spaces 侧的 provenance 字段承载。
- 每回合一次文档搜索与一次 related 遍历，均只由 default-three-tier 策略兑现；Source 协议层只有 route 调用预算，换策略语义可变。
- link 的 weight 下游语义不闭合：仓内定义为置信度并透传给外部 CLI，但其如何影响排序与遍历在本仓不可见。
- forget 工具描述称当前为 Native 软删除，与 provider 数据（多数 provider 声明支持 forget、模式 soft 与 hard 混杂）口径不完全一致。
- （增补）idle review 的失败残留只落在 `lastReviewFailure` 与告警文本，无跨会话可见的待处置队列；残留的可见范围是否只限当前进程，未见证据。
- （增补）v0.5.26 新增的 Git 自动备份调度器本次只确认其存在与基本形态，未取证其失败处置、冲突处置与凭据处理。

缺口：
- （medium）smart 召回的图增强内部构成属外部 mnemon CLI，本仓只到透传与跨 Provider 融合。
- （medium）无何时显式切换 keyword 或 basic 档的模型侧指引（smart 已内置一次 keyword 恢复查询）。
- （medium）冷归档不可逆且无恢复路径的用户可见语义未交代。
- （low）容量驱动的批量归档无回滚，多候选部分成功的原子性未文档化。
- （low）weight 与 reason 是否回流影响后续召回评分，无仓内证据。
- （medium，增补）idle review 的 `agentTeams: scoped` 分支语义未取证（本次只确认了 pause 路径与开关存在）。
- （medium，增补）活动评分阈值 5 与实质准入 320/600 字符的取值依据无注释或文档说明，不知是经验值还是实测得出——LDVH 若要对齐须知道这是否可调。

## 建议

A1 LDVH 记忆业务系统规范采用三层骨架（运行时热记忆 / 受管文档 / 持久空间），并把「能力声明驱动工具面、缺失即降级且不虚构」写成规范的硬性条款；验收条件：规范文本中每条能力都有对应的降级声明，无「假定后端全能」的表述。判断依据：F1 到 F3。可被记忆业务系统规范起草承接。
A2 在 03 受控读写补一条候选规则：写、链、删类操作须基于本轮已准入的证据（先回读后改），禁止凭 id 猜测操作；验收条件：受控写工具在目标未经本轮回读时拒绝并给出明确错误。判断依据：F14 与 F8。可被 03 号规范修订承接。
A3 把破坏性动作从自动化链路中剔除、只留给显式 Human 意图（参照 forget 被移出自主 worker 白名单）；验收条件：自动化 worker 的工具白名单中不含删除与归档类工具。判断依据：F16 与 F12。可被 05 Helper 规范与编排协议承接。
A4 用户画像类内容锁在本机，压缩与维护都不外发，并把「不外发」写成机械约束而非约定；无需对象化——监测条件：引入任何云端记忆后端时回读本对象 F6 与 F7 复核。判断依据：F6 与 F7。
A5 LDVH 子代理协议借鉴信封形状：硬工具白名单加 persona 内置防注入与一次性结果工具，错过交接以已捕获收据恢复而不重跑变更；验收条件：委派协议文档包含白名单、persona 纪律、一次性结果工具与 maxDepth 四要素。判断依据：F18。可被编排技术支撑与子代理协议承接。
A6 LDVH 32 章「空闲维护与反思」须显式区分三类触发源：宿主事件触发（评审）、容量触发（维护）、以及二者互斥的事实；验收条件：规范文本中每个空闲任务标明其触发锚点，且明确容量维护不由空闲调度驱动。判断依据：F19 与 F23。**这是本次增补最应优先采纳的一条**——它修正的是规范自身的可读性缺陷（初版调研即因此误读）。
A7 LDVH 32 §10.3 的既有纪律（至多一条提议、只认真人断言、门 0 纪律复用）在 mnemon 有工程实现对应（F20 的至多一次、一层一片、只认亲口断言），可作为「该纪律确实可执行」的外部实证；建议在规范中补引运行期强制手段：验收条件：闲置代理的工具白名单在运行期被强制（白名单外调用被拒），而非仅由 persona 文本约束。判断依据：F20。
A8 LDVH 32 §10.1 的 fail-closed「保留已发生副作用并如实登记、不把部分写入当完成」可补一条实现要点：**取消或中止后若已发生提交，仍须进入对账而非静默丢弃**；验收条件：规范或实现中可检出「中止且已有提交」这一组合的处理路径。判断依据：F21。同时建议补「失败不重置配额」——否则反复失败的任务会无限占用预算。判断依据：F21。

## 后续分流

- A1 与 A2 → 记忆业务系统规范与 03 号规范修订；信号：记忆业务系统规范进入起草或 03 号修订时。
- A3 与 A5 → 05 Helper 规范与子代理协议；信号：Helper 或委派协议设计时。
- A4 → 08 号安全边界或记忆规范；信号：引入云端后端或复核敏感数据流向时。
- A6、A7、A8 → 32 号记忆存取系统规范修订；信号：32 章进入修订或空闲维护机制开始实现时。**A6 优先级最高**，因其修正的是规范可读性而非新增约束。
- R7（业界 AI 长期记忆实践）承接本对象未做的横向对照；本对象与其构成记忆方向的完整依据对。
- 与 R1（宿主能力）、R2（插件接入面）共同构成 LDVH 三大外部依据，互不复制、互相引用。
- 无需为 dsh-mnemon 再建对象——本 Research 即承载；监测条件：dsh-mnemon 版本实质变化（Provider 矩阵或能力契约变更）足以改变结论时，新建对象并按 superseded 处置本对象。
- 闲时机制的横向对照（Letta 现行实现、Hindsight）见独立对象 research-cf315013；本对象只承载 mnemon 一侧，两对象互不复制。
