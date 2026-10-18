---
title: 提交消息格式凭惯例拼装致预检失败
status: discarded
scope: 仅适用于经 LDVH 预检与 Git Gate 的受控提交场景，限于 provider/model trailer 与消息字段构成，不涉及提交内容本身的正确性或其他门禁类型。
disposition: 根因段「预检不指出缺口」经核实为假（commit-validation.js:114/118 逐项报缺），引用已更正为 specs/09 §5.1；触发条件「trailer 无回显」与该规范「由 Code 机械取得、AI 不填」的分工相违，失败前提不再成立
object_uid: 116625df-be9a-4cea-a947-a99c627b9b15
fact_type_key: pitfall
created_at: 2026-10-17T03:55:31.990Z
change_log:
  - at: 2026-10-17T03:55:31.990Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 闲时辅助经验积累（机械通道）于 2026-10-17T03:55:20.749Z 形成候选
  - at: 2026-10-17T07:45:06.667Z
    provider: qoder
    model: qfmodel
    summary: 登记独立复现验证结论（23 §16.1 第 3 项），据实不入档：症状/触发/解决/验证各段与一手记录逐字吻合（预检三轮失败→passed、自行解压 zstd 日志取 workbuddy 而未照抄历史的 workbuddy-global、34a2ce0 三文件与推送均成立）；但根因段「预检不指出缺哪一段」与实报逐字冲突、且「specs/06」应为 specs/09 §5.1，另 09 §5.1 把 trailer 取值归 Code 而本条记作 AI 自行取证——根因段属 §9.3 不得以补充名义改写的实质段，故保持 draft 待 Human 处置。机制语义与 scope 未改动。
  - at: 2026-10-18T19:40:39.870Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 否决：根因段「预检不指出缺口」被代码推翻已更正，引用改 specs/09 §5.1；触发条件前提随 trailer 归属分工不再成立
---

# 提交消息格式凭惯例拼装致预检失败

## 症状
首次 `ldvh_precheck_git_commit` 预检失败，被要求按 LDVH 提交规范调整提交消息格式；提交消息中的 `provider:` / `model:` trailer 值并无直接来源，助手需要自行解压 zstd 多帧会话日志取当次权威值。

## 触发条件
编写含 trailer 的受控提交消息时，凭直觉/惯例拼装消息结构而不先读提交规范原文，且 trailer 字段的权威值没有随预检结果或工具接口回显。

## 根因
提交消息的字段构成由提交规范明确规定而非宿主默认约定；构造者不先读规范原文即按惯例拼装，首轮必然缺段。需更正原判断：**预检确实逐项指出所缺段落**——实测 `plugin/lib/commit-validation.js:114` 报 `body must contain one 关键变更: section with a non-empty - item`、`:118` 报 `footer requires exactly one LDVH-Provider:`／`LDVH-Model:`，并非只给「不符合」的结论。真正的外部依赖在**取值**环节：trailer 的 provider/model 须由当次权威记录机械取得，构造者当时只能自行解压会话日志取证。

## 解决
先读提交规范原文确认确切格式（需 `关键变更:` 小标题与两行 trailer；契约位置为 specs/09 §5.1，09:99 与 09:104–105），再按预检回报的逐项缺口补齐消息结构，预检通过后经受控提交流程完成提交与推送。

**关于 trailer 取值须更正**：原文把「助手自行解压日志取 provider/model」记作解决做法，这与 specs/09 §5.1「由 Code 从当次权威会话或请求记录机械取得并写入，AI 不判断、选择或填写」的归属分工不符。正确做法是：trailer 由 Code 机械写入，AI 不自行取值；AI 侧的责任只是不擅自填、不照抄历史值。

## 规避
构造受控提交消息时，把「消息字段构成」当作规范原文而非习惯来查，并直接读预检回报的逐项缺口定位缺失段落；trailer 取值交由 Code 机械完成，禁止复用历史提交里的现成值作参照物（本例历史中并存 `workbuddy` 736 条与 `workbuddy-global` 51 条，照抄会取到过期值）；提交边界只暂存本次自己改动的文件，其余工作树改动保持未暂存。

## 验证
已观察到：预检由失败转为 `mechanical_outcome: passed`，Git Gate `commit-msg passed`，提交与推送成功——提交 `34a2ce0` 存在，`git show --stat` 为 3 files changed（Sidebar.tsx／useReadingRefresh.tsx／locales.ts）。未覆盖：未观察不同 provider 组合下的 trailer 行为；提交的功能本身（侧栏新按钮、刷新改调 hardReload）尚未在运行中的插件进程上目视验证。

**独立复现验证结论（2026-10-17，23 §16.1）**：复现主体为本会话主控（session-39edc51b）与另派的只读取证隔离子代理（agent 921408c8）；均未参与本候选形成，上下文互相隔离；独立性边界：同一底层模型、仅上下文隔离。核对形成会话 session-7909cf91 turn 6 的一手记录与仓库历史：**成立的部分**——① 首次预检确因按惯例拼装消息而失败（seq 503 的入参只有 header＋bullet 列表＋验证段，seq 504 逐字报 `validation/key_changes_required`、两次 `validation/signature_trailer_missing`）；② 中途一次重跑仍因缺 trailer 被拒（seq 543 入参含「依据:」段但无 trailer，seq 544 报两行 trailer 缺失），补 trailer 后 seq 598/599 转 `mechanical_outcome: passed`；③ trailer 的取值确由助手自行取证：seq 583/588/593 用 `zlib.zstdDecompressSync` 解压当次 `session.v4.jsonl.zstd` 并扫描多帧魔数，从 `request/context` 得 `provider:"workbuddy", model:"deepseek-v4.1-flash"`；seq 542 逐字记下历史范例值为 `workbuddy-global` 而**未照抄**；④ 落盘与推送成立：提交 `34a2ce0` 存在，`git show --stat` 为 3 files changed（Sidebar.tsx／useReadingRefresh.tsx／locales.ts），trailer 逐字 `LDVH-Provider: workbuddy` / `LDVH-Model: deepseek-v4.1-flash`；seq 609 逐字 `ecf95b1..34a2ce0  dev -> dev`；⑤ 「历史并存两种值」成立：全库 trailer 统计 `workbuddy` 736 条、`workbuddy-global` 51 条。

**处置（2026-10-19）**：判 discarded。原判「保持 draft 待 Human 处置」的两处不成立项，本次均已就地更正——根因段关于「预检不指出缺口」的断言被 `commit-writer` 的实报代码推翻，引用位置由 specs/06 更正为 specs/09 §5.1；规范张力一处按 specs/09 §5.1 的归属分工改写（trailer 由 Code 机械取得，不由 AI 自行取值）。但触发条件段「trailer 权威值没有随预检结果或工具接口回显」仍与 specs/09 §5.1 的既定分工相违——该分工下取值本就由 Code 承担、无需回显给 AI，故本条经验所据的失败前提在该分工生效后不再成立，经验不再适用，按 specs/23 §9.1 予 discarded。

## 影响与适用范围
仅适用于经 LDVH 预检与 Git Gate 的受控提交场景，限于 provider/model trailer 与消息字段构成，不涉及提交内容本身的正确性或其他门禁类型。
