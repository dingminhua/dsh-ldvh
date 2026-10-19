---
title: 已推送提交 message 更正无规范路径
status: observing
phenomenon: specs/09 §5.5 只规定「非 passed 即阻断、不得 --no-verify」，未为「已推送的 message 更正」定义任何路径；而该提交已被事实载体引用，机械改写即制造新的悬空引用。
impact: medium
object_uid: 3fe3bc23-dc82-48ed-b12e-660d1bf53903
fact_type_key: friction
created_at: 2026-10-19T02:44:05.079Z
change_log:
  - at: 2026-10-19T02:44:05.079Z
    provider: go
    model: space-bunny
    summary: 摩擦发现机械通道创建（36 §9 第 3 项）
occurrence:
  count: 1
  first_at: 2026-10-19T02:43:11.627Z
  last_at: 2026-10-19T02:43:11.627Z
  human_return_at: null
---

# 已推送提交 message 更正无规范路径

## 现象
specs/09 §5.5 只规定「非 passed 即阻断、不得 --no-verify」，未为「已推送的 message 更正」定义任何路径；而该提交已被事实载体引用，机械改写即制造新的悬空引用。

## 入账依据
可归因：阻断点可精确定位到 specs/09 §5.5 的条文缺项（只定义 Gate 阻断，未定义更正路径），非操作失误、非模型疏忽。若补上「已推送提交 message 更正」的规范路径（如强制补记提交形态、载体引用同步更正流程、force-push 需 Human Gate 显式授权），同类动作即可在不制造悬空引用的前提下收口。
