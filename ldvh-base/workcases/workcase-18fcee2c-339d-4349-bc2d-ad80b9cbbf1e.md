---
fact_type_key: workcase
object_uid: 18fcee2c-339d-4349-bc2d-ad80b9cbbf1e
title: spark 非终态卡关联呈现
status: closed
serves: SG-3
summary: 让 spark 卡片的非最终状态（open）也呈现关联信息，学习最终态卡的做法。现状核实（2026-09-16）：卡片框架
  ObjectCardFrame 内无条件渲染 FactAssociationsCardContent（消费 obj.factAssociations），而
  SparkCardContent 对 open 状态返回 null；实际缺口定位（relations 关联、refs
  引用或非终态被状态分支屏蔽）是本单第一步。
scope: 做什么：核实并定位非终态 spark 卡关联呈现的实际缺口（数据层 factAssociations/factRefs
  是否为空、渲染层是否被状态分支屏蔽），按最终态卡的做法对齐非终态呈现；同步契约测试；重建 Web 产物
  dist；受控提交。明确不做什么：不改后端关联投影语义（03 §7.2 relations/refs
  分工纪律不动）；不改其它类型卡片的关联呈现；不改详情页关联阅读节点；不为 spark 单独发明新的关联呈现形态（复用现有组件路径）。
plan:
  - done_criteria: 明确 open spark 卡当前实际渲染树与数据（factAssociations/factRefs
      是否为空、被何条件屏蔽），并记录用户所见状的具体项
    step: 现象核实与缺口定位
  - done_criteria: open spark 卡呈现关联信息，与终态卡走同一组件路径（不新增平行实现）
    step: 按最终态做法对齐非终态呈现
  - done_criteria: 测试断言 open 状态 spark 卡包含关联呈现
    step: 契约测试更新
  - done_criteria: tsc 0 错误、web 测试全绿、eslint 无新增、dist 重建且 index.html 引用新 hash、Git Gate passed
    step: 验证三件套、dist 重建与受控提交
gate_1:
  approved_at: 2026-09-16T23:29:51.839Z
  approver: Human（本会话直接指令：dsh-ldvh@workcase-18fcee2c… 批准执行；并就扩围问题选择「按定位结果扩围」）
  authorization_fingerprint: 0f0cfd780aa20a6211907e05d45f07c409c5d6475eeaec923e726884ac0b729e
  scope_snapshot: 做什么：核实并定位非终态 spark 卡关联呈现的实际缺口（数据层 factAssociations/factRefs
    是否为空、渲染层是否被状态分支屏蔽），按最终态卡的做法对齐非终态呈现；同步契约测试；重建 Web 产物
    dist；受控提交。明确不做什么：不改后端关联投影语义（03 §7.2 relations/refs
    分工纪律不动）；不改其它类型卡片的关联呈现；不改详情页关联阅读节点；不为 spark 单独发明新的关联呈现形态（复用现有组件路径）。
result:
  achieved_scope: 列表路径补投影 factRefs + 卡片呈现 refs（与 relations 同组件路径并列）+ 契约测试同步 + dist
    重建 + 受控提交（7e0f377、c1d0e26）。open spark 卡关联呈现缺口已消除，列表与详情两层阅读器契约一致（同一对象 refs
    投影深度相等）。
  criteria_checks:
    - evidence: 实测 listObjects('spark') 全 44 项 factRefs 恒为 ABSENT（factAssociations
        仅部分终态出现）；代码核对 projectFactRefs 仅由 showObject 调用（facts.ts:563），列表调用点
        facts.ts:281-298 只投影 relations；用户所见状 spark-42086862 列表 0 条 vs 详情 3
        条。原假设（SparkCardContent 状态分支）被推翻：ObjectCardFrame 无条件渲染关联段。
      satisfied: true
    - evidence: FactAssociationsCardContent({ associations, refs }) 单一组件承载两组，经
        ObjectCardFrame 对全部状态开放；实测渲染 open spark 卡产出关联段含 3 条 ref 行（含 title
        与不可读占位）；列表投影与详情投影对该对象均返回 3 条 refs 且 JSON 深度相等。
      satisfied: true
    - evidence: spark-refs-projection.test.ts 新增列表/详情两层 factRefs
        一致性回归测试；spark-reading-contract.test.ts 以新断言取代已失效的「卡片不承载 refs」禁止断言。web 测试
        250/250 通过。
      satisfied: true
    - evidence: tsc exit 0；web 测试 250/250；eslint 无新增（facts.ts 残留 1 项为既有未用参数，仅行号位移，已与
        HEAD 版本比对）；dist 重建且 index.html 引用新 hash（index-BBWdRIOT.js →
        index-CbXCDlKi.js）；两次提交 Git Gate passed（snapshot_identity fccc69bd… /
        7ec131fa…）。
      satisfied: true
  residual:
    - specs/10 §5.2 正文尚未同步修订——Human 已裁定解除「卡片网格不承载关联对象」，但规范条文修订属另行议程，本单授权明示不改
      specs/。
    - refs 在列表卡复用生命周期状态图标（getFactAssociationState），语义上 refs
      为普通内容关联而非生命周期关系，可议但非本单引入。
    - FactCardAssociation 类型对 refs 条目的建模松弛（声明 target? 而 refs 实为
      objectUid）系既有问题，未处置。
    - 列表卡 ref 行数多时的视觉高度与浏览器终态未做目视确认，仅由渲染实测与构建产物保证。
    - gate_1.scope_snapshot 未随 Human 扩围回写（snapshot 由 Code 机械加盖）；扩围事实以 change_log
      与 approve 摘要承载，构成授权记录的内部张力。
outcome: completed
created_at: 2026-09-16T01:57:59.428Z
reviews:
  - at: 2026-09-16T23:41:12.000Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 对象=WorkCase 18fcee2c 执行结果（提交 7e0f377，基线 ef7c3e7）。方法=冷读独立复核：diff
      精读、facts.ts 投影链与 ObjectList.tsx 呈现链走查、契约测试复跑、四项工程声明独立复算、/tmp
      构造同目标双组用例实证。覆盖=越权判定、03 §7.2 分工纪律保持性、声明与事实一致性（tsc/250
      测试/eslint/dist/42086862 三层一致）。未覆盖=浏览器目视终态与交互、eslint 全仓基线逐条比对、dist
      相对基线（未入库）、Human 扩围批准真实性的代码侧核验。发现=结论「有条件通过」，无越权、无功能缺陷、声明全部成立；发现 1（重要）去重键不区分来源，「不合并去重」的安全来自 refs
      恰好无 target 字段的偶然事实，一旦补上将静默丢弃 refs——已在本单内处置（c1d0e26）；发现 2/5
      既有类型建模松弛与 refs 复用生命周期图标，非本单引入，登记为观察。保证边界=证明 diff 落在授权范围内、分工纪律与
      available:false 保真未被破坏、泛型化未引入条目丢失、四项声明成立；不证明浏览器终态符合 Human
      预期、未覆盖项所述范围及该实现对未来形状变化的安全性。
change_log:
  - at: 2026-09-16T01:57:59.428Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 受控创建——spark 非终态卡关联呈现（学习终态做法）。查重：workcases 全量 2 对象，范围不重叠；与
      WC-0002（workcase 三态呈现）同属 Web 呈现面但对象不同
  - at: 2026-09-16T23:29:51.839Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: Gate 1 批准：核实推翻原假设（缺口在列表投影层而非 SparkCardContent 状态分支），依 Human
      扩围选择批准「列表投影补 factRefs + 卡片呈现 refs」 [gate_1 approved by
      Human（本会话直接指令：dsh-ldvh@workcase-18fcee2c… 批准执行；并就扩围问题选择「按定位结果扩围」）; attempt
      1 allocated to dsh-ldvh 主控 AI（deepseek-v4.1-flash）]
  - at: 2026-09-16T23:48:58.848Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: Gate 2 关闭：open spark 卡关联呈现缺口已消除（根因在列表投影层，非状态分支）；两次受控提交经 Git Gate
      放行；独立复核有条件通过，其发现 1 已在本单内处置 [gate_2 closed with outcome=completed; attempt
      1 retracted]
  - at: 2026-09-16T23:55:31.000Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 事实更正（非状态转换）——补录 reviews 复核流水。原关闭早于流水录入：21 §14 规定 reviews
      属执行期受控更新、要求对象为 open，本次在 Gate 2 关闭后才尝试写入故被机械拒绝，构成记录缺陷；复核本身已于
      2026-09-16 实际执行（结论「有条件通过」，其发现 1 已在本单内处置并提交 c1d0e26），非伪造。依 21 §9.2「若原终态记录本身错误，按事实更正规则修正，不把更正伪装成领域状态转换」与 03 §9.5，经
      Human 裁定在本对象补录 reviews，不重开、不新建对象。
---

# spark 非终态卡关联呈现

## 摘要

让 spark 卡片的非最终状态（open）也呈现关联信息，学习最终态卡的做法。现状核实（2026-09-16）：卡片框架 ObjectCardFrame 内无条件渲染 FactAssociationsCardContent（消费 obj.factAssociations），而 SparkCardContent 对 open 状态返回 null；实际缺口定位（relations 关联、refs 引用或非终态被状态分支屏蔽）是本单第一步。

## 授权范围

做什么：核实并定位非终态 spark 卡关联呈现的实际缺口（数据层 factAssociations/factRefs 是否为空、渲染层是否被状态分支屏蔽），按最终态卡的做法对齐非终态呈现；同步契约测试；重建 Web 产物 dist；受控提交。明确不做什么：不改后端关联投影语义（03 §7.2 relations/refs 分工纪律不动）；不改其它类型卡片的关联呈现；不改详情页关联阅读节点；不为 spark 单独发明新的关联呈现形态（复用现有组件路径）。

## 计划

- 现象核实与缺口定位：判据——明确 open spark 卡当前实际渲染树与数据（factAssociations/factRefs 是否为空、被何条件屏蔽），并记录用户所见状的具体项
- 按最终态做法对齐非终态呈现：判据——open spark 卡呈现关联信息，与终态卡走同一组件路径（不新增平行实现）
- 契约测试更新：判据——测试断言 open 状态 spark 卡包含关联呈现
- 验证三件套、dist 重建与受控提交：判据——tsc 0 错误、web 测试全绿、eslint 无新增、dist 重建且 index.html 引用新 hash、Git Gate passed

## 执行

- attempt 1：2026-09-16T23:29:51.839Z 起（controller: dsh-ldvh 主控 AI（deepseek-v4.1-flash））；Gate 1 授权范围见 gate_1.scope_snapshot。
- 现象核实与缺口定位（判据 1）：**推翻了本单创建时的假设**。SparkCardContent 对 open 返回 null 属实，但 ObjectCardFrame 无条件渲染关联段，故渲染层状态分支不构成缺口。真实缺口在数据层——`projectFactRefs` 只在 `showObject`（详情）调用，`projectListItemWithAssociations`（列表）只投影 relations 且**从不投影 refs**。实测 `listObjects('spark')` 全 44 项 `factRefs` 恒为 ABSENT；`factAssociations` 仅在部分终态 spark 出现。用户所见状的具体项 = spark-42086862（open，带 3 条 refs），其列表投影 `factRefs` 亦为 ABSENT，而详情投影为 3 条——同一对象的关联在两层阅读器不一致。
- 扩围裁定（Human，2026-09-16）：上述定位使原 scope「复用现有组件路径、不为 spark 单独发明新形态」不足以修复现象（修复须动列表投影层并新增 refs 的卡片呈现路径）。Human 就两个候选方案裁定「按定位结果扩围：列表投影补 factRefs + 卡片呈现 refs，解除 10 §5.2『卡片网格不承载关联对象』的既有裁定」。本裁定为规范面变更的依据来源，规范正文同步归遗留项。
- 实施：`facts.ts` 列表路径补投影 `factRefs`（复用既有 `projectFactRefs`，解析规则单点未改）；`ObjectList.tsx` 的 `FactAssociationsCardContent` 并列消费 `factAssociations` 与 `factRefs`，非终态卡与终态卡走同一组件路径，卡头扫描序不变。
- 独立复核（2026-09-16，冷读单视角）：结论 **有条件通过**——无越权改动、四项工程声明全部复核成立；发现 1「去重键不区分来源，当前『不合并去重』的安全来自 refs 恰好没有 target 字段这一偶然事实，一旦补上将静默丢弃 refs」已在本单内处置（去重键加 source 前缀分组隔离 + 断言钉住，提交 c1d0e26）。发现 2/5（既有类型建模松弛、refs 复用生命周期状态图标）非本单引入，登记为观察不处置。发现 4（gate_1.scope_snapshot 未随扩围回写）如实登记为授权记录的内部张力——snapshot 由 Code 在 approve 时机械加盖，本单不回改，扩围事实以 change_log 与 approve 摘要承载。

## 结果

- 判据 1（缺口定位）：**满足**。证据=实测 `listObjects('spark')` 44 项输出（`factRefs` 恒 ABSENT）+ 代码路径核对（`projectFactRefs` 仅 showObject 调用，facts.ts:563；列表调用点 facts.ts:281-298 只投影 relations）；用户所见状对象 spark-42086862 列表/详情投影不一致（0 vs 3）。
- 判据 2（open spark 呈现关联、同一组件路径）：**满足**。证据=`FactAssociationsCardContent({ associations, refs })` 单一组件承载两组；open spark 经 `ObjectCardFrame` 渲染该段；实测渲染 open spark 卡（spark-42086862 数据）产出关联段含 3 条 ref 行（含 title 与不可读占位）；列表投影与详情投影对该对象均返回 3 条 refs 且深度相等（回归测试已钉住）。
- 判据 3（契约测试断言）：**满足**。证据=`spark-refs-projection.test.ts` 新增「list cards project factRefs with the same contract as the detail read」（列表/详情两层一致 + 分工纪律）；`spark-reading-contract.test.ts` 以新断言取代已失效的「卡片不承载 refs」禁止断言（原 2026-09-13 裁定的禁止项被 Human 扩围显式解除）。
- 判据 4（三件套、dist、受控提交）：**满足**。证据=tsc exit 0；web 测试 250/250 通过；eslint 无新增（`facts.ts` 残留 1 项为既有未用参数，仅行号位移 442→448，已对 HEAD 版本比对确认）；dist 重建且 index.html 引用新 hash（7e0f377 后 `index-BBWdRIOT.js`，c1d0e26 后 `index-CbXCDlKi.js`）；两次提交 Git Gate 均 passed（snapshot_identity `fccc69bd…` / `7ec131fa…`）。
- achieved_scope：列表路径补投影 `factRefs` + 卡片呈现 `refs`（与 relations 同组件路径并列）+ 契约测试同步 + dist 重建 + 受控提交（7e0f377、c1d0e26）。open spark 卡关联呈现缺口已消除，两层阅读器契约一致。
- residual：① `specs/10` §5.2 正文尚未同步修订——Human 已裁定解除该项，但规范条文修订属另行议程，本单不改 specs/（授权明示）；② refs 在列表卡复用生命周期状态图标（`getFactAssociationState`）语义上可议，非本单引入，未处置；③ `FactCardAssociation` 类型对 refs 条目的建模松弛（声明 `target?` 而 refs 实为 `objectUid`）系既有问题，未处置；④ 列表卡 ref 行数多时的视觉高度未做目视确认。

