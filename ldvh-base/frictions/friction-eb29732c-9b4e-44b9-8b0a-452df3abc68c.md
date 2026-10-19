---
title: 平台条件跳过致修复在主力平台零覆盖
status: observing
phenomenon: 整条用例因平台条件在非 Windows 平台整条跳过，导致其中的 realpath 解析修复在 macOS/Linux 上从未被执行过一次。
impact: medium
object_uid: eb29732c-9b4e-44b9-8b0a-452df3abc68c
fact_type_key: friction
created_at: 2026-10-19T04:10:11.140Z
change_log:
  - at: 2026-10-19T04:10:11.140Z
    provider: go
    model: space-bunny
    summary: 摩擦发现机械通道创建（36 §9 第 3 项）
occurrence:
  count: 1
  first_at: 2026-10-19T04:09:31.147Z
  last_at: 2026-10-19T04:09:31.147Z
  human_return_at: null
---

# 平台条件跳过致修复在主力平台零覆盖

## 现象
整条用例因平台条件在非 Windows 平台整条跳过，导致其中的 realpath 解析修复在 macOS/Linux 上从未被执行过一次。

## 入账依据
可归因性：跳过条件挂在整条用例级（process.platform !== "win32"），而用例前半段断言的是修复本身（watcher 监听 realpath 解析后的目标）这一与平台无关的性质，故被一并跳过——材料同段亦确认「前半段的修复逻辑本身可以跨平台验证」。修了会更好的预期：把可跨平台断言的部分拆成跨平台用例后，该修复在主力开发平台即可获得回归保护，同类平台条件跳过的用例也不再留下同类空白。
