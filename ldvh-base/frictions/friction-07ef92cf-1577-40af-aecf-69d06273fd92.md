---
title: 全量并行测试出现噪声性失败
status: voided
phenomenon: 同一批用例单独运行全部通过，全量并行运行出现 5 条失败，重跑后失败集回到基线（2594 通过 / 5 失败）。
attribution: 测试运行器的并发隔离面：并行执行时多个用例共享同一临时目录/共享状态，单跑与并发跑走不同的路径，落在测试基础设施而非单点代码缺陷。
object_uid: 07ef92cf-1577-40af-aecf-69d06273fd92
fact_type_key: friction
created_at: 2026-11-01T04:43:42.641Z
change_log:
  - at: 2026-11-01T04:43:42.641Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 摩擦发现阈值晋升（观察缓冲同源条目 3 条 ≥ 3，11 §9 第 3 项）
  - at: 2026-11-02T08:59:56.129Z
    provider: qoder-global
    model: qfmodel
    summary: 撤销影响评级（26 §8 2026-11-02）：删除 impact 字段——分级制度经 Human 裁定取消，本对象为 open 存量，经受控更新显式删除，其余字段与正文逐字继承。
  - at: 2026-11-10T11:36:22.468Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补 recall_digest：为召回提供高密度关键词面（02 §7.1）
  - at: 2026-11-19T20:13:13.617Z
    provider: workbuddy
    model: hy4flash-free
    summary: 废弃（Human Gate，老丁 2026-11-20 决定）：归因未证实（现象真实性保留、机械归因不成立）；disposition 如实保留仍成立的边界与新账接续提示
occurrence:
  count: 3
  first_at: 2026-10-29T23:10:53.070Z
  last_at: 2026-10-31T21:46:13.563Z
disposition: 『并行用例共享临时目录』归因在当前代码不成立（每用例 mkdtemp 独立、无测试级并发）；Human 决定废弃本账（老丁 2026-11-20）
---

# 全量并行测试出现噪声性失败

## 现象
同一批用例单独运行全部通过，全量并行运行出现 5 条失败，重跑后失败集回到基线（2594 通过 / 5 失败）。

### 该阻碍的历次观察（3 次，逐字引证）
1. （2026-10-29T23:10:53.070Z，session-ea6ec339-4eb1-4d09-a560-b8914f8b0f3d @ 18）此前的失败是并发运行时共享临时目录导致的干扰。
（来源：18）
2. （2026-10-31T19:10:41.680Z，session-af8a25a9-e0f3-486c-bc9b-ef702ffd0663 @ 5）单独运行时测试通过，全量运行却失败，说明是并发或时序噪声。重跑确认。
（来源：5）
3. （2026-10-31T21:46:13.563Z，session-af8a25a9-e0f3-486c-bc9b-ef702ffd0663 @ 9）单独运行时测试通过，全量运行却失败，说明是并发或时序噪声。重跑确认。
（来源：9）

## 入账依据
可归因性：失败只在并行全量运行中出现、单跑即通过、重跑即回基线，落在测试并行执行时的共享状态或临时目录未隔离这一层，而非被测代码。修了会更好的预期：回归基线可直接作为判据，不必每次先花一轮排除噪声、也不至于把真实回归混进已知噪声里被当作可忽略。


## 处置
废弃（open → voided，Human 老丁 2026-11-20 本会话决定三条都废弃）。废弃理由（36 §9.2，Human 判断）：归因未证实（现象真实性保留、机械归因不成立）。
现码 helpers.mjs:withTemp 逐调用 mkdtemp、runner 未设 concurrency；临时目录共享这一归因不成立。如实保留边界：账目所述『全量并行出 5 条失败、重跑回基线』的噪声现象本轮未逐项量测排除（--test-force-exit 截断、lint 缓存共享等其它噪声源未查）；本废弃仅否定原归因，不否认噪声现象本身。若该现象再现且取得可指认的新归因，由 Human 新建 open 账目接续本 uid。
本笔无 informs、无 paired-with，无配对复审义务；occurrence 与历史保留供回查。若上列仍成立或新现的阻碍再现，由 Human 新建 open 账目并在正文接续本 uid（26 §9.2：voided 不重开、且 voided 不参与查重，同类真实现象应重新入账）。
