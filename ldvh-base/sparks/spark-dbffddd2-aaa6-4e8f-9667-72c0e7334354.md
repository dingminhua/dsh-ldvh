---
title: 执行系统（单元执行）的建立
status: open
question: 新增执行系统（暂名「单元执行」）的规范、事实类型与承载层应如何建立？
scope_boundary: 执行系统规范建成、21 号 WorkCase 事实类型落地、承载层契约明确时停止。
intent: 保留理由——已定项 B 明确「30–38 从未起草」且执行系统为新增；这是六业务系统中「工单执行」的落点，不建则业务系统段缺一支。
summary: 已定项 B（Human 已决定）：04 行动模板基础规范整体退出；三类语义构成要素→两类（规范模型+事实模型）；30–38 模板编号作废。**新增执行系统**（现名「工单执行」，原暂名「单元执行」），参照调研吸收系统三件套模式：系统规范（流程层）+ WorkCase 事实类型（结构层，21 号已预留）+ CLI 服务与宿主机制（承载层）。依据：30–38 从未起草；v5 全部真实工作零模板参与；v4 问题账 095（过度合规）教训。护栏：执行系统只收「被批准工单」，低风险普通求解不进 WorkCase。审议结论「成立，但登记表述须改」——内容多为职责迁移非消灭，登记应为「04 退出（职责迁移）+ 32 执行系统新建」，两者分别走 Human Gate。**并入项**：`restructure-decision-list` §2 已定项 B 的剩余补动作。
serves: befe1735-1187-4d60-ba53-e55eb0cb7de2
priority: P2
object_uid: dbffddd2-aaa6-4e8f-9667-72c0e7334354
fact_type_key: spark
created_at: 2026-09-12T21:46:21.932Z
change_log:
  - at: 2026-09-12T21:46:21.932Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Spark 对象
  - at: 2026-09-13T15:08:54.068Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 回填 priority=P2（20 §8 新增字段，Human 裁定 A；AI 出初值，Human 可随时调整）
  - at: 2026-09-14T21:30:09.061Z
    provider: zzztoken-glm
    model: glm-5.3
    summary: 术语同步：执行系统名「工作执行」→「工单执行」、护栏「被批准工作」→「被批准工单」（依 2026-09-15 Human 更名与 WorkCase 中文规范名决定）
  - at: 2026-10-08T20:07:45.988Z
    provider: glm
    model: glm-5.3
    summary: 批次 F 旧号位引文更正：「调研系统三件套」按现行定名更正为「调研吸收系统三件套」（03 §9.4 调研吸收）2 处，摘要与正文同步；追加号位注记说明「04/32」为创建时点历史号位（04 行动模板规范已退出、32 号现为 specs/34），照录不改；21 号现行有效
  - at: 2026-11-01T23:40:02.627Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 补入 2026-11-02 只读重核节：三件套 2/3——① specs/32-工单执行系统规范 已建成（17 个 H2、01 §8.2 已登记，编号经 5157b60 建立与 f83c483 迁回）；② 21 号 WorkCase 已落地（fact_type_key 入 specs/02 §7 登记值域，plugin/lib 下 workcase-writer/tools/goals/route-ledger 四模块齐备，存量 20+ 对象）；③ 承载层契约未明确且形态被实测否定——specs/05 与 specs/10 全文 workcase 零命中，真实承载是 plugin/lib 模块而非 CLI 服务，故第三件要建的是「插件模块作为承载层的契约与登记位置」而非往 05 号加操作。summary 未改
---

# 执行系统（单元执行）的建立

## 当前理解

已定项 B（Human 已决定）：04 行动模板基础规范整体退出；三类语义构成要素→两类（规范模型+事实模型）；30–38 模板编号作废。**新增执行系统**（现名「工单执行」，原暂名「单元执行」），参照调研吸收系统三件套模式：系统规范（流程层）+ WorkCase 事实类型（结构层，21 号已预留）+ CLI 服务与宿主机制（承载层）。依据：30–38 从未起草；v5 全部真实工作零模板参与；v4 问题账 095（过度合规）教训。护栏：执行系统只收「被批准工单」，低风险普通求解不进 WorkCase。审议结论「成立，但登记表述须改」——内容多为职责迁移非消灭，登记应为「04 退出（职责迁移）+ 32 执行系统新建」，两者分别走 Human Gate。**并入项**：`restructure-decision-list` §2 已定项 B 的剩余补动作。

### 2026-11-02 重核（只读）：三件套前两件已建成，第三件「承载层契约」缺条文

> 本节给出**当前**证据；上文是记录时点叙述，未改写。

`scope_boundary` 三要件逐项核：

**①「执行系统规范建成」——已建成**。`specs/32-工单执行系统规范.md` 存在，`spec_id: "32"`、`spec_key: "work-order-execution-system-foundation"`，17 个 H2 节（§1 价值判断 … §12 与相邻系统及能力的边界），`01 §8.2` 号位表已登记「32 | 工单执行系统规范」。原编号经历一次迁移：`5157b60`（2026-09-16）以 32 号建立，`f83c483`（2026-10-22）因撤销记忆存取系统而把「34-工单执行系统规范」改回 32 号。

**②「21 号 WorkCase 事实类型落地」——已落地**。`specs/21-WorkCase 工单.md` 存在且 `fact_type_key: workcase` 已列入 `specs/02` §7 的登记值域（与 spark/adr/pitfall/research/friction/norm/subgoal/devlog 并列）；实现侧 `plugin/lib/workcase-writer.js`（含 create/approve/execute/close/rebatch/cancel/revise/correct/record_review/record_audit 全通道）、`workcase-tools.js`、`workcase-goals.js`、`workcase-route-ledger.js` 四模块齐备，`ldvh-base/workcases/` 下 20+ 存量对象。

**③「承载层契约明确」——未明确，且缺口形态特殊**。原设想的承载层是「CLI 服务与宿主机制」，但实测：`specs/05-LDVH CLI 确定性服务规范.md` 全文 **`workcase` 零命中**（18 条操作登记里没有任何 WorkCase 操作）；`specs/10` 全文亦 **`workcase` 零命中**。即承载层**不是经 CLI 服务承载的**，而是经 `plugin/lib/workcase-*.js` 直接实现，其契约来源是 21 号（类型语义）与 09 号（提交契约），**没有一份规范声明「WorkCase 的承载层由谁承接、契约形态为何」**。这与 27a9dbfc（WorkCase 承载层与 attempt 接缝）是同域问题的两个切面：本条问「三件套的第三件是否建成」，27a9dbfc 问「承载层如何建成 + attempt 接缝如何闭合」。

**故本条完成度 2/3**：规范层与类型层已建成，承载层契约缺条文。且「CLI 服务」这一预设形态已被实测否定——真实承载是插件模块，这意味着第三件要建的**不是「往 05 号加操作登记」，而是「明确插件模块作为承载层的契约与登记位置」**，是一次形态判断而非补登记。

## 调查问题

新增执行系统（暂名「单元执行」）的规范、事实类型与承载层应如何建立？

## 调查边界

执行系统规范建成、21 号 WorkCase 事实类型落地、承载层契约明确时停止。
