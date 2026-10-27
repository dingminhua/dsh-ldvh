---
title: 相位闭集缺 complete 致错误被吞成成功
status: active
scope: dsh-ldvh 的 LDVH 插件中 workcase 目标相位机（lib/workcase-goals.js 及其 lifecycle 调用方）
object_uid: b011ff88-ecee-4c4d-b790-2daf09d19573
fact_type_key: pitfall
created_at: 2026-10-18T19:01:07.101Z
change_log:
  - at: 2026-10-18T19:01:07.101Z
    provider: go
    model: space-bunny
    summary: 闲时辅助经验积累（机械通道）于 2026-10-18T19:00:17.485Z 形成候选
  - at: 2026-10-18T19:39:17.779Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 转正：补入档复核段，记录对 8ca87ab 修复面的机械核对结果
  - at: 2026-10-27T18:37:42.415Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 机械化承载盘点登记（2026-10-28）：workcase-goals.test.mjs:373/397/409 断言 complete/open 相位只走 get+create 且失败不被吞；状态与 scope 不变（23 §9.3 补充级更新）。
---

# 相位闭集缺 complete 致错误被吞成成功

## 症状
工单对象仍处于 open 执行期，而其宿主目标已被标记为 complete。此后任何把目标拉回 active 的尝试都无效：调用 resume 报错，但错误被吞成 ok:true、返回值又被调用方丢弃，于是链路上看不到任何报错，表现为一台工单「怎么推都不动」的死结状态——反复 resume 也只能停在原处，没有任何可见失败信息。

## 触发条件
同一 workcase 上出现「目标相位 = complete」与「对象状态 = open」并存，即目标先于对象收口（真实会话中 afff56ac 在 10-18 15:08:47 到达 complete rev4，工单仍在执行期），此后执行体的每次修复性推进都走 resume 这条唯一既有路径，因而每次都被拒。

## 根因
resume 的相位闭集只接受可推进的相位，不含 complete。相位不在闭集时该调用报错，但两层放大把拒绝抹掉了：其一，错误被吞成 ok:true；其二，返回值被 lifecycle 丢弃。结果是「拒绝」在链路中完全不可见，表象退化成「命令无效但没报错」。同时规范层对这一状态无条文，属代码先落地的空白。

## 解决
在 lib/workcase-goals.js 中为 complete 目标补一条独立的 create 分支：目标已完成而对象仍在执行期时，改用 create 重建目标，不再走 resume。改后经受控提交流程预检（ldvh_precheck_git_commit passed、commit-msg passed）提交，提交号 8ca87ab，提交消息写明缺陷机理、真实日志时间戳作为判断依据、以及测试跳过边界。

## 规避
看到「命令返回成功但状态没变」时，先查该调用的相位闭集是否覆盖目标当前相位，不要靠反复重试或 pause/resume 绕行；同时确认错误是否被折叠成 ok:true、返回值是否被上游丢弃——这三处任一成立，就会出现「静默拒绝」。目标已 complete 而对象仍在 open 属于该类状态，应直接换用重建路径而不是续做。

## 验证
真实会话日志证实修复跑通：10-19 02:03:58 出现 create rev1 → active，此前该序列只有 complete 与 resume，死结在真实数据上解开；测试 1622 条中 1621 pass / 0 fail / 1 skipped，且该跳过为既有跳过；lint 通过。未覆盖：只观察到一例真实会话样本，未在并发推进或多次重复触发下观察；规范 specs/21 §14 对该状态的条文空白未补（friction-98c0a43d 仍在 observing），即代码面已解、规范面未解。

**入档复核（2026-10-19）**：转正前对修复面做了机械核对——`8ca87ab` 入库 `plugin/lib/workcase-goals.js`（+64）与 `plugin/test/workcase-goals.test.mjs`（+66）共 127 行；当前 `workcase-goals.js:252-259` 存在 complete 独立分支，其注释明写「宿主 resume 的可接受相位闭集是 {active, paused, blocked}，对 complete 必抛」，与本条根因表述一致；该文件在 `8ca87ab` 之后无后续提交、工作区无未提交改动，修复面完整可追溯。本条未重复观察真实会话样本，验证段「未覆盖」项维持原样。


**机械化承载（2026-10-28 盘点）**：`plugin/test/workcase-goals.test.mjs:373/397/409` 已把本条的规避实现为机械判据，断言「目标 complete 而对象 open」只发 `get`+`create`（不得落 resume），且重建/resume 失败返回 `ok:false`+`workcase/goals_failed` 而非被吞成 `ok:true`；覆盖边界：只覆盖 `rearmInFlightWorkcaseGoal` 的 complete/open 这一对相位，`lifecycle.js:416,431-440` 对 `ok:false` 的日志消费无用例断言，其它「闭集判定 + 返回值续推」的调用点未纳入判据。

## 影响与适用范围
dsh-ldvh 的 LDVH 插件中 workcase 目标相位机（lib/workcase-goals.js 及其 lifecycle 调用方）。同型的「相位闭集未覆盖某状态 + 错误被吞成成功 + 返回值被丢弃」组合在其它以闭集判定合法性、又依赖返回值续推的调用点上同样适用；本次只在该相位机上被实际触发并验证过，其余调用点未观察。
