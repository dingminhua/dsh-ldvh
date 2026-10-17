---
title: 受控写入重建漏抄字段被删除后回填
status: active
scope: LDVH 受控写入与字段比对核查流程（摩擦账本等 frontmatter 载体）
object_uid: 2abbbc2f-507f-4861-beb8-06053f93b8d3
fact_type_key: pitfall
created_at: 2026-10-16T06:17:56.417Z
change_log:
  - at: 2026-10-16T06:17:56.417Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 闲时辅助经验积累（机械通道）于 2026-10-16T06:17:11.212Z 形成候选
  - at: 2026-10-17T07:03:07.160Z
    provider: qoder
    model: qfmodel
    summary: 登记另一主体复现验证结论（23 §16.1 第 3 项）：一手会话留痕原话逐字命中，仓库侧另得提交 150aaee 自述与 HEAD 载体字段现存两处佐证；同时如实登记三处限定（git 历史无中间态、失效对象为 ba4afa96、未找他例）。机制语义、根因、解决、规避与 scope 均未改动。
  - at: 2026-10-17T07:30:04.004Z
    provider: qoder
    model: qfmodel
    summary: 入档（draft → active，23 §16 第 1 项）+ 补充级登记：复现成立——一手会话留痕逐字命中各段所引原话，仓库侧另得提交 150aaee 自述与 HEAD 载体字段现存两处佐证；另补入适用性核对一条（02 §10.5 已承载该义务但机械强制未落地，workcase-996e207a 当时仍为 draft，故不属 23 §6.3 排除情形）。根因、解决、规避与 scope 语义未变。Human 2026-10-17「情况属实就转正」为其授权。
---

# 受控写入重建漏抄字段被删除后回填

## 症状
受控写入某账目载体（frontmatter）时，本应保留的字段（如 `attribution`）被意外删除：重建写入内容时漏抄一行，字段连同被写入结果一起被抹去，与基线相比出现意外差异。

## 触发条件
以重建（记忆或截断输出为数据源）的方式组装要写入的内容，而不是从基线逐字复制时，容易漏掉某个非目标字段行；写入契约对未触字段按继承处理，但发出侧没有该字段，差异在 diff 比对中暴露。

## 根因
重建 frontmatter 时以记忆/截断输出为数据源，遗漏了个别字段行；受控写入未自带对未触字段的逐字比对，差异只能靠事后 diff 比对发现。材料中主控自述「只因为我重建 frontmatter 时漏抄一行」，并把该机制识别为 abf557e1 记的失效。

## 解决
重新读取 HEAD 上的原载体，将遗漏字段从 HEAD 逐字取回（「restore attribution verbatim from HEAD」），其余部分保持字节一致后再重写。

## 规避
受控写入后对未触字段与基线做逐字比对，发现差异即拒并回填，用 diff 比对代替对重建产物的目检，不凭记忆或截断输出直接组装写入内容。

## 验证
回填后 diff 与预期完全一致（「The diff is now exactly as intended」），工具读回指纹与 HEAD 精确一致，测试套件 1523 通过 0 失败，两账目销账后 open 数由 3 降到 1。

**独立复现验证结论（2026-10-17）**：复现主体为本会话主控（session-39edc51b）与另派的只读取证隔离子代理（agent 921408c8），二者均未参与本候选形成（本候选由 36 §10 机械通道在闲时会话中形成，见 change_log 首条），二者上下文亦互相隔离；独立性边界如实声明：二者为同一底层模型，仅做到上下文隔离，未做跨模型验证。复现做法与观察结果：① 一手会话留痕（形成侧会话 session-36dd0a0a turn 2/3）逐字命中本条各段所引原话——「我把它的 `attribution` 字段写丢了——只因为我重建 frontmatter 时漏抄一行」「这**正是 abf557e1 记的失效**」「restore `attribution` verbatim from HEAD」「The diff is now exactly as intended」「1523 pass / 0 fail」「the `open` count dropped from 3 to 1」；② 仓库侧由主控独立复核：提交 `150aaee` 消息正文逐字记载「ba4afa96……其 `attribution` 字段在首次写入时被我遗漏、经 `git show HEAD` 取原文逐字回填并以字符串比对确认 IDENTICAL。plugin 套件 1523 通过 / 0 失败」；`ldvh-base/frictions/friction-ba4afa96…md` 的 HEAD 第 4 行 `attribution` 字段现存且内容完整；提交 `c6d7166` 对 `friction-abf557e1…md` 的正文补充观察段逐字登记同一次识别（「…漏抄一行……被 diff 比对拦下」）。未覆盖与需限定之处：① git 历史中**不存在**「先被删、后被逐字回填」的中间态——回填发生在未提交的工作区，故「回填文本与 HEAD 逐字一致」只能由提交消息自述与 HEAD 字段现存佐证，无法由历史 diff 直接证明；② 失效对象具体为 `ba4afa96`，本条正文以「某账目载体」泛指而未点明 UID；③ 复现者未在其它 frontmatter 载体上另寻同类漏抄第二例，也未复跑当次测试套件。

**入档时的适用性核对（2026-10-17，23 §12 预检匹配）**：本条「规避」所述义务已有一部分由规范源承载——`specs/02` §10.5 现要求受控更新「after 保留全部未变更且仍有消费价值的字段」，并把「after 不完整」列为零写入拒绝与 §15.1 第 4 项必停情形。但机械强制尚未落地：本会话核对 `plugin/lib/*.js` 未检索到针对 after 完整性的统一拒绝实现，对应的收口工单 `workcase-996e207a`（「受控更新 after 完整性：7 writer 形态修正」）当时候仍为 draft。故本条在规则已立、保证未兑现的窗口内仍承担经验价值（提醒执行者自做逐字比对），不属 §6.3「已由规范源吸收为强制规则的规避」的排除情形；机械保证落地后应重审本条是否退场。

## 影响与适用范围
本机制作用于 LDVH 受控写入与字段比对核查流程（摩擦账本等 frontmatter 载体）。适用同类以重建方式产出受控写入、随后由 diff 比对核查的场景；未覆盖在前端仍为 open 的 abf557e1 账号面、非 frontmatter 写入路径的字段比对应用。
