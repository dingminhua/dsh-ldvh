---
title: 受控写入拒绝留痕与聚合
status: discarded
question: 受控写入被机械拒绝时，应如何留下可累积的记录，使「同一类错误反复发生」能被系统发现而非靠 Human 发现？
scope_boundary: 已终止：「既有聚合被某个执行体实际消费、并据此产出摩擦判断」不再追求，Human 决定接受现状。
intent: 保留理由：主控在受控写入上的错误（漏移 priority、summary 未逐字、块首标签形态错、编造字段名、错引条文号）目前被拒绝即消失——同一类错犯五次与犯一次在系统里完全同形，无法累积成摩擦账、也不会浮出给 Human。这是「机制看不见自身失效」的缺口，且与 11 §9 摩擦发现链路是互补关系而非重复。后续方向：先定拒绝记录载体（关键约束：不得与 readTimerEvidence 竞争 runlog 的 50 条环形窗口），再定与 11 §9 的接法（机械只产材料、语义判断据材料入缓冲），最后落 WorkCase 实施。
summary: 受控写入被机械拒绝时已有按原因码跨会话累积的机制（runtimeDiagnostics.ts 的 byTool／byCategory／byCode 三层聚合），故「拒绝返回即消失」这一前提不成立；真正的缺口是这份既有聚合没有进入 11 §9 的语义判定面——机械材料已可见，但没有任何执行体被要求读它。要补的是「把聚合作为输入材料交付给摩擦发现的执行体」，而这属 11 §7.1 交付面扩张（规范修订），不是新建载体。三项实现约束不变：① 11 §9 缓冲写入者被穷举，受控写入路径不在其列；② anchor/evidence/title/basis/attribution 须语义判断，机械拿不到；③ group 由语义判定得出、机械层只做相等比较。
disposition: 接受现状：诊断页修好后（多帧 zstd 缺陷已修，byCode 表可直接回答「哪条规则最常拦人」），人类判读即可；再让 AI 读这份聚合自判「算不算摩擦」多一层自动判断，未必更好。不推进 11 §7.1 交付面扩张。
object_uid: ebae02de-fcc7-42ac-ad3d-d5298e627002
fact_type_key: spark
created_at: 2026-11-04T13:53:27.930Z
change_log:
  - at: 2026-11-04T13:53:27.930Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Spark 对象
  - at: 2026-11-04T14:19:46.911Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 建前审核推翻原假设：累积机制已存在（runtimeDiagnostics 的 byCode 三层聚合），toolDescriptor 非唯一包装点，outcome 六值不可混作被拒绝。缺口从「补记录」改为「补 11 §7.1 交付面」。
  - at: 2026-11-04T14:43:31.182Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: Human 裁定接受现状、不补 11 §7.1 交付面；本 Spark 转 discarded，并记录建前审核推翻原假设的三条事实更正。
  - at: 2026-11-10T11:06:12.237Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补 recall_digest：为召回提供高密度关键词面（02 §7.1）
---

# 受控写入拒绝留痕与聚合

## 当前理解

受控写入被机械拒绝时已有按原因码跨会话累积的机制（runtimeDiagnostics.ts 的 byTool／byCategory／byCode 三层聚合），故「拒绝返回即消失」这一前提不成立；真正的缺口是这份既有聚合没有进入 11 §9 的语义判定面——机械材料已可见，但没有任何执行体被要求读它。要补的是「把聚合作为输入材料交付给摩擦发现的执行体」，而这属 11 §7.1 交付面扩张（规范修订），不是新建载体。三项实现约束不变：① 11 §9 缓冲写入者被穷举，受控写入路径不在其列；② anchor/evidence/title/basis/attribution 须语义判断，机械拿不到；③ group 由语义判定得出、机械层只做相等比较。

### 2026-11-04 Human 决定：接受现状，本方向关闭

Human 裁定：**不补 `11 §7.1` 的交付面扩张**，接受现状。理由（Human 与我的一致判断）：诊断页修好之后，「哪条规则最常拦人」这个问题已经能用 `byCode` 表直接回答，人肉看即可；再让 AI 自己去读这张表判「这算不算摩擦」，多一层自动判断未必比人工看更好，反而多一个可能判错的地方。

按 `20 §9.1`，本 Spark 的信息需求已落实（「怎么让反复错误被系统发现」这一问题已有答案：先修可见性，再人肉判读，不引入第二层自动判断），故转 `discarded` —— 明确决定该方向不再继续跟踪。日后若「诊断页的 byCode 已经不够用」出现具体证据，须按 `20` 号准入**另立 Spark**，不得回填本条。

### 2026-11-04 建前审核推翻了原假设（过程留痕，照录不改）

`workcase-017721d5` 建前独立审核三维全「不符」，主控逐条复核原文属实后取消该单。三条事实更正：

**(1) 「`toolDescriptor` 是唯一包装点」为假。** `plugin/lib/ldvh-tools.js:1845` 的 `toolDescriptor` 只被本文件 `:1938` 的循环调用，遍历 `OPERATIONS` 的 12 项。十个类型模块**各自** `export function toolDescriptorFor` 并在各自 `registerXxxTools` 内注册：`workcase-tools.js:1616`、`spark-tools.js:869`、`friction-tools.js:617`、`adr-tools.js:582`、`devlog-tools.js:638`、`goal-tools.js:307`、`norm-tools.js:558`、`pitfall-tools.js:486`、`research-tools.js:1052`、`subgoal-tools.js:659`；另有 `subagent-result.js:107` 内联。**全仓无任何模块 import 那个 `toolDescriptor`**。

**(2) `outcome` 非 `completed` ≠ 被拒绝。** `05 §8` 六值闭集：`unavailable`（前提不足）、`invalid_request`（形状不可解析、零副作用）、`rejected`（输入足够但被机械拒绝）、`partial`、`execution_error`。**只有 `rejected` 是真拒绝**。把四类混作一账会造出假摩擦。

**(3) 累积机制已存在。** `plugin/web/api/services/runtimeDiagnostics.ts` 的 `extractToolOutcomes` 从宿主会话日志抽出 `tool` + `status` + 命名空间错误码，聚合段产出 `totals`／`byTool`／`byCategory`／`byCode` 四层，**跨会话累积**。原工单引用的 604/166/16/10 正是该报告的输出。

### 五项载体与方案约束（过程结论，照录不改）

1. **不得写 11 §9 的摩擦观察缓冲**：`11` §12bis.1 写入者被穷举为两个。
2. **不得产出 `group`／`attribution`／`title`／`basis`**：`11` 明写为执行体的语义判断产物。
3. **不得挤进 runlog**：`~/.dsh/ldvh/idle-checkpoint-runs.json` 是 50 条固定容量环形，实测 50 条中 49 条为诊断记录；`lifecycle.js` 的 `readTimerEvidence` 依赖它。
4. **新载体受 `02 §6.1` 第 2 条约束**：中间载体须由某规范指明唯一消费者。
5. **写入须 fail-open**：落在工具 `execute` 的同一 `try` 内若抛错，会把 `completed` 翻成 `execution_error`。

## 调查问题

受控写入被机械拒绝时，应如何留下可累积的记录，使「同一类错误反复发生」能被系统发现而非靠 Human 发现？

（2026-11-04 结论：问题前半已有答案——记录与累积都已存在；后半经 Human 裁定不走自动判断，接受现状。）

## 调查边界

已终止：「既有聚合被某个执行体实际消费、并据此产出摩擦判断」不再追求，Human 决定接受现状。

（2026-11-04 结案：Human 裁定不推进该方向，本条在此终止。）
