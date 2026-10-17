---
fact_type_key: workcase
object_uid: 0a0f01f9-cc7d-4c88-a66b-e4bde6773329
title: 闲时对象署执行体自身路由
status: closed
gist: 把闲时辅助机制落账对象的 change_log 署名从「主控会话路由」改为「实际做判断的子代理会话路由」，签名仍由 Code 从权威会话记录取得，并补上能区分两者的回归测试。
summary: 闲时辅助机制产出的摩擦与经验对象，其 change_log 署名当前取自主控会话路由，而非实际执行判断的子代理路由；本工单改为按子代理自身权威会话记录取署名。
scope: |-
  做什么：
  - 让闲时检查点的落地署名取自实际执行判断的子代理会话路由（摩擦与经验两条落地路径均在范围内）
  - 清退 sessionSignature 的死置形参：friction-discovery-provider.js 与 idle-checkpoint.js 中各有一处形参恒为 undefined，改为随 decision 承载并由落地侧读取
  - 补一条能区分「主控路由」与「子代理路由」的回归测试

  明确不做什么：
  - 不追溯修改既有对象的 change_log 署名
  - 不改 signature-channel 的品牌纪律与 AI 不得自填的规则
  - 不改会话身份通道（sessionId）与独立复核的独立性判定
  - 不改 specs/ 下的规范正文
plan:
  - step: 在摩擦发现执行体派发处取得子代理自身的权威路由，且不因迁出 finally 而泄漏句柄
    done_criteria: currentRouteValues 在 await run.result 之后、await run.dispose() 之前调用，取得的 provider/model 经 signature-channel 品牌化后随返回结果上抛。证据形态：①新增单测构造主控与子代理路由取不同值的场景，断言返回的 provider/model 等于子代理会话记录取值且不等于主控取值；②把该调用移到 dispose 之后的变体（测试内开关控制，注释标明仅用于反事实验证）须使该单测失败，失败记录以测试输出原文存档；③新增单测令 run.result 抛错，断言 run.dispose() 仍被调用（以 spy 断言调用次数≥1），证明迁出 finally 未引入句柄泄漏
  - step: 清退两处 sessionSignature 死置形参，并改摩擦与经验两条落地路径的署名来源
    done_criteria: ①friction-discovery-provider.js 的 discover 参数解构与 idle-checkpoint.js 的 runIdleCheckpoint 参数解构中均不再声明 sessionSignature（判据按参数解构位判定，不按全文匹配——JSDoc 等文档行不计入）；②lifecycle.js 第 640 行 landDiscoveryVerdict 与第 732 行 landCaptureVerdict 两处调用，其 sessionSignature 实参的来源均为子代理路由而非 lifecycle.js 第 617 行以主控 agent 取得的 route。证据形态：新增断言分别针对摩擦与经验两条路径，各验证写入对象的 change_log 的 provider/model 等于子代理取值；两条断言在旧实现下均失败，失败输出原文存档
  - step: 补回归测试以区分主控与子代理路由
    done_criteria: 新增用例中主控与子代理路由取不同值，断言写入对象的 change_log 记的是子代理值。证据形态：同一用例在旧实现（lifecycle.js 第 617 行以主控 agent 取路由）下运行失败、在新实现下通过，两次运行的测试输出原文一并存档
result:
  achieved_scope: 无——工单在 Gate 1 之前取消，未执行任何计划步骤
  residual: []
outcome: cancelled
created_at: 2026-10-17T02:52:15.934Z
change_log:
  - at: 2026-10-17T02:52:15.934Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 WorkCase 工单（draft，21 §14 C1 提案对象模式）
  - at: 2026-10-17T04:18:01.801Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 按 Human 裁定修订计划步骤 3：原「子代理路由不可得时 fail-closed」是把可控分支写成兜底，经实测 132 个子代理会话中 3 个无 routing 事件者均为 turn/end=blocked 且无任何 assistant 消息（即未产出判断），故「产出判断 ⇒ 必有路由」是成立的不变式；改为断言不变式并在其被破坏时停止报告（视同实现缺陷，而非正常降级路径）
  - at: 2026-10-17T04:24:23.214Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 按建前独立审核（needs_revision）修订：①步骤 3 原判据无证据形态，与步骤 1/2 同为一件，已删除并重排为三项，各判据补可回读证据形态；②正文「不存在没有署名的情况」降格为依赖 provider 的前提，如实登记 SubagentRun.localAgent 为可选、跨进程恒为 undefined，并声明该情形仍须署名（改走会话标识读取）；③写入 dispose 时序约束——取签名须在 run.dispose() 之前，并列为步骤 1 判据；④scope 禁区项内的「除非实测发现冲突」自设例外移出，改列可选顺带修缮目录并按 §14 增量审批；⑤补入 sessionSignature 形参死置问题的处置
  - at: 2026-10-17T04:26:50.890Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 按第二轮建前独立审核（needs_revision）修订：①补写 idle-checkpoint.js:89/258 死置形参的处置——scope 与计划步骤 2 一并覆盖两处死置点，消除「授权了却无步骤」；②改写步骤 2 判据为由「传入的 sessionSignature」改为「两处形参清退+署名随 decision 承载+落地侧读取」，消除判据与 scope 方向相反；③移除「允许的顺带修缮」标签（该标签应列类别且本事项属禁区走乙档，不宜占目录标签）；④为两条反事实判据补变体构造方式与失败记录存档形态
  - at: 2026-10-17T04:29:59.784Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 按第三轮建前独立审核（needs_revision，仅一处窄阻断）修订：①步骤 2 判据由「全文 grep 无 sessionSignature 残留」改为「按参数解构位判定，文档行不计入」，消除 JSDoc 契约行导致正确实现被判未达成的误判；②补入 lifecycle.js:640 与 :732 两条落地路径（摩擦 landDiscoveryVerdict／经验 landCaptureVerdict）须同步改取值来源，并各自设断言——否则经验积累对象仍记主控值；③步骤 1 补 run.result 抛错时 run.dispose() 仍须执行的判据，防迁出 finally 后句柄泄漏；④scope 首条补明「摩擦与经验两条落地路径均在范围内」
  - at: 2026-10-17T05:59:23.330Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: Human 裁定取消：并入当次直接实施（21 §6.3 低风险不对象化） [cancelled before execution; no Gate 1 approval existed]
---

# 闲时对象署执行体自身路由

## 摘要

闲时辅助机制产出的摩擦与经验对象，其 change_log 署名当前取自主控会话路由，而非实际执行判断的子代理路由；本工单改为按子代理自身权威会话记录取署名。

已实测：2026-10-16T06:17:11Z 那次派发，主控会话 `session-36dd0a0a` 路由为 `workbuddy/deepseek-v4.1-flash`，实际派出的子代理会话 `147acc26` 路由为 `ds-yue/deepseek-v4-flash`，而落账对象 `pitfall-2abbbc2f` 记的是主控值。另有 3 组同形对照。

代码位置：`plugin/lib/lifecycle.js` 第 617 行以主控 `agent` 调用 `currentRouteValues` 取路由，第 640、732 行把该路由包装成 `sessionSignature` 传入两个落地函数。

### 处置方向

不改签名通道的品牌纪律（provider/model 仍只能由 Code 取得，AI 与调用方不得指定）。改动集中在「取哪个会话」：`subagents.start` 返回的 run 带 `localAgent`，用它调用既有的 `currentRouteValues`，尾读子代理自己的会话记录，结果经 signature-channel 品牌化后随 decision 上抛，落地侧改用它。

### 两条落地路径（第三轮审核发现）

`lifecycle.js` 第 617 行只取一次主控 route，第 640 行供 `landDiscoveryVerdict`（摩擦）、第 732 行供 `landCaptureVerdict`（经验）共用。故仅清退形参不够——**两条落地调用的取值来源都须改**，否则经验积累对象的署名仍记主控值。该点已写入计划步骤 2 的判据 ②。

### 署名必然性及其前提（2026-10-17 建前审核修订）

会话记录层面：「**产出判断 ⇒ 该会话必有 routing 事件**」成立——实测 132 个子代理会话中，无 routing 事件的 3 个全部为 `turn/end reason=blocked` 且无任何 assistant 消息，即从未产出判断。

**取用通道层面依赖 provider 前提，不得表述为普遍不变式**：宿主的 `SubagentRun` 类型声明为 `localAgent: Agent | undefined`，跨进程 run 句柄显式返回 `void 0`（注释「localAgent is undefined for remote runs」）。当前 `selectZeroContextProvider` 只挑 `inheritsParentContext === false`，本部署实际命中 `subagent-spawn-in-process`，故可取得；但这是**运行时注册顺序的结果，不是接口保证**。若将来接入跨进程 provider，应改由子代理会话标识读取路由，而非从 `localAgent` 对象读取——该情形下仍须有署名，不构成「允许不署名」的理由。

### 时序与句柄（第一、三轮审核）

取签名须在 `run.dispose()` 之前，否则可能读到尚未落盘的会话而返回「no routing events」。同时，把读取迁出 `finally` 后，`run.result` 抛错路径仍须执行 `run.dispose()`，否则句柄泄漏——两项均已写入计划步骤 1 的判据。

### 死置形参（第二轮审核发现）

`idle-checkpoint.js` 第 89 行声明 `sessionSignature` 入参，而 `lifecycle.js` 第 520 行的 `runIdleCheckpoint` 调用从不传入它，故其经 `discover` 转到 `friction-discovery-provider.js` 第 115 行解构后恒为 undefined。两处形参均须清退，署名改随 decision 承载（计划步骤 2）。

### 边界

历史对象保持不变，不追溯修改既有 change_log。

## 授权范围

做什么：
- 让闲时检查点的落地署名取自实际执行判断的子代理会话路由（摩擦与经验两条落地路径均在范围内）
- 清退 sessionSignature 的死置形参：friction-discovery-provider.js 与 idle-checkpoint.js 中各有一处形参恒为 undefined，改为随 decision 承载并由落地侧读取
- 补一条能区分「主控路由」与「子代理路由」的回归测试

明确不做什么：
- 不追溯修改既有对象的 change_log 署名
- 不改 signature-channel 的品牌纪律与 AI 不得自填的规则
- 不改会话身份通道（sessionId）与独立复核的独立性判定
- 不改 specs/ 下的规范正文

## 计划

1. 在摩擦发现执行体派发处取得子代理自身的权威路由，且不因迁出 finally 而泄漏句柄
   - 完成判据：currentRouteValues 在 await run.result 之后、await run.dispose() 之前调用，取得的 provider/model 经 signature-channel 品牌化后随返回结果上抛。证据形态：①新增单测构造主控与子代理路由取不同值的场景，断言返回的 provider/model 等于子代理会话记录取值且不等于主控取值；②把该调用移到 dispose 之后的变体（测试内开关控制，注释标明仅用于反事实验证）须使该单测失败，失败记录以测试输出原文存档；③新增单测令 run.result 抛错，断言 run.dispose() 仍被调用（以 spy 断言调用次数≥1），证明迁出 finally 未引入句柄泄漏

2. 清退两处 sessionSignature 死置形参，并改摩擦与经验两条落地路径的署名来源
   - 完成判据：①friction-discovery-provider.js 的 discover 参数解构与 idle-checkpoint.js 的 runIdleCheckpoint 参数解构中均不再声明 sessionSignature（判据按参数解构位判定，不按全文匹配——JSDoc 等文档行不计入）；②lifecycle.js 第 640 行 landDiscoveryVerdict 与第 732 行 landCaptureVerdict 两处调用，其 sessionSignature 实参的来源均为子代理路由而非 lifecycle.js 第 617 行以主控 agent 取得的 route。证据形态：新增断言分别针对摩擦与经验两条路径，各验证写入对象的 change_log 的 provider/model 等于子代理取值；两条断言在旧实现下均失败，失败输出原文存档

3. 补回归测试以区分主控与子代理路由
   - 完成判据：新增用例中主控与子代理路由取不同值，断言写入对象的 change_log 记的是子代理值。证据形态：同一用例在旧实现（lifecycle.js 第 617 行以主控 agent 取路由）下运行失败、在新实现下通过，两次运行的测试输出原文一并存档

## 结果

- cancellation:
  - **理由**：经 Human 2026-10-17 裁定，本工单并入当次直接实施。改动为两处取值来源调整（执行体派发处取子代理路由、lifecycle 两条落地路径改用该路由）加一条回归测试，命中 21 §6.3「当次行动可直接处理且不需跨会话保留的低风险改动」，不满足对象化条件。
  - **未发生的范围**：本工单从未获 Gate 1 授权，未分配 attempt，未执行任何计划步骤；三轮建前独立审核的结论未落盘为 pre_reviews。审核中发现的三项技术约束（取签名须在 run.dispose() 之前、lifecycle 第 640/732 两条落地路径均须改、idle-checkpoint 死置形参）由当次实施直接落实，不再经本对象跟踪。

