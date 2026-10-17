---
title: 准入路由询问被静默代答致准入判断失效
status: observing
phenomenon: 准入路由询问（21 §6.3）在真实运行中未弹出任何弹窗，create 仍返回 granted:true 并完成对象落盘，且 seam 无法区分答案来源。
impact: heavy
object_uid: 3defc0c4-81c1-422e-af4d-ff59ef691b46
fact_type_key: friction
created_at: 2026-10-17T03:06:18.180Z
change_log:
  - at: 2026-10-17T03:06:18.180Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 摩擦发现机械通道创建（04 §8.4 第 3 项）
occurrence:
  count: 1
  first_at: 2026-10-17T03:05:50.596Z
  last_at: 2026-10-17T03:05:50.596Z
  human_return_at: null
---

# 准入路由询问被静默代答致准入判断失效

## 现象
准入路由询问（21 §6.3）在真实运行中未弹出任何弹窗，create 仍返回 granted:true 并完成对象落盘，且 seam 无法区分答案来源。

## 入账依据
可归因于 hostSeam 的授权判定实现（只校验答案标签、不校验答案来源与是否真的经由宿主提问），不属任何既有账目条目；修正该判定后，凡经 create/受控写入触发的准入询问都会恢复为可等待、可追溯，预期收益明确。
