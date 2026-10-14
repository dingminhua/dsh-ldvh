---
title: 摩擦账本待修口径滞后实现致核销欠账积压
status: observing
phenomenon: 盘点时发现约9笔疑似「已修未销」——修复提交已在仓里，账目却仍挂在待修口径中，且待修口径随发生次数自行变长
impact: light
object_uid: c2433ad5-ff09-4caa-a99f-81a759daff15
fact_type_key: friction
created_at: 2026-10-13T21:16:14.624Z
change_log:
  - at: 2026-10-13T21:16:14.624Z
    provider: ds41
    model: deepseek-v4.1-flash
    summary: 摩擦发现机械通道创建（04 §8.4 第 3 项）
occurrence:
  count: 1
  first_at: 2026-10-13T21:15:13.937Z
  last_at: 2026-10-13T21:15:13.937Z
  human_return_at: null
---

# 摩擦账本待修口径滞后实现致核销欠账积压

## 现象
盘点时发现约9笔疑似「已修未销」——修复提交已在仓里，账目却仍挂在待修口径中，且待修口径随发生次数自行变长

## 入账依据
主控盘活账时取证发现约9笔候选「修复提交已在仓里，账目却仍挂在待修口径中」，被明确归为「核销欠账」而非新工作量；其可归因于账本维护与实现落地的脱节，若能在修复落库时同步收敛账面，会使待修口径更可信、避免把已修项误当待修派活。
