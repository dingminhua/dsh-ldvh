---
title: 结果节正文与结构化 result 映射无机械门禁
status: open
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
occurrence:
  count: 4
  first_at: 2026-10-31T18:44:57.126Z
  last_at: 2026-11-04T18:24:57.896Z
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
