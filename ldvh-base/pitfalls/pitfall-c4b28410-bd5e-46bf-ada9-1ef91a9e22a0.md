---
title: 子代理审核因 provider 超时连续零产出
status: active
scope: 适用于任何依赖派生独立审核/复核子代理取得结论的场合，跨 provider 与跨模型均可发生；材料截断，仅就 turn 6–21 所见部分判断。
object_uid: c4b28410-bd5e-46bf-ada9-1ef91a9e22a0
fact_type_key: pitfall
created_at: 2026-10-16T16:42:27.803Z
change_log:
  - at: 2026-10-16T16:42:27.803Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 闲时辅助经验积累（机械通道）于 2026-10-16T16:42:15.368Z 形成候选
  - at: 2026-10-17T07:43:01.675Z
    provider: qoder
    model: qfmodel
    summary: 登记独立复现验证结论（23 §16.1 第 3 项）并按 Human 2026-10-17「情况属实就转正」入档（draft→active）：证据链核对逐字成立——subagent/catalog 时序、三次 turn/end=TIMEOUT 零结论、ds-yue 与 maxRetries:5、inputTokens/outputTokens 均 0、主控误判改两轮的自述、第四次换 provider 返回 G1–G5 完整结论。同次核对取得两处精确性修正（turn 窗口应为 16–21；失败形态含 TRANSPORT 与 TIMEOUT 两类），机制语义、根因、解决、规避与 scope 均未改动。
---

# 子代理审核因 provider 超时连续零产出

## 症状
为同一方案连续派生三次建前独立审核子代理，三次均以 error 结束、未留下任何结论；主控在不知原因的情况下先后改了两轮方案（切小任务、摘录证据文件），第三次仍失败。改 provider 重派第四次后，审核体正常返回完整结论。

## 触发条件
需要就一份跨多份载体的规范条文候选取得独立审核结论，且审核体被要求读取较大源文件时。

## 根因
失败与任务内容、输入体积无关，根因是 provider `ds-yue` 的请求超时：`Request timed out.` (code: TIMEOUT)，重试到第 5 次（maxRetries: 5）后放弃，turn 以 error 结束；provider 侧 inputTokens/outputTokens 均为 0，说明请求根本没有成功发出。主控先前把该基础设施故障误判为「任务过载」「文件太大」，据此调整方案属猜测补事实。

## 解决
在同一个 provider 上停止重试（不再尝试第四次），先查询当前可用 provider，换 provider 后以同一任务书重派审核体；本次换了 provider 后审核体一次性返回完整结论（含逐项判定、4 项必改项与一处最强反驳）。

## 规避
子代理零产出连续出现两次以上时，先查该子代理会话的 provider 与错误码，再判断是否属输入或任务设计问题；在根因查明前不据猜测连续改动任务输入形态。subagent 工具本身不暴露 provider 参数，需借助 workflow 的 agent() 或其它途径指定执行路径。

## 验证
已观察：换 provider 后重派，子代理返回了带 G1–G5 逐项判定表、必改项与不确定处说明的完整审核结论，并被主控据以修订候选。已覆盖：单次 provider 超时后的换 provider 重派路径。未覆盖：并发多子代理同时超时时的表现、provider 持续不可用时的降级路径、以及失败轮次的日志留存与自动告警——本次未见任何机械通道自动提示失败，仍需主控自行察觉并报告。

**独立复现验证结论（2026-10-17，23 §16.1）**：复现主体为本会话主控（session-39edc51b）与另派的只读取证隔离子代理（agent 921408c8），二者均未参与本候选形成，上下文互相隔离；独立性边界：同一底层模型、仅上下文隔离，未做跨模型验证。本类失败的根因属外部基础设施故障、不可主动重走，故按 §16.1 走「核对原始证据链」一路。逐条核实：① **派生时序成立**——形成会话 session-62501037 的 `subagent/catalog` 事件按 createdAt 单调排列出「独立审核候选草案 fcbbd451 → 重派独立审核 c1fe58e5 → 第三次独立审核 d7bdf32f → …→ 第四次独立审核 b7d01ac1」；② **三次以 error 结束且零结论**——fcbbd451／c1fe58e5／d7bdf32f 三个子会话的 `turn/end` 逐字为 `{"kind":"error","error":{"message":"Request timed out.","code":"TIMEOUT"}}`，三者均无任何 assistant 结论块；③ **provider 与重试数成立**——三个子会话的 `llm/retry` 事件逐字含 `"provider":"ds-yue"`、`"retry":5,"maxRetries":5`、`"failure":{"message":"Request timed out.","code":"TIMEOUT"}`；④ **token 为 0 成立**——失败请求的 usage chunk 逐字 `"usage":{"inputTokens":0,"outputTokens":0,"totalTokens":0}`；⑤ **误判与两轮改方案成立**——主控 turn 17 逐字写「不是文件太大，是 provider 请求超时」「我把基础设施故障误判为任务设计问题，并据此改了两次方案——这是猜测补事实」，且第三次审核体提示语逐字含「极其重要的读取纪律（前两次审核体都在这里失败）」「绝对不要去读 specs/21 原文件」；⑥ **换 provider 后一次成功成立**——b7d01ac1 的 descriptor 为 `agentProvider:"workbuddy", agentModel:"space-bunny"`（前三次走 ds-yue），`turn/end` 为 `completed`，结论含「## 1. 问题陈述核对（G1–G5）」逐项判定表、四项必改项与「## 5. 最强反驳」一节。**复现中取得两处修正（如实登记，不改机制语义）**：其一，候选 scope 与验证段所称「材料截断、仅就 turn 6–21 所见部分判断」不精确——三次 error 的派生与第四次成功落在主控 **turn 16–18**，规范源逐处编辑集中在 turn 21；turn 下界 6 无对应证据，原表述作为「材料窗口」不致与事实冲突，但据此复用时应以 16–21 为准。其二，候选根因称失败均为 TIMEOUT，实测 c1fe58e5 的一个会话内**混有 `Connection error.` (code: TRANSPORT)** 共 12 次失败尝试（TIMEOUT 与 TRANSPORT 两类），fcbbd451／d7bdf32f 则为纯 TIMEOUT；故「基础设施故障（超时或传输错误）导致零产出」成立，「单一 TIMEOUT 形态」是过度精确。未覆盖：本次仍只核到既有材料，未制造新的 provider 超时现场，「并发多子代理同时超时」「provider 持续不可用的降级路径」仍无观察。

## 影响与适用范围
适用于任何依赖派生独立审核/复核子代理取得结论的场合，跨 provider 与跨模型均可发生；材料截断，仅就 turn 6–21 所见部分判断。
