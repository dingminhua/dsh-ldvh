---
ldvh_spec:
  spec_key: "spark-fact-type"
  spec_id: "20"
  spec_kind: "spec"
  title: "Spark-火花"
  canonical_path: "specs/20-Spark-火花.md"
  parent_spec: "fact-model-foundation"
  relation: "refines"
  positioning: "定义 Spark 事实类型的目的、对象边界、字段、状态、方向主线语义、合并/拆分关系与终态处理，是一切值得跨行动推进之事的出生地与主线入口"
  scope: "适用于管辖项目中承载方向主线与悬置问题的 Spark 对象；不定义调研执行流程（交给 30 号调研系统）、不定义 WorkCase 授权、也不定义 Initiative 专项"
  basis:
    - "source-of-truth-traceability"
    - "goal-fact-type"
  authorized_attachments: []
  dimensions: ["research"]
---

# Spark-火花

## 1. 价值判断

Spark 解决工作缺乏锚点、方向无承载、目标不清晰、外部信息缺失等问题的持续成本：跨会话未收敛信息反复丢失、重复讨论、被过早升级为行动或决定、有价值的方向因为没有事实身份而无处可循，以及无法明确退出入口。Spark 以方向主线层承载这些内容：**Spark 是一切的起点——任何值得跨行动推进的事（一个想法、一个方向、一个未决问题、一个待议议题）从 Spark 出生**；方向推进过程中已收敛的理解沉淀在 summary、实质转折记录在 evolution，结晶物（决定、执行、调研、教训）按各自类型提取，Spark 主线与它们共存并保持入口地位。目标已定（那是 25 号 Goal 的冻结锚）；Spark 承载方向本身——含其当前理解、未决部分与演进脉络。普通文件或 README 不能无损承载：它们无受控写入、无 change_log、无状态闭集、无 Gate 1 引用契约。Spark 同时填补 WC 授权层 Gap 与调研系统之间的跨层桥梁：调查问题 → 调研报告 → 交付决策。（方向主线语义，Human 决定 2026-09-10：Spark 放开为宽入口——v4 实证 103 个 Spark 的宽口径实践证明可行，v5 初版把入口收窄到「不可判定悬置问题」造成已设计待开发方向无家可归的真空。）

Spark 主要支撑 V2 充分理解、V3 边界识别、V5 据实判断、V6 工作接续（跨会话恢复悬置内容并接续判断）与 V8 持续积累（后续事项复用悬置经验与结论）；面向 Human，Spark 承接 HV3 入档闭环节点可验与 HV5 项目演进脉络可循（早期意图、关键转折与理解材料）。

Spark 不承接 HV1、HV2；对象存在、数量或终态也不证明 HV4 或项目演进脉络已经形成。Spark 的终态只结束入口职责（implemented ≠ 下游完成），不表示 WorkCase、项目、规则、代码或提交已经完成——这是防「交了就当完成」的自欺防线，v4 被误解最深但语义正确的设计。

## 2. 规范依据

1. `fact-model-foundation`：03 §6.1 公共身份字段、§6.2 载体与权威位置、§7.2 公共关系形状、§8 召回分层、§9 受控读写、§10 事实变更与生命周期、§11 类型规范共同结构。
2. `source-of-truth-traceability`：06 §6 受控提交契约、§5 事实源与溯源。
3. `goal-fact-type`：25 §6 sub-goal（SG-n）锚点语义、§11 修订级联的 Spark 豁免。

本文不依赖外部语法或行业标准定义 Spark 类型语义。既有候选记录、v4 实证（103 个 Spark）与重建锚点文档（`docs/spark-workcase-rebuild.md` §5/§6）只用于识别设计意图，不证明当前规则成立。发生冲突或权威关系无法确认时，按 00 §7.2 暂停受影响范围并完成对齐。

## 3. 职责边界

### 3.1 本文负责

1. Spark 类型的对象边界（悬置语义、问题定位）；
2. Spark 的身份与载体（平铺单文件，`ldvh-base/sparks/spark-<uid>.md`）；
3. Spark 的字段契约（question、scope_boundary、intent、summary、evolution、disposition 等）；
4. Spark 的状态闭集（open/implemented/discarded）与终态处理；
5. Spark 的合并/拆分关系契约（merged-into/split-into）与去向校验；
6. Spark 与 Goal/sub-goal、WC、调研系统之间的引用契约。

### 3.2 本文不负责

1. 调研执行流程（30 号调研系统承载）；
2. WorkCase 的 Gate 1 授权模板（21 号承载）；
3. Initiative 的组织语义（26 号已砍除）；
4. 调研结果的落地（调研系统+WorkCase 完成）；
5. 问题的答案（由调研系统提供，Spark 只挂靠）；
6. sub-goal 锚点本身的定义与修订（25 号承载）。

### 3.3 相邻规范分工与唯一权威

30 号是调研流程的唯一权威；21 号是 WorkCase 授权语义的唯一权威；25 号是 Goal/sub-goal 锚点的唯一权威；24 号是 Research 事实类型的唯一权威。本文只定义 Spark 类型自身的悬置语义、字段、状态、关系与终态，不复制相邻规范的格式、协议或实现细节。

## 4. 适用范围

### 4.1 适用对象

1. 管辖项目中的多例 Spark 对象；
2. Spark 的悬置问题与调查边界。

### 4.2 适用场景

本规范用于 Spark 的创建（WC 授权 Gap 时、悬置问题转入调研时、初始化对话发现 Gap 时）、问题边界精化、合并/拆分处置与终态处理（implemented/discarded）。

### 4.3 明确排除与证明边界

明确排除：调研执行（交给 30 号）；答案收集（调研系统）；结论落地（WorkCase）；Initiative 组织层（26 号不存在）；已定目标的承载（25 号）。Spark 对象进入调研系统后不能回到 Spark 继续悬置。Spark 对象存在、处于 open 状态或终态，均不能单独证明问题真实存在、值得调查、调查已完成或下游工作已承接——这些须由消费点与 Human 决定共同核对。

## 5. 类型定位与价值

Spark 是方向主线层的事实类型：**一切值得跨行动推进之事的出生地与主线入口**。它承载一个方向的当前理解（summary）、核心待答问题（question）、停止边界（scope_boundary）与演进流水（evolution）——无论该方向处于想法期、设计期、审议期还是实施期，主线都住在 Spark 里，直到落地完成（implemented）或放弃（discarded）。它横切全部层级——Goal 层方向疑问、WC 层执行发现的悬置、讨论残项的显式悬置（31 号 §10.2）、以及尚未形成任何下游对象的方向本身。

与 24 号的最大差异：Spark 不调查外部世界，只承载方向与内部未决问题；调研的执行由 30 号承接。与 25 号的最大差异：Goal 是已定目标的冻结锚，Spark 是方向的主线（含未定部分）。与 22 号的最大差异：ADR 是必须逐环节贯彻的法定效力决定，Spark 是方向的容器——方向内结晶出的每一条可独立贯彻的决定必须提取为 ADR（宽进窄出：入口不问成熟度，结晶必须进窄容器）。

## 6. 对象边界

### 6.1 什么构成一个对象

一个 Spark 对象 = 一条可独立推进的方向主线：核心待答问题（question）+ 明确的停止边界（scope_boundary）+ 保留理由与后续方向（intent）+ 完整的当前语义快照（summary）+ 演变流水（evolution）。方向必须可独立召回、可独立判断、可独立分流。**question 是方向的核心待答问题——在方向完成或放弃前持续有效；允许部分已答**（已答部分的结论沉淀进 summary，结晶出的决定提取进 ADR，question 聚焦仍未答的部分；question 实质变化时经 evolution 记录转折）。

### 6.2 查重

创建前必须查重（防 v4 教训 1：同一问题多次开 Spark——价值审计 3 次、Hook 3 次、署名 5 次）。查重范围：同类 open Spark 的 title/question 语义比对，以及既有终态 Spark 是否已完整承接该问题。查重由 AI 语义判断（03 §8.2 不建立相似度自动裁决），结果必须记录在创建提案中。查重发现同题已开：不新建，转向既有 Spark 或提示复用。

### 6.3 明确不属于本类型（入口拦截）

以下内容不形成 Spark：当前行动可直接处理且不需跨行动保留的内容；已经由现有位置完整承载的内容；过程日志、逐条聊天、工具输出与单纯执行提醒。

### 6.4 提取要求（宽进窄出）

入口不拦截「方向里已有结晶物」——但结晶物必须提取到各自窄容器，**不得只留在 Spark**：可独立贯彻的决定 → ADR（每条一个对象，22 号 §6.1 粒度判据）；执行计划与验收 → WorkCase；外部对象深度调研 → Research；失败教训 → Pitfall；系统性摩擦 → Friction。提取后 Spark 主线继续承载方向本身的演进（summary 更新、evolution 记录转折、正文可链接已提取对象），直到方向落地完成或放弃。**Spark 的 implemented 语义 = 方向主线落地完成（其下游结晶物各自独立负责完成），不表示下游对象已完成**——防「交了就当完成」的自欺防线（与 §1 一致）。

多条潜在分流方向仍只是同一共同线索、尚未各自形成独立目标、判断或跟踪价值时，可保留在同一 Spark 中；潜在多路分流本身不要求立即拆分。多个已经可以独立处置的问题不得长期捆成一个 Spark；相关子问题一旦具有独立目标、判断或跟踪价值，必须拆分。

## 7. 身份与载体

| 项 | 定案 |
|---|---|
| `fact_type_key` | `spark`（类型短名，与 24 号 `research` 同形；回指由本表登记声明建立——本规范 spec_key `spark-fact-type` 是规范文档层身份键，不作为字段值，03 §6.1） |
| 载体 | 平铺单文件：YAML frontmatter（机器权威）+ markdown 正文；`ldvh-base/sparks/spark-<uid>.md` |
| 权威位置 | `ldvh-base/sparks/`；目录基数校验，文件名编码 UID |
| 公共字段 | `object_uid`（UUIDv4）、`fact_type_key`、`title`、`status`、`created_at`、`change_log`（首修后必有） |

只保留 `object_uid` 作为唯一身份（UUIDv4，Code 生成），不设第二个 `object_id` 字段（dev-memo 待定项 16）；`created_at` 由 Code 受控创建时填写，AI 不得填写；不保留 `updated_at`，变更走 `change_log` 流水（每次实际修改恰好追加一条，`at`/署名 Code 托管，AI 只提供一句话语义摘要）。

## 8. 字段契约

frontmatter 闭集：

| 字段 | 类型 | 必填性 | 语义 | 约束 |
|---|---|---|---|---|
| `fact_type_key` | string | 必填 | `spark` | 唯一合法值（类型短名，03 §6.1 值域） |
| `object_uid` | UUIDv4 | 必填 | Code 生成 | 创建时落定，永不改变 |
| `title` | string | 必填 | 问题标题 | ≤ 30 字；供候选定位与 Human 扫读 |
| `question` | string | 必填 | 方向的核心待答问题 | 单句；在方向完成或放弃前持续有效；允许部分已答（已答结论进 summary、结晶决定提取进 ADR，question 聚焦仍未答部分；实质变化经 evolution 记录） |
| `scope_boundary` | string | 必填 | 调查边界 | 何时停止（范围、证据、时限）；非目标达成 |
| `intent` | string | 必填 | 保留理由与后续方向 | 为什么值得保留；后续需要判断的方向 |
| `summary` | string | 必填 | 完整的当前语义快照 | 当前已确认判断、边界、候选方向、未决事项；使未读原聊天的后续执行者可独立理解；只承载当前仍适用的理解，不复制创建原因或过程日志 |
| `evolution` | array | 条件 | 关键语义转折流水 | 只在问题焦点、边界、判断方向或承接方向发生实质变化时追加；每项 `{at, summary}`；当前仍适用的内容必须先进入 `summary`，`evolution` 只说明变化与影响（上限 20 项） |
| `serves_sg` | string | 条件 | 服务的 SG-n | goal.md 子目标锚点；轻量归属引用，不参与 goal 修订级联（25 §11 豁免）；不存在时省略 |
| `status` | string | 必填 | `open` / `implemented` / `discarded` | 初态 `open` |
| `disposition` | string | 条件 | 终态去向与理由 | 进入终态时必填；说明落实/交接/废弃/合并/拆分去向 |
| `relations` | array | 条件 | 合并/拆分关系（merged-into/split-into） | 仅合并/拆分时出现；按 03 §7.2 公共形状；目标必须可解析且为 open（§11） |
| `created_at` | RFC3339 | 必填 | Code 填写 | AI 不得填写 |
| `change_log` | array | 条件 | 变更流水 | 首次修改后必有；每次恰好一条 |

正文 H2：

```
 # <title>
 ## 当前理解        ← summary 的正文承载；完整语义快照（必填）
 ## 调查问题        ← question 的自然语言展开；方向的待答问题与其当前已答/未答状态（必填）
 ## 调查边界        ← scope_boundary 的自然语言展开；何时停止（必填）
 ## 演变            ← evolution 的正文承载；跨会话接力理解（条件出现）
```

字段间不变量：`question` 必须单句可读；`scope_boundary` 必须明确何时停止；`intent` 必须回答「为什么保留 + 后续方向」；`summary` 必须使未读原聊天的后续执行者理解当前已知道什么、如何判断、仍需处置什么（先问当前仍适用的内容是否必须进入 `summary`，是则必须写入，`evolution` 只记变化）；`disposition` 出现 ⇔ `status ∈ {implemented, discarded}`；`serves_sg` 出现时必须匹配 goal.md 存在的 SG-n。未知字段处理：按 03 §6.1，未知字段不进入 canonical 对象，不得以空字段或占位代替判断。

## 9. 状态与生命周期

状态闭集三值：`open`（悬置中）→ `implemented`（落实/交接，只结束入口职责）→ `discarded`（废弃/被合并/被拆分）。

### 9.1 状态语义与成立条件

| `status` | 语义 | 必须成立 |
|---|---|---|
| `open` | Spark 仍有未被稳定位置完整承接的内容，需要继续召回、判断、拆分或分流 | `disposition` 不得出现；已有关系不等于完整承接 |
| `implemented` | Spark 限定的信息需求已由该 Spark 范围内的直接工作落实，或已把后续责任交给 WorkCase；只结束该 Spark 入口，不表示下游完成 | `disposition` 必填；不得有合并/拆分关系（那是 discarded 专属）；说明必须如实限定已落实或已交接的范围 |
| `discarded` | 明确决定该信息不再继续跟踪；或该议题已被合并/拆分，原 Spark 不再以原形态存在 | `disposition` 必填；若声明了合并/拆分关系，目标必须可解析且为 `open` |

### 9.2 状态转换

正常状态转换只有 `open → implemented` 和 `open → discarded`。

- `open → implemented`：AI 先精确读取 F3 当前 Spark，只对影响当次处置结论的必要规则、来源或验证依据按 05 的 F4 展开；AI 负责判断直接落实或交给 WorkCase 的范围与残余责任，Human 对当次处置授权负责；Code 仅检查闭集、字段、关系、CAS 与回读。
- `open → discarded`：明确决定不再跟踪（不产生承接目标的否定处置）；或议题被合并/拆分（产生承接目标的关系处置）。

终态不直接重开。后来出现新的未处置信息时创建新的 open Spark，并在新对象的 `disposition` 或 change_log 中说明接替的旧 Spark；这不把旧对象改写为分流。若原终态记录本身错误，按 05 的事实更正规则修正，而不是把更正伪装成领域状态转换。

### 9.3 合并/拆分（终态处理的两条新路径）

合并/拆分是「关系演变」而非「状态转换」——03 §10 明确「普通内容更新、事实更正、关系变更、状态转换、关闭、归档、合并、替代和删除是不同动作」。状态机回答「这个入口还开不开」，合并/拆分回答「议题的内容去哪了」，两者分开设计。

**合并**：多个 Spark 收敛为一个议题。原 Spark → `discarded` + `merged-into` 关系指向合并目标；目标 Spark 优先复用现有对象（若能代表合并后议题就不新建，对应 v4 同题多开教训），确需新建时创建新 open Spark。目标 Spark 的 change_log 追加一条记录合并来源。

**拆分**：一个 Spark 分化出多个子议题。原 Spark → `discarded` + `split-into` 关系指向各子 Spark；每个子 Spark 是独立 open 对象，各自有 question、scope_boundary、intent、summary。**拆分绝不等于 implemented**——原 Spark 还在悬置层，只是搬家/变形了，没有「走出去」。拆分出的某个子议题若真的落地，由那个子 Spark 自己将来转 implemented；原 Spark 不承担该语义（这是对「废弃 vs 部分完成」问题的回答：被合并/拆分的原 Spark 一律 discarded，不因部分内容被承接而标记 implemented）。

合并/拆分操作必须经 Human 确认（与关闭/抛弃同级，进 §16 Human Gate），并各自追加 change_log 流水（03 §7.2 第 7 条：实际关系变更随该次对象修改由 Code 追加恰好一条流水）。

## 10. 来源与证据

悬置问题来源于 Human 决策（WC 授权 Gap 时的悬置表达、初始化对话的发现、讨论残项的显式悬置）。Spark 本身不直接接受外部证据——由 30 号调研系统收集；本类型不设 `urls` 字段（与 24 号的最大差异）。

`implemented` 的 `disposition` 必须说明直接落实或交给 WorkCase 的范围，并明确不代表下游完成；`discarded` 的 `disposition` 必须说明不再跟踪的决定及其边界，或合并/拆分去向与理由。证据以自然语言描述已经执行什么、观察到什么、仍有哪些未验证范围；不得用路径、命令或日志位置代替说明。关系存在、文件存在或测试命令成功本身不自动充分。

## 11. 关系契约

`relations` 只使用 03 §7.2 的公共形状，relation key 必须是本类型闭集成员。本类型关系闭集：

| `relation_key` | 方向 | 目标类型 | 基数 | 语义 | 约束 |
|---|---|---|---|---|---|
| `merged-into` | 当前 Spark → 目标 Spark | Spark | 1 | 本议题被合并进目标 | 仅 `discarded` 状态可出现；目标必须可解析且为 `open`（合并目标是继续承载议题的活对象，不是历史归档） |
| `split-into` | 当前 Spark → 目标 Spark | Spark | 1..n | 本议题被拆分为目标子议题 | 仅 `discarded` 状态可出现；全部目标必须可解析且为 `open`（子议题各自独立悬置，不是历史归档） |

不采用 `related-to` 作为本类型普通关联键（v4 曾用 related-to 表达普通关联，但 v4 20:86 明确「不得把泛化 related-to 伪装成拆分谱系」；v5 用结构化关系键承载合并/拆分，普通关联若确有消费价值由 03 提升公共契约时再议，不在本类型复制）。不建立责任承接关系（`routed-to` 不进入本类型——交给 WorkCase 只在 `implemented` 的 `disposition` 中记录，不改变 WorkCase 自身生命周期）。

强制约束：`discarded` 若声明了 `merged-into`/`split-into` 关系，目标必须可解析且为 `open`（存在、可读、同项目），否则视为未完整关闭，进入 Stop Condition。无合并/拆分关系的 `discarded` 按普通废弃处理。关系变更必须使用对象当前指纹绑定的完整更新入口，写后精确回读。

## 12. 召回与消费

| 消费点 | 时机 | 消费内容 |
|---|---|---|
| 30 号调研系统 | 悬置问题转入调研时 | question + object_uid |
| Spark 讨论 | 每次扩散前 | question + scope_boundary + summary |
| 讨论系统残项悬置 | 未收敛点分流时（31 号 §10.2） | 未决问题 + 判断标准与监测条件 |
| 蓝图「悬而未决」区块 | 每次蓝图渲染（10 号） | open Spark 列表 |

注：重建锚点 §11 开放问题 3 的「Spark→Research 分流判据」尚未定案，本文不将其作为既定消费点声明；待 24/11 相关机制成立后由相应来源补充。

召回分层（03 §8）：F1 枚举 open Spark 计数（title + status）；F2 按类型、状态、稳定引用命中的候选卡（title/question/scope_boundary 有界摘录 + 命中依据）；F3/F4 按需展开完整对象。默认候选只包含 open Spark；implemented/discarded 不进入普通未处置候选，只在当前输入精确引用或需要追溯历史基线时以历史对象展开。AI 展开候选后必须重新比较当前主题、摘要和处置状态；Spark 被召回不表示应创建 WorkCase、恢复旧议题或提高其优先级。

## 13. 受控操作

- **创建**：C1 提案对象模式（重建锚点 §7 本轮新增 1，机制待 04/21 统一登记）——AI 只产出提案对象（含查重结果），Human 确认后经受控创建入口落盘；或初始化对话「发现 Gap」时主动创建（此时 goal.md 可能尚未建立，Spark 不声明 serves_sg，与 25 §10「goal.md 缺失时读操作与 Spark 探索不拦」一致）。创建前必须查重。机械校验：字段闭集合法、question 单句可读、scope_boundary 完整、serves_sg（若声明）匹配 goal.md 存在的 SG-n。创建后精确回读。
- **更新**（问题/边界精化、演变追加）：03 §9.5 受控更新；CAS 以完整文件为单位，绑定 `content_fingerprint`；每次恰好一条 change_log（含理由）；必须先经 Human 确认（问题/边界大改）。
- **合并/拆分**：Human Gate 确认；原 Spark 经受控更新进入 discarded 并写 merged-into/split-into 关系；目标 Spark 经受控创建或受控更新；各自追加 change_log。多对象操作按 03 §9 多对象原子性边界处理——不得先写孤立新对象再补关系。
- **状态转换**（implemented/discarded）：Human Gate 确认；AI 先做 F3/F4 核对；Code 检查闭集、字段、关系、CAS 与回读。
- **删除**：不存在删除操作。存量 Spark 随 `ldvh-base/sparks/` 保留；归档只在未来当前来源另行定义明确位置与消费边界后成立。

## 14. 类型特有验证与类型退出

### 14.1 类型特有验证

本类型在 03 §9 公共契约之外的特有验证（与固定收尾章节 §15 验证表互补）：

- 查重结果记录：创建提案必含查重结论（同题已开 → 不新建）；
- 合并/拆分去向校验：discarded + merged-into/split-into 关系目标可解析且为 open；
- 状态-关系不变量：implemented 不得带合并/拆分关系；discarded 带关系时目标必可解析且为 open；
- 终态处置完整性：进入终态时 disposition 非空。

### 14.2 存量对象迁移

字段契约变更必须声明对存量对象的迁移义务（重建锚点 §6 第 3 条，治 v4 backfill 之痛）：

- **v4 存量 103 个 Spark**：不自动迁入 v5 载体。需经 Human 分批受控迁移，逐份满足：v4 `intent` → v5 `intent`（保留理由与后续方向）；v4 `summary` → v5 `summary`（当前语义快照）；v4 `evolution` → v5 `evolution`（关键转折流水）；v4 `priority` 不迁入（v5 无此字段）；v4 `disposition_summary` → v5 `disposition`（终态去向）；v4 `related-to` 关系不迁移为 v5 关系（v5 仅 merged-into/split-into 两键）。
- **缺失字段处理**：迁移后缺少 v5 必填字段（question/scope_boundary/summary）的对象，须在迁移时补齐或如实标记迁移不完整，不得以空值占位。
- **未迁移的 v4 对象**：保留在 v4 仓库历史中，不进入 v5 事实源消费。
- **迁移实现与验证**：迁移走受控入口（03 §9），逐份 CAS + 精确回读；未验证范围如实声明。

### 14.3 类型退出

若 Human 决定取消 Spark 类型，须按 03 §10 处理：处理仍适用事实、入向/出向关系与稳定引用，登记变化（01 §8.2）与受影响引用同步，走受控提交。退出属 00 §4.2 根决定。

## 15. 验证与证据边界

| 验证对象 | 验证时机 | 成立条件 | 可接受依据 | 验证入口 | 可证明范围 | 未满足时的处理 |
|---|---|---|---|---|---|---|
| question 可读性 | 创建时 | question 单句，语义清晰 | Human 确认记录 | AI 初审+Human 终审 | 问题可被调研系统采纳 | 拒绝创建；要求澄清 |
| scope_boundary 完整 | 创建时 | 何时停止调查边界明确 | Human 确认 | 机械字段检查 | 调查范围边界 | 拒绝；要求补充 |
| serves_sg 有效 | 创建时 | serves_sg 匹配 goal.md 存在 SG-n | goal.md 子目标回读 | 机械（编号匹配） | 锚点解析成功 | 拒绝；或拒绝 goal 引用 |
| 查重已执行 | 创建时 | 创建提案含查重结论 | 提案记录 | AI 语义审核 | 当次查重范围 | 补查重后重走创建 |
| 状态转换合法 | 变更时 | open→implemented/discarded 逻辑一致 | 处置依据 + Human 确认 | 审核 + 机械 | 转换合法性 | 反向转换报错 |
| 合并/拆分去向 | 变更时 | discarded + 关系目标可解析且为 open | 目标 Spark 回读 | 机械（关系目标解析+状态检查） | 合并/拆分去向完整性 | 视为未完整关闭，暂停并修复 |
| 状态-关系不变量 | 变更时 | implemented 无合并/拆分关系；discarded 带关系时目标可解析且为 open | 对象全文 + 关系闭集 | 机械校验 | 当次状态与关系一致性 | 拒绝；修正后重走 |

本章的机械结果只交还当次对象的存在性、格式、状态与关系校验范围，不证明问题真实、调查完成、责任承接或下游完成；这些由 AI 语义审核与 Human 决定共同核对。

## 16. Human Gate

本文不新增 00 之外的 Human Gate。领域增量事项（00 §4.2 在 Spark 领域的具体化）：

1. Spark 的创建（Gap → Spark，C1 提案对象模式）；
2. Spark 的终态决定（implemented/discarded，含合并/拆分）；
3. Spark 的问题/边界大改（受控更新）。

### 16.1 决定边界

Human 决定只证明决定及其作用范围，不替代问题语义审核、查重判断、格式校验或下游承接验证。

## 17. Stop Conditions

本文不新增根停止类型。领域触发与最小影响范围：

1. 创建时声明了 serves_sg 但 goal.md 缺失或该 SG-n 不存在（悬置无锚可引；未声明 serves_sg 时 goal.md 缺失不停止——25 §10 读操作与 Spark 探索不拦）；
2. question 为空或不可读；
3. scope_boundary 缺失；
4. AI 未经 Human 确认直接进入终态（implemented/discarded）；
5. discarded 声明了合并/拆分关系但目标解析失败（视为未完整关闭）；
6. 拆分被写成 implemented（原 Spark 还在悬置层，未走出去）；
7. 创建前查重未执行或结果未记录。

暂停期间只允许不越过停止边界的证据补取、引用修复、授权补走与条件核实。恢复须与触发原因逐项对应。同一停止条件恢复后再次触发的，按 00 §7.3 进入 Human Gate。

## 18. 反过度设计红线

1. 不设 `success_criteria` 类字段——Spark 是悬置层，已定目标归 25 号；
2. 不建调研执行机制——30 号调研系统完整负责；
3. 不为 Spark 关联 Initiative——它挂靠在 sub-goal/WC 层；
4. 不为 Spark 建副本/索引——消费点直读；
5. 不为「Gap 太大」建二级 Spark 嵌套；
6. 不为合并/拆分建独立状态——用 discarded + 关系承载，不新增状态值；
7. 不建责任承接关系（routed-to 不进入本类型）——交给 WorkCase 在 disposition 中记录；
8. 不把普通关联复制为 related-to——确有公共价值时由 03 提升公共契约再议。
