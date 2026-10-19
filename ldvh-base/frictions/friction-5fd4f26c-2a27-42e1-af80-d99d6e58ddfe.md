---
title: 受控写入拒收正文自带 H1
status: observing
phenomenon: 向 spark 载体写入补记时因正文多写一个与 title 同名的一级标题而被门禁拒绝，需返工重写。
impact: light
object_uid: 5fd4f26c-2a27-42e1-af80-d99d6e58ddfe
fact_type_key: friction
created_at: 2026-10-19T15:40:36.584Z
change_log:
  - at: 2026-10-19T15:40:36.584Z
    provider: workbuddy
    model: space-bunny
    summary: 摩擦发现机械通道创建（36 §9 第 3 项）
occurrence:
  count: 1
  first_at: 2026-10-19T15:40:06.541Z
  last_at: 2026-10-19T15:40:06.541Z
  human_return_at: null
---

# 受控写入拒收正文自带 H1

## 现象
向 spark 载体写入补记时因正文多写一个与 title 同名的一级标题而被门禁拒绝，需返工重写。

## 入账依据
写入侧以「恰好 1 个 H1」机械拒收，撰写侧无法从错误信息直接得知 H1 由 title 生成，只能靠一次返工改正；可归因且改正路径明确。
