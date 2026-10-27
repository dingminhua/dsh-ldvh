---
title: 宿主缓存旧模块致 precheck 误报
status: resolved
phenomenon: 在插件源码就地修改后，长驻宿主进程仍按启动时缓存的旧模块执行 precheck，对同一候选返回 failed，而同一候选经 Git Gate（新起子进程、读到新代码）返回 passed——同一校验的机械口径以错误结论为准。
impact: medium
relations:
  - relation_key: informs
    target:
      commit: e9ce45d38178853de8560720a37e7756a38ea5ef
  - relation_key: informs
    target:
      commit: 2785c8a363638b38e3228643df9735743e866164
object_uid: fbd65401-6a14-4c1c-a099-3c8d286c3bcd
fact_type_key: friction
created_at: 2026-10-12T12:10:51.763Z
change_log:
  - at: 2026-10-12T12:10:51.763Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 首笔入账：就地改源码后宿主缓存旧模块致 precheck 误报 failed（04 §8.4 机械通道创建）
  - at: 2026-10-12T12:41:15.230Z
    provider: workbuddy
    model: space-bunny
    summary: 补充观察：count 1 → 2（04 §8.4 第 2 项）
  - at: 2026-10-19T06:17:42.475Z
    provider: go
    model: space-bunny
    summary: 补充观察：count 2 → 3（36 §9 第 2 项）
  - at: 2026-10-19T06:17:42.479Z
    provider: go
    model: space-bunny
    summary: 阈值流转 observing → open（count 3 ≥ 3，36 §9 第 4 项）
  - at: 2026-10-27T18:55:10.396Z
    provider: qoder
    model: qfmodel
    summary: 状态流转 open→resolved：解药为 commit e9ce45d＋2785c8a（陈旧判据＋failed→unverifiable 降级＋撤掉「改候选」式 follow_up），接线经两轮破坏性验证各自变红确认有分辨力；如实声明本解药须在宿主重启后方生效。载体侧另登记：清除 occurrence 内 2026-10 已退出的历史子件 human_return_at（值逐字未变，仅不再携带）
occurrence:
  count: 3
  first_at: 2026-10-12T12:40:00.000Z
  last_at: 2026-10-19T06:16:46.087Z
---

# 宿主缓存旧模块致 precheck 误报

## 现象
在插件源码就地修改后，长驻宿主进程仍按启动时缓存的旧模块执行 precheck，对同一候选返回 failed，而同一候选经 Git Gate（新起子进程、读到新代码）返回 passed——同一校验的机械口径以错误结论为准。

## 入账依据
本次实测：a43883f 落盘前，precheck-git-commit 工具对候选连续两次返回 `mechanical_outcome: failed`，而 `node plugin/lib/git-gate-runner.js git-commit-msg ...` 对同一 Index 与同一 message 返回 `passed`（`snapshot_identity=0a4562e7...`）。定位：宿主进程启动于 2026-10-08，而被改文件 mtime 为 2026-10-12 20:04；插件经符号链接 `~/.dsh/profiles/desktop/node_modules/dsh-ldvh -> DshProject/dsh-ldvh/plugin` 加载，故进程持有的 `ldvh-tools.js` 与 `commit-validation.js` 是改动前的副本。以 `makeExecute` 在进程外直驱同一 handler（补 `dshHomePath` 为 `(...segs) => join(HOME, ".dsh", ...segs)` 的路径拼接函数）复原真实结果：`verification.passed: true`、`issues: []`、`docs_references` 已列——即失败项为零，工具侧的 failed 纯由陈旧模块所致。可归因性：根因是「就地编辑源码 + 宿主无热重载」的组合，与候选内容语义无关。修了会更好的预期：本项目「写代码—提交」是主干工作循环，而 precheck 是提交前必经门；一旦实现文件在会话中被改，本次会话后续的 precheck 结论即不可信，且它**以 failed 而非 unavailable 的形态出现**——按 09 §5.4 三值语义，failed 意为「确认未通过」，会把「模块陈旧」误报为「候选违规」，进而可能诱导改动候选本身去迎合错误结论（本次即先误判为检查范围过宽，据此把范围从「所有非 docs 载体」收窄为「规范与事实载体」——该收窄本身仍有独立理由，但当时的触发判断是错的）。**可用性边界**：Git Gate 每次新起进程，不受影响，故受控提交终闸仍然可信；受影响的是会话内的 precheck 便利入口。本笔为机械通道创建，仅陈述现象与实测证据；本条自身不含任何 docs/ 路径引用，故不触发 09 §5.3 第 5 项。

补充观察（2026-10-12T12:40:51.477Z）：材料所述现象是 precheck 两次报 failed 且不返回诊断、而真实 git commit 时 Git Gate 钩子返回 passed，即「预检入口与真实钩子结论相反」。材料原文明确承认该现象“符合已入账摩擦账目的既有模式”，并点名“宿主缓存旧模块致 precheck 误报 / precheck 与 Git Gate 双入口差异”两个既有账目指向；既有账本中 uid=fbd65401-6a14-4c1c-a099-3c8d286c3bcd 正是「宿主缓存旧模块致 precheck 误报」。本次只是该阻碍的新一例复现（“但本次是新的复现”），而非一个新的阻碍类型，故判定为 same-obstacle。

补充观察（2026-10-19T06:16:46.087Z）：材料中助手明确陈述：预检服务端仍持有修复前的旧模块（回报旧的截断 token `docs/workcase-996e207a-指称形态候选-2026-10-18.md`），而 HEAD(9262710) 已含修复，且 commit-msg 钩子每次从仓库新起进程——这正是既有账目 friction-fbd65401「宿主缓存旧模块致 precheck 误报」所述同一阻碍（同一对象：宿主侧进程持旧模块，预检据此误报），故判 same-obstacle 并回指该 uid，不新建条目。附带说明：材料中「报出的 token 是被截断前缀」这一侧面与 friction-2c52306f「预检分块错位致报错位置与文本结构不符」相邻，但材料明确落到「服务端旧模块」这一归因上，故以 fbd65401 为命中对象。另：本次材料末尾被长度上限截断（止于一个 dsh-ui 围栏中途，`{"type":"stat","label":"工作树"` 之后即断），故仅就所见部分判断，未据未见部分另立条目。

## 处置
解药为 commit 级修复 `e9ce45d38178853de8560720a37e7756a38ea5ef`（fix: precheck 在宿主模块陈旧时降为 unverifiable，不再把旧代码的 failed 当真）与 `2785c8a363638b38e3228643df9735743e866164`（fix: 补上 precheck 陈旧降级的接线测试，并撤掉「去修候选」式指引），2026-10-28；两笔均走直提路径、无对应 ADR/WorkCase 事实对象，依 02 §8.1 commit 形态承载 informs。

本账现象的**所指是误报形态**（failed 冒充「确认未通过」），而非「宿主会重载模块」——后者是另一账（friction-906dae15「宿主未重载致插件召回修复真机验证受阻」）的范围，本笔不主张消除它。四件：① 新增 `plugin/lib/module-freshness.js`，判据为「进程启动时刻晚于 validator 模块的磁盘 mtime」（以 `process.uptime()` 反推启动时刻，跨平台；mtime 与启动同毫秒按未陈旧处理，宁可漏报不误报；模块不可读记 `unreadable` 而不判陈旧，避免正常提交误报）；② `ldvh-tools.js` 的三值分类追加降级——陈旧且原判 `failed` 时改报 `unverifiable`（09 §5.4「输入不足以完成检查」），并回传 `stale_modules`（reason／文件与 mtime／进程启动时刻／清除方式）；③ 陈旧时 `gaps` 逐条带出被降级的问题项、`scope.not_completed` 追加 `verdict-computed-by-current-validator-code`——检查项跑过但结论无效，不得读作已完成；④ 陈旧时 `follow_up` **不再回「fix the reported issues and re-run precheck」**，改为「重启宿主或重载插件后重跑，期间可用每次新起进程的 Git Gate」——本账「入账依据」明记的危害本体正是这条指引把人推向改候选迎合旧结论（本次即据此误收窄了检查范围），故撤掉它是本解药的一部分而非附带。

**不反向改判**：陈旧只说明「不知道」，不说明「候选合规」，故 `passed` 侧一律不动——把陈旧伪装成通过违反 00 §5.6 据实声明。

核验（2026-10-28）：① 判据单测 6 条含**反向守护**「正常启动的进程不得被判陈旧」——判据过宽会让所有真 failed 被降级掩盖，那是比原缺陷更坏的方向；② 接线单测 4 条分别钉住陈旧→unverifiable、陈旧下不得出现「改候选」指引、不陈旧时同样 failed 不得被降级、陈旧不改判 passed；③ **破坏性验证两轮各自变红**：删除降级那一行→第 1 条红；删除 follow_up 的陈旧分支→第 2 条红，二者互不掩盖，守卫非空转；④ 真实宿主进程内实测判据不误触发：工作树 validator 模块 mtime 早于宿主启动时刻时，precheck 对空 Index 候选仍如实报 `failed`（`git/index_empty`），无 `stale_modules` 字段；⑤ `git-gate-runner.js` 每次新起进程，终闸不受本改动影响（09 §5.5）。

边界（如实声明，不主张闭环）：**本解药自身正受它所治的缺陷限制**——修复前已在运行的宿主进程持有的是**没有陈旧检测的旧代码**，它不会自我降级，须重启宿主或重载插件后方生效；本次会话内即为此实况（该宿主 00:09 启动、我 01:49 改码，故我改码时它仍按旧码回报 failed），这恰是本账机制的一次真实复现，而非反例。另：判据只覆盖「mtime 晚于进程启动」这一种陈旧形态；文件被改而 mtime 未变（某些检出／回滚路径）检测不到，属不可判定，本模块如实不主张覆盖。陈旧时的 `issues` 仍原样返回（不隐藏观察），只是不再构成为候选定性的结论。

**载体侧留痕（2026-10-28 本次流转）**：本载体 `occurrence` 内含 2026-10 闭集收缩后已退出的历史子件 `human_return_at: null`，受控更新整份继承时被 §8 闭集校验拦下（首次尝试以 `friction/frontmatter_invalid` 零写入拒绝）。本次流转写入以显式 `occurrence` 承载 `count: 3 / first_at / last_at` 三件、值与原载逐字相同（仅不再携带该 null 子件），非改值。`frontmatter_removals` 通道不含 `occurrence`，故该历史子件的清除只能经此显式承载完成——此处如实登记该次清除及其未改值性质。
