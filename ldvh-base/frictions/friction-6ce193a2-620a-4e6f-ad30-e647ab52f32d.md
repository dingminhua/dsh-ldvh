---
title: 受控写入补记身份致复核归属失真
status: observing
phenomenon: 受控写入器在既有 reviews 条目缺失身份字段时，以本次写入会话的 session_id/implementer_session_id 补记，使复核条目被归属为补记者所有
impact: medium
object_uid: 6ce193a2-620a-4e6f-ad30-e647ab52f32d
fact_type_key: friction
created_at: 2026-10-19T16:33:36.006Z
change_log:
  - at: 2026-10-19T16:33:36.006Z
    provider: workbuddy
    model: space-bunny
    summary: 摩擦发现机械通道创建（36 §9 第 3 项）
  - at: 2026-10-19T16:46:11.232Z
    provider: workbuddy
    model: space-bunny
    summary: 补充观察：count 1 → 2（36 §9 第 2 项）
occurrence:
  count: 2
  first_at: 2026-10-19T16:33:31.449Z
  last_at: 2026-10-19T16:46:05.992Z
  human_return_at: null
---

# 受控写入补记身份致复核归属失真

## 现象
受控写入器在既有 reviews 条目缺失身份字段时，以本次写入会话的 session_id/implementer_session_id 补记，使复核条目被归属为补记者所有

## 入账依据
该阻碍会持续污染 Gate 2 独立性判定的机械基准且存量不可复原，机械层无法区分原产出身份与事后补记身份；修复它可让独立复核的机械校验重新具备判别力。既有账本中最接近的 friction-2de1387a「reviews 字段无法写入致 Gate 2 收口卡死」机制相反（写不进去 vs 写错身份），不是同一阻碍。

补充观察（2026-10-19T16:46:05.992Z）：材料记载受控写入的盖戳逻辑对既有条目缺失身份字段时仍以本次写入会话回填，污染 Gate 2 独立复核的比对基准；这与既有账目 friction-6ce193a2「受控写入补记身份致复核归属失真」是同一阻碍（同机制再复现，implementer 侧残留）。注意材料因长度上限在 turn 3 中途被截断，判断只基于所见部分。
