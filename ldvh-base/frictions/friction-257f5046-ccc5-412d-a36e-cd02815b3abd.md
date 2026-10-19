---
title: 机械判据未覆盖的属性在修轴中静默漂移
status: observing
phenomenon: 修复已被报告的 header 格式轴时，同一动作把从未被报告的 header 语言轴从中文换成英文，此后任何一次校验都不再提起该轴。
impact: medium
object_uid: 257f5046-ccc5-412d-a36e-cd02815b3abd
fact_type_key: friction
created_at: 2026-10-19T02:38:42.720Z
change_log:
  - at: 2026-10-19T02:38:42.720Z
    provider: go
    model: space-bunny
    summary: 摩擦发现机械通道创建（36 §9 第 3 项）
occurrence:
  count: 1
  first_at: 2026-10-19T02:37:54.213Z
  last_at: 2026-10-19T02:37:54.213Z
  human_return_at: null
---

# 机械判据未覆盖的属性在修轴中静默漂移

## 现象
修复已被报告的 header 格式轴时，同一动作把从未被报告的 header 语言轴从中文换成英文，此后任何一次校验都不再提起该轴。

## 入账依据
材料指出 header 格式的机械判据只管「长度/ASCII/首行形状」，不覆盖语言轴，故该漂移在机制上不可被拦截，且后续校验永不重提、可归因于判据覆盖边界而非偶发；把未被报告的属性纳入判据或固定候选重写来源后，同类漂移可被机械拦下，修与不修的差别明确。
