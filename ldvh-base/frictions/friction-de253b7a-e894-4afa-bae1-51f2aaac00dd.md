---
title: 目录缺失被误判为类型未接入
status: open
phenomenon: 已接入的 DevLog 类型在 ldvh-base/devlogs/ 目录不存在时，被列表页显示为「该事实类型尚未接入」；主控临时建一个空目录后，同一接口的 coverage_status 立刻由 type_not_integrated 变为 complete、items 为空，删除目录后显示又复原。
attribution: 事实读取层（api/services/localFactReader.ts:479-481 的 existsSync）把「目录是否存在」当作「该事实类型是否接入」的判据，其返回被映射为 coverage_status=type_not_integrated，前端再按该状态走琥珀警示分支——两个不同判据被混同在同一状态位上。
object_uid: de253b7a-e894-4afa-bae1-51f2aaac00dd
fact_type_key: friction
created_at: 2026-11-02T05:46:26.865Z
change_log:
  - at: 2026-11-02T05:46:26.865Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 摩擦发现阈值晋升（观察缓冲同源条目 3 条 ≥ 3，11 §9 第 3 项）
  - at: 2026-11-02T08:59:56.247Z
    provider: qoder-global
    model: qfmodel
    summary: 撤销影响评级（26 §8 2026-11-02）：删除 impact 字段——分级制度经 Human 裁定取消，本对象为 open 存量，经受控更新显式删除，其余字段与正文逐字继承。
occurrence:
  count: 3
  first_at: 2026-11-01T22:23:38.938Z
  last_at: 2026-11-02T00:18:54.167Z
---

# 目录缺失被误判为类型未接入

## 现象
已接入的 DevLog 类型在 ldvh-base/devlogs/ 目录不存在时，被列表页显示为「该事实类型尚未接入」；主控临时建一个空目录后，同一接口的 coverage_status 立刻由 type_not_integrated 变为 complete、items 为空，删除目录后显示又复原。

### 该阻碍的历次观察（3 次，逐字引证）
1. （2026-11-01T22:23:38.938Z，session-f0230f1a-b5c5-42af-b187-067a562e528c @ 6）列表页现在显示「该事实类型尚未接入」——类型确实已接入，只是本项目还没有任何一条 DevLog
（来源：6）
2. （2026-11-01T22:57:12.652Z，session-f0230f1a-b5c5-42af-b187-067a562e528c @ turn ?..6）列表页现在显示「该事实类型尚未接入」——类型确实已接入，只是本项目还没有任何一条 DevLog，而 `ldvh-base/devlogs/` 要等 writer 首次落盘才 `mkdir`。
来源：主控会话 turn 6，助手回复末尾「一个需要你知道的判断」段（材料未给出会话 id，位置为该 turn 的最后一段自然语言）
3. （2026-11-02T00:18:54.167Z，session-f0230f1a-b5c5-42af-b187-067a562e528c @ 10）**已实测的证明**：临时执行 `mkdir ldvh-base/devlogs` 后再请求同一接口，`coverage_status` 立刻从 `type_not_integrated` 变成 `complete`、`items: []`
（来源：10）

## 入账依据
可归因：判据落在洞口 api/services/localFactReader.ts:479-481 的 existsSync，只要建一个空目录就能让该警示消失，说明显示的不是真实接入状态；修掉后能区分「零对象」与「未接入」两种语义，并消除同一句话在顶部警示与正文空态各出现一遍的重复呈现。
