---
title: 提交消息格式凭惯例拼装致预检失败
status: draft
scope: 仅适用于经 LDVH 预检与 Git Gate 的受控提交场景，限于 provider/model trailer 与消息字段构成，不涉及提交内容本身的正确性或其他门禁类型。
object_uid: 116625df-be9a-4cea-a947-a99c627b9b15
fact_type_key: pitfall
created_at: 2026-10-17T03:55:31.990Z
change_log:
  - at: 2026-10-17T03:55:31.990Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 闲时辅助经验积累（机械通道）于 2026-10-17T03:55:20.749Z 形成候选
---

# 提交消息格式凭惯例拼装致预检失败

## 症状
首次 `ldvh_precheck_git_commit` 预检失败，被要求按 LDVH 提交规范调整提交消息格式；提交消息中的 `provider:` / `model:` trailer 值并无直接来源，助手需要自行解压 zstd 多帧会话日志取当次权威值。

## 触发条件
编写含 trailer 的受控提交消息时，凭直觉/惯例拼装消息结构而不先读提交规范原文，且 trailer 字段的权威值没有随预检结果或工具接口回显。

## 根因
提交消息的字段构成由 specs/06 明确规定而非宿主默认约定；预检只给出「不符合」的结论而不指出缺哪一段，使消息结构成为必须外部查证的隐藏依赖。同时 trailer 的 provider/model 只能从当次会话日志取证，规范要求「回指当次权威记录」但未提供取值接口。

## 解决
先读 `specs/06` 提交规范原文确认确切格式（需 `关键变更:` 小标题与 trailer），再从会话日志的 `request/context` 事件机械取得 provider=workbuddy、model=deepseek-v4.1-flash（并识别出与历史提交里的 `workbuddy-global` 不同，故不照抄），按此重写消息重跑预检，预检通过后再经 Git Gate 完成提交与推送。

## 规避
构造受控提交消息时，把「消息字段构成」当作规范原文而非习惯来查；trailer 一律取当次会话日志的实测值，禁止复用历史提交里的现成值作参照物；提交边界只暂存本次自己改动的文件，其余工作树改动保持未暂存。

## 验证
已观察到：预检由失败转为 `mechanical_outcome: passed`，Git Gate `commit-msg passed`，提交与推送成功（3 files changed）。未覆盖：未观察不同 provider 组合下的 trailer 行为；提交的功能本身（侧栏新按钮、刷新改调 hardReload）尚未在运行中的插件进程上目视验证，须重启插件后才第一次可见。

## 影响与适用范围
仅适用于经 LDVH 预检与 Git Gate 的受控提交场景，限于 provider/model trailer 与消息字段构成，不涉及提交内容本身的正确性或其他门禁类型。
