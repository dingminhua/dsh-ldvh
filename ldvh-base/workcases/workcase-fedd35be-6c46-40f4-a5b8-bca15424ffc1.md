---
fact_type_key: workcase
object_uid: fedd35be-6c46-40f4-a5b8-bca15424ffc1
title: 受控写入拒绝的机械摩擦传感器
status: closed
gist: 给受控写入的拒绝补一条纯机械的摩擦出生传感器：同一原因码累计到 N=3 时向 11 §9 观察缓冲写 pending 条目，走既有晋升路径。不碰 Git Gate、不直接写摩擦账本。
summary: |-
  给受控写入的机械拒绝补一条纯机械的摩擦出生传感器：同一「类型前缀 + 具体原因码」的拒绝累计到 N=3 时，向 11 §9 的摩擦观察缓冲写入一条 `pending` 条目，走既有晋升路径成为 `open` 摩擦账目。

  ### 现状核实
  - 受控写入的拒绝原因码已存在且结构良好（`invalid_request`、`friction/frontmatter_invalid`、`spark/coherence_invalid`、`workcase/transition_invalid` 等，形态为「类型/具体原因」）
  - 但没有任何累加器：`plugin/lib` 内「拒绝原因码」「拒绝计数」零命中，每次拒绝即时报错、不累积
  - 11 §9 的摩擦发现双层机制完全依赖语义查重，26 §3.2 自己登记了「阈值误判」这一风险；本机制补的正是这个面，与语义查重互补而非替代

  ### 三条硬边界
  1. 不得直接写 Friction 账本（26 §9.2）——只能写 `pending` 缓冲条目
  2. 阈值沿用既有的 N=3，不得另定——引入第二个阈值会造成两套攒账口径互相矛盾
  3. `attribution` 必须随条目写入（11 §7.1 与 26 §6.2 的查重锚都依赖它）

  ### 一处语义陷阱
  `invalid_request` 占拒绝的绝对多数且混装十几种语义不同的失败，未必是摩擦。故 `group` 键必须细到「类型前缀 + 具体原因码」，不得以「全部 `invalid_request` 归一个 group」实现。
scope: |-
  做什么：
  - 新增拒绝计数模块（`group` 键 = 类型前缀 + 具体原因码）
  - 把 `ldvh_*_write` 系列的拒绝接入该模块
  - 达 N=3 时向 11 §9 观察缓冲写入 `pending` 条目，含 `attribution` 与 `group`
  - 补齐四项验收判据的单元测试

  明确不做什么：
  - 不修改 `26`、`11`、`02`、`09` 任何规范条文
  - 不触碰 `09 §5.5` 的 Git Gate 契约，不纳入 `validation/*`、`facts/*` 原因码
  - 不直接创建或流转 `open` Friction 账目（只写 `pending` 缓冲）
  - 不新增第二个阈值常量
  - 不修改 Web 呈现层
plan:
  - done_criteria: 模块导出可被单测直接调用的计数函数；`group` 键在给定「类型前缀 + 原因码」时产出确定值，且不同原因码产出不同键
    step: 新增拒绝计数模块（纯函数 + 存储接缝），含 `group` 键构造规则（类型前缀 + 原因码）
  - done_criteria: 构造一次受控写入拒绝，断言计数器对该 `group` 的记录数为 1，且不改变任何 Friction 账目
    step: 把受控写入通道的拒绝接入计数模块
  - done_criteria: 同一 `group` 第三次拒绝后，缓冲内出现一条 `pending` 条目，其 `pending_count` 为 3、携带 `attribution`，且 Friction 账目总数不变
    step: 实现达阈值时向观察缓冲写入 `pending` 条目（字段按 11 §12bis.1 闭集，含 `attribution` 与 `group`）
  - done_criteria: 四条断言全部为红→绿（先在无实现时失败，实现后通过）；测试覆盖「两个不同原因码不错误合并」与「条目可被既有晋升路径消费」两种情形
    step: 补齐四项验收判据的单元测试
result:
  achieved_scope: 未执行任何计划步骤；本工单在 Gate 1 之前的建前独立审核后即取消，未产生任何代码或规范改动
  criteria_checks:
    - evidence: 未开始执行——建前独立审核判 needs_revision 后即取消，无实现产物
      satisfied: false
    - evidence: 同上：拒绝计数模块未创建
      satisfied: false
    - evidence: 同上：未写入任何缓冲条目
      satisfied: false
    - evidence: 同上：未新增测试
      satisfied: false
  residual:
    - 同一目标改按 runlog 留痕形态重开，须先处理 silence-cleared 占满环形窗口的问题（实测 50 条中 49 条为该类、跨度 17 分钟）
    - 本工单 summary 曾误引「26 §3.2 登记阈值误判」，实际在 11 §1；该错引已登记，重开对象不得沿用
outcome: cancelled
created_at: 2026-11-04T13:10:27.954Z
change_log:
  - at: 2026-11-04T13:10:27.954Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 WorkCase 工单（draft，21 §14 C1 提案对象模式）
  - at: 2026-11-04T13:29:58.075Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 取消：建前独立审核判 needs_revision——步骤 3 在现行 11 下不可执行（缓冲写入者穷举、八个必填中五个须语义判断、group 不得机械产出、pending_count 判据不可构造）。改按 runlog 留痕形态重开。 [cancelled before execution; no Gate 1 approval existed]
---

# 受控写入拒绝的机械摩擦传感器

## 摘要

给受控写入的机械拒绝补一条纯机械的摩擦出生传感器：同一「类型前缀 + 具体原因码」的拒绝累计到 N=3 时，向 11 §9 的摩擦观察缓冲写入一条 `pending` 条目，走既有晋升路径成为 `open` 摩擦账目。

### 现状核实
- 受控写入的拒绝原因码已存在且结构良好（`invalid_request`、`friction/frontmatter_invalid`、`spark/coherence_invalid`、`workcase/transition_invalid` 等，形态为「类型/具体原因」）
- 但没有任何累加器：`plugin/lib` 内「拒绝原因码」「拒绝计数」零命中，每次拒绝即时报错、不累积
- 11 §9 的摩擦发现双层机制完全依赖语义查重，26 §3.2 自己登记了「阈值误判」这一风险；本机制补的正是这个面，与语义查重互补而非替代

### 三条硬边界
1. 不得直接写 Friction 账本（26 §9.2）——只能写 `pending` 缓冲条目
2. 阈值沿用既有的 N=3，不得另定——引入第二个阈值会造成两套攒账口径互相矛盾
3. `attribution` 必须随条目写入（11 §7.1 与 26 §6.2 的查重锚都依赖它）

### 一处语义陷阱
`invalid_request` 占拒绝的绝对多数且混装十几种语义不同的失败，未必是摩擦。故 `group` 键必须细到「类型前缀 + 具体原因码」，不得以「全部 `invalid_request` 归一个 group」实现。

## 授权范围

做什么：
- 新增拒绝计数模块（`group` 键 = 类型前缀 + 具体原因码）
- 把 `ldvh_*_write` 系列的拒绝接入该模块
- 达 N=3 时向 11 §9 观察缓冲写入 `pending` 条目，含 `attribution` 与 `group`
- 补齐四项验收判据的单元测试

明确不做什么：
- 不修改 `26`、`11`、`02`、`09` 任何规范条文
- 不触碰 `09 §5.5` 的 Git Gate 契约，不纳入 `validation/*`、`facts/*` 原因码
- 不直接创建或流转 `open` Friction 账目（只写 `pending` 缓冲）
- 不新增第二个阈值常量
- 不修改 Web 呈现层

## 计划

1. 新增拒绝计数模块（纯函数 + 存储接缝），含 `group` 键构造规则（类型前缀 + 原因码）
   - 完成判据：模块导出可被单测直接调用的计数函数；`group` 键在给定「类型前缀 + 原因码」时产出确定值，且不同原因码产出不同键
2. 把受控写入通道的拒绝接入计数模块
   - 完成判据：构造一次受控写入拒绝，断言计数器对该 `group` 的记录数为 1，且不改变任何 Friction 账目
3. 实现达阈值时向观察缓冲写入 `pending` 条目（字段按 11 §12bis.1 闭集，含 `attribution` 与 `group`）
   - 完成判据：同一 `group` 第三次拒绝后，缓冲内出现一条 `pending` 条目，其 `pending_count` 为 3、携带 `attribution`，且 Friction 账目总数不变
4. 补齐四项验收判据的单元测试
   - 完成判据：四条断言全部为红→绿（先在无实现时失败，实现后通过）；测试覆盖「两个不同原因码不错误合并」与「条目可被既有晋升路径消费」两种情形

## 结果

- 取消记录：
  - **理由**：建前独立审核判 `needs_revision`，其核心结论为步骤 3 在现行 `11` 下不可执行，四条依据均经主控复核原文属实：① `11` §12bis.1「写入与读取的纪律」第 1 条把缓冲写入者穷举为两个（捕获段追加条目、审核段结算状态），受控写入拒绝路径是第三个，不在枚举内，而 `scope` 明写不修改 `11`——二者不能同时成立；② `friction-observation-buffer.js` 的 `validateAppendInput` 强制八项非空，其中 `anchor`/`evidence`/`title`/`basis`/`attribution` 在 `11` §12bis.1 被明写为「执行体的语义判断产物」且禁止写「暂缺」，纯机械计数器拿不到也编不出；③ `group` 经 `11` 字段表明写「由 §9 第 1 项语义判定得出，机械层只做相等比较」，以「类型前缀 + 原因码」拼 `group` 等于让机械层替语义层做同源判定，且 `friction-review-promotion.js` 会取该组最新条目的 `title`/`basis`/`attribution` 直接建账；④ `11` §12bis.1 闭集无 count 类字段，`pending_count` 是 §7.1 的组投影字段，故「一条条目其 `pending_count` 为 3」不可构造。另本工单 `summary` 曾误引「`26 §3.2` 登记阈值误判」，实际在 `11` §1，`26` §3.2 反而是「本文不负责」且明写阈值由 `11 §9` 内嵌。
  - **未发生的范围**：未执行任何 `plan` 步骤（`draft` → `closed`，未经 Gate 1）；未触碰 `plugin/lib`、`plugin/test`、`specs/` 任何文件；未产生 Friction 账目或摩擦观察缓冲条目；四项 `done_criteria` 全部未开始。

### 后续去向

该机制**未废弃**，同一目标改按「`runlog` 留痕形态」重开：受控写入被拒时向 `~/.dsh/ldvh/idle-checkpoint-runs.json` 追加记录，由既有闲时任务在运行时读出、作为语义判断的**输入材料**，仍由执行体按 `11 §9` 第 2 项写缓冲。该形态不新增缓冲写入者、不新增自动动作、机械层不产出 `group`，故避开上述四项不可执行性。重开前须先处理 `runlog` 环形窗口被 `silence-cleared` 诊断占满的问题——实测 50 条中 49 条为该类、时间跨度仅 17 分钟。

