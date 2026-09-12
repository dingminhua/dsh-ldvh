---
title: 管辖判定操作的名实错配
status: open
question: "`resolve-governance-scope` 命名与实际判定语义（项目资格 vs 工作范围）错配应如何消解？"
scope_boundary: 命名或语义表述定案并同步到 07 与实现时停止。
intent: 保留理由——名实不一致会让后续消费者误以为该操作返回「管辖范围」，而它实际回答的是项目资格；属可独立分流的轻量方向。
summary: '`read-dimension-understanding.md` §0.1 指出命名与语义错配：操作名 `resolve-governance-scope` 用 "scope"（范围）命名，但实际判定的是「项目是否在列表」（项目资格）。原文建议语义上明确：**scope 判定 = 项目资格判定，范围定义 = 工作对象边界**；命名可考虑更清晰表述。相关规范：07 §5.3（三态判定）、07 §6（管辖范围=Git 根 + `ldvh-base/` + `specs/`）。本条与 A-10（读维设计输入）question 不同：后者是整体落地，本条是单一操作的名实一致性。'
serves: SG-1
object_uid: 64ae68ac-4294-4ed7-9c46-2d5ba4afbd31
fact_type_key: spark
created_at: 2026-09-12T21:46:36.301Z
change_log:
  - at: 2026-09-12T21:46:36.301Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Spark 对象
---

# 管辖判定操作的名实错配

## 当前理解

`read-dimension-understanding.md` §0.1 指出命名与语义错配：操作名 `resolve-governance-scope` 用 "scope"（范围）命名，但实际判定的是「项目是否在列表」（项目资格）。原文建议语义上明确：**scope 判定 = 项目资格判定，范围定义 = 工作对象边界**；命名可考虑更清晰表述。相关规范：07 §5.3（三态判定）、07 §6（管辖范围=Git 根 + `ldvh-base/` + `specs/`）。本条与 A-10（读维设计输入）question 不同：后者是整体落地，本条是单一操作的名实一致性。

（来源：docs/read-dimension-understanding.md §0.1）

## 调查问题

`resolve-governance-scope` 命名与实际判定语义（项目资格 vs 工作范围）错配应如何消解？

## 调查边界

命名或语义表述定案并同步到 07 与实现时停止。
