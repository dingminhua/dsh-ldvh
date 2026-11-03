---
title: 目录缺失被误判为类型未接入
status: resolved
phenomenon: 已接入的 DevLog 类型在 ldvh-base/devlogs/ 目录不存在时，被列表页显示为「该事实类型尚未接入」；主控临时建一个空目录后，同一接口的 coverage_status 立刻由 type_not_integrated 变为 complete、items 为空，删除目录后显示又复原。
attribution: 事实读取层（api/services/localFactReader.ts:479-481 的 existsSync）把「目录是否存在」当作「该事实类型是否接入」的判据，其返回被映射为 coverage_status=type_not_integrated，前端再按该状态走琥珀警示分支——两个不同判据被混同在同一状态位上。
relations:
  - relation_key: informs
    target:
      commit: e4f340b733e5309f6e157dc3d1ee74ac5dd25169
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
  - at: 2026-11-03T18:52:22.449Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 销账（open→resolved）：解药 e4f340b——目录缺失按零对象处理，不再产出 type_not_integrated。核验：web API 用例 6/6 通过（三条直接钉住本判据）、plugin 全量 2869 条 0 失败；末次观察 2026-11-02T00:18:54Z 早于解药 05:27:42Z，此后无同型观察。处置段记改了哪一层、三条判据理由、以及三条边界（同判据两出口不另计／前端文案保留是有意的／证据止于 API 层未做端到端渲染确认）。
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

## 处置

解药 `e4f340b733e5309f6e157dc3d1ee74ac5dd25169`：目录缺失不再产出 `type_not_integrated`。

**改了哪一层**：`plugin/web/api/services/localFactReader.ts` 的 `listLocalFacts` 在目录不存在时返回 `emptyTypeDirectory()`——`status: 'complete'`、`items: []`、`issues: []`，即**目录缺失按零对象处理**。`type_not_integrated` 这个状态值本身保留（下游 `facts.ts` 与前端 `FactCoverageStatus` 仍消费它），撤的只是「目录在不在」这条判定。理由写在该文件注释里，按强度三条：① 「未接入」是关于**代码**的断言，目录存在性只能回答关于**数据**的问题；② 类型接入是编译期事实，缺登记根本进不了该函数，故本函数已不可能看到未接入类型；③ 目录由写入器按需创建，是可恢复的瞬时状态。附带后果如实登记：目录缺失与空目录在 Web 上给出同一句话，这是有意的。

**核验（本轮实跑，非复述历史）**：
- `plugin/web/tests/api/empty-fact-type-presentation.test.ts` 用 `npx tsx --test` 跑：6/6 通过。该文件的用例直接钉住本次判据——`目录缺失按零对象处理：不再报 type_not_integrated`、`目录缺失与空目录给出同一结果（判据不是目录是否存在）`、`精确读取缺失目录中的 id 返回 not_found`。
- plugin 全量 `npm test`：2869 条，2867 通过 / 0 失败 / 1 skipped / 1 todo（71 秒），本改动前后无差异。

**观察侧**：末次观察 `2026-11-02T00:18:54.167Z`，解药落地 `2026-11-02T13:27:42+08:00`（= 05:27:42Z），**末次观察早于解药 5 小时**，此后无同型观察。

**边界（如实声明）**：① 本单一处缺陷，未做同型扫描——`localFactReader.ts` 的另一条 `not_found` 路径（`readLocalFact`）在同一次改动里一并改了口径，属同一判据的两个出口，不另计；② 前端 `objectList.typeNotIntegrated` 这段文案**仍在** locales 里，本次只保证后台不再因目录缺失产出该状态，未删除该文案——未来若真出现「有目录契约但无读取支持」的类型，它仍是正确答案（测试注释已写明这条边界）；③ 未在真实浏览器里目视确认列表页，证据是 API 层测试，不含端到端渲染验证。
