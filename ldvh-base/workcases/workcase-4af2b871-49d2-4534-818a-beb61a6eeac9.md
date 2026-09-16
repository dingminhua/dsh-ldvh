---
fact_type_key: workcase
object_uid: 4af2b871-49d2-4534-818a-beb61a6eeac9
title: Web 工单呈现三态重建
status: open
summary: 按 21 号定稿语义重建 Web 的 WorkCase 呈现链（2026-09-15 Human 裁决「登记+三态重建」的实施单）：投影器从
  v4 状态机（open/blocked/closed+phase 八值）改为 21 号三态直读（draft/open/closed +
  gate_1/attempt/result/outcome
  字段）；状态筛选改五档（待批准执行/执行中/待批准关闭/已关闭/全部）；认知中心收件箱按三态重建并与筛选器共用「待批准关闭」派生判据；详情与卡片读 v5
  字段；清除 v4 残留；派生规则与 Gate 1/2 待办呈现契约登记进 10 号（受保护变更，随本单走 Human Gate）。
scope: 做什么：重写 plugin/web 的 WorkCase 投影（workcaseStatus.ts 及生成契约）为 21
  号三态直读；objects.ts 筛选改五档语义与 cancelled 四值徽标（废弃 ?progress= 五值词汇与 discarded
  映射）；cognition.ts 收件箱 InboxKind
  改三态+派生判定；WorkCaseReadingLayout/CriteriaList/ProgressTrack 等组件改读
  plan/result/outcome/attempt/gate_1；删除 v4
  残留（progressOptions、PriorityIcon/objectSignals 的 priority 链）；同步改写契约测试；在 10 号登记
  WorkCase 呈现契约（三态直读+五档派生规则+Gate 1/2 待办语义）。明确不做什么：不改 21 号（类型权威不动）；不改 plugin/lib
  writer/tools（已对齐）；不做蓝图新功能与 serves 筛选（未裁决，另行）；不迁移 v4 存量对象（21 §15.3 另行）。
plan:
  - done_criteria: draft/open/closed 三态对象全部 resolved、v4 phase 依赖消除；单元测试覆盖三态与字段缺失反例
    step: 投影器重写为 21 号三态直读
  - done_criteria: "五档（待批准执行/执行中/待批准关闭/已关闭/全部）可用，「待批准关闭」按「open ∧ 正文含 ## 结果
      节」派生；cancelled 不再映射 discarded，closed 组显 outcome 四值徽标"
    step: 筛选器五档与四值徽标
  - done_criteria: InboxKind 改 draft→Gate 1 待批、open+结果草稿→Gate 2 待关（与筛选器共用同一派生函数）；对
      21 号对象产生真实待办
    step: 认知中心收件箱三态重建
  - done_criteria: closed 详情显 criteria_checks 逐条核对与 outcome；open 显 attempt 现场与 plan
      进度；draft 显计划判据与待批准标识；work_items/closure_proposal/success_criterion_* 等 v4
      字段消费清除
    step: 详情与卡片字段改读 v5
  - done_criteria: specs/10 增 WorkCase 呈现契约节（三态直读+派生规则+Gate 1/2 待办语义），经 Human Gate 独立批准后受控提交
    step: 10 号呈现契约登记（受保护变更）
  - done_criteria: web 测试套（含改写后的契约测试）全绿、tsc/lint 无新增问题、全部变更经 Git Gate 提交
    step: 测试全绿与受控提交
gate_1:
  approved_at: 2026-09-15T21:58:57.171Z
  approver: Human
  authorization_fingerprint: 329d5e1ba69e82299959396fee525343849c8f3d8dc7e4d11167986a5f8770fe
  scope_snapshot: 做什么：重写 plugin/web 的 WorkCase 投影（workcaseStatus.ts 及生成契约）为 21
    号三态直读；objects.ts 筛选改五档语义与 cancelled 四值徽标（废弃 ?progress= 五值词汇与 discarded
    映射）；cognition.ts 收件箱 InboxKind
    改三态+派生判定；WorkCaseReadingLayout/CriteriaList/ProgressTrack 等组件改读
    plan/result/outcome/attempt/gate_1；删除 v4
    残留（progressOptions、PriorityIcon/objectSignals 的 priority 链）；同步改写契约测试；在 10
    号登记 WorkCase 呈现契约（三态直读+五档派生规则+Gate 1/2 待办语义）。明确不做什么：不改 21 号（类型权威不动）；不改
    plugin/lib writer/tools（已对齐）；不做蓝图新功能与 serves 筛选（未裁决，另行）；不迁移 v4 存量对象（21 §15.3
    另行）。
attempt:
  attempt_id: 3
  started_at: 2026-09-16T13:45:38.977Z
  controller: workbuddy/deepseek-v4.1-flash
  heartbeat_at: 2026-09-16T13:45:38.977Z
created_at: 2026-09-15T21:44:22.236Z
change_log:
  - at: 2026-09-15T21:44:22.236Z
    provider: zzztoken-glm
    model: glm-5.3
    summary: 受控创建 WC-0002——Web WorkCase 呈现三态重建（阶段 6 承载层：2026-09-15
      裁决「登记+三态重建」的实施单；查重：workcases 全量 1 对象 WC-0001（32 号起草，范围不同）；普查
      docs/web-workcase-v4-residue-census.md 为调研输入非对象）
  - at: 2026-09-15T21:58:57.171Z
    provider: zzztoken-glm
    model: glm-5.3
    summary: Gate 1 批准——经 ask_user_question 取得（2026-09-15），作用范围为 scope_snapshot 记载的
      Web 呈现重建范围；六步计划与 C2 冻结生效 [gate_1 approved by Human; attempt 1 allocated to
      glm-5.3-main-controller]
  - at: 2026-09-15T22:46:04.776Z
    provider: zzztoken-glm
    model: glm-5.3
    summary: 编码主体完成（子代理+主控收尾）：tsc 归零、测试 213/241（28 失败均为旧 v4 契约断言，12 文件待改写）；步骤 1-4
      编码面完成，剩余测试改写→10 号登记→全绿提交 [attempt 1 heartbeat refreshed]
  - at: 2026-09-15T23:46:40.026Z
    provider: zzztoken-glm
    model: glm-5.3
    summary: 验证三件套全达标：tsc 0、测试 235/235、eslint 零新增净减 7（基线 50→43）；28 项 v4
      断言全改写、两个功能缺口补齐；剩余步骤 5（10 号登记 Human Gate）与受控提交 [attempt 1 heartbeat
      refreshed]
  - at: 2026-09-16T13:44:57.334Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "冷恢复接管——完成孤立 attempt 副作用核对（提交 e56ce02 属已发生未记录）并 takeover 分配 attempt
      2；步骤 1-4/6 已完成，步骤 5 待 Gate [attempt 1 taken over → attempt 2 (controller:
      glm-5.3-main-controller)]"
  - at: 2026-09-16T13:45:38.977Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: "更正接管控制器身份——takeover 分配 attempt 3，controller 更正为
      workbuddy/deepseek-v4.1-flash [attempt 2 taken over → attempt 3
      (controller: workbuddy/deepseek-v4.1-flash)]"
---

# Web 工单呈现三态重建

## 摘要

按 21 号定稿语义重建 Web 的 WorkCase 呈现链（2026-09-15 Human 裁决「登记+三态重建」的实施单）：投影器从 v4 状态机（open/blocked/closed+phase 八值）改为 21 号三态直读（draft/open/closed + gate_1/attempt/result/outcome 字段）；状态筛选改五档（待批准执行/执行中/待批准关闭/已关闭/全部）；认知中心收件箱按三态重建并与筛选器共用「待批准关闭」派生判据；详情与卡片读 v5 字段；清除 v4 残留；派生规则与 Gate 1/2 待办呈现契约登记进 10 号（受保护变更，随本单走 Human Gate）。

## 授权范围

做什么：重写 plugin/web 的 WorkCase 投影（workcaseStatus.ts 及生成契约）为 21 号三态直读；objects.ts 筛选改五档语义与 cancelled 四值徽标（废弃 ?progress= 五值词汇与 discarded 映射）；cognition.ts 收件箱 InboxKind 改三态+派生判定；WorkCaseReadingLayout/CriteriaList/ProgressTrack 等组件改读 plan/result/outcome/attempt/gate_1；删除 v4 残留（progressOptions、PriorityIcon/objectSignals 的 priority 链）；同步改写契约测试；在 10 号登记 WorkCase 呈现契约（三态直读+五档派生规则+Gate 1/2 待办语义）。明确不做什么：不改 21 号（类型权威不动）；不改 plugin/lib writer/tools（已对齐）；不做蓝图新功能与 serves 筛选（未裁决，另行）；不迁移 v4 存量对象（21 §15.3 另行）。

## 计划

- 投影器重写为 21 号三态直读：判据——draft/open/closed 三态对象全部 resolved、v4 phase 依赖消除；单元测试覆盖三态与字段缺失反例
- 筛选器五档与四值徽标：判据——五档（待批准执行/执行中/待批准关闭/已关闭/全部）可用，「待批准关闭」按「open ∧ 正文含 ## 结果 节」派生；cancelled 不再映射 discarded，closed 组显 outcome 四值徽标
- 认知中心收件箱三态重建：判据——InboxKind 改 draft→Gate 1 待批、open+结果草稿→Gate 2 待关（与筛选器共用同一派生函数）；对 21 号对象产生真实待办
- 详情与卡片字段改读 v5：判据——closed 详情显 criteria_checks 逐条核对与 outcome；open 显 attempt 现场与 plan 进度；draft 显计划判据与待批准标识；work_items/closure_proposal/success_criterion_* 等 v4 字段消费清除
- 10 号呈现契约登记（受保护变更）：判据——specs/10 增 WorkCase 呈现契约节（三态直读+派生规则+Gate 1/2 待办语义），经 Human Gate 独立批准后受控提交
- 测试全绿与受控提交：判据——web 测试套（含改写后的契约测试）全绿、tsc/lint 无新增问题、全部变更经 Git Gate 提交

## 执行

- attempt 1 started at 2026-09-15T21:58:57.171Z (controller: glm-5.3-main-controller)。
- 步骤 1–4 与步骤 6 前半完成，受控提交 e56ce02（feat(web): WorkCase 呈现三态重建，34 files changed, +1508/−7648）；heartbeat 末次刷新 2026-09-15T23:46:40Z。
- 2026-09-16 冷恢复（21 §10.4）：确认该 attempt 为孤立 attempt（原 controller 属已中断会话，心跳陈旧约 9 小时）。已完成副作用范围核对——
  - 「已发生未记录」：受控提交 e56ce02 实际已落盘步骤 1–4 与 6 前半，但对象 change_log 无该条目（末条 23:46:40Z 早于提交 23:54:03Z）；控制器已更替而 attempt.controller 未更新。
  - 「已记录未发生」：未发现。步骤 5 记「剩余」且确未完成（specs/10 全文 0 处提及 WorkCase）。
  - 未核对项（如实声明）：三件套未复跑、dist hash 未复算、authorization_fingerprint 未复算。
- 副作用核对完成后执行 takeover：分配 attempt 3，controller 更正为 workbuddy/deepseek-v4.1-flash（21 §10.4 第 1、3 点）。
- 本次补记后，剩余工作为**步骤 5**（specs/10 登记 WorkCase 呈现契约，属受保护变更，须 Human Gate）。

## 结果（草稿，本单未关闭）

- 步骤 1–4、6：已完成——证据：提交 e56ce02 落盘三态投影器、五档筛选与 outcome 四值徽标、认知中心 InboxKind 三态重建、详情与卡片 v5 字段消费清除，以及改写的契约测试；该提交的验证记录为 web 测试 241/241 全绿、tsc 0 错误。
- 步骤 5：**未完成**——specs/10 尚未登记 WorkCase 呈现契约节；属受保护变更，须经 Human Gate 独立批准后受控提交。**未完成期间对象不得以 completed 关闭。**
- 残留责任：步骤 5 未完成。若 Human 裁定该登记暂缓，建议 outcome=partial 并说明残留去向（转新建 WC 或明确不跟踪）。

