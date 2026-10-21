---
title: 助手回复正文混入默认提示残片
status: open
phenomenon: 助手本轮回复的正文中出现了与任务无关的默认提示文本行「You are a helpful assistant.」，位置在两段中文正文之间。
impact: medium
object_uid: 9f07a3f5-9cd1-4db1-a233-f11f84b93d4f
fact_type_key: friction
created_at: 2026-10-21T16:10:40.060Z
change_log:
  - at: 2026-10-21T16:10:40.060Z
    provider: dsh-opencode-go
    model: minimax-m3.1-flash-free
    summary: 摩擦发现机械通道创建（36 §9 第 3 项）
  - at: 2026-10-21T16:21:40.295Z
    provider: workbuddy
    model: minimax-m3.1-flash
    summary: 补充观察：count 1 → 2（36 §9 第 2 项）
  - at: 2026-10-21T16:31:20.263Z
    provider: workbuddy
    model: minimax-m3.1-flash
    summary: 补充观察：count 2 → 3（36 §9 第 2 项）
  - at: 2026-10-21T16:31:20.275Z
    provider: workbuddy
    model: minimax-m3.1-flash
    summary: 阈值流转 observing → open（count 3 ≥ 3，36 §9 第 4 项）
  - at: 2026-10-21T16:46:41.620Z
    provider: dsh-opencode-go
    model: minimax-m3.1-flash-free
    summary: 补充观察：count 3 → 4（36 §9 第 2 项）
  - at: 2026-10-21T17:20:06.315Z
    provider: dsh-opencode-go
    model: minimax-m3.1-flash-free
    summary: 补充观察：count 4 → 5（36 §9 第 2 项）
  - at: 2026-10-21T17:48:58.405Z
    provider: workbuddy
    model: minimax-m3.1-flash
    summary: 补充观察：count 5 → 6（36 §9 第 2 项）
occurrence:
  count: 6
  first_at: 2026-10-21T16:09:26.654Z
  last_at: 2026-10-21T17:48:18.461Z
  human_return_at: null
---

# 助手回复正文混入默认提示残片

## 现象
助手本轮回复的正文中出现了与任务无关的默认提示文本行「You are a helpful assistant.」，位置在两段中文正文之间。

## 入账依据
可归因：该行独立成段地出现在助手面向用户的中文正文中间，其内容与本轮任务（梳理并迁移 36 号规范）无任何逻辑关系，也不在本轮要求的输出形态（结论+dsh-ui 表格）之内，属非本轮生成意图的残片文本混入；修复预期：若在输出生成或呈现环节过滤/隔离此类默认提示残片，用户可见回复、以及被主控抄录进规范载体的正文将不再夹带无关系统提示行，抄录方不必逐段剔除。影响路径不依赖宿主是否把该行写入文件，故列为独立条目。

补充观察（2026-10-21T16:21:16.913Z）：材料 turn 30 的 assistant 段中，「You are a helpful assistant.」作为独立段落连续出现三次（分别夹在「核对收尾四章：」「现在检查 §17 与 §20」「现在核对§20，确认是否有「领域增量」，以及是否仍绑定03：」之后）。该文本是宿主默认提示残片而非本次规范迁移任务的行文内容，与既有账目「助手回复正文混入默认提示残片」(friction-9f07a3f5) 描述的阻碍完全同型，故判为同一阻碍。

补充观察（2026-10-21T16:30:41.487Z）：材料中助手正文内多处出现默认提示残片「You are a helpful assistant.」，独立成句出现在规范结构核对段落之间（如「现在检查 §17 与 §20，看它们是否属于业务系统增量：」之后紧接该句，共出现三次）。该现象与既有账目 friction-9f07a3f5「助手回复正文混入默认提示残片」所述机制一致，属同一阻碍的再次出现，故判为 same-obstacle 并回指该条 uid。说明：本次材料因长度上限被截断（止于「…故 03 不列入 basis」处断句），仅就所见部分判断；材料中另有关于 parent_spec/basis 自相矛盾的助手自述错误，因本次只产出一条摩擦判断，未另立条目。

补充观察（2026-10-21T16:46:23.663Z）：材料中助手回复正文里反复出现系统默认提示残片「You are a helpful assistant.」（turn 31 首个助手回复中段、turn 32 助手回复中段、turn 33 助手回复开头之后），与既有账目 friction-9f07a3f5「助手回复正文混入默认提示残片」所记为同一阻碍、同一机制，故判 same-obstacle 并填其 uid，不另起新账。附带观察（未另开条目）：turn 31 同一条助手回复中「我如实说明查到了什么。」与后段「查清楚了。我如实回答你。」并存，呈现多段重写拼接的痕迹，与该残片混入同源。材料因长度上限被截断（turn 33 结尾停在「…是永久二选一（启用定」），故只能就所见部分判断。

补充观察（2026-10-21T17:19:19.957Z）：本次材料中，助手回复正文里连续出现默认提示残片「You are a helpful assistant.」（turn 36、37、38 的 assistant 段各有出现，turn 37 的 assistant 行即为独立一行）。这与既有账目 friction-9f07a3f5「助手回复正文混入默认提示残片」在现象层完全一致，因此判为 same-obstacle 并指向该 uid，不新开账目。（本次材料按长度上限被截断——turn 36 末尾停在「须写明「留观」、turn 37 停在「规范改动、turn 38 停在「{"type":"steps","steps":[{"title":"用宿主能力替换自造机制"——各轮均不完整，故只就所见部分判断；该截断本身与既有 friction-16b28b88 同类，但本次仅能确证助手输出侧残片这一项。）

补充观察（2026-10-21T17:48:18.461Z）：材料 turn 43 的 assistant 正文里，修复进展的叙述之间至少四次出现独立的「You are a helpful assistant.」行——这是默认提示模板被写进了助手回复正文，而非本轮实际内容。既有账目 friction-9f07a3f5 的标题正是「助手回复正文混入默认提示残片」，机制与现象一致，故判为同一阻碍而非新增。材料因长度上限被截断（止于 turn 44 中段），故仅就所见片段判断；所见部分未出现与既有账目明显异构的阻碍证据。
