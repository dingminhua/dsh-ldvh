---
title: v4 T1-T6 调研系统技术加固在 v5 的落实状态（EIG/validator/关系约束已落实；体量闸/调研模/解耦未落实）
status: active
research_question: v4 调研系统技术加固稿（docs/study-technical-reinforcement-6.md）T1–T6 六项在 v5 调研系统（specs/11 + specs/24 + research-writer.js 代码层）的落实状态：哪些已落地、哪些仍是缺口
research_purpose: 核对 v4 T1-T6 六项工程加固（调研-审议解耦/EIG 停止/五段 validator/关系边约束/体量闸/调研模 spawn）在 v5 的落实状态，确定哪些已完成、哪些仍待立项，为 specs/11+specs/24+代码层补齐提供依据
stopping_reason: sufficient
confirmed_statements:
  - C1 T2 EIG 停止已落实
  - C2 T3 五段 validator 已落实
  - C3 T4 关系边约束已落实且更强
  - G1 T5 体量闸未落实
  - G2 T6 调研模 spawn 未落实
  - G3 T1 调研-审议解耦未落实
uncertain: []
gaps: []
implications:
  - finding_ref: C1 T2 EIG 停止已落实
    implication: EIG 停止条件已规范化，调研收敛有机械判据
  - finding_ref: C2 T3 五段 validator 已落实
    implication: 五段结构 validator 已由落盘器实现，H2 缺失/重复/乱序拒收
  - finding_ref: C3 T4 关系边约束已落实且更强
    implication: 关系边闭集校验比 v4 加固稿更强，含最小形状与 superseded 关联
  - finding_ref: G1 T5 体量闸未落实
    implication: 人可读带宽问题在 v5 无机械闸，建议补体量闸
  - finding_ref: G2 T6 调研模 spawn 未落实
    implication: 调研子代理 spawn 形态在 v5 无独立定义，建议补调研模
  - finding_ref: G3 T1 调研-审议解耦未落实
    implication: 调研与审议漏斗未解耦，建议补明文
urls:
  - ref: https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/11-调研系统规范.md
    summary: v5 调研系统规范：T2 EIG 已落实（§6.2）、T1 解耦未落实（无审议命中）
    title: specs/11 调研系统规范
  - ref: https://github.com/dmh2002/dsh-ldvh/blob/dev/plugin/lib/research-writer.js
    summary: 落盘器代码：T3 H2 校验 + T4 关系闭集校验已实现，T5 体量闸缺失
    title: research-writer.js
  - ref: https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/24-Research-调研报告.md
    summary: Research 类型规范：T5 体量阈值缺失
    title: specs/24 Research 类型规范
  - ref: https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/02-工作模型基础规范.md
    summary: 工作模型：T6 调研模 spawn 形态缺失
    title: specs/02 工作模型基础规范
  - ref: https://github.com/dmh2002/dsh-ldvh/blob/dev/docs/study-technical-reinforcement-6.md
    summary: v4 T1-T6 加固稿原文：六项工程加固方案与依赖排序
    title: v4 study-technical-reinforcement-6
object_uid: cb153680-ec53-4fb5-b2c4-1effeaef6b3e
fact_type_key: research
created_at: 2026-09-08T22:26:26.973Z
change_log:
  - at: 2026-09-08T22:26:26.973Z
    provider: trae
    model: DeepSeek-V4-Flash-Official
    summary: 受控创建 Research 对象（补缺清单3：v4 T1-T6 调研系统技术加固在 v5 的落实状态核对；T2/T3/T4 已落实，T1/T5/T6 未落实；3 confirmed + 3 gaps，sufficient 收敛）
---

## 研究问题

v4 调研系统技术加固稿（docs/study-technical-reinforcement-6.md）T1–T6 六项在 v5 调研系统（specs/11 + specs/24 + research-writer.js 代码层）的落实状态：哪些已落地、哪些仍是缺口

本调研核对 v4 T1–T6 六项工程加固（调研-审议解耦/EIG 停止/五段 validator/关系边约束/体量闸/调研模 spawn）在 v5 的落实状态，确定哪些已完成、哪些仍待立项。方法：逐项 grep specs/11、specs/24、specs/02、research-writer.js 验证机械实现。

## 输入与边界

输入：v4 加固稿 docs/study-technical-reinforcement-6.md（186 行，T1–T6 六项）；v5 规范 specs/11-调研系统规范.md、specs/24-Research-调研报告.md、specs/02-工作模型基础规范.md；代码层 plugin/lib/research-writer.js。

边界：本调研核对 T1–T6 的规范层+代码层落实状态；不评估实现质量，只核对是否存在对应机制。

对照框架：T1 调研-审议解耦 / T2 EIG 停止 / T3 五段 validator / T4 关系边约束 / T5 体量闸 / T6 调研模 spawn，逐项核对。

## 关键发现

### C1 T2 EIG 停止已落实

v4 T2（EIG 停止条件）已落实为 specs/11 §6.2 no-gain 零增益收敛（连续两轮强制收敛）+ §6.3 round-cap 硬上限。与 v4 加固稿「连续 2 轮 confirmed 新增=0 立即停机」完全同构。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/11-调研系统规范.md（§6.2-§6.3）

### C2 T3 五段 validator 已落实

v4 T3（五段结构 validator）已落实为 research-writer.js 的 MAIN_H2_DIRECTED/EXPLORATORY 固定数组 + H2 数量校验（缺失/重复/乱序拒收）。v4 加固稿的伪代码 validator 已由落盘器实现。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/plugin/lib/research-writer.js（39-40, 354-357）

### C3 T4 关系边约束已落实且更强

v4 T4（关系边执行约束）已落实且比 v4 更强——research-writer.js 有 relation_key 闭集 {inspired-by, informs, updates} + 最小形状校验（多余字段拒收）+ superseded 须 updates 关系。v4 加固稿只要求「拒收不在闭集的输入」，v5 还加了最小形状与 superseded 关联校验。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/plugin/lib/research-writer.js（260-271, 218）

### G1 T5 体量闸未落实

v4 T5（体量闸 150 行硬上限/120 行软上限）未落实——research-writer.js 无行数/字符数检查（仅 frontmatter 字段非空检查），specs/24 无体量阈值。v4 实测 53 份 Study 平均 171 行的「人可读带宽」问题在 v5 无机械闸。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/plugin/lib/research-writer.js（全文 grep 行数无命中）

### G2 T6 调研模 spawn 未落实

v4 T6（调研模 spawn 形态分离）未落实——specs/02 无调研模 spawn 形态表（仅审议模/执行模），grep「调研模/spawn/dormant/物化」无命中。调研子代理的 spawn 形态在 v5 无独立定义。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/02-工作模型基础规范.md（全文 grep 无命中）

### G3 T1 调研-审议解耦未落实

v4 T1（调研-审议解耦）未落实——specs/11 无调研与审议漏斗解耦的明文（仅声明调研子代理 spawn 由 02 §8 编排承载），grep「审议/解耦/漏斗/扩散」无命中。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/11-调研系统规范.md（全文 grep 无命中）

## 未证实与缺口

未证实：（无——本轮三项已证实、三项缺口已确认，sufficient 收敛）

缺口：
- 无未决 high 缺口（sufficient 收敛要求）。

## 建议

A1 体量闸补入 research-writer.js + specs/24：单份 Research ≤ 150 行硬上限（拒收 + 报告压缩建议）、120 行软上限（warning 可覆盖），abstract ≤ 800 字符等配套；验收条件：落盘器有行数/字符数检查，超限拒收或警告。判断依据：G1。可被 24 号类型规范与落盘器承接。
A2 调研模 spawn 补入 specs/02：spawn 形态表补第三行「调研模」（单 Session 长跑无 dormant、纯读工具面、EIG 停机、落 Research 终态）；验收条件：02 有调研模 spawn 形态定义与工具白名单。判断依据：G2。可被 02 §8 编排技术支撑承接。
A3 调研-审议解耦明文补入 specs/11：调研作为独立动作不挂审议漏斗，调研产物落事实源后审议按 relations 拉取不重复触发；验收条件：specs/11 有调研-审议解耦明文。判断依据：G3。可被 11 号规范承接。

## 后续分流

- A1 → specs/24 + research-writer.js；信号：落盘器体量闸设计时。
- A2 → specs/02 §8；信号：调研子代理 spawn 形态设计时。
- A3 → specs/11；信号：调研系统边界修订时。
- 本对象与清单1（research-e9949813）、清单2（research-1e54b069）互补：三者共同构成 v4 调研类内容在 v5 的承接核对（机制/定案稿/加固项）。
- 监测条件：T1/T5/T6 若立项落地，本对象建议 A1–A3 状态变化时需更新。
