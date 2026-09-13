---
title: Norm 类型实现侧空缺
status: discarded
question: "`ldvh-base/norms/` 实现侧（目录、FACT_DIRECTORIES、writer、Git Gate 断言）应如何建成？"
scope_boundary: Norm 可受控创建、可召回、Git Gate 覆盖时停止。
intent: 保留理由（已失效）——原判断「规范已定稿但承载层全空，Norm 无法出生」的规范侧与目录侧经核实已就位（目录已建、FACT_DIRECTORIES 已含），剩余仅为 writer 与校验管线；该剩余与 21 号 WorkCase 缺口性质完全相同，故合并为单一对象承载，不再以本形态独立跟踪。
summary: 本对象已按合并收口，不再以原形态跟踪。原主张「Norm 实现侧全部未建」部分仍真（无 writer、无 tools 受控入口、无 Git Gate 断言），但经机械核实有两处须更正：`ldvh-base/norms/` 已建（空目录）、`FACT_DIRECTORIES` 已含 Norm（`governed-projects.js:17`），故 `:287` 的建目录逻辑已包含它。真实剩余为承载层管线缺席，与 21 号 WorkCase 的缺口性质完全相同，故合并为单一承接对象 `c94ea382`「Norm 与 WorkCase 承载层补建」。
serves: SG-1
disposition: 合并：Norm 承载层剩余（writer／受控入口／Git Gate 断言）与 WorkCase 缺口同型，合并至 c94ea382「Norm 与 WorkCase 承载层补建」。
relations:
  - relation_key: merged-into
    target:
      object_uid: c94ea382-ce95-4f27-ab7c-8304101e31a7
object_uid: 6f5adc82-dc6e-4170-a6c0-9ee90add0db0
fact_type_key: spark
created_at: 2026-09-12T21:46:15.352Z
change_log:
  - at: 2026-09-12T21:46:15.352Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Spark 对象
  - at: 2026-09-13T08:54:37.607Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 终态转换 open→discarded（合并）：Norm 承载层剩余与 WorkCase 同型，合并至 c94ea382；更正目录与 FACT_DIRECTORIES 已存在的失实主张
---

# Norm 类型实现侧空缺

## 当前理解

本对象已按合并收口，不再以原形态跟踪。原主张「Norm 实现侧全部未建」部分仍真（无 writer、无 tools 受控入口、无 Git Gate 断言），但经机械核实有两处须更正：`ldvh-base/norms/` 已建（空目录）、`FACT_DIRECTORIES` 已含 Norm（`governed-projects.js:17`），故 `:287` 的建目录逻辑已包含它。真实剩余为承载层管线缺席，与 21 号 WorkCase 的缺口性质完全相同，故合并为单一承接对象 `c94ea382`「Norm 与 WorkCase 承载层补建」。

（来源：docs/fact-norm-design-consolidated.md §0 C11、§8；机械核实 2026-09-13）

## 调查问题

`ldvh-base/norms/` 实现侧（目录、FACT_DIRECTORIES、writer、Git Gate 断言）应如何建成？

**已答**：目录与 `FACT_DIRECTORIES` 登记项已存在；剩余 writer、受控入口与 Git Gate 断言属承载层管线问题，与 WorkCase 同型，合并后由 `c94ea382` 承接。原题不再以本形态悬置。

## 调查边界

Norm 可受控创建、可召回、Git Gate 覆盖时停止。

**实际终止路径**：本对象经 Human 确认（2026-09-13）按合并处理——原 question 的剩余部分与 `2e79939a` 的遗留合并为 `c94ea382`，本对象转 `discarded` 并以 `merged-into` 指向该目标。依 `20 §9.3`，被合并的原对象一律 `discarded`，不因部分内容已被承接而标记 `implemented`。
