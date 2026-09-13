---
title: dimensions 七元组表达力缺口
status: open
question: "`dimensions` 七元组闭集是否应扩维以表达六业务系统（尤其「工作执行」与「目标与蓝图」）？"
scope_boundary: Human 就「扩维」「维持并另设映射」或「明确 dimensions 不按系统划分」作出裁定，且选定的处置在 00 身份块、`01.Att.02` 与 `plugin/lib/spec-registry.js` 三处同步完成、机械校验通过时停止。
intent: 保留理由——维度闭集是机械强制的，四份待建业务系统规范（32–35）中至少两份无维度可声明，会阻断其身份块通过校验；且现有实例已现摩擦（30/31 只能单维、04 只能全列）。后续方向——需 Human 判定扩维（含新维度命名与根规范影响面），或明确 dimensions 不承担「按系统划分」职责。
summary: "`plugin/lib/spec-registry.js:24` 机械强制 `dimensions` 为七元组闭集 `[read,write,orchestrate,memory,research,discussion,comply]`，无法表达 `00 §3.1` 六系统里的「工作执行」与「目标与蓝图」。现有实例：30 用 research、31 用 discussion，04 只能全列七维。四份待建业务系统规范（32–35）中至少两份将无维度可用。原登记于 `docs/pending-human-decisions-2026-09-11.md` 非阻塞待办 N-2，改动需跨 00 身份块＋`01.Att.02`＋Code。"
serves: SG-1
priority: P2
object_uid: bdb9623d-bc34-4cc7-aed7-27d69f382c31
fact_type_key: spark
created_at: 2026-09-13T08:00:46.231Z
change_log:
  - at: 2026-09-13T08:00:46.231Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Spark 对象
  - at: 2026-09-13T08:02:36.730Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补记拆分来源：本对象由 2916e3d5 经 20 §9.4 情形二拆分承接 N-2（20 §9.4 第三步来源流水）
  - at: 2026-09-13T15:08:54.055Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 回填 priority=P2（20 §8 新增字段，Human 裁定 A；AI 出初值，Human 可随时调整）
---

# dimensions 七元组表达力缺口

## 当前理解

`plugin/lib/spec-registry.js:24` 机械强制 `dimensions` 为七元组闭集 `[read,write,orchestrate,memory,research,discussion,comply]`，无法表达 `00 §3.1` 六系统里的「工作执行」与「目标与蓝图」。现有实例：30 用 research、31 用 discussion，04 只能全列七维。四份待建业务系统规范（32–35）中至少两份将无维度可用。原登记于 `docs/pending-human-decisions-2026-09-11.md` 非阻塞待办 N-2，改动需跨 00 身份块＋`01.Att.02`＋Code。

具体机制：`plugin/lib/spec-registry.js` 第 103 行拒绝闭集外成员，第 171 行还要求根规范必须按规范序声明全部七维。`memory` 只对应「记忆与反思」，`comply` 只对应「规则遵守」，故「工作执行」与「目标与蓝图」确无对应维度。

**来源**：本对象由 `2916e3d5-cfdf-459b-90fb-e39b2523137f`（30–38 段编号与六业务系统承载）经 `20 §9.4` 情形二拆分而来——原对象收口时把 N-1、N-2 两项真实剩余拆为独立 Spark，本对象承接其中 N-2。

## 调查问题

`dimensions` 七元组闭集是否应扩维以表达六业务系统（尤其「工作执行」与「目标与蓝图」）？

## 调查边界

Human 就「扩维」「维持并另设映射」或「明确 dimensions 不按系统划分」作出裁定，且选定的处置在 00 身份块、`01.Att.02` 与 `plugin/lib/spec-registry.js` 三处同步完成、机械校验通过时停止。
