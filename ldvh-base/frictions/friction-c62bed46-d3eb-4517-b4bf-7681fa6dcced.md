---
title: 工具面参数校验层不生效致假设落空
status: observing
phenomenon: LDVH 全部工具的入参 schema 校验不生效：schema 明令禁止的字段照样抵达 handler，写入器闭集校验成了实际生效的最后一道防线。
impact: heavy
object_uid: c62bed46-d3eb-4517-b4bf-7681fa6dcced
fact_type_key: friction
created_at: 2026-10-19T04:28:49.131Z
change_log:
  - at: 2026-10-19T04:28:49.131Z
    provider: go
    model: space-bunny
    summary: 摩擦发现机械通道创建（36 §9 第 3 项）
occurrence:
  count: 1
  first_at: 2026-10-19T04:27:45.264Z
  last_at: 2026-10-19T04:27:45.264Z
  human_return_at: null
---

# 工具面参数校验层不生效致假设落空

## 现象
LDVH 全部工具的入参 schema 校验不生效：schema 明令禁止的字段照样抵达 handler，写入器闭集校验成了实际生效的最后一道防线。

## 入账依据
可归因性——缺口位置可指到具体注册路径与具体代码环节：插件侧只有 ctx.tools.register(toolDescriptorFor(...)) 这一形态，DSH 侧校验只存在于 defineTool 闭包内，两者不相交，因此「工具面会拦」这一前提在 LDVH 全域为假而非某一工具的偶发失效；实际危害已落到事实源上（b9601356 的成因描述需随之修订），说明它已产生错误记录而非仅是理论风险。修了会更有的预期——只要把 LDVH 工具接入 defineTool、或在 LDVH 侧补一层显式校验，schema 立刻生效，此后任何以「工具面会拦」为假设的设计与记录都会在写入前被挡住，正在修订的记录不必逐条回溯。
