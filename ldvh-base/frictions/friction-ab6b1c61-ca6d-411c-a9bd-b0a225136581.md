---
title: 程序只认规范未登记的一种写法致过半工单核对读不出
status: resolved
phenomenon: 全库有「结果」节的工单中，核对条目解析为 0 条者过半，仅因解析器只接受未在规范中登记的「- criteria_checks:」入口与「步骤 N」前缀
impact: heavy
relations:
  - relation_key: informs
    target:
      commit: 613e98929558035699bfd3bd745a28d82cd1a14d
  - relation_key: informs
    target:
      commit: a71c571effe29048b81fff7049cc972cb5d952e7
  - relation_key: informs
    target:
      commit: fb82d8cdd90b02ac826317724871fac953723f11
  - relation_key: informs
    target:
      commit: 2ff9ffeb2f11c8c06ccba1232bb12f5492265656
object_uid: ab6b1c61-ca6d-411c-a9bd-b0a225136581
fact_type_key: friction
created_at: 2026-10-15T06:12:39.012Z
change_log:
  - at: 2026-10-15T06:12:39.012Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 摩擦发现机械通道创建（04 §8.4 第 3 项）
  - at: 2026-10-15T07:58:29.553Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补充观察：count 1 → 2（04 §8.4 第 2 项）
  - at: 2026-10-15T08:01:49.201Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 销账：呈现层照 §178 改认「计划步骤 N」、§190 登记形态并加写入侧门禁；现象段更正表述与实测口径，处置段登记修复与可重跑核对方式
  - at: 2026-10-15T08:03:07.678Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 事实更正（非状态转换）——更正：如实登记本次销账引入的 occurrence 回退（count 被陈旧值 2→1 覆盖，受控更新与 correct 皆无法修复；经核实无功能后果），并记下「frontmatter_after 只提交确需改动的字段」的纪律。终态判定未变：status/title/phenomenon/impact/attribution/created_at 逐字继承落盘对象，本入口不接收 frontmatter 值（两处例外，均为「字段之有无」而非「字段之值」：① 2026-10 起可显式删除已退出类型闭集的字段，本次删除：无；② 2026-11 起可补填新进入类型闭集的字段，本次补填：无），不得改值；其余可改范围为正文与 relations（26 §13）。经 Human 授权：Human 2026-10-15 指示「按你建议推进」（授权本次销账推进）；本条为如实登记同次销账写入引入的 occurrence 回退，属该推进范围内的事实更正
occurrence:
  count: 1
  first_at: 2026-10-15T06:12:23.879Z
  last_at: 2026-10-15T06:12:23.879Z
  human_return_at: null
---

# 程序只认规范未登记的一种写法致过半工单核对读不出

## 现象

全库有「结果」节的工单中，核对条目解析为 0 条者过半，仅因解析器只接受未在规范中登记的「- criteria_checks:」入口与「步骤 N」前缀。

**入账时的实测口径（2026-10-15T06:12Z，修复前）**：23 份含「结果」节的载体中 12 份核对条目解析为 0 条。**该数值随修复而失效**，保留于此仅为记录入账当时的观察；判据以本段末的「销账时实测」为准。

**销账时实测（2026-10-15，修复后）**：
- 全库 27 份含「结果」节的载体中，核对条目解析为 0 条者 23 份——**但该数已不表示同一阻碍**：其中 5 份为 `closed` 载体，其写法是「计划步骤 N 完成——…」（结论词「完成」不在 `specs/21` §190 登记的三词闭集内），且 `closed` 卡片的核对**取自 `result.criteria_checks` 字段、不经本解析器**（实测：`52314cf8` 读 6 条、`9208ce82` 读 3 条、`ccc2b91c` 读 4 条，全部在位），故对呈现无影响；其余为当期本就没有核对段的载体。
- **真正受本阻碍影响的一类**（`status = open` ∧ 正文含「## 结果」节——只有这一类的卡片靠本解析器取核对）当前仅 `workcase-562f75c1` 一份：修复前读出 0 条、修复后读出 6 条。

## 入账依据

材料可归因：解析器按自己挑选的入口解析，而该入口**未在任何规范中登记**；会阻碍主控正确核对工单达成情况（修复前 12/23 无法读出）。

**归因（销账时补记）**：`plugin/web/shared/workcaseResultDraft.ts` 的核对段解析器——它只认 `- criteria_checks:` / `- 判据逐条核对` 两个开启符与「步骤 N」前缀，而 `specs/21` §178 明文要求正文引用计划步骤时使用显式形式「**计划步骤 N**」。即**按规范写反而读不出**，且失败无任何报错（卡面渲染为空块）。

## 处置

**已修复并销账**（Human 2026-10-15 决定按建议推进）。修复由两组改动构成：

1. **呈现层照规范读取**（`613e989`）：核对条目前缀改认 §178 明文的「计划步骤 N」（含括号简述与「判据「…」」形态），并解除「判据「…」」对 `checks` 段头的依赖。
2. **形态登记 + 写入侧门禁**（`a71c571`）：`specs/21` §190 新增「核对条目登记形态」条，登记**唯一**前缀「计划步骤 N」；`plugin/lib/workcase-writer.js` 新增 `validateChecklistForm` 并接入 9 个写入入口共用的落盘汇聚点，**形态不合即拒绝落盘**（错误码 `workcase/checklist_form_invalid`）。此后同类写法无法再静默落盘。

其间另修出两处同族缺陷（`fb82d8c`、`2ff9ffe`）：残留块分割线的归属——线被挂在「行」上而该线的语义单位是「单元」，两版补丁后收敛为「线由单元容器承载，只在残留与残留之间画线」。

**核对方式（可重跑）**：
- 呈现层——对全库载体跑 `parseWorkCaseResultDraft`，断言「写有登记形态且核对段存在者，条目数 > 0」；
- 写入侧——`plugin/test/workcase-writer.test.mjs` 的 `checklist e2e` 用例走真实 `close` 入口，断言形态不合被拒且**零写入**，并有正负对照（登记形态放行）；
- 回归守卫——`plugin/web/tests/api/workcase-result-draft.test.ts` 钉住登记形态的四项机械判据。

**完成判据**：受本阻碍影响的类（`open` ∧ 含「## 结果」节）当前读出 6 条（修复前 0 条）；写入侧门禁对不合形态返回拒绝且不落盘。两项均有可重跑用例。

### 本次销账引入的一处回退（如实登记）

**不得据本账目的 `occurrence.count` 作任何阈值或频次判定。**

**事实**：本账创建后，摩擦发现机制于 2026-10-15T07:58Z 执行过一次补充级更新，其 `change_log` 摘要为「补充观察：count 1 → 2（04 §8.4 第 2 项）」，且该路径依 §8.4 第 5 项做了精确回读（旧值 + 1 与 `last_at` 均比对通过）——即机制侧当时**确实**把 `count` 写成了 2。

**回退原因（属实现方失误，非机制缺陷）**：随后**本次销账**（`update`）在 `frontmatter_after` 中提交了 `occurrence` 的**旧值**（`count: 1`、`last_at` 仍为创建时的时间），使机制刚写入的 `2` 被覆盖回 `1`。销账动作本不应触碰 `occurrence`——它是「重复观察的证据」载体，与销账无关；此处等于**用一个自己没打算改的字段的陈旧快照，覆盖了别人刚写的值**。

**为何无法修复**：本账已为 `resolved` 终态。① 受控更新（`update`）在终态被 §9.2 禁止，且 §9.3 明确「`resolved`/`voided` 为终态，计数冻结」；② 终态更正入口（`correct`）的**逐字不变清单显式包含 `occurrence`**，故它也不能改该字段。即**两个通道都触及不到**，`count` 将永久停留在与 `change_log` 不符的 `1`。

**影响范围（如实声明，不夸大）**：`occurrence.count` 的唯一消费方是 §9 的阈值触发（`observing → open` 需 `count ≥ 3`）。本账已是终态、不再参与该触发，故**该回退无功能后果**——它是一处账面不准确（`count` 与 `change_log` 自述不一致），不是活的缺陷。频次事实的真实下限为 2（创建 1 次 + 2026-10-15T07:58Z 补充 1 次，两次均有 `change_log` 留痕）。

**同族观察**：全库 Friction 账中另有 `7a64bbe2` 一份同样呈现「`count=3` 而 `change_log` 自称 `1 → 2`」的不一致，成因未核实，**本账不据以推断其同因**。

**机制侧无缺陷**：`plugin/lib/friction-discovery.js` 的补充路径按 §8.4 第 5 项做了正确写入与精确回读；缺口在**调用方**（本次销账）不该把无关字段的陈旧值一并回传。纪律：凡提交 `frontmatter_after` 者，须**只提交自己确实要改的字段**，无关字段应逐字继承落盘对象，而非取自读取时的旧快照。
