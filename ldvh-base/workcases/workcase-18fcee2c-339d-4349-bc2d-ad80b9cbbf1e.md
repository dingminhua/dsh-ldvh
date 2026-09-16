---
fact_type_key: workcase
object_uid: 18fcee2c-339d-4349-bc2d-ad80b9cbbf1e
title: spark 非终态卡关联呈现
status: draft
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
created_at: 2026-09-16T01:57:59.428Z
change_log:
  - at: 2026-09-16T01:57:59.428Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 受控创建——spark 非终态卡关联呈现（学习终态做法）。查重：workcases 全量 2 对象，范围不重叠；与
      WC-0002（workcase 三态呈现）同属 Web 呈现面但对象不同
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

