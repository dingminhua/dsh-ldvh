---
title: 重启割裂观察区间致累计计数失真
status: observing
phenomenon: 宿主每次重启后，摩擦发现的观察区间起点取自跨进程持久化的水位（末次 turn 39），而累积观察材料仅存在于新进程内存（自 turn 40 起），两者之间形成一段永不被观察的空洞，且水位仍照常推进至当前轮次。
impact: heavy
object_uid: b249deb3-eea1-4204-ae68-c2dba6916716
fact_type_key: friction
created_at: 2026-10-10T21:06:58.777Z
change_log:
  - at: 2026-10-10T21:06:58.777Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 摩擦发现机械通道创建（04 §8.4 第 3 项）
occurrence:
  count: 1
  first_at: 2026-10-10T21:05:35.230Z
  last_at: 2026-10-10T21:05:35.230Z
  human_return_at: null
---

# 重启割裂观察区间致累计计数失真

## 现象
宿主每次重启后，摩擦发现的观察区间起点取自跨进程持久化的水位（末次 turn 39），而累积观察材料仅存在于新进程内存（自 turn 40 起），两者之间形成一段永不被观察的空洞，且水位仍照常推进至当前轮次。

## 入账依据
可归因性：观察累积器（plugin/lib/friction-window.js 的 createWindowAccumulator）是进程内存态，其 firstObservedTurn 随进程创建而从 null 起算；水位载体（~/.dsh/ldvh/friction-discovery-watermarks.json）却跨进程持久化。两者生命周期不对称，故每次宿主重启都必然在「水位+1 .. 首次观察到」之间产生一段真实缺口。宿主只发布事件、不回放，且本模块按 04 §8.4 纪律不读会话日志，故该段内容不可恢复——缺陷可稳定复现于每一次重启，不依赖偶发条件。预期收益：若累积器改为从水位载体反查上一进程已覆盖的末轮、或改由宿主提供会话记录只读句柄供机械切分，则重启不再割裂观察区间，occurrence.count 将开始度量「发生次数」而非「被看见的次数」，N=3 阈值才具备其条文所声称的语义。
