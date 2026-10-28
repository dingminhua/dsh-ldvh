---
title: 只抄写入函数未抄证据保管链致门禁可绕
status: discarded
scope: 适用于在受控写入路径上新增与既有证据链形态相近的审核/记录类字段，尤其是「抄一条已有链做新链」的实现场景；影响面为机制保证的真实性——缺保管链时相关条款的机械性声明不成立，据其做出的「未审不得放行」保证为空。范围：pre_reviews 之例；是否扩及其他字段需另行复核确认，本次未覆盖。
disposition: 规避已由 specs/04 §6.3「同等强度的核对单位」（整条证据保管链四问）与其第 10 节验证表「同等强度声明」行吸收为强制规则；规则由规范源承载，本条仅作来源引用（23 §6.3、35 §8.6 第 3 项）。
object_uid: 9a0c5057-f2be-4a0d-8af5-10a1ea93ce16
fact_type_key: pitfall
created_at: 2026-10-17T02:06:29.855Z
change_log:
  - at: 2026-10-17T02:06:29.855Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 闲时辅助经验积累（机械通道）于 2026-10-17T02:06:16.097Z 形成候选
  - at: 2026-10-17T07:41:48.174Z
    provider: qoder
    model: qfmodel
    summary: 登记独立复现验证结论（23 §16.1 第 3 项）并按 Human 2026-10-17「情况属实就转正」入档（draft→active）：复现者用修复前 writer（64bf2d4）对 HEAD 旁路用例实跑得 6 红、证明门禁确曾被绕；HEAD 全 20 绿 + grep 确认四环保管链落地；据修复提交 4bbc9f6 与第二轮复核记录，把「第二次复核尚未返回」据实收窄为「已返回、五个面堵死」，仍属实的未覆盖项为其他受控写入路径是否还有同类旁路。机制语义与 scope 未变。
  - at: 2026-10-27T18:44:57.982Z
    provider: minmax
    model: MiniMax-M3.1-Flash
    summary: 机械化承载盘点登记（2026-10-28）：承载位置为 plugin/lib/workcase-writer.js 的 guardAuditField/stripCallerOnlyFields/stampReviewEntries/assertReviewHistoryNotRewritten 四环与 plugin/test/workcase-pre-gate1-audit.test.mjs 旁路用例；状态与 scope 不变（23 §9.3 补充级更新）。
  - at: 2026-10-28T03:33:41.996Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 经验废止（active→discarded，23 §16 第 2 项，Human 2026-10-28 指令）：规避已由 specs/04 §6.3「同等强度的核对单位」与其第 10 节验证表「同等强度声明」行吸收；同时修复既有结构缺陷（补回缺失的「影响与适用范围」H2，本对象此前 body_valid=false）。
---

# 只抄写入函数未抄证据保管链致门禁可绕

## 症状

新增一条与既有 `reviews` 形态「同构」的审核轴 `pre_reviews` 后，主控在注释中宣称其「不可自证性要求与复核轴完全相同」并据以把相关条款列为机械保障；独立复核体随后实测复现两道 approve 门禁可被绕过：approve 无审核被正确拒绝，但先以 `action=revise` 伪造 `pre_reviews`（`auditor_origin`、`session_source` 等身份字段均为调用方自填字符串）即写入成功，随后 approve 放行；`action=create` 亦可直写该字段跳过唯一写入口；已由真实审核体盖戳的 `needs_revision` 条目可被 revise 改写为 `verdict=pass` 并放行 approve。

## 触发条件

把一条已有完整证据保管链的字段链（唯一写入口 + Code 托管盖戳 + 既有条目不可改写 + 判据按条目比对）当作「字段形态」复制到新字段上时，只复制写入函数与判据比对，未复制保管链其余三环。

## 根因

既有 `reviews` 的正确性不来自字段本身，而来自围绕它的完整保管链：写路径强制经唯一入口 `record_review`；`stampReviewEntries` 由 Code 盖戳身份、既有条目逐字继承不可自填；`assertReviewHistoryNotRewritten` 阻止已盖戳结论被改写；判据按条目比对而非按字段存在性。新字段只实现了「判据按条目比对」这一环，写入侧的托管与不可改写两环缺失，导致身份可自证、结论可覆写，而保证边界又只声明「非任意代码执行」，未覆盖完全发生在受控工具面内的旁路（属过度声明）。

## 解决

在 `execute`、`rebatch`、`revise` 三条写入路径上施加结构性剥离：`pre_reviews` 不接受调用方提供，一律只从落盘对象 `fm` 继承，`record_audit` 仅做追加；`create` 侧把 `pre_reviews` 加入禁止清单，创建时不得携带；同时把保证边界改写为真实限度，并让条文明确声明唯一写路径保证。修复后补四条旁路用例。

## 规避

**已被规范源吸收（2026-10-28，Human 决定废止）**：本段规避已由 `specs/04` §6.3「『与既有机制同等强度』的核对单位」承载（核对单位是整条证据保管链而非写入函数签名或单个环节的存在；须按四问逐环核对——谁能写、身份由谁盖戳、既有结论能否被改写、判据形态；任一环无对应条款即须如实声明该环无机械保障），强制落点为 `04` 第 10 节「验证与证据边界」表中「同等强度声明」行。自该条款生效起，本条不再独立承担约束，仅作为该规则的来源引用保留（`specs/23` §6.3、`specs/35` §8.6 第 3 项）。**引用时请以条文标题与章节号定位**：`04` 行号随改动漂移，本仓已发生过多起废止对象裸行号失准的情形。

以下为废止前的原始规避记录，保留为历史基线：

凡声称「与既有机制同构/同等强度」时，核对的单位是整条证据保管链而非写入函数签名；新增受控字段必须逐项回答四个问题——谁能写、身份由谁盖戳、既有结论能否被改写、判据按条目还是按字段存在性比对。凡边界声明以「非任意代码执行」作结时，须确认所防攻击面与声明面一致。

## 验证

旁路用例 16/16 通过，四条旁路（revise 伪造、create 直写、盖戳条目改写、门禁放行）全部被拦；变异测试临时撤掉结构性剥离后相关用例立刻变红、恢复后全绿，证明测试非空转；plugin 1539/1539、web 483/483、tsc 零错误、`build:dsh` 成功。修复后的第二次独立复核结论尚未返回，未覆盖：该复核可能提出的新增问题、以及未实测的其他受控写入路径是否还有同类旁路。

**独立复现验证结论（2026-10-17，23 §16.1）**：复现主体为本会话主控（session-39edc51b），未参与本候选形成（候选由 36 §10 机械通道形成，见 change_log 首条）；独立性边界：同一底层模型、不同上下文，未做跨模型验证。复现方式为**实际重走该失败机制的可观察步骤**（旁路攻击），结果如下：① **旁路确曾成立**——取修复前 writer（提交 `64bf2d4` 的 `workcase-writer.js`）置于副本 `/tmp/mut`，对 HEAD 现有的 20 条旁路/门禁用例跑 `node --test`，得 `tests 20 / pass 14 / fail 6`，失败的正是「F1 revise 伪造」「F1b create 携带」「F2 改写已盖戳条目」「execute 改写」「G1 自审不满足覆盖闸」「G2 回滚留痕」六条——修复前门禁可绕，与本候选症状逐字吻合；② **修复后成立**——HEAD 同一文件、同一组用例全 20 通过；③ **保管链四环真实存在**——`grep` 确认 `stampReviewEntries`、`assertReviewHistoryNotRewritten`、`guardAuditField`、`stripCallerOnlyFields` 均在 HEAD 落地，`revise`/`execute`/`rebatch` 三处调用 `guardAuditField` 回落落盘值，`create` 携带 `pre_reviews` 被拒；④ **根因真实存在**——修复前 `64bf2d4` 中 `stampReviewEntries`/`assertReviewHistoryNotRewritten` 的调用点仅接在 `reviews` 上（`next.reviews` 两处），未接 `pre_reviews`，即「只抄写入函数与判据、未抄托管与不可改写两环」在代码上成立；⑤ 修复提交 `4bbc9f6` 的消息逐字记载 plugin 1543/1543、web 483/483、tsc 零错误与两轮变异检验，与本候选验证段一致；该消息另记载**修复后的第二轮独立复核已返回「修复有效，无致命缺陷」并独立实测 F1/F1b/F2/execute/rebatch 五个面全部堵死**——即候选验证段中「第二次独立复核结论尚未返回」这一条现已闭合，其未覆盖项已被另一主体补齐。**据此把本条的未覆盖范围据实收窄**：第二次复核已返回且未提出致命缺陷；仍属实、但仍未被复现者实测的是「其他受控写入路径是否还有同类旁路」——本会话只核到 workcase-writer 的 pre_reviews/reviews 两轴。

**机械化承载（2026-10-28 盘点）**：`plugin/lib/workcase-writer.js:2344-2356`（`guardAuditField` 结构剥离/回落落盘值）、`:2279`（`stripCallerOnlyFields`）、`:2701`（`stampReviewEntries` 身份盖戳）、`:2794`（`assertReviewHistoryNotRewritten`），用例 `plugin/test/workcase-pre-gate1-audit.test.mjs:429/467/491/531/602`，它断言 `pre_reviews` 的唯一写路径是 `record_audit`、已盖戳结论不可被任何写路径覆写。覆盖边界：四环只落在 workcase-writer 的 `pre_reviews` 这一个字段上——没有检查「新增同形审核字段必须同样接上四环」（无字段登记表或元守卫），其他受控写入路径是否仍有同类旁路未实测（本条 scope 自认），「边界声明与所防攻击面一致」仍是文句而非判据。

**规范补写进展（2026-10-28）**：本条已由 `specs/04` §6.3 新增的「『与既有机制同等强度』的核对单位」吸收——该条把核对单位定为**整条证据保管链**（不是写入函数签名或单个环节的存在），并要求按四问逐环核对：谁能写、身份由谁盖戳、既有结论能否被改写、判据形态，答案须取自承载该对象语义的相邻规范既有条款；任一环无对应条款即须如实声明该环无机械保障。§1 有对应负担与风险登记，第 10 节「验证与证据边界」表有「同等强度声明」验证行。

## 影响与适用范围

适用于在受控写入路径上新增与既有证据链形态相近的审核/记录类字段，尤其是「抄一条已有链做新链」的实现场景；影响面为机制保证的真实性——缺保管链时相关条款的机械性声明不成立，据其做出的「未审不得放行」保证为空。范围：pre_reviews 之例；是否扩及其他字段需另行复核确认，本次未覆盖。
