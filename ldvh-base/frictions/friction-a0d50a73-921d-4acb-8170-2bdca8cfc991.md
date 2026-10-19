---
title: 重载回报成功但运行实例不换代码
status: observing
phenomenon: '`plugin_manager` 停用再启用两次均返回 `application: "applied"`、`changed: true`，切换后逐项复测行为不变（形态不可核验的正文仍执行到 writer 层的 `body_invalid`）；同期磁盘代码已是新版（`normalizeBodyMarkdown` 定义在 `plugin/lib/workcase-tools.js:129`，`execute` 分支在 `:767` 调用它），该状态跨 turn 56–58 持续未变。'
impact: heavy
object_uid: a0d50a73-921d-4acb-8170-2bdca8cfc991
fact_type_key: friction
created_at: 2026-10-19T07:35:12.242Z
change_log:
  - at: 2026-10-19T07:35:12.242Z
    provider: go
    model: space-bunny
    summary: 摩擦发现机械通道创建（36 §9 第 3 项）
occurrence:
  count: 1
  first_at: 2026-10-19T07:33:27.251Z
  last_at: 2026-10-19T07:33:27.251Z
  human_return_at: null
---

# 重载回报成功但运行实例不换代码

## 现象
`plugin_manager` 停用再启用两次均返回 `application: "applied"`、`changed: true`，切换后逐项复测行为不变（形态不可核验的正文仍执行到 writer 层的 `body_invalid`）；同期磁盘代码已是新版（`normalizeBodyMarkdown` 定义在 `plugin/lib/workcase-tools.js:129`，`execute` 分支在 `:767` 调用它），该状态跨 turn 56–58 持续未变。

## 入账依据
可归因：turn 57 进一步查明 `applied` 的判据只是「`hmr` 服务存在」，与代码是否真的换掉无关，且 `reconcileProfile` 的 `files.compare` 只比对内存中已加载过的 URL，故 link 包模块的改动运行期不生效——即阻碍在控制面回报语义，不在代码落盘。若无此阻碍，同一会话内即可复测工具层形态校验并直接收口 Gate 2，不必把「是否重启宿主」这个只能由 Human 做的事交出去。
