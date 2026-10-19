---
title: 写入侧与呈现层两套残留段解析规则
status: observing
phenomenon: 同一份工单结果节在页面上可读出四条残留，写入门禁却判为 0 条致关闭被拒，且修复时对结果节的改写与 Human 批准时所见不是同一形态
impact: medium
object_uid: 124adb76-baf9-41ca-8e22-2d7c3ab33a14
fact_type_key: friction
created_at: 2026-10-19T13:26:12.601Z
change_log:
  - at: 2026-10-19T13:26:12.601Z
    provider: workbuddy
    model: space-bunny
    summary: 摩擦发现机械通道创建（36 §9 第 3 项）
  - at: 2026-10-19T13:38:59.825Z
    provider: workbuddy
    model: space-bunny
    summary: 补充观察：count 1 → 2（36 §9 第 2 项）
occurrence:
  count: 2
  first_at: 2026-10-19T13:25:57.072Z
  last_at: 2026-10-19T13:38:50.793Z
  human_return_at: null
---

# 写入侧与呈现层两套残留段解析规则

## 现象
同一份工单结果节在页面上可读出四条残留，写入门禁却判为 0 条致关闭被拒，且修复时对结果节的改写与 Human 批准时所见不是同一形态

## 入账依据
该错位可归因于写入侧与呈现层解析规则分叉这一机制，且使关闭门禁的判据与 Human 实际看到的内容不一致；补齐写入侧形态对齐（或统一到单一解析）可消除该类撞门禁与所见非所批的反复。

补充观察（2026-10-19T13:38:50.793Z）：材料 turn 30 明确指出「残留段」结构在写入侧 plugin/lib/workcase-writer.js 与呈现层 plugin/web/shared/workcaseResultDraft.ts 存在两个独立实现、各自演化，同一份正文可得出不同条数——这与既有账目 friction-124adb76「写入侧与呈现层两套残留段解析规则」的机制表述逐字对应，属同一阻碍的再次发生，故判为 same-obstacle 而非新入账。附带说明：材料中另有「打开期零校验」现象（§15.1 五道门禁仅在 status=closed 判定），但它与本条同属该缺陷簇的次生面，且本次未对账目做增删判断，故不单列。材料因长度上限被截断（turn 29 结尾句子断在 `re`），判断仅就所见部分作出。
