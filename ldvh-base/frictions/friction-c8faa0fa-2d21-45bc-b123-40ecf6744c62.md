---
title: blocked 状态未阻却目标自动续轮
status: observing
phenomenon: 目标被置为 blocked 后仍被自动重新激活为 active/armed，连续两轮重复同一轮次且不产生实质进展。
impact: medium
object_uid: c8faa0fa-2d21-45bc-b123-40ecf6744c62
fact_type_key: friction
created_at: 2026-10-19T06:34:54.442Z
change_log:
  - at: 2026-10-19T06:34:54.442Z
    provider: workbuddy
    model: space-bunny
    summary: 摩擦发现机械通道创建（36 §9 第 3 项）
occurrence:
  count: 1
  first_at: 2026-10-19T06:34:44.420Z
  last_at: 2026-10-19T06:34:44.420Z
  human_return_at: null
---

# blocked 状态未阻却目标自动续轮

## 现象
目标被置为 blocked 后仍被自动重新激活为 active/armed，连续两轮重复同一轮次且不产生实质进展。

## 入账依据
可归因于 blocked 状态机与目标自动续做之间的缺口：状态写成 blocked 并不构成对自动续轮的阻断，缺少一个「以 blocked 为终态、不得被重新 arm」的机械约束；修好可避免叫停后仍反复消耗轮次并向用户重复同一提问。
