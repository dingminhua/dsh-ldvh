---
title: 结果节正文与结构化 result 映射无机械门禁
status: voided
phenomenon: 工单结果节正文写「未达成」而结构化 result 标 satisfied=true 时，close 的机械校验不拦。
attribution: 21 §8 的三词↔布尔映射未落成机械门禁：workcase close 的校验覆盖只读取结构化 result，未与正文结果节做一致性交叉校验，缺口落在规范要求与 close 机械校验覆盖之间。
object_uid: c7946361-a13b-4b19-8c68-dfa9dacdbee3
fact_type_key: friction
created_at: 2026-11-04T17:32:03.591Z
change_log:
  - at: 2026-11-04T17:32:03.591Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 摩擦发现阈值晋升（观察缓冲同源条目 3 条 ≥ 3，11 §9 第 3 项）
  - at: 2026-11-04T18:37:15.750Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 补充观察：count 3 → 4（11 §9 第 2 项）
  - at: 2026-11-10T11:36:53.171Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补 recall_digest：为召回提供高密度关键词面（02 §7.1）
  - at: 2026-11-13T19:35:23.991Z
    provider: qoder-global
    model: qmodel_38max
    summary: 状态流转 open→voided：被约束的工单 close 校验与 21 §8 三词映射随 WorkCase 类型整体撤除（specs/21 删除 d4008808、代码层删除 4b279bdb、契约清理 5463ff4a），双入口落差所在接缝不复存在，无解药可指故不标 resolved，按 dc85ad59 判例走 voided（Human 2026-11-14 授权；行动前审查 skip）
occurrence:
  count: 4
  first_at: 2026-10-31T18:44:57.126Z
  last_at: 2026-11-04T18:24:57.896Z
disposition: 承载面已随 WorkCase 类型整体撤除：工单 close 机械校验与 21 §8 三词↔布尔映射（specs/21 删除 d4008808、workcase-writer 删除 4b279bdb）不复存在，落差无从复现；无修好的交叉校验可指，按 dc85ad59 判例走 voided 而非 resolved；「双入口一致性须落机械门禁」教训在未来同类映射出现时按新账目重新取用
---

# 结果节正文与结构化 result 映射无机械门禁

## 现象
工单结果节正文写「未达成」而结构化 result 标 satisfied=true 时，close 的机械校验不拦。

### 该阻碍的历次观察（3 次，逐字引证）
1. （2026-10-31T18:44:57.126Z，session-af8a25a9-e0f3-486c-bc9b-ef702ffd0663 @ 4）这把「双入口一致性」这句话变成了规范中的一句空话——我写了它却没有实现它。
（来源：4）
2. （2026-11-03T22:18:47.694Z，session-380a02f5-68d0-41d4-a111-94c78850cc03 @ turn 15..17）而我用一次 `close` 调用就把对象推进了终态。
来源：本会话 turn 17，assistant 正文（「问题不是你批准过或没批准过」段的失效链陈述）；同一材料内另见表格行「close 不接受任何 Human 授权参数」与「即使上限生效，「达上限⇒交 Human」也没有落点」。
3. （2026-11-04T17:24:25.168Z，session-5feaf696-d1ae-4268-999a-fe9caaaa9f3b @ 1）21 §8 的三词↔布尔映射目前只是写法约定，不是机械门禁
（来源：1）

## 入账依据
可归因：21 §8 对结果表述与布尔的三词映射只以写法约定存在，close 通道的机械校验仅取结构化 result、未与正文结果节做一致性交叉校验；补一道「正文结果表述 ↔ 结构化 result」的机械交叉校验即可拦下这类互相矛盾却能过 close 的状态，修正后该矛盾会在 close 前暴露而非事后靠逐条读原文发现。

补充观察（2026-11-04T18:24:57.896Z）：工单 close 时结果节正文与结构化 result 的三词↔布尔映射不一致未被机械拦下。
逐字引证：正文写“未达成”、结构化 `satisfied=true` 这种组合目前机械层不拦
来源：本会话 turn 1 助手回复「几个必须一起定的边界」段（第 ② 条）

## 处置
废弃（voided）。本条记账时（count 4）现象真实存在，废弃不否定入账依据。废弃理由：被约束的对象——工单 `close` 机械校验与 21 §8 的三词↔布尔映射——已随 WorkCase 事实类型与「工单执行」业务系统整体撤除：specs/21 已物理删除（d4008808，2026-11-13「全域清除工单类型与其系统」，Human 根决定 + adr-39547fb1）；workcase-writer.js 的 close 校验代码已删除（4b279bdb，2026-11-13）；Gate 1/2 契约残留已清（5463ff4a，2026-11-14）。本次核验（2026-11-14）：plugin/lib 已无 workcase 文件、无 close/satisfied 校验活代码，「正文结果节 ↔ 结构化 result」这道落差所在的接缝不复存在，矛盾状态无从再产生。**不标 resolved**：没有「修好的交叉校验」可指——被校验的通道本身已不存在；与 6c787082 中 friction-dc85ad59、同批 5c1b2d1d 同一判例。**不标 accepted**：accepted 是「阻碍仍在、选择不清偿」，与本条相反。复审触发：把关请示系统（specs/32）及未来任何「正文陈述与结构化字段双入口」的对象若出现同类映射，「双入口一致性须落成机械门禁而非写法约定」这一教训应重新取用——届时按新账目入账，不重开本条（终态不重开，26 §9.2）。
