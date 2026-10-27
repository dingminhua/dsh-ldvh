---
title: web-mount 用例挂起致定向验证受阻
status: open
phenomenon: 全量回归 2385 例中 test/web-mount.test.mjs 的 unexpected child exit re-warms 一例失败，该文件单跑时挂起不退出。
attribution: test/web-mount.test.mjs 的 `unexpected child exit re-warms` 用例把宿主子进程退出与重拉计时写成断言，测试夹具未满足该前提，导致该文件既在全量回归中失败又在单跑时挂起。
impact: medium
object_uid: 92bae156-dcb5-4b94-8bd6-1ef8d418590a
fact_type_key: friction
created_at: 2026-10-27T15:10:39.482Z
change_log:
  - at: 2026-10-27T15:10:39.482Z
    provider: minmax
    model: MiniMax-M3.1-Flash
    summary: 摩擦发现阈值晋升（观察缓冲同源条目 3 条 ≥ 3，11 §9 第 3 项）
occurrence:
  count: 3
  first_at: 2026-10-26T10:39:34.498Z
  last_at: 2026-10-27T15:09:50.878Z
---

# web-mount 用例挂起致定向验证受阻

## 现象
全量回归 2385 例中 test/web-mount.test.mjs 的 unexpected child exit re-warms 一例失败，该文件单跑时挂起不退出。

### 该阻碍的历次观察（3 次，逐字引证）
1. （2026-10-26T10:39:34.498Z，session-ad027a9f-54b7-4ec2-b257-15190c0d31e0 @ 54）该测试单独运行会挂起（等待型），这正是我之前记录过的性质。
（来源：54）
2. （2026-10-27T12:10:42.863Z，session-75bb2718-fe7a-4209-aff3-80f00eee8ff4 @ 18）两任务均挂起（该测试自身在单跑时即挂），按既有记录，这是已知的 flaky。
（来源：18）
3. （2026-10-27T15:09:50.878Z，session-75bb2718-fe7a-4209-aff3-80f00eee8ff4 @ 23）它只 import `../lib/web-mount.js`，与本次改动无依赖，单跑同样挂住，是既有的环境依赖用例（子进程重拉计时），不是本次引入。
（来源：23）

## 入账依据
该用例每轮完整回归都贡献一次失败与一次跳过，使本次改动的验证结论只能靠其余 2382 例与人工判断支撑；若把宿主子进程时序前提从断言中剥离或补齐夹具，回归结果即可机械可信、验证成本下降。
