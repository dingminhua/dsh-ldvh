---
title: WorkCase 承载层与 attempt 接缝
status: open
question: WorkCase 事实类型的承载层应如何建成，attempt 令牌缺宿主实现这一接缝如何闭合？
scope_boundary: WorkCase 可完成出生→Gate 1→执行→Gate 2 一轮，且 attempt 的宿主实现归属已定案时停止。不含 Norm 承载层（另有独立对象承载）；不含 21 号自身的规范修订——若定案路径选择修订 21（如降级 attempt），该修订本身另走 Human Gate，不在本对象的执行范围内。
intent: 保留理由——21 号规范已定稿且字段契约完整，但 WorkCase 承载层零实现，且 `attempt` 被 §10.4 推给 10/06 而创建时点实测该两份规范对该词零命中；§9.1 又把 `attempt` 定为 `open` 状态的必要条件，故 WorkCase 能创建却永远走不出 draft，SG-2 因之推不动。与 Norm 拆开的理由——这条的真实卡点在**规范间接缝**而非实现量，合并承载会把「待定案」误呈现为「待补写」。后续方向——先定案 attempt 归属（补 10/06 定义，或改 21 §9.1 降级该字段，二者均需 Human Gate），再实现承载层，最后以真实一轮验证。
summary: 21 号规范已定稿；`FACT_DIRECTORIES`（`plugin/lib/governed-projects.js:17`）已含 `workcases`；Web 侧已接入（`factFieldContract.ts`、`localFactReader.ts` 与 WorkCase 相关组件）。真实缺口为整套承载层：无 `plugin/lib/workcase-writer.js`、无 `ldvh_workcase_*` 受控入口、Git Gate 未覆盖 `workcases/` 断言；目录 `ldvh-base/workcases/` 于 2026-09-13 由 Human 裁定补建（此前并不存在）。**核心约束是跨规范接缝**：21 §9.1 规定 `open` 状态必填 `attempt`，而 §10.4 第 4 项声明 attempt 宿主实现应由 10/06 承接且未落地前「依赖 attempt 的部分不成立」、§15.2 记其替代保障为「无」；`review-21-workcase.md`（原 docs 目录，已随 `ec19ba6` 清除、可自该提交回取） 已核实（2026-09-13 时点）当时 08/09 对该词零命中。故当前形态下 WorkCase 能出生但走不出 draft。
serves: befe1735-1187-4d60-ba53-e55eb0cb7de2
priority: P1
object_uid: 27a9dbfc-35ca-485e-83f8-182fd8f0f1c9
fact_type_key: spark
created_at: 2026-09-13T18:37:17.929Z
change_log:
  - at: 2026-09-13T18:37:17.929Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 由 c94ea382「Norm 与 WorkCase 承载层补建」按 20 §9.4 情形二拆出：WorkCase 侧卡在 attempt 跨规范接缝，与 Norm 的实现量问题性质不同
  - at: 2026-10-08T20:31:45.612Z
    provider: glm
    model: glm-5.3
    summary: 批次 F+ 旧号位引文更正：活引文随现行规范——21 §10.4 承接者「08/09」→「10/06」（摘要/当前理解核心约束/待决问题 1 各处）、「02 §18 待定义声明」→「04 §10.1」（协同与四层判断现行位）、边界说明「00 §7」→「00 §5.7」（必停情形现行位）；grep 命令原文与逐项现状表为 2026-09-13 时点证据照录不改，末尾追加号位注记并附复核提示（writer/受控入口已落地、specs/10 已含 attempt 内容）
  - at: 2026-11-01T23:42:36.126Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 补入 2026-11-02 只读重核节：四项 ❌ 现已全部转 ✅——workcase-writer.js 全通道、workcase-tools/goals/route-ledger 三模块、Git Gate 覆盖 workcases/；ldvh-base/workcases 下 38 份载体全部 closed，直接证明出生→Gate1→执行→Gate2 闭环远超一轮。attempt 接缝仍不完整：specs/10 仅 3 处归属声明、specs/06 attempt 零命中、specs/21 §15.2 承重声明行仍在，而实现侧 attempt 出现 109 处含 heartbeat/takeover/reallocate。5 问中 4 问已由实现回答，仅 attempt 归属待 Human 择路。同时在「当前状态：完全未答」处补注该表述为 2026-09-13 时点
---

# WorkCase 承载层与 attempt 接缝

## 当前理解

21 号规范已定稿；`FACT_DIRECTORIES`（`plugin/lib/governed-projects.js:17`）已含 `workcases`；Web 侧已接入（`factFieldContract.ts`、`localFactReader.ts` 与 WorkCase 相关组件）。真实缺口为整套承载层：无 `plugin/lib/workcase-writer.js`、无 `ldvh_workcase_*` 受控入口、Git Gate 未覆盖 `workcases/` 断言；目录 `ldvh-base/workcases/` 于 2026-09-13 由 Human 裁定补建（此前并不存在）。**核心约束是跨规范接缝**：21 §9.1 规定 `open` 状态必填 `attempt`，而 §10.4 第 4 项声明 attempt 宿主实现应由 10/06 承接且未落地前「依赖 attempt 的部分不成立」、§15.2 记其替代保障为「无」；`review-21-workcase.md`（原 docs 目录，已随 `ec19ba6` 清除、可自该提交回取） 已核实（2026-09-13 时点）当时 08/09 对该词零命中。故当前形态下 WorkCase 能出生但走不出 draft。

逐项现状（已机械核实）：

| 维度 | 现状 |
|---|---|
| 规范 | ✅ 已定稿（21 号） |
| `FACT_DIRECTORIES` | ✅ 已含 `workcases`（`governed-projects.js:17`） |
| Web 侧支持 | ✅ 已接入（`factFieldContract.ts`、`localFactReader.ts`、WorkCase 相关组件） |
| 目录 `ldvh-base/workcases/` | ✅ 2026-09-13 由 Human 裁定补建（此前不存在） |
| writer | ❌ 无 `workcase-writer.js` |
| tools 受控入口 | ❌ 无 `ldvh_workcase_*` |
| Git Gate 断言 | ❌ 未覆盖 `workcases/` |
| attempt 宿主实现 | ❌ 08/09 无对应内容（21 §10.4 第 4 项声明应由其承接） |

**核心约束是一个跨规范接缝，而非实现量**：21 §9.1 的状态成立条件表规定，`open` 状态**必须**携带 `attempt`（「`gate_1` 必填…；`attempt` 必填」）；而 21 §10.4 第 4 项声明 attempt 的宿主实现、锁语义与接入应由 10/06 承接，并明确「该承接落地之前，attempt 字段契约没有可执行的宿主机械保障，且 V6 工作接续与 HV2 授权执行受控可续中依赖 attempt 的部分不成立——不得表述为已由其承接」。§15.2 的前提表进一步把该行「替代保障」记为「**无**」。

`review-21-workcase.md`（原 docs 目录，已随 `ec19ba6` 清除、可自该提交回取） 的独立对抗审核已核实这一接缝：`grep -rn 'attempt' specs/08-*.md specs/09-*.md` **零命中**（命令与时点证据照录），04 §10.1 只是「待定义」声明而非实装。故当前形态下 WorkCase 可被创建、可被读取，但**一旦要过 Gate 1 进入 `open`，机械校验即因 `attempt` 缺失而拒绝**——即「出生得了、走不出去」，这使 SG-2 所需的一轮完整闭环无法达成。

**本对象由 `c94ea382` 按 20 §9.4 情形二拆出**。原对象把 Norm 与 WorkCase 两支合并为「承载层补建」。拆开的理由是两者的剩余风险性质不同：Norm 侧规范自洽、无外部依赖（纯实现工作量）；WorkCase 侧卡在上述跨规范接缝，须先定案 attempt 的归属，才谈得上实现承载层。合并承载会把「规范间待定案」误呈现为「实现待补」。

**号位注记（2026-10-14，批次 F+ 事实更正）**：上文活引文已随现行规范更正——21 §10.4 现行文本为「attempt 的宿主实现与锁语义指定由 10/06 承接（其承接实现与不变量见 §15.2 的前提限定）」（02–10 重构随批次 E 迁移），原记「08/09」；「02 §18 只是『待定义』声明」原记「02 §18」（协同与四层判断，现行 04 §10.1）。照录不改的时点证据：grep 命令原文（对当时 08/09 号文件的检索）与「逐项现状」表快照（2026-09-13 机械核实时点）。复核提示（不改动上表快照）：截至本注记时点，`workcase-writer.js` 与 `ldvh_workcase_*` 受控入口已经落地并经实测使用（attempt 字段已可机械盖章），现行 specs/10 已含 attempt 相关内容、06 仍未含——本对象的接缝论述为创建时点状态，其后续闭环情况须以复核时点证据为准。

### 2026-11-02 重核（只读）：承载层已全部建成，一轮闭环已跑通 38 次

> 本节给出**当前**证据；上文（含「逐项现状」表）是 2026-09-13 时点记录，未改写。

**上文表中四项 ❌ 现已全部 ✅**：

| 维度 | 上文（2026-09-13） | 现行（2026-11-02） |
|---|---|---|
| writer | ❌ 无 `workcase-writer.js` | ✅ `plugin/lib/workcase-writer.js`，含 create／approve／execute／close／rebatch／cancel／revise／correct／record_review／record_audit 全通道 |
| tools 受控入口 | ❌ 无 `ldvh_workcase_*` | ✅ `plugin/lib/workcase-tools.js`；另有 `workcase-goals.js`、`workcase-route-ledger.js` |
| Git Gate 断言 | ❌ 未覆盖 `workcases/` | ✅ `plugin/lib/commit-validation.js` 的 `GATE_RULES` 含 WorkCase 与 friction commit 系列校验，`ldvh-base/workcases/` 受 Gate 覆盖 |
| attempt 宿主实现 | ❌ 08/09 无对应内容 | ⚠️ **部分**——见下 |

**闭环已跑通，且不是一次**：`ldvh-base/workcases/` 下现有 **38 份载体，全部 `status: closed`**。即上文所记「出生得了、走不出去」的形态已被推翻——38 份都走完了出生→Gate 1→执行→Gate 2。这是本条 `scope_boundary` 第一半（「WorkCase 可完成出生→Gate 1→执行→Gate 2 一轮」）的**直接证据**，且远超一轮。

**attempt 接缝的当前状态（这一半仍不完整）**：`specs/10-DSH 环境接入与插件发布规范.md` 现有 **3 处** attempt 相关条文（第 56、65、135 行），均为「attempt 语义由 21 定义」的**归属声明**，不是宿主实现；`specs/06-Code 实践与测试规范.md` 全文 **`attempt` 零命中**。即 21 §10.4 指定的「10/06 承接」**只兑现了 10 的归属声明，06 侧未落任何条文**。同时 `specs/21` §15.2 的前提表**仍保留**「attempt 的宿主实现」这一承重声明行（`grep` 命中 3 处「attempt 的宿主实现」），即规范自己仍声明该能力未获保障。

**实现侧却是有的**：`plugin/lib/workcase-writer.js` 内 `attempt` 出现 109 处，含 `heartbeat`／`takeover`／`reallocate` 三种 `attempt_operation`、`attempt.session_id` 的 Code 托管盖戳、以及「按索引继承、不补齐」的防绕回逻辑（见 `spark-a687da1f` 重核）。故实际形态是：**实现有 fencing 与心跳，规范未登记其保障，21 §15.2 的声明限制行因此既未删也无法删**。

**故本条的完成度是 1.5/2**：第一半已由 38 份关闭对象证明；第二半「attempt 的宿主实现归属已定案」**形式上已定案**（21 §10.4 指定 10/06），但**实质未兑现**（06 零条文、10 只有归属声明、§15.2 承重声明行仍在）。要收束这一半，须在「补 06 条文并删 §15.2 声明行」与「修订 21 降级 attempt」之间由 Human 择一——这正是下文所列第 1 项待决问题，**至今仍未被答**。

**下文所列 5 个待决问题的现状**：① attempt 归属——**仍待 Human 择路**（见上）；② 「只到 draft 的切片」——**已不需答**，全通道已建成，切片方案失去意义；③ `authorization_fingerprint` 口径——**已答**，`plugin/lib/workcase-writer.js` 已实现 `plan`+`scope` 分区指纹（`gate_1.authorization_fingerprint` 与 `pre_reviews[].candidate_fingerprint` 同源函数），并配 `covered_partitions` 分区增量审核；④ `criteria_checks` 与 `plan[].done_criteria` 逐条对应——**已答**，close 路径机械校验长度与顺序一致；⑤ 受控创建查重留痕——**已答**，create 必带 `dedup_result`，未经查重不得提请。故 5 问中 4 问已由实现回答，仅第 1 问待 Human。

## 调查问题

WorkCase 事实类型的承载层应如何建成，attempt 令牌缺宿主实现这一接缝如何闭合？

**当前状态：完全未答**（2026-09-13 时点；现行状态见上文「2026-11-02 重核」——5 问中 4 问已由实现回答，仅第 1 问仍待 Human）。待决的具体问题：

1. attempt 的归属定案——是补 10/06 的定义（规范侧工作，属规范修订），还是修订 21 §9.1 把 `attempt` 从 `open` 的必要条件降为可选？两条路都要走 Human Gate，且方向不同。
2. 若一时无法定案，承载层是否先做一个**只到 `draft` 的切片**（可创建、可读取、可列枚举，Gate 1 起不可用）？此切片的价值与风险须评估——它会产出一个「形态正确但走不完一轮」的类型。
3. Gate 1 的 `authorization_fingerprint` 如何计算——21 §10.1 要求绑定当次 `plan` + `scope` 的内容指纹，但具体序列化与哈希口径需定案，且必须与 C2 局部重批的失效判定自洽。
4. `criteria_checks` 与 `plan[].done_criteria` 的逐条对应（长度一致、顺序一致）如何机械校验，以及 `outcome` 与 `criteria_checks` 的一致性约束如何落为校验。
5. 受控创建阶段的查重（21 §8：范围重叠的 draft/open WorkCase 的 title+summary+scope 语义比对）如何留痕——与 Norm 的同名问题同构。

## 调查边界

WorkCase 可完成出生→Gate 1→执行→Gate 2 一轮，且 attempt 的宿主实现归属已定案时停止。不含 Norm 承载层（另有独立对象承载）；不含 21 号自身的规范修订——若定案路径选择修订 21（如降级 attempt），该修订本身另走 Human Gate，不在本对象的执行范围内。

边界说明：本停止条件的第一半依赖「attempt 归属已定案」这一**规范层前提**，而非实现工作。若该前提未决，本对象应停在暂停条件上，不得以「先实现 draft 切片」冒充推进——按 00 §5.7，绕开未决前提实现会造出「看似可用、实则走不通」的假象。另需注意 `review-21-workcase.md`（原 docs 目录，已随 `ec19ba6` 清除、可自该提交回取） 已将本接缝记为「悬空委派」（其缺陷 D1），该判断在本对象中作为设计输入引用，不取得规范效力。
