---
title: 新事实类型候选准入
status: open
question: 新事实类型候选（Practice/实践规范、项目文档等）是否准入，以及 mnemon 三层记忆如何承载？
scope_boundary: 各候选按 `03 §5.2` 六问逐项判定并呈 Human 决定；与既有 27 号 Norm 类型的重叠核对完成后停止。
intent: 保留理由——含**未定案的新事实类型候选**（Practice/实践规范、项目文档/笔记）与两条待准入纪律（设计文档不对象化、禁止藏规则）；按 03 §5.2 六问逐项判定属 Human Gate 事项，不保留则候选方向与行业对照全部丢失。
summary: |-
  **来源**：`technical-framework-mnemon-base.md` §2.4「终局目标：装了 LDVH 就不用装 mnemon」，§8「新事实对象讨论（已启动，2026-09-03）」自述「**未定案，按 03 §5.2 准入六问逐项判**」；§8.1「补充议题：事实源的『人能看』承诺与规范类文档（Human 提出 2026-09-03）」。

  **议题 1 · mnemon 三层记忆的对应承载形态**（候选方向，未定案）：Runtime 热记忆（USER.md/MEMORY.md）→ 不一定是事实对象，可能只是插件自管的注入层或五类之外的轻量载体，关键问题＝与 DSH 宿主 runtime memory 的边界（重复还是增强？写入是否也受控？）；Documents（项目文档）→ 可能是新事实类型（「项目文档/笔记」）也可能归入 Research/Spark 扩展，关键问题＝与 Research 的边界（Research 是研究报告，项目文档是工作记录——分开还是合并？）；Memory Spaces（长期知识）→ 可能根本不需要对象化，关键问题＝LDVH 是否要「跨项目记忆」，与 07 单项目工作对象边界如何调和。

  **议题 2 · 「人能看」承诺与规范类文档**：两类新内容冲击「事实源人能看」承诺——① code/web 设计文档（人不看，消费对象是 AI）；② 规范类文档（审计/测试/发布规范，人要看且「像规范又像 ADR」）。**建议（未定案，准入属 Human Gate）**：① 设计文档**不对象化**，保持 docs/ 现状，立纪律「**设计文档禁止藏规则**」，约束性内容必须上浮为 ADR 或规范（docs/ 是解释不是约束）；② **规范类文档立新类型（暂名 Practice/实践规范）**，与 ADR 按行业「决定与规则分离」共识分工——ADR 记「为什么」（决定+理由+适用范围，决策时刻快照，改决策=新 ADR 替代），Practice 记「怎么做」（检查清单/步骤/标准，长期演化，change_log 承载修订）；互引（ADR consequences 指向 Practice；Practice change_log 首条回指 ADR）。**行业对照**：ADR 运动决定/规则分离、IETF BCP 系列、Diátaxis 四象限、Policy-as-Code、开源根目录惯例。

  **注意**：`specs/27-Norm-事实规范.md` 已存在（Norm 类型已立项并定稿），与本文档 2026-09-03 提出的 Practice 候选**是否同一物的不同命名或不同设计**，须核对——这是本 Spark 的首要查重点。**讨论原则（Human 定）**：以「满足什么问题」为准入唯一依据；mnemon 的形态是参照不是模板；任何新类型在 20–24 重建之后按同节奏起草规范（编号待分配，可能 25+）。
serves: SG-1
priority: P2
object_uid: 56a5ed45-a7cb-4c2f-b2ad-e766a49338d3
fact_type_key: spark
created_at: 2026-09-12T22:06:03.166Z
change_log:
  - at: 2026-09-12T22:06:03.166Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Spark 对象
  - at: 2026-09-13T15:08:54.022Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 回填 priority=P2（20 §8 新增字段，Human 裁定 A；AI 出初值，Human 可随时调整）
---

# 新事实类型候选准入

## 当前理解

**来源**：`technical-framework-mnemon-base.md` §2.4「终局目标：装了 LDVH 就不用装 mnemon」，§8「新事实对象讨论（已启动，2026-09-03）」自述「**未定案，按 03 §5.2 准入六问逐项判**」；§8.1「补充议题：事实源的『人能看』承诺与规范类文档（Human 提出 2026-09-03）」。

**议题 1 · mnemon 三层记忆的对应承载形态**（候选方向，未定案）：Runtime 热记忆（USER.md/MEMORY.md）→ 不一定是事实对象，可能只是插件自管的注入层或五类之外的轻量载体，关键问题＝与 DSH 宿主 runtime memory 的边界（重复还是增强？写入是否也受控？）；Documents（项目文档）→ 可能是新事实类型（「项目文档/笔记」）也可能归入 Research/Spark 扩展，关键问题＝与 Research 的边界（Research 是研究报告，项目文档是工作记录——分开还是合并？）；Memory Spaces（长期知识）→ 可能根本不需要对象化，关键问题＝LDVH 是否要「跨项目记忆」，与 07 单项目工作对象边界如何调和。

**议题 2 · 「人能看」承诺与规范类文档**：两类新内容冲击「事实源人能看」承诺——① code/web 设计文档（人不看，消费对象是 AI）；② 规范类文档（审计/测试/发布规范，人要看且「像规范又像 ADR」）。**建议（未定案，准入属 Human Gate）**：① 设计文档**不对象化**，保持 docs/ 现状，立纪律「**设计文档禁止藏规则**」，约束性内容必须上浮为 ADR 或规范（docs/ 是解释不是约束）；② **规范类文档立新类型（暂名 Practice/实践规范）**，与 ADR 按行业「决定与规则分离」共识分工——ADR 记「为什么」（决定+理由+适用范围，决策时刻快照，改决策=新 ADR 替代），Practice 记「怎么做」（检查清单/步骤/标准，长期演化，change_log 承载修订）；互引（ADR consequences 指向 Practice；Practice change_log 首条回指 ADR）。**行业对照**：ADR 运动决定/规则分离、IETF BCP 系列、Diátaxis 四象限、Policy-as-Code、开源根目录惯例。

**注意**：`specs/27-Norm-事实规范.md` 已存在（Norm 类型已立项并定稿），与本文档 2026-09-03 提出的 Practice 候选**是否同一物的不同命名或不同设计**，须核对——这是本 Spark 的首要查重点。**讨论原则（Human 定）**：以「满足什么问题」为准入唯一依据；mnemon 的形态是参照不是模板；任何新类型在 20–24 重建之后按同节奏起草规范（编号待分配，可能 25+）。

## 调查问题

新事实类型候选（Practice/实践规范、项目文档等）是否准入，以及 mnemon 三层记忆如何承载？

## 调查边界

各候选按 `03 §5.2` 六问逐项判定并呈 Human 决定；与既有 27 号 Norm 类型的重叠核对完成后停止。
