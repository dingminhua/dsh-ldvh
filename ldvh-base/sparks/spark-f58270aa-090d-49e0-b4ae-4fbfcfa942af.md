---
title: 插件内部模块边界评估
status: open
question: 保持单一安装包时，哪些 Host 内部模块边界能在不改变规范权威、DSH 注册契约和运行行为的前提下，降低维护成本？
scope_boundary: 本 Spark 只调查单一 dsh-ldvh 安装包内的 Host 模块职责与依赖边界，不授权代码修改、插件拆包、规范重构或 Client 与 lifecycle 行为调整。
intent: 确定内部模块化是否值得推进及其最小安全范围，避免把代码拆分误做成插件拆包或规则重构。
summary: 在保持单一安装包、规范权威和宿主契约不变的前提下，评估 Host 侧大模块的职责边界与行为等价拆分路径。
serves: af93e218-e9d9-4234-b436-33dc0c7c37dc
priority: P2
object_uid: f58270aa-090d-49e0-b4ae-4fbfcfa942af
fact_type_key: spark
created_at: 2026-11-16T23:54:12.089Z
change_log:
  - at: 2026-11-16T23:54:12.089Z
    provider: modeliflare
    model: gpt-6.1-terra
    summary: 创建 Spark：记录单一安装包内插件 Host 模块边界评估方向
refs:
  - object_uid: 71930c4a-f43f-439e-88bd-3aff7d07d37c
  - object_uid: af3f5fd7-dff3-4fd5-9599-d68563140b05
---

# 插件内部模块边界评估

## 当前理解

插件已有多个按职责拆分的 Host 模块，但召回、生命周期、工具聚合等少数入口仍较大；拆成多个可安装插件会增加生命周期、宿主注册面、配置和版本兼容的重复。此前完成的是只读架构诊断，不是代码改动授权。

## 调查问题

保持单一安装包时，哪些 Host 内部模块边界能在不改变规范权威、DSH 注册契约和运行行为的前提下，降低维护成本？

## 调查边界

本 Spark 只调查单一 dsh-ldvh 安装包内的 Host 模块职责与依赖边界，不授权代码修改、插件拆包、规范重构或 Client 与 lifecycle 行为调整。
