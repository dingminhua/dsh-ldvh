---
title: WorkCase 承载层与 attempt 接缝
status: implemented
question: WorkCase 事实类型的承载层应如何建成，attempt 令牌缺宿主实现这一接缝如何闭合？
scope_boundary: WorkCase 可完成出生→Gate 1→执行→Gate 2 一轮，且 attempt 的宿主实现归属已定案时停止。不含 Norm 承载层（另有独立对象承载）；不含 21 号自身的规范修订——若定案路径选择修订 21（如降级 attempt），该修订本身另走 Human Gate，不在本对象的执行范围内。
intent: 保留理由——21 号规范已定稿且字段契约完整，但 WorkCase 承载层零实现，且 `attempt` 被 §10.4 推给 10/06 而创建时点实测该两份规范对该词零命中；§9.1 又把 `attempt` 定为 `open` 状态的必要条件，故 WorkCase 能创建却永远走不出 draft，SG-2 因之推不动。与 Norm 拆开的理由——这条的真实卡点在**规范间接缝**而非实现量，合并承载会把「待定案」误呈现为「待补写」。后续方向——先定案 attempt 归属（补 10/06 定义，或改 21 §9.1 降级该字段，二者均需 Human Gate），再实现承载层，最后以真实一轮验证。
summary: 2026-11-05 收口：21 §15.2 attempt 承重声明行已删（独立复核 pass、无残留）；身份不可用改为 Gate 1／takeover／reallocate 拒绝分配（fail-closed），10 §5.9／06 §6 同步。第一半 51 份 closed 已证，第二半已闭合。本条实质完成。
serves: befe1735-1187-4d60-ba53-e55eb0cb7de2
disposition: 两半均已闭合：writer 全通道建成、ldvh-base/workcases 下载体全部 closed，出生→Gate 1→执行→Gate 2 闭环成立；10 §5.9／06 §6 承接条文经独立复核 pass，21 §15.2 承重声明行已删、身份不可用定案为拒绝分配。无 scope 内残留。
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
  - at: 2026-11-04T17:17:08.421Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 2026-11-05 重核与收口（部分）：补入 10 §5.9／06 §6 承接条文与 4 条 reallocate 用例（隔离子代理三轮复核终审 pass），并如实登记 21 §15.2 承重声明行未删与身份偏离待 Human；summary 改写为当前快照，历史节未改写
  - at: 2026-11-04T19:54:45.071Z
    provider: workbuddy
    model: hy4free
    summary: 2026-11-05 续：补记 21 §15.2 attempt 承重声明行已删（新派隔离子代理对删除后状态复核 pass）、身份不可用定案为拒绝分配；同步 summary 与「当前状态」，历史节未改写；status 保持 open，结案属 Human 决定
  - at: 2026-11-04T21:06:18.877Z
    provider: workbuddy-global
    model: hy4free
    summary: 停止条件达成转 implemented：两半均已闭合——writer 全通道建成、workcases 下载体全部 closed（一轮闭环成立）；10 §5.9／06 §6 承接条文经独立复核 pass，21 §15.2 承重声明行已删、身份不可用定案为拒绝分配；无 scope 内残留。原 disposition 所称「撤行与身份偏离另案」已过时，据实改写。
  - at: 2026-11-10T11:09:31.167Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补 recall_digest：为召回提供高密度关键词面（02 §7.1）
recall_digest: 承载层 attempt 接缝 承重声明已删 独立复核 身份不可用 fail-closed 拒绝分配 Gate1 takeover reallocate 收口
---

# WorkCase 承载层与 attempt 接缝

## 当前理解

2026-11-05 收口：21 §15.2 attempt 承重声明行已删（独立复核 pass、无残留）；身份不可用改为 Gate 1／takeover／reallocate 拒绝分配（fail-closed），10 §5.9／06 §6 同步。第一半 51 份 closed 已证，第二半已闭合。本条实质完成。

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

### 2026-11-05 重核与收口（部分）：10/06 承接条文已补，独立复核 pass

> 本节给出**当前**证据；上文各节是各自时点记录，未改写。

**第二半已实质兑现**：2026-11-05 对 `specs/10` 与 `specs/06` 的修订已落地，并经隔离子代理三轮独立复核（终审 pass）——

| 位置 | 内容 |
|---|---|
| `specs/10` §5.9 | attempt 宿主接入与并发语义：接入点表（Gate 1／心跳／`record_review` 与 `request_adjustment` 不触碰／`takeover`／`reallocate`／关闭收口／C2 作废）、身份不可用处置、无锁并发语义（明写先读后写窗口，不表述为互斥／锁／丢更新防护）、孤立判定归属、条件式要求 |
| `specs/06` §6 | attempt 令牌的实现与测试纪律（6 项 + 条件式限定 + 并发边界）；§1 负担／风险；§7「attempt 接入与实现纪律」验证行 |
| `plugin/test/workcase-writer.test.mjs` | 4 条 `reallocate` 直接用例（换号、无身份、连续单调、自查不因换号变成独立复核） |

**复核过程**：首轮 10 条发现（A–J，其中「把复核结论说成心跳」「把指纹 CAS 说成并发保护」「`session_id` 缺席与 21 §8 冲突」三处为高），次轮 4 项残留，终轮 1 项阻塞（Human 决定点缺可回指入口），按建议改为「按 00 §4.2／01 §9.2 由 Human 决定」后 pass。验证：4 条用例绿、全量 3050 项 0 失败、spec 72 项绿；逐条检测力由五组定向变异（M1／M2／M4／M5／M6）取证，均已从 pristine 副本还原。

**仍未闭合的两项**：

1. **21 §15.2 承重声明行仍在**。按 01 §7 末段，删行须先有独立复核就「声明所指范围已按判据在全载体上穷尽核对且无残留」给出结论；且改 21 超出本 Spark 的 scope，须另立工单。
2. **身份不可用时的省略形态与 21 §8 的执行期必填要求并存**。10 §5.9 已把该偏离的处置交 Human（按 00 §4.2／01 §9.2 决定：改为拒绝分配，或修订 21 §8 承认该形态）；06 第 6 项在该决定前按省略路径取证，并把「交还披露」列为非机械义务（writer 当前未披露，登记为未覆盖）。

**故本条的实质内容已闭合**：第一半由 51 份 closed 载体证明；第二半由 10/06 承接条文兑现（独立复核 pass）。剩余是撤除程序与一项 Human 决定，均不在本对象执行范围内。

### 2026-11-05 续：承重声明行已删，两项残留均已闭合

> 本节给出**当前**证据；上文各节是各自时点记录，未改写。

**上一节登记的「仍未闭合的两项」现已全部闭合**（Human 2026-11-05 决定「直接修改」）：

1. **21 §15.2 承重声明行已删**。按 01 §7 末段先取得独立复核结论：新派隔离子代理对**删除后的当前工作树**重判，结论 **pass**——声明所指范围（attempt 宿主实现、锁语义、接入）在 `specs/` 与实现侧均无残留，writer 在零写入前拒绝，心跳／存量路径与 21 §8 自洽。删除的同时同步了 21 §3.2 第 3 项、§3.3、§10.4 第 4 项、32 §3.2 第 2 项的悬空引用，并把「孤立 attempt 判定」显式剥离为「按 10 §5.9 属语义判断、不属宿主机械实现范围」。
2. **身份不可用偏离已定案为「拒绝分配」**。Gate 1 批准、`takeover`、`reallocate` 在 `identity === null` 时于任何写入之前返回 `workcase/attempt_identity_unavailable`（零写入）；`heartbeat` 不分配新号、只刷新 `heartbeat_at`、不补齐基线，存量缺 `session_id` 由关闭侧 fail-closed 承接。10 §5.9、06 §6 第 6 项与 §7 验证行同步为 fail-closed 口径，不再是「未兑现范围／待 Human 决定」。

**补充验证**：新增三条无身份直接用例（approve／takeover／reallocate 均断言「拒绝 + 零写入」）；对新增的两道 `identity === null` 守卫各做一次定向变异，删守卫即使用例转红，已从 pristine 副本还原。全量 3056 项 0 失败，eslint 与 `git diff --check` 通过。

**复核登记的非阻塞项已处置／如实登记**：① 21:349「至多一个活跃」的保证归属已改述为「由单字段结构保证（10 §5.9）」；② 06:334 ③ 的 takeover 无身份专条已补；③ 事实对象 `friction-a4713afc` 仍 open 且现象号位（08/09）过时——属另一条摩擦账的销账判断，不在本对象范围，交还中如实登记；④ 「零写入」限于对象／attempt 层面（execute 前 `syncGoalForWrite` 会写宿主 goal 状态），按复核意见限定口径；⑤ `spark-27a9dbfc` 本条 summary 与本节同步更新。

**故本条两半均已闭合**：第一半由 51 份 `closed` 载体证明一轮闭环；第二半由 10/06 承接条文 + 独立复核 pass + 承重声明行删除证明。`status` 保持 `open`——是否结案（`implemented`）属 20 号状态流转的 Human 决定，本对象不自行改状态。

## 调查问题

WorkCase 事实类型的承载层应如何建成，attempt 令牌缺宿主实现这一接缝如何闭合？

**当前状态：已答**（2026-11-05 续；上文「2026-09-13 时点」「2026-11-02 重核」「2026-11-05 重核与收口（部分）」均为各自时点的历史记录）。5 问全部已答：第 1 问按「补 10/06 承接条文」路径落地、经三轮独立复核 pass，21 §15.2 承重声明行亦已由新一次独立复核（针对删除后状态，pass）后删除，身份不可用偏离定案为拒绝分配。

1. ~~attempt 的归属定案~~——**已答（2026-11-05）**：选择「补 10/06 承接条文」，10 §5.9 与 06 §6 已落地；未选择修订 21 §9.1。
2. ~~若一时无法定案，承载层是否先做一个只到 `draft` 的切片~~——**已不需答**：全通道早已建成，切片方案失去意义。
3. ~~Gate 1 的 `authorization_fingerprint` 如何计算~~——**已答**：writer 已实现 `plan`+`scope` 分区指纹。
4. ~~`criteria_checks` 与 `plan[].done_criteria` 的逐条对应~~——**已答**：close 路径机械校验长度与顺序一致。
5. ~~受控创建阶段的查重如何留痕~~——**已答**：create 必带 `dedup_result`。

## 调查边界

WorkCase 可完成出生→Gate 1→执行→Gate 2 一轮，且 attempt 的宿主实现归属已定案时停止。不含 Norm 承载层（另有独立对象承载）；不含 21 号自身的规范修订——若定案路径选择修订 21（如降级 attempt），该修订本身另走 Human Gate，不在本对象的执行范围内。

边界说明：本停止条件的第一半依赖「attempt 归属已定案」这一**规范层前提**，而非实现工作。若该前提未决，本对象应停在暂停条件上，不得以「先实现 draft 切片」冒充推进——按 00 §5.7，绕开未决前提实现会造出「看似可用、实则走不通」的假象。另需注意 `review-21-workcase.md`（原 docs 目录，已随 `ec19ba6` 清除、可自该提交回取） 已将本接缝记为「悬空委派」（其缺陷 D1），该判断在本对象中作为设计输入引用，不取得规范效力。
