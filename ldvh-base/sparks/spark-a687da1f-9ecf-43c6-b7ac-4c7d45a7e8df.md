---
title: writer 补记 reviews 身份致归属失真
status: open
question: writer 对既有 `reviews` 条目补记写入者身份的行为，应如何处置，才能不污染关闭侧独立性比对的基准？
scope_boundary: 给出「补记发生在哪些入口与条件下、影响哪些既有条目、应改为保留原身份还是拒绝写入、对存量已被补记的条目如何处置」的可执行结论即可停；不在本议题内落实现改动，也不在本议题内决定纳入哪次行动。
intent: 复核身份是关闭侧独立性判定的机械基准，被补记即失真且机械层不可辨。收敛为 Spark 以便跨行动处置（含存量已被补记的条目如何如实登记）。
summary: "`workcase-4af2b871` 的残留与去向里记着一处实现层缺陷：writer 在受控写入时会给既有的 `reviews` 条目补记写入者身份（本会话的 `session_id` 与 `implementer_session_id`），造成复核条目的身份错误归属——那些条目本是更早的会话产出的，被补记后会读成由本次写入者复核。载体原话：「本对象 reviews[0]（2026-09-18 由 workbuddy-global 记录）在 2026-09-27 的两次受控写入中被 writer 按「既有条目缺失时补记」的路径补上了本会话的 session_id 与 implementer_session_id」；去向原话：「writer 对既有 reviews 条目补记写入者身份的行为属实现层缺陷（会造成复核条目身份的错误归属），另立工单处置。」要紧之处：`reviews[].session_id` 与 `implementer_session_id` 是关闭侧独立性比对的基准（21 §10.4／§14 要求至少一条复核与实施者可比对且不同会话），补记即污染该基准，而机械层无法区分原产出身份与补记身份。"
serves: SG-3
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
refs:
  - object_uid: 4af2b871-49d2-4534-818a-beb61a6eeac9
---

# writer 补记 reviews 身份致归属失真

## 当前理解

`workcase-4af2b871` 的残留与去向里记着一处实现层缺陷：writer 在受控写入时会给既有的 `reviews` 条目补记写入者身份（本会话的 `session_id` 与 `implementer_session_id`），造成复核条目的身份错误归属——那些条目本是更早的会话产出的，被补记后会读成由本次写入者复核。载体原话：「本对象 reviews[0]（2026-09-18 由 workbuddy-global 记录）在 2026-09-27 的两次受控写入中被 writer 按「既有条目缺失时补记」的路径补上了本会话的 session_id 与 implementer_session_id」；去向原话：「writer 对既有 reviews 条目补记写入者身份的行为属实现层缺陷（会造成复核条目身份的错误归属），另立工单处置。」要紧之处：`reviews[].session_id` 与 `implementer_session_id` 是关闭侧独立性比对的基准（21 §10.4／§14 要求至少一条复核与实施者可比对且不同会话），补记即污染该基准，而机械层无法区分原产出身份与补记身份。

另有同域观察（供做时合读，不在本议题内定性）：`record_review` 的结论捕获存在竞态（子代理 `turn 1` 转场句被反复取到），两件事都在「复核条目的身份与内容如何被写入」这一面上。

## 调查问题

writer 对既有 `reviews` 条目补记写入者身份的行为，应如何处置，才能不污染关闭侧独立性比对的基准？

## 调查边界

给出「补记发生在哪些入口与条件下、影响哪些既有条目、应改为保留原身份还是拒绝写入、对存量已被补记的条目如何处置」的可执行结论即可停；不在本议题内落实现改动，也不在本议题内决定纳入哪次行动。
