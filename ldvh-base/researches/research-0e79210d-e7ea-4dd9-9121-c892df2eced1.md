---
title: v4 吸收账读/写维五吸收项在 v5 的落实状态（双层消费/局部补丁/生命周期已落实；代码图谱索引未承接）
status: active
research_question: v4 49 份 Study 吸收账（docs/study-absorption.md）读/写维五吸收项在 v5 语境下的落实状态：双层消费模型/记忆预热/代码图谱索引（读维）与局部补丁写入/生命周期摩擦修正（写维）——哪些已由 v5 规范或 R1–R6 对象承接、哪些仍是缺口
research_purpose: 重验 v4 吸收账读/写维吸收项在 v5 的承接状态，确定哪些已规范化（L0-L4/写维判据/生命周期）、哪些仍缺口（代码图谱索引），为 02 §6/§7 与 R6 上下文插件结论的衔接提供依据
stopping_reason: sufficient
confirmed_statements:
  - C1 双层消费模型已落实为 L0-L4
  - C2 局部补丁写入已落实为写维判据
  - C3 生命周期行为清单已落实
  - C4 记忆预热部分落实
  - C5 代码图谱相近能力由 R6 覆盖
  - G1 代码图谱索引未承接
uncertain: []
gaps:
  - description: 吸收账记忆预热工程的事件回收/pending 离线队列/CJK 预算子项未逐一核对承接状态——R3 只确认快照注入与协议/数据切分
    priority: low
implications:
  - finding_ref: C1 双层消费模型已落实为 L0-L4
    implication: 双层消费模型已扩展为 L0-L4 四层读取，公共必读层语义在 v5 保留
  - finding_ref: C2 局部补丁写入已落实为写维判据
    implication: 局部补丁写入已规范化为写维判据（范围/身份/授权/基线/变化/回读/未验证）
  - finding_ref: C3 生命周期行为清单已落实
    implication: 生命周期行为清单已规范化为 specs/24 §9 状态与生命周期
  - finding_ref: C4 记忆预热部分落实
    implication: 记忆预热快照注入已由 R3 承接，事件回收/预算子项待明确
  - finding_ref: C5 代码图谱相近能力由 R6 覆盖
    implication: openwolf 渐进读取链与代码图谱同族，但非语义索引
  - finding_ref: G1 代码图谱索引未承接
    implication: 代码图谱索引是 v5 读维缺口，建议遵循索引不搬正文原则设计
urls:
  - ref: https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/01-规范模型基础规范.md
    summary: 规范模型：§10.2 L0-L4 读取层级（双层消费落实）
    title: specs/01 规范模型基础规范
  - ref: https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/02-工作模型基础规范.md
    summary: 工作模型：§7 写维判据（局部补丁落实）+ 代码图谱缺口
    title: specs/02 工作模型基础规范
  - ref: https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/24-Research-调研报告.md
    summary: Research 类型规范：§9 状态与生命周期（生命周期行为清单落实）
    title: specs/24 Research 类型规范
  - ref: https://github.com/dmh2002/dsh-ldvh/blob/dev/ldvh-base/researches/research-fa0cff9c-a8b9-4d65-983c-26ad991a6c10.md
    summary: R3 记忆平面对象：快照注入与协议/数据切分（记忆预热部分落实）
    title: R3 research-fa0cff9c
  - ref: https://github.com/dmh2002/dsh-ldvh/blob/dev/ldvh-base/researches/research-6ac1d0c5-cbb8-4982-81f4-4738a87382ef.md
    summary: R6 上下文插件对象：openwolf 渐进读取链（代码图谱相近能力）
    title: R6 research-6ac1d0c5
  - ref: https://github.com/dmh2002/dsh-ldvh/blob/dev/docs/study-absorption.md
    summary: v4 49 份 Study 吸收账：读/写/遵守/思考/执行五维吸收清单
    title: v4 study-absorption
object_uid: 0e79210d-e7ea-4dd9-9121-c892df2eced1
fact_type_key: research
created_at: 2026-09-08T22:29:58.628Z
change_log:
  - at: 2026-09-08T22:29:58.628Z
    provider: trae
    model: DeepSeek-V4-Flash-Official
    summary: 受控创建 Research 对象（补缺清单4：v4 吸收账读/写维五吸收项在 v5 的落实状态重验；双层消费/局部补丁/生命周期已落实，记忆预热部分落实，代码图谱索引未承接；5 confirmed + 1 gap，sufficient 收敛）
---

## 研究问题

v4 49 份 Study 吸收账（docs/study-absorption.md）读/写维五吸收项在 v5 语境下的落实状态：双层消费模型/记忆预热/代码图谱索引（读维）与局部补丁写入/生命周期摩擦修正（写维）——哪些已由 v5 规范或 R1–R6 对象承接、哪些仍是缺口

## 输入与边界

本调研重验 v4 吸收账读/写维吸收项在 v5 的承接状态，确定哪些已规范化（L0–L4/写维判据/生命周期）、哪些仍缺口（代码图谱索引），为 02 §6/§7 与 R6 上下文插件结论的衔接提供依据。方法：逐项核对 specs/01、specs/02、specs/24、R3 对象、R6 对象。

输入：v4 吸收账 docs/study-absorption.md（91 行，49 份 Study 五维吸收清单）；v5 规范 specs/01-规范模型基础规范.md、specs/02-工作模型基础规范.md、specs/24-Research-调研报告.md；R3 对象 research-fa0cff9c（记忆平面）、R6 对象 research-6ac1d0c5（上下文插件）。

边界：本调研重验吸收账读/写维五吸收项（读维：双层消费/记忆预热/代码图谱；写维：局部补丁/生命周期）；不重验遵守/思考/执行维（由其他规范承接）；不评估实现质量只核对承接存在性。

对照框架：吸收账 §1 读维/写维表格逐项核对 v5 规范或对象。

## 关键发现

### C1 双层消费模型已落实为 L0-L4

吸收账读维项1（双层消费模型：公共必读层+类型差异触发层）已落实为 specs/01 §10.2 L0-L4 读取层级——分层累积语义 + 消费方可直接请求任何足够层级不强制逐层仪式。v4 的「双层消费」被 v5 扩展为四层读取。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/01-规范模型基础规范.md（§10.2）

### C2 局部补丁写入已落实为写维判据

吸收账写维项1（局部补丁写入：请求/发布粒度分离+稳定 ID+片段绑定指纹+CAS/回读/审计）已落实为 specs/02 §7 写维判据（范围/身份/授权/基线/变化/回读/未验证）+ 03 受控写入 CAS。v4 的补丁工程模式被规范化为写维判据。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/02-工作模型基础规范.md（§7）

### C3 生命周期行为清单已落实

吸收账写维项2（五类事实生命周期行为清单）已落实为 specs/24 §9 状态与生命周期（active/retired/retirement_reason 闭集/updates 关系/retired 禁止新增发现单元）。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/24-Research-调研报告.md（§9）

### C4 记忆预热部分落实

吸收账读维项2（记忆/事实预热工程模式）部分落实——R3 对象确认快照注入与协议/数据切分（memorySnapshotMessage 自有消息注入 + 稳定规则进系统提示/动态数据进消息流），但事件回收/pending 队列/CJK 预算未在 R3 显式承接。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/ldvh-base/researches/research-fa0cff9c-a8b9-4d65-983c-26ad991a6c10.md（快照注入 F 单元）

### C5 代码图谱相近能力由 R6 覆盖

代码图谱索引的相近能力已由 R6 对象覆盖——openwolf 渐进读取链（索引不搬正文+按需读）与代码图谱索引同族，但 openwolf 是文件级索引非代码图谱语义索引。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/ldvh-base/researches/research-6ac1d0c5-cbb8-4982-81f4-4738a87382ef.md（F14/F16）

### G1 代码图谱索引未承接

吸收账读维项3（代码图谱索引：本地图谱+查询+可提交快照）未在 v5 规范层承接——specs/02、specs/11、specs/24 grep 无「代码图谱/Codebase/图谱」命中。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/02-工作模型基础规范.md（全文 grep 无命中）

## 未证实与缺口

未证实：（无——本轮五项已证实、一项缺口已确认，sufficient 收敛）

缺口：
- 吸收账记忆预热工程的事件回收/pending 离线队列/CJK 预算子项未逐一核对承接状态——R3 只确认快照注入与协议/数据切分（GA1, low）。

## 建议

A1 代码图谱索引补入读维设计：v5 若实现代码图谱（本地图谱+查询+可提交快照），须遵循 R6 openwolf 的「索引不搬正文」原则与吸收账「运行时索引≠事实」红线；验收条件：读维设计文档明确代码图谱边界与事实源隔离。判断依据：G1+C5。可被 02 §6 读维承接。
A2 记忆预热剩余子项（事件回收/pending 队列/CJK 预算）核对到 R3 或记忆系统规范：R3 已确认快照注入与协议/数据切分，事件回收与预算需在记忆业务系统规范明确；验收条件：记忆规范有事件回收与预算条目。判断依据：C4。可被记忆业务系统承接。

## 后续分流

- A1 → 02 §6 读维；信号：代码图谱设计时。
- A2 → 记忆业务系统规范；信号：记忆系统规范起草时。
- 本对象与 R3（research-fa0cff9c）、R6（research-6ac1d0c5）互补：R3 覆盖记忆平面、R6 覆盖上下文插件，本对象覆盖 v4 吸收账读/写维承接核对。
- 监测条件：代码图谱索引若立项，A1 状态变化时需更新。
