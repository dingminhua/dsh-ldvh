---
title: 三处请示接口统一与经验摩擦修正实施方案
status: implemented
question: 三处请示如何统一接口、经验与摩擦的代理职责如何按新定义修正并落实？
scope_boundary: 限于把关请示工具契约（ldvh_review_ask／ldvh_research_consult）、pitfall-fact-type 与 friction-settlement-system-foundation 的代理职责条目、guidance-text.js 相关引导行；不改事实对象字段模型、写入器实现与三处请示的规范声明范围。
intent: Human 2026-11-23 定 U1（三处统一入口）+A（保守改法），并特别指出经验与摩擦具体操作不同、须分别了解。本 Spark 记实施方案并供检查；与 spark-04a960dd（新定义方向线）分工。
summary: 已定 U1+A。实测：review-ask 仅 pre/post、第三处走独立 research-consult；代码 REVIEW_ASK_POINTS.RESEARCH 已定义未接通。关键新发现：经验侧代码已支持 arm-delegate 代理自行落笔（与 delegate-draft「只起草」文本冲突），摩擦侧代理本就写观察并晋升——两侧落笔现状不同，A 须分别写。待更新方案后落实。
serves: a415bbd4-ee4b-43e1-9bb0-0c4e8761c188
disposition: U1+A 方案已由 c6d7406b／4fd8ccd8／dcfca02f／d38926c3 四笔 commit 落实：三处请示统一入口、经验与摩擦分别按代理落笔回执新定义修正；plugin 测试 2594 通过 0 失败。未改字段模型、写入器核心、Human Gate 与机械校验。
object_uid: e2e361e5-c5da-45a4-bf32-958ca68cc9ee
fact_type_key: spark
created_at: 2026-11-22T22:15:26.919Z
change_log:
  - at: 2026-11-22T22:15:26.919Z
    provider: dsh-opencode-go
    model: hy4-flash-free
    summary: 实施方案出生：供 Human 检查接口统一与经验摩擦修正的改法
  - at: 2026-11-22T22:18:30.359Z
    provider: dsh-opencode-go
    model: hy4-flash-free
    summary: 确认 U1+A 并补记经验/摩擦两侧落笔机制差异
  - at: 2026-11-22T23:20:38.410Z
    provider: dsh-opencode-go
    model: hy4-flash-free
    summary: 方案 U1+A 已由 c6d7406b 等四个 commit 落实并测试通过，转入终态 implemented
---

# 三处请示接口统一与经验摩擦修正实施方案

## 当前理解

**决策**：Human 2026-11-23 定 U1（三处请示统一入口）＋ A（保守改法）。Human 强调经验与摩擦具体操作不同，须分别处理。

**实测事实**（真实工具调用）：`ldvh_review_ask` 的 `point` 只接受 pre-action／post-work，传 research 直接报 invalid；第三处真实入口是独立 `ldvh_research_consult`（need/keywords/scope/purpose/sub_questions，先查内部、命中即返回不提请）。代码 `REVIEW_ASK_POINTS.RESEARCH` 常量已定义但 schema 未接纳——半成品。

**代码能力核实**（本轮 grep）：
- 经验侧：写入器已支持 delegated caller 自行 `create`（`ldvh_pitfall_arm_delegate` 授权一个子会话新建经验，带 purpose 授权记录、字段闭集、写后回读；delegated caller 只能 create，update/终态拒绝）。`pitfall-fact-type` 的 `delegate-draft` 正文却写「代理只起草、不写入」，与代码不一致。
- 摩擦侧：代理（发现段）本就落笔——`ldvh_friction_record_observation` 的描述是 "as the delegate of a main controller"，写观察缓冲、达阈值晋升新账、补充级更新、写后回读全在代理一次派发内完成（`discovery-closed-set`）。

**两侧落笔现状差异**（Human 提醒的重点）：
- 经验：现行规范＝代理起草、主控受控写入；代码＝已可代理直接落笔（arm-delegate）。改法 A 要把规范对齐到「代理经受控入口落笔＋回执」，写后回读与 Human Gate 留在工具层。
- 摩擦：现行规范与代码都已是代理落笔（观察/晋升/补充）。改法 A 主要是确认「回执主控→转告 Human」这条链，并核对是否需调整措辞；不是把落笔权从主控搬走（本来就不在主控）。

**A 方案分别写**：经验侧改 `pitfall-fact-type`（entry-channels／delegate-draft／context-supply）＋ guidance-text.js 引导行；摩擦侧改 `friction-settlement-system-foundation`（discovery-trigger／discovery-closed-set 的回执表述）＋ 核对 guidance 行。两侧都不动写入器实现、不动 Human Gate、不动机械校验。

## 调查问题

三处请示如何统一接口、经验与摩擦的代理职责如何按新定义修正并落实？

## 调查边界

限于把关请示工具契约、pitfall-fact-type 与 friction-settlement-system-foundation 的代理职责条目、guidance-text.js 引导行；不改事实对象字段模型、写入器实现与请示规范声明范围。走受保护内容程序后才落实。
