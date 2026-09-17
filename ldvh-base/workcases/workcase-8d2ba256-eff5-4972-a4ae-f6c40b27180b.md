---
fact_type_key: workcase
object_uid: 8d2ba256-eff5-4972-a4ae-f6c40b27180b
title: C2 授权校验与 rebatch×reviews 处置
status: open
serves: SG-3
summary: 补上 WorkCase 授权钉扎（C2）在实现层的缺口与 `rebatch` 对 Code
  托管字段的处置缺陷，使「授权指纹失效」被机械检测、且重批（rebatch）对 `reviews`/`change_log`
  的处置自洽。本单合并三处经对抗审核与起草者亲验确认的既有缺陷（均先于 E4 存在，由 E4 暴露）：缺口 A（C2 授权校验在实现中不存在）：21:281
  要求指纹不一致即授权失效，但 `authorization_fingerprint`
  在实现中仅被计算（`:923`）与形状校验（`:278`），从无比对；`rebatch` 全文无 fingerprint 校验；后果是 `open
  --rebatch--> draft --cancel--> closed` 可绕过关闭门禁。缺口 B（rebatch 与 reviews
  冲突）：21:176 要求重批保留 `reviews`，而 writer:472 禁止 draft 携带 `reviews`、`rebatch` 结果恰为
  draft，二者不可调和；`rebatch` 从未提及 `reviews`，而 writer 注释 `:469`
  却写「重批回退时保留」——注释与代码矛盾，属实现漏做。缺口 C（rebatch 的 change_log 可被调用方注入）：`rebatch` 取
  `structuredClone(stripCallerOnlyFields(frontmatterAfter))` 的 `change_log`，未比照
  `execute`/`revise` 锁定为 `fm.change_log`；起草者实测传入伪造条目即清空对象全部审计历史，违反 21 §8 / 03
  §9.5 的权威流水纪律。
scope: 做什么：(A) 在实现层补上 21:281 要求的 C2 校验——校验 `gate_1.authorization_fingerprint`
  与当前 `plan`+`scope` 不一致时按规范处置（授权失效并生成局部重批待办），覆盖 `rebatch` 与 `approve` 等适用路径；(B)
  使 `rebatch` 对 `reviews` 的处置显式且自洽——采第三方向：`rebatch` 显式作废 `reviews` 并把其要点写入
  `change_log`（与 §9.2 对 `criteria_checks` 的既有处置同形），同时把 `21:176`
  的「保留原值」改为「保留其历史要点于 `change_log`」；(C) 补相应行为测试（不用正则断源码）；(D) **锁定 `rebatch` 的
  Code 托管字段**——`rebatch` 现取调用方 payload 的 `change_log`（实测可注入伪造条目并清空全部审计历史），须比照
  `execute`/`revise` 显式锁定为 `fm.change_log`，使调用方无法改写审计流水。明确不做什么：不改 E4
  门禁本身（已实施并生效）；不新增任何字段；不改 `plan`/`scope` 形状（不触发 C2）；不改 02/03/06 号规范；不处理
  §6.4.3（独立性，已判定为审核误报）；不处理存量 `open` 工单的复核补录（属另一议题）。
plan:
  - step: 核实 C2 缺口的确切范围与适用路径
    done_criteria: 列出全部 7 个 action 中哪些涉及 authorization_fingerprint 比对，以及 21:281
      要求比对而实现未比对的确切位置，文件:行号可查
  - step: 补 C2 校验并处置授权失效路径
    done_criteria: 存在可机械判定的校验（重批时新指纹必须不等于 gate_1 存储指纹，否则拒绝）；open --rebatch--> draft
      --cancel--> closed 的绕过路径被测例覆盖并阻断
  - step: 消解 rebatch 与 Code 托管字段的冲突（reviews 处置 + change_log 锁定）
    done_criteria: rebatch 对 reviews 的处置显式（作废 + 要点入 change_log），21:176
      文本与实现一致；rebatch 显式锁定 change_log 为 fm.change_log，调用方注入的伪造条目被丢弃；两者均有行为测试断言
  - step: 验证三件套与受控提交
    done_criteria: writer 测试全绿、web 测试全绿、tsc 0 错误、eslint 无新增；受控提交且 Git Gate passed
gate_1:
  approved_at: 2026-09-17T08:00:20.335Z
  approver: Human
  authorization_fingerprint: 7041fb33427d604cd66915c9f421b1ef0762f2b7a542ddde538c4a45cc297929
  scope_snapshot: 做什么：(A) 在实现层补上 21:281 要求的 C2 校验——校验
    `gate_1.authorization_fingerprint` 与当前 `plan`+`scope`
    不一致时按规范处置（授权失效并生成局部重批待办），覆盖 `rebatch` 与 `approve` 等适用路径；(B) 使 `rebatch` 对
    `reviews` 的处置显式且自洽——采第三方向：`rebatch` 显式作废 `reviews` 并把其要点写入 `change_log`（与
    §9.2 对 `criteria_checks` 的既有处置同形），同时把 `21:176` 的「保留原值」改为「保留其历史要点于
    `change_log`」；(C) 补相应行为测试（不用正则断源码）；(D) **锁定 `rebatch` 的 Code
    托管字段**——`rebatch` 现取调用方 payload 的 `change_log`（实测可注入伪造条目并清空全部审计历史），须比照
    `execute`/`revise` 显式锁定为 `fm.change_log`，使调用方无法改写审计流水。明确不做什么：不改 E4
    门禁本身（已实施并生效）；不新增任何字段；不改 `plan`/`scope` 形状（不触发 C2）；不改 02/03/06 号规范；不处理
    §6.4.3（独立性，已判定为审核误报）；不处理存量 `open` 工单的复核补录（属另一议题）。
attempt:
  attempt_id: 2
  started_at: 2026-09-17T08:00:20.335Z
  controller: deepseek-v4.1-flash@dsh-ldvh-session
  heartbeat_at: 2026-09-17T08:00:20.335Z
created_at: 2026-09-17T06:51:23.939Z
change_log:
  - at: 2026-09-17T07:59:50.891Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: C2 局部重批：扩围纳入缺口 C（rebatch 的 change_log 可被调用方注入，实测可清空审计历史）——起草者在步骤 1
      核实中实测发现该漏洞，经 Human 批准纳入；scope 增列 (D) 锁定 Code 托管字段，摘要与计划同步更新为三处缺口 [C2 局部重批
      open→draft; attempt 1 voided, gate_1 dropped — 重新组织后重走 Gate 1]
  - at: 2026-09-17T08:00:20.335Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: Gate 1 重新批准（C2 局部重批后）——Human 确认扩围纳入缺口 C（rebatch 的 change_log
      可被调用方注入）；授权指纹重新绑定扩围后的 plan+scope，范围增至三处缺口 [gate_1 approved by Human;
      attempt 2 allocated to deepseek-v4.1-flash@dsh-ldvh-session]
---

# C2 授权校验与 rebatch×reviews 处置

## 摘要

补上 WorkCase 授权钉扎（C2）在实现层的缺口与 `rebatch` 对 Code 托管字段的处置缺陷，使「授权指纹失效」被机械检测、且重批（rebatch）对 `reviews`/`change_log` 的处置自洽。本单合并三处经对抗审核与起草者亲验确认的既有缺陷（均先于 E4 存在，由 E4 暴露）：缺口 A（C2 授权校验在实现中不存在）：21:281 要求指纹不一致即授权失效，但 `authorization_fingerprint` 在实现中仅被计算（`:923`）与形状校验（`:278`），从无比对；`rebatch` 全文无 fingerprint 校验；后果是 `open --rebatch--> draft --cancel--> closed` 可绕过关闭门禁。缺口 B（rebatch 与 reviews 冲突）：21:176 要求重批保留 `reviews`，而 writer:472 禁止 draft 携带 `reviews`、`rebatch` 结果恰为 draft，二者不可调和；`rebatch` 从未提及 `reviews`，而 writer 注释 `:469` 却写「重批回退时保留」——注释与代码矛盾，属实现漏做。缺口 C（rebatch 的 change_log 可被调用方注入）：`rebatch` 取 `structuredClone(stripCallerOnlyFields(frontmatterAfter))` 的 `change_log`，未比照 `execute`/`revise` 锁定为 `fm.change_log`；起草者实测传入伪造条目即清空对象全部审计历史，违反 21 §8 / 03 §9.5 的权威流水纪律。

## 授权范围

做什么：(A) 在实现层补上 21:281 要求的 C2 校验——校验 `gate_1.authorization_fingerprint` 与当前 `plan`+`scope` 不一致时按规范处置（授权失效并生成局部重批待办），覆盖 `rebatch` 与 `approve` 等适用路径；(B) 使 `rebatch` 对 `reviews` 的处置显式且自洽——采第三方向：`rebatch` 显式作废 `reviews` 并把其要点写入 `change_log`（与 §9.2 对 `criteria_checks` 的既有处置同形），同时把 `21:176` 的「保留原值」改为「保留其历史要点于 `change_log`」；(C) 补相应行为测试（不用正则断源码）；(D) **锁定 `rebatch` 的 Code 托管字段**——`rebatch` 现取调用方 payload 的 `change_log`（实测可注入伪造条目并清空全部审计历史），须比照 `execute`/`revise` 显式锁定为 `fm.change_log`，使调用方无法改写审计流水。明确不做什么：不改 E4 门禁本身（已实施并生效）；不新增任何字段；不改 `plan`/`scope` 形状（不触发 C2）；不改 02/03/06 号规范；不处理 §6.4.3（独立性，已判定为审核误报）；不处理存量 `open` 工单的复核补录（属另一议题）。

## 计划

- 核实 C2 缺口的确切范围与适用路径：判据——列出全部 7 个 action 中哪些涉及 `authorization_fingerprint` 比对，以及 21:281 要求比对而实现未比对的确切位置，文件:行号可查
- 补 C2 校验并处置授权失效路径：判据——存在可机械判定的校验（重批时新指纹必须不等于 `gate_1` 存储指纹，否则拒绝）；`open --rebatch--> draft --cancel--> closed` 的绕过路径被测例覆盖并阻断
- 消解 rebatch 与 Code 托管字段的冲突（reviews 处置 + change_log 锁定）：判据——`rebatch` 对 `reviews` 的处置显式（作废 + 要点入 change_log），21:176 文本与实现一致；`rebatch` 显式锁定 `change_log` 为 `fm.change_log`，调用方注入的伪造条目被丢弃；两者均有行为测试断言
- 验证三件套与受控提交：判据——writer 测试全绿、web 测试全绿、tsc 0 错误、eslint 无新增；受控提交且 Git Gate passed

## 执行

- attempt 2 started at 2026-09-17T08:00:20.335Z (controller: deepseek-v4.1-flash@dsh-ldvh-session)；Gate 1 授权范围见 gate_1.scope_snapshot。

