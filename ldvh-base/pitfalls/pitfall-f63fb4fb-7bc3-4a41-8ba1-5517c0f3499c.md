---
title: object 锚点只解析 reports 致跨类型引用被拒
status: discarded
scope: 影响所有用 `object` 锚点引用非 report 类型事实对象（subgoal/pitfall/norm/spark/friction 等）的报告写入；凡与 create 路径共用 `resolveInternalObjectLocators` 的 summary/audit/action/reference 形态均在受影响面内（后三形态为代码推断、未实测）。
trigger_signal: report-writer.js 的 object 锚点解析范围（objectFilePath/resolveInternalObjectLocators）修改后，或 24 §10.2 object 锚点契约变更时，重验本条（修复后跨类型解析未验证）。
disposition: 创建通道走错（主控代写而非代理自写，违 25 §13 代理记录通道与 00 §4.5 判断责任不压回主控）；Human 2026-11-21 指示按要求执行，废止本条、改由被武装分身自己 create 承接同一机制。
object_uid: f63fb4fb-7bc3-4a41-8ba1-5517c0f3499c
fact_type_key: pitfall
created_at: 2026-11-20T22:27:06.250Z
change_log:
  - at: 2026-11-20T22:27:06.250Z
    provider: qoder
    model: qmodel_latest_preview
    summary: 主控主动记录通道（25 §13）：当次行动发现并查明验证的失败机制——report-writer 的 object 来源锚点只解析 reports/ 目录，跨类型事实对象引用必被拒（与 24 §10.2 契约不一致）；零上下文代理 pitfall-drafter 据主控交付材料起草并落盘草稿，归属核对归 Pitfall、查重对照 83 条 active Pitfall 与 0 条 open Friction 未见同源（pitfall-d06bb77a 对象不同不合并），主控以落盘草稿为准受控写入。
  - at: 2026-11-20T22:33:15.767Z
    provider: qoder
    model: qmodel_latest_preview
    summary: Human Gate 终态流转 active→discarded（Human 老丁 2026-11-21「要求是什么就怎么执行」指示）：本条虽内容据证据有效，但创建通道走错——由主控代写而非 25 §13 代理记录通道要求的代理自写（实现面 pitfall-tools.js:214-248 允许被武装分身自己 create）。按 Human 指示废止本条，改由重新武装的分身自己 create 一条干净记录；机制内容本身不废，由新对象承接。
---

# object 锚点只解析 reports 致跨类型引用被拒

## 症状

报告写入被拒回、零写入。首次调用 `ldvh_report_write action=create` 创建 action 型报告，证据摘录 E7 用 `来源：object（3ab9c84c-0ebd-45d5-983d-cec515ef623a）` 引用一个 SubGoal 对象，工具回执为：

「LDVH report-write-object: unavailable」
「gap: research/internal_source_anchor_invalid: internal source anchors failed mechanical checks」
「gap: internal-source: object locator does not resolve to an existing report object: 3ab9c84c-0ebd-45d5-983d-cec515ef623a (24 §10.2)」
「follow_up: fix the reported mechanical issues and retry; zero write has occurred」

## 触发条件

同时满足两项即触发：(1) 走报告 create 路径且 `report_form` 为 action（同一代码入口的 summary/audit/reference 形态按推断同受影响）；(2) 正文证据摘录使用 `object` 锚点，且所填 `object_uid` 指向一个**真实存在但非 report 类型**的事实对象。材料逐字：「首次调用 ldvh_report_write action=create 创建 action 型报告，证据摘录 E7 用「来源：object（3ab9c84c-0ebd-45d5-983d-cec515ef623a）」引用一个 SubGoal 对象」；该对象确为真——「该 SubGoal 对象真实存在（ldvh-base/subgoals/subgoal-3ab9c84c-0ebd-45d5-983d-cec515ef623a.md，本轮 subgoal_read 可读、status=active）」。即：锚点本身合法、对象本身存在，仍被拒。

## 根因

写入器把 `object` 锚点的「可解析性」窄化为「reports/ 目录下存在 report-<uid>.md」。材料逐字：

- 「第 705 行：export function reportFileName(uid) { return `report-${uid}.md`; }」
- 「function objectFilePath(factSourceRoot, uid) {」
- 「  return join(factSourceRoot, REPORT_DIRECTORY, reportFileName(uid));」
- 「（REPORT_DIRECTORY = "reports"，第 17 行）」

解析器只对 object 锚点做一次 `access(objectFilePath(...))`，失败即入 issues：

「internal-source: object locator does not resolve to an existing report object: ${locator} (24 §10.2)」

主控对机制的直接判定逐字：「即：object 锚点的解析只查 reports/report-<uid>.md，跨类型对象（subgoal/pitfall/norm/spark/friction 等）的文件不在 reports/ 下，access 必失败 → 判不可解析。」

这与规范契约不一致：规范明确 object 锚点是「事实对象只相互引用」的唯一通道、且要求可解析到「该对象」，而实现只认 report 一类；材料逐字：「规范层允许 object 引用任一事实对象（不限 report），写入器实现窄于规范。」规范条文本身为：「写了 `commit` 就必须真存在该提交、写了 `object` 就必须能解析到该对象。机械层校验 `commit` 的 40 位 hex 形态与 `object` 的可解析性」——校验对象是「该对象」而非「该类目录下的报告文件」，故窄化来自实现侧路径拼接，不是契约要求。

## 解决

当次采用「换锚点类型承载同一来源」绕开：把 E7 的 `来源：object（3ab9c84c-…）` 改为 `来源：commit（41e0c870cd1fd8e9bbae79f065b5a76053b66f5f）`（该提交下含 subgoal 文件），重试后成功。回执逐字：

「LDVH report-write-object: completed」
「object: 6339f3dc」
「read_back: ok」

材料亦逐字给出为何可行：「改用 commit 锚点承载跨类型对象内容后重试成功」「commit 锚点只校验 40 位 hex 形态、不解析对象文件，故能承载跨类型内容。」

## 规避

1. 写报告引用非 report 类型事实对象（subgoal/pitfall/norm/spark/friction 等）时，**不要用 `object` 锚点**，改用 `commit` 锚点：先确认该对象文件已入某个真实提交，再填该 40 位 hex；hex 形态会被机械校验，须真实存在。
2. 保留可追测性：正文可同时写出对象 uid 与「来源：commit（<hex>）」，让读者能按提交回溯到对象文件，不必牺牲出处精度。
3. 若确需 `object` 锚点指向跨类型对象，先按上述路径判断必然被拒（只查 `reports/report-<uid>.md`），不要在 create 路径上反复重试；应改走 commit 通道或提请修写入器解析范围。
4. 报告内引用 report 对象时，`object` 锚点仍可用——受限范围仅限跨类型。

## 验证

已完成：本会话一次真实往返。「本会话一次真实往返：object 锚点引用真实存在的 subgoal → 被拒（零写入）；改 commit 锚点 → 成功（read_back ok）。」失败侧可复现（同一 uid、同一 create 路径、零写入），成功侧有 read_back 回证。

未覆盖（如实标注）：「未验证 summary/audit/reference 形态是否同样受影响（代码路径共用同一 resolveInternalObjectLocators，推断同受影响但未实测）；未验证修复后跨类型 object 解析是否正确（本行动未修写入器）。」

## 影响与适用范围

适用范围：报告写入（`ldvh_report_write`）create 路径上一切 `object` 锚点解析，其中「指向非 report 类型事实对象」的情形必被拒；`commit` 锚点不受影响。共用 `resolveInternalObjectLocators` 的 summary/audit/action/reference 四种 `report_form` 按代码路径推断同受影响（仅 action 实测）。影响面不延伸到 `commit` 锚点、也不延伸到 report 对象间的 `object` 引用。根因落点为写入器实现窄于规范（`objectFilePath` 硬拼 `REPORT_DIRECTORY`），而非契约缺陷——故本条属「已验证的失败机制＋规避」，归 Pitfall；本行动未修写入器，修复后重新验证跨类型 object 解析仍为待办。
