---
title: 待处置队列无生产侧消费方致积压不消账
status: observing
phenomenon: "`pending-queue.jsonl` 持续累积未处置条目，生产代码中不存在任何消费该队列的路径（`resolvePendingEntry` 全仓仅被测试调用）"
impact: medium
object_uid: fa60695b-b7e2-4cda-a93e-463bdffccff4
fact_type_key: friction
created_at: 2026-10-19T06:11:00.797Z
change_log:
  - at: 2026-10-19T06:11:00.797Z
    provider: workbuddy
    model: space-bunny
    summary: 摩擦发现机械通道创建（36 §9 第 3 项）
occurrence:
  count: 1
  first_at: 2026-10-19T06:10:32.074Z
  last_at: 2026-10-19T06:10:32.074Z
  human_return_at: null
---

# 待处置队列无生产侧消费方致积压不消账

## 现象
`pending-queue.jsonl` 持续累积未处置条目，生产代码中不存在任何消费该队列的路径（`resolvePendingEntry` 全仓仅被测试调用）

## 入账依据
可归因于生产代码中缺失消费路径而非任何单次执行失败；材料明示该缺口至今未修，修好可消解 §12 入队积压导致的静默失败与统计失真，符合「修了会更好的预期」。
