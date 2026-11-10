---
title: 载体内聚要求同文双存致写入失败与二次事实
status: open
phenomenon: 载体内聚校验要求正文逐字复制 frontmatter 的 summary，同一段文字在 frontmatter 与正文各存一份，且每次写入都需手工复制长文本并伴随失败率。
attribution: 载体内聚（9 份类型规范各自的局部条款，非 02 号公共契约）要求写入方手工复制长文本并逐字精确比对，引号与空白的细微差异即遭拒绝
object_uid: fef52f25-bc5d-4ed7-abb4-f9f8182607d7
fact_type_key: friction
created_at: 2026-11-09T20:07:34.187Z
change_log:
  - at: 2026-11-09T20:07:34.187Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 摩擦发现阈值晋升（观察缓冲同源条目 3 条 ≥ 3，11 §9 第 3 项）
  - at: 2026-11-09T20:26:10.918Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补充观察：count 3 → 4（11 §9 第 2 项）
  - at: 2026-11-09T20:45:47.423Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补充观察：count 4 → 5（11 §9 第 2 项）
  - at: 2026-11-09T21:19:30.646Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补充观察：count 5 → 6（11 §9 第 2 项）
  - at: 2026-11-09T21:19:30.652Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补充观察：count 6 → 7（11 §9 第 2 项）
  - at: 2026-11-09T21:40:14.145Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补充观察：count 7 → 8（11 §9 第 2 项）
  - at: 2026-11-09T23:07:07.578Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补充观察：count 8 → 9（11 §9 第 2 项）
  - at: 2026-11-10T11:36:53.204Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补 recall_digest：为召回提供高密度关键词面（02 §7.1）
  - at: 2026-11-10T18:04:43.133Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 更正错归因（载体内聚不是 02 §7.2 条款，而是 20–29 局部条款）；并如实登记修复已落地但因 relations schema 未进运行实例、销账流转暂不可执行
occurrence:
  count: 9
  first_at: 2026-11-09T14:30:53.417Z
  last_at: 2026-11-09T21:58:18.921Z
---

# 载体内聚要求同文双存致写入失败与二次事实

## 现象

载体内聚校验要求正文逐字复制 frontmatter 的 summary，同一段文字在 frontmatter 与正文各存一份，且每次写入都需手工复制长文本并伴随失败率。

### 该阻碍的历次观察（3 次，逐字引证）

1. （2026-11-09T14:30:53.417Z，session-767a1387-d981-40a5-8140-bc5bab20abd8 @ 79）差别只是一个引号：我打的「『」和 summary 里的「」对不上。我精确修正。
（来源：79）
2. （2026-11-09T19:32:39.247Z，session-767a1387-d981-40a5-8140-bc5bab20abd8 @ 90）同一个校验连拒我 5 次，前 4 次我都在调措辞，第 5 次才去读原文才发现是理解错了。
（来源：90）
3. （2026-11-09T19:41:54.765Z，session-767a1387-d981-40a5-8140-bc5bab20abd8 @ 91）每次写入要手工复制长文本、14.7% 的失败、以及一处事实内容副本。
（来源：91）

## 入账依据

可归因性：载体内聚（同一段文字在 frontmatter 与正文各存一份）是 9 份类型规范各自的局部条款，不是 02 号公共契约；它要求写入方手工复制长文本，且比对为逐字精确匹配，故引号、空白、全角半角的细微差异都会导致拒绝。修了会更好的预期：取消逐字义务后，写入方只需保证正文是对字段的展开，同一内容的两次维护与逐字比对失败一并消失。

**归因更正（2026-11-11）**：本账原 `attribution` 写「specs/02 §7.2 载体内聚校验与公共字段形态」——该条款不存在。01/02 号全历史 0 次出现「载体内聚」，它是 20–29 的局部条款。此错误归因由 `spark-f0ba9997` 的独立核查发现并在该 Spark 正文中登记；本条账目此前按错误归因记录，现予更正。

**修复进展（2026-11-11，尚未销账）**：解药已落地但本账仍为 `open`。已完成的修复是：20/21/22/23/28/29 六份规范的「字段间不变量」统一改为「frontmatter 是索引与摘要、正文是展开，差异只报告不阻断」；`devlog-writer.js` 的 `validateCarrierCoherence` 改为只产 `warnings`、`ok` 恒为 true；8 处正文骨架注释「← 字段逐字 + 展开」改为「← 字段的展开……不要求逐字复现」（20 三处、21 两处、22 两处、23 一处）。第三项是本账的关键：只改不变量而留下骨架注释，写入方仍会照注释去复制——实测在改注释前，最近创建的 40 个对象里有 39 个仍在逐字复制。

**为何仍未转 `resolved`（如实登记）**：26 §9.2 规定 `open → resolved` 须带 `informs` 指向解药对象；解药为 commit 级修复且**该修复没有任何对象身份**时，规范允许 `target` 取 `{commit: "<40 位 hex>"}` 形态——本账正属该例外（解药是规范条文与 `devlog-writer.js` 的修订，未建立任何 ADR 或 WorkCase）。但 `friction-tools.js` 的 `relations.target` schema 只声明了 `object_uid`，而 `friction-writer.js` 已实现 commit 形态：**规范与实现都支持、唯独工具参数面拒绝**。该 schema 已修正，但运行实例仍是旧模块（`plugin/lib` 改动须重启宿主才进运行实例），故本次无法完成流转。修复生效后应以 `{commit: "c8e52abd1a085c682280185a54aae6849c76fa70"}` 补 `informs` 并转 `resolved`。
