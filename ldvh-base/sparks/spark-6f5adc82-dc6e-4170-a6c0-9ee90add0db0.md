---
title: Norm 类型实现侧空缺
status: open
question: "`ldvh-base/norms/` 实现侧（目录、FACT_DIRECTORIES、writer、Git Gate 断言）应如何建成？"
scope_boundary: Norm 可受控创建、可召回、Git Gate 覆盖时停止。
intent: 保留理由——C11 为 `[未承接]` 的实现缺口：规范已定稿但承载层全空，Norm 目前无法实际出生。注：本条未来最可能被消化为 WorkCase（含执行计划与验收）。
summary: "`fact-norm-design-consolidated` C11 原文「实现侧**全部未建**」：`ldvh-base/norms/` 不存在（本仓已建空目录）、`FACT_DIRECTORIES`/`FACT_TYPES` 无 Norm、无 writer、无 Git Gate 断言。已承接部分：27 号规范正文已定稿并登记（C1/C3/C5/C6/C7/C8/C9）。未建部分属承载层，须与既有五类对象的受控写入管线、F0–F4 召回、Git Gate 断言对齐。"
serves: SG-1
object_uid: 6f5adc82-dc6e-4170-a6c0-9ee90add0db0
fact_type_key: spark
created_at: 2026-09-12T21:46:15.352Z
change_log:
  - at: 2026-09-12T21:46:15.352Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Spark 对象
---

# Norm 类型实现侧空缺

## 当前理解

`fact-norm-design-consolidated` C11 原文「实现侧**全部未建**」：`ldvh-base/norms/` 不存在（本仓已建空目录）、`FACT_DIRECTORIES`/`FACT_TYPES` 无 Norm、无 writer、无 Git Gate 断言。已承接部分：27 号规范正文已定稿并登记（C1/C3/C5/C6/C7/C8/C9）。未建部分属承载层，须与既有五类对象的受控写入管线、F0–F4 召回、Git Gate 断言对齐。

（来源：docs/fact-norm-design-consolidated.md §0 C11、§8）

## 调查问题

`ldvh-base/norms/` 实现侧（目录、FACT_DIRECTORIES、writer、Git Gate 断言）应如何建成？

## 调查边界

Norm 可受控创建、可召回、Git Gate 覆盖时停止。
