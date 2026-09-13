---
title: dsh-deep-research 编排机制在 v5 调研系统的承接状态（EIG/三态/澄清已吸收；模型分层/底稿/盲区审查未吸收）
status: active
research_question: dsh-deep-research（v0.1.0）控制论/信息论编排机制在 v5 调研系统（specs/11 + specs/24）中的承接状态：哪些机制已吸收为规范机制、哪些未吸收且对 LDVH 仍有参考价值、哪些是 v5 明确不采用的
research_purpose: 为 specs/11 调研系统与 specs/24 Research 类型规范的缺口核对提供依据：确定 v4 已调研的 deep-research 机制在 v5 语境下的承接状态，避免重复外部取证（源码未变），聚焦 v4→v5 机制映射的核对
stopping_reason: round-cap
confirmed_statements:
  - C1 EIG 边际增益停止条件已吸收为 no-gain 收敛
  - C2 三态证据模型已吸收
  - C3 调查前澄清已吸收
  - C4 调研=审议扩散工具的边界澄清已落实
  - C5 round-cap 轮次上限已吸收
  - C6 程序化引用审计已吸收
  - C7 启发锚定不变量强化
  - C8 三陷阱原文确认但 v5 未显式落账
  - C9 陷阱3经防自欺机制间接落实
  - G1 模型分层角色特化未吸收
  - G2 率失真综合附录底稿未吸收
  - G3 盲区侦察与对抗性审查未吸收
uncertain:
  - issue: v4 三陷阱是否通过其他规范（02 §8 编排、09 接入）间接落实未逐项核对——只确认了陷阱3经 00 §7 间接落实，陷阱1/2 的间接路径未确认
    reason: 陷阱1（二次包装）与陷阱2（内嵌脚本）的间接承载规范未逐一 grep 核对
gaps:
  - description: 外部取证范围声明：deep-research 源码 v0.1.0 未变（最近 commit c0b329e/094bdf1 即 v4 引用），未重跑回归测试——v4 已实跑 6/6 全绿，本轮不重复
    priority: low
  - description: v4 报告的横向对比（deep-research vs solo-thinking vs mnemon）未在 v5 对象间显式建立关联——R3（mnemon）/R4（solo-thinking）各自落档但未交叉引用 deep-research
    priority: low
implications:
  - finding_ref: C1 EIG 边际增益停止条件已吸收为 no-gain 收敛
    implication: EIG 边际增益已规范化为 no-gain 收敛，LDVH 调研收敛判据有机械依据
  - finding_ref: C2 三态证据模型已吸收
    implication: 三态证据已是 v5 调研系统核心结构，confirmed 逐字摘录进证据库
  - finding_ref: C3 调查前澄清已吸收
    implication: 调研入口澄清已规范化为三触发条件 + ≤3 题 + 降级处理
  - finding_ref: C4 调研=审议扩散工具的边界澄清已落实
    implication: 调研定位为产出事实证据不自动授权，边界语义在 v5 保留
  - finding_ref: C5 round-cap 轮次上限已吸收
    implication: 轮次上限收敛已规范化，主控启动时设定上限强制收敛
  - finding_ref: C6 程序化引用审计已吸收
    implication: 引用闭环 + 来源纪律已规范化，逐字摘录可程序化审计
  - finding_ref: C7 启发锚定不变量强化
    implication: v5 新增启发锚定不变量（implications 逐字锚定 confirmed）是 v4 没有的强化
  - finding_ref: C8 三陷阱原文确认但 v5 未显式落账
    implication: v4 三陷阱未在规范层显式落账，是规范缺口
  - finding_ref: C9 陷阱3经防自欺机制间接落实
    implication: 术语空转欺瞒经 00 §7 防自欺间接承载，但非显式条目
  - finding_ref: G1 模型分层角色特化未吸收
    implication: 调研子代理角色分层（Planner/Researcher/Synthesizer/Reviewer）是 v5 缺口，建议补入
  - finding_ref: G2 率失真综合附录底稿未吸收
    implication: 原始证据底稿附录是 v5 缺口，建议补入 24 号字段
  - finding_ref: G3 盲区侦察与对抗性审查未吸收
    implication: 盲区转化与五维独立审查是 v5 缺口，建议补入调研系统
urls:
  - ref: https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/11-调研系统规范.md
    summary: v5 调研系统规范：三态证据/三层收敛/入口澄清/引用闭环/来源纪律，核对承接状态的主要对象
    title: specs/11 调研系统规范
  - ref: https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/24-Research-调研报告.md
    summary: Research 类型规范：字段契约/启发锚定不变量，核对底稿附录缺口
    title: specs/24 Research 类型规范
  - ref: https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/02-工作模型基础规范.md
    summary: 工作模型：§9 调研业务系统定位（产出事实证据不自动授权）
    title: specs/02 工作模型基础规范
  - ref: https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/00-理念与构成.md
    summary: 理念与构成：§7 防自欺机制（陷阱3间接落实路径）
    title: specs/00 理念与构成
  - ref: https://github.com/dmh2002/dsh-ldvh/blob/dev/docs/investigation-report-dsh-deep-research.md
    summary: v4 deep-research 调研报告：机制映射表/四可移植机制/三陷阱原文
    title: v4 investigation-report-dsh-deep-research
object_uid: e9949813-4d12-4e0c-aef6-801d34ab8feb
fact_type_key: research
created_at: 2026-09-08T22:21:18.425Z
change_log:
  - at: 2026-09-08T22:21:18.425Z
    provider: trae
    model: DeepSeek-V4-Flash-Official
    summary: 受控创建 Research 对象（补缺清单1：dsh-deep-research 控制论/信息论编排机制在 v5 调研系统的承接状态核对；源码未变不重复取证，聚焦 v4→v5 机制映射；9 confirmed + 1 uncertain + 2 gaps，round-cap 收敛）
  - at: 2026-09-13T14:12:27.720Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 更正章号引用：02 §10→§9（02 号六业务系统章序重排后，「调研业务系统」现为 §9）
  - at: 2026-09-13T14:18:57.719Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 修复上次更新引入的 implications 丢失（12 条误减为 4 条），恢复原始 12 条并保留 02 §10→§9 章号更正
  - at: 2026-09-13T14:20:23.025Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 修复上次更新对其他 frontmatter 字段的无谓改写，恢复 research_purpose/stopping_reason/uncertain/gaps 原文并保留 02 §10→§9 章号更正
  - at: 2026-09-13T14:25:29.916Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 更正章号引用：02 章序重排后同步全部引用（旧 §10 调研→§9）；仅改章号，其余字段与正文保持原文
---

## 研究问题

dsh-deep-research（v0.1.0）控制论/信息论编排机制在 v5 调研系统（specs/11 + specs/24）中的承接状态：哪些机制已吸收为规范机制、哪些未吸收且对 LDVH 仍有参考价值、哪些是 v5 明确不采用的。

本调研为 specs/11 调研系统与 specs/24 Research 类型规范的缺口核对提供依据。方法：确认 deep-research 源码未变（v0.1.0，最近 commit c0b329e/094bdf1 即 v4 报告引用，之后无新 commit），故不重复外部取证；聚焦 v4 已调研机制（docs/investigation-report-dsh-deep-research.md）与 v5 规范（specs/11 + specs/24 + specs/02 §9 + specs/00 §7）的逐项映射核对。

## 输入与边界

输入：v4 调研报告 docs/investigation-report-dsh-deep-research.md（171 行，2026-09-05，源码级证据 file:line）；v5 规范 specs/11-调研系统规范.md、specs/24-Research-调研报告.md、specs/02 §9、specs/00 §7；deep-research 本机源码 ~/DshProject/dsh-deep-research（git log 确认无新 commit）。

边界：本调研核对 v4→v5 机制承接状态，不重新实跑 deep-research 回归测试（源码未变，v4 已实跑 6/6 全绿）；不横向对比其他项目（solo-thinking/mnemon 已由 R3/R4 承接）；不评估 specs/11 的实现质量，只核对规范层承接。

对照框架：v4 报告 §7.1 四条可移植机制 + §7.3 三个陷阱，逐项核对 specs/11+specs/24 是否有对应机制或显式落账。

## 关键发现

### C1 EIG 边际增益停止条件已吸收为 no-gain 收敛

v4 deep-research 的「连续单轮边际增益为零」信息论收敛信号，在 v5 落实为 specs/11 §6.2 no-gain 零增益收敛：当某轮结束后对比上一轮新增确认认识数量为零判定 no-gain，连续两轮强制收敛。机械判据与 v4 的 EIG 停止条件同构。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/11-调研系统规范.md（§6.2）

### C2 三态证据模型已吸收

v4 deep-research 的 confirmed/uncertain/gaps 三态结构化 Schema 在 v5 落实为 specs/11 §7 三态证据结构 + specs/24 字段契约。confirmed 须逐字摘录进入证据库（Research 对象 frontmatter 三态字段）。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/11-调研系统规范.md（§7）

### C3 调查前澄清已吸收

v4 deep-research 的 clarify-first（≤3 澄清问题 + 拒绝则驳回）在 v5 落实为 specs/11 §5 调研入口澄清：三触发条件（多重含义/多维无优先/范围未界定）、提问不超过三题、降级处理（Human 不响应时按最保守范围推进）。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/11-调研系统规范.md（§5）

### C4 调研=审议扩散工具的边界澄清已落实

v4 报告 §7.1 澄清「调研不是第九维，是审议维扩散阶段工具」，在 v5 落实为 specs/02 §9 调研业务系统定位：调研产出事实证据，不自动产生行动授权或完成结论；调研结论进入事实源须满足 03 准入。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/02-工作模型基础规范.md（§9）

### C5 round-cap 轮次上限已吸收

v4 deep-research 的 depth+1 硬上限轮次约束在 v5 落实为 specs/11 §6.3 round-cap：主控在调研启动时设定轮次上限，达到上限无论其他条件是否满足均强制收敛。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/11-调研系统规范.md（§6.3）

### C6 程序化引用审计已吸收

v4 deep-research 的逐字摘录一致性审计 + 违规溯源封禁，在 v5 落实为 specs/11 §8 引用闭环 + §9 来源纪律（S1 稳定 HTTP / S2 文档存在确认、逐字摘录、程序化审计）。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/11-调研系统规范.md（§8-§9）

### C7 启发锚定不变量强化

v4 deep-research 的三态证据 Schema 在 v5 被进一步强化为 specs/24 的启发锚定不变量：confirmed_statement 逐字等于关键发现 H3 标题；implications[].finding_ref 逐字等于某 confirmed[].statement。这是 v4 没有的增量。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/24-Research-调研报告.md（§8）

### C8 三陷阱原文确认但 v5 未显式落账

v4 报告 §7.3 三个陷阱（严禁二次包装成冗余插件/避免大段内嵌脚本字符串/防止控制论术语空转欺瞒）出处确认，但 specs/11 规范层未见显式对应条目——陷阱未被规范化。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/docs/investigation-report-dsh-deep-research.md（§7.3）

### C9 陷阱3经防自欺机制间接落实

v4 陷阱3（术语空转欺瞒）通过 specs/00 §7 防自欺机制间接落实——理论声明需断言级代码把关的等价物由 00 防自欺机械锚点承载。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/00-理念与构成.md（§7）

### G1 模型分层角色特化未吸收

v4 deep-research 的 Planner/Researcher/Synthesizer/Reviewer 四级角色模型分层（成本/精度解耦）未被 specs/11 吸收——规范层 grep 无「模型分层/角色」机制性命中。这是未吸收缺口。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/11-调研系统规范.md（全文 grep 无命中）

### G2 率失真综合附录底稿未吸收

v4 deep-research 的率失真综合 + 原始证据底稿附录（report + 附录：原始证据状态）未被 specs/24 吸收——Research 对象无附录底稿字段，grep 无「附录/底稿/率失真」命中。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/24-Research-调研报告.md（全文 grep 无命中）

### G3 盲区侦察与对抗性审查未吸收

v4 deep-research 的盲区侦察（coverage_gaps→blind 任务）与对抗性五维审查（引用纠错/覆盖审计/矛盾检视/时效/过度自信）未被 specs/11 吸收——规范层无机制性命中。

溯源：https://github.com/dmh2002/dsh-ldvh/blob/dev/specs/11-调研系统规范.md（全文 grep 无命中）

## 未证实与缺口

未证实：
- v4 三陷阱（C8）是否通过其他规范（02 §8 编排、09 接入）间接落实未逐项核对——只确认了陷阱3经 00 §7 间接落实，陷阱1/2 的间接路径未确认（U1）。

缺口：
- 外部取证范围声明：deep-research 源码 v0.1.0 未变（最近 commit c0b329e/094bdf1 即 v4 引用），未重跑回归测试——v4 已实跑 6/6 全绿，本轮不重复（GA1, low）。
- v4 报告的横向对比（deep-research vs solo-thinking vs mnemon）未在 v5 对象间显式建立关联——R3（mnemon）/R4（solo-thinking）各自落档但未交叉引用 deep-research（GA2, low）。

## 建议

A1 模型分层角色特化补入 specs/11：Planner（强逻辑）/Researcher（低成本搜索）/Synthesizer（精炼归纳）/Reviewer（批判审阅）四级角色成本精度解耦，作为调研子代理编排的推荐分层；验收条件：specs/11 明确调研子代理角色分层与各自模型配置入口。判断依据：G1。可被 02 §8 编排技术支撑承接。
A2 率失真附录底稿补入 specs/24：Research 对象主 md 增加可选「附录：原始证据状态」字段，保留未压缩原始证据底稿；验收条件：高层压缩结论与底层三态证据链可回溯。判断依据：G2。可被 24 号类型规范承接。
A3 盲区侦察 + 对抗性审查补入 specs/11：调研规划阶段显式声明 coverage_gaps 转化为侦察任务；综合阶段独立审查代理五维清单（引用纠错/覆盖审计/矛盾检视/时效/过度自信），只提意见不改写正文；验收条件：specs/11 有盲区转化机制与独立审查角色。判断依据：G3。可被调研系统 + 复核制度承接。
A4 三陷阱显式落账 specs/11 边界章：严禁二次包装成冗余插件、避免大段内嵌脚本字符串、防止术语空转欺瞒三条作为调研系统实现红线写入规范边界；验收条件：specs/11 边界章有显式陷阱条目。判断依据：C8/C9。可被 09 测试与 00 §7 承接。

## 后续分流

- A1 → 02 §8 编排技术支撑 + specs/11；信号：调研子代理编排设计时。
- A2 → specs/24 类型规范；信号：Research 字段契约修订时。
- A3 → specs/11 + 复核制度；信号：调研独立审查设计时。
- A4 → specs/11 边界章；信号：调研系统实现红线收口时。
- 本对象与 R5（工作流编排）互补：R5 调研 dsh_workflow 脚本化编排，本对象核对 deep-research 自适应编排在 v5 的承接。
- 监测条件：deep-research 若发布新版本（v0.1.0 之后有机制性变化），需新建对象重验；当前源码未变，v4 外部取证结论仍有效。
