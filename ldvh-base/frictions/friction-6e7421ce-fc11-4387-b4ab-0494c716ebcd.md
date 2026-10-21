---
title: 回归用例以虚构形状编码宿主语义致修复受阻
status: open
phenomenon: 第 694-698 行稳态用例与第 702 行 rewind 用例把已注入行塞回本回合 `decision.messages`（`[...baseMessages, injected]`）构造出宿主不会产生的形状，修 41a43496 后新用例全过而旧用例第 703 行失败，修复方需先裁定「改逻辑还是改用例」。
impact: medium
object_uid: 6e7421ce-fc11-4387-b4ab-0494c716ebcd
fact_type_key: friction
created_at: 2026-10-18T19:00:30.100Z
change_log:
  - at: 2026-10-18T19:00:30.100Z
    provider: go
    model: space-bunny
    summary: 摩擦发现机械通道创建（36 §9 第 3 项）
  - at: 2026-10-19T03:51:08.542Z
    provider: go
    model: space-bunny
    summary: 补充观察：count 1 → 2（36 §9 第 2 项）
  - at: 2026-10-20T08:42:17.222Z
    provider: workbuddy
    model: space-bunny
    summary: 补充观察：count 2 → 3（36 §9 第 2 项）
  - at: 2026-10-20T08:42:17.227Z
    provider: workbuddy
    model: space-bunny
    summary: 阈值流转 observing → open（count 3 ≥ 3，36 §9 第 4 项）
occurrence:
  count: 3
  first_at: 2026-10-18T18:59:34.123Z
  last_at: 2026-10-20T08:40:59.704Z
  human_return_at: null
---

# 回归用例以虚构形状编码宿主语义致修复受阻

## 现象
第 694-698 行稳态用例与第 702 行 rewind 用例把已注入行塞回本回合 `decision.messages`（`[...baseMessages, injected]`）构造出宿主不会产生的形状，修 41a43496 后新用例全过而旧用例第 703 行失败，修复方需先裁定「改逻辑还是改用例」。

## 入账依据
可归因性：夹具里「批次里没有行 ⇒ 发生了 rewind」与宿主真实语义「`decision.messages` 只含本回合装配结果」不一致，而该不一致正是生产缺陷同源的前提——错误前提同时被生产代码和测试固化，故缺陷直到修复时才暴露；修复预期收益：若验证装置按宿主真实形状构造、并以 `agent/created` 的 `source` 作重置权威信号，缺陷会在写用例阶段即暴露，修复后也不必再人工裁定该改逻辑还是改用例（本次已付出该裁定成本）。

补充观察（2026-10-19T03:49:54.450Z）：引证显示：本次把一条新的机械判据挂上 validateMessage 后，首先炸开的不是产品代码，而是既有回归/预检用例——因为这些用例一直拿英文 header（`chore(code): fine header`、`fix: x`）当作「合法提交」的代表样本，即用一种与真实要求相冲突的占位形状编码了宿主语义。材料随后显示修复被迫绕着这些用例走：先改 8 处夹具描述，再靠基线对比才发现「**我引入了 4 个新失败**，都在 `ldvh-tools.test.mjs` 的 precheck 用例中」，最后才是「128/128 全通过」。这与既有账目 uid=6e7421ce「回归用例以虚构形状编码宿主语义致修复受阻」是同一阻碍：同一处（回归/预检夹具）、同一机制（夹具样本形状与真实语义不符）、同一后果（修复受阻、须分轮返工），故判 same-obstacle 而非新建。注意本次引证同时显示断言未被改成恒真（材料称「断言逻辑不变」），因此不归入 uid=287d656c「夹具同步化致自测断言恒真」。

补充观察（2026-10-20T08:40:59.704Z）：材料中独立复核段记述：后台子代理给出结论「建议不关闭」，其中发现 1&2 是助手自己写出的失败测试——测试错误假设 `data.fact_object` 存在，而 facts.ts 会将其展平；这正是既有账目 friction-6e7421ce「回归用例以虚构形状编码宿主语义致修复受阻」的同一机制：测试把宿主的真实返回形状记成了另一种形状，失败使复核不予关闭、修复受阻。故判为 same-obstacle 并指向该 uid，occurrence 计数与 observing→open 的流转交由机械层完成，我不作数量判断、影响评级或销账决定。需要说明：本次材料因长度上限被截断（止于「Gate 2」），我只能就所见片段判断；材料中另有「仅 Friction 有缺陷（attribution_ref 对象形式被静默丢弃）」与「发现 3（坏对象被静默投影）」等片段未在既有账目中找到同机制条目，因只能给出单一判定，我未据其另立 new-obstacle，以免以未经比对的推断顶替可回指的同机制命中。
