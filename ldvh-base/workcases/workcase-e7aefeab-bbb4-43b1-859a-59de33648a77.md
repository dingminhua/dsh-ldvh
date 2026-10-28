---
fact_type_key: workcase
object_uid: e7aefeab-bbb4-43b1-859a-59de33648a77
title: 摩擦新增 accepted 终态（不可清偿）
status: open
gist: 给 Friction 账本增加「不可清偿」终态 accepted，并打通查重抑制、度量与呈现；要 Human 决定是否按此形态落规范。
serves: SG-1
summary: |-
  为 Friction 账本增加第四终态 accepted（已接受、不可清偿）。语义边界：只收「消除途径不存在／不在本项目可动范围／授权上不能动」，不收「代价不值得修」（后者保持 open，36 §9.3 现行纪律不变）；与已定决策冲突的阻碍（如已定「不做此项改造」）属决策约束而非权衡，入 accepted 时须在处置段写明冲突的 ADR。accepted 与 voided 的关键机械差异：voided 不参与查重（记错了，同类现象该重新入账），accepted 必须参与查重且命中静默。

  ### 改动落点
  - 26 §8/§9/§9.4/§12/§13/§14.1/§14.2/§15/§16：四值状态闭集、disposition 语义、open→accepted 流转（Human Gate）、§9.4 表态新流转不触发配对复审、§13 correct 支持 accepted 分支、§14.1/§15 终态完整性行、存量处置（不新增字段、不产生补填、906dae15 不迁移）。
  - 36 §4.1/§9/§15/§16：两条出路改三条、accepted 三类判据与复审义务、禁止「不值得修」入 accepted。
  - 11 §7.1/§9 第 1 项/§15：投影闭集含 accepted（唯一权威在 §7.1）；查重命中 accepted 时不写缓冲，在 §15 交还 residual 登记命中事实（不新增 §9 闭集外的机械写入）。
  - 实现：friction-writer 状态闭集与流转校验、friction-discovery 查重候选、工具面 schema 枚举、Web 呈现与度量、测试。
  - 存量：906dae15 保持 voided，不迁移、不重开。

  ### 复审路径
  accepted 的 disposition 段必答「复审触发」（宿主版本升级、依赖变更、授权变化）。触发出现时由 Human 走 26 §10 Human 入口新建账目，正文接续旧 uid；accepted 本身不重开。机械通道不主动重开 accepted，命中时只登记不晋升。
scope: |-
  做什么：
  - 修订 26 §8/§9/§9.4/§12/§13/§14.1/§14.2/§15/§16：四值状态闭集、disposition 语义、open→accepted 流转、配对复审表态、correct 分支、终态完整性、Human Gate 与存量处置
  - 修订 36 §4.1/§9/§15/§16：三条出路、accepted 三类判据与复审义务、禁止「不值得修」入 accepted
  - 修订 11 §7.1 投影闭集、§9 第 1 项查重与 §15 交还登记：accepted 参与对照，命中不写缓冲但登记命中事实
  - 实现 accepted 的状态校验、查重抑制、工具面 schema、Web 呈现、度量口径与测试
  - 给出 906dae15 存量处置建议（保持 voided 不迁移）并交 Human 决定

  明确不做什么：
  - 不把「代价不值得修」纳入 accepted（保持 open）
  - 不改 voided 的「记错了」语义
  - 不新增字段、不新增可配置阈值或第二个 N
  - 不迁移 v4 存量，不重开 906dae15
  - 不把 accepted 做成第二个留观态或可逆状态
  - 不新增 11 §9 自动动作闭集之外的机械写入
plan:
  - done_criteria: 26 §8 status 闭集四值；§9.1/§9.2/§12 一致；§9.4 表态 open→accepted 不触发配对复审；§13 correct 适用分支含 accepted；§14.1/§15 终态完整性行含 accepted；§16 第 2 项含 open→accepted（Human Gate）；§14.2 写明不新增字段、不产生补填、906dae15 不迁移；无「三值」残留
    step: 修订 26：状态闭集、disposition 语义、流转、§9.4 配对表态、§13 correct、§14.1/§15 验证表、§16 Gate、§14.2 存量
  - done_criteria: 36 §4.1/§9/§15/§16 含三类判据（消除途径不存在／不在可动范围／授权不能动）与「不值得修不得入 accepted」的禁止；复审触发写入处置段必答
    step: 修订 36：出路、accepted 三类判据、复审义务、必停
  - done_criteria: 11 §7.1 投影含 accepted；§9 第 1 项命中 accepted 时不写缓冲，并在 §15 交还 residual 登记命中事实；§9 第 4 项仍只作用于 open；不新增 §9 闭集外的机械写入
    step: 修订 11：§7.1 投影闭集、§9 第 1 项查重与 §15 交还登记
  - done_criteria: 状态校验接受 accepted；查重命中 accepted 不写缓冲；工具面 status enum 含 accepted；Web 呈现 accepted；度量口径明确（accepted 不进解决率分母、单列计数，消费者为 26 §12 dogfood 度量与 Web 呈现）；测试全绿
    step: 实现：writer/discovery/tools/web/度量与测试
pre_reviews:
  - at: 2026-10-28T17:49:06.212Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 对象恰当性：符合——21 §6.3 非 Spark/ADR；draft＋C1 提案模式（21 §14），Gate 1 成 Human 决定点；00 §4.2 非根决定。方案可行性：符合——step 1 逐项点名 26 §13/§14.1/§15/§16/§9.4/§14.2 终态条款；step 2 三类判据＋禁「不值得修」入 accepted＋复审触发必答；查重含 accepted 且命中静默（11 §7.1，与 voided 不查重不冲突，26 §9.1）；step 3 命中不写缓冲、§15 residual 登记、不新增 §9 闭集外写入；step 4 工具面 enum、Web、度量不进分母且单列（26 §12 与 Web）、测试全绿；复审路径可执行（disposition 必答复审触发→Human 走 26 §10 新建账目接续旧 uid）。scope 清晰度：符合——「不值得修不得入 accepted」在 summary、scope 不做什么、step 2 三处写明（合 36 §9.2/§9.3）；已定决策冲突归决策约束、须写冲突 ADR；不做什么明列不改 voided 语义、不新增字段、906dae15 不迁移不重开，处置留 Human。保证边界：只核 plan/scope 可判性与落点完整性，不证明语义判断与实现正确；落规范与否属 Gate 1 Human 决定。
    session_id: 1d76bdcc-8b6c-473a-b86a-9807f7224884
    session_source: host
    auditor_origin: subagent
    candidate_fingerprint: f1976f3b73f162e0e7a491ed4a35e940b88014cb47788b04880016814fc8f376
    covered_partitions:
      - id: plan#1
        fingerprint: 5f8d44d32e9659cd46b9ae786b0e7b7932b8f3d47378438866d7a7e1e069bac2
      - id: plan#2
        fingerprint: 6414efd41906ad574fcd94c83a4be8c957b6ec52250969a8b0fa567cfcaef71e
      - id: plan#3
        fingerprint: 65a142047b2c1b745b3bc10acd90fc930de4abfee216ef7d25f58269332313a2
      - id: plan#4
        fingerprint: 704a8aaf339a2a4a15a3ba1730729716814b771b48e45d2aa0ad831480c0e7b9
      - id: scope:做什么#1
        fingerprint: bf59ea4338a44a5cc4c2ed208a9dda4a34f909e5ff6adba2f8029c0d7124437c
      - id: scope:做什么#2
        fingerprint: f8b80073e74ff62eb81107d901061fcee7bfbe61912a9bf5278d2cf180df7529
      - id: scope:做什么#3
        fingerprint: be3ead3be29925d3d909cfa1bccbfa1528b194ce1bc4b0d1fcc7d6ff05ad83e2
      - id: scope:做什么#4
        fingerprint: 84a9dcaee27aab50bc6742486a49c199a5737f0a2aca0eedae883f773854bb6b
      - id: scope:做什么#5
        fingerprint: 0a04f8b0fa9bae66e1aca0568a9e98dfd991f46e093de058a4a73c8db511b740
      - id: scope:明确不做什么#1
        fingerprint: 5a651e71da237d8f8f3a268edbb9cf4048c2b208cf3b71fd6c93b426d6ce1ff8
      - id: scope:明确不做什么#2
        fingerprint: ebb69a67db207a15b5fc847b33b7c55df91da58eee68c00830785227cea3d22a
      - id: scope:明确不做什么#3
        fingerprint: bfa8175d5627f1909cab7e9cb667f5cc6d1f667c13681d3a229938c326dad305
      - id: scope:明确不做什么#4
        fingerprint: a753a4a895a5eeb2743eb12bb4a6cabdca1284985f5646c30911579395010598
      - id: scope:明确不做什么#5
        fingerprint: 66df2884d229176732b13301efabaaf648c841028ad152e3a856a9fdf42c6e77
      - id: scope:明确不做什么#6
        fingerprint: 9d327adacd8984c0c5ca6856ea3f23c21969456c94b12a61db2637bdd430c4f7
    round_index: 1
    verdict: pass
gate_1:
  approved_at: 2026-10-28T17:55:42.116Z
  approver: 老丁
  authorization_fingerprint: f1976f3b73f162e0e7a491ed4a35e940b88014cb47788b04880016814fc8f376
  scope_snapshot: |-
    做什么：
    - 修订 26 §8/§9/§9.4/§12/§13/§14.1/§14.2/§15/§16：四值状态闭集、disposition 语义、open→accepted 流转、配对复审表态、correct 分支、终态完整性、Human Gate 与存量处置
    - 修订 36 §4.1/§9/§15/§16：三条出路、accepted 三类判据与复审义务、禁止「不值得修」入 accepted
    - 修订 11 §7.1 投影闭集、§9 第 1 项查重与 §15 交还登记：accepted 参与对照，命中不写缓冲但登记命中事实
    - 实现 accepted 的状态校验、查重抑制、工具面 schema、Web 呈现、度量口径与测试
    - 给出 906dae15 存量处置建议（保持 voided 不迁移）并交 Human 决定

    明确不做什么：
    - 不把「代价不值得修」纳入 accepted（保持 open）
    - 不改 voided 的「记错了」语义
    - 不新增字段、不新增可配置阈值或第二个 N
    - 不迁移 v4 存量，不重开 906dae15
    - 不把 accepted 做成第二个留观态或可逆状态
    - 不新增 11 §9 自动动作闭集之外的机械写入
attempt:
  attempt_id: 1
  started_at: 2026-10-28T17:55:42.116Z
  controller: deepseek-v4.1-flash 主控
  heartbeat_at: 2026-10-28T19:31:02.323Z
  session_id: session-bb9396be-ceb2-46d6-b21a-52bb5bb300a0
  session_source: host
reviews:
  - at: 2026-10-28T19:22:42.400Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    session_id: e5d5e670-4e7b-4297-9bfc-95778ae510a6
    session_source: host
    implementer_session_id: session-bb9396be-ceb2-46d6-b21a-52bb5bb300a0
    implementer_session_source: host
    reviewer_origin: subagent
    summary: 四项发现均已闭合，复跑证据：`plugin/web` 套件 551/551 通过、`tsc -b` 退出码 0、六个 friction 相关 node 测试文件 227 项 0 失败。
created_at: 2026-10-28T17:42:03.600Z
change_log:
  - at: 2026-10-28T17:42:03.600Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 受控创建 WorkCase 工单（draft，21 §14 C1 提案对象模式）
  - at: 2026-10-28T17:45:35.581Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 按建前审核五项修补：补 11 §7.1 投影落点、26 §14.2 存量处置、accepted 复审路径与命中登记、step 4 呈现/工具面/度量判据、scope 判据边界。
  - at: 2026-10-28T17:47:09.078Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 第二轮审核修补：26 落点补 §9.4/§13/§14.1/§15/§16；命中登记锁定 11 §15 residual；度量单列计数点名消费者。
  - at: 2026-10-28T17:49:06.212Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: "记录建前独立审核结论（pass，覆盖 plan+scope 当前候选） [pre-gate1 audit recorded by session 1d76bdcc-8b6c-473a-b86a-9807f7224884; verdict: pass; round: 1/3; covered: 15/15 partition(s); candidate_fingerprint: f1976f3b73f1…; pre_reviews entries: 1; 记录自子代理会话 1d76bdcc-8b6c-473a-b86a-9807f7224884 的最终产出（Code 捕获）]"
  - at: 2026-10-28T17:55:42.116Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: Gate 1 批准：按候选计划执行 accepted 终态落规范与实现 [gate_1 approved by 老丁; attempt 1 allocated to deepseek-v4.1-flash 主控]
  - at: 2026-10-28T18:59:30.220Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 执行计划步骤 1–4：26/36/11 三份规范落 accepted 终态，writer/discovery/landing/tools/lifecycle 与 Web 同步，测试补 accepted 用例 [attempt 1 heartbeat refreshed]
  - at: 2026-10-28T19:22:42.400Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: "记录关闭前独立复核结论（pass，覆盖步骤 1–4 已执行结果） [review recorded by session e5d5e670-4e7b-4297-9bfc-95778ae510a6; reviews entries: 1; 记录自子代理会话 e5d5e670-4e7b-4297-9bfc-95778ae510a6 的最终产出（Code 捕获）]"
  - at: 2026-10-28T19:31:02.323Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 写入关闭提案（## 结果 节）：逐条判据核对、已证实、未证实与残留、残留处置建议 [attempt 1 heartbeat refreshed]
---

# 摩擦新增 accepted 终态（不可清偿）

## 摘要

为 Friction 账本增加第四终态 accepted（已接受、不可清偿）。语义边界：只收「消除途径不存在／不在本项目可动范围／授权上不能动」，不收「代价不值得修」（后者保持 open，36 §9.3 现行纪律不变）；与已定决策冲突的阻碍（如已定「不做此项改造」）属决策约束而非权衡，入 accepted 时须在处置段写明冲突的 ADR。accepted 与 voided 的关键机械差异：voided 不参与查重（记错了，同类现象该重新入账），accepted 必须参与查重且命中静默。

### 改动落点
- 26 §8/§9/§9.4/§12/§13/§14.1/§14.2/§15/§16：四值状态闭集、disposition 语义、open→accepted 流转（Human Gate）、§9.4 表态新流转不触发配对复审、§13 correct 支持 accepted 分支、§14.1/§15 终态完整性行、存量处置（不新增字段、不产生补填、906dae15 不迁移）。
- 36 §4.1/§9/§15/§16：两条出路改三条、accepted 三类判据与复审义务、禁止「不值得修」入 accepted。
- 11 §7.1/§9 第 1 项/§15：投影闭集含 accepted（唯一权威在 §7.1）；查重命中 accepted 时不写缓冲，在 §15 交还 residual 登记命中事实（不新增 §9 闭集外的机械写入）。
- 实现：friction-writer 状态闭集与流转校验、friction-discovery 查重候选、工具面 schema 枚举、Web 呈现与度量、测试。
- 存量：906dae15 保持 voided，不迁移、不重开。

### 复审路径
accepted 的 disposition 段必答「复审触发」（宿主版本升级、依赖变更、授权变化）。触发出现时由 Human 走 26 §10 Human 入口新建账目，正文接续旧 uid；accepted 本身不重开。机械通道不主动重开 accepted，命中时只登记不晋升。

## 授权范围

做什么：
- 修订 26 §8/§9/§9.4/§12/§13/§14.1/§14.2/§15/§16：四值状态闭集、disposition 语义、open→accepted 流转、配对复审表态、correct 分支、终态完整性、Human Gate 与存量处置
- 修订 36 §4.1/§9/§15/§16：三条出路、accepted 三类判据与复审义务、禁止「不值得修」入 accepted
- 修订 11 §7.1 投影闭集、§9 第 1 项查重与 §15 交还登记：accepted 参与对照，命中不写缓冲但登记命中事实
- 实现 accepted 的状态校验、查重抑制、工具面 schema、Web 呈现、度量口径与测试
- 给出 906dae15 存量处置建议（保持 voided 不迁移）并交 Human 决定

明确不做什么：
- 不把「代价不值得修」纳入 accepted（保持 open）
- 不改 voided 的「记错了」语义
- 不新增字段、不新增可配置阈值或第二个 N
- 不迁移 v4 存量，不重开 906dae15
- 不把 accepted 做成第二个留观态或可逆状态
- 不新增 11 §9 自动动作闭集之外的机械写入

## 计划

1. 修订 26：状态闭集、disposition 语义、流转、§9.4 配对表态、§13 correct、§14.1/§15 验证表、§16 Gate、§14.2 存量
   完成判据：26 §8 status 闭集四值；§9.1/§9.2/§12 一致；§9.4 表态 open→accepted 不触发配对复审；§13 correct 适用分支含 accepted；§14.1/§15 终态完整性行含 accepted；§16 第 2 项含 open→accepted（Human Gate）；§14.2 写明不新增字段、不产生补填、906dae15 不迁移；无「三值」残留
2. 修订 36：出路、accepted 三类判据、复审义务、必停
   完成判据：36 §4.1/§9/§15/§16 含三类判据（消除途径不存在／不在可动范围／授权不能动）与「不值得修不得入 accepted」的禁止；复审触发写入处置段必答
3. 修订 11：§7.1 投影闭集、§9 第 1 项查重与 §15 交还登记
   完成判据：11 §7.1 投影含 accepted；§9 第 1 项命中 accepted 时不写缓冲，并在 §15 交还 residual 登记命中事实；§9 第 4 项仍只作用于 open；不新增 §9 闭集外的机械写入
4. 实现：writer/discovery/tools/web/度量与测试
   完成判据：状态校验接受 accepted；查重命中 accepted 不写缓冲；工具面 status enum 含 accepted；Web 呈现 accepted；度量口径明确（accepted 不进解决率分母、单列计数，消费者为 26 §12 dogfood 度量与 Web 呈现）；测试全绿

## 执行

**attempt 1**（controller: deepseek-v4.1-flash 主控）

### 计划步骤 1（26 号规范）
- §1 价值判断：状态叙述加 accepted（「确认不可清偿、记录一次即不再报告」）。
- §4.3：新增「入账后仍可判不可清偿」段——可行性判断属入账后的处置，不回头否定入账依据，不吸收「代价不值得修」。
- §6.1：明写 accepted 不在初态集合。
- §8：status 闭集加 accepted；disposition 语义扩为「废弃理由或不可清偿理由」，条件改为 voided/accepted；正文处置段条件加 accepted；字段间不变量改为 `disposition ⇔ {voided, accepted}`、`informs` 排除 accepted。
- §9：闭集四值 + accepted 语义边界（与 voided 的查重差异）；§9.1 加 accepted 行（disposition、处置段含复审触发、informs 空、paired-with 可留）；§9.2 加 `open → accepted`（Human Gate）、终态不重开与复审路径；§9.3 终态列表加 accepted；§9.4 加 `open → accepted` 不触发配对复审。
- §12：迭代决策排除 accepted；dogfood 度量加「已接受成本」单列（不进解决率分母）；攒账查重对象扩为 open + accepted（命中静默）；默认召回排除 accepted。
- §13：correct 适用三终态、机械校验分三支（加 accepted 支）；创建不得进入 accepted；删除段「四类状态」。
- §14.1/§15：状态-关系不变量、处置段条件、终态去向条件、终态完整性行均含 accepted。
- §14.2：新增「本次闭集扩张的存量处置」——不新增必填字段、不产生补填；906dae15 保持 voided 不迁移。
- §16：Human Gate 第 2 项加「接受 open→accepted」。
- §17：必停加 accepted 缺件与「不值得修不得按 accepted 处置」。
- §18：新增第 7 条，确认 accepted 的消费方（查重抑制、度量单列、召回排除）。
- §3.1/§3.2/§5：三值表述改为四值，度量口径改为「voided 与 accepted 各自可区分」。

### 计划步骤 2（36 号规范）
- §4.1：两条出路改三条（修／记错／接受）。
- §4.2：不可清偿仍适用本规范，处置是接受而非不入账。
- §7.5：新增「已定决策冲突的两种形态须区分」——价值冲突不入账，途径关闭入 accepted 且须写冲突 ADR。
- §8.2：新增第 6 项，命中 accepted 时静默且命中事实在 residual 登记。
- §9：H2 标题改为「销账、废弃与接受的判定」；新增 §9.4 接受（三类判据、与不值得修/废弃的区别、复审触发、配对不触发复审、机械效果、不得做的事）。
- §10/§11/§12/§13：写入路径、风险路由、交还、边界（Friction 结论改为「要不要修、能不能清偿」）。
- §14：新增「接受判据」验证行；末段边界加「接受不构成不值得修」。
- §15：Human Gate 第 2 项加接受。
- §16：必停第 2 项扩为「按废弃或按接受处置」，第 6 项加接受。
- §17：新增第 8 条，不以 accepted 收容「不值得修」。

### 计划步骤 3（11 号规范）
- §7.1：账本侧候选投影改为 `open` + `accepted`，并写明 accepted 只用于命中静默判定（唯一权威落在 §7.1）。
- §9 第 1 项：读取对象改为 `open` 与 `accepted` 账本；新增「命中 accepted 时的处置」段——不写缓冲、不晋升、不补充计数，命中事实在 §15 交还 residual 登记，不得改状态或重开。
- §9 第 4 项、机械通道边界、§20.1 第 3 项：销账/废弃枚举加接受。
- §15 交还要素 4：加「命中 accepted 的登记」。

### 计划步骤 4（实现与测试）
- `friction-writer.js`：STATUSES 四值；body 结构与处置段条件含 accepted；终态守卫含 accepted；流转闭集与 disposition/informs 守卫扩到 accepted；correct 三支（含 accepted 支）；list 默认过滤排除 accepted；投影与注释同步。
- `friction-discovery.js`：`loadDedupCandidates` 改为 `includeResolved: true` 并过滤 `open` + `accepted`。
- `friction-landing.js`：`same-obstacle` 命中前先读目标账目；命中 accepted 返回 `action: "silent"` 并带 residual，不写缓冲/不晋升/不计数；读失败归 supplement 阶段。
- `friction-subagent-contract.js`：提示词与 schema 说明改为「open 或 accepted」，并明确命中 accepted 仍须报 same-obstacle。
- `friction-tools.js`：工具摘要与 status/list enum 加 accepted。
- `lifecycle.js`：落地返回的 residual 进待处置队列（命中 accepted 的登记不得无痕）。
- Web：locales 加 accepted 文案与语义限定；ObjectStatusFilter 加 accepted；StatusBadge 走中性灰；ObjectList 终态卡与关联状态含 accepted；statusColors 注明全局 accepted 键已被 WorkCase 占用、不得复用。
- 测试：`friction-four-state` 闭集断言改四值，新增 accepted 流转/终态/召回三例；`friction-landing` 新增命中 accepted 静默与查重候选两例；`friction-subagent-contract` 空候选文案断言同步。

### 验证结果
- `node --test test/friction-four-state.test.mjs`：14/14 通过。
- `node --test test/friction-landing.test.mjs`：27/27 通过。
- `node --test test/friction-subagent-contract.test.mjs`：全通过。
- 全量 `node scripts/run-tests.mjs`：2449 项，2439 通过，8 项失败。**经对照 HEAD 工作树与事实源漂移双重验证，8 项均为既有基线漂移，与本次改动无关**：其中 4 项在 HEAD 即失败（`source-recall` 的通用词/F0 层/注释数字/同义改写基线）；另 4 项由工作树中未跟踪的 `spark-e92d4ebb`（并行会话产物）与 `friction-68e6f33e` 的机械通道补充观察（count 5→6）造成——把这两份事实源改动临时移开后，失败集与 HEAD 完全一致。
- `eslint` 对改动的 lib 与 web 文件：无告警。
- `tsc -b`（web）：通过（初次暴露 `statusColors` 的 accepted 重复键，已改为由 StatusBadge 显式着色）。

### 审核与复核后的修补（01 §12 审核轴 + 21 §14 复核轴）
**规范十维审核（隔离子代理 15274ea3）**：首轮 needs_revision（F1–F6 阻断 + F7–F10 建议），逐条修补后复审，仅剩 F11（26 §13 首句仍写「两个终态」）已改。
- F1 复审自锁：26 §10 新增「阈值的射程与 Human 复审例外」（阈值只约束机械晋升；Human 入口含 accepted 复审不经阈值判定）；36 §9 同步；26 §9.2 回指。
- F2 36 §7.5 互斥：前句限定为「价值冲突形态」、表格反例改写、删除回溯断言。
- F3 26 §17 重号：顺延为 6/7/8/9；11 §9（两处）、36 §14、插件注释的「第 6 项」改为第 7 项。
- F4 26 §9.2 补第三类「授权上不能动」，判据权威指向 36 §9.4。
- F5 26 §14.2 增写后果披露：voided 不参与查重 → 906dae15 仍会被再报告；本轮未解决该原始案例；须 Human 另案决定（一次性 voided→accepted 通道）。
- F6 26 §12 钉死 accepted 投影取数通道（F1 枚举 + status 过滤）。
- F7 11 §19.1 补本轮归口（第 4 项并触及第 3 项）与 Human 决定记录；F8 03 §9.7 补「接受」；F9 26 §15 拆结构项/内容项并改写 tools 摘要；F10 26 §13 补处置段与 disposition 同步规则；F11 26 §13 首句改「三个终态」。

**执行结果独立复核（隔离子代理 e5d5e670，21 §14 复核轴）**：needs_revision，4 项发现已处置：
- ① Web 契约测试 4 项断言旧闭集（`tests/api/friction-norm-presentation-contract.test.ts`）——已同步为四值/含 accepted 形态，`plugin/web` 套件现 551/551 通过。**此前工单「验证结果」只报 node 套件、未跑 Web 套件，属验证范围不完整，此处补正。**
- ② 26 §10 的 Human 复审例外超出资助落点枚举——已如实登记于此，**须 Human 追认或撤回**（见下方「待 Human 决定」）。
- ③ 26 §18 第 7 条要求 accepted 有「度量单列」消费方，而实现侧无该计数——已在 `web/api/routes/cognition.ts` 补 `frictionLedger.acceptedCount`（单独一次遍历，保持待决定事项的字面 `raw.status !== 'open'` 判定不变），并接上响应体；该消费点现已落地。
- ④ 陈旧「三值」表述——已清理 `web/api/routes/cognition.ts`、`web/docs/02-CognitionCenter.md`、`test/friction-four-state.test.mjs`、`test/friction-writer.test.mjs` 的相关注释（保留描述历史收缩的叙述，其语义正确）。

### 复核后补充（残留 a 项已闭合）
- `web/src/utils/api.ts`：`CognitionData` 声明 `frictionLedger?: { acceptedCount: number }`（此前运行时可读、类型层不可见）。
- `web/src/pages/CognitionCenter.tsx`：摘要段渲染该计数（独立观测量，**不并入 inbox 计数**——accepted 不是待办）；locale 增中英词条。
- `web/tests/api/cognition-inbox-contract.test.ts`：新增契约测试钉住「API 单独遍历计数 / 响应体承载 / 客户端类型 / UI 读取 / 不得混入 inbox」。
- 顺手清掉两个**既有** unused-import（`deriveWorkCaseV5View`、`GitFork`，HEAD 即存在，非本单引入），使改动文件的 eslint 真正无告警。

### 复核记录
- 执行结果独立复核（隔离子代理 e5d5e670，21 §14 复核轴）：首轮 needs_revision（Web 契约测试 4 项、26 §10 越界、度量单列缺失、陈旧三值），逐项闭合后复验 **pass**；结论已由 `record_review` 写入 `reviews`（Code 盖戳身份）。

### 验证结果（补正后）
- `node --test test/friction-four-state.test.mjs`：14/14；`test/friction-landing.test.mjs`：27/27；`test/friction-subagent-contract.test.mjs`、`test/friction-writer.test.mjs`、`test/friction-discovery.test.mjs`、`test/friction-tools.test.mjs`、`test/spec-registry.test.mjs`：全通过（合计 294 项 0 失败）。
- `plugin/web` 套件（`npx tsx --test tests/api/*.test.ts`）：**552 项 552 通过 0 失败**（含新增的 accepted 度量单列契约测试）。
- 全量 `node scripts/run-tests.mjs`：2453 项，2443 通过，8 项失败。**8 项均为既有基线漂移**：4 项在 HEAD 即失败（`source-recall` 基线）；另 4 项由工作树未跟踪的 `spark-e92d4ebb` 与 `friction-68e6f33e` 的机械通道补充观察造成——移开这两份事实源改动后，失败集与 HEAD 完全一致（已实测）。
- `eslint`（改动的 lib/web 文件）无告警；`tsc -b`（web）通过。

### 待 Human 决定
- **26 §10 的 Human 复审例外是否追认**：该段放宽了「open 账目成立以达阈值为前提」的射程（限定为机械晋升，Human 入口不经阈值判定），射程不限于 accepted 复审。它不在工单原 scope 的 26 条款枚举内，属执行中发现的必要修补（否则 accepted 复审路径自锁）。请 Human 追认或指示撤回。

### 未完成与残留
- `friction-68e6f33e` 的 count 递增是机械通道在本次会话期间的真实落地，不属本单改动，未纳入提交范围。
- 受控提交已完成（`ad6cd1b`，09 precheck `passed`，Git Gate 双闸通过）；Gate 2 关闭待 Human 批准。

## 结果

### 逐条判据核对

1. **修订 26——达成。** 26 §8 `status` 闭集为 `open/resolved/voided/accepted`；§9.1 新增 accepted 行、§9.2 新增 `open → accepted`（Human Gate）并写明三类成立条件与判据权威在 36 §9.4；§9.3 终态列表含 accepted；§9.4 表态「open→accepted 不触发配对复审」；§12 迭代决策排除 accepted、dogfood 度量加已接受成本单列、攒账查重对象扩为 open+accepted、默认召回排除 accepted 且钉死投影取数通道；§13 `correct` 适用三终态且机械校验分三支（含 accepted 支）、新增处置段与 disposition 同步规则；§14.1/§15 状态-关系不变量、处置段条件、终态去向条件、终态完整性（拆结构项/内容项）均含 accepted；§16 第 2 项含 `open→accepted`；§14.2 写明不新增字段、不产生补填、906dae15 不迁移，并披露「voided 不参与查重 → 该存量仍会被再报告」。全文已无「三值」表述（`grep` 核验）。
2. **修订 36——达成。** §4.1 两条出路改三条；§4.2 写明不可清偿仍适用本规范；§7.5 区分已定决策冲突的「价值冲突」与「途径关闭」两形态；§8.2 第 6 项命中 accepted 静默；§9.4 接受三类判据（消除途径不存在／不在可动范围／授权不能动）+ 复审触发 + 与废弃区别 + 不触发配对复审 + 机械效果 + 禁止事项；§14 新增接受判据验证行；§15 第 2 项含接受；§16 必停第 2/6 项含接受；§17 第 8 条禁止以 accepted 收容「不值得修」。
3. **修订 11——达成。** §7.1 账本侧投影扩为 `open`+`accepted`（唯一权威在此），并写明 accepted 只用于命中静默判定；§9 第 1 项新增「命中 accepted 时的处置」——不写缓冲、不晋升、不补充计数，命中事实在 §15 交还 `residual` 登记，不得改状态或重开；§9 第 4 项仍只作用于 open；§15 交还要素 4 含命中登记；§19.1 登记本轮归口（第 4 项并触及第 3 项）。
4. **实现与测试——达成。** `friction-writer.js` 四值闭集、处置段/终态守卫、correct 三支；`friction-discovery.js` 查重候选 open+accepted；`friction-landing.js` 命中 accepted 返回 `action:"silent"` 并带 residual；`friction-tools.js` enum 含 accepted；`lifecycle.js` residual 入待处置队列；Web 呈现（词条/过滤/徽标/终态卡/关联行）与 `frictionLedger.acceptedCount` 单列计数（API + 类型 + UI + 契约测试）。

### 已证实
- 代码层「命中 accepted 不写缓冲、不晋升、不计数」为真：`friction-landing.js` 先读目标账目判 `status === "accepted"` 即返回 silent（不进入 `supplementOccurrence`、不写缓冲、不晋升），`friction-writer.js` 终态守卫对 accepted 亦拒绝补充级更新（`friction/status_terminal`），双层拦截。
- 测试：`node --test` 六个 friction 相关文件 294 项 0 失败；`plugin/web` 套件 552 项 552 通过 0 失败；`tsc -b` 通过；改动文件 eslint 无告警。
- 受控提交：`ad6cd1b`，09 precheck `passed`，Git Gate pre-commit 与 commit-msg 均通过。

### 未证实与残留
- 语义查重与「不可清偿」分类判断属语义判断，机械层不判其正确性。
- accepted 的复审触发无机械检测：环境变化不会自动被发现，依赖 Human 或召回时看到处置段信号；该边界已在 26 §9.2 与 36 §9.4 登记为自觉约束。
- node 全量套件 2453 项中 8 项失败，均为既有基线漂移（4 项 HEAD 即失败；4 项由工作树未跟踪 spark 与 `friction-68e6f33e` 的机械通道补充观察造成，移开后与 HEAD 一致），与本单改动无关。
- **26 §10 的 Human 复审例外超出本单原 scope 的条款枚举**，已如实登记并待 Human 追认或撤回。
- **老丁的原始案例 `906dae15` 仍为 voided，仍会被重新报告**——本轮只对新增流转生效；要让该案例也不再报告，须 Human 另案决定是否开一次性 `voided → accepted` 改判通道。

### 残留处置建议
- 26 §10 例外：请 Human 追认（推荐，否则 accepted 复审路径自锁）或指示撤回。
- `906dae15`：请 Human 决定是否另案开 `voided → accepted` 改判通道；本单不擅自推进。

