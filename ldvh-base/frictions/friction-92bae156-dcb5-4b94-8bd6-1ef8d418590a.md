---
title: web-mount 用例挂起致定向验证受阻
status: resolved
phenomenon: 全量回归 2385 例中 test/web-mount.test.mjs 的 unexpected child exit re-warms 一例失败，该文件单跑时挂起不退出。
attribution: test/web-mount.test.mjs 的 `unexpected child exit re-warms` 用例把宿主子进程退出与重拉计时写成断言，测试夹具未满足该前提，导致该文件既在全量回归中失败又在单跑时挂起。
impact: medium
relations:
  - relation_key: informs
    target:
      commit: 0afe13a347d690eb7bf73fd6abedf47fc20290bc
object_uid: 92bae156-dcb5-4b94-8bd6-1ef8d418590a
fact_type_key: friction
created_at: 2026-10-27T15:10:39.482Z
change_log:
  - at: 2026-10-27T15:10:39.482Z
    provider: minmax
    model: MiniMax-M3.1-Flash
    summary: 摩擦发现阈值晋升（观察缓冲同源条目 3 条 ≥ 3，11 §9 第 3 项）
  - at: 2026-10-27T18:53:01.326Z
    provider: qoder
    model: qfmodel
    summary: 状态流转 open→resolved：解药为 commit 0afe13a（逐个建立 watcher，缺根不再泄漏 FSWatcher 句柄），原用例不改即 15/15 通过且进程自然退出，回归用例经破坏性验证确认具分辨力；偶发 ECONNREFUSED 属独立 readiness 竞态，已在处置段如实划出边界
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

## 处置
解药为 commit 级修复 `0afe13a347d690eb7bf73fd6abedf47fc20290bc`（fix: web-mount 逐个建立 watcher，缺根不再泄漏句柄致进程挂死，2026-10-28；解药走直提路径、无对应 ADR/WorkCase 事实对象，依 02 §8.1 commit 形态承载 informs）。

**根因与本账原推测不同，须如实记**：本账「入账依据」原写「补齐夹具即可」，实测夹具缺 `shared/` 只是**触发条件**，缺陷本体在产品代码——`web-mount.js` 用 `watchTargets.map((t) => fs.watch(t, ...))` 一次建全部 watcher，而 `map` 要求全部成功才返回数组：`WATCHED_SOURCE_ROOTS` 为 `["api","shared"]`，`shared/` 不可监听时 `fs.watch` 抛 ENOENT、整个 `map` 抛出、`watchers` 从未被赋值，**排在前面的 api watcher 已经建出来却再无任何引用**，`dispose()` 里的 `for (const w of watcher)` 关不掉它，FSWatcher 句柄永久泄漏 → 进程（及单跑该测试文件的 runner）无法退出。这正是账目所述「单跑时挂起不退出」的机制，与「用例时序脆弱」无关。

核验（2026-10-28）：① 修法为逐个建立、单个根失败跳过（等价于既有「watch 不可用则静默退化为手动重启」语义），根存在时监听面逐字不变；② **原用例一字未改**跑全套 16 例 → 15 pass / 1 skip（跳过者为 Windows-only 8.3 短名用例），进程自然退出，无需 `--test-force-exit`；`unexpected child exit re-warms` 单例连跑 5 次全绿；③ 新增回归用例具分辨力——把修复回退为 `map` 形态后该用例被 25s 看门狗 SIGKILL 判负（`code=null signal=SIGKILL`），恢复修复即通过，非空转。

边界（如实声明，不主张闭环）：本笔只消除**句柄泄漏致挂起**这一半，账目现象中的另一半「全量回归里该例偶发失败」是独立的 readiness 竞态（`isRunning()` 在 `spawned !== null && !exited` 即为真，而子进程先写 pid 文件后 `listen()`，故拿到新 pid 后立即 `fetch(/api/health)` 可能早于端口绑定），实测仍会偶发 `connect ECONNREFUSED`。该残余另行处置，不并入本销账主张。
