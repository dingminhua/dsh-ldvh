---
title: HEAD 自带 eslint 七错未被守门捕获
status: observing
phenomenon: 仓库 HEAD 提交态即带 7 个 eslint 错误（adr-writer/pitfall-writer/research-writer 三处死引用、governance-scope/pending-queue 两处未用导入、idle-runlog 两处含 147 行 { at, ...entry, at } 重复键），本次规范修订运行实测暴露——开发纪律把 eslint 当作提交前必跑的一环，而仓库自身基底在 HEAD 已破坏之，且既未被任何门禁拦下、也不见于既有账本任何条目。
impact: medium
object_uid: be70df64-2b48-4c60-b694-64aac5cd25b6
fact_type_key: friction
created_at: 2026-10-11T22:28:21.536Z
change_log:
  - at: 2026-10-11T22:28:21.536Z
    provider: glm
    model: kimi-k3
    summary: 摩擦发现机械通道创建（04 §8.4 第 3 项）
  - at: 2026-10-15T18:43:08.811Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 补充观察：count 1 → 2（04 §8.4 第 2 项）
occurrence:
  count: 2
  first_at: 2026-10-11T22:27:26.889Z
  last_at: 2026-10-15T18:42:36.468Z
  human_return_at: null
---

# HEAD 自带 eslint 七错未被守门捕获

## 现象
仓库 HEAD 提交态即带 7 个 eslint 错误（adr-writer/pitfall-writer/research-writer 三处死引用、governance-scope/pending-queue 两处未用导入、idle-runlog 两处含 147 行 { at, ...entry, at } 重复键），本次规范修订运行实测暴露——开发纪律把 eslint 当作提交前必跑的一环，而仓库自身基底在 HEAD 已破坏之，且既未被任何门禁拦下、也不见于既有账本任何条目。

## 入账依据
可归因：提交前先使 eslint 干净（triad 纪律）与 HEAD 自带 7 错是直接矛盾，成本全在守门可信度与债累积；且全部 7 错在 git 历史而非本次引入，说明此前守门一直未把这一基底暴露为账目。修了更好：对质量门基底做一次受控扫描并纳入摩擦账本，使其持续可查、不再靠某次碰巧运行才浮现。

补充观察（2026-10-15T18:42:36.468Z）：本次观察材料（turn 10）通篇在清点与分类仓库中实际存在的 30 条 eslint warnings，并反复核对后才能决定哪些能改：既有账目 be70df64「HEAD 自带 eslint 七错未被守门捕获」正是同一主题——代码树中潜在存留、需人工逐一识别与处置的 eslint 问题未被门禁自动消化。材料首句引证逐字呈现了「先清点这 30 个 warnings」的既有现象，判定与既有账目为同一阻碍，故报 same-obstacle 并指向 be70df64。注意：材料因长度上限被截断，只覆盖 turn 9/10 部分，未见这些 warnings 的最终处置结果，故仅能就所见部分判断其与既有账目同源，不影响 same-obstacle 的判定。
