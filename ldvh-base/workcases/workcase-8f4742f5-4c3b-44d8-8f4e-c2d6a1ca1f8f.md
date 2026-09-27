---
fact_type_key: workcase
object_uid: 8f4742f5-4c3b-44d8-8f4e-c2d6a1ca1f8f
title: Spark 授权门禁与 20 号一致性修复
status: closed
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
reviews:
  - at: 2026-09-27T02:10:46.690Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    session_id: 76c219c7-93cd-46c4-8924-5f4a225d7e34
    session_source: host
    implementer_session_id: session-71ad5a69-4bde-4290-acb3-96e92e787a8b
    implementer_session_source: host
    summary: |-
      复核完成，结果已回传父会话。

      **核心结论**：a9b70df 声称的三处缺陷全部真实、修复有效，973/973 与变异声明全部属实（基线 971 经导出副本实测确认）。发现的问题：P1 `snapshotEvents()` 新增生产调用违反 DSH 弃用政策（中）、P2 `events` 回落分支仅为假形状 fixture 服务（中低）、P3 `RETIRED_LIMIT=50` + 插件重载清空使 record_review 可静默失效（中，先前已存在）。工作区完整性已验证：`plugin/` 与提交逐字节一致，五组变异全部还原。
  - at: 2026-09-27T03:29:26.162Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    session_id: 5c1b05e9-9f9b-477a-a661-1816d75b3717
    session_source: host
    implementer_session_id: session-71ad5a69-4bde-4290-acb3-96e92e787a8b
    implementer_session_source: host
    summary: |-
      **发现的问题**：P1 终态路径询问先于 writer 余项校验（我以 /tmp 探针实测非法 relation_key／disposition 240 字符／serves=SG-99 三种 doomed 写入**各消耗 1 次提问**，仍零写入；代码注释 `:482-487` 的「Every cheap refusal must precede the ask」不成立）——中；P2 记录称「基线 946 新增 12」不可复现（实测 935→958，+23）——低；P3 账本唯一复核条目（76c219c7）针对 a9b70df 而非本 5 笔提交，以其作关闭依据属对象错配——中低。

      **未覆盖**：09 §5 三向变异、D1–D4 原始审核记录、Git Gate 实跑、宿主答题器活体可用性、合并/拆分组合级行为、web 构建与 tsc；另需注意工作树存在其它会话的未提交改动（`workcase-writer.js`、`probe-tmp-review.mts` 等，非我产生），我的 976 全量数取自该工作树，不可归因于被复核提交。
result:
  criteria_checks:
    - evidence: requestSparkConsent 于 plugin/lib/host-seams.js:516 定义、:574 导出；无答题器／询问失败／未作选择／答案 id 不符／多选五条路径一律 fail-closed 且转发 caller signal；直接单测 test/spark-consent-seam.test.mjs 9 例覆盖，三组变异（fail-open、去呈报强制、放宽多选）均被捕获。
      satisfied: true
    - evidence: "descriptor 工厂改为 operation.awaitsHumanDecision === true ? {} : { timeoutMs: 30000 }，实测描述符不再含 timeoutMs 而读取类工具仍为 30000；plugin/lib/spark-tools.js 有 5 处 awaitsHumanDecision 消费点，创建与终态转换在写入前取确认、未取得即 rejected；变异（仅加 flag 而恢复硬编码超时）使 descriptor: awaitsHumanDecision is consumed 用例失败。"
      satisfied: true
    - evidence: sparkBoundaryDelta 随 envelope 的 boundary_delta 交还 question/scope_boundary 的现值与拟改值对照，不阻断、不发起询问、不代为判定，两字段未变时省略该字段。
      satisfied: true
    - evidence: §16 授权取得与承载、§13 三条受控操作、§14.1/§15 机械校验项、§17.4 扩写、§12 消费点收口与失效引用更正（§8 行注改指 03 §15 第 9 条、31 号 §10.2 改指 §9）均已落定；01 §12 独立对抗审核发现的 D1–D4 已逐条处置，后续复核对已提交版本结论为「可关闭」。未执行项：授权内的「收口 §11 关系 open 约束的表述」按 00 §4.4 保持暂停——该项已由 open Spark 71930c4a 缺口二承载，且该 Spark 列出补规则／增加巡检／明确仅为写入前置三个互斥待判候选，改写 §11 等于抢先裁定；执行节已如实登记该范围偏差。故本项判部分达成。
      satisfied: false
    - evidence: 执行期实测 plugin 958/958、plugin/web api 367/367、改动文件 eslint 干净（仓库既有 5 处 unused-import 报错不在改动面内，已如实登记）；复核期复测 plugin 986/986 全绿、tsc -b --pretty false exit 0；因 fail-closed 受影响的既有用例修复情况与「原记基线 946／新增 12 不可复现，隔离副本实测 935→958、净增 23」已在执行节更正登记。
      satisfied: true
  achieved_scope: Spark 创建与终态转换已有可回读的机械授权门禁（五条失败路径 fail-closed、flag 经变异验证被真实消费、终态注定失败的写入不再消耗提问）；大改弱约束按 09 §6 交还现值与拟改值对照而不阻断；specs/20 的 §16/§13/§15/§17 承载条款落定，§8 行注与 31 号节号引用更正，§12 消费点收口；两笔受控提交 26be321、848c07b 经 precheck 与 Git Gate；01 §12 独立对抗审核与两条关闭前独立复核条目（76c219c7、5c1b05e9，两端身份均 host 且可比对）均已落盘。
  residual:
    - §11 关系 open 约束的表述未由本单收口——该事项已由 open Spark 71930c4a 的缺口二及其三个互斥待判候选举承载，按 00 §4.4 保持暂停
    - 复核条目 76c219c7 的 P3 所记风险未处置：plugin/lib/child.js:37 的 RETIRED_LIMIT 淘汰与插件重载清空叠加，可使委托链登记表索引中的结论变得不可回读（本单 reviews 账本不受该上限影响，风险限于委托链索引）
    - 执行节原记「基线 946／新增 12」不可复现（隔离副本实测 935→958，净增 23）；提交 26be321 信息中「含新增 47 项」易被读作净新增。两处均属已发出的历史记录，只能更正、不能回改
outcome: partial
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
  - at: 2026-09-27T02:10:46.690Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "记录独立复核（隔离子代理 76c219c7）：a9b70df 三处缺陷均真实且修复有效；973/973 与变异声明属实；发现 P1 弃用 API 无 lint 守卫、P2 events 回落仅供旧假形状 fixture、P3 RETIRED_LIMIT 淘汰可致归属静默失效 [review recorded by session 76c219c7-93cd-46c4-8924-5f4a225d7e34; reviews entries: 1; 记录自子代理会话 76c219c7-93cd-46c4-8924-5f4a225d7e34 的最终产出（Code 捕获）]"
  - at: 2026-09-27T03:29:26.162Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "记录独立复核（隔离子代理 5c1b05e9，覆盖本单授权的 5 笔提交）：三项 Gate 机械承载与创建路径先校验后询问成立、§11 未越权修改、两项披露声明属实；发现 P1 终态路径次序缺口、P2 记录数字不可复现、P3 账本原有条目对象错配 [review recorded by session 5c1b05e9-9f9b-477a-a661-1816d75b3717; reviews entries: 2; 记录自子代理会话 5c1b05e9-9f9b-477a-a661-1816d75b3717 的最终产出（Code 捕获）]"
  - at: 2026-09-27T03:31:40.962Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 更正计划步骤 5 的测试计数（据 26be321 独立复核 P2：基线实测 935、26be321 = 958，净增 23；原写「较基线 946 新增 12」不可复现），并将「关闭前置未满足」一节更正为「复核条目已落盘」——子代理通道根因已查明修复、两条独立复核条目在账、P1/P3 已处置 [attempt 1 heartbeat refreshed]
  - at: 2026-09-27T13:04:43.314Z
    provider: deepseek-account
    model: deepseek-flash
    summary: Gate 2 关闭：outcome=partial —— 五项判据四项达成，第 4 项含一处按 00 §4.4 交还 open Spark 71930c4a 裁定的未执行事项 [gate_2 closed with outcome=partial; attempt 1 retracted]
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

`plugin` 全量 958/958 通过；`plugin/web` api 子集 367/367 通过；改动文件 eslint 干净（仓库既有 5 处 unused-import 报错不在改动面内，未处置，已如实登记）。

**更正（2026-09-27，据 26be321 独立复核的 P2）**：本行原写「较基线 946 新增 12 例」，该数字**不可复现**。以隔离副本（worktree + node_modules 软链）实测：`26be321^`（b6550ef）为 **935/935**，`26be321` 为 **958/958**，即净增 **23** 例；原写的 946／12 无出处，系记录失实。另：26be321 提交信息中「含新增 47 项」指的是该次改动两文件的用例总数（spark-tools 38 + spark-consent-seam 9），**不是净新增数**——措辞易致误读，一并更正。

### 提交与复核

`26be321`（主体）与 `848c07b`（复核 F1/F2 措辞收紧）两笔受控提交，均经 precheck 与 Git Gate，trailer 由 Code 托管。

`01 §12` 独立对抗审核已执行（隔离会话），发现 D1（合并/拆分组合确认无组合级机械承载）、D2（§16 大改段自相矛盾）等已逐条处置：D1 在 §16 新增条件式承载限制如实披露；D2 改写为「不阻断且不得表述为阻断」；D3（dedup 未落盘）、D4（seam 解析无单测）已补 `spark-consent-seam.test.mjs` 9 例直接覆盖。后续独立复核对已提交版本复核，结论「可关闭」，其 2 项 LOW 措辞张力已由 `848c07b` 消除。

### 关闭前置：复核条目已落盘（2026-09-27）

`21 §10.2` 要求至少一条由**执行者之外会话**记录的复核条目。执行期本单曾因此保持 open——当时 `record_review` 的子代理通道取不到结论（`ldvh_collect_subagent_results` 返回「Found 0 child record(s)」）。

**该现象已查明并修复，其根因并非「登记表未捕获子代理」**（该判断经复测推翻）：登记表**确实捕获**了运行中的子代理（`Found 1`），真正断在**结论捕获永不生效**——`plugin/lib/child.js` 原读 `agent.session?.events`，而 DSH 的 Session **无 `events` 属性**（只有 `snapshotEvents()` 方法）。修复见 `a9b70df` / `a7a5cfb`（后者另按 DSH README 的弃用政策改为事件累积，不新增弃用 API 的生产调用）。

修复后本单已落盘**两条**独立复核条目（均为隔离子代理、`session_id ≠ implementer_session_id` 且两端 `session_source=host`）：
- `76c219c7`：审 `a9b70df`（委托链修复）；
- `5c1b05e9`：审**本单授权的 5 笔提交**（26be321/848c07b/9c7ccd9/aa9b008/bd55519），即此前 P3 所指的对象错配已由该条补正。

其发现的三项已逐条处置：**P1**（终态路径询问先于 writer 余项校验）已修——`updateSparkObject` 新增 `dryRun`，终态转换在提问前先跑；实测三种注定失败的终态写入由「各消耗 1 次提问」变为 **0**，回归用例已加（提交 `102b9ff`）。**P2**（本记录「基线 946 新增 12」不可复现）已在本节更正为实测值。**P3**（对象错配）已由上述第二条补正。

故本单现**具备关闭前置**；是否关闭属 Gate 2，由 Human 决定。

### 记录更正（如实登记）

执行期曾以本会话身份调用一次 `record_review` 作**通道探测**，其 summary 自述「不构成复核结论」。该调用在只追加的 `reviews` 账本中留下一条**非复核条目**，会使计数虚高、误导读者。**该非复核条目已于 2026-09-26 的受控更新中撤回**（当时 `reviews` 键省略）；撤回理由与事实记于 change_log，未在对象中静默消失。该更正**不改变 `status`**、**不新增复核凭据**，也不使本单满足关闭前置。

## 结果

### Gate 2 提请

- 逐条核对结论见下 `criteria_checks`；已证实范围见 `achieved_scope`；残留风险与逐条去向见 `residual` 与 `advice`。
- 未证实范围：未运行浏览器实机渲染；未对 specs/20 修订文本与 01 §12 审核记录做逐字复核以外的旁证；存量 45 个 Spark 按 Human 决定不后补凭据，其授权状态仍无可回读的机械凭据。
- 建议 outcome：**partial**。授权内五项中四项达成，第四项含一处按 00 §4.4 未执行并已交还 open Spark 裁定的事项，依据见第 4 条。

- criteria_checks:
  - 步骤 1 判据「host-seams.js 导出该函数；无答题器、询问失败、未作选择三种路径均返回未授予；signal 被转发；测试覆盖三种失败路径」：**达成**。`requestSparkConsent` 于 plugin/lib/host-seams.js:516 定义、:574 导出；无答题器／询问失败／未作选择／答案 id 不符／多选五条路径一律 fail-closed 且转发 caller signal；直接单测 `test/spark-consent-seam.test.mjs` 9 例覆盖，三组变异（fail-open、去呈报强制、放宽多选）均被捕获。
  - 步骤 2 判据「OPERATIONS 的 spark-write-object 声明该 flag；toolDescriptorFor 对该 flag 不设 timeout；创建与转终态在未取得确认时返回 rejected；变异验证可证 flag 被真实消费（仅加 flag 而超时仍硬编码时应有测试失败）」：**达成**。descriptor 工厂改为 `...operation.awaitsHumanDecision === true ? {} : { timeoutMs: 30000 }`，实测描述符不再含 timeoutMs 而读取类工具仍为 30000；plugin/lib/spark-tools.js 有 5 处 awaitsHumanDecision 消费点，创建与终态转换未取得确认即 rejected；变异（仅加 flag 而恢复硬编码超时）使 `descriptor: awaitsHumanDecision is consumed` 用例失败。
  - 步骤 3 判据「question/scope_boundary 变化时 envelope 含现值与拟改值对照，且该对照不阻断更新」：**达成**。`sparkBoundaryDelta` 随 envelope 的 `boundary_delta` 交还现值与拟改值对照，不阻断、不发起询问、不代为判定，两字段未变时省略该字段。
  - 步骤 4 判据「§16/§13/§15/§17 授权承载条款落定；§8 行注改正；§5/§12 节号修正；§11/§12 收口成立；独立对抗审核完成并逐条处置」：**部分达成**。§16 授权取得与承载、§13 三条受控操作、§14.1/§15 机械校验项、§17.4 扩写、§12 消费点收口与失效引用更正（§8 行注改指 03 §15 第 9 条、31 号 §10.2 改指 §9）均已落定；01 §12 独立对抗审核的 D1–D4 已逐条处置，后续复核对已提交版本结论为「可关闭」。未执行项：授权内的「收口 §11 关系 open 约束的表述」按 00 §4.4 保持暂停——该项已由 open Spark 71930c4a 缺口二承载，且该 Spark 列出补规则／增加巡检／明确仅为写入前置三个互斥待判候选，改写 §11 等于抢先裁定；执行节已如实登记该范围偏差。故本项判部分达成。
  - 步骤 5 判据「plugin 全量测试与 tsc 通过；因 fail-closed 受影响的既有用例被同步修复，实际受影响数与修复结果如实登记」：**达成**。执行期实测 plugin 958/958、plugin/web api 367/367、改动文件 eslint 干净（仓库既有 5 处 unused-import 报错不在改动面内，已如实登记）；复核期复测 plugin 986/986 全绿、`tsc -b --pretty false` exit 0；受影响用例的修复情况与「原记基线 946／新增 12 不可复现，隔离副本实测 935→958、净增 23」已在执行节更正登记。

- achieved_scope: Spark 创建与终态转换已有可回读的机械授权门禁（五条失败路径 fail-closed、flag 经变异验证被真实消费、终态注定失败的写入不再消耗提问）；大改弱约束按 09 §6 交还现值与拟改值对照而不阻断；specs/20 的 §16/§13/§15/§17 承载条款落定，§8 行注与 31 号节号引用更正，§12 消费点收口；两笔受控提交 26be321、848c07b 经 precheck 与 Git Gate；01 §12 独立对抗审核与两条关闭前独立复核条目（76c219c7、5c1b05e9，两端身份均 host 且可比对）均已落盘。

- residual:
  - §11 关系 open 约束的表述未由本单收口——该事项已由 open Spark 71930c4a 的缺口二及其三个互斥待判候选举承载，按 00 §4.4 保持暂停
  - 复核条目 76c219c7 的 P3 所记风险未处置：plugin/lib/child.js:37 的 RETIRED_LIMIT 淘汰与插件重载清空叠加，可使委托链登记表索引中的结论变得不可回读（本单 reviews 账本不受该上限影响，风险限于委托链索引）
  - 执行节原记「基线 946／新增 12」不可复现（隔离副本实测 935→958，净增 23）；提交 26be321 信息中「含新增 47 项」易被读作净新增。两处均属已发出的历史记录，只能更正、不能回改

- advice:
  - **转入 Spark**：方向未定的事项交由其承载对象裁定，本单不代为取舍出自「§11 关系 open 约束的表述未由本单收口」
  - **另立工单**：为委托链登记表的淘汰与重载清空叠加上限补一条可证守护，或明确该路径不可达出自「复核 P3 所记风险未处置」
  - **接受现状**：历史提交信息与当时计数既不可改写也不影响后续判读，保持原样并在本结果节保留更正依据出自「原记计数不可复现、提交措辞歧义」

