---
title: 回归用例以虚构形状编码宿主语义致修复受阻
status: resolved
phenomenon: 第 694-698 行稳态用例与第 702 行 rewind 用例把已注入行塞回本回合 `decision.messages`（`[...baseMessages, injected]`）构造出宿主不会产生的形状，修 41a43496 后新用例全过而旧用例第 703 行失败，修复方需先裁定「改逻辑还是改用例」。
impact: medium
relations:
  - relation_key: informs
    target:
      commit: aa1b4ffe61e575972b910711fcd946d94c81e54d
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
  - at: 2026-10-28T04:48:00.000Z
    provider: dsh
    model: mimo-v2.6-flash
    summary: 状态流转 open→resolved：解药为 commit aa1b4ff（06 §5「断言须以被测面的真实形状为准」通则＋§7 验证行，机制被点名吸收为规范禁令），本账「夹具虚构形状致修复受阻」的机制面已获规范承载
occurrence:
  count: 3
  first_at: 2026-10-18T18:59:34.123Z
  last_at: 2026-10-20T08:40:59.704Z
---

# 回归用例以虚构形状编码宿主语义致修复受阻

## 现象
第 694-698 行稳态用例与第 702 行 rewind 用例把已注入行塞回本回合 `decision.messages`（`[...baseMessages, injected]`）构造出宿主不会产生的形状，修 41a43496 后新用例全过而旧用例第 703 行失败，修复方需先裁定「改逻辑还是改用例」。

## 入账依据
可归因性：夹具里「批次里没有行 ⇒ 发生了 rewind」与宿主真实语义「`decision.messages` 只含本回合装配结果」不一致，而该不一致正是生产缺陷同源的前提——错误前提同时被生产代码和测试固化，故缺陷直到修复时才暴露；修复预期收益：若验证装置按宿主真实形状构造、并以 `agent/created` 的 `source` 作重置权威信号，缺陷会在写用例阶段即暴露，修复后也不必再人工裁定该改逻辑还是改用例（本次已付出该裁定成本）。

补充观察（2026-10-19T03:49:54.450Z）：引证显示：本次把一条新的机械判据挂上 validateMessage 后，首先炸开的不是产品代码，而是既有回归/预检用例——因为这些用例一直拿英文 header（`chore(code): fine header`、`fix: x`）当作「合法提交」的代表样本，即用一种与真实要求相冲突的占位形状编码了宿主语义。材料随后显示修复被迫绕着这些用例走：先改 8 处夹具描述，再靠基线对比才发现「**我引入了 4 个新失败**，都在 `ldvh-tools.test.mjs` 的 precheck 用例中」，最后才是「128/128 全通过」。这与既有账目 uid=6e7421ce「回归用例以虚构形状编码宿主语义致修复受阻」是同一阻碍：同一处（回归/预检夹具）、同一机制（夹具样本形状与真实语义不符）、同一后果（修复受阻、须分轮返工），故判 same-obstacle 而非新建。注意本次引证同时显示断言未被改成恒真（材料称「断言逻辑不变」），因此不归入 uid=287d656c「夹具同步化致自测断言恒真」。

补充观察（2026-10-20T08:40:59.704Z）：材料中独立复核段记述：后台子代理给出结论「建议不关闭」，其中发现 1&2 是助手自己写出的失败测试——测试错误假设 `data.fact_object` 存在，而 facts.ts 会将其展平；这正是既有账目 friction-6e7421ce「回归用例以虚构形状编码宿主语义致修复受阻」的同一机制：测试把宿主的真实返回形状记成了另一种形状，失败使复核不予关闭、修复受阻。故判为 same-obstacle 并指向该 uid，occurrence 计数与 observing→open 的流转交由机械层完成，我不作数量判断、影响评级或销账决定。需要说明：本次材料因长度上限被截断（止于「Gate 2」），我只能就所见片段判断；材料中另有「仅 Friction 有缺陷（attribution_ref 对象形式被静默丢弃）」与「发现 3（坏对象被静默投影）」等片段未在既有账目中找到同机制条目，因只能给出单一判定，我未据其另立 new-obstacle，以免以未经比对的推断顶替可回指的同机制命中。

## 处置
解药为 commit 级承载 `aa1b4ffe61e575972b910711fcd946d94c81e54d`（docs(specs): 补写形状断言通则，并登记三轮审核与遗留，2026-10-28；解药走直提路径、无对应 ADR/WorkCase 事实对象，依 02 §8.1 commit 形态承载 informs）。06 §5 立「断言须以被测面的真实形状为准」：先读该面实现确认真实形状；区分「路径取值抛错」与「否定式写法静默通过」；否定式断言按两类形状分别取判据（合法位移者在应在位置断言，必须整体缺席者断言同级在场并钉缺席位置集合，不得为其配正向存在断言）；检测力靠单项变异判定。§7 补「形状断言有效性」验证行（四条成立条件、变异记录作依据、可证明范围限定当次夹具）。这正是本账三次观察所指机制的点名吸收：本账初笔的「`[...baseMessages, injected]` 虚构形状」、2026-10-19 观察的「英文 header 占位样本」、2026-10-20 观察的「`data.fact_object` 记错形状」，同属「夹具样本形状与被测面真实形状不符」，现已被该通则逐类覆盖。

核验（2026-10-28）：① 条文与 §7 验证行均在 HEAD（`specs/06-Code 实践与测试规范.md`）；② 吸收登记在 HEAD（`ldvh-base/pitfalls/pitfall-8cbde9ed`，三轮审核轨迹与三项停审遗留按 23 §12 登记）；③ 本账初笔点名的两处用例现状已变，按实测分说：rewind 用例不再靠「批次里没有行」推断 rewind，改为显式清台账（`handler.resetVisibility()`），注释明记真实信号是 `agent/created` 的 `payload.source ∈ clear|compact|resume`（`plugin/test/lifecycle.test.mjs`，承 friction-41a43496）；稳态用例仍构造批次含已注入行的形状，但该分支现已是被测面的**设计判据之一**（`plugin/lib/guidance.js`「仍在视图：本批次里能直接看到 → 刷新文本即可」，对应插件多实例装载时 `next()` 返回值已含更内层实例追加行的真实场景，2026-10-27 同批去重注释有实测记录），故不再是「宿主不会产生的形状」的虚构编码。

边界（如实声明）：本笔只主张「虚构形状编码宿主语义」这一**机制面**已获规范承载与验证入口，不主张仓库内所有夹具形状均已逐个核对为真实形状——存量夹具的逐份核对无机械清单，靠后续修复时按 06 §5 逐次执行；pitfall-8cbde9ed 登记的三项停审遗留（变异记录无承载、§1 段序、术语混用）仍在，不因本销账而消失。

载体侧留痕（2026-10-28 本次更新）：本载体 `occurrence` 原含 2026-10 闭集收缩后已退出的历史子件 `human_return_at: null`，本次随流转一并移除（`count`／`first_at`／`last_at` 三件逐字保留，非改值、非计数）。
