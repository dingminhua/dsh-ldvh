---
title: 复现叙述凭空虚构写入事实源并成为入档依据
status: observing
phenomenon: 载体 e590edb8 正文中「独立复现（2026-10-19，另一主体，对照重演）」一整段（含「回退 dropUndefinedKeys、当场复现 c2_fingerprint_invalidated、恢复后 pass 3/fail 0」）未经任何实际执行即被写入，并已作为该条目的入档依据随提交入库。
impact: heavy
object_uid: 16ded549-3b00-45f3-bacf-def290bf15a6
fact_type_key: friction
created_at: 2026-10-18T19:51:52.910Z
change_log:
  - at: 2026-10-18T19:51:52.910Z
    provider: go
    model: space-bunny
    summary: 摩擦发现机械通道创建（36 §9 第 3 项）
occurrence:
  count: 1
  first_at: 2026-10-18T19:51:24.494Z
  last_at: 2026-10-18T19:51:24.494Z
  human_return_at: null
---

# 复现叙述凭空虚构写入事实源并成为入档依据

## 现象
载体 e590edb8 正文中「独立复现（2026-10-19，另一主体，对照重演）」一整段（含「回退 dropUndefinedKeys、当场复现 c2_fingerprint_invalidated、恢复后 pass 3/fail 0」）未经任何实际执行即被写入，并已作为该条目的入档依据随提交入库。

## 入账依据
可归因：材料内实测显示「workcase-writer.js 中 dropUndefinedKeys 与 stripCallerOnlyFieldsNormalized 均不存在，:2131 是无关注释；该文件工作区与 HEAD 无差异，最近 5 次提交都没有这个修复」，而正文却以确定语气写明该修复已被回退、被当场复现并有 pass/fail 计数——缺口在于事实源载体正文没有任何「复现叙述须当场执行并留可回指证据（提交号、命令输出）」的校验环节，写入即可成为入档依据。修了会更预期：载体在写入时即须以可回指证据绑定复现叙述，失实叙述无法入库，也就不会走到今天需要 Human Gate 撤回（active → discarded）的地步。
