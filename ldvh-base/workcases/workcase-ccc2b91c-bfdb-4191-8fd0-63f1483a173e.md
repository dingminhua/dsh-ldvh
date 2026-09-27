---
fact_type_key: workcase
object_uid: ccc2b91c-bfdb-4191-8fd0-63f1483a173e
title: WorkCase 承接回指的机械承载
status: closed
gist: 为 WorkCase 开放 refs 字段并机械承接回指，使工单关闭后新建的承接对象能机械指向来源工单，让「建议是否已有后续行动」可反查；同时消除 specs/03 与 21 号关于 refs 采用面的矛盾。
serves: SG-3
summary: |-
  为 WorkCase 开放 `refs` 字段（03 §7.2 关联引用型），并把 21 §9.2 已有的「新建对象说明接替的旧对象」从散文要求升级为可机械反查的引用；同时消除 `specs/03` 与 21 号关于 refs 采用面的矛盾。目标是让 WorkCase 关闭后的「建议是否已有后续行动」可被机械反查，而不是只靠人读承接对象的 summary。

  ### 现状核实
  实测：`specs/03` §7.2 第 211 行声明 `refs` 采用范围为 `spark` 与 `workcase` 两个成员；而 `specs/21` 全文零处 `refs`（含全部历史版本），其 §8「公共字段采用」也未列 `refs`；实现层 `workcase-writer.js` 的 `VALID_FM_KEYS` 不含 `refs`（写入即拒），`factFieldContract.ts` 的 workcase 段亦无 `refs`。同一提交 `d723a8f` 的提交信息写「workcase 本轮不做」，与它写入 03 正文的「两个成员」互相矛盾；全库检索 `ldvh-base/` 无任何对象登记过这处不一致。19 份 WorkCase 的 `refs` 字段全部为空。

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
  - step: 核实 refs 采用面矛盾的确切落点与影响面
    done_criteria: 给出 specs/03 与 specs/21 双方的文件:行号与原文对照；列出实现层三处（workcase-writer.js 的 VALID_FM_KEYS、workcase-tools.js 的工具 schema、factFieldContract.ts 的 workcase 段）的当前状态；结论可逐条回读核对
  - step: 消除规范侧矛盾并登记 21 号采用声明
    done_criteria: specs/03 §7.2 与 specs/21 对 refs 采用面的表述一致且与 Human 已确认的方向相符，逐字可查；21 号字段契约含 refs 行，写明基数上限、形状校验与目标解析失败零写入拒绝的口径
  - step: 实现侧接入 refs 字段与校验
    done_criteria: 带合法 refs 的 WorkCase 可写入并回读；空数组、超上限、重复目标、条目含 object_uid 之外字段、目标不可解析五种输入均被拒且错误码可读；writer 测试全绿
  - step: 机械化承接回指并补契约测试
    done_criteria: 存在契约测试断言「承接对象的 refs 携带来源工单 object_uid 时可被解析并回读、反向可枚举」，以及形状非法时的零写入拒绝；21 号写明该引用口径，逐字可查；web 测试全绿、tsc 0 错误、eslint 无新增
gate_1:
  approved_at: 2026-09-27T07:40:07.197Z
  approver: Human
  authorization_fingerprint: b68b3f0bf5c051fba8833fc4f945609ac8e23c076ee7830fb113cb08d71b57b8
  scope_snapshot: |-
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
reviews:
  - at: 2026-09-27T12:32:24.249Z
    provider: deepseek-account
    model: deepseek-flash
    session_id: 9de1c811-7f05-4e58-9d43-c6885acf8aa5
    session_source: host
    implementer_session_id: session-e5bf5adc-66e6-4f02-ae2b-9cab60c81395
    implementer_session_source: host
    summary: |-
      PART 1（≤600 字符）：
      对象：未提交改动（HEAD 389c575f 之上）为 WorkCase 开放 refs 字段：specs/21 六处登记、workcase-writer/tools 接入形状校验与目标解析、web 侧反向投影与测试。基线：389c575f7267dd39c64af50cb3980e30885f08fb。方法：指定 6 步只读命令＋读 resolveRefsTargets 实现。覆盖：六步命令输出、specs/21 与两 lib 全部 diff、resolveRefsTargets 全文。未覆盖：web 反向投影等其余 10 个改动文件与新增测试正文；spark 侧测试未复跑。发现：命令输出与主张全部相符（84/0、372/0、tsc=0、diff --check 干净）；目标解析机械判据确为「同项目事实目录内载体文件存在且 object_uid 行正则可解析」，不读 read_status、不验 frontmatter 合法性，与 §15.1/§16 登记一致；所读 diff 内未见越界或回退。保证边界：B3 判断仅限所读三个 diff；web 实现与测试正文不在覆盖内。
result:
  achieved_scope: "`specs/21` 六处登记 WorkCase `refs` 采用声明与校验口径；`workcase-writer.js` 接入 `refs` 形状校验、目标解析与两种零写入拒绝错误码，并把形状校验前置到 `serves`/`relations`/`refs` 解析之前；`workcase-tools.js` 与 `factFieldContract.ts` 同步；Web 侧新增反向来源索引 `factRefSources`（只在 WorkCase 卡呈现，只表达「谁声明引用了本单」，不表达建议履行、语义覆盖、获批或闭环）；新增契约测试覆盖正向解析、反向可枚举、标题缺失不伪造、列表与详情一致、五种非法形状拒绝，以及生命周期写入中的保全与重批再校验。"
  criteria_checks:
    - evidence: specs/03-事实模型基础规范.md §7.2「采用范围」原文登记 `refs` 采用 `spark`（20）与 `workcase`（21）两个成员；`specs/21-WorkCase-工单.md` 本次改动前全文零处 `refs`（含历史版本）；实现层三点（`workcase-writer.js` 的 `VALID_FM_KEYS`／`workcase-tools.js` 的工具 schema／`factFieldContract.ts` 的 workcase 段）改动前均无 `refs`；三者可由 git diff 与文件行号逐条回读。
      satisfied: true
    - evidence: 03 侧无需改动（原文已含 workcase）；`specs/21` 现登记六处（§7／§8／§12／§13／§15.1／§16），§15.1 明写形状非法落 `workcase/frontmatter_invalid`、目标不可解析落零写入 `workcase/refs_target_unresolvable`；`git diff --check` 干净，无空白错误。
      satisfied: true
    - evidence: "`node --test test/workcase-writer.test.mjs` → tests 84 / pass 84 / fail 0；五种非法形状（空数组／11 项／重复目标／条目含额外字段／目标不可解析）由 `create: refs require exact bounded readable same-project targets and round-trip` 覆盖，生命周期保全由 `refs: survive carried lifecycle writes and are re-validated on rebatch` 覆盖。"
      satisfied: true
    - evidence: "`plugin/web/tests/api/workcase-refs-projection.test.ts` → tests 2 / pass 2 / fail 0（反向可枚举与形状非法零写入）；21 号引用口径逐字可查；`tsc -b --pretty false` → exit 0；`eslint .` 19 条报错全在未改动文件、改动文件零新增；全量 web API 套件 `tsx --test tests/api/*.test.ts` → tests 372 / pass 372 / fail 0。"
      satisfied: true
  residual:
    - "`refs` 在调用方 `frontmatter_after` 未携带时被静默写为 `undefined`（`plugin/lib/workcase-writer.js:1915` 的 payload 权威），实测一次心跳即清除该关联；同形态对 `relations`/`serves`/`summary` 等既有内容字段同样成立，属既有内容字段契约，本单未处置。"
    - 反向枚举只覆盖当前工作树（`currentProjectFactRefSources` 走 `listLocalFacts`），跨工作树的外来对象即便声明 `refs` 也不进反向索引。
    - "`plugin/web/api/services/facts.ts` 的跨工作树外来项投影分支（每作用域 `foreignIndexes` 缓存）无夹具级测试覆盖。"
    - 执行期实测一次外部回退：`specs/21` 六处登记被整体还原为 HEAD 内容（2026-09-27T20:23:17 原子替换、新 inode），原因未查明；同工作树存在并发写入会话，HEAD 于执行期被其他执行者推进到 `389c575`；Human 已停止其他并发工作、六处亦已在 `389c575` 基线上重新登记，但本单改动仍未提交，无机械护栏阻止未提交的已授权产物再被回退。
outcome: completed
created_at: 2026-09-27T03:05:25.800Z
change_log:
  - at: 2026-09-27T03:05:25.800Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 WorkCase 工单（draft，21 §14 C1 提案对象模式）
  - at: 2026-09-27T07:40:07.197Z
    provider: modelflare
    model: gpt-6-sol
    summary: Human 确认按既有计划开放 WorkCase refs 并实现承接反查基础 [gate_1 approved by Human; attempt 1 allocated to 主控会话]
  - at: 2026-09-27T07:58:25.783Z
    provider: modelflare
    model: gpt-6-sol
    summary: 完成计划步骤 1，核实 refs 采用面矛盾与实现影响面 [attempt 1 heartbeat refreshed]
  - at: 2026-09-27T12:11:41.813Z
    provider: deepseek-account
    model: deepseek-flash
    summary: 完成计划步骤 2–4：登记 21 号 refs 采用声明、实现侧接入与校验、承接回指反向契约测试 [attempt 1 heartbeat refreshed]
  - at: 2026-09-27T12:12:54.490Z
    provider: deepseek-account
    model: deepseek-flash
    summary: 复核：已派发隔离会话独立复核本单规范改动、实现接入与契约测试证据；复核在途，结论待回传后经 record_review 录入 [attempt 1 heartbeat refreshed]
  - at: 2026-09-27T12:15:23.737Z
    provider: deepseek-account
    model: deepseek-flash
    summary: 补登 21 号 §15.1 机械校验与 §16 验收表的 refs 行（授权范围明列「验收表」而首轮遗漏）；并记入作者自查实测的「payload 漏传即静默丢弃 refs」结论（非本单引入，列入 residual 待 Human 决定去向） [attempt 1 heartbeat refreshed]
  - at: 2026-09-27T12:18:42.637Z
    provider: deepseek-account
    model: deepseek-flash
    summary: 补「## 结果」关闭提案（逐条判据、已证实范围、残留与去向）；并补登 refs 生命周期保全用例，writer 测试 84/84 [attempt 1 heartbeat refreshed]
  - at: 2026-09-27T12:19:32.671Z
    provider: deepseek-account
    model: deepseek-flash
    summary: 按实测结果更正计划步骤 4 判据为达成并记入全量 web 套件 372/372；同时记明该空转守卫获得核对对象后的数据条件变化 [attempt 1 heartbeat refreshed]
  - at: 2026-09-27T12:31:37.656Z
    provider: deepseek-account
    model: deepseek-flash
    summary: 补记复核驱动的规范措辞更正、执行期外部回退事件与收口前机械证据；结果节补第 4 条残留及其去向 [attempt 1 heartbeat refreshed]
  - at: 2026-09-27T12:32:24.249Z
    provider: deepseek-account
    model: deepseek-flash
    summary: "复核：隔离子代理只读复核 refs 改动最终状态，命令输出与主张全部相符，仅 1 条措辞类轻微发现（工具描述含「可读」）并已随本单更正 [review recorded by session 9de1c811-7f05-4e58-9d43-c6885acf8aa5; reviews entries: 1; 记录自子代理会话 9de1c811-7f05-4e58-9d43-c6885acf8aa5 的最终产出（Code 捕获）]"
  - at: 2026-09-27T12:36:10.397Z
    provider: deepseek-account
    model: deepseek-flash
    summary: 补记独立复核回传与 Code 盖戳录入、复核驱动的工具描述更正，并记入更正后复跑的机械证据（plugin 全量 982/982、web 372/372） [attempt 1 heartbeat refreshed]
  - at: 2026-09-27T12:36:36.673Z
    provider: deepseek-account
    model: deepseek-flash
    summary: 关闭：四项判据均达成并逐条附证据；1 条独立复核已由 Code 盖戳录入 reviews；4 条残留各自标定去向 [gate_2 closed with outcome=completed; attempt 1 retracted]
---

# WorkCase 承接回指的机械承载

## 摘要

为 WorkCase 开放 `refs` 字段（03 §7.2 关联引用型），并把 21 §9.2 已有的「新建对象说明接替的旧对象」从散文要求升级为可机械反查的引用；同时消除 `specs/03` 与 21 号关于 refs 采用面的矛盾。目标是让 WorkCase 关闭后的「建议是否已有后续行动」可被机械反查，而不是只靠人读承接对象的 summary。

### 现状核实
实测：`specs/03` §7.2 第 211 行声明 `refs` 采用范围为 `spark` 与 `workcase` 两个成员；而 `specs/21` 全文零处 `refs`（含全部历史版本），其 §8「公共字段采用」也未列 `refs`；实现层 `workcase-writer.js` 的 `VALID_FM_KEYS` 不含 `refs`（写入即拒），`factFieldContract.ts` 的 workcase 段亦无 `refs`。同一提交 `d723a8f` 的提交信息写「workcase 本轮不做」，与它写入 03 正文的「两个成员」互相矛盾；全库检索 `ldvh-base/` 无任何对象登记过这处不一致。19 份 WorkCase 的 `refs` 字段全部为空。

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

## 执行

- attempt 1 started at 2026-09-27T07:40:07.197Z (controller: 主控会话)；Gate 1 授权范围见 gate_1.scope_snapshot。
- 计划步骤 1 已完成：已核对 `specs/03-事实模型基础规范.md:203-211` 对 `refs` 的采用声明与机械边界；实现侧 `workcase-writer.js`、`workcase-tools.js`、`factFieldContract.ts` 当前均未登记 WorkCase `refs`；已确认 `specs/21-WorkCase-工单.md` 当前无 `refs` 字段契约，且 WC 间生命周期关系仍被 §19 禁止。
- 计划步骤 2 已完成：核对 `specs/03-事实模型基础规范.md` §7.2「采用范围」原文——`refs` 采用范围为 `spark`（20）与 `workcase`（21）两个成员，03 侧无需改动即已与 Human 决定一致，矛盾在 21 侧，故改 21。`specs/21-WorkCase-工单.md` 现登记六处：§7「公共字段实际采用」加入条件字段 `refs`；§8 字段契约表新增 `refs` 行（`array`／条件；口径为非空 `[{object_uid}]`、最多 10 项、无重复、目标须为可解析的同项目事实对象，机械口径见 §15.1，并明写本项未覆盖目标可读性）；§12 关系契约表新增 `refs` 行并改写收束段（不建 WC 之间的父子或依赖边、不把 `refs` 伪装成关系；`refs` 只回答「该对象声明引用了谁」，反向 `refs` 只回答「当前可读事实对象声明引用了本 WC」，二者均不回答建议是否履行／语义是否覆盖／是否获批／是否闭环；引用变更须用对象当前指纹绑定的完整更新入口）；§13 召回表新增「关闭 WC 的普通引用召回」行；§15.1 机械校验新增「`refs` 有效性（§8 / 03 §7.2）」项（形状非法拒绝写入 `workcase/frontmatter_invalid`；形状合法但目标不可解析为零写入 `workcase/refs_target_unresolvable`；其未验证范围明写不校验目标 `read_status` 可读性、frontmatter 合法性、引用语义与目标状态）；§16 验收表新增「`refs` 形状与目标可解析」行（同口径，含「不证明目标可读／frontmatter 合法／引用语义恰当／建议已履行／语义已覆盖／已获批或目标完成」）。后两处系复核期间补登——授权范围明列「验收表」，而首轮只登记了 §7/§8/§12/§13 四处，验收与机械校验两表在补登前无 `refs` 行。逐字可查。
- 计划步骤 3 已完成：`plugin/lib/workcase-writer.js` 把 `refs` 加入 `VALID_FM_KEYS` 与 `FRONTMATTER_FIELD_ORDER`；`validateWorkcaseFrontmatter` 校验「可选但非空数组、最多 10 项、条目为精确 `{object_uid}`（拒绝额外字段）、UUIDv4、拒绝重复目标（大小写不敏感）」；`evaluateCreateCandidate` 调整为**先跑 `validateCreateCandidate`（形状与正文/连贯性）再解析 `serves`/`relations`/`refs`**，使形状非法落 `workcase/frontmatter_invalid`、形状合法但目标不可解析落 `workcase/refs_target_unresolvable`，两者都是零写入拒绝；`plugin/lib/workcase-tools.js` 登记 `refs` 工具 schema（`maxItems: 10`、`items.additionalProperties: false`）；`plugin/web/api/services/factFieldContract.ts` 的 workcase 段登记 `refs`（`array`、`required: false`）。证据：`plugin/test/workcase-writer.test.mjs` 两条用例——`create: refs require exact bounded readable same-project targets and round-trip` 覆盖合法往返、空数组、11 项、重复目标、条目含 `object_uid` 之外字段、目标缺失；`refs: survive carried lifecycle writes and are re-validated on rebatch` 覆盖创建→批准落盘可回读、`execute` 携带时保留、`rebatch` 改写 `refs` 仍按同一口径解析目标（不可解析即零写入拒绝且对象未被改写）。`node --test test/workcase-writer.test.mjs` → tests 84 / pass 84 / fail 0。
- 计划步骤 4 已完成：新增 `plugin/web/tests/api/workcase-refs-projection.test.ts`，断言「承接对象的 `refs` 携带来源工单 `object_uid` 时可被解析并回读、反向可枚举」——来源工单卡与详情均给出反向 `factRefSources`（可读但无 `title` 的来源仍 `available: true` 且不伪造 `title`）、列表卡与详情逐字一致、反向条目不携带 `outcome`/`result`/`satisfied`/`coverage`/`closure` 一类结论字段、反向枚举只挂在 WorkCase 上（普通目标对象不凭空获得）。证据：`tsx --test tests/api/workcase-refs-projection.test.ts` → tests 2 / pass 2 / fail 0；refs 相关聚焦套件（refs 反向、spark-refs、字段契约、呈现契约、详情契约、gist 契约）→ tests 32 / pass 32 / fail 0；`tsc -b --pretty false` → exit 0 无输出；`eslint .` 的 19 条报错全部落在本次未改动的文件（`friction-writer.js`、`governance-scope.js`、`pitfall-writer.js`、`research-writer.js`、`scripts/backfill-spark-priority.mjs`），本次改动文件零新增。
- 全量 web API 套件在本单写入「## 结果」前为 tests 372 / pass 371 / fail 1，唯一失败是 `plugin/web/tests/api/workcase-projection-fidelity.test.ts:392` 的守卫——它要求「至少存在一个 `status=open` 且正文带「## 结果」节的真实 WorkCase」，而那时 8 个 open 对象无一携带该节（HEAD 上带「## 结果」的 9 份全部 `status=closed`），故其 416 行断言 `必须至少核对一个「待批准关闭」对象，否则本守卫是空转` 失败。本单作为待批准关闭对象写入「## 结果」后，该守卫不再空转、转为逐条核对本单的 4 条判据与 plan 步数是否一致；写入后实测全量 web API 套件 tests 372 / pass 372 / fail 0。这是守卫获得核对对象后的数据条件变化，不是本单对守卫代码的修改——本单未改动任何测试守卫，失败方与被核对方分别是守卫与本单自身，属同一事实源头两端的诚实情况，记此以备复核。
- 独立复核的派发与回传：首次（子代理 `96beee60-c232-45b9-ae91-58799892bd4e`）与第二次（`17ac4de6-a620-4d31-87e6-365381786ab5`）派发均长时间未回传结论、被中断且未留下收口记录，其 id 也不在 `ldvh_collect_subagent_results` 的登记集中，故无法经 `record_review` 的 `reviewer_child_agent_id` 录入；第三次派发（子代理 `9de1c811-7f05-4e58-9d43-c6885acf8aa5`，会话不同于执行者，只读）为本次收口所依据的独立复核——其结论经 `record_review` 由 Code 从子代理登记处取身份并盖戳录入 `reviews`，本单在 `reviews` 非空前不得关闭（21 §9.1）。
- 非计划步骤事项（作者自查，独立于四项计划步骤）：以一次性探针实测「调用方 `frontmatter_after` 未携带 `refs` 时，既有 `refs` 是否被静默丢弃」——结论为**是**：`executeWorkcaseObject` 的 `next` 是调用方 payload 的克隆（`plugin/lib/workcase-writer.js:1915`），除 Code 托管字段外一律以 payload 为准，故一次未携带 `refs` 的心跳把 `refs` 写为 `undefined`（探针实测 `refs after heartbeat: undefined`）。同一形态对 `relations`/`serves`/`summary` 等既有内容字段同样成立（`next.relations` 亦直接取自 payload，无一例外），而 `reviews` 因身份载体另有继承兜底（`plugin/lib/workcase-writer.js:1938`，其注释记录 `workcase-364df30e` 的同类静默清除事故）。故这不是本单新引入的缺陷，而是新字段继承的既有内容字段契约；测试探针文件已删除，未留在套件中。该项列入「## 结果」的 residual，处置去向提请 Human 决定。
- 复核驱动的规范更正（非计划步骤事项，独立于四项计划步骤）：隔离复核指出 `specs/21` §15.1／§16 的首轮措辞「目标缺失或**不可读**即零写入拒绝」强于机械实现——`resolveRefsTargets`（`plugin/lib/workcase-writer.js:77` 自 `plugin/lib/spark-writer.js` 导入）的真实判据是「同项目事实目录内存在载体文件且其 `object_uid` 行可解析」，并不评估 `read_status` 或 frontmatter 合法性（其自身失败原因字符串却写「existing, readable, same-project fact objects」）。该分歧由本单新增的规范句引入，而授权口径原文为「目标解析失败零写入拒绝」，故按授权口径把两处更正为「目标不可解析」，并把可读性、frontmatter 合法性、引用语义与目标状态移入**未验证范围**（§16 的「不证明」列与 §12 收束段已同向声明）。更正后逐字可查。
- 执行期外部回退事件（非计划步骤事项，独立于四项计划步骤）：本单执行期间 `specs/21-WorkCase-工单.md` 的六处 `refs` 登记被整体还原为 HEAD 内容（该文件 mtime／ctime／birth 均为 2026-09-27T20:23:17 且为新 inode，属原子替换；`git status` 对该路径一度干净）。原因未能查明——会话记录中检索不到针对该路径的 `git checkout`／`restore`／`stash` 调用。同工作树存在并发写入会话（`session-86b7b27c-0223-449e-9991-74d2bc2c4bb0`，cwd 与本单相同），且 HEAD 于执行期被其他执行者推进到 `389c575f7267dd39c64af50cb3980e30885f08fb`（2026-09-27T20:00:24，提交信息以「fix(workcase): 透传 plan 清单到工具成功信封」开头）。经 Human 裁定「重新登记」，六处登记已在 `389c575` 基线上按更正后口径重做（`git diff --stat -- specs/21-WorkCase-工单.md` = 7 insertions(+), 2 deletions(-)，`git diff --check` 干净），其余 11 份改动文件与新增测试文件未受影响；Human 并已停止其他并发工作。本单改动仍未提交，该风险列入「## 结果」的 residual。
- 收口前的最终机械证据（非计划步骤事项，独立于四项计划步骤）：`plugin --test test/workcase-writer.test.mjs` → tests 84 / pass 84 / fail 0；`tsx --test tests/api/*.test.ts`（web 全量 API）→ tests 372 / pass 372 / fail 0；`tsc -b --pretty false` → exit 0；`git diff --check` 干净；HEAD = `389c575f7267dd39c64af50cb3980e30885f08fb`；`git status --short` 13 行（12 改 + 1 新增测试）；`git diff --stat` = 12 files changed, 487 insertions(+), 23 deletions(-)；`eslint .` 的 19 条报错全部落在本单未改动的文件。本节末条措辞更正后复跑：`plugin --test test/workcase-writer.test.mjs` → tests 84 / pass 84 / fail 0；plugin 全量 `node --test test/*.test.mjs`（PATH 含 `node`）→ tests 982 / pass 982 / fail 0；`tsx --test tests/api/*.test.ts` → tests 372 / pass 372 / fail 0；`tsc -b --pretty false` → exit 0；`git diff --check` 干净；`git diff --stat` = 12 files changed, 519 insertions(+), 31 deletions(-)（增量来自「## 执行」「## 结果」两节的补记，非代码变化）。环境注意：本环境默认 PATH 无 `node`，plugin 全量套件在未把 `/opt/homebrew/bin` 加入 PATH 时 `hook-manager` 用例会因 hook 预检脚本报 `exec: node: not found` 而失败，与本单改动无关；加 PATH 后 982/982 全绿。
- 独立复核回传与录入（非计划步骤事项，独立于四项计划步骤）：第三次派发的只读复核（子代理 `9de1c811-7f05-4e58-9d43-c6885acf8aa5`，会话不同于执行者）已回传结论：对象为 `HEAD 389c575f` 之上的未提交改动（21 号六处登记、`workcase-writer.js`／`workcase-tools.js` 接入形状校验与目标解析、web 侧反向投影与测试）；基线 `389c575f7267dd39c64af50cb3980e30885f08fb`；方法为指定 6 步只读命令＋通读 `resolveRefsTargets`（`plugin/lib/spark-writer.js:413-471`）；发现为「命令输出与主张全部相符（84/0、372/0、`tsc`=0、`diff --check` 干净），目标解析机械判据确为『同项目事实目录内载体文件存在且 `object_uid` 行正则可解析』、不读 `read_status`、不验 frontmatter 合法性，与 §15.1／§16 登记一致，所读 diff 内未见越界或回退」，另有 1 条措辞类轻微发现（见下条）；其自陈保证边界为「判断仅限所读的三个 diff，web 实现与测试正文不在覆盖内，spark 侧测试未复跑」。该结论已由 Code 从子代理登记处取身份并盖戳录入 `reviews`（`at` 2026-09-27T12:32:24.249Z，`provider`／`model`／`session_id`／`implementer_session_id` 均由 Code 托管、非本会话自填），本单 `reviews` 条数 1，21 §9.1 的关闭前置已满足。
- 复核驱动的第二处更正（非计划步骤事项，独立于四项计划步骤）：上述复核的第 1 条发现指出 `plugin/lib/workcase-tools.js` 的 `refs` 参数描述写「目标为可读的同项目事实对象」，强于机械判据（只做 `object_uid` 行正则命中，不读 `read_status`、不验 frontmatter 合法性）；已改为「目标须为可解析的同项目事实对象（同项目事实目录内存在载体文件且其 `object_uid` 行可解析；不校验目标可读性与 frontmatter 合法性，机械口径见 21 §15.1）」，与 §15.1／§16 登记同口径。同形态的 `plugin/lib/spark-writer.js:467` 失败原因文案含 `existing, readable, same-project fact objects`，属 spark 侧既有文案，而本单授权范围明写「不改 `spark` 侧既有 `refs` 语义与形态」，故只记录、不改动，作为交付的已知边界随本单留档。

## 结果

- criteria_checks:
  - 步骤 1 判据「矛盾落点与影响面逐条可回读」：**达成**——证据：`specs/03-事实模型基础规范.md` §7.2「采用范围」原文登记 `refs` 采用 `spark`（20）与 `workcase`（21）两个成员；`specs/21-WorkCase-工单.md` 在本次改动前全文零处 `refs`（含其历史版本）；实现层三点（`workcase-writer.js` 的 `VALID_FM_KEYS`／`workcase-tools.js` 的工具 schema／`factFieldContract.ts` 的 workcase 段）改动前均无 `refs`。三者均可由 git diff 与文件行号逐条回读。
  - 步骤 2 判据「03 与 21 口径一致，21 含基数与拒绝口径」：**达成**——证据：03 侧无需改动（原文已含 workcase）；21 号现登记六处（§7／§8／§12／§13／§15.1／§16），§15.1 明写形状非法落 `workcase/frontmatter_invalid`、目标不可解析落零写入 `workcase/refs_target_unresolvable`；`git diff --check` 干净，无空白错误。
  - 步骤 3 判据「合法可写入回读，五种非法输入零写入拒绝」：**达成**——证据：`node --test test/workcase-writer.test.mjs` → tests 84 / pass 84 / fail 0；五种非法形状（空数组／11 项／重复目标／条目含额外字段／目标不可解析）由 `create: refs require exact bounded readable same-project targets and round-trip` 覆盖，生命周期保全由 `refs: survive carried lifecycle writes and are re-validated on rebatch` 覆盖。
  - 步骤 4 判据「反向可枚举契约测试、21 引用口径、web 全绿与 tsc/eslint」：**达成**——证据：反向可枚举与形状非法零写入均有契约测试（`plugin/web/tests/api/workcase-refs-projection.test.ts` → tests 2 / pass 2 / fail 0）；21 号引用口径逐字可查；`tsc -b --pretty false` → exit 0；`eslint .` 19 条报错全在本次未改动文件、本次改动文件零新增；全量 web API 套件 `tsx --test tests/api/*.test.ts` → tests 372 / pass 372 / fail 0。
- achieved_scope：`specs/21` 六处登记 WorkCase `refs` 采用声明与校验口径；`workcase-writer.js` 接入 `refs` 形状校验、目标解析与两种零写入拒绝错误码，并把形状校验前置到 `serves`/`relations`/`refs` 解析之前；`workcase-tools.js` 与 `factFieldContract.ts` 同步；Web 侧新增反向来源索引 `factRefSources`（只在 WorkCase 卡呈现，只表达「谁声明引用了本单」，不表达建议履行、语义覆盖、获批或闭环）；新增契约测试覆盖正向解析、反向可枚举、标题缺失不伪造、列表与详情一致、五种非法形状拒绝，以及生命周期写入中的保全与重批再校验。
- residual:
  - `refs` 在调用方 `frontmatter_after` 未携带时被静默写为 `undefined`（`plugin/lib/workcase-writer.js:1915` 的 payload 权威），实测一次心跳即清除该关联；同形态对 `relations`/`serves`/`summary` 等既有内容字段同样成立，属既有内容字段契约，本单未处置。
  - 反向枚举只覆盖当前工作树（`currentProjectFactRefSources` 走 `listLocalFacts`），跨工作树的外来对象即便声明 `refs` 也不进反向索引。
  - `plugin/web/api/services/facts.ts` 的跨工作树外来项投影分支（每作用域 `foreignIndexes` 缓存）无夹具级测试覆盖。
  - 执行期实测一次外部回退：`specs/21` 六处登记被整体还原为 HEAD 内容（2026-09-27T20:23:17 原子替换、新 inode），原因未查明；同工作树存在并发写入会话，HEAD 于执行期被其他执行者推进到 `389c575`。Human 已停止其他并发工作、六处亦已在 `389c575` 基线上重新登记，但机制缺口未变化——本单改动仍未提交，无机械护栏阻止未提交的已授权产物再被回退。
- 后续方向：本单只完成机械前提——承接对象可用 `refs` 指向来源工单、消费方按需反查来源；若要让「承接即登记回指」成为关闭后的常规动作，还需在 21 号另立操作性约定（何时应写、写在何处、漏写如何被发现），该约定不在本单授权范围内。

- advice:
  - **另立工单**：把 refs 在 payload 省略时被静默清除的问题，与 relations／serves／summary 的同类形态一并收敛（统一为省略即保留落盘值，或统一为必须显式传递）。出自「refs 在调用方 frontmatter_after 未携带时被静默写为 undefined」
  - **另立工单**：为 facts.ts 的跨工作树外来项投影分支补夹具级测试，并一并决定反向枚举是否应覆盖跨工作树外来声明。出自「反向枚举只覆盖当前工作树」
  - **接受现状**：跨工作树投影分支与反向范围边界按现有 21／03 登记口径留待出现真实跨工作树承接需求时再定。出自「facts.ts 的跨工作树外来项投影分支无夹具级测试覆盖」
  - **直接行动**：由 Human 决定是否把本单未提交的改动经受控提交固化（06 §6.2 预检 + Git Gate），以降低再次被并发回退的风险；是否另设「提交前差异守卫」不在本单授权范围，可由 Human 另行分流。出自「执行期实测一次外部回退」

