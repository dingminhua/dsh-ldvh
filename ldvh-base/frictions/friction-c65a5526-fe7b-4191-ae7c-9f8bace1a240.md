---
title: 受控路由空答复不可区分致工单未建
status: resolved
phenomenon: 受控路由对「工具注册失败回滚候选」返回未取得有效选择、候选答复记录为空，助手据此未创建工单也未开始修复，该项在连续多轮只读盘点后以 blocked 收尾。
attribution: LDVH 受控提问路由（Human 提问接缝）的答复记录层：空答复不携带原因与呈现回执，「未选择」与「未呈现/被跳过」两类结果被压成同一记录，接缝可用性对主控不可观测，主控无法据此判断该重问、改道还是继续等待。
relations:
  - relation_key: informs
    target:
      commit: c07fead6cb5fe29dd795974aca8ce382bef053f0
object_uid: c65a5526-fe7b-4191-ae7c-9f8bace1a240
fact_type_key: friction
created_at: 2026-11-06T10:56:24.946Z
change_log:
  - at: 2026-11-06T10:56:24.946Z
    provider: openai-codex
    model: gpt-6.1-terra
    summary: 摩擦发现阈值晋升（观察缓冲同源条目 3 条 ≥ 3，11 §9 第 3 项）
  - at: 2026-11-10T11:36:53.168Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补 recall_digest：为召回提供高密度关键词面（02 §7.1）
  - at: 2026-11-12T22:22:20.311Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补充观察：count 3 → 4（11 §9 第 2 项）
  - at: 2026-11-13T16:39:22.054Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 核对后保持 open：解药 9638099e 只做到三值区分，review_ask 返回 null 仍无「是否已呈现」回执，第 4 次观察所指缺陷仍在；两候选终态 voided/resolved 均被实测排除
  - at: 2026-11-13T18:13:52.034Z
    provider: workbuddy
    model: hy4free
    summary: 补充观察：count 4 → 5（11 §9 第 2 项）
  - at: 2026-11-20T07:50:41.649Z
    provider: workbuddy
    model: hy4flash-free
    summary: Human Gate 销账：账目自设销账条件（呈现回执+可区分测试）已由解药 c07fead6 满足，informs 指向该 commit；36 §9.1 三条件成立，实测 review_ask 回执可判读。
occurrence:
  count: 5
  first_at: 2026-11-05T20:53:13.640Z
  last_at: 2026-11-13T18:07:18.454Z
---

# 受控路由空答复不可区分致工单未建

## 现象

受控路由对「工具注册失败回滚候选」返回未取得有效选择、候选答复记录为空，助手据此未创建工单也未开始修复，该项在连续多轮只读盘点后以 blocked 收尾。

### 该阻碍的历次观察（4 次，逐字引证）

1. （2026-11-05T20:53:13.640Z，session-e210c881 @ 28）已找到一个可复现的生命周期缺陷：插件卸载后，旧会话上的工具和事件监听没有一并清理。隔离测试中，新实例注册被同名旧工具挡住，而旧提问接缝已失效（来源：28）
2. （2026-11-05T22:18:00.938Z，session-e210c881 @ turn 20..28）老丁，刚才的真实路由再次返回「提问入口不可用」；候选记录仍为空（来源：turn 28 的 assistant 段）
3. （2026-11-06T09:15:01.692Z，session-e210c881 @ turn 33..50）工具注册失败回滚候选的受控路由返回未取得有效选择，候选答复记录仍为空（来源：turn 50 的 `<goal_blocked>` Blocked 字段；同一现象另见 turn 47「重启后提问入口有了响应，但本次没有取得有效的路由选择」与 turn 48「工具回滚候选上次没有取得有效路由选择；我没有重复提问」）
4. （2026-11-12T22:02:35.919Z）`ldvh_review_ask` 工具确实运行了但答复为 `null`，助手自陈分不清「你没被问到」和「你被问了但没选」；因两次未获答复而在下一回合放弃继续推进。逐字引证：「我无法从工具返回结果中得知你看到了什么」（来源：15）

## 入账依据

**不是偶发**：四次观察跨越 2026-11-05 至 11-12、跨两个不同的受控提问入口（工单路由与 `review_ask`），且每次后果相同——主控拿不到可判读的答复，只能按「未决策」处置，工作项停摆或改道。

**根因不在工单，在提问接缝的答复记录层**：空答复不携带原因与呈现回执，把「**未选择**」（问了、人看过、没选）与「**未呈现/被跳过**」（接缝本身不可用，问题根本没到人面前）压成同一条空洞记录。接缝可用性对主控不可观测，主控因此无法判断该重问、改道还是继续等待。

标题里的「致工单未建」只是首次观察的**后果形态**，不是根因所在——工单撤除后本条依然成立，第 4 次观察（`review_ask`）已直接证明这一点。

### 2026-11-14 核对记录：两个候选终态都不成立，本账据实保持待修

本次核对的目的是判定本账能否销账。结论是**不能**，两条路各被实测挡住：

**不是 `voided`**（阻碍未随工单消失）。解药只在部分路径生效：

| 路径 | 三值可区分 | 呈现回执 |
|---|---|---|
| 工单路由（第 1–3 次观察的入口） | ✅ 已随工单整体撤除 | 不再存在 |
| 把关询问 `review_ask`（第 4 次观察的入口） | ✅ `review`/`skip`/`null` 三值已区分 | ❌ **仍无** |

`review-ask.js` 返回 `null` 时只表达「未取得答复」，**没有携带「问题是否真的呈现给人」的回执**。主控拿到 `null` 依旧分不清「人没选」与「问题没送到」——第 4 次观察描述的正是这一点，它今天仍然成立。

**不是 `resolved`**（无解药可指）。`resolved` 需 `informs` 指向真正消除该阻碍的对象；`9638099e` 解决的是「三值区分」，不是「呈现回执」，故不构成解药。

**修复方向（供后续处理，非本条结论）**：需要一个让主控能判读「问题是否到达人前」的机制，例如询问工具在未作答时回带 `delivered`（是否进入 answerer 队列/被 remote 接受）与具名原因（`noAnswerer`/`CALLER_NOT_LIVE`），使「未呈现」与「人未选」可区分。`specs/32` 已就询问的留痕有规定，但**未规定呈现回执**——这属新的机制需求，需独立评估。

**复审触发**：待 `review_ask`（或其后继入口）能在未作答时回带「是否已呈现」的判据，且有一条用例钉住「未呈现」与「人未选」两种返回可区分——那时本条可销。若接缝改走其他通道，本条重核。

补充观察（2026-11-13T18:07:18.454Z）：材料中主控把这条链路查到收口：引证处指出 LDVH 自己的答复解析层用的 selectedLabelOf「只读 selected，完全无视 custom」；材料同段并称宿主卡片自由输入时提交的是 `{selected:[], custom:"..."}`（selected 被强制置空），而 LDVH 侧只认 selected，于是带文字的人工答复被投影成与「跳过」按钮同形的空答复（decision:null），Human 输入内容无任何落点且无报错。该阻碍的归因落点与机制模式与既有 open 账目 friction-c65a5526（c65a5526-fe7b-4191-ae7c-9f8bace1a240）一致：根在 LDVH Human 提问接缝的答复记录/解析层，两类不同的人工答复（「未选择/未呈现/跳过」与本次的「带自由文本的答复」）被压成同一份不含内容、不携带区分信息的记录，导致接
逐字引证：LDVH 自己的 `ldvh_review_ask` 解析答案时用的是 `selectedLabelOf`，它只读 `selected`，完全无视 `custom`
（来源：1）

## 处置

**解药（已落盘，Human Gate 销账）**：2026-11-20 经 Human 确认销账，解药提交 `c07fead6cb5fe29dd795974aca8ce382bef053f0`（chore: 收口工作区在途改动——提请文本守卫、自由文本可见性与事实对象补充）。该提交同时含：① [host-seams.js](plugin/lib/host-seams.js) 新增 `customTextOf`，在把关接缝明确区分 `free-text answer submitted (no option selected)` 与 `skipped / no option chosen`，并把自由文本以 `custom_note` 逐字回传、不冒充 review/skip；② [review-ask-tool.js](plugin/lib/review-ask-tool.js) 在未作答时回带 `asked`/`timed_out`/`timeout_seconds`/`reason`/`custom_note`；③ 专门用例 [ask-custom-visibility.test.mjs](plugin/test/ask-custom-visibility.test.mjs) 与 [review-ask-seam.test.mjs](plugin/test/review-ask-seam.test.mjs) 钉住「自由输入 vs 跳过」与「未呈现 vs 人未选」可区分。本会话主控多次实调 `ldvh_review_ask` 均收到带 `asked`/`timed_out`/区分性 follow_up 的可判读回执。账目 2026-11-14 核对记录所设销账条件——「未作答时回带是否已呈现的判据 + 一条用例钉住可区分」——已由该解药精确满足。

**销账成立核对（36 §9.1 三条件）**：① 解药可回指——informs 指向 commit `c07fead…`，全 40 位、git 可解析、`cat-file` 类型 commit；② 阻碍不再复现——三形态（自由文本被压成空答复、未呈现与人没选不可区分、呈现回执缺失）均已由解药消除且有测试钉住，本会话实测回执可判读；③ 修复覆盖账目范围——账目根因（答复记录/解析层把不同答复压成同一空洞记录）与销账条件均被 `c07fead6` 精确覆盖，无剩余。

**为何此时可销而 11-14 不可销**：11-14 时 `9638099e` 只做到三值区分（review/skip/null）、仍无呈现回执，故当时判不可销；此后 `c07fead6` 补上 `custom_note` 逐字回传与 `asked`/`timed_out` 呈现回执、并钉住可区分性测试，销账前提才成立。此处按实测更新结论，不推翻 11-14 当时判断的历史事实。

**代价保留**：销账不追溯抹去历史——5 次观察、2026-11-14 核对记录与 change_log 全部保留；「致工单未建」仅为首次观察的后果形态，工单撤除后本条仍成立并已由本解药消除，如实留痕。

**配对复审**：本账目无 `paired-with` 边，销账不触发配对经验去向判定。

（状态转换：open → resolved，Human 2026-11-20 确认销账；解药 commit c07fead…，依 26 §9.2 / 36 §9.1。）
