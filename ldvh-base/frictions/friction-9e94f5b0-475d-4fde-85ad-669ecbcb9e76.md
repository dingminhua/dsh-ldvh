---
title: Git Gate 误把代码/测试当载体致自身无法提交
status: observing
phenomenon: Git Gate 的守门范围误把任意非 docs 文件（含代码与测试）当规范/事实载体，使验证规则的测试自身触发规则，改动无法通过自有守门；代理通过将范围收窄到 spec/fact 载体修复
impact: medium
object_uid: 9e94f5b0-475d-4fde-85ad-669ecbcb9e76
fact_type_key: friction
created_at: 2026-10-12T12:11:34.231Z
change_log:
  - at: 2026-10-12T12:11:34.231Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 摩擦发现机械通道创建（04 §8.4 第 3 项）
occurrence:
  count: 1
  first_at: 2026-10-12T12:11:08.519Z
  last_at: 2026-10-12T12:11:08.519Z
  human_return_at: null
---

# Git Gate 误把代码/测试当载体致自身无法提交

## 现象
Git Gate 的守门范围误把任意非 docs 文件（含代码与测试）当规范/事实载体，使验证规则的测试自身触发规则，改动无法通过自有守门；代理通过将范围收窄到 spec/fact 载体修复

## 入账依据
守门检查范围过宽：把本应按条文限定于「规范或事实载体」的范围扩大到了任意非 docs 文件，连验证该规则的测试与代码注释都算作主张载体，导致合规改动无法提交自身，是一个真实的设计缺陷
