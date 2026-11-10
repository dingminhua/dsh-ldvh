---
title: advice 段解析吞条目缺陷
status: discarded
question: "`parseWorkCaseResultDraft` 的 advice 段退出条件应如何收严，才能不吞后续顶层 bullet？"
scope_boundary: 给出「退出条件应满足什么、现有实现为何不满足、改后对存量与新增正文各有什么影响」的可执行结论即可停；不在本议题内落实现改动，也不在本议题内决定纳入哪次行动。
intent: 已定位的实现缺陷（含可复现失败信号与已知后果），且当前会影响 web 用例与投影口径。收敛为 Spark 以便跨行动修复：先定退出条件的判据，再决定落实现与影响面。
summary: "`workcase-364df30e`（WorkCase 呈现保真与设计语言收敛）的残留与去向里记着一处已定位的实现缺陷：`parseWorkCaseResultDraft` 的 `advice` 段退出条件不严——在 `advice` 模式下遇到后续顶层 bullet 时未退出，会把本不属于该段的条目吞为建议条目。载体原话：『修 `parseWorkCaseResultDraft` 的 advice 段退出条件——advice 模式下遇到后续顶层 bullet 应退出，不得吞为建议条目（2026-09-27 双基线复核发现，当前由 workcase-63700bd2 的未提交正文改动暴露为 fidelity L547 失败）。』后果是投影失真：去向条目数被少算/多算，直接影响关闭卡的「去向分区」呈现与条数口径。"
serves: c8a2a574-b17f-47c1-b5fb-fe9bca88c97b
disposition: 并入 spark-b0e805d1「插件呈现层三处已定位缺陷」：缺陷本体、可复现失败信号与后果判断已由该对象承载；本议题未落地任何修复
relations:
  - relation_key: split-into
    target:
      object_uid: b0e805d1-8b26-4f9f-90e7-b7d135a0f911
object_uid: 4a21bfda-19bf-437f-a5e6-1977dbdbf173
fact_type_key: spark
created_at: 2026-10-01T18:24:53.227Z
change_log:
  - at: 2026-10-01T18:24:53.227Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Spark 对象
  - at: 2026-10-01T18:44:54.492Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 按 Human 裁定（丙方案），以 refs 登记来源单 workcase-364df30e —— 该单的残留与去向记着本议题所指的 advice 段退出条件缺陷；使该已关闭 WorkCase 的卡面反向引用区出现本 Spark 的关联行
  - at: 2026-11-01T23:02:10.114Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 转 discarded（Human 确认）：并入 spark-b0e805d1「插件呈现层三处已定位缺陷」，按 20 §9.3 写入 split-into 关系；本议题未落地任何修复，故不标 implemented
  - at: 2026-11-10T11:09:31.323Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补 recall_digest：为召回提供高密度关键词面（02 §7.1）
refs:
  - object_uid: 364df30e-ce3d-4cca-9463-c57a1fad399a
recall_digest: advice段解析 吞条目 退出条件不严 顶层bullet未退出 建议段 缺陷已定位 残留去向 解析越界 误吞 修复面
---

# advice 段解析吞条目缺陷

## 当前理解

`workcase-364df30e`（WorkCase 呈现保真与设计语言收敛）的残留与去向里记着一处已定位的实现缺陷：`parseWorkCaseResultDraft` 的 `advice` 段退出条件不严——在 `advice` 模式下遇到后续顶层 bullet 时未退出，会把本不属于该段的条目吞为建议条目。载体原话：『修 `parseWorkCaseResultDraft` 的 advice 段退出条件——advice 模式下遇到后续顶层 bullet 应退出，不得吞为建议条目（2026-09-27 双基线复核发现，当前由 workcase-63700bd2 的未提交正文改动暴露为 fidelity L547 失败）。』后果是投影失真：去向条目数被少算/多算，直接影响关闭卡的「去向分区」呈现与条数口径。

两条要点：
- 有可复现的失败信号：`workcase-63700bd2` 的正文改动可使 `workcase-projection-fidelity.test.ts` 的 L547 用例失败（被吞条目导致投影与实际去向数不符）。
- 后果是投影失真：去向条目数被少算或多算，直接影响关闭卡的「去向分区」呈现与条数口径。

本议题是「把这个缺陷修掉」这件事本身；具体修法（退出的判据取什么、是否影响存量解析口径）待做时再讨论。

**终态处置（2026-11-02，Human 确认）**：本议题并入 `spark-b0e805d1`（插件呈现层三处已定位缺陷），按 20 §9.3 走**拆分/合并的关系处置**——原对象转 `discarded` 并写入 `split-into` 关系，**不标 implemented**：本议题并未落地任何修复，只是把承载搬到了聚焦后的对象上。合并理由：三处缺陷（本条的 advice 段退出条件、`FactCardAssociation` 建模松弛、六类阅读布局守卫未扩面）同属 `plugin/web/` 呈现层及其契约测试，处置形态相同、判据形态相同（位置已知、型别已知、只差改），且本条与守卫扩面一条本就出自同一批已关闭工单的残留。缺陷本体、可复现失败信号与后果判断已由新对象正文逐条承载，此处不删除任何事实。

## 调查问题

`parseWorkCaseResultDraft` 的 advice 段退出条件应如何收严，才能不吞后续顶层 bullet？

## 调查边界

给出「退出条件应满足什么、现有实现为何不满足、改后对存量与新增正文各有什么影响」的可执行结论即可停；不在本议题内落实现改动，也不在本议题内决定纳入哪次行动。
