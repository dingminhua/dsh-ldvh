---
title: 后台子代理失败退出无结束消息
status: open
phenomenon: 后台子代理在完成前失败退出，未留下任何结束消息。
attribution: DSH 宿主子代理终态判定与完成通知路径：子代理登记表与 turn-end 捕获只记录终态，不向父会话给出可判定的「结束消息缺失」原因；父子会话之间缺少「终态=失败」与「结论已回传」的绑定，父会话只能靠 reasoning 旁路补取
object_uid: 72014503-dfc8-4a7a-b84d-adefbd83e03c
fact_type_key: friction
created_at: 2026-11-06T11:30:29.986Z
change_log:
  - at: 2026-11-06T11:30:29.986Z
    provider: openai-codex
    model: gpt-6.1-terra
    summary: 摩擦发现阈值晋升（观察缓冲同源条目 3 条 ≥ 3，11 §9 第 3 项）
  - at: 2026-11-10T11:36:38.930Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补 recall_digest：为召回提供高密度关键词面（02 §7.1）
  - at: 2026-11-11T16:02:47.566Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补充观察：count 3 → 4（11 §9 第 2 项）
  - at: 2026-11-11T16:11:02.042Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补充观察：count 4 → 5（11 §9 第 2 项）
occurrence:
  count: 5
  first_at: 2026-11-05T06:36:09.895Z
  last_at: 2026-11-11T16:03:29.616Z
---

# 后台子代理失败退出无结束消息

## 现象
后台子代理在完成前失败退出，未留下任何结束消息。

### 该阻碍的历次观察（3 次，逐字引证）
1. （2026-11-05T06:36:09.895Z，session-5feaf696-d1ae-4268-999a-fe9caaaa9f3b @ turn 2..4）问题诊断本身成立，但方案的核心判据不成立
来源：会话 turn 4：Background subagent 458db97c-2fa5-44ae-b9bc-0712b8fcd594 的 closing message（审核结论原文）
2. （2026-11-05T13:35:37.286Z，session-ce3bdb87-5510-4b78-b491-5629c267682a @ turn 27..30）复审已完成（inactive），但没有把报告发回来
来源：本次材料 [turn 29] assistant 段首段：「复审已完成（inactive），但没有把报告发回来。我到它的会话日志里提取结论。」；同一段及本轮交付末段复述「复审体分析完成后未发出正式报告」
3. （2026-11-06T11:13:08.952Z，session-e210c881-e58f-404b-9659-7cdfeda22825 @ turn 50..58）failed before it finished.It left no closing message.
来源：本次观察材料 turn 54 user 行：子代理 95ff0ebb-4973-4f93-9793-d962e7c02c48 的完成通知

## 入账依据
后台子代理异常退出时，宿主只登记并广播终态（失败/不活跃），而父会话判断结论是否到手依赖子代理自己发出的结束消息；终态与结束消息之间没有绑定，任何在完成前退出的子代理都会让父会话既拿不到结论、也无法区分「失败退出」与「静默完成」，只能改从 reasoning 记录旁路提取结论并自行核对。这不是单次事故，而是终态判定与结论回传接缝的结构性缺口，与既有组中「已完成分析但未发出报告、会话已 inactive」的观察同属一类。

补充观察（2026-11-11T15:56:17.375Z）：本次材料中出现的阻碍是「委派的审核子代理未产出任何结论就消失，父会话无从判读失败原因」：98de8f30 在 turn 11 被报为「中途失败，零产出——没留任何结论，也没留任何文件产物」，主控只能去查工作树确认它没写东西；turn 13 再查子代理会话日志才读到「失败：500 fetch failed」这一失败原因。同一窗口内另外两个外部执行体（claude_code、codex）也因「agentOptions 能力不兼容被拒」不可用，主控自陈「这已经是本次会话第二次子代理零产出」。按归因落点与机制模式比对：既有 open 账目 friction-72014503（后台子代理失败退出无结束消息；归因为宿主子代理终态判定与完成通知路径缺少「终态=失败」与「结论已回传」的绑定，父会话只能靠 reasoning 旁路补取）与本次现象落在同一子系统、以同一方式反复产生（失败退出、无结束消息/无结
逐字引证：中途失败，零产出——没留任何结论，也没留任何文件产物
（来源：13）

补充观察（2026-11-11T16:03:29.616Z）：委派的规范一致性审核子代理（98de8f30）在返回任何结论前以 500 fetch failed 失败退出，工作树未留下任何文件产物。
逐字引证：失败：500 fetch failed
来源：主控会话（水位后新增内容）turn 11 助手回复「规范一致性审核（98de8f30）：中途失败，零产出」；turn 13 助手回复中派发记录表格行「["98de8f30","规范一致性","qoder-global / qmodel_38max","失败：500 fetch failed"]」
