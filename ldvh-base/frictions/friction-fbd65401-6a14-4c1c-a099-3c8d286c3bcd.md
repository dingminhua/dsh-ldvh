---
title: 宿主缓存旧模块致 precheck 误报
status: observing
phenomenon: 在插件源码就地修改后，长驻宿主进程仍按启动时缓存的旧模块执行 precheck，对同一候选返回 failed，而同一候选经 Git Gate（新起子进程、读到新代码）返回 passed——同一校验的机械口径以错误结论为准。
impact: medium
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
occurrence:
  count: 2
  first_at: 2026-10-12T12:40:00.000Z
  human_return_at: null
  last_at: 2026-10-12T12:40:51.477Z
---

# 宿主缓存旧模块致 precheck 误报

## 现象
在插件源码就地修改后，长驻宿主进程仍按启动时缓存的旧模块执行 precheck，对同一候选返回 failed，而同一候选经 Git Gate（新起子进程、读到新代码）返回 passed——同一校验的机械口径以错误结论为准。

## 入账依据
本次实测：a43883f 落盘前，precheck-git-commit 工具对候选连续两次返回 `mechanical_outcome: failed`，而 `node plugin/lib/git-gate-runner.js git-commit-msg ...` 对同一 Index 与同一 message 返回 `passed`（`snapshot_identity=0a4562e7...`）。定位：宿主进程启动于 2026-10-08，而被改文件 mtime 为 2026-10-12 20:04；插件经符号链接 `~/.dsh/profiles/desktop/node_modules/dsh-ldvh -> DshProject/dsh-ldvh/plugin` 加载，故进程持有的 `ldvh-tools.js` 与 `commit-validation.js` 是改动前的副本。以 `makeExecute` 在进程外直驱同一 handler（补 `dshHomePath` 为 `(...segs) => join(HOME, ".dsh", ...segs)` 的路径拼接函数）复原真实结果：`verification.passed: true`、`issues: []`、`docs_references` 已列——即失败项为零，工具侧的 failed 纯由陈旧模块所致。可归因性：根因是「就地编辑源码 + 宿主无热重载」的组合，与候选内容语义无关。修了会更好的预期：本项目「写代码—提交」是主干工作循环，而 precheck 是提交前必经门；一旦实现文件在会话中被改，本次会话后续的 precheck 结论即不可信，且它**以 failed 而非 unavailable 的形态出现**——按 09 §5.4 三值语义，failed 意为「确认未通过」，会把「模块陈旧」误报为「候选违规」，进而可能诱导改动候选本身去迎合错误结论（本次即先误判为检查范围过宽，据此把范围从「所有非 docs 载体」收窄为「规范与事实载体」——该收窄本身仍有独立理由，但当时的触发判断是错的）。**可用性边界**：Git Gate 每次新起进程，不受影响，故受控提交终闸仍然可信；受影响的是会话内的 precheck 便利入口。本笔为机械通道创建，仅陈述现象与实测证据；本条自身不含任何 docs/ 路径引用，故不触发 09 §5.3 第 5 项。

补充观察（2026-10-12T12:40:51.477Z）：材料所述现象是 precheck 两次报 failed 且不返回诊断、而真实 git commit 时 Git Gate 钩子返回 passed，即「预检入口与真实钩子结论相反」。材料原文明确承认该现象“符合已入账摩擦账目的既有模式”，并点名“宿主缓存旧模块致 precheck 误报 / precheck 与 Git Gate 双入口差异”两个既有账目指向；既有账本中 uid=fbd65401-6a14-4c1c-a099-3c8d286c3bcd 正是「宿主缓存旧模块致 precheck 误报」。本次只是该阻碍的新一例复现（“但本次是新的复现”），而非一个新的阻碍类型，故判定为 same-obstacle。
