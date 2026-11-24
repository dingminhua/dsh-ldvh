---
title: 整文件豁免致 README 正文改动假绿
status: active
scope: 任何依赖 sync-release.mjs --check 作为 dev→main 同步一致判据、且改动落在 README（或其它 CHECK_EXEMPT/APPLY_SKIP 文件）正文区的场景均适用。
object_uid: e9d3dd8e-acc0-41b0-8283-2ad09ce6aa19
fact_type_key: pitfall
created_at: 2026-11-24T05:49:07.965Z
change_log:
  - at: 2026-11-24T05:49:07.965Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 记录 sync-release 的 CHECK_EXEMPT 整文件豁免把 README 正文区一并排除出差异检查与 apply，致 --check exit 0 假绿
---

# 整文件豁免致 README 正文改动假绿

## 症状

dev 侧改了 `README.md` 正文后，执行 `node scripts/sync-release.mjs --check` 仍然 exit 0，输出呈现为「同步一致」（`differs（内容不同、非版本豁免，apply 将覆盖）: 0`），但 main 树的 README 正文丝毫未变。识别信号是：改动明明落在受同步管理的仓库文件里，`--check` 的差异清单却一条都不出现，而 `git -C <main 树> diff` 在该文件上也没有任何变化——「假绿」与「目标树未变」同时成立。

审核代理原话（本任务主控交付材料 ②）：

> README 的正文改动既不写入 main、也不出现在任何差异清单：dev 改完后 --check 照样 exit 0，给出"同步一致"的假信号。实测 main:README.md 该节仍是原一句指针。

## 触发条件

改动落在 `APPLY_SKIP` / `CHECK_EXEMPT` 所列文件的**正文区**（而不仅是版本声明行），且把 `sync-release.mjs --check` 的 exit 0 当作 dev→main 同步一致的判据。当前名单覆盖 `README.md`、`plugin/README.md`、`plugin/README.en.md`、`plugin/package.json`、`plugin/package-lock.json`（`APPLY_SKIP`）与 `plugin/CHANGELOG.md`（仅在 `CHECK_EXEMPT`）。

## 根因

逐字引证（`plugin/scripts/sync-release.mjs:9-16`）：

> `const APPLY_SKIP = ["plugin/package.json","plugin/package-lock.json","plugin/README.md","plugin/README.en.md","README.md"];`
> `const CHECK_EXEMPT = [...APPLY_SKIP, "plugin/CHANGELOG.md"];`

逐字引证（同文件 `:77` 与 `:122`）：

> `else if (tgt.get(path) !== oid && !CHECK_EXEMPT.includes(path)) differs.push(path);`
> `process.exitCode = missing.length + extra.length + differs.length > 0 ? 1 : 0;`

即 `differs` 显式排除 `CHECK_EXEMPT`，而 check 模式的退出码只由 `missing + extra + differs` 决定；apply 又只搬 `missing/differs/changelog`。于是名单内文件的任何内容差异既不进入差异清单，也不被搬移，更不影响退出码。豁免本意是保护版本声明点（分线维护），但实现粒度是**整文件**，连带把同一文件里逐字共有的正文区也豁免出同步与差异检查——正文改动落空且无告警。

## 解决

本次按 Human 决定方案 A 处置：dev 与 main 各做一次受保护独立提交，main 侧按节手工打补丁并在提交信息中记录；长期方案 B（扩展 `sync-release.mjs` 让 README 正文区纳入机械投影，只豁免版本声明行）待定，未实施前不得假定它已兜住正文。

## 规避

不要用 `sync-release.mjs --check` 的 exit 0 单独充当 README（或其它 `CHECK_EXEMPT` 文件）正文的同步判据。改动落在这些文件时，另做一次目标树内容比对：`git -C <main 树> show HEAD:README.md` 与 dev 侧同节逐字对照（本次用 937 字节比对确认两树「如何使用」节一致后才各自提交）。判据的形态也要改：问「这一节在两棵树里是否逐字相同」，而不是问「脚本是否 exit 0」。

## 验证

已观察（本任务主控交付材料 ②，经独立审核代理核对）：
1. dev 改 README 正文、main 未改时，`--check` exit 0（假绿），差异清单无 README；
2. 两树版本门禁各自绿（dev 4 处 `1.1.6-dev.1` / main release 5 处 `1.1.6`）——说明版本门禁绿与正文同步并不是同一件事；
3. 两树「如何使用」节经 937 字节比对逐字一致后才各自提交。

机制侧经本仓源码逐行核对：`plugin/scripts/sync-release.mjs:9-16`（名单）、`:77`（`differs` 排除）、`:122`（退出码）三处与上述后果一致。

## 影响与适用范围

任何依赖 `sync-release.mjs --check` 作为 dev→main 同步一致判据、且改动落在 README（或其它 `CHECK_EXEMPT`/`APPLY_SKIP` 文件）正文区的场景均适用。

展开：何时可能踩到——跨树发布流程里改 README / `plugin/README*` 正文、或把 `--check` 绿灯写进发布核对单时；`plugin/CHANGELOG.md` 虽在名单内但走 `changelogCarry` 单独通道，其正文差异另有提示，不在「完全无信号」之列。何时可信——`--check` 的 exit 0 只覆盖名单外文件的 missing/extra/differs 与 CHANGELOG 的流动提示，对名单内文件的正文内容不构成任何一致或不一致的判断。待方案 B 落地（正文区纳入机械投影、仅豁免版本声明行）后本条结论须重审。
