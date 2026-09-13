---
title: dimensions 七元组表达力缺口
status: discarded
question: "`dimensions` 七元组闭集是否应扩维以表达六业务系统（尤其「工作执行」与「目标与蓝图」）？"
scope_boundary: Human 就「扩维」「维持并另设映射」或「明确 dimensions 不按系统划分」作出裁定，且选定的处置在 00 身份块、`01.Att.02` 与 `plugin/lib/spec-registry.js` 三处同步完成、机械校验通过时停止。
intent: "保留理由（已失效）——原判断「32–35 中至少两份无维度可声明，会阻断其身份块通过校验」不成立：`01.Att.02 §4` 定普通规范 `dimensions` 为可选，§2 又定该字段为能力轴而非业务系统镜像，无维度可声明时省略该字段即合法通过校验；`spec-registry.js` 的 `required: true` 仅对 isRoot 生效。后续方向——无；停止条件由既有规范源而非 Human 新裁定满足，不产生承接目标，不再重开（20 §9.2 终态不可重开）。"
summary: "本对象已收口关闭，不再以原形态跟踪。三条前提经核查全部不成立：(1) `01.Att.02 §2`（2026-09-11 `80ea2e0` 写入，已是 HEAD 祖先，早于本对象创建两天）已裁定 `dimensions` 是能力层标签词表、能力轴，不是业务系统的镜像或枚举，不逐一对应业务系统是预期而非缺漏；(2) §4 定普通规范 `dimensions` 为「可选；若出现必须非空」，仅要求正文实质承担的维度必须声明，是单向下限，无维度可声明时省略即合法通过，故 32–35 不构成「阻断」，且 `plugin/lib/spec-registry.js` 的 `required: true` 分支仅对 isRoot 生效；(3) 系统专属规范的承载对象 21 WorkCase（write/orchestrate/comply）与 25 Goal（comply）均未依赖扩维即通过校验，04 全列七维是其横跨六系统共同骨架的如实声明而非被迫填满。信息需求已由既有规范源完整承接，无残余责任，不设承接目标。"
serves: SG-1
disposition: 前提已由 80ea2e0（2026-09-11）推翻：01.Att.02 §2 裁定 dimensions 为能力轴、非业务系统镜像，不逐一对应系统是预期而非缺漏；§4 又定该字段可选，故 32–35 无维度可声明时省略即通过校验，无阻断。承载对象 21/25 亦未依赖扩维。信息需求已由既有规范源完整承接，无残余责任，不设承接目标。
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
  - at: 2026-09-13T21:03:17.061Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 终态转换 open→discarded：调查前提已由 80ea2e0（2026-09-11）写入的 01.Att.02 §2 语义裁定推翻，非扩维议题；信息需求已由既有规范源完整承接，无残余责任，不设承接目标
---

# dimensions 七元组表达力缺口

## 当前理解

本对象已收口关闭，不再以原形态跟踪。三条前提经核查全部不成立：(1) `01.Att.02 §2`（2026-09-11 `80ea2e0` 写入，已是 HEAD 祖先，早于本对象创建两天）已裁定 `dimensions` 是能力层标签词表、能力轴，不是业务系统的镜像或枚举，不逐一对应业务系统是预期而非缺漏；(2) §4 定普通规范 `dimensions` 为「可选；若出现必须非空」，仅要求正文实质承担的维度必须声明，是单向下限，无维度可声明时省略即合法通过，故 32–35 不构成「阻断」，且 `plugin/lib/spec-registry.js` 的 `required: true` 分支仅对 isRoot 生效；(3) 系统专属规范的承载对象 21 WorkCase（write/orchestrate/comply）与 25 Goal（comply）均未依赖扩维即通过校验，04 全列七维是其横跨六系统共同骨架的如实声明而非被迫填满。信息需求已由既有规范源完整承接，无残余责任，不设承接目标。

上述三条各自的展开与可复查证据：

1. **`01.Att.02 §2` 原文裁定**——「`dimensions` 是能力层的稳定标签词表……它是能力轴（回答"怎么跑"），**不是业务系统的镜像或枚举**。六大业务系统……与能力承载、制度的分界由 00 §3.1 及各业务系统规范在正文中定义和归属，不由本字段承载。因此维度集合包含能力原语（read、write、orchestrate）而不逐一对应业务系统，**是预期而非缺漏**」。故"无法表达六系统"不是缺口，而是把能力轴误当系统枚举的期待错置。该段经 `git merge-base --is-ancestor 80ea2e0 HEAD` 验证为 HEAD 祖先，`git show -s --format=%ad` 为 2026-09-11，**早于本对象创建（2026-09-13）两天**。
2. **"阻断校验"不成立**——`01.Att.02 §4` 的约束是单向下限（承担了必须声明），不要求每份规范有专属维度；§2 通则亦明"可选字段无值时省略"。代码侧 `plugin/lib/spec-registry.js` 中 `validateDimensions(identity.dimensions, { required: true })` 与七维顺序校验均位于 `isRoot` 分支内，仅对根规范 00 生效，非根规范走 `required: false`，与 §4 一致。原文把根部规则当成了普遍规则。
3. **"摩擦"实为如实声明**——30（research）、31（discussion）是各自系统的精确单维声明；04 是业务系统基础规范，其 `positioning` 定义六系统共同骨架与公共机制，全列七维是横跨读/写/编排的真实能力面。系统专属规范的承载对象 `21-WorkCase`（`["write","orchestrate","comply"]`）与 `25-Goal`（`["comply"]`）均未借助扩维即通过校验，直接否证"「目标与蓝图」无维度可用"。

**来源**：本对象由 `2916e3d5-cfdf-459b-90fb-e39b2523137f`（30–38 段编号与六业务系统承载）经 `20 §9.4` 情形二拆分而来，承接其中 N-2；同时并入独立对抗审核 `ee2e43f9` 的 F9（次要）。

**终止依据**：`20 §9.2` 第一种终态路径——"明确决定不再跟踪（不产生承接目标的否定处置）"。三个候选中，第三项「明确 dimensions 不按系统划分」**已由 `80ea2e0` 实际完成**；第一项「扩维」与 `01.Att.02 §2` 已生效的语义裁定相冲突（会把能力词表退化为系统枚举）；第二项「另设映射」无必要（归属已由 00 §3.1 与各系统规范正文承担，另设映射将产生第二套归属）。故本议题不需要 Human 新裁定。

**本次关闭留下的账实不符（如实登记，非本对象可处置范围）**：`docs/pending-human-decisions-2026-09-11.md`、`docs/archive/spark-next-action-triage-2026-09-13.md`、`docs/spark-priority-backfill-proposal.md`、`docs/00-ch3-5-review-disposition-2026-09-11.md` 四处仍将 N-2/F9 记为「open，待 Human 裁定」。这些是过程文档而非规范源，不构成规则效力；其时效纪律由 Spark `afc45279`（docs 过程文档的时效纪律）另行承接。

## 调查问题

`dimensions` 七元组闭集是否应扩维以表达六业务系统（尤其「工作执行」与「目标与蓝图」）？

## 调查边界

Human 就「扩维」「维持并另设映射」或「明确 dimensions 不按系统划分」作出裁定，且选定的处置在 00 身份块、`01.Att.02` 与 `plugin/lib/spec-registry.js` 三处同步完成、机械校验通过时停止。
