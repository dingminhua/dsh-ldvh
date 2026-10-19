---
title: 受管辖但非 LDVH 项目缺 specs/ 致悬空假定
status: resolved
phenomenon: 安装事务只创建 ldvh-base/ 与 Git hook，从不创建 specs/，而 governed 引导与读取工具假定项目内有 specs/，于是非 LDVH 仓库的受管辖项目报出 specs/ directory not found in the governed project。
attribution: plugin/lib/ldvh-tools.js scanSpecCandidates（specs/01 §10.3 读取入口假定）与 specs/10 §6 安装事务步骤集
impact: heavy
relations:
  - relation_key: informs
    target:
      commit: 4c134dc3144c4f1ccd2fe02a284af9b302f4ce79
  - relation_key: informs
    target:
      commit: da78fc2db0f3c83d9c38d211fedad6abca8f5faa
object_uid: ed844630-6b46-4868-adbb-fca66ca90d19
fact_type_key: friction
created_at: 2026-10-17T05:02:28.597Z
change_log:
  - at: 2026-10-17T05:02:28.597Z
    provider: glm
    model: glm-5.3
    summary: 摩擦发现机械通道创建（04 §8.4 第 3 项）
  - at: 2026-10-17T05:35:46.006Z
    provider: glm
    model: glm-5.3
    summary: 销账：解药为 specs/01 §10.3 三级回退修订（1f1b276）与读取/打包实现（8b9005b），commit 例外指向（26 §11 + Human 2026-10-09 裁定）
  - at: 2026-10-18T19:59:02.304Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 事实更正（非状态转换）——更正 informs 与处置段所载 commit 标识：不可解析的 1f1b276/8b9005b 改为真实提交 4c134dc/da78fc2（26 §13 终态事实更正）。终态判定未变：status/title/phenomenon/impact/attribution/created_at 逐字继承落盘对象，本入口不接收 frontmatter 值（两处例外，均为「字段之有无」而非「字段之值」：① 2026-10 起可显式删除已退出类型闭集的字段，本次删除：无；② 2026-11 起可补填新进入类型闭集的字段，本次补填：无），不得改值；其余可改范围为正文与 relations（26 §13）。经 Human 授权：Human 于 2026-10-19 会话中在「修复范围」选项中选择「同时更正这条账目的 hash」（经 ask_user_question 答选，选项 id=fix_scope）：授权将 friction-ed844630 中不可解析的两个 commit 标识更正为真实解药提交 4c134dc 与 da78fc2。
occurrence:
  count: 1
  first_at: 2026-10-17T05:02:17.901Z
  human_return_at: null
  last_at: 2026-10-17T05:02:17.901Z
---

# 受管辖但非 LDVH 项目缺 specs/ 致悬空假定

## 现象
安装事务只创建 ldvh-base/ 与 Git hook，从不创建 specs/，而 governed 引导与读取工具假定项目内有 specs/，于是非 LDVH 仓库的受管辖项目报出 specs/ directory not found in the governed project。

## 入账依据
该现象可归因于安装流程未创建 specs/ 而消费方假定其存在之间的结构性缺口；补齐安装侧或弱化消费方假定会避免此报错路径，具备可修性。

## 处置
解药为 specs/01 §10.3 三级回退修订与读取/打包实现两笔提交：4c134dc（docs(specs)：§10.3 增补三级回退与来源如实披露条文）+ da78fc2（feat(specs)：resolveSpecSourceRoot 三级回退实现、三个读取入口接入、membership evidence 不适用分支、打包链与 9 个新测试）。两笔均通过 Git Gate 机械校验；全量回归 1534/1534 通过、lint 干净、npm pack 实证 30 个语料文件入包且开发树无残留。informs 关系按 26 §11 + Human 2026-10-09 裁定的 commit 例外分别指向这两笔提交——本次为 Human 定向「直接执行、不对象化」，未建 WorkCase/ADR，故补救无对象身份，走 commit 例外而非 object_uid。如实声明：本销账不主张闭环——消费方在受辖但非 LDVH 项目里若仍报此错，需重启 DSH Desktop 让 link 安装的新插件代码生效（DEVELOPMENT.md 既有要求），代码侧的修复已落盘。
