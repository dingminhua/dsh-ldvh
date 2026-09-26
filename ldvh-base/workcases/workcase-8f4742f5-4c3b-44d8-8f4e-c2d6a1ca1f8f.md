---
fact_type_key: workcase
object_uid: 8f4742f5-4c3b-44d8-8f4e-c2d6a1ca1f8f
title: Spark 授权门禁与 20 号一致性修复
status: open
gist: 为 Spark 的创建与终态转换补宿主询问门禁，使 Human 确认可机械取得；同时修正 20 号规范中失效的交叉引用与未登记的消费点声明。需要你决定规范候选文本与是否连带处置无授权的沉默阈值。
serves: SG-1
summary: |-
  本工单承接 Human 2026-09-25 的三项决定：为 Spark 补机械授权门禁、存量 45 个对象不后补凭据、其余问题按 00 价值处置。

  ### 现状核实
  20 §16 声明三项 Human Gate（创建、终态转换、问题与边界大改），但 plugin/lib/spark-tools.js 无任何 userQuestions 或 awaitsHumanDecision 消费，toolDescriptorFor 硬编码 timeoutMs: 30000，故三项门禁当前仅由 AI 自律承载、无机械凭据。对照 workcase-tools.js:70 已声明 awaitsHumanDecision 并于 :829 消费。

  ### 处置方向
  新增 host-seams 的 requestSparkConsent（同 requestWorkcaseRouting 形态：无答题器、询问失败或未作选择一律 fail-closed，且转发 signal）；spark-tools 消费 awaitsHumanDecision 以解除该工具的超时；创建与终态转换两项在写入前取确认，未取得即返回 rejected；大改项按 09 §6 弱约束交还 question/scope_boundary 的现值与拟改值对照，不阻断、不代为判定。规范侧同步修订 §16 承载条款、§13 三条受控操作、§15 验证表增行、§17 第 4 项扩写。

  ### 边界
  存量 45 个对象按 Human 决定不后补凭据、不改写既有 change_log；不新增 confirmed_at/confirmed_by 一类留存字段；不改 §9.4 三情形定义本身。
scope: |-
  做什么：
  - 为 Spark 的创建与终态转换接入宿主询问门禁：host-seams 新增 requestSparkConsent，spark-tools 消费 awaitsHumanDecision 并解除硬编码超时
  - 问题与边界大改按 09 §6 弱约束交还现值与拟改值对照，不阻断、不代为判定
  - 修订 specs/20 的 §16、§13、§15、§17 授权承载条款，修正 §8 行注错引与 §5/§12 失效节号
  - 收口 §11 关系 open 约束的表述，并收口 §12 消费点声明
  - 补充与改造 plugin/test 测试，按 09 §5 做变异验证

  明确不做什么：
  - 不为存量 45 个 Spark 后补确认凭据，不改写既有 change_log（Human 已决定）
  - 不新增 confirmed_at/confirmed_by 一类留存字段
  - 不改 20 §9.4 三情形定义本身
  - 不改 specs/00、README、LICENSE 与版本声明点等受保护内容
  - 不实施 v4 存量 103 个 Spark 的迁移
plan:
  - done_criteria: host-seams.js 导出该函数；无答题器、询问失败、未作选择三种路径均返回未授予；signal 被转发；测试覆盖三种失败路径
    step: 新增 requestSparkConsent seam
  - done_criteria: OPERATIONS 的 spark-write-object 声明该 flag；toolDescriptorFor 对该 flag 不设 timeout；创建与转终态在未取得确认时返回 rejected；变异验证可证 flag 被真实消费
    step: spark-tools 消费 awaitsHumanDecision 并接入创建与终态的确认
  - done_criteria: question/scope_boundary 变化时 envelope 含现值与拟改值对照，且该对照不阻断更新
    step: 大改弱约束交还
  - done_criteria: §16/§13/§15/§17 授权承载条款落定；§8 行注改正；§5/§12 节号修正；§11/§12 收口成立；独立对抗审核完成并逐条处置
    step: 修订 20 号规范
  - done_criteria: plugin 全量测试与 tsc 通过；受影响用例同步修复并如实登记实际数量
    step: 测试与全量验证
gate_1:
  approved_at: 2026-09-26T05:48:37.902Z
  approver: Human（本会话直接指令：对「给三项 Gate 挂机械闸，存量的45就不后补了」确认，并在 Gate 1 提请中选定「批准 Gate 1（推荐）」）
  authorization_fingerprint: 3d7ea0e73bfedc5ed79f7093eebd996620b712eebccef2f980f20a67157ef386
  scope_snapshot: |-
    做什么：
    - 为 Spark 的创建与终态转换接入宿主询问门禁：host-seams 新增 requestSparkConsent，spark-tools 消费 awaitsHumanDecision 并解除硬编码超时
    - 问题与边界大改按 09 §6 弱约束交还现值与拟改值对照，不阻断、不代为判定
    - 修订 specs/20 的 §16、§13、§15、§17 授权承载条款，修正 §8 行注错引与 §5/§12 失效节号
    - 收口 §11 关系 open 约束的表述，并收口 §12 消费点声明
    - 补充与改造 plugin/test 测试，按 09 §5 做变异验证

    明确不做什么：
    - 不为存量 45 个 Spark 后补确认凭据，不改写既有 change_log（Human 已决定）
    - 不新增 confirmed_at/confirmed_by 一类留存字段
    - 不改 20 §9.4 三情形定义本身
    - 不改 specs/00、README、LICENSE 与版本声明点等受保护内容
    - 不实施 v4 存量 103 个 Spark 的迁移
attempt:
  attempt_id: 1
  started_at: 2026-09-26T05:48:37.902Z
  controller: deepseek-v4.1-flash@dsh-ldvh-session
  heartbeat_at: 2026-09-26T06:59:03.124Z
  session_id: session-71ad5a69-4bde-4290-acb3-96e92e787a8b
  session_source: host
created_at: 2026-09-26T05:47:10.858Z
change_log:
  - at: 2026-09-26T05:47:10.858Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 WorkCase 工单（draft，21 §14 C1 提案对象模式）
  - at: 2026-09-26T05:48:37.902Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: Gate 1 批准：Human 选定「批准 Gate 1（推荐）」，按四项提请内容（独立复核安排／越权守卫／未验证范围与风险／批准范围与后续）钉入授权指纹，转入执行期 [gate_1 approved by Human（本会话直接指令：对「给三项 Gate 挂机械闸，存量的45就不后补了」确认，并在 Gate 1 提请中选定「批准 Gate 1（推荐）」）; attempt 1 allocated to deepseek-v4.1-flash@dsh-ldvh-session]
  - at: 2026-09-26T06:55:11.686Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "测试：以本会话身份记录（预期被独立性判据拒绝） [review recorded by session session-71ad5a69-4bde-4290-acb3-96e92e787a8b; reviews entries: 1]"
  - at: 2026-09-26T06:59:03.124Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 记录执行结果（计划步骤 1–5 全部完成，含 §11 范围偏差如实登记）并撤回一条误写的非复核条目（该条目系通道探测、自述不构成复核结论） [attempt 1 heartbeat refreshed]
---

# Spark 授权门禁与 20 号一致性修复

## 摘要

本工单承接 Human 2026-09-25 的三项决定：为 Spark 补机械授权门禁、存量 45 个对象不后补凭据、其余问题按 00 价值处置。

### 现状核实
20 §16 声明三项 Human Gate（创建、终态转换、问题与边界大改），但 plugin/lib/spark-tools.js 无任何 userQuestions 或 awaitsHumanDecision 消费，toolDescriptorFor 硬编码 timeoutMs: 30000，故三项门禁当前仅由 AI 自律承载、无机械凭据。对照 workcase-tools.js:70 已声明 awaitsHumanDecision 并于 :829 消费。

### 处置方向
新增 host-seams 的 requestSparkConsent（同 requestWorkcaseRouting 形态：无答题器、询问失败或未作选择一律 fail-closed，且转发 signal）；spark-tools 消费 awaitsHumanDecision 以解除该工具的超时；创建与终态转换两项在写入前取确认，未取得即返回 rejected；大改项按 09 §6 弱约束交还 question/scope_boundary 的现值与拟改值对照，不阻断、不代为判定。规范侧同步修订 §16 承载条款、§13 三条受控操作、§15 验证表增行、§17 第 4 项扩写。

### 边界
存量 45 个对象按 Human 决定不后补凭据、不改写既有 change_log；不新增 confirmed_at/confirmed_by 一类留存字段；不改 §9.4 三情形定义本身。

## 授权范围

做什么：
- 为 Spark 的创建与终态转换接入宿主询问门禁：host-seams 新增 requestSparkConsent，spark-tools 消费 awaitsHumanDecision 并解除硬编码超时
- 问题与边界大改按 09 §6 弱约束交还现值与拟改值对照，不阻断、不代为判定
- 修订 specs/20 的 §16、§13、§15、§17 授权承载条款，修正 §8 行注错引与 §5/§12 失效节号
- 收口 §11 关系 open 约束的表述，并收口 §12 消费点声明
- 补充与改造 plugin/test 测试，按 09 §5 做变异验证

明确不做什么：
- 不为存量 45 个 Spark 后补确认凭据，不改写既有 change_log（Human 已决定）
- 不新增 confirmed_at/confirmed_by 一类留存字段
- 不改 20 §9.4 三情形定义本身
- 不改 specs/00、README、LICENSE 与版本声明点等受保护内容
- 不实施 v4 存量 103 个 Spark 的迁移

## 计划

1. 新增 requestSparkConsent seam
   - 完成判据：host-seams.js 导出该函数；无答题器、询问失败、未作选择三种路径均返回未授予；signal 被转发；测试覆盖三种失败路径
2. spark-tools 消费 awaitsHumanDecision 并接入创建与终态的确认
   - 完成判据：OPERATIONS 的 spark-write-object 声明该 flag；toolDescriptorFor 对该 flag 不设 timeout；创建与转终态在未取得确认时返回 rejected；变异验证可证 flag 被真实消费（仅加 flag 而超时仍硬编码时应有测试失败）
3. 大改弱约束交还
   - 完成判据：question/scope_boundary 变化时 envelope 含现值与拟改值对照，且该对照不阻断更新
4. 修订 20 号规范
   - 完成判据：§16/§13/§15/§17 授权承载条款落定；§8 行注改为 03 §15 第 9 条；§5/§12 节号修正；§11/§12 收口成立；按 01 §12 完成独立对抗审核并逐条处置发现
5. 测试与全量验证
   - 完成判据：plugin 全量测试与 tsc 通过；因 fail-closed 受影响的既有用例被同步修复，实际受影响数与修复结果如实登记

## 执行

- attempt 1 started at 2026-09-26T05:48:37.902Z (controller: deepseek-v4.1-flash@dsh-ldvh-session)；Gate 1 授权范围见 gate_1.scope_snapshot。

### 计划步骤 1（新增 requestSparkConsent seam）— 已完成

host-seams.js 新增该 seam 与 `SPARK_CONSENT_QUESTION_ID`/`SPARK_CONSENT_LABEL` 常量，问与收共用同一常量。无答题器、询问失败、未作选择、答案 id 不符、多选一律 fail-closed；caller signal 被转发。直接单测 `test/spark-consent-seam.test.mjs`（9 例）覆盖上述全部路径；变异（fail-open、去呈报强制、放宽多选）均被捕获。

### 计划步骤 2（消费 awaitsHumanDecision 并接入确认）— 已完成

`spark-write-object` 声明该 flag，descriptor 工厂改为 `...operation.awaitsHumanDecision === true ? {} : { timeoutMs: 30000 }`；实测描述符不再含 `timeoutMs`，读取类工具仍为 30000。创建与终态转换在写入前取确认，未取得即 rejected。变异验证：仅加 flag 而恢复硬编码超时时，`descriptor: awaitsHumanDecision is consumed` 用例失败。

### 计划步骤 3（大改弱约束交还）— 已完成

`sparkBoundaryDelta` 在写入前计算 question/scope_boundary 的现值与拟改值对照，随 envelope 的 `boundary_delta` 交还；不阻断、不发起询问、不代为判定；两字段未变时省略该字段。

### 计划步骤 4（修订 20 号规范）— 已完成，含一处范围偏差

已完成：§16 补授权取得与承载（含条件式要求、大改项不可验性、合并/拆分归属的义务方与承载限制）；§13 三条受控操作同步；§14.1/§15 增机械校验项；§17.4 扩写；§12 消费点收口；修正失效引用（§8 注 §18 第 9 条→03 §15 第 9 条、31 号 §10.2→31 号 §9）、删除指向非规范文档的规则外包。

**范围偏差（须 Human 知悉）**：Gate 1 授权含「收口 §11 关系 open 约束的表述」。执行中发现该项**已由 open Spark `71930c4a` 缺口二承载**，且该 Spark 明确列出三个**待判明**互斥候选（补规则／增加巡检／明确仅为写入前置）。改写 §11 等于抢先在三个候选间作裁，故**本次未修改 §11**，只做 §12 的 20 号自有文本收口。该项按 `00 §4.4` 保持暂停，交还该 Spark 裁定。

### 计划步骤 5（测试与全量验证）— 已完成

`plugin` 全量 958/958 通过（较基线 946 新增 12 例）；`plugin/web` api 子集 367/367 通过；改动文件 eslint 干净（仓库既有 5 处 unused-import 报错不在改动面内，未处置，已如实登记）。

### 提交与复核

`26be321`（主体）与 `848c07b`（复核 F1/F2 措辞收紧）两笔受控提交，均经 precheck 与 Git Gate，trailer 由 Code 托管。

`01 §12` 独立对抗审核已执行（隔离会话），发现 D1（合并/拆分组合确认无组合级机械承载）、D2（§16 大改段自相矛盾）等已逐条处置：D1 在 §16 新增条件式承载限制如实披露；D2 改写为「不阻断且不得表述为阻断」；D3（dedup 未落盘）、D4（seam 解析无单测）已补 `spark-consent-seam.test.mjs` 9 例直接覆盖。后续独立复核对已提交版本复核，结论「可关闭」，其 2 项 LOW 措辞张力已由 `848c07b` 消除。

### 关闭前置未满足：复核条目未能机械落盘（本单保持 open）

`21 §10.2` 要求至少一条由**执行者之外会话**记录的复核条目。`record_review` 的子代理通道依赖 `deps.lookupChild` 返回宿主登记表条目，实测该登记表对本组合下的子代理**捕获为 0**（`ldvh_collect_subagent_results` 返回「Found 0 child record(s)」；另以专用探针子代理复现同一结果）。故本单**不执行关闭**，按 `21 §18` 交还 Human。

该缺口本身（子代理登记未捕获 DSH 子代理 → `32 §12` 默认的独立子代理复核形态当前不可用）属结构性未完善，与 open Spark `71930c4a` 同族，建议并入其归属判定。

### 记录更正（如实登记）

执行期曾以本会话身份调用一次 `record_review` 作**通道探测**，其 summary 自述「不构成复核结论」。该调用在只追加的 `reviews` 账本中留下一条**非复核条目**，会使计数虚高、误导读者。**本次更新撤回该条目**（撤回后 `reviews` 键省略）；撤回理由与事实记于本条流水，不在对象中静默消失。该更正**不改变 `status`**、**不新增复核凭据**，也不使本单满足关闭前置。

