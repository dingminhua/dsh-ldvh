---
title: WorkCase 残留与去向承载改法
status: implemented
question: 工单关闭后的 result.residual 与逐条去向应各由什么承载，才能让 WC 侧零待办可机械核验？
scope_boundary: 该组改法取得去向（落为 21 修订，或经 Human 判为不采纳）时停止。
intent: 让 WC 关闭后的残留与去向成为可机械核验的不变量，消除「去向自相矛盾、回指失焦」这类零校验地带；后续方向已经 Human 裁决并落地：改法逐条落为 21 修订（原文所引「21 §13 的 C1 提案」已更正为 §14 受控操作与 §17 Human Gate），并经 Human 授权直接执行、未走 WorkCase。
summary: |-
  议题源自调研 `research-35afd456`（「完成后遗留的处置机制」）。本对象处理的 `specs/21-WorkCase-工单.md` **残留**（`result.residual[]`）与**去向**（正文「结果」节建议段）机制**已落地**：Human 于 2026-09-28 裁决「A 收缩为二词」（原话记于 commit `3a32e63` 的 message），改法逐条落为 21 修订并由该提交落地到实现与呈现层；本对象据此转终态。

  **落地形态**：去向闭集由四词收缩为二词——`接受现状`（须非空理由）／`转入 Spark`；「转入 Spark」的指向由 `relations.routed-to` 承载（目标写入时必须为 `open`），**不再用 `refs`**——这即对先前 v2 第 9 条的实质更正（原设计「用 `refs` 绕过 20 §11 的 open 约束」经 Human 裁决否弃：去向须是可机械核验的不变量，故应落在受状态约束的关系位上）。建议段条数与 `result.residual` 长度相等升为机械门禁，顺序对应降为写法约定；执行次序 CREATE-FIRST 由 21 §14 与 §15.1 承载；存量对象不溯及（21 §15.3）。

  **实测基线（改动前）**：`ldvh-base/workcases/` 22 个对象中 `result.residual` 共 78 条，正文建议段 56 条，四词分布为「接受现状」26／「另立工单」19／「直接行动」10／「转入 Spark」1；`出自「…」` 尾注覆盖率 100%，回指的是 residual 条目的散文文字而非稳定标识，最长回指 70 字以上；去向原无任何机械校验。

  **实测暴露的四类缺陷**：①去向自相矛盾——有条目自称「接受现状」却在正文建议另立 WorkCase；②被回指对象本不该入残留——有条目回指的原文自称「非未完成事项」；③去向指向 Human 决定权——原四词无对应取值；④回指失去定位作用——建议正文的具体度常高于被回指条目。

  **存量后果与未验证范围（21 §15.3 已登记，不溯及）**：56 条重映射后 27 条（接受现状 26 + 转入 Spark 1）原样保留，其余 29 条（另立工单 19 + 直接行动 10）落「接受现状」但须逐条补写非空理由；6 份对象的建议段条数与 `residual` 不符；`workcase-8f4742f5` 是唯一含「转入 Spark」而无 `routed-to` 的对象，因 `correct` 不接收任何 frontmatter 字段，**这条边永远补不上**。机械层不回扫既有 closed 对象。

  **两处基础裂缝（已随本议题核对并更正）**：① `spark-2916e3d5` 实为 `discarded` 而非 open（原 summary 的「open Spark」限定词是错的），其 `split-into` 指向的两个对象均已终结（implemented／discarded），确违反 20 §11，已由 draft 工单 `bb033829` 承接；② 20 §16 的组合级确认入口尚无机械载体，故 CREATE-FIRST 须走多次单对象 Gate，实现会多问几次，按 00 §5.7 如实披露。
evolution:
  - at: 2026-09-28
    summary: Human 裁决「A 收缩为二词」后，本对象由「提案待裁」转为「已落地」：去向改为二词闭集、指向由 refs 改为 relations.routed-to、新增四档机械门禁与 CREATE-FIRST 次序，落为 21 §7/§8/§9.1/§10.2/§12/§13/§14/§15.1/§15.3/§15.4/§16 修订及实现与呈现层同步（commit 3a32e63）。同时更正本对象两处事实瑕疵：v2 第 9 条「用 refs 绕过 open 约束」的设计已被否弃；裂缝①的「open Spark 2916e3d5」限定词更正为其真实状态 discarded。
serves: SG-1
disposition: 已实现：残留与去向机制按 Human 裁决（2026-09-28「A 收缩为二词」）落地——去向闭集二词、routed-to 承载指向、四档机械门禁，见 commit 3a32e63（21 §7/§8/§9.1/§10.2/§12/§13/§14/§15.1/§15.3/§15.4/§16 与实现、呈现层）；存量 22 份不溯及。
object_uid: ce1db936-2ddc-4ed1-b059-f95def66e8ca
fact_type_key: spark
created_at: 2026-09-28T05:58:05.674Z
change_log:
  - at: 2026-09-28T05:58:05.674Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: C1 提案：WC 残留与去向承载改法（源自 research-35afd456 讨论收敛）
  - at: 2026-09-28T09:23:44.019Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 回收：机制已随 commit 3a32e63 落地，更正两处事实瑕疵并转终态
  - at: 2026-10-08T20:03:57.116Z
    provider: glm
    model: glm-5.3
    summary: 批次 F 旧号位引文更正：00 §7.2（Stop Conditions，创建时点号位）→00 §5.7（必停情形与恢复）1 处，摘要与正文同步；20/21 号位未重构，其引用保持原样；终态 implemented 与 disposition 不变，仅内容更正（20 §9.2）
refs:
  - object_uid: 35afd456-10cc-4d3b-b7fc-8a088946b183
  - object_uid: 71930c4a-f43f-439e-88bd-3aff7d07d37c
  - object_uid: 2916e3d5-cfdf-459b-90fb-e39b2523137f
  - object_uid: 46bf4c66-cd2a-4e45-ac88-53f9065ed876
  - object_uid: 4005b67b-8e06-4dc1-872e-04ab626de295
  - object_uid: bb033829-c28f-449e-915e-8656423900a8
  - object_uid: 63700bd2-f688-464b-b490-fc0c6ed78f25
---

# WorkCase 残留与去向承载改法

## 当前理解

议题源自调研 `research-35afd456`（「完成后遗留的处置机制」）。本对象处理的 `specs/21-WorkCase-工单.md` **残留**（`result.residual[]`）与**去向**（正文「结果」节建议段）机制**已落地**：Human 于 2026-09-28 裁决「A 收缩为二词」（原话记于 commit `3a32e63` 的 message），改法逐条落为 21 修订并由该提交落地到实现与呈现层；本对象据此转终态。

**落地形态**：去向闭集由四词收缩为二词——`接受现状`（须非空理由）／`转入 Spark`；「转入 Spark」的指向由 `relations.routed-to` 承载（目标写入时必须为 `open`），**不再用 `refs`**——这即对先前 v2 第 9 条的实质更正（原设计「用 `refs` 绕过 20 §11 的 open 约束」经 Human 裁决否弃：去向须是可机械核验的不变量，故应落在受状态约束的关系位上）。建议段条数与 `result.residual` 长度相等升为机械门禁，顺序对应降为写法约定；执行次序 CREATE-FIRST 由 21 §14 与 §15.1 承载；存量对象不溯及（21 §15.3）。

**实测基线（改动前）**：`ldvh-base/workcases/` 22 个对象中 `result.residual` 共 78 条，正文建议段 56 条，四词分布为「接受现状」26／「另立工单」19／「直接行动」10／「转入 Spark」1；`出自「…」` 尾注覆盖率 100%，回指的是 residual 条目的散文文字而非稳定标识，最长回指 70 字以上；去向原无任何机械校验。

**实测暴露的四类缺陷**：①去向自相矛盾——有条目自称「接受现状」却在正文建议另立 WorkCase；②被回指对象本不该入残留——有条目回指的原文自称「非未完成事项」；③去向指向 Human 决定权——原四词无对应取值；④回指失去定位作用——建议正文的具体度常高于被回指条目。

**存量后果与未验证范围（21 §15.3 已登记，不溯及）**：56 条重映射后 27 条（接受现状 26 + 转入 Spark 1）原样保留，其余 29 条（另立工单 19 + 直接行动 10）落「接受现状」但须逐条补写非空理由；6 份对象的建议段条数与 `residual` 不符；`workcase-8f4742f5` 是唯一含「转入 Spark」而无 `routed-to` 的对象，因 `correct` 不接收任何 frontmatter 字段，**这条边永远补不上**。机械层不回扫既有 closed 对象。

**两处基础裂缝（已随本议题核对并更正）**：① `spark-2916e3d5` 实为 `discarded` 而非 open（原 summary 的「open Spark」限定词是错的），其 `split-into` 指向的两个对象均已终结（implemented／discarded），确违反 20 §11，已由 draft 工单 `bb033829` 承接；② 20 §16 的组合级确认入口尚无机械载体，故 CREATE-FIRST 须走多次单对象 Gate，实现会多问几次，按 00 §5.7 如实披露。

## 调查问题

工单关闭后的 result.residual 与逐条去向应各由什么承载，才能让 WC 侧零待办可机械核验？

## 调查边界

该组改法取得去向（落为 21 修订，或经 Human 判为不采纳）时停止。

## 演变

- **2026-09-28**：Human 裁决「A 收缩为二词」后，本对象由「提案待裁」转为「已落地」：去向改为二词闭集、指向由 refs 改为 relations.routed-to、新增四档机械门禁与 CREATE-FIRST 次序，落为 21 §7/§8/§9.1/§10.2/§12/§13/§14/§15.1/§15.3/§15.4/§16 修订及实现与呈现层同步（commit 3a32e63）。同时更正本对象两处事实瑕疵：v2 第 9 条「用 refs 绕过 open 约束」的设计已被否弃；裂缝①的「open Spark 2916e3d5」限定词更正为其真实状态 discarded。
