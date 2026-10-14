---
title: direction 冲突拒绝零信息量
status: resolved
phenomenon: 事实规范创建被 ERR_DIRECTION_ALREADY_EXISTS 拒绝后，错误不携带「哪个 direction_key 已被谁占用」，AI 在同一会话内反复重建同一 direction_key 并再次被拒。
attribution: 规范写工具的错误通道设计：27 §6.2 把去重定为 AI 对 direction_key/title 的语义比较、机制只检查 direction_key 是否已存在，该分工合理但代价未被承接——ERR_DIRECTION_ALREADY_EXISTS 只报告冲突事实，不回传占用方身份（object_uid/title/status），也不给出应改用什么；AI 因此在拒绝中得不到任何新信息，只能原样重试
impact: medium
relations:
  - relation_key: informs
    target:
      commit: 14223fcc61c38eca2f8e5b2170816b97ce3d5d57
object_uid: cccb379f-1514-4e6f-9a9d-361309bd2b4a
fact_type_key: friction
created_at: 2026-10-09T14:48:42.804Z
change_log:
  - at: 2026-10-09T14:48:42.804Z
    provider: workbuddy
    model: space-bunny
    summary: 初次创建：Norm 创建被 ERR_DIRECTION_ALREADY_EXISTS 拒绝后错误不携带占用方信息，AI 在同一会话反复以同一 key 重试。本轮 12 小时内实测 46 次命中、跨 8 个会话，其中单会话 session-17f13255 占 26 次。三条件核对成立
  - at: 2026-10-10T02:35:06.455Z
    provider: workbuddy
    model: space-bunny
    summary: 移除 serves 字段（26 号 2026-10 修订：serves 无消费方，§18 第 1 条禁止无消费方装饰字段；归属信息由 attribution 承载）
  - at: 2026-10-10T09:11:01.850Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 回填 occurrence（26 §8 新增必填字段）：count=1、first_at=last_at 取既有时间锚——存量对象在本次字段引入前创建，无可考的重复计数，故保守记为首见一次
  - at: 2026-10-11T22:32:34.186Z
    provider: ds-yue
    model: deepseek-v4-flash
    summary: 放回留观（Human 2026-10-11：观察次数<3 的摩擦移入留观；本条 count=1 未达阈值，写入 human_return_at 防机械通道回翻，26 §9.2），并修复重复 H1
  - at: 2026-10-14T03:25:55.147Z
    provider: ds41
    model: deepseek-v4.1-flash
    summary: 销账（Human 2026-10-14 授权）：拒绝通道补占用者身份（title/status）并由工具层渲染进 gaps（14223fc），旧写法的整体落空已由「以真实载荷断言两半」的测试锁死；判据扩扫确认非 issues 载荷全仓仅此一处
occurrence:
  count: 1
  first_at: 2026-10-09T14:48:42.804Z
  human_return_at: 2026-10-11T22:31:56.000Z
  last_at: 2026-10-09T14:48:42.804Z
---

# direction 冲突拒绝零信息量

## 现象

事实规范创建被 ERR_DIRECTION_ALREADY_EXISTS 拒绝后，错误不携带「哪个 direction_key 已被谁占用」，AI 在同一会话内反复重建同一 direction_key 并再次被拒。

创建 Norm 时 direction_key 的唯一性由机械门禁保证（27 §11 item 3，同一 direction_key 只允许一个 active Norm），冲突时返回 ERR_DIRECTION_ALREADY_EXISTS。但该错误只报告冲突事实，不报告占用方的身份（哪个对象、什么标题、什么状态），也不给出「应改用什么」的路径。AI 若未先做语义查重，就会以同一个 key 反复重试——每次都是一次完整的工具往返与一次 fail-closed 拒绝，且拒绝理由逐次相同，不含任何新信息。

本轮 12 小时内的实测频次（会话日志扫描，共 46 次命中，分布在 8 个会话）：

- session-17f13255：26 次（占全部命中的 56%），单会话内反复重试同一 key
- session-efdbe6a4、session-936d7ffa、session-8f9addcd、session-5f95402b：各 3–5 次
- session-b29e50eb、session-5cabd38a、session-12afb80c：各 3–4 次

该 46 次全部属于证据等价的重复——同一错误码、同一失败路径、同一无信息增量的拒绝。

**放回留观说明（Human 2026-10-11 指示：观察次数小于 3 的摩擦移入留观）**：本条 occurrence.count=1（<3，未达 04 §8.4 阈值 N），由 Human 放回 observing 留观；本流转已写入 occurrence.human_return_at，机械通道不得据 count 回翻（26 §9.2）。

## 入账依据

**重复出现**：本轮 12 小时内 46 次命中、跨 8 个会话，其中单一会话 26 次，远超 26 §10 的「≥3 次或证据等价的重复性」门槛。且失败路径的结构性根源不依赖具体内容——每次创建 Norm 而未先查重都会落入同一循环，故不是单次卡顿。

**可归因**：根因在规范写工具的错误通道设计上。27 §6.2 明确「去重（27 §6.2）是 AI 对 direction_key/title 的语义比较，机械只检查 direction_key 是否已存在」——这一分工本身是合理的（语义比对无法机械化）。但分工的代价未被任何环节承接：机械侧在检测到冲突后，只抛出错误码而不把「已被谁占用」这一决策所需事实回传给 AI，AI 因此无法从拒绝中学习到任何新信息，只能原样重试。若错误通道携带占用方的 object_uid 与 title，AI 一次即可转入「读既有对象 → 判断是复用/修订/换 key」的正确路径。

**修了会改善什么**：若 ERR_DIRECTION_ALREADY_EXISTS 的错误通道携带占用方标识（object_uid、title、status），AI 在首次被拒后即持有决策所需信息，重试循环被切断——本轮那 46 次往返中的绝大部分可省去；更根本的改善是「fail-closed 拒绝」从「零信息量的墙」变为「可行动的提示」，这符合 00 §5 中「机械拒绝须可被 AI 理解并据此改变行为」的意图。

**未指定解药（如实登记）**：解药属工具侧改动（错误通道增加占用方上下文），也可能需要在 27 号规范中补一句「AI 在被 ERR_DIRECTION_ALREADY_EXISTS 拒绝后应先读占用对象而非重试」的流程约定。两者孰先属 Human 决定项，本条不自行选定，故 status 保持 open、relations 不出现。

**与既有账目的关系**：无同题摩擦。与本轮同期发现的「execute payload 静默丢字段」同属「机械通道未把决策所需信息传给调用方」一族，但机理不同（一个是拒绝时信息不足，一个是接受时信息丢失），故分列两账，不合并。

## 处置
解药为提交 `14223fcc61c38eca2f8e5b2170816b97ce3d5d57`（写入器载荷补占用者 title/status；工具层新增 `renderDirectionConflictGaps` 并把对象型 details 渲染进 `gaps`），依 02 §8.1 commit 形态进入 `informs`。

核验（2026-10-14，第 1 批）：

- **旧行为实测**：以一次注定被拒的 create 调用（body 缺必需 H2 节）探测错误通道，旧写法 `...(Array.isArray(details) ? details : [])` 对对象型 details 恒为假——拒绝里只有错误码与泛化描述，占用方身份整体落空。这正是本账所指的「零信息量」。
- **新行为**：`plugin/test/norm-writer.test.mjs` 新增测试把**写入器的真实冲突载荷**喂进工具层的映射器，同时断言两半——写入器侧 `details.conflicts[0]` 带 title／status／object_uid，工具层侧 `gaps` 出现占用者标题与 uid。两半由同一条测试锁住，避免规则漂移成两份（该教训在 09 §5 的测试基线里）。
- **判据扩扫（非点名清单）**：以「写入器随错误携带非 `issues` 的结构化载荷」为判据，扫全部 `plugin/lib/*-writer.js` 的 `failure(code, message, {...})` 第三参数，命中仅 norm 的方向键冲突一处——本形态只有这一个产地，无同类未修点。
- 全量测试 1448/1448 通过；判据面 eslint 0 错。

**据实声明**：解药只覆盖了本账「入账依据」末段列出的两个可能方向中的**工具侧**那一个；另一个方向（在 27 号规范中补「被拒后应先读占用对象而非重试」的流程约定）**未被吸收**。本条按现象（拒绝不携带占用方身份）已消除而销账，不主张该流程约定已落地。
