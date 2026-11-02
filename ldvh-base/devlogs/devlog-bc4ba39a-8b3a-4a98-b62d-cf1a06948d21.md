---
title: 建前审核分区覆盖与轮次上限落盘
status: active
occurred_at: 2026-10-27T21:54:47+08:00
summary: 21 号建前审核的分区增量覆盖、轮次上限与 rebatch 保留流水三处口径已随提交 9391fb7 与规范同批落盘，候选文档自述的「未并入 specs/21」在落档时已过期；附带登记一条只在实现侧、不在规范正文的边界——未知分区 id 一律拒绝，specs/21 正文对它零命中。
refs:
  - object_uid: 996e207a-3ca2-494b-bcbe-3f00d7c0c3b7
  - object_uid: c36b0208-cdcf-423d-94e1-e1c735562897
object_uid: bc4ba39a-8b3a-4a98-b62d-cf1a06948d21
fact_type_key: devlog
created_at: 2026-11-02T08:35:00.846Z
change_log:
  - at: 2026-11-02T08:35:00.846Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 DevLog 对象
  - at: 2026-11-02T08:35:45.031Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 更正去向：本条保持 active 不转 absorbed（29 §9.1 — 实测数字不被承接物承载，压缩会使 996e207a 6轮/4条等测量不可读）
  - at: 2026-11-02T11:48:30.104Z
    provider: qoder-global
    model: mmodel
    summary: 登记内容关联 refs（29 §8 / §11 / §12.3bis，2026-11-02 Human 裁定扩采用面）：条目侧登记自己与哪些事实对象有内容关联——正文「实测」段逐条对照这两张工单的审计条数与结论。正文与状态判定逐字不变。
---

# 建前审核分区覆盖与轮次上限落盘

## 背景

源文档《21 号建前审核机制修订候选（2026-10-27）》（文件名 `proposal-audit-partition-2026-10-27.md`，首次入库提交 `9391fb7d85894788ee7ef6f2c3b20515e7a500e1`，135 行；落档后该文件已删除，正文可经该提交的目录树取出）。其自述状态为「候选，未并入 `specs/21`」，但实测该自述已过期：落实提交 `9391fb7`（2026-10-27 21:54:47 `fix(workcase): 建前审核改分区增量覆盖与轮次上限`）同一批既新增该文档，又把候选内容改写进 `specs/21-WorkCase 工单.md` 的五节。本文记的是一次「候选与落盘同批完成」的修订过程。

## 做法

候选提出三处口径改动，全部按「旧→新」逐节对照落盘：

1. **分区（增量审核）**：审核单位从「整体 `plan`+`scope` 指纹」改为分区——`plan` 每步骤一个 `plan#N`，`scope` 每条目一个 `scope:<标签>#N`；分区指纹取内容哈希、不含索引，故增删步骤不使其余分区漂移。`pre_reviews` 条目新增 `covered_partitions`，覆盖闸改为「当前每个分区的指纹都被某条合格条目覆盖」。
2. **轮次（单门 3 次）**：`pre_reviews` 新增 `round_index`；上限按**不同 `round_index` 值的个数**计数，不因修订或 `rebatch` 重置；同一轮的多个分片共享同一 `round_index`，故分片不占额外轮次。
3. **`rebatch` 保留审核流水**：原「重批后 `pre_reviews` 清零」改为保留为历史——分区指纹按内容匹配，旧条目不会覆盖重批后的新内容；清零会把轮次计数一并丢掉，使「重批后再审 3 轮」成为绕过上限的新路径。

## 实测

- 改造前的上限结构性不可达：计数读 `candidate_fingerprint` 整体指纹，而每轮修订都改 `plan`/`scope`、指纹必然变化，计数随之归零。实测 `workcase-996e207a` 建前审核自述 6 轮、`pre_reviews` 实存 4 条且 4 个指纹各 1 条，单指纹最高条数 1；`workcase-c36b0208` 自述 4 轮、实存 3 条；全库 10 条、单指纹最高 2 条。`pre_gate1_audit_round_cap` 在本仓库**零触发**。
- 落盘后规范侧取证：`specs/21-WorkCase 工单.md` 含 `covered_partitions` 6 次、`round_index` 12 次、`pre_gate1_audit_not_covering_candidate` 2 次、`pre_gate1_audit_round_cap` 4 次。
- 实现侧取证：`plugin/lib/workcase-writer.js` 的未知分区 id 错误分支（约 :3400）、`plugin/lib/workcase-tools.js` 的 `covered_partitions` 参数描述（约 :1477）；`plugin/test/workcase-audit-partitions.test.mjs` 含「分区 id 未知时拒绝记录」用例（约 :251）。

## 结论与边界

21 号建前审核的分区增量覆盖、轮次上限与 rebatch 保留流水三处口径已随提交 9391fb7 与规范同批落盘，候选文档自述的「未并入 specs/21」在落档时已过期；附带登记一条只在实现侧、不在规范正文的边界——未知分区 id 一律拒绝，specs/21 正文对它零命中。

该候选的三处口径已全部落盘，无一处停留在「候选」状态；其自述「未并入 specs/21」在落档时已是过期陈述。

进一步三条边界，均如实登记：

1. **一条边界只在实现侧、不在规范正文**：「未知分区 id 一律拒绝（fail closed）」只写在 `plugin/lib/workcase-writer.js` 的错误分支、`plugin/lib/workcase-tools.js` 的工具参数描述与上述测试用例中；`specs/21` 正文对该情形**零命中**。它与验证表里的「报告未覆盖分区 id」（`pre_gate1_audit_not_covering_candidate`）不是同一件事：后者是「某分区没有 `pass` 结论」，前者是「调用方给了一个不在当前候选里的分区 id」。是否把前者写进 `specs/21`，本次不作决定。
2. **不证明审核质量**：分区覆盖只证明「每个分区有一条针对其当前内容的 `pass` 结论」，不证明该分区被实质审过、审得对。与改造前的边界同口径。
3. **分区 id 随内容变化**：调用方沿用旧 id 会被拒绝，须按当前分区重取——这是有意的，避免「用旧分区声明覆盖新内容」。

## 去向

- 承接物：提交 `9391fb7d85894788ee7ef6f2c3b20515e7a500e1`（规范侧与实现侧同批落盘）；规则条文本身见 `specs/21-WorkCase 工单.md` 的 §8 字段表、§9.2、§14 与 §16 验证表。
- **本条保持 `active`，不转 `absorbed`**。理由按 29 §9.1 已如实登记的代价：`absorbed` 会压缩掉「背景」「做法」「实测」三段，而本节「实测」里的数字（996e207a 自述 6 轮 / 实存 4 条、c36b0208 4 轮 / 3 条、全库 10 条、`pre_gate1_audit_round_cap` 零触发）**不被承接物承载**——`specs/21` 只写规则不写测量，commit 也只承载代码变更。29 §9.1 明写「需要长期保留实测数字的结论不应转为 absorbed」，本条属于该情形。
- 边界第 1 条（未知分区 id 拒绝只在实现侧）是规范侧的已知缺口，需要另立决定是否补进 `specs/21`；它不因本条存在而自动消解。
- 源文档 `proposal-audit-partition-2026-10-27.md` 在本条落盘并回读之后删除；其正文可经提交 `9391fb7` 的目录树取出，故删除不使证据不可回查。
