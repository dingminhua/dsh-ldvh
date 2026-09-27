---
fact_type_key: workcase
object_uid: ccc2b91c-bfdb-4191-8fd0-63f1483a173e
title: WorkCase 承接回指的机械承载
status: draft
gist: 为 WorkCase 开放 refs 字段并机械承接回指，使工单关闭后新建的承接对象能机械指向来源工单，让「建议是否已有后续行动」可反查；同时消除 specs/03 与 21 号关于 refs 采用面的矛盾。
serves: SG-3
summary: |-
  为 WorkCase 开放 `refs` 字段（03 §7.2 关联引用型），并把 21 §9.2 已有的「新建对象说明接替的旧对象」从散文要求升级为可机械反查的引用；同时消除 `specs/03` 与 `specs/21` 之间关于 `refs` 采用面的矛盾。目标是让 WorkCase 关闭后的「建议是否已有后续行动」可被机械反查，而不是只靠人读承接对象的 summary。

  ### 现状核实
  实测：`specs/03` §7.2 第 211 行声明 `refs` 采用范围为 `spark` 与 `workcase` 两个成员；而 `specs/21` 全文零处 `refs`（含全部历史版本），其 §8「公共字段实际采用」也未列 `refs`；实现层 `workcase-writer.js` 的 `VALID_FM_KEYS` 不含 `refs`（写入即拒），`factFieldContract.ts` 的 workcase 段亦无 `refs`。同一提交 `d723a8f` 的提交信息写「workcase 本轮不做」，与它写入 03 正文的「两个成员」互相矛盾；全库检索 `ldvh-base/` 无任何对象登记过这处不一致。19 份 WorkCase 的 `refs` 字段全部为空。

  ### 处置方向
  以 Human 已确认的方向为准：`refs` 开放给 WorkCase。据此补齐 21 号声明、实现层字段与校验，以及承接回指的机械前提。回指按 03 §7.2 的引用型形态承载——目标为事实对象 `object_uid`，机械侧只校验形状与目标可解析，不校验语义与目标状态。

  ### 边界
  不改已关闭对象（21 §9.2 终态不重开）；不新增正文 H2 节（正文 H2 为裁定闭集）；不把 `closed` 改为可写；不清点存量悬空建议（另属独立工作）。
scope: |-
  做什么：
  - 消除 `specs/03` §7.2 与 `specs/21` 之间关于 `refs` 采用面的矛盾，使两处口径与 Human 的决定一致；
  - 在 `specs/21` 登记 `refs` 采用声明：§8 的公共字段采用列表与实际采用字段、字段契约表、验收表，并写明基数上限与校验口径；
  - 实现侧接入：`workcase-writer.js` 的 frontmatter 闭集与形状校验（照 `spark-writer.js` 既有形态）、目标解析与零写入拒绝错误码、`workcase-tools.js` 工具 schema、`factFieldContract.ts` 的 workcase 字段契约；
  - 把 21 §9.2「新对象说明接替的旧对象」从散文要求机械化为可反查引用：承接对象携带指向来源工单的 `refs`，并在 21 号写明该引用的登记与校验口径；
  - 补契约测试：承接回指可解析与反向可枚举、形状与目标解析失败零写入拒绝。

  明确不做什么：
  - 不改已关闭 WorkCase 对象，不使 `closed` 变为可写；
  - 不给建议条目引入稳定标识或状态字段；
  - 不新增任何正文 H2 节（正文 H2 为裁定闭集）；
  - 不改 `plan`/`scope` 形状；
  - 不清点存量悬空建议（另属独立工作）；
  - 不改 `spark` 侧既有 `refs` 语义与形态。
plan:
  - done_criteria: 给出 specs/03 与 specs/21 双方的文件:行号与原文对照；列出实现层三处（workcase-writer.js 的 VALID_FM_KEYS、workcase-tools.js 的工具 schema、factFieldContract.ts 的 workcase 段）的当前状态；结论可逐条回读核对
    step: 核实 refs 采用面矛盾的确切落点与影响面
  - done_criteria: specs/03 §7.2 与 specs/21 对 refs 采用面的表述一致且与 Human 已确认的方向相符，逐字可查；21 号字段契约含 refs 行，写明基数上限、形状校验与目标解析失败零写入拒绝的口径
    step: 消除规范侧矛盾并登记 21 号采用声明
  - done_criteria: 带合法 refs 的 WorkCase 可写入并回读；空数组、超上限、重复目标、条目含 object_uid 之外字段、目标不可解析五种输入均被拒且错误码可读；writer 测试全绿
    step: 实现侧接入 refs 字段与校验
  - done_criteria: 存在契约测试断言「承接对象的 refs 携带来源工单 object_uid 时可被解析并回读、反向可枚举」，以及形状非法时的零写入拒绝；21 号写明该引用口径，逐字可查；web 测试全绿、tsc 0 错误、eslint 无新增
    step: 机械化承接回指并补契约测试
created_at: 2026-09-27T03:05:25.800Z
change_log:
  - at: 2026-09-27T03:05:25.800Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 WorkCase 工单（draft，21 §14 C1 提案对象模式）
---

# WorkCase 承接回指的机械承载

## 摘要

为 WorkCase 开放 `refs` 字段（03 §7.2 关联引用型），并把 21 §9.2 已有的「新建对象说明接替的旧对象」从散文要求升级为可机械反查的引用；同时消除 `specs/03` 与 `specs/21` 之间关于 `refs` 采用面的矛盾。目标是让 WorkCase 关闭后的「建议是否已有后续行动」可被机械反查，而不是只靠人读承接对象的 summary。

### 现状核实
实测：`specs/03` §7.2 第 211 行声明 `refs` 采用范围为 `spark` 与 `workcase` 两个成员；而 `specs/21` 全文零处 `refs`（含全部历史版本），其 §8「公共字段实际采用」也未列 `refs`；实现层 `workcase-writer.js` 的 `VALID_FM_KEYS` 不含 `refs`（写入即拒），`factFieldContract.ts` 的 workcase 段亦无 `refs`。同一提交 `d723a8f` 的提交信息写「workcase 本轮不做」，与它写入 03 正文的「两个成员」互相矛盾；全库检索 `ldvh-base/` 无任何对象登记过这处不一致。19 份 WorkCase 的 `refs` 字段全部为空。

### 处置方向
以 Human 已确认的方向为准：`refs` 开放给 WorkCase。据此补齐 21 号声明、实现层字段与校验，以及承接回指的机械前提。回指按 03 §7.2 的引用型形态承载——目标为事实对象 `object_uid`，机械侧只校验形状与目标可解析，不校验语义与目标状态。

### 边界
不改已关闭对象（21 §9.2 终态不重开）；不新增正文 H2 节（正文 H2 为裁定闭集）；不把 `closed` 改为可写；不清点存量悬空建议（另属独立工作）。

## 授权范围

做什么：
- 消除 `specs/03` §7.2 与 `specs/21` 之间关于 `refs` 采用面的矛盾，使两处口径与 Human 的决定一致；
- 在 `specs/21` 登记 `refs` 采用声明：§8 的公共字段采用列表与实际采用字段、字段契约表、验收表，并写明基数上限与校验口径；
- 实现侧接入：`workcase-writer.js` 的 frontmatter 闭集与形状校验（照 `spark-writer.js` 既有形态）、目标解析与零写入拒绝错误码、`workcase-tools.js` 工具 schema、`factFieldContract.ts` 的 workcase 字段契约；
- 把 21 §9.2「新对象说明接替的旧对象」从散文要求机械化为可反查引用：承接对象携带指向来源工单的 `refs`，并在 21 号写明该引用的登记与校验口径；
- 补契约测试：承接回指可解析与反向可枚举、形状与目标解析失败零写入拒绝。

明确不做什么：
- 不改已关闭 WorkCase 对象，不使 `closed` 变为可写；
- 不给建议条目引入稳定标识或状态字段；
- 不新增任何正文 H2 节（正文 H2 为裁定闭集）；
- 不改 `plan`/`scope` 形状；
- 不清点存量悬空建议（另属独立工作）；
- 不改 `spark` 侧既有 `refs` 语义与形态。

## 计划

- 核实 refs 采用面矛盾的确切落点与影响面：判据——给出 specs/03 与 specs/21 双方的文件:行号与原文对照；列出实现层三处（workcase-writer.js 的 VALID_FM_KEYS、workcase-tools.js 的工具 schema、factFieldContract.ts 的 workcase 段）的当前状态；结论可逐条回读核对
- 消除规范侧矛盾并登记 21 号采用声明：判据——specs/03 §7.2 与 specs/21 对 refs 采用面的表述一致且与 Human 已确认的方向相符，逐字可查；21 号字段契约含 refs 行，写明基数上限、形状校验与目标解析失败零写入拒绝的口径
- 实现侧接入 refs 字段与校验：判据——带合法 refs 的 WorkCase 可写入并回读；空数组、超上限、重复目标、条目含 object_uid 之外字段、目标不可解析五种输入均被拒且错误码可读；writer 测试全绿
- 机械化承接回指并补契约测试：判据——存在契约测试断言「承接对象的 refs 携带来源工单 object_uid 时可被解析并回读、反向可枚举」，以及形状非法时的零写入拒绝；21 号写明该引用口径，逐字可查；web 测试全绿、tsc 0 错误、eslint 无新增

