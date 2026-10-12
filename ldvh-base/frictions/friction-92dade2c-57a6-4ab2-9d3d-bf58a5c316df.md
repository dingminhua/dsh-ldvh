---
title: 清空 docs/ 后存量引用失效
status: observing
phenomenon: 清空 docs/ 后 specs 与 README 中留存的 docs/ 路径引用指向已不存在的文件，引用方与被引用方脱钩，按路径无法回查。
impact: light
object_uid: 92dade2c-57a6-4ab2-9d3d-bf58a5c316df
fact_type_key: friction
created_at: 2026-10-12T11:49:42.978Z
change_log:
  - at: 2026-10-12T11:49:42.978Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 首笔入账：清空 docs/ 后 specs/README 存量引用失效（04 §8.4 机械通道创建）
occurrence:
  count: 1
  first_at: 2026-10-12T12:05:00.000Z
  human_return_at: null
  last_at: 2026-10-12T12:05:00.000Z
---

# 清空 docs/ 后存量引用失效

## 现象
清空 docs/ 后 specs 与 README 中留存的 docs/ 路径引用指向已不存在的文件，引用方与被引用方脱钩，按路径无法回查。

## 入账依据
实测枚举（清空 docs/ 后逐文件 grep，均为唯一命中），失效引用分布在下列**引用方**（被引目标的具体路径不在此复述——复述该路径即等于在本账目内重建同一条失效引用，会撞上 09 §5.3 第 5 项；按引用方与行号可原位回查）：`specs/27-Norm-事实规范.md`:39（3 处）、`specs/26-Friction-摩擦账本.md`:36（1 处）、`specs/20-Spark-火花.md`:40、`specs/21-WorkCase 工单.md`:46、`specs/22-ADR-决策.md`:34、`specs/25-Goal-项目目标.md`:33（此四者各 1 处，指向同一目标）、`specs/32-记忆存取系统规范.md`:22/88/120（3 处，指向同一目标）、`README.md`:5（1 处）。另有 6 处实现注释同形（`plugin/lib/commit-validation.js`:10、`session-signature.js`:19、`spec-registry.js`:13、`index.js`:48/76、`spark-writer.js`:809）。可归因性：根因是删除动作与引用清理未同批——docs/ 被整体清空（Human 指示 2026-10-12），而引用方未同步改指。修了会更好的预期：这些引用的效力语义多为「只作设计输入，不取得规范效力」，故失效的主要是**可回查性**而非效力——读者按路径回查将得到空结果，且该形态无法自证是「本就不存在」还是「曾经存在但已删」。同一形态已由 09 §5.3 第 5 项（2026-10-12 新增）在新增侧阻断，但该检查明确不追溯存量，故本项仍待逐处处置。按 Human 指示「已有的之后逐步处理」，本笔只作存量登记，不主张立即修复。本笔为机械通道创建，仅陈述现象与实测证据；复述目标路径会使本账目自身成为一条新的失效引用（已实测被 09 §5.3 第 5 项拦下），故按引用方与行号登记而不复述目标路径。
