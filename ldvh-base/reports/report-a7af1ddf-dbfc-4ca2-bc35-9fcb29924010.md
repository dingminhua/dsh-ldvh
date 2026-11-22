---
title: 经验与摩擦代理分工新定义修正的实现核对
status: active
research_purpose: 承载 spark-04a960dd 方向线调查问题的收敛结论：新定义已在运行时机制与代码侧落盘并经机械验证，供后续跨行动引用与复核
stopping_reason: no-gain
confirmed_statements: []
gaps:
  - description: 本轮未重做真实 UI 验收（/ldvh 路由与 /ldvh/api/health），只跑 ci/test/pack；按开发规范红线 3，单元测试通过不替代 UI 验收
    priority: medium
  - description: 19 项环境依赖 skip 未逐条补跑
    priority: low
  - description: 同批的 spark-e2e361e5 在本报告撰写时为 open，已于 2026-11-23T07:22:13+08:00 由并发会话提交 fc6ca74a 转入 implemented；两条火花的终态处置均由该并发会话完成，不是本轮写入
    priority: low
object_uid: a7af1ddf-dbfc-4ca2-bc35-9fcb29924010
fact_type_key: report
created_at: 2026-11-22T23:25:46.069Z
change_log:
  - at: 2026-11-22T23:25:46.069Z
    provider: dsh-opencode-go
    model: hy4-flash-free
    summary: 核对 spark-04a960dd：新定义已落盘并经机械验证通过，固化结论供跨行动引用
  - at: 2026-11-22T23:27:08.129Z
    provider: dsh-opencode-go
    model: hy4-flash-free
    summary: 补充并发会话已把两条火花转入 implemented 的事实，修正报告中 e2e361e5 仍为 open 的过时表述
report_form: summary
---

## 范围与目的

本轮核验方向线 spark-04a960dd「经验与摩擦两类辅助记录中，代理的职责边界与落笔权应如何按 Human 新定义修正」。调查边界限于 pitfall-fact-type、friction-settlement-system-foundation 两份运行时机制与 guidance-text.js 的经验主动记录引导行；不动三处请示机制本身，不动事实对象字段模型与写入器实现。

结论性质：该方向线所问的新定义在 2026-11-23 的提交中已落盘实现，本轮是对已实现状态的复核与结论固化，不是新设计。火花正文里写的「现行定义＝代理只起草、主控写入」已过时。

来源：commit（c6d7406b3fd5cdfdd7c0f82a6c4b36db7c5bdd7f）

## 工作与结论

三处载体与代码侧现状一致，均已是「代理落笔、回执主控、主控转告」的新定义：

- 经验侧：pitfall-fact-type 的 entry-channels／delegate-draft／cross-type-pairing 已把主控主动记录通道改为执行体经统一受控入口落笔、写后回读、回执主控；主控只交材料、收回执、转告 Human，不重复读回。授权边界为单个子会话、有界、只 create。配对边仍单侧记在摩擦侧，经验侧以主控交出的摩擦投影为核对依据。
- 摩擦侧：friction-settlement-system-foundation 的 discovery-trigger 已补「代理落笔后回执主控→转告 Human」；发现段当场派生、写观察、达阈值晋升、补充级更新与写后回读在代理一次派发内完成，落笔权本就不在主控。
- 引导行：guidance-text.js 第 100 行经验主动记录行已对齐新定义。
- 代码侧：review-ask-tool.js 的 point 闭集已接纳 research 并委托 research-consult（三处请示统一入口）；pitfall-tools.js 的 delegated caller 只允许 create，授权失败按 fail-closed 回执交还主控转告 Human。

机械验证：npm --prefix plugin ci 退出 0；npm --prefix plugin test 2613 项 / 2594 通过 / 0 失败 / 19 skip；plugin 目录 npm pack --dry-run 退出 0（214 文件）。

来源：commit（c6d7406b3fd5cdfdd7c0f82a6c4b36db7c5bdd7f）

结论边界：本轮是主控自查＋机械验证，未安排独立代理复核；「实现已落盘且测试通过」不等于规范语义绝对正确，也不证明功能在真实 UI 中可用。方向线 spark-04a960dd 在本轮核验期间由并发会话提交 fc6ca74a（2026-11-23T07:22:13+08:00）转入 implemented，同批的 spark-e2e361e5 一并转入；该终态写入不是本轮执行，本报告只作复核与结论固化。

来源：commit（fc6ca74a28e0ba039f5a3eb9e9811c4d3995f402）

## 证据摘录

pitfall-fact-type.yaml entry-channels 原文：

> 主控主动记录：主控在当次行动中发现一条已查明验证的失败机制时，整理该发现所需的上下文材料并交出，
> 派生一个以该材料为输入的代理辅助任务执行体；该执行体经统一受控入口落笔并写后精确回读，
> 把落笔结果回执主控，由主控转告 Human。主控只交出材料、接收回执、转告 Human，不重复读回对象。

来源：commit（c6d7406b3fd5cdfdd7c0f82a6c4b36db7c5bdd7f）

pitfall-fact-type.yaml delegate-draft 原文：

> 执行体据主控交出的材料判断并成文，经本类型统一受控入口落笔，写后回读由该入口机械执行；
> 落笔结果（含回读结论）由执行体回执主控，主控据回执转告 Human，不重复读回对象。

来源：commit（c6d7406b3fd5cdfdd7c0f82a6c4b36db7c5bdd7f）

friction-settlement-system-foundation.yaml discovery-trigger 原文：

> 发起不等于做完：完成证据只有执行体的返回值与写后回读。执行体完成落笔后把结果回执主控，由主控转告 Human；
> 主控只交出材料、接收回执、转告 Human，不重复读回对象。

来源：commit（c6d7406b3fd5cdfdd7c0f82a6c4b36db7c5bdd7f）

guidance-text.js 经验主动记录行原文：

> 执行体经统一受控入口落笔并写后回读、把结果回执主控，主控转告 Human、不重复读回（delegate-draft、entry-channels）。
> 摩擦的发现同形，由主控当场发起、交代理落笔并回执（friction-settlement-system-foundation 的 discovery-trigger、discovery-context、discovery-closed-set）。

来源：commit（4fd8ccd8dff5918e1d6f98a9f2ea97ed654bcc0a）

跨载体引用致语料校验失败的修复与经验记录（经验对象 pitfall-a242ac81）：

> 把两处括号指针删掉、改为自足表述，规则语义原样保留，修复语料校验 2 error。

来源：commit（dcfca02f5e8d95fb5f84bfe2f734e2b28c31a793）

来源：commit（d38926c322f4628132d268799b256098aea751d4）

机械验证读数：

> ℹ tests 2613 / ℹ pass 2594 / ℹ fail 0 / ℹ skipped 19 / ℹ duration_ms 114558

来源：run-record（本轮 npm --prefix plugin test，2026-11-23）

## 遗留与下一步

真实 UI 验收两项本轮未做，按开发规范红线 3 不得据此声明支持当前宿主；19 项环境依赖 skip 未逐条补跑，记为未覆盖。同批的 spark-e2e361e5 与 spark-04a960dd 已在 2026-11-23T07:22:13+08:00 由并发会话提交 fc6ca74a 一并转入 implemented，本轮不重复处置。

新定义已在运行时机制、引导行与代码三处对照一致且机械验证通过；本方向线的直接工作已落实，后续由 Human 决定是否安排独立代理复核作为补充。

来源：commit（c6d7406b3fd5cdfdd7c0f82a6c4b36db7c5bdd7f）
