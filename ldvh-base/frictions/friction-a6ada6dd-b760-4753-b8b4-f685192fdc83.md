---
title: 预检要求 trailer 却无权威值回显
status: observing
phenomenon: 受控提交预检要求提交消息携带 provider/model trailer，但不回显权威值，提交方每次需自行解压会话日志取证
impact: medium
object_uid: a6ada6dd-b760-4753-b8b4-f685192fdc83
fact_type_key: friction
created_at: 2026-10-17T03:55:31.984Z
change_log:
  - at: 2026-10-17T03:55:31.984Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 摩擦发现机械通道创建（04 §8.4 第 3 项）
occurrence:
  count: 1
  first_at: 2026-10-17T03:55:20.749Z
  last_at: 2026-10-17T03:55:20.749Z
  human_return_at: null
---

# 预检要求 trailer 却无权威值回显

## 现象
受控提交预检要求提交消息携带 provider/model trailer，但不回显权威值，提交方每次需自行解压会话日志取证

## 入账依据
该阻碍可直接归因于预检链路缺少权威值回显接口（引用材料：「预检工具要求消息里先带上这两行」与「我需要确认实际 provider/model 的权威值，不能凭历史提交照抄」），并且若预检直接回显或提供取值接口，本次的手工解码取证环节即可免除，符合「修了会更好」的入账要求。
