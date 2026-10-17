---
title: 子代理审核因 provider 超时连续零产出
status: draft
scope: 适用于任何依赖派生独立审核/复核子代理取得结论的场合，跨 provider 与跨模型均可发生；材料截断，仅就 turn 6–21 所见部分判断。
object_uid: c4b28410-bd5e-46bf-ada9-1ef91a9e22a0
fact_type_key: pitfall
created_at: 2026-10-16T16:42:27.803Z
change_log:
  - at: 2026-10-16T16:42:27.803Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 闲时辅助经验积累（机械通道）于 2026-10-16T16:42:15.368Z 形成候选
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

## 影响与适用范围
适用于任何依赖派生独立审核/复核子代理取得结论的场合，跨 provider 与跨模型均可发生；材料截断，仅就 turn 6–21 所见部分判断。
