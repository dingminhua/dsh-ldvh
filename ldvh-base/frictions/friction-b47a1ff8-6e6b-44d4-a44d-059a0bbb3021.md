---
title: 事实对象载体被直改绕过受控写入
status: observing
phenomenon: 为延长 Friction 载体的现象段，直接用 python 改写该 .md 文件，未走受控写入工具，致该次改动既无 change_log 也无 occurrence 更新，随后须以受控写入整体重做才能补齐审计链。
impact: light
object_uid: b47a1ff8-6e6b-44d4-a44d-059a0bbb3021
fact_type_key: friction
created_at: 2026-10-22T04:29:51.812Z
change_log:
  - at: 2026-10-22T04:29:51.812Z
    provider: glm
    model: deepseek-v4.1-flash-1017
    summary: 受控创建 Friction 对象
occurrence:
  count: 1
  first_at: 2026-10-22T04:26:20.000Z
  last_at: 2026-10-22T04:26:20.000Z
---

# 事实对象载体被直改绕过受控写入

## 现象
为延长 Friction 载体的现象段，直接用 python 改写该 .md 文件，未走受控写入工具，致该次改动既无 change_log 也无 occurrence 更新，随后须以受控写入整体重做才能补齐审计链。

## 入账依据
可归因性：事实对象虽以 Markdown 文件承载、文本编辑工具即可改写，但 02 §10 的受控写入负责盖戳 `change_log`、重算 `occurrence`、维护指纹与状态闭集；直接改文件在这些维度上全部静默跳过，载体表面上「已更新」而审计链缺失，只有回读 change_log 才能发现。本次同轮即被发现并补做受控写入，净效果为零，但若未发现则留下一条无来源的正文变更。修了会更好的预期：在事实源目录上设置写前提示或提交期校验（`change_log` 末条时间戳须不早于文件 mtime 之外的可核锚点），可让直改这类旁路在提交前显形。

补充说明：本次为单次发生，未达 26 §9.2 的阈值（count ≥ 3），按 `observing` 记账留观。
