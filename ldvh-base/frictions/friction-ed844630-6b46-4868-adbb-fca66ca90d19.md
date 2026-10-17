---
title: 受管辖但非 LDVH 项目缺 specs/ 致悬空假定
status: resolved
phenomenon: 安装事务只创建 ldvh-base/ 与 Git hook，从不创建 specs/，而 governed 引导与读取工具假定项目内有 specs/，于是非 LDVH 仓库的受管辖项目报出 specs/ directory not found in the governed project。
attribution: plugin/lib/ldvh-tools.js scanSpecCandidates（specs/01 §10.3 读取入口假定）与 specs/10 §6 安装事务步骤集
impact: heavy
relations:
  - relation_key: informs
    target:
      commit: 1f1b276166ee0c2d46f196413851edaad2732df8
  - relation_key: informs
    target:
      commit: 8b9005b5c8e40871c2115ef8b9c97edef7b30082
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
解药为 specs/01 §10.3 三级回退修订与读取/打包实现两笔提交：1f1b276（docs(specs)：§10.3 增补三级回退与来源如实披露条文）+ 8b9005b（feat(specs)：resolveSpecSourceRoot 三级回退实现、三个读取入口接入、membership evidence 不适用分支、打包链与 9 个新测试）。两笔均通过 Git Gate 机械校验；全量回归 1534/1534 通过、lint 干净、npm pack 实证 30 个语料文件入包且开发树无残留。informs 关系按 26 §11 + Human 2026-10-09 裁定的 commit 例外分别指向这两笔提交——本次为 Human 定向「直接执行、不对象化」，未建 WorkCase/ADR，故补救无对象身份，走 commit 例外而非 object_uid。如实声明：本销账不主张闭环——消费方在受辖但非 LDVH 项目里若仍报此错，需重启 DSH Desktop 让 link 安装的新插件代码生效（DEVELOPMENT.md 既有要求），代码侧的修复已落盘。
