---
title: 入队返回值被丢弃致登记静默失败
status: observing
phenomenon: "`await appendPendingEntry(...)` 的返回值被直接丢弃，调用方不处理 `{ok:false}`，导致队列写入失败后登记静默丢失。"
impact: heavy
object_uid: 09ff06a3-d1bf-423c-8e5c-46e31aac1169
fact_type_key: friction
created_at: 2026-10-17T19:54:04.730Z
change_log:
  - at: 2026-10-17T19:54:04.730Z
    provider: xiaomi-token-plan-cn
    model: mimo-v2.6-flash
    summary: 摩擦发现机械通道创建（36 §9 第 3 项）
occurrence:
  count: 1
  first_at: 2026-10-17T19:53:07.342Z
  last_at: 2026-10-17T19:53:07.342Z
  human_return_at: null
---

# 入队返回值被丢弃致登记静默失败

## 现象
`await appendPendingEntry(...)` 的返回值被直接丢弃，调用方不处理 `{ok:false}`，导致队列写入失败后登记静默丢失。

## 入账依据
可归因：pending-queue.js 明文要求「调用方必须处理失败」，且 7 个调用点全部丢弃返回值；修了会让入队失败被显式捕获并 fail-closed 上报，消除「看起来登记了实际没登记」的静默缺口。
