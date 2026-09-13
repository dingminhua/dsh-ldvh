---
title: WorkCase 承载层与 attempt 接缝
status: open
question: WorkCase 事实类型的承载层应如何建成，attempt 令牌缺宿主实现这一接缝如何闭合？
scope_boundary: WorkCase 可完成出生→Gate 1→执行→Gate 2 一轮，且 attempt 的宿主实现归属已定案时停止。不含 Norm 承载层（另有独立对象承载）；不含 21 号自身的规范修订——若定案路径选择修订 21（如降级 attempt），该修订本身另走 Human Gate，不在本对象的执行范围内。
intent: 保留理由——21 号规范已定稿且字段契约完整，但 WorkCase 承载层零实现，且 `attempt` 被 §10.4 推给 08/09 而实测 08/09 零命中；§9.1 又把 `attempt` 定为 `open` 状态的必要条件，故 WorkCase 能创建却永远走不出 draft，SG-2 因之推不动。与 Norm 拆开的理由——这条的真实卡点在**规范间接缝**而非实现量，合并承载会把「待定案」误呈现为「待补写」。后续方向——先定案 attempt 归属（补 08/09 定义，或改 21 §9.1 降级该字段，二者均需 Human Gate），再实现承载层，最后以真实一轮验证。
summary: 21 号规范已定稿；`FACT_DIRECTORIES`（`plugin/lib/governed-projects.js:17`）已含 `workcases`；Web 侧已接入（`factFieldContract.ts`、`localFactReader.ts` 与 WorkCase 相关组件）。真实缺口为整套承载层：无 `plugin/lib/workcase-writer.js`、无 `ldvh_workcase_*` 受控入口、Git Gate 未覆盖 `workcases/` 断言；目录 `ldvh-base/workcases/` 于 2026-09-13 由 Human 裁定补建（此前并不存在）。**核心约束是跨规范接缝**：21 §9.1 规定 `open` 状态必填 `attempt`，而 §10.4 第 4 项声明 attempt 宿主实现应由 08/09 承接且未落地前「依赖 attempt 的部分不成立」、§15.2 记其替代保障为「无」；`docs/review-21-workcase.md` 已核实 08/09 对该词零命中。故当前形态下 WorkCase 能出生但走不出 draft。
serves: SG-1
priority: P1
object_uid: 27a9dbfc-35ca-485e-83f8-182fd8f0f1c9
fact_type_key: spark
created_at: 2026-09-13T18:37:17.929Z
change_log:
  - at: 2026-09-13T18:37:17.929Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 由 c94ea382「Norm 与 WorkCase 承载层补建」按 20 §9.4 情形二拆出：WorkCase 侧卡在 attempt 跨规范接缝，与 Norm 的实现量问题性质不同
---

# WorkCase 承载层与 attempt 接缝

## 当前理解

21 号规范已定稿；`FACT_DIRECTORIES`（`plugin/lib/governed-projects.js:17`）已含 `workcases`；Web 侧已接入（`factFieldContract.ts`、`localFactReader.ts` 与 WorkCase 相关组件）。真实缺口为整套承载层：无 `plugin/lib/workcase-writer.js`、无 `ldvh_workcase_*` 受控入口、Git Gate 未覆盖 `workcases/` 断言；目录 `ldvh-base/workcases/` 于 2026-09-13 由 Human 裁定补建（此前并不存在）。**核心约束是跨规范接缝**：21 §9.1 规定 `open` 状态必填 `attempt`，而 §10.4 第 4 项声明 attempt 宿主实现应由 08/09 承接且未落地前「依赖 attempt 的部分不成立」、§15.2 记其替代保障为「无」；`docs/review-21-workcase.md` 已核实 08/09 对该词零命中。故当前形态下 WorkCase 能出生但走不出 draft。

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

**核心约束是一个跨规范接缝，而非实现量**：21 §9.1 的状态成立条件表规定，`open` 状态**必须**携带 `attempt`（「`gate_1` 必填…；`attempt` 必填」）；而 21 §10.4 第 4 项声明 attempt 的宿主实现、锁语义与接入应由 08/09 承接，并明确「该承接落地之前，attempt 字段契约没有可执行的宿主机械保障，且 V6 工作接续与 HV2 授权执行受控可续中依赖 attempt 的部分不成立——不得表述为已由 08/09 承接」。§15.2 的前提表进一步把该行「替代保障」记为「**无**」。

`docs/review-21-workcase.md` 的独立对抗审核已核实这一接缝：`grep -rn 'attempt' specs/08-*.md specs/09-*.md` **零命中**，02 §18 只是「待定义」声明而非实装。故当前形态下 WorkCase 可被创建、可被读取，但**一旦要过 Gate 1 进入 `open`，机械校验即因 `attempt` 缺失而拒绝**——即「出生得了、走不出去」，这使 SG-2 所需的一轮完整闭环无法达成。

**本对象由 `c94ea382` 按 20 §9.4 情形二拆出**。原对象把 Norm 与 WorkCase 两支合并为「承载层补建」。拆开的理由是两者的剩余风险性质不同：Norm 侧规范自洽、无外部依赖（纯实现工作量）；WorkCase 侧卡在上述跨规范接缝，须先定案 attempt 的归属，才谈得上实现承载层。合并承载会把「规范间待定案」误呈现为「实现待补」。

## 调查问题

WorkCase 事实类型的承载层应如何建成，attempt 令牌缺宿主实现这一接缝如何闭合？

**当前状态：完全未答**。待决的具体问题：

1. attempt 的归属定案——是补 08/09 的定义（规范侧工作，属规范修订），还是修订 21 §9.1 把 `attempt` 从 `open` 的必要条件降为可选？两条路都要走 Human Gate，且方向不同。
2. 若一时无法定案，承载层是否先做一个**只到 `draft` 的切片**（可创建、可读取、可列枚举，Gate 1 起不可用）？此切片的价值与风险须评估——它会产出一个「形态正确但走不完一轮」的类型。
3. Gate 1 的 `authorization_fingerprint` 如何计算——21 §10.1 要求绑定当次 `plan` + `scope` 的内容指纹，但具体序列化与哈希口径需定案，且必须与 C2 局部重批的失效判定自洽。
4. `criteria_checks` 与 `plan[].done_criteria` 的逐条对应（长度一致、顺序一致）如何机械校验，以及 `outcome` 与 `criteria_checks` 的一致性约束如何落为校验。
5. 受控创建阶段的查重（21 §8：范围重叠的 draft/open WorkCase 的 title+summary+scope 语义比对）如何留痕——与 Norm 的同名问题同构。

## 调查边界

WorkCase 可完成出生→Gate 1→执行→Gate 2 一轮，且 attempt 的宿主实现归属已定案时停止。不含 Norm 承载层（另有独立对象承载）；不含 21 号自身的规范修订——若定案路径选择修订 21（如降级 attempt），该修订本身另走 Human Gate，不在本对象的执行范围内。

边界说明：本停止条件的第一半依赖「attempt 归属已定案」这一**规范层前提**，而非实现工作。若该前提未决，本对象应停在暂停条件上，不得以「先实现 draft 切片」冒充推进——按 00 §7，绕开未决前提实现会造出「看似可用、实则走不通」的假象。另需注意 `docs/review-21-workcase.md` 已将本接缝记为「悬空委派」（其缺陷 D1），该判断在本对象中作为设计输入引用，不取得规范效力。
