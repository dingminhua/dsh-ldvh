---
title: 关闭提请无独立动作且无等待点
status: observing
phenomenon: 工单被推进到 Gate 2 后在同一自动续轮内即被关闭，待批准关闭期在磁盘上只存在 2 分 43 秒（workcase-996e207a：822dcec 15:25:22 open∧含结果节 → 6febab9 15:28:05 closed），Human 在界面上只见到「执行中」直接变「已关闭」。
attribution: plugin/lib/workcase-tools.js 的动作闭集：12 个 action 中没有 propose_close/request_gate2，关闭提请只能作 execute 的附带产物；plugin/lib/workcase-goals.js 的宿主目标只驱动「推进到 Gate 2」
impact: medium
object_uid: fa304c6d-6057-476d-8f7a-99da6becc443
fact_type_key: friction
created_at: 2026-10-19T08:56:16.755Z
change_log:
  - at: 2026-10-19T08:56:16.755Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Friction 对象
  - at: 2026-10-19T09:51:18.756Z
    provider: go
    model: space-bunny
    summary: 补充观察：count 1 → 2（36 §9 第 2 项）
occurrence:
  count: 2
  first_at: 2026-10-19T09:05:00.000Z
  last_at: 2026-10-19T09:50:34.173Z
---

# 关闭提请无独立动作且无等待点

## 现象

工单被推进到 Gate 2 后在同一自动续轮内即被关闭，待批准关闭期在磁盘上只存在 2 分 43 秒（workcase-996e207a：822dcec 15:25:22 open∧含结果节 → 6febab9 15:28:05 closed），Human 在界面上只见到「执行中」直接变「已关闭」。

本次调查（2026-10-19）实测补充：
- 全仓 33 份 WorkCase 中 0 份 open；最近一次经过待批准关闭期的是 workcase-996e207a，窗口 2 分 43 秒；workcase-c36b0208 为 22 分钟。
- 派生与写入两侧判据均正确：`open ∧ 正文含 ## 结果 ⇒ awaiting_gate2`（`plugin/web/shared/workcaseLifecycle.ts`、`plugin/lib/workcase-writer.js`），写入侧由 `workcase/result_proposal_required` 阻止「结果节与状态翻转同批写入」。
- 故现象不是判据错误，而是该状态没有任何持留机制。

## 入账依据

材料来自 Human 在 dsh-ldvh 会话的两次提问：先问「为什么 wc 始终没有进入到待批准关闭的状态，推进中之后就变成了已关闭」，再答「系统应该设置到把这个工单推进到待批准关闭状态，进入这个状态后提请关闭」。

机械可核的部分（代码位置，2026-10-19 实测）：
- `plugin/lib/workcase-tools.js` 的 WRITE_ACTIONS 共 12 个动作，无 propose_close/request_gate2；execute 是唯一能写入 `## 结果` 的入口，close 紧随其后即可通过。
- closeWorkcaseObject 的前置条件四（`workcase/result_proposal_required`）只证明「结果节不是与关闭同批写入」，不证明 Human 介入过；两次调用之间无最小间隔、无 Human 签名。
- `plugin/lib/workcase-goals.js` 的 `goalObjectiveFor` 让 Gate 1 批准即设宿主目标「推进 workcase-<uid> 到 Gate 2」，宿主 goal round 每轮只注入「推进并完成」，没有「在 Human Gate 前停住」的语义；相位闭集 active/paused/blocked/complete 中无 waiting。
- 呈现层无条件可用：`plugin/web/api/routes/objects.ts` 的 `awaiting_gate2` 档位、`cognition.ts` 的 closure_confirmation 均按派生 group 计数，一旦存在 open∧含结果节的盘上对象即会列出。

未覆盖：本条目只登记「为何不停留」，不判定 Human 应当以何种方式批准关闭（那是规范 21 §14 的取向问题，属 Human 决定）。

补充观察（2026-10-19T09:50:34.173Z）：材料的主干结论是一条三层根因：落结果节后磁盘上确实出现过 open 且含结果节的等待态（workcase-996e207a 的 822dcec 15:25:22 落结果节、6febab9 15:28:05 关闭，窗口 2 分 43 秒），但 Gate 1 批准即设宿主目标「推进到 Gate 2」，相位闭集 PHASES={active,paused,blocked,complete} 无「等人工」档，自动续轮把等待态当作未完成步骤一路带到终态。这一阻碍的名称与内容在材料中被明确写成「关闭提请无独立动作且无等待点」，而引证那一行本身即表明它已在本轮被新建进账；该 uid fa304c6d-6057-476d-8f7a-99da6becc443 已出现在本次交给我的既有账本候选列表中，因此属同一阻碍（same-obstacle），而非账本未记录的新阻碍。材料中其余分项也都能落回已入账条目：①「你的答复本身不产生任何机械效果…工具动作闭集里没有「提请关闭」」对应已在账的 friction-720b58c9「关闭提请无专属动作承载」（count 3），材料自身也把它列为「已在账的相关」；②「代码改了但没生效：运行中的宿主仍持有旧模块，需重启 DSH」属既有宿主旧模块族（friction-a0d50a73 / friction-fbd65401）；③「收件箱「关闭待确认」卡没有“批准关闭”按钮」与「进入待批准关闭时不弹窗」被材料自身归入本轮结论条目 fa304c6d 的组成部分。我在材料所见的全部内容中未找到账本尚未记录、且达到系统性阻碍程度的独立现象。需要如实说明：材料末尾在「**注意**：`ldvh-b」处被截断，截断点之后的内容我无法判断，故本判定只覆盖所见部分；若截断部分另含新阻碍，需由后续运行覆盖。
