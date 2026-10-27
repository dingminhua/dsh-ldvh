---
title: 长标识符人工转写致删除命中失败
status: active
scope: 本条经验适用于任何需要把系统生成的长标识符（如 schedule_id、任务 ID）转述进面向用户的汇报文本、再以该文本回查执行的场景。
object_uid: 7fc0cb4f-30b0-4f66-93d4-dc708bad395e
fact_type_key: pitfall
created_at: 2026-10-20T06:35:11.534Z
change_log:
  - at: 2026-10-20T06:35:11.534Z
    provider: workbuddy
    model: space-bunny
    summary: 闲时辅助经验积累（机械通道）于 2026-10-20T06:34:43.610Z 形成候选
  - at: 2026-10-27T18:23:10.909Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 独立复现验证通过（隔离子代理 6ce22439，不同模型/独立上下文）：以 session_bridge_read 取得的 transcript 副本为证据链，核实畸形 ID（34 字符）、两次错 ID 致 schedule_not_found、改以 schedule_list 取回后删除成功。据 Human 2026-10-28「验证属实即入档」逐条验收指示，draft→active 入档。
---

# 长标识符人工转写致删除命中失败

## 症状

面向用户的汇报中引用了错误的定时任务 ID；随后以该 ID 执行删除时返回 `schedule_not_found`，删除未生效。

## 触发条件

需要在回复正文里转述系统生成的长标识符（本次为 schedule_id，UUID 形态），并把回复中写下的那串字符当作后续操作的入参。

## 根因

标识符是长 UUID 串，靠目视/记忆转写时漏字符或错位；写入回复时未与工具实际返回值回读比对，错误因此进入用户可见文本并被下游当作可信入参复用。同一错误在连续两次汇报中重复出现，说明缺陷在转写环节而非偶发笔误。

## 解决

放弃凭记忆补全 ID：改为先用 `schedule_list` 取回真实 ID，再以该 ID 执行删除。

## 规避

凡需在回复中复述标识符，一律从工具返回值原样复制，不手打；执行任何以标识符为入参的操作前，先用列表类只读调用回读比对，必要时以回读值为准。

## 验证

已观察：删除返回成功，`schedule_list` 列表已为空，轮询不再触发。未覆盖：仅一次实例，仅涉及 schedule_id；未观察长会话中其他类型标识符（工具调用 ID、会话 ID 等）是否出现同类转写偏差，也未观察该偏差对非删除类操作的影响。

独立复现验证（2026-10-28，入档前置）：复现主体为隔离子代理（独立上下文 session 6ce22439-6bdc-48a9-837b-35cf4be92d8b，未参与本候选形成）；独立性边界为不同模型（本次路由 dsh-opencode-go/deepseek-v4.1-flash，形成者记录为 space-bunny / provider workbuddy）、上下文隔离、非形成主体。核对方式与观察结果：原会话 `session-45802c98` 的日志不在本机会话库，改以 2026-10-20 14:31:54 经 `session_bridge_read` 取得的该会话 transcript 副本为证据链——其中用户可见汇报给出的任务 ID 为 `schedule-65718725-8ec1-4c39-8df3-591d31a80e`（UUID 段 34 字符，比合法 36 少 2）；该会话末条消息自述两次错 ID 致首次删除返回 `schedule_not_found`、改用 `schedule_list` 取回真实 ID 后删除成功且列表为空，与症状、根因、解决三段吻合。复现未覆盖：`schedule_delete` 的工具返回事件本身不在可读留痕中（只见会话文本行）；「删除后轮询不再触发」由删除成功推得，未做长时观察。

## 影响与适用范围

本条经验适用于任何需要把系统生成的长标识符（如 schedule_id、任务 ID）转述进面向用户的汇报文本、再以该文本回查执行的场景。
