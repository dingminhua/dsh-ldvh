---
title: 召回命中理由呈现机制条件
status: discarded
question: 召回候选行的命中理由，应当呈现什么内容，才能让读者据此判断「这条经验的机制条件与当前情境是否相同」，而不是只能看到一个词法命中自述？
scope_boundary: 不讨论召回排序、评分或截断（那是另外两条已登记账目：friction-6b254146 条数截断、pitfall-06d08683 词频判题失效）；也不讨论 tier 分层本身是否合理。只处理一件事：命中行的呈现内容——从「命中词复述」改为「机制触发条件」。止于产出可判定的改法候选（呈现什么字段、怎么取、如何避免把完整 scope 糊上去导致噪声），不直接改代码；是否实施由后续 WorkCase 走流程。
intent: 把「命中理由」从词法回声改成机制条件，使 34 §13 要求的「自行判断是否适用」真正可判。本会话已实测到两次失败：一次误用（bdae1a55 机制不同却被当成适用）、一次漏召（6f268b21 机制完全对应却因用词不重合而未触发）。若不改，34 §13 的那句「是否适用须自行判断」在当前交付材料下无法履行——判断依据不在材料里。
summary: 命中理由走两条路：hitReason 只拼查询词（2548-2562）；↳ 摘录由 excerptOf 压平+120 字截断，取 summary>gist>…>scope（1784-1786），与命中位置无关。故判断机制所需信息在 scope 里，却只在 summary/gist 全缺时才被取到。
serves: af93e218-e9d9-4234-b436-33dc0c7c37dc
disposition: 立论前提经三项复核证伪（pitfall-bdae1a55 无 summary 字段；其召回摘录位显示的正是 scope 原文；按 fact_type_key 全量统计显示字段与类型严格绑定，pitfall 101 条全为 scope），原问题「命中理由应呈现什么内容」不成立。真正的失败形态是主控未读已交付的判据即下结论，属执行纪律问题而非系统缺陷，应以 Pitfall 承载、不在本对象内推进。
object_uid: 1b0459ae-a0d9-4aff-b8aa-70bc17c7154b
fact_type_key: spark
created_at: 2026-11-11T20:01:19.274Z
change_log:
  - at: 2026-11-11T20:01:19.274Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Spark 对象
  - at: 2026-11-11T20:14:14.455Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 经建单后自动审核指出并由我复核代码确认，更正两处事实错误：① hitReason 确实只拼查询词（2548-2562）说对了；② 但 ↳ 摘录并非「按词法命中位置截取」——excerptOf 只做空白压平与 120 字截断，取的是 excerptSource（summary>gist>…>scope），与命中位置无关。据此把缺口重新表述为「摘录取 summary 而非 scope」，并把漏召例单独区分（那是词法未命中，性质不同）；补记审核指出的预算约束（34 §15.1 第 5 项属 Human）。
  - at: 2026-11-11T20:56:09.277Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 立论前提经三项复核证伪：pitfall-bdae1a55 无 summary 字段、其召回摘录位显示的正是 scope 原文、且按类型统计字段与类型严格绑定（pitfall 101 条全为 scope）。故本 Spark 原问题不成立，真正的失败形态是「未读已交付的判据即下结论」，属执行纪律而非系统缺陷，应以 Pitfall 承载而不在本对象内推进。
---

# 召回命中理由呈现机制条件

## 当前理解

**本 Spark 的立论前提已被证伪，应 discarded。** 保留正文以记录证伪过程，避免未来重蹈。

### 原立论与证伪
原主张：召回交付的「命中理由」不足以判断适用性——`pitfall-bdae1a55` 交付的是它的 `summary`，而 `scope` 排在回退链倒数第二取不到，故读者无法判断机制是否相同。

三项复核逐一推翻：

1. `pitfall-bdae1a55` **根本没有 `summary` 字段**。其 frontmatter 里 `summary`/`gist`/`decision`/`phenomenon`/`research_question` 全为 none，只有 `scope` 有值。
2. 该对象在本会话召回记录中，`↳` 摘录位显示的**正是 `scope` 原文**：「适用于从源码常量、默认参数或测试夹具推断生产运行时行为、并据此给缺陷定性或请 Human 在多方案中选择的结论生成环节；不适用于已沿调用链核对生产设置与实际取值的结论」。判断机制是否相同所需的信息**已经完整交付**。
3. 按 `fact_type_key` 对 `ldvh-base/` 全量统计，字段与类型**严格绑定**：pitfall 101 条全为 scope、friction 112 条全为 phenomenon、research 49 条全为 research_question、workcase 53 条为 summary+gist+scope、adr 9 条为 decision+scope。「scope 排倒数第二」对 pitfall 类不产生任何后果——它前面五个字段该类根本没有。

### 真正的失败形态
不是材料不足，是**我拿到了完整 scope 却没有读它，凭「标题看起来像」就去下结论**。同一失败在本会话发生了三次（Git Gate 归因、摘录机制、本次 summary vs scope），共同形态是：观察到一个现象 → 推断出机制 → 未核实即写入事实源或据此建单。

### 去向
这条真正的教训是**执行纪律**，不是系统缺陷。若要以对象承载，应立 Pitfall（「未读已交付的判据即下结论」），而不是继续在召回呈现上找改动点。本 Spark 原问题「命中理由应呈现什么内容」基于错误前提，不再成立。

## 调查问题

召回候选行的命中理由，应当呈现什么内容，才能让读者据此判断「这条经验的机制条件与当前情境是否相同」，而不是只能看到一个词法命中自述？

## 调查边界

已止于证伪：三项复核完成，结论为「前提不成立、召回已交付充分信息」。不进入改法设计——改法所服务的问题不存在。后续如要处理真正的失败形态（未读判据即下结论），另立对象承载，不在本 Spark 范围内。
