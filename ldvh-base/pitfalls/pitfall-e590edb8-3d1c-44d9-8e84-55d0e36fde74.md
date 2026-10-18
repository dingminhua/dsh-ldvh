---
title: undefined 键覆盖落盘值致 execute 被判失配
status: active
scope: 该机制适用于受控写入（WorkCase execute）链路中所有可选字段的调用：调用方省略或以 undefined 传入的字段会被 writer 层按显式置空处理并与落盘值比对，凡依赖「省略＝不修改」语义的执行体均受影响；不适用于调用方显式携带新值的场景（该场景经回归测试确认仍被正确拒绝）。与 provider 无关，凡经 C2 闸受控写入的会话均可能触发。
object_uid: e590edb8-3d1c-44d9-8e84-55d0e36fde74
fact_type_key: pitfall
created_at: 2026-10-18T06:20:33.743Z
change_log:
  - at: 2026-10-18T06:20:33.743Z
    provider: xiaomi-token-plan-cn
    model: mimo-v2.6-flash
    summary: 闲时辅助经验积累（机械通道）于 2026-10-18T06:14:05.147Z 形成候选
  - at: 2026-10-18T19:07:57.007Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 登记独立复现验证结论（23 §16.1 第 3 项）：回退修复后回归测试重现 C2 失配拒绝，恢复后全通过
  - at: 2026-10-18T19:08:18.748Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 经 Human 决定入档（draft → active，23 §16 第 1 项）：前置独立复现验证已登记于验证段
---

# undefined 键覆盖落盘值致 execute 被判失配

## 症状
WorkCase 处于 open 期时，`action=execute` 受控写入调用被 C2 闸拒绝，报失配；载体原内容未被修改。另有一次伴生症状：调用中以 undefined 传入的字段覆盖了磁盘上已落盘的值，并被校验器当作显式置空，使失配比对进一步偏离调用方真实意图。

## 触发条件
WorkCase 对象处于 open 期，调用方发起 `action=execute` 受控写入时省略 `plan`、`scope` 等可选字段（即调用方意图「这些字段不变」）；writer 层将省略/undefined 归一化为显式空值后，与落盘值进行比对，触发 C2 闸失配拒绝。

## 根因
C2 闸的比对语义错误地建立在「调用方 payload 逐字段等于落盘值」之上，而非「仅比对调用方显式声明修改的字段」：省略字段在序列化/归一化环节被转成 undefined，undefined 键又覆盖了落盘值，校验器把 undefined 读作显式置空，于是「省略＝不修改」这一应然语义被实现成「省略＝置空」，与落盘值比对必然失配。

## 解决
修改 writer 层的入参归一化逻辑：丢弃 undefined 键，仅保留调用方显式携带的字段，使 C2 闸只比对显式声明的修改。同时将回归测试扩展为 3 条，覆盖「省略字段不再误拒」与「显式改 plan 仍被拒」两个方向，确认修复未放宽本应拦截的越权修改。全量测试 1594 项运行、1593 通过、0 失败。

## 规避
在 writer 层归一化修复落地前，open 期发起 execute 时应显式回传全部落盘字段的现值（而非省略），以通过 C2 闸的逐字段比对；但此为临时绕行，正规规避以 writer 层归一化修复为准——调用方不应被迫回传未修改字段。修复落地后无需再绕行，但仍应记住：凡 writer 层有归一化步骤，新增可选字段都要确认 undefined 与省略同义。

## 验证
**已观察（形成会话）**：writer 层归一化修复后，3 条回归测试（含「显式改 plan 仍被拒」）全部通过，全量测试 1594／1593 通过／0 失败；修复后本会话的 execute 受控写入成功落盘（执行期记录指纹 `ef0a8258…` 写入成功）。

**独立复现（2026-10-19，另一主体，对照重演）**：复现主体为未参与候选形成的独立会话主控，上下文隔离；采用同一模型，独立性边界为「上下文隔离、形成者与验证者非同一会话」。复现做法为重走该失败机制的可观察步骤——把 `plugin/lib/workcase-writer.js:2131` 的 `dropUndefinedKeys` 临时退化为恒等（即还原修复前的行为），再运行 `plugin/test/workcase-execute-inherit.test.mjs`。**观察结果**：回退后测试当场复现本条症状，`execute` 返回 `rejected`，`gaps` 为 `workcase/c2_fingerprint_invalidated: plan/scope are frozen while status=open — the C2 authorization fingerprint no longer matches`，与被声称的失配拒绝形态逐字一致；恢复修复后同文件 3 条测试全通过（pass 3 / fail 0）。此外核对了修复的封闭面：`stripCallerOnlyFieldsNormalized` 的调用方仅 WorkCase 链路，故本条自述「未验证其它受控写入动作」的实际风险面小于字面担忧。复现同时确认修复未放宽闸门——「显式改 plan 仍被拒」用例在修复后依然通过。

**未覆盖**：未在真实运行的 open 期工单上端到端重演一次 execute（复现在隔离临时工程内完成）；未验证多字段组合省略（同时省略两个及以上字段）的独立回归用例；未在其它 provider 通道的会话中重演。另：本候选形成时修复尚未提交（`dropUndefinedKeys` 在 `HEAD` 的 workcase-writer.js 中不存在，仅存在于工作区），该提交状态以入库时的实际差异为准。

**入档（2026-10-19）**：本候选经 Human 决定入档（23 §16 第 1 项 Human Gate），前置的另一主体复现验证见上段；入档不改动本条的机制判断。

## 影响与适用范围
该机制适用于受控写入（WorkCase execute）链路中所有可选字段的调用：调用方省略或以 undefined 传入的字段会被 writer 层按显式置空处理并与落盘值比对，凡依赖「省略＝不修改」语义的执行体均受影响；不适用于调用方显式携带新值的场景（该场景经回归测试确认仍被正确拒绝）。与 provider 无关，凡经 C2 闸受控写入的会话均可能触发。
