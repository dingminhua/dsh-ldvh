---
title: 并行会话未提交改动致召回用例失效
status: open
phenomenon: 本次改动提交前的测试中，plugin/lib/source-recall.js 与 plugin/lib/recall-injection.js 里他人尚未提交的改动使 4 条用例失败，变异锚点因源码被改写、缓存断言因新的解析路径而失效。
attribution: 多代理共享同一工作树（本仓 dev）且并行会话的在途未提交改动无隔离——同一根源另有 open 账目 friction-68e6f33e（其观察对象是合并前提被推翻、需重做），本条观察到的落点是召回用例集变异锚点与缓存断言失效，故归入既有观察组 `mutation-check-restore-clobbers-concurrent-edits` 而不是新建组。
object_uid: 451c4a7d-a14f-4e2f-af1c-9911d3c80fd6
fact_type_key: friction
created_at: 2026-11-03T15:28:05.599Z
change_log:
  - at: 2026-11-03T15:28:05.599Z
    provider: trae
    model: deepseek-v4.1-flash
    summary: 摩擦发现阈值晋升（观察缓冲同源条目 4 条 ≥ 3，11 §9 第 3 项）
  - at: 2026-11-03T16:25:41.595Z
    provider: deepseek-account
    model: deepseek-flash
    summary: 补充观察：count 4 → 5（11 §9 第 2 项）
  - at: 2026-11-03T16:25:41.601Z
    provider: deepseek-account
    model: deepseek-flash
    summary: 补充观察：count 5 → 6（11 §9 第 2 项）
occurrence:
  count: 6
  first_at: 2026-11-02T20:15:51.816Z
  last_at: 2026-11-03T15:30:27.108Z
---

# 并行会话未提交改动致召回用例失效

## 现象
本次改动提交前的测试中，plugin/lib/source-recall.js 与 plugin/lib/recall-injection.js 里他人尚未提交的改动使 4 条用例失败，变异锚点因源码被改写、缓存断言因新的解析路径而失效。

### 该阻碍的历次观察（4 次，逐字引证）
1. （2026-11-02T20:15:51.816Z，session-244a293c-fe59-42d6-bb55-953a9e6ff813 @ 3）根因已经找到：`plugin/scripts/mutation-check.mjs` 会在脚本启动时对 `lib/lifecycle.js` 等文件做快照，随后为变异测试改写这些文件，**最后无条件按快照还原**（见该文件 :180-212 的 `originals` Map）。
（来源：3）
2. （2026-11-02T20:17:04.868Z，session-244a293c-fe59-42d6-bb55-953a9e6ff813 @ turn ?..3）`lifecycle.js` 中的改动被那次 `cp` 还原操作抹掉了（还原源是编辑前的副本），其余两处改动还在。
来源：主控会话 turn 3（本次窗口材料第 3 轮 assistant 正文，步骤 4 队列契约入口开工前）
3. （2026-11-03T14:45:17.172Z，session-372f10f2-2dee-42e3-8f8d-6dd24d156822 @ turn 9..12）失败的是「语料缓存」与「token 集缓存」两条用例
来源：材料 turn 12 · assistant 正文「二、source-recall 那 2 条失败不是本次引入」段（会话 id 未随材料交付）
4. （2026-11-03T14:45:17.179Z，session-372f10f2-2dee-42e3-8f8d-6dd24d156822 @ 17）这 4 条失败全部源于 plugin/lib/source-recall.js（+331 行）与 plugin/lib/recall-injection.js（+109 行）中他人尚未提交的改动
（来源：17）

## 入账依据
可归因性：助手明确写明这 4 条失败全部源于他人未提交的改动、与本次改动无关，失败随该并发改动出现；改善预期：只要隔离或消除该并发在途改动，同一用例集即恢复通过——与缓冲中既有组的现象（同一 source-recall 用例集因另一会话未提交改动转红）在子系统、触发条件与表现上一致。

补充观察（2026-11-03T15:30:27.097Z）：提交前运行测试时出现 4 条用例失败，失败被归因于工作区中他人尚未提交的源码改动使变异锚点与缓存断言失配。
逐字引证：变异锚点因源码被改写而失效，缓存断言因新的解析路径而失效
来源：主控会话 turn 17 助手回复（提交前测试段）：「这 4 条失败全部源于 plugin/lib/source-recall.js（+331 行）与 plugin/lib/recall-injection.js（+109 行）中他人尚未提交的改动，与本次改动无关：变异锚点因源码被改写而失效，缓存断言因新的解析路径而失效。」

补充观察（2026-11-03T15:30:27.108Z）：引文明确指出本次全量测试出现 4 条失败，且失败的落点是 plugin/lib/source-recall.js 与 plugin/lib/recall-injection.js 上他人尚未提交的在途改动。这与既有 open 账目 friction-451c4a7d「并行会话未提交改动致召回用例失效」的归因（多个代理共享同一工作树、并行会话在途未提交改动无隔离，落点为召回用例集）在子系统与机制模式上完全一致，仅测试规模数字（2805）随语料增长而变，属同一阻碍的再次出现，故报 same-obstacle 并给出该账目 uid。另需如实说明：Pitfall 侧候选超过交付上限（已交付 40 / 48），本次跨类型查重不完整，故本条未对跨类型同源作完整排除；就已知条目看，pitfall-a1b997d0（无关未提交改动阻塞变基致推送延迟）与本条同属「共享工作树上的在途未提交改动」这一根源，仅供
逐字引证：全量测试 2805 条 / 4 条失败，**全部是别人未提交的改动**（`plugin/lib/source-recall.js` +331 行、`plugin/lib/recall-injection.js` +109 行）引起的连带红，不是本次回归。
（来源：19）
