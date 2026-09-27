---
fact_type_key: workcase
object_uid: 9208ce82-a332-4cfb-a8a2-65e6fd59c3b3
title: goal 路由补 yaml_source 投影
status: open
gist: 给 GET /api/cognition/goal 补 yaml_source 投影（读取层早已解析出 goal.md frontmatter 原文），使 goal 详情页的 YAML 节点显示原文而不是重建兜底——这是详情页 YAML 呈现推广之后唯一残留的例外。
serves: SG-3
summary: |-
  事实对象详情页底部的 YAML 源节点已推广到全部类型（workcase-63700bd2，已关闭）。唯一例外是 goal：它不走事实对象读取层，而走 GET /api/cognition/goal 独立直读路由，该路由的响应不投影 yaml_source，于是前端落到 reconstructFactYaml 重建兜底——Human 在 goal 详情页看到的是重建 YAML 而非 goal.md 原文。

  ### 现状核实
  读取层的 readGoalRecord 已解析出 frontmatterSource（frontmatter 逐字原文）并在返回值中携带，但 GET /api/cognition/goal 的响应投影只取 goal_key/title/status/statement/sub_goals/created_at/change_log 与读取层元数据，未把 frontmatterSource 投影为 yaml_source。前端 GoalDetail 直接把该记录当 obj 传给共享的 FactReadingContent，而后者底部 YamlDataNode 的「原文优先、重建兜底」分支已就位（ObjectDetail.tsx），故服务端补上投影即可让原文生效。

  ### 边界
  只补投影与必要测试；不改 goal 阅读布局与字段级呈现，不改其它路由与事实对象读取层，不改 specs/25 与 specs/10 文本。
scope: |-
  做什么：
  - 在 GET /api/cognition/goal 的响应投影中补 yaml_source，取自读取层已解析的 frontmatter 原文，逐字透传
  - 同步前端 CognitionGoalData 的类型声明，使 goal 详情页沿用既有「原文优先、重建兜底」分支
  - 补契约测试断言该投影与 goal.md frontmatter 一致，并重建 Web 产物 dist

  明确不做什么：
  - 不改 goal 详情页的阅读布局与字段级呈现
  - 不改事实对象读取层与其它路由的投影语义
  - 不改 specs/25、specs/10 规范文本
plan:
  - done_criteria: 列出 GET /api/cognition/goal 现有响应字段与读取层可得的 frontmatter 原文位置，机械可查
    step: 核实 goal 路由投影与 frontmatterSource 可得性
  - done_criteria: 该路由响应含 yaml_source 且与 goal.md frontmatter 逐字一致；前端类型同步；契约测试断言该字段的存在与来源
    step: 补 yaml_source 投影与前端类型声明
  - done_criteria: tsc 报错为 0、web 测试全绿、eslint 无新增；dist 重建后 index.html 引用新 hash
    step: 回归确认与 dist 重建
gate_1:
  approved_at: 2026-09-27T02:51:43.229Z
  approver: Human
  authorization_fingerprint: ce9f6f9e3d9a0ee54b98061aaca017b6aa8d1ed1ac82f8c611ad029f1e8d7e49
  scope_snapshot: |-
    做什么：
    - 在 GET /api/cognition/goal 的响应投影中补 yaml_source，取自读取层已解析的 frontmatter 原文，逐字透传
    - 同步前端 CognitionGoalData 的类型声明，使 goal 详情页沿用既有「原文优先、重建兜底」分支
    - 补契约测试断言该投影与 goal.md frontmatter 一致，并重建 Web 产物 dist

    明确不做什么：
    - 不改 goal 详情页的阅读布局与字段级呈现
    - 不改事实对象读取层与其它路由的投影语义
    - 不改 specs/25、specs/10 规范文本
attempt:
  attempt_id: 1
  started_at: 2026-09-27T02:51:43.229Z
  controller: deepseek-v4.1-flash@dsh-ldvh-session
  heartbeat_at: 2026-09-27T02:51:43.229Z
  session_id: session-ec7b4135-e2b3-4205-b442-ec1efb4afe05
  session_source: host
created_at: 2026-09-27T02:47:36.406Z
change_log:
  - at: 2026-09-27T02:47:36.406Z
    provider: ds-4sf
    model: deepseek-v4.1-flash
    summary: 受控创建——goal 原文投影：给 /api/cognition/goal 补 yaml_source（承接 workcase-63700bd2 的残留去向「另立工单」）。查重：workcases 现存 13 个对象（11 open / 2 draft）加 4 份终态记录，无 goal 路由投影或 yaml 原文相关范围重叠者
  - at: 2026-09-27T02:51:43.230Z
    provider: ds-4sf
    model: deepseek-v4.1-flash
    summary: Gate 1 批准——Human 确认执行，并明确暂不开工（执行待另行发话）；授权绑定当次 plan+scope 指纹 [gate_1 approved by Human; attempt 1 allocated to deepseek-v4.1-flash@dsh-ldvh-session]
---

# goal 路由补 yaml_source 投影

## 摘要

事实对象详情页底部的 YAML 源节点已推广到全部类型（workcase-63700bd2，已关闭）。唯一例外是 goal：它不走事实对象读取层，而走 GET /api/cognition/goal 独立直读路由，该路由的响应不投影 yaml_source，于是前端落到 reconstructFactYaml 重建兜底——Human 在 goal 详情页看到的是重建 YAML 而非 goal.md 原文。

### 现状核实
读取层的 readGoalRecord 已解析出 frontmatterSource（frontmatter 逐字原文）并在返回值中携带，但 GET /api/cognition/goal 的响应投影只取 goal_key/title/status/statement/sub_goals/created_at/change_log 与读取层元数据，未把 frontmatterSource 投影为 yaml_source。前端 GoalDetail 直接把该记录当 obj 传给共享的 FactReadingContent，而后者底部 YamlDataNode 的「原文优先、重建兜底」分支已就位（ObjectDetail.tsx），故服务端补上投影即可让原文生效。

### 边界
只补投影与必要测试；不改 goal 阅读布局与字段级呈现，不改其它路由与事实对象读取层，不改 specs/25 与 specs/10 文本。

## 授权范围

做什么：
- 在 GET /api/cognition/goal 的响应投影中补 yaml_source，取自读取层已解析的 frontmatter 原文，逐字透传
- 同步前端 CognitionGoalData 的类型声明，使 goal 详情页沿用既有「原文优先、重建兜底」分支
- 补契约测试断言该投影与 goal.md frontmatter 一致，并重建 Web 产物 dist

明确不做什么：
- 不改 goal 详情页的阅读布局与字段级呈现
- 不改事实对象读取层与其它路由的投影语义
- 不改 specs/25、specs/10 规范文本

## 计划

- 核实 goal 路由投影与 frontmatterSource 可得性：判据——列出 GET /api/cognition/goal 现有响应字段与读取层可得的 frontmatter 原文位置，机械可查
- 补 yaml_source 投影与前端类型声明：判据——该路由响应含 yaml_source 且与 goal.md frontmatter 逐字一致；前端类型同步；契约测试断言该字段的存在与来源
- 回归确认与 dist 重建：判据——tsc 报错为 0、web 测试全绿、eslint 无新增；dist 重建后 index.html 引用新 hash

## 执行

- attempt 1 started at 2026-09-27T02:51:43.229Z (controller: deepseek-v4.1-flash@dsh-ldvh-session)；Gate 1 授权范围见 gate_1.scope_snapshot。

