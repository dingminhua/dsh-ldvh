---
title: Spark 草稿改写 summary 被拒
status: active
scope: 适用于经受控写入接口更新已有 Spark 事实对象、且更新草稿同时携带 summary 与正文的场合；经验的可靠边界是「frontmatter 字段须在对应正文节中逐字出现」这一不变量，以及「失败信封的 gaps 会给出定位」。
object_uid: 4d2fa3b5-4e12-4ac2-a1ba-4f1b5eb04b45
fact_type_key: pitfall
created_at: 2026-11-02T05:48:40.735Z
change_log:
  - at: 2026-11-02T05:48:40.735Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 闲时辅助经验积累·审核段据缓冲条目 9ffc10c9-c51d-4ac4-9b04-38837b6f05d5 形成候选（11 §10.2 第 3 项）
  - at: 2026-11-02T11:34:50.543Z
    provider: huoshan
    model: deepseek-v4-1-flash-261017
    summary: 登记独立复现验证结论（23 §16.1 第 3 项）：只改 summary 被拒时 issues 逐字回指「当前理解」节，summary 与正文节同改即通过——据此订正「接口不回指」「summary 不可改」两条判断，并把根因改写为载体内聚不变量
  - at: 2026-11-03T08:12:59.154Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 按 23 §16 第 1 项入档（draft→active）：独立复现验证已登记于 c1c63f8，四前提齐；同时清理症状段重复的引证行（勘误级）
  - at: 2026-11-10T11:35:25.243Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补 recall_digest：为召回提供高密度关键词面（02 §7.1）
---

# Spark 草稿改写 summary 被拒

## 症状

向已有 Spark 事实对象提交更新草稿时，同一份草稿连续两次被受控写入接口以 `spark/coherence_invalid` 拒绝。第一次拒绝后调用方误以为「接口不告诉我是哪一处坏了」，于是凭猜改动自己的编辑面——两次尝试之间唯一变动的内容面，是 summary 是否被一起改写。

逐字引证（来源：主控会话 turn 5，材料 [turn 5] assistant 段「**一处自我更正**」一句）：

`6317a233` 我第一版草稿把 summary 一起改写了，触发 `spark/coherence_invalid` 两次——最后改成「summary 一字不动、新增 H3 节给当前值」才过。

## 触发条件

- 对象已存在，走的是更新通道而不是创建通道；
- 更新草稿同时携带 summary 与正文，且调用方按「摘要也该反映当前值」的直觉把 summary 一起改写，**却没有同步改写正文的「当前理解」节**；
- 写入器的 coherence 校验要求 frontmatter 字段在对应正文节里逐字出现。

三个条件同时成立时，合法内容也会被判为不自洽。

## 根因

两件事叠加：

1. **frontmatter 是唯一权威文本**：`summary` 必须在正文「当前理解」节中**逐字出现**（`plugin/lib/spark-writer.js:564` `validateCarrierCoherence`，三对不变量：`question`↔调查问题、`scope_boundary`↔调查边界、`summary`↔当前理解）。只改 frontmatter 的 summary 而不改正文对应节，等于让两份文本分叉，校验按设计拒绝。
2. **拒绝信号被调用方误读**：接口**是**回指了哪一处的——失败信封的 `gaps` 里会带上 `carrier coherence: 当前理解 section must contain summary verbatim …`（`plugin/lib/spark-writer.js:1204-1206` 产出 issues，`plugin/lib/spark-tools.js:688` 把它拼进 `gaps`）。误判发生在读的一方：只看 `spark/coherence_invalid` 与「carrier coherence failed on update」这一行整体说明，没有读随后的 issues 行，于是把「有定位但没读」当成了「没有定位」。

## 解决

已实际采用：summary 一字不动，把要更新的当前值写进正文新增的 H3 节，再整体提交；该次写入通过。

更直接的解法（复现时验证过）：若确实要改 summary，就**让 frontmatter 与正文「当前理解」节同改**，使两份文本保持一致——这样同一份更新在 coherence 校验下是通过的。

成功信号：撤回对 summary 的改写、把值移入新 H3 节后不再被拒；或 summary 与「当前理解」节一并改写时不被拒。

必要边界：通过的前提是两份文本一致，不是「校验放宽了」；校验判据未变。

## 规避

更新已有 Spark 对象前，先认清 summary 是**与正文节绑定的权威文本**，不是可单独改写的描述字段：要改 summary，就同改「当前理解」节；只想在正文追加信息时，用新增 H3 节与既有节并存，summary 保持不动。

若收到 `spark/coherence_invalid`，**先读失败信封的 `gaps` 里 issues 行**——它逐字给出是哪一对不变量、哪一节缺了什么；不要凭猜改措辞，那只会消耗轮次（本条正是这样被记下的）。

例外：新建对象时 summary 与正文由本次内容一并给出，不存在分叉；本条只覆盖更新通道。

## 验证

已观察：改写 summary 的草稿连续两次被拒；撤回该改写并新增 H3 节后同一次写入通过（引证所指 `6317a233`）。

### 独立复现验证（2026-11-02）

**复现主体与独立性边界**：主控委派的独立子代理（受管辖隔离子代理，上下文不外泄给本候选），模型与主控相同（deepseek-v4.1-flash），派生于同一会话但上下文隔离；按 01 §12.2 读作「同模型 + 上下文隔离」，不是异模型独立验证。

**复现做法**：对同一 Spark 对象走更新通道做三组对照——①只改 frontmatter `summary`（正文不动）；②`summary` 与正文「当前理解」节同改；③`summary` 不动、正文只新增一个 H3 节。

**观察结果**：①连续两次被拒，码为 `spark/coherence_invalid`「carrier coherence failed on update」，issues 逐字为「carrier coherence: 当前理解 section must contain summary verbatim…」——**接口确实回指了具体字段与节**；②通过；③通过。

**判定**：机制成因与规避写法均复现成功；但候选原「根因」与「规避」两段的两条判断**不成立**：一是「接口只回一枚校验码、不回指哪一处」（issues 在场），二是「summary 在更新通道不可改」（与正文节同改即可）。本段已据此改写相应正文。

**未覆盖**：其它事实类型写入器的 coherence 是否同构（本次只查了 Spark）；该校验对「正文含 summary 但额外附加文字」的容差未逐一试探。

## 影响与适用范围

适用于经受控写入接口更新已有 Spark 事实对象、且更新草稿同时携带 summary 与正文的场合；经验的可靠边界是「frontmatter 字段须在对应正文节中逐字出现」这一不变量，以及「失败信封的 gaps 会给出定位」。

展开——凡以受控写入更新已有 Spark 对象者都可能踩到，尤其是把「给当前值换新」理解为「只改摘要」的写法；当对象类型、写入器版本或校验判据改变时，本经验的可信度随之失效，须重新实测后再复用。何时可信的反面也须记住：本条只覆盖**更新**通道，新建对象时 summary 与正文一并给出、不存在分叉，不适用本条的判断。
