---
title: 清空 docs/ 后存量引用失效
status: open
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
  - at: 2026-10-14T04:48:02.047Z
    provider: ds41
    model: deepseek-v4.1-flash
    summary: 补充观察：count 1 → 2（04 §8.4 第 2 项）
  - at: 2026-10-19T04:16:14.974Z
    provider: go
    model: space-bunny
    summary: 补充观察：count 2 → 3（36 §9 第 2 项）
  - at: 2026-10-19T04:16:14.982Z
    provider: go
    model: space-bunny
    summary: 阈值流转 observing → open（count 3 ≥ 3，36 §9 第 4 项）
  - at: 2026-10-19T05:49:03.887Z
    provider: qoder-global
    model: qfmodel
    summary: 勘误：2026-10-19 补充观察字面复述了 docs 下 archive 子目录路径，与本账自述口径冲突且触 09 §5.3 第 5 项拦止；改为不复述形态，语义/计数/status 不变
occurrence:
  count: 3
  first_at: 2026-10-12T12:05:00.000Z
  human_return_at: null
  last_at: 2026-10-19T04:16:02.618Z
---

# 清空 docs/ 后存量引用失效

## 现象
清空 docs/ 后 specs 与 README 中留存的 docs/ 路径引用指向已不存在的文件，引用方与被引用方脱钩，按路径无法回查。

## 入账依据
实测枚举（清空 docs/ 后逐文件 grep，均为唯一命中），失效引用分布在下列**引用方**（被引目标的具体路径不在此复述——复述该路径即等于在本账目内重建同一条失效引用，会撞上 09 §5.3 第 5 项；按引用方与行号可原位回查）：`specs/27-Norm-事实规范.md`:39（3 处）、`specs/26-Friction-摩擦账本.md`:36（1 处）、`specs/20-Spark-火花.md`:40、`specs/21-WorkCase 工单.md`:46、`specs/22-ADR-决策.md`:34、`specs/25-Goal-项目目标.md`:33（此四者各 1 处，指向同一目标）、`specs/32-记忆存取系统规范.md`:22/88/120（3 处，指向同一目标）、`README.md`:5（1 处）。另有 6 处实现注释同形（`plugin/lib/commit-validation.js`:10、`session-signature.js`:19、`spec-registry.js`:13、`index.js`:48/76、`spark-writer.js`:809）。可归因性：根因是删除动作与引用清理未同批——docs/ 被整体清空（Human 指示 2026-10-12），而引用方未同步改指。修了会更好的预期：这些引用的效力语义多为「只作设计输入，不取得规范效力」，故失效的主要是**可回查性**而非效力——读者按路径回查将得到空结果，且该形态无法自证是「本就不存在」还是「曾经存在但已删」。同一形态已由 09 §5.3 第 5 项（2026-10-12 新增）在新增侧阻断，但该检查明确不追溯存量，故本项仍待逐处处置。按 Human 指示「已有的之后逐步处理」，本笔只作存量登记，不主张立即修复。本笔为机械通道创建，仅陈述现象与实测证据；复述目标路径会使本账目自身成为一条新的失效引用（已实测被 09 §5.3 第 5 项拦下），故按引用方与行号登记而不复述目标路径。

补充观察（2026-10-14T04:47:38.421Z）：材料明确再次处理‘清空 docs/ 后存量引用失效’这一阻碍，并给出新增细节‘92dade2c 的真实挂空引用是规范 8 处 + 实现注释 6 处’，与既有账目 92dade2c（标题同为此阻碍）一致，构成本机制的再一次出现，故判 same-obstacle。材料的其余在飞项（拆分、提请关闭、execute 字段、S5–S12）也分别对应既有账目，未出现账本未记录的新阻碍。需如实说明：本次材料被截断（止于‘下一步只等你一句话：逐处批准 [spec-edit-proposal.md](scratch…），我只依据所见部分判断；计数与流转由机械层完成，本判断不自行计数。

补充观察（2026-10-19T04:16:02.618Z）：引证显示：Spark 对象 `spark-a1209317…md:30` 的 refs 指向 `docs/` 下三份来源文件，而 docs 目录已被整目录清空（`ec19ba6`），其下的 archive 子目录随之被删，导致该对象的来源指针悬空（原文只能从 git 历史取回）。这一机制与既有账目 uid=92dade2c-57a6-4ab2-9d3d-bf58a5c316df「清空 docs/ 后存量引用失效」是同一阻碍：同一次 docs 清空动作、同一后果（存量载体内的既有引用失效），只是本次落在一个新的受害载体（Spark 对象）上，故判 same-obstacle 而非新建。材料在 turn 1 助手回复中途被截断（末句停在「……按 20 号规范 §9.1，这是合法」），turn 2 仅有用户指令、助手尚未作答，故材料中另两处发现（summary「尚未过两道门」已过期、与 spark-e1a27426 阶段 4 验收判据不再对齐）未获完整观察，我不在本件对它们另立账目。

勘误（2026-10-19，执行会话 qoder-global/qfmodel）：上一段原稿把 docs 下 archive 子目录的完整路径字面写了出来，与本账「入账依据」自述的不复述目标路径口径冲突，且使本载体自身成为一条新的悬空引用——同形路径已实测被 09 §5.3 第 5 项拦下（提交预检 validation/docs_reference_dangling）。此处仅把该短语改为不复述形态；现象语义、occurrence 计数与 status 均不变，本勘误不计数。
