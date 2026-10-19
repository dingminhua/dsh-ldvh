---
title: 回归用例以虚构形状编码宿主语义致修复受阻
status: observing
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
occurrence:
  count: 2
  first_at: 2026-10-18T18:59:34.123Z
  last_at: 2026-10-19T03:49:54.450Z
  human_return_at: null
---

# 回归用例以虚构形状编码宿主语义致修复受阻

## 现象
第 694-698 行稳态用例与第 702 行 rewind 用例把已注入行塞回本回合 `decision.messages`（`[...baseMessages, injected]`）构造出宿主不会产生的形状，修 41a43496 后新用例全过而旧用例第 703 行失败，修复方需先裁定「改逻辑还是改用例」。

## 入账依据
可归因性：夹具里「批次里没有行 ⇒ 发生了 rewind」与宿主真实语义「`decision.messages` 只含本回合装配结果」不一致，而该不一致正是生产缺陷同源的前提——错误前提同时被生产代码和测试固化，故缺陷直到修复时才暴露；修复预期收益：若验证装置按宿主真实形状构造、并以 `agent/created` 的 `source` 作重置权威信号，缺陷会在写用例阶段即暴露，修复后也不必再人工裁定该改逻辑还是改用例（本次已付出该裁定成本）。

补充观察（2026-10-19T03:49:54.450Z）：引证显示：本次把一条新的机械判据挂上 validateMessage 后，首先炸开的不是产品代码，而是既有回归/预检用例——因为这些用例一直拿英文 header（`chore(code): fine header`、`fix: x`）当作「合法提交」的代表样本，即用一种与真实要求相冲突的占位形状编码了宿主语义。材料随后显示修复被迫绕着这些用例走：先改 8 处夹具描述，再靠基线对比才发现「**我引入了 4 个新失败**，都在 `ldvh-tools.test.mjs` 的 precheck 用例中」，最后才是「128/128 全通过」。这与既有账目 uid=6e7421ce「回归用例以虚构形状编码宿主语义致修复受阻」是同一阻碍：同一处（回归/预检夹具）、同一机制（夹具样本形状与真实语义不符）、同一后果（修复受阻、须分轮返工），故判 same-obstacle 而非新建。注意本次引证同时显示断言未被改成恒真（材料称「断言逻辑不变」），因此不归入 uid=287d656c「夹具同步化致自测断言恒真」。
