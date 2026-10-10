---
title: 测试全绿信号无法担保路径被走过
status: observing
phenomenon: 全套 1283 条测试全绿、且经三次独立复核通过，但 lifecycle.js 的落地路径上仍有一行每次运行都抛 ReferenceError 的代码。
impact: heavy
object_uid: 545cca82-d83e-488a-99bd-04ad8ef51bcb
fact_type_key: friction
created_at: 2026-10-10T21:04:59.835Z
change_log:
  - at: 2026-10-10T21:04:59.835Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 摩擦发现机械通道创建（04 §8.4 第 3 项）
occurrence:
  count: 1
  first_at: 2026-10-10T21:04:17.494Z
  last_at: 2026-10-10T21:04:17.494Z
  human_return_at: null
---

# 测试全绿信号无法担保路径被走过

## 现象
全套 1283 条测试全绿、且经三次独立复核通过，但 lifecycle.js 的落地路径上仍有一行每次运行都抛 ReferenceError 的代码。

## 入账依据
可归因性：测试是围绕**被调用方**（runIdleCheckpoint、landDiscoveryVerdict）组织的，而**调用方**（lifecycle.js 的 onSessionCheckpoint 回调）从未被驱动——故「全绿」在结构上就排除了接线层缺陷这一整类。修了会更好的预期：补上调用方覆盖后，D8 会在第一次运行就被抓住，且此后每一次改动的「全绿」都能对接线本身作出保证，而不只是对被调用的函数。
