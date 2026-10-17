---
title: 提交消息格式凭惯例拼装致预检失败
status: draft
scope: 仅适用于经 LDVH 预检与 Git Gate 的受控提交场景，限于 provider/model trailer 与消息字段构成，不涉及提交内容本身的正确性或其他门禁类型。
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
---

# 提交消息格式凭惯例拼装致预检失败

## 症状
首次 `ldvh_precheck_git_commit` 预检失败，被要求按 LDVH 提交规范调整提交消息格式；提交消息中的 `provider:` / `model:` trailer 值并无直接来源，助手需要自行解压 zstd 多帧会话日志取当次权威值。

## 触发条件
编写含 trailer 的受控提交消息时，凭直觉/惯例拼装消息结构而不先读提交规范原文，且 trailer 字段的权威值没有随预检结果或工具接口回显。

## 根因
提交消息的字段构成由 specs/06 明确规定而非宿主默认约定；预检只给出「不符合」的结论而不指出缺哪一段，使消息结构成为必须外部查证的隐藏依赖。同时 trailer 的 provider/model 只能从当次会话日志取证，规范要求「回指当次权威记录」但未提供取值接口。

## 解决
先读 `specs/06` 提交规范原文确认确切格式（需 `关键变更:` 小标题与 trailer），再从会话日志的 `request/context` 事件机械取得 provider=workbuddy、model=deepseek-v4.1-flash（并识别出与历史提交里的 `workbuddy-global` 不同，故不照抄），按此重写消息重跑预检，预检通过后再经 Git Gate 完成提交与推送。

## 规避
构造受控提交消息时，把「消息字段构成」当作规范原文而非习惯来查；trailer 一律取当次会话日志的实测值，禁止复用历史提交里的现成值作参照物；提交边界只暂存本次自己改动的文件，其余工作树改动保持未暂存。

## 验证
已观察到：预检由失败转为 `mechanical_outcome: passed`，Git Gate `commit-msg passed`，提交与推送成功（3 files changed）。未覆盖：未观察不同 provider 组合下的 trailer 行为；提交的功能本身（侧栏新按钮、刷新改调 hardReload）尚未在运行中的插件进程上目视验证，须重启插件后才第一次可见。

**独立复现验证结论（2026-10-17，23 §16.1）**：复现主体为本会话主控（session-39edc51b）与另派的只读取证隔离子代理（agent 921408c8）；均未参与本候选形成，上下文互相隔离；独立性边界：同一底层模型、仅上下文隔离。核对形成会话 session-7909cf91 turn 6 的一手记录与仓库历史：**成立的部分**——① 首次预检确因按惯例拼装消息而失败（seq 503 的入参只有 header＋bullet 列表＋验证段，seq 504 逐字报 `validation/key_changes_required`、两次 `validation/signature_trailer_missing`）；② 中途一次重跑仍因缺 trailer 被拒（seq 543 入参含「依据:」段但无 trailer，seq 544 报两行 trailer 缺失），补 trailer 后 seq 598/599 转 `mechanical_outcome: passed`；③ trailer 的取值确由助手自行取证：seq 583/588/593 用 `zlib.zstdDecompressSync` 解压当次 `session.v4.jsonl.zstd` 并扫描多帧魔数，从 `request/context` 得 `provider:"workbuddy", model:"deepseek-v4.1-flash"`；seq 542 逐字记下历史范例值为 `workbuddy-global` 而**未照抄**；④ 落盘与推送成立：提交 `34a2ce0` 存在，`git show --stat` 为 3 files changed（Sidebar.tsx／useReadingRefresh.tsx／locales.ts），trailer 逐字 `LDVH-Provider: workbuddy` / `LDVH-Model: deepseek-v4.1-flash`；seq 609 逐字 `ecf95b1..34a2ce0  dev -> dev`；⑤ 「历史并存两种值」成立：全库 trailer 统计 `workbuddy` 736 条、`workbuddy-global` 51 条。**不成立、须提请 Human 处置的部分（两处）**——其一，根因段称「预检只给出『不符合』的结论而不指出缺哪一段，使消息结构成为必须外部查证的隐藏依赖」，而 seq 504/544 的实报逐字指明所缺段落（`body must contain one 关键变更: section…`、`footer requires exactly one LDVH-Provider:`／`LDVH-Model:`），即预检**逐项指出**了缺口，该句与本条自身症状段（「被要求按 LDVH 提交规范调整提交消息格式」）亦不一致；其二，「specs/06」为引用有误——提交消息契约（header/body/trailer 三段与 trailer 取值口径）在 **specs/09 §5.1**（`关键变更:` 在 09:99，两行 trailer 在 09:104–105），specs/06 只在 :140 回指该要求。**另须登记一处规范张力**：09 §5.1 规定 `LDVH-Provider`／`LDVH-Model` 「由 Code 从 DSH 当次权威会话或请求记录机械取得并写入，AI 不判断、选择或填写」，而本条「解决」「规避」把「助手自行解压日志取 trailer 值」记作正确做法——该做法与规范归属的分工不相符，入档后可能被后续读者当作可复用范式，须由 Human 决定是改写还是否决。因不成立项落在**根因段**（§9.3 列为不得以补充名义改写的实质段），本条**保持 `draft` 不入档**，待 Human 处置。未覆盖：本次未重跑受控提交（会写入仓库历史），故预检失败→通过的顺序系对一手记录与仓库结果的核对，非现场重演；不同 provider 组合下的 trailer 行为仍未观察。

## 影响与适用范围
仅适用于经 LDVH 预检与 Git Gate 的受控提交场景，限于 provider/model trailer 与消息字段构成，不涉及提交内容本身的正确性或其他门禁类型。
