---
title: writer 补记 reviews 身份致归属失真
status: open
question: writer 对既有 `reviews` 条目补记写入者身份的行为，应如何处置，才能不污染关闭侧独立性比对的基准？
scope_boundary: 给出「补记发生在哪些入口与条件下、影响哪些既有条目、应改为保留原身份还是拒绝写入、对存量已被补记的条目如何处置」的可执行结论即可停；不在本议题内落实现改动，也不在本议题内决定纳入哪次行动。
intent: 复核身份是关闭侧独立性判定的机械基准，被补记即失真且机械层不可辨。收敛为 Spark 以便跨行动处置（含存量已被补记的条目如何如实登记）。
summary: "`workcase-4af2b871` 的残留与去向里记着一处实现层缺陷：writer 在受控写入时会给既有的 `reviews` 条目补记写入者身份（本会话的 `session_id` 与 `implementer_session_id`），造成复核条目的身份错误归属——那些条目本是更早的会话产出的，被补记后会读成由本次写入者复核。载体原话：「本对象 reviews[0]（2026-09-18 由 workbuddy-global 记录）在 2026-09-27 的两次受控写入中被 writer 按「既有条目缺失时补记」的路径补上了本会话的 session_id 与 implementer_session_id」；去向原话：「writer 对既有 reviews 条目补记写入者身份的行为属实现层缺陷（会造成复核条目身份的错误归属），另立工单处置。」要紧之处：`reviews[].session_id` 与 `implementer_session_id` 是关闭侧独立性比对的基准（21 §10.4／§14 要求至少一条复核与实施者可比对且不同会话），补记即污染该基准，而机械层无法区分原产出身份与补记身份。"
serves: c8a2a574-b17f-47c1-b5fb-fe9bca88c97b
object_uid: a687da1f-9ecf-43c6-b7ac-4c7d45a7e8df
fact_type_key: spark
created_at: 2026-10-01T18:35:47.566Z
change_log:
  - at: 2026-10-01T18:35:47.566Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Spark 对象
  - at: 2026-10-01T18:45:36.068Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 按 Human 裁定（丙方案），以 refs 登记来源单 workcase-4af2b871 —— 该单的残留与去向记着本议题所指的 writer 补记 reviews 身份行为；使该已关闭 WorkCase 的卡面反向引用区出现本 Spark 的关联行
  - at: 2026-11-01T23:36:38.850Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: "补入 2026-11-02 只读重核节：实现侧已由 75222a4（2026-09-27）修复——stampReviewEntries 改为不作继承性补齐（isExistingEntry ? storedSessionId : sessionId），同提交另修 reviews 漏传被清空与条目数减少两处；implementer 侧由 friction-6ce193a2 于 2026-10-28 另修。存量污染仍在：4af2b871 reviews[0] 的 session_id 与 implementer_session_id 同值、来源为 null，逐提交追踪确认由 55babed 补记，且该提交晚于修复 82 秒——补记走的是绕过 writer 的直接改文件路径。四待答项中三项已有结论，第四项（存量处置）未答，故不结案。summary 未改"
refs:
  - object_uid: 4af2b871-49d2-4534-818a-beb61a6eeac9
---

# writer 补记 reviews 身份致归属失真

## 当前理解

`workcase-4af2b871` 的残留与去向里记着一处实现层缺陷：writer 在受控写入时会给既有的 `reviews` 条目补记写入者身份（本会话的 `session_id` 与 `implementer_session_id`），造成复核条目的身份错误归属——那些条目本是更早的会话产出的，被补记后会读成由本次写入者复核。载体原话：「本对象 reviews[0]（2026-09-18 由 workbuddy-global 记录）在 2026-09-27 的两次受控写入中被 writer 按「既有条目缺失时补记」的路径补上了本会话的 session_id 与 implementer_session_id」；去向原话：「writer 对既有 reviews 条目补记写入者身份的行为属实现层缺陷（会造成复核条目身份的错误归属），另立工单处置。」要紧之处：`reviews[].session_id` 与 `implementer_session_id` 是关闭侧独立性比对的基准（21 §10.4／§14 要求至少一条复核与实施者可比对且不同会话），补记即污染该基准，而机械层无法区分原产出身份与补记身份。

另有同域观察（供做时合读，不在本议题内定性）：`record_review` 的结论捕获存在竞态（子代理 `turn 1` 转场句被反复取到），两件事都在「复核条目的身份与内容如何被写入」这一面上。

### 2026-11-02 重核（只读）：实现侧已修复，存量污染仍在

> 本节给出**当前**证据；上文是记录时点叙述，未改写。

**实现侧已修（结论明确，可核）**：提交 `75222a4`（2026-09-27 12:11:30）「fix(workcase): reviews 流水不得被静默丢弃或冒名补齐」把 `stampReviewEntries` 的身份继承改为**不作继承性补齐**：

```js
// 原：const effectiveSessionId = storedSessionId ?? sessionId;
// 现：const effectiveSessionId = isExistingEntry ? storedSessionId : sessionId;
```

同一提交还修了两处同族缺陷：① `executeWorkcaseObject` 在 payload 未携带 `reviews` 时改以**落盘对象**为基线继承（此前 `next` 是 payload 克隆，漏传即把既有流水整段覆盖为空）；② `assertReviewHistoryNotRewritten` 增加「条目数减少即拒绝」。`implementer_session_id` 侧的同款问题在 `friction-6ce193a2` 残留半边另修（2026-10-28，现行 `plugin/lib/workcase-writer.js:2747-2752` 为 `isExistingEntry ? storedImplementer : implementerSessionId`）。现行实现位置：`plugin/lib/workcase-writer.js:2703` 起 `stampReviewEntries`，三处「不作继承性补齐」的注释链（`session_id`／`session_source`／`implementer_session_id`）完整保留了当初的实测依据。

**存量污染仍在，且可精确定位**：`ldvh-base/workcases/workcase-4af2b871-49d2-4534-818a-beb61a6eeac9.md` 现行 `reviews[0]` 的 `session_id` 与 `implementer_session_id` **是同一个值**（`session-31b3aef4-1398-46dd-b02c-ad06fca0ee33`），`session_source`／`implementer_session_source` 均为 `null`。该形态在关闭侧独立性判据下**不计入独立**（`comparable` 要求 `session_id !== implementer_session_id` 且两端来源俱为 `host`），即污染没有造成「假独立」，只造成该条身份失真。逐提交追踪（`git show <c>:<path>`）显示：`a988046` 首次写入该条时**无** `session_id`（当时实现尚未盖戳），`55babed`（2026-09-27 12:12:52，三份工单 Gate 2 关闭）为其补上了 session_id 与 implementer_session_id——**且该提交在修复 `75222a4` 之后 82 秒**，说明补记不是修复前的遗留，而是同一批关闭写入走的是**绕过 writer 的直接改文件路径**（该批提交只改 `ldvh-base/workcases/` 四份载体，未触碰 `plugin/lib/`）。这一条比原记录更严重：修复只覆盖经 writer 的入口，**直接改文件路径不受任何约束**。

**本议题四个待答项，现均有可执行结论**：① 补记发生在哪些入口与条件下——`stampReviewEntries` 是唯一盖戳点，调用方为 `execute`（`:3098`）与 `record_review`（`:3285`），`close` **不接受** frontmatterAfter 故不盖戳（`:3767` 注释明载）；现两入口均已改为不补齐。② 影响哪些既有条目——存量扫描：`reviews[].session_id === reviews[].implementer_session_id` 且来源为 null 的条目即为该形态，本仓已知一例（4af2b871 的 `[0]`）。③ 应改为保留原身份还是拒绝写入——已选「保留原身份、缺失即缺失」（fail-closed，与「未知不等于独立」同纪律），非拒绝写入。④ 对存量已被补记的条目如何处置——**本议题未答**：`75222a4` 只堵住新写入，未回溯清理存量，也未在规范层登记「存量失真条目如何处置」。

**故本条不能结案**：前三项已由实现回答，第四项（存量处置）既未落实现也未获 Human 裁定，而它恰是 `scope_boundary` 四项中唯一没有结论的一项。且新证据抬高了它的分量——绕过 writer 的直接改文件路径使「修复实现」不足以覆盖污染来源。

## 调查问题

writer 对既有 `reviews` 条目补记写入者身份的行为，应如何处置，才能不污染关闭侧独立性比对的基准？

## 调查边界

给出「补记发生在哪些入口与条件下、影响哪些既有条目、应改为保留原身份还是拒绝写入、对存量已被补记的条目如何处置」的可执行结论即可停；不在本议题内落实现改动，也不在本议题内决定纳入哪次行动。
