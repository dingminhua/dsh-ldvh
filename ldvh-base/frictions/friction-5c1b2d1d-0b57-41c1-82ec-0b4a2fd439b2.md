---
title: record_review 取不到子代理复核结论
status: open
phenomenon: record_review 取不到子代理复核结论，六份已取得且判定成立的复核结论无一进入 reviews 字段，工单 close 因此被机械拦下。
attribution: 工单复核记录链路（record_review 通道）的取数接缝：父会话凭 reviewer_child_agent_id 从宿主子代理登记表读取子代理 turn-end 捕获的最终产出，再经逐字摘录写入 reviews；该接缝跨登记表、结论捕获与摘录校验三段，任一段失配都表现为 reviews 为空、close 被拦，缺少把「已取得的非空结论」与「未入账」对应起来的可观测绑定。
object_uid: 5c1b2d1d-0b57-41c1-82ec-0b4a2fd439b2
fact_type_key: friction
created_at: 2026-11-04T14:45:21.539Z
change_log:
  - at: 2026-11-04T14:45:21.539Z
    provider: qoder
    model: dfmodel
    summary: 摩擦发现阈值晋升（观察缓冲同源条目 3 条 ≥ 3，11 §9 第 3 项）
  - at: 2026-11-04T18:37:15.752Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 补充观察：count 3 → 4（11 §9 第 2 项）
  - at: 2026-11-04T18:59:49.259Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 补充观察：count 4 → 5（11 §9 第 2 项）
  - at: 2026-11-04T18:59:49.265Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 补充观察：count 5 → 6（11 §9 第 2 项）
  - at: 2026-11-04T19:12:13.673Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 补充观察：count 6 → 7（11 §9 第 2 项）
  - at: 2026-11-05T06:31:01.915Z
    provider: workbuddy
    model: hy4free
    summary: 补充观察：count 7 → 8（11 §9 第 2 项）
  - at: 2026-11-10T11:36:38.960Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补 recall_digest：为召回提供高密度关键词面（02 §7.1）
occurrence:
  count: 8
  first_at: 2026-11-03T22:18:47.703Z
  last_at: 2026-11-04T21:13:24.099Z
recall_digest: record_review 取不到子代理复核结论 六份判定成立 无一进入reviews close被机械拦下 结论回传通道
---

# record_review 取不到子代理复核结论

## 现象
record_review 取不到子代理复核结论，六份已取得且判定成立的复核结论无一进入 reviews 字段，工单 close 因此被机械拦下。

### 该阻碍的历次观察（3 次，逐字引证）
1. （2026-11-03T22:18:47.703Z，session-380a02f5-68d0-41d4-a111-94c78850cc03 @ 28）系统采用的结论文本是「已完成第二轮独立复核并把结果发给父会话。」——这句不含判据七要素，作为复核记录不合格。
（来源：28）
2. （2026-11-04T14:15:52.706Z，session-10205965-a3ad-42e3-b31b-d876213cd1b9 @ 29）13 轮排查确认：`record_review` 失败的原因是 `child-session-record.js` 只走宿主 `handle.read()`、**缺少 `locate` 文件回退链**
（来源：29）
3. （2026-11-04T14:29:15.577Z，session-10205965-a3ad-42e3-b31b-d876213cd1b9 @ turn 4..29）6 份独立复核结论我全部拿到且一致判 7/7 成立、无阻断，但**没有一份进入 `reviews` 字段**
来源：本次材料 turn 29 的 assistant 收尾段「尚未验证的事」第三条（会话 id 与文件位置未随材料交付，仅能定位到该轮回复正文）

## 入账依据
独立复核结论已取得且判定成立，却在「子代理会话最终产出 → record_review → reviews 字段」这一取数接缝整体丢失，六份结论无一入账，工单 close 被机械门禁拦下。该接缝是每次独立复核的必经路径，失败不依赖某一次操作；同一现象已在摩擦缓冲同一组累计 2 条，本轮再增 1 条即达 N=3 可晋升为账目，说明它构成系统性阻碍而非单次卡顿。

补充观察（2026-11-04T18:24:57.904Z）：材料中反复出现同一阻碍：三个复核子代理在插件侧 scope=null、无 ldvh_* 工具面，record_review 一律报 "no captured conclusion"，reviews 因此为空，Gate 2 关闭被 workcase/review_required 机械拒绝，工单停在 open（turn 4、turn 5、turn 6）。该阻碍的归因落点与既有 open 账目 friction-5c1b2d1d「record_review 取不到子代理复核结论」完全同源——工单复核记录链路（record_review 通道）的取数接缝在登记表命中但结论为空时不回退到子代理会话记录，表现为 reviews 为空、close 被拦；turn 6 更把落点指到 plugin/lib/workcase-tools.js:1046。故报 same-obstacle 并给出该账目 uid
逐字引证：reviews 是空的，三轮结论只在会话转录里
（来源：6）

补充观察（2026-11-04T18:50:39.260Z）：三个复核子代理的结论未被 record_review 捕获，reviews 字段为空，Gate 2 关闭被 workcase/review_required 拒绝。
逐字引证：工具面没有 `ldvh_*`，`record_review` 一律报 `no captured conclusion`
来源：会话 turn 4（2026-11-05T02:02:05+08:00）助手回复；另 turn 5 记录拒绝原文 "workcase/review_required: Gate 2 closure requires at least one reviews entry (independent review) before closing — reviews is absent or empty."

补充观察（2026-11-04T18:50:39.277Z）：材料自述「上次卡住的原因是 record_review 在『注册表里有子代理、但结论为空』时直接拒绝，不回落到子代理的会话记录」，且「宿主重启后注册表清空，同一条通道就走到了 durable 路径」。这与既有 open 账目 friction-5c1b2d1d 的归因落点完全一致：其根源记为「工单复核记录链路（record_review 通道）的取数接缝——父会话凭 reviewer_child_agent_id 从宿主子代理登记表读取子代理 turn-end 捕获的最终产出……该接缝跨登记表、结论捕获与摘录校验三段，任一段失配都表现为 reviews 为空、close 被拦」。本条材料出现的阻碍正是该接缝在登记表有子代理、结论为空时不回落 durable 路径的同一机制，现象（复核结论未入 reviews、close 被拦）与根源（record_review 取数接缝）都相同，故判为同一
逐字引证：在「注册表里有子代理、但结论为空」时直接拒绝，不回落到子代理的会话记录
（来源：7）

补充观察（2026-11-04T19:00:47.374Z）：该引证直接落在既有 open 账目 friction-5c1b2d1d（record_review 取不到子代理复核结论）的同一归因落点上：账目归因写的是「工单复核记录链路（record_review 通道）的取数接缝……缺少把「已取得的非空结论」与「未入账」对应起来的可观测绑定」，本条材料讨论的正是同一接缝的另一个分支——登记表命中但 conclusion 为空时 resolveCitedChild/resolveChild 无出口（材料另述 record_review/record_audit 两轴同构、直到宿主重启才走 durable）。根源子系统（record_review 取数接缝）与机制模式（结论捕获到入账之间缺可观测绑定、空结论状态被混同）均相同，故按归因而非措辞判为同一阻碍。材料中另一分支（真实审核子代理 42 条 assistant/message 无文本、结论在 str
逐字引证：现有 durable 回落只覆盖“注册表里没有这条记录”，而“注册表里有记录但结论为空”是它没覆盖的另一种情况。
（来源：4）

补充观察（2026-11-04T21:13:24.099Z）：工单关闭前已取得的复核结论未能被 record_review 收下，reviews 为空导致 close 被机械拦下，直到宿主重启、子代理登记表清空后同一通道才读到结论。
逐字引证：重启前那三轮结论只能留在转录里
来源：主控会话 turn 7，assistant 回复「重启解决了什么」一节（[turn 7] assistant 第 2–4 段）；对应工作单 workcase-608786b8 的关闭过程。
