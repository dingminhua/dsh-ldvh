---
title: 受控写入补记身份致复核归属失真
status: resolved
phenomenon: 受控写入器在既有 reviews 条目缺失身份字段时，以本次写入会话的 session_id/implementer_session_id 补记，使复核条目被归属为补记者所有
impact: medium
relations:
  - relation_key: informs
    target:
      commit: b7d8f54dcda6bd44addb46441531d69e882f3b1e
object_uid: 6ce193a2-620a-4e6f-ad30-e647ab52f32d
fact_type_key: friction
created_at: 2026-10-19T16:33:36.006Z
change_log:
  - at: 2026-10-19T16:33:36.006Z
    provider: workbuddy
    model: space-bunny
    summary: 摩擦发现机械通道创建（36 §9 第 3 项）
  - at: 2026-10-19T16:46:11.232Z
    provider: workbuddy
    model: space-bunny
    summary: 补充观察：count 1 → 2（36 §9 第 2 项）
  - at: 2026-10-19T17:05:11.407Z
    provider: workbuddy
    model: space-bunny
    summary: 补充观察：count 2 → 3（36 §9 第 2 项）
  - at: 2026-10-19T17:05:11.412Z
    provider: workbuddy
    model: space-bunny
    summary: 阈值流转 observing → open（count 3 ≥ 3，36 §9 第 4 项）
  - at: 2026-10-19T17:17:38.842Z
    provider: workbuddy
    model: space-bunny
    summary: 补充观察：count 3 → 4（36 §9 第 2 项）
  - at: 2026-10-28T05:10:00.000Z
    provider: xiaomi-token-plan-cn
    model: mimo-v2.6-flash
    summary: 状态流转 open→resolved：解药为 commit b7d8f54（stampReviewEntries 第四处补记通道对齐「缺失即缺失」纪律：既有条目缺实施者基准即不计入，fail-closed），现象所指四处身份字段补记已全部封死；破坏性对照实测：正向用例翻红有分辨力，反向用例的分辨力止于独立性判据层（洗白使其通过该判据、关闭被下一道门禁拦下），测试注释「close 即 ok=true」的自述未获实测证实，实测口径记于处置段
occurrence:
  count: 4
  first_at: 2026-10-19T16:33:31.449Z
  last_at: 2026-10-19T17:17:31.984Z
---

# 受控写入补记身份致复核归属失真

## 现象
受控写入器在既有 reviews 条目缺失身份字段时，以本次写入会话的 session_id/implementer_session_id 补记，使复核条目被归属为补记者所有

## 入账依据
该阻碍会持续污染 Gate 2 独立性判定的机械基准且存量不可复原，机械层无法区分原产出身份与事后补记身份；修复它可让独立复核的机械校验重新具备判别力。既有账本中最接近的 friction-2de1387a「reviews 字段无法写入致 Gate 2 收口卡死」机制相反（写不进去 vs 写错身份），不是同一阻碍。

补充观察（2026-10-19T16:46:05.992Z）：材料记载受控写入的盖戳逻辑对既有条目缺失身份字段时仍以本次写入会话回填，污染 Gate 2 独立复核的比对基准；这与既有账目 friction-6ce193a2「受控写入补记身份致复核归属失真」是同一阻碍（同机制再复现，implementer 侧残留）。注意材料因长度上限在 turn 3 中途被截断，判断只基于所见部分。

补充观察（2026-10-19T17:05:05.201Z）：材料中助手解释的机制是：受控写入 `stampReviewEntries` 在盖戳时对既有条目缺失字段用「本次写入会话」身份回填 `implementer_session_id`，从而使 Gate 2 独立复核门禁所比对的两个身份字段被后来写入污染，且机械层无法甄别哪些值是当初真实记录、哪些是补记的。这与既有账目 friction-6ce193a2「受控写入补记身份致复核归属失真」（uid 6ce193a2-620a-4e6f-ad30-e647ab52f32d）描述的机制完全一致，属同一阻碍而非新阻碍。

补充观察（2026-10-19T17:17:31.984Z）：材料指出 workcase-4af2b871 的 reviews[0] 中 implementer_session_id 缺失时被本次写入会话回填、字段归属失真，这与既有账目 friction-6ce193a2「受控写入补记身份致复核归属失真」是同一阻碍（同为受控写入补记身份致归属失真），非新账。

## 处置
解药为 commit 级修复 `b7d8f54dcda6bd44addb46441531d69e882f3b1e`（fix(workcase): 缺实施者基准的存量条目不得被盖上当前实施者，2026-10-28；解药走直提路径、无对应 ADR/WorkCase 事实对象，依 02 §8.1 commit 形态承载 informs）。

本账现象点名的两个字段分两半修：`session_id` 半边早已在 2026-09-19/27 两轮修复中改为「既有条目保留原值、缺失即缺失」；本次修掉的是**残留半边** `implementer_session_id`——`stampReviewEntries` 原写作 `storedImplementer ?? implementerSessionId`，即一条当初没记下实施者的历史条目，在 takeover/reallocate 换过 attempt 后再被写一次就会被盖上**新的**实施者身份，该条目随即满足「记录者 ≠ 实施者」而被关闭门禁当作独立证据——正是 2026-09-19 把判据收紧为「逐条与其当时的实施者比对」所要挡的那件事，从另一侧绕了回来。本次把第四处对齐为同一纪律：`isExistingEntry ? storedImplementer : implementerSessionId`，既有条目缺失即不计入（fail-closed，与「未知不等于独立」同纪律）。

核验（2026-10-28，含破坏性对照实测）：① 修法在 HEAD（`plugin/lib/workcase-writer.js`，effectiveImplementer 行，成因注释同段）；② 两条新测试在 HEAD（`plugin/test/workcase-writer.test.mjs`），分辨力经临时回退旧写法实测：**正向用例**（心跳后字段仍须缺失）在仅回退 `implementer_session_id` 半边时即翻红，有分辨力；**反向用例**（洗白路径须被关闭门禁拒绝）在仅回退该半边时仍判通过——因来源半边（2026-09-19 已修）仍 fail-closed、条目依旧不计入独立判据；两半同时回退时该用例翻红，但错误码变为 `workcase/review_form_not_subagent`：即洗白确实使该条目**通过了独立性判据**（本账所指的危害已发生），关闭随后被下一道门禁拦下。测试注释所称「恢复旧写法 close 即得 ok=true」未被实测证实（该条目不带子代理来源，下一门禁必拦），实测口径以本段为准。③ 实验后两文件已逐字恢复至 `b7d8f54` 提交态，全套 153 例 153 pass。

边界（如实声明）：本笔只主张**经写入器路径写入**的条目不再被补记——存量已污染的条目（历史上已被旧写法盖上补记身份者）**不可复原**，机械层仍无法区分其原值与补记值，此点是本账入账依据里已明记的固有损失，销账不消除它；另「直接改文件注入条目」不经写入器，不属本解药覆盖面。实施前的工作区改动（本修复＋两条测试）为本会话接手前已在工作区落盘的未提交内容，本会话核对其完整性与测试通过后受控提交，改动归属按 09 §5.7 判为接手前已存在、经核验采纳。

载体侧留痕（2026-10-28 本次更新）：本载体 `occurrence` 原含 2026-10 闭集收缩后已退出的历史子件 `human_return_at: null`，本次随流转一并移除（`count`／`first_at`／`last_at` 三件逐字保留，非改值、非计数）。
