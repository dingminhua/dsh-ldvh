---
ldvh_spec:
  spec_key: "workcase-fact-type"
  spec_id: "21"
  spec_kind: "spec"
  title: "WorkCase 工作项"
  canonical_path: "specs/21-WorkCase-工作项.md"
  parent_spec: "fact-model-foundation"
  relation: "refines"
  positioning: "定义 WorkCase 事实类型的目的、对象边界、身份与载体、字段契约、状态与生命周期、Gate 1 与 Gate 2 授权语义、attempt 令牌与冷恢复、关系契约、召回消费与受控操作，是工作执行业务系统中已批准工作及其结果审计的唯一类型权威"
  scope: "适用于管辖项目中承载已批准工作、授权范围、执行接续与结果审计的 WorkCase 对象；不定义方案构建与收敛流程、需求裁夺、子代理编排的宿主机制、受控提交契约或 Web 呈现细节"
  basis:
    - "ldvh-root"
    - "work-model-foundation"
    - "goal-fact-type"
    - "discussion-system-foundation"
  authorized_attachments: []
  dimensions: ["write", "orchestrate", "comply"]
  related_specs:
    - "pitfall-fact-type"
    - "spark-fact-type"
    - "web-presentation-interaction"
---

# WorkCase 工作项

## 1. 价值判断

WorkCase 解决已批准工作在跨会话、跨执行者执行时缺少稳定承载的问题：计划只存在于对话里、授权范围随会话消失、中断后不知道做到哪里、结果与残留责任无法回读核对——于是「执行工单」这一 00 §2 承诺功能没有可回指的对象，HV2 的「Human 无需持续看守仍能核查当前执行范围」落空。WorkCase 以授权执行层承载这些内容：计划与完成判据表达要做什么、授权包钉扎表达做到什么范围算已授权、attempt 令牌表达当前谁在做与做到哪里、结果与 outcome 表达实际做成了什么。普通文件或既有类型不能无损承载：README 与待办清单无受控写入、无状态闭集、无授权钉扎；Spark 是悬置层（方向未定，不是已批准待执行）；ADR 承载已定决策而非待执行工作；Goal 是引用链顶点，不承载单次工作的范围与结果。

WorkCase 主要支撑 V3 边界识别（授权范围与越权拒绝可回指）、V4 稳定推进（复用既有工作包结构并保留接续入口）、V5 据实判断（已证实、未证实与残留风险在 Gate 2 显式分层）、V6 工作接续（attempt 令牌与冷恢复使中断后可从当前状态继续）与 V8 持续积累（关闭记录与 outcome 是后续同类工作的复用依据）；面向 Human，WorkCase 承接 HV2 授权执行受控可续（授权包钉扎、越权动作被机械拒绝、返回后从当前状态继续）与 HV3 入档闭环节点可验（创建、Gate 1 批准、Gate 2 关闭四节点可回读核对）。WorkCase 不承接 HV4 与 HV5；对象数量、执行中状态或 Gate 记录存在，不证明工作已正确完成或价值成立。

WorkCase 是工作执行业务系统（00 §3.1、02 §12）的结论承载：它把「执行已批准的工作」这一职责落成可回读的对象，但价值的兑现仍依赖讨论系统提供格式齐全的计划（31 号）、遵守系统落实适用约束（02 §13）与复核制度对照实际结果（02 §15）；本文只定义类型自身的边界、字段、状态、授权语义与消费点，不替代上述相邻职责。

WorkCase 对象存在、处于 open 状态、Gate 记录齐全或 attempt 令牌有效，均不能单独证明计划正确、授权仍然覆盖当前动作、执行正在进行、结果已达成、残留责任已交接或工作整体完成——这些须由 Gate 1 / Gate 2 上的逐条核对、写后回读、机械校验与 Human 决定共同证实。

## 2. 规范依据

1. `ldvh-root`：00 §2 根方案（提供「执行工单」功能）、§3.1 工作模型（工作执行业务系统以 WorkCase 承载其结论）、§3.3 规范源与事实源及受控写入三层防线、§4 Human 决定权与根决定清单、§5 AI 责任（单一主控最终负责、委派不转责）、§6 双轨价值标准、§7 防自欺、Stop Conditions 与交还。
2. `work-model-foundation`：02 §12 工作执行业务系统的职责、判据与边界（工作包生命周期、attempt 令牌与冷恢复由本类型规范承接）；§15 复核与校验制度；§18 暂停、接管与恢复。
3. `goal-fact-type`：25 §6 sub-goal 锚点（SG-n）语义、§8 达成判定证据链、§10 消费点中 active WC 注入、§11 修订级联与「按 21 号 C2 语义局部重批」的引用。
4. `discussion-system-foundation`：31 §5 需求审核职责前置与 WorkCase 只承担执行与结果审计、§10.1 四路分流中 WorkCase 出口的成文格式权威、§10.2 残项处置。

本文的结构父规范是 `fact-model-foundation`（03），按 01 §10.1 同一目标不得同时作为 `basis` 和结构父规范，故 03 不列入 `basis`；03 §11 定义的事实类型规范共同结构是本文 §5–§15 的结构依据，与 20/22–27 各同段类型规范同形态。

本文不依赖外部语法或行业标准定义 WorkCase 类型语义。既有候选记录、设计讨论与重建锚点文档（`docs/spark-workcase-rebuild.md` §5/§5.10，其中 C1 提案对象模式与 C2 授权钉扎的方向已被本文吸收）只用于识别设计意图，不证明当前规则成立。发生冲突或权威关系无法确认时，按 00 §7.2 暂停受影响范围并完成对齐。

## 3. 职责边界

### 3.1 本文负责

1. WorkCase 类型的对象边界与查重；
2. WorkCase 的身份与载体（多例平铺单文件）；
3. WorkCase 的字段契约（含 `serves`、`attempt`、`gate_1`、`result`、`outcome`）；
4. WorkCase 的状态闭集与生命周期（draft/open/closed 与四种 outcome）；
5. **Gate 1 与 Gate 2 授权语义**（授权包、C2 钉扎与局部重批）；
6. **attempt 令牌与冷恢复的类型侧契约**；
7. WorkCase 的关系契约（`serves` 指向 Goal sub-goal、`contributed-to` 指向 Pitfall）；
8. WorkCase 的召回与消费点、受控操作与类型退出。

### 3.2 本文不负责

1. 需求本身的裁夺与「做什么」的决定（归 Human 意图与 goal，31 §5）；
2. 方案构建、扩散与收敛流程（归 31 号讨论系统）；**需求审核阶段已由 31 号前置收敛机制砍除，WorkCase 不承担该阶段**；
3. 子代理 spawn、通信、中断与结果回收的宿主机制（归 02 §8 与 08）；attempt 的宿主实现与锁语义**指定由 08/09 承接**（其承接实现与不变量见 §15.2 的前提限定）；本文只定义类型侧字段与不变量；
4. 检查点、复核执行与独立复核的组织方式（归 02 §15 与 01 §12）；本文只定义结果审计在对象上留下的字段；
5. 受控提交契约、署名与 Git Gate（归 06）；
6. 事实源边界、管辖判定与 Web 呈现细节（归 07、10）。
7. 04 号的模板或业务系统共同结构（04 号正在改造，其职责以该规范自身为准；**Gate 1 授权模板的承载归本文，不归 04**）。

### 3.3 相邻规范分工与唯一权威

03 是公共字段与受控读写契约的唯一权威；06 是事实源与受控提交的唯一权威；25 是 Goal 与 sub-goal 锚点的唯一权威；23 是 Pitfall 类型语义的唯一权威；12 是方案收敛与四路分流的唯一权威；08/09 被指定为 attempt、锁与冷恢复宿主实现的承接方（该承接的实现前提见 §15.2 前提未满足时的声明限制）。**本文是 WorkCase 类型语义以及 Gate 1 与 Gate 2 授权语义的唯一权威**：Gate 1 授权模板、授权包结构、C2 钉扎与局部重批语义只在本类型规范中定义，不复制相邻规范的规则。10 §6.2 的呈现触发以本文的定稿文本为准（10 不再保留「provisional 术语、定稿前不作为触发依据」的表述）；其 Gate 语义部分随本文定稿而不再 provisional。34 号属目标与蓝图业务系统段，不定义事实类型的状态机与授权语义，本文不把 Gate 1 / Gate 2 的语义分给 34 号。

## 4. 适用范围

### 4.1 适用对象

1. 管辖项目中的多例 WorkCase 对象（`ldvh-base/workcases/`）；
2. WorkCase 的授权包（`gate_1`）、执行 attempt 令牌与结果记录（`result`）。

### 4.2 适用场景

本规范用于 WorkCase 的创建（讨论收敛产出的可执行计划、Human 直接提出的已定工作）、Gate 1 授权与批准、执行期的 attempt 接续与冷恢复、计划或范围变化后的局部重批、Gate 2 结果与关闭判定，以及消费（蓝图、sub-goal 达成证据链、Pitfall 贡献关联、systemPrompt 注入）。

### 4.3 明确排除与证明边界

明确排除：方案从模糊到可执行的构建过程（归 31 号）；方向未定或未决问题（归 20 号 Spark）；已定决策本身（归 22 号 ADR）；外部对象深度调研（归 24 号 Research）；项目目标本身（归 25 号 Goal）；未形成方案的临时行动（不对象化）。WorkCase 对象存在、Gate 1 记录齐全、attempt 有效或状态为 open，均不能单独证明计划正确、授权仍覆盖当前动作、执行正在推进、结果已达成、残留责任已交接或价值成立。

## 5. 类型定位与价值

WorkCase 是授权执行层的事实类型：**已批准工作及其结果审计的唯一承载**。它把一次工作从「对话里的计划」变成可回读、可拒绝越权、可中断恢复、可逐条核对的对象。它只承担两件事——**执行与结果审计**（31 §5：需求审核职责已前置到讨论，本文据此不设需求审核阶段或状态）。

与相邻类型的差异：Spark 承载方向本身（未定），WorkCase 承载已定工作的执行；ADR 承载必须逐环节贯彻的法定决定，WorkCase 承载一次有边界的工作；Research 调查外部世界，WorkCase 不调查、只执行与记录；Goal 是单例引用链顶点，WorkCase 是链下的多例执行单位，且**方向不可逆**——由 WorkCase 的 `serves` 指向 Goal sub-goal，Goal 侧不存储反向投影（25 §9）。

## 6. 对象边界

### 6.1 什么构成一个对象

一个 WorkCase 对象 = 一次有边界的已批准（或待批准）工作：要做什么（`summary`）+ 授权范围与边界（`scope`）+ 可执行计划与逐条完成判据（`plan`）+ 当次执行者令牌（`attempt`）+ 结果核对结论与残留（`result`）。它必须可独立授权、可独立执行、可独立关闭、可独立审计。计划步骤的粒度判据：**一步能由单一执行者在一次连续执行中完成，且其完成判据可被证据判定**；不能判定的步骤必须先精化，不得以「已完成」的自述代替判据。

### 6.2 查重

创建前必须查重（03 §8，不建立相似度自动裁决）：范围重叠的 draft/open WorkCase 的 `title` + `summary` + `scope` 语义比对，以及既有 closed WorkCase 是否已完整承接该工作。查重由 AI 语义判断，结果必须记录在创建提案中。查重发现同工作已开：不新建，转向既有 WorkCase 或提示复用；确实需要拆分时按 §14 受控操作处理，不为拆分新增状态。

### 6.3 明确不属于本类型

以下内容不形成 WorkCase：方向未定、尚无可执行方案的议题（归 Spark）；当次行动可直接处理且不需跨会话保留的低风险改动（不对象化）；已定决策的表达（归 ADR）；需要持续跟踪的系统性阻碍（归 26 号 Friction）；过程日志、逐条聊天、工具输出与单纯执行提醒。

## 7. 身份与载体

| 项 | 定案 |
|---|---|
| `fact_type_key` | `workcase`（类型短名；回指由本表登记声明建立——本规范 spec_key `workcase-fact-type` 是规范文档层身份键，不作为字段值，03 §6.1） |
| 载体 | 平铺单文件：YAML frontmatter（机器权威）+ markdown 正文；`ldvh-base/workcases/workcase-<uid>.md` |
| 权威位置 | `ldvh-base/workcases/`；目录基数校验，文件名编码 UID |
| 公共字段 | `object_uid`（UUIDv4）、`fact_type_key`、`title`、`status`、`created_at`、`change_log`（首修后必有） |

公共字段实际采用：`object_uid`、`fact_type_key`、`title`、`status`、`created_at`、`change_log`、`relations`（仅 `contributed-to`）。不采用 `urls`：WorkCase 的证据是当次执行的观察、回读结果与 Git 状态，以正文自然语言与 `result` 字段承载；具有长期消费价值的外部资料由 24 号 Research 与 22 号 ADR 承载，不在此复制。`created_at` 由 Code 在受控创建时填写，AI 不得填写或推导；不设 `updated_at`，变更走 `change_log`（每次实际修改恰好追加一条，`at`/署名 Code 托管，AI 只提供一句话语义摘要）。

## 8. 字段契约

frontmatter 闭集：

| 字段 | 类型 | 必填性 | 语义 | 约束 |
|---|---|---|---|---|
| `fact_type_key` | string | 必填 | `workcase` | 唯一合法值（类型短名，03 §6.1 值域） |
| `object_uid` | UUIDv4 | 必填 | Code 生成 | 创建时落定，永不改变 |
| `title` | string | 必填 | 工作项短标题 | ≤ 30 字；供候选定位与 Human 扫读；不承载完成判据或结果结论 |
| `serves` | string | 条件 | 服务的 sub-goal 锚点，值形如 `SG-3` | 指向 `ldvh-base/goal.md` 中存在的 SG-n；goal.md 缺失或 sub-goal 空缺时省略（25 §10 读操作不拦）；**不是 `relations` 条目**——SG-n 是 goal.md 内的锚点，无 `object_uid`，不构成 03 §7.2 的关系目标 |
| `summary` | string | 必填 | 要做什么的当前语义快照 | 使未读原计划的后续执行者可独立执行；只承载当前仍适用的范围，不复制讨论过程 |
| `scope` | string | 必填 | 授权范围与边界 | 必须同时回答「做什么」与「明确不做什么」；是越权拒绝的比对基准 |
| `plan` | array | 必填 | 可执行计划步骤 | 每项 `{step, done_criteria}`；`done_criteria` 必须可被证据判定；格式齐全只待批准（31 §10.1 出口形态） |
| `gate_1` | object | 条件 | Gate 1 批准记录与授权包 | 批准后必填：`{approved_at, approver, authorization_fingerprint, scope_snapshot}`；`authorization_fingerprint` 绑定当次 `plan` + `scope` 的内容指纹 |
| `attempt` | object | 条件 | 当前执行 attempt 令牌 | 执行期必填：`{attempt_id, started_at, controller, heartbeat_at}`；`attempt_id` 由 Code 单调分配；至多一个活跃 attempt |
| `result` | object | 条件 | 执行结果核对结论 | 关闭提案时必填：`{criteria_checks[], achieved_scope, residual[]}`；`criteria_checks` 逐条对应 `plan[].done_criteria` |
| `outcome` | string | 条件 | 终态判定 | `closed` 时必填，闭集 `completed` / `partial` / `not-achieved` / `cancelled` |
| `status` | string | 必填 | `draft` / `open` / `closed` | 初态 `draft` |
| `relations` | array | 条件 | 贡献关联（`contributed-to`） | 按 03 §7.2 公共形状；目标必须是可解析的 Pitfall `object_uid` |
| `created_at` | RFC3339 | 必填 | Code 填写 | AI 不得填写 |
| `change_log` | array | 条件 | 变更流水 | 首次修改后必有；每次实际 canonical 修改恰好一条 |

正文 H2：

```
（H1 标题行 = title）
## 摘要        ← summary 的正文承载；要做什么（必填）
## 授权范围    ← scope 的正文承载：做什么 / 明确不做什么（必填）
## 计划        ← plan 的正文承载：步骤 + 逐条完成判据（必填）
## 执行        ← attempt 与执行进展的正文承载；跨会话接力（条件出现）
## 结果        ← result 的正文承载：逐条判据核对 + 已证实/未证实/残留（关闭提案时必填）
```

（首行 H1 由 `title` 镜像，与 20/22–26 各类型规范同形态。）

字段间不变量：`plan` 每项必须有非空 `done_criteria`；`gate_1` 出现 ⇔ `status ∈ {open, closed}`；`attempt` 出现 ⇔ `status = open`；`result` 与 `outcome` 出现 ⇔ `status = closed`；`result.criteria_checks` 必须与 `plan` 逐条对应（长度一致、顺序一致）；`outcome = completed` 时每条 `criteria_checks` 必须判为达成，否则 `outcome` 只能是 `partial`；`outcome = partial` 或 `not-achieved` 时 `residual` 必须非空；`serves` 出现时必须匹配 goal.md 中存在的 SG-n。未知字段处理：按 03 §6.1，未知字段不进入 canonical 对象，不得以空字段或占位代替判断。

## 9. 状态与生命周期

状态闭集三值：`draft`（计划已成形、待 Gate 1 批准）→ `open`（Gate 1 已批准、执行中）→ `closed`（终态，配 `outcome` 四值之一）。本文不设「需求审核」状态或阶段——该职责已由 31 §5 前置到讨论收敛，WorkCase 只承担执行与结果审计。

### 9.1 状态语义与成立条件

| `status` | 语义 | 必须成立 |
|---|---|---|
| `draft` | 计划格式齐全、只待 Gate 1 批准；或 C2 失效后待局部重批 | `gate_1` 不得出现；`attempt` 不得出现；`result`/`outcome` 不得出现 |
| `open` | Gate 1 已批准，工作在授权范围内执行（含中断待恢复） | `gate_1` 必填且 `authorization_fingerprint` 与当前 `plan`+`scope` 指纹一致；`attempt` 必填 |
| `closed` | 终态：Gate 2 已判定并落盘 | `result` 与 `outcome` 必填；`attempt` 已收口（不得有活跃 attempt） |

### 9.2 状态转换

- `draft → open`（**Gate 1**）：Human 明确批准后经受控更新落盘 `gate_1` 并翻转状态；同一事务追加恰好一条 change_log。批准只覆盖 `scope_snapshot` 记载的范围。
- `draft → closed`（`outcome = cancelled`）：计划未经执行即被明确取消，Human Gate；`result` 记录取消理由与未发生的范围。
- `open → closed`（**Gate 2**）：Human 依据 `result` 逐条核对结论判定 `outcome` 后翻转；`complete` 不自动等于复核通过或整体完成（02 §12 边界）。
- `open → draft`（**C2 局部重批**）：执行中 `plan` 或 `scope` 发生实质变化，使 `authorization_fingerprint` 不再匹配时，授权在受影响范围自动失效并回到待批准；`attempt` 作废（不续跑）。**回退时 `result` 与 `outcome` 必须一并清空**（保持「`result`/`outcome` 出现 ⇔ `status = closed`」不变量）——已取得的核对证据不留在对象字段中，而是写入当次 `change_log` 条目的语义摘要（记录「重批原因 + 当时已完成的 `criteria_checks` 快照结论」），作为历史依据保留。重批只针对受影响范围，不整单重走。

终态不直接重开：closed 后不得回到 draft 或 open。后来发现同范围仍需工作时创建新的 WorkCase，并在新对象的 `summary` 或 change_log 中说明接替的旧对象；若原终态记录本身错误，按事实更正规则修正，不把更正伪装成领域状态转换（与 20 §9.2 同纪律）。

### 9.3 结果审计与四种 outcome

结果审计是 WorkCase 的固有职责（31 §5），形态是 `result.criteria_checks` 对 `plan[].done_criteria` 的逐条核对：

| `outcome` | 语义 | 成立条件 |
|---|---|---|
| `completed` | 全部完成判据被判定达成 | 每条 `criteria_checks` 判为达成；`residual` 可为空 |
| `partial` | 部分判据达成，其余有明确未达成范围 | `residual` 必填且逐条说明未达成范围与去向 |
| `not-achieved` | 判据整体未达成，且已确认不再在本 WC 内继续 | `residual` 必填；须说明未达成是范围判断错误还是执行失败 |
| `cancelled` | 工作被明确取消（含未执行即取消） | 记录取消理由与实际未发生的范围；不得以 cancelled 掩盖已完成或已失败的事实 |

## 10. Gate 1 与 Gate 2 授权语义

本节是 Gate 1 与 Gate 2 授权语义的唯一权威（§3.3）。

### 10.1 Gate 1（计划与执行授权关口）

Gate 1 把格式齐全的 draft WorkCase 提交 Human 批准。提请必含（00 §4.4）：待批准的计划步骤与逐条完成判据；**本 WC 服务哪条 sub-goal**（直引 `serves` 的 SG-n，25 §10）；授权范围与明确排除（`scope`）；越权动作被机械拒绝的机制；独立复核的安排；未验证范围与风险；批准的作用范围与后续方向。

批准成立条件：Human 对准确候选与作用范围明确同意；`gate_1` 落盘且 `authorization_fingerprint` 绑定当次 `plan`+`scope` 内容指纹；状态翻转为 `open`；写后精确回读。Gate 1 不是技术验证入口（00 §4.2）：批准只证明授权及其范围，不证明计划正确、可执行或结果会达成。goal.md 缺失时 Gate 1 无法受理（授权无锚可引，25 §10 fail-closed）。

### 10.2 Gate 2（结果与关闭关口）

Gate 2 把执行结果与残留责任提交 Human 关闭。提请必含：`result.criteria_checks` 的逐条核对结论与各自依据；已证实范围、未证实范围与残留风险；建议的 `outcome` 与理由；剩余责任的去向（转入 Spark 悬置、转新建 WorkCase 或明确不跟踪）；关闭后的后续方向。

关闭成立条件：Human 判定 `outcome`；`result` 与 `outcome` 落盘；状态翻转为 `closed` 且 `attempt` 收口；写后精确回读。机械层的「记录存在」不等于语义层的「判据达成」——三层分工按 25 §8：机械层校验字段、闭集与指纹；AI 层逐条语义核对判据覆盖；Human 层终判。

### 10.3 C2 授权钉扎与局部重批

授权钉扎（C2）：Gate 1 授权绑定当次 `plan`+`scope` 的内容指纹（`authorization_fingerprint`）与 `scope_snapshot`。执行中出现下列任一情形时，受影响范围的授权**自动失效**：`plan` 步骤增删或 `done_criteria` 实质改写；`scope` 扩大或边界改写；`serves` 指向的 sub-goal 被修订或原位作废（由 25 §11 级联扫描标记 `goal-changed 待核对`）。

失效后的处置是**局部重批**而非整单重走（25 §11「按 21 号 C2 语义局部重批」）：标记受影响范围 → 生成局部重批待办 → 重新组织受影响部分的计划并提交 Gate 1 → 批准后分配新的 `authorization_fingerprint`。未受影响的已完成步骤不重新批准。授权不因 attempt 续接、会话切换、执行者更换或时间推移自动续期，也不因 attempt 有效而扩张。

### 10.4 attempt 令牌与冷恢复

attempt 令牌回答「当前谁在做、做到哪里」，**不承载任何授权**（授权只来自 Gate 1）。类型侧契约：

1. 每次进入或重新进入执行，由 Code 分配新的 `attempt_id`（单调），填写 `started_at` 与 `controller`（当次主控执行者标识）；`heartbeat_at` 由执行入口刷新。
2. 任一时刻至多一个活跃 attempt。发现 `attempt` 存在而没有活跃持有者（新会话、新主控接管或中断后），该 attempt 是**孤立 attempt**。
3. 冷恢复路径：先精确回读 WorkCase 全文（F3）与 `attempt`；再核对孤立 attempt 对应的实际副作用范围（已写入文件、Git 状态、回读结果），把「已发生但未记录」与「已记录但未发生」分开交还（00 §7.4）；最后决定续跑同一 attempt（刷新 `heartbeat_at`）或作废重开（分配新 `attempt_id`）。未核对副作用范围前不得续跑，也不得作废。
4. **宿主实现未覆盖时的声明限制**：attempt 的宿主实现、锁语义与接入**应由 08/09 承接**（`02 §18` 明示 02 不预设其语义）。**该承接落地之前**：本文定义的 attempt 字段契约（单调 `attempt_id`、至多一个活跃、孤立 attempt 判定、`heartbeat_at` 刷新）**没有可执行的宿主机械保障**，且 V6 工作接续与 HV2 授权执行受控可续中**依赖 attempt 的部分不成立**；**不得表述为已由 08/09 承接**。本项属跨规范接缝缺口；该承接是否已落地属实现现状，按 `01 §7.2` 由读取时的观察取得，本文不设状态登记载体。
5. attempt 存在、`heartbeat_at` 刷新或子代理返回，均不证明执行正在推进、已获授权、结果已达成或工作已完成。

## 11. 来源与证据

计划的来源是讨论收敛产物（31 §10.1）或 Human 直接提出的已定工作；结果的来源是当次执行的实际观察、写后回读与 Git 状态。本类型不设 `urls`：外部长期资料不进入 WorkCase，必要时在正文自然语言交代并由 `relations` / F4 展开指向 22/24 号对象。

证据形态分三层：`plan[].done_criteria` 是**判据**，`result.criteria_checks` 是**逐条核对结论**（含依据与是否已证实），正文「结果」段是**自然语言展开**（已观察什么、未覆盖什么、`residual` 为什么仍存在）。机械层只做存在性、闭集、形状、指纹与逐条对应关系校验（长度与顺序一致）；AI 层负责语义核对判据是否被证据覆盖，发现缺口时列出，不得补造证据或掩盖缺口；Human 层终判 `outcome`。三层互不替代。关系存在、文件存在、命令成功、测试通过或子代理自述，均不自动构成完成判据的证据。

## 12. 关系契约

本类型同时使用两类引用，分工明确：

| 引用 | 形态 | 方向 | 目标 | 基数 | 语义与约束 |
|---|---|---|---|---|---|
| `serves` | frontmatter 标量字段 | 本 WC → Goal sub-goal 锚点 | `SG-n` | 0..1 | 服务的子目标；必须是 goal.md 中存在的 SG-n；**不是 `relations` 条目**（锚点无 `object_uid`，03 §7.2 的关系目标只使用 `object_uid`）；反向投影由机械反查 `serves` 得到，Goal 侧不存储（25 §9） |
| `contributed-to` | `relations` 条目 | 本 WC → Pitfall | Pitfall `object_uid` | 0..n | 本次执行贡献（发现或验证）了该踩坑经验；目标必须可解析为同项目 Pitfall 对象；**Pitfall 侧不复制反向边**（03 §7.2 第 4 条，23 §11 已声明不采用 `relations`） |

关系闭集只含 `contributed-to`：不建 WC 之间的父子或依赖边（派生视图由消费方反查 `serves` 与正文引用得到，不写回对象）；不建指向 ADR/Spark/Research 的结构化关系（由正文自然语言交代并经 F4 展开）。目标缺失、不可读或不可解析时，必须保留实际边并如实报告失败范围，不得静默删除或改写为「无关系」（03 §7.2 第 5 条）。目标 Pitfall 被 `discarded` 不使 `contributed-to` 失效——经验曾发生的事实不变——但消费方必须标注目标已废弃。`serves` 指向的 SG-n 被原位作废时，`serves` 保留原值（不改写历史引用），并按 §10.3 触发局部重批。关系变更必须使用对象当前指纹绑定的完整更新入口，写后精确回读。

## 13. 召回与消费

| 消费点 | 时机 | 消费内容 |
|---|---|---|
| 31 号四路分流出口 | 收敛产物判定为可执行计划时（31 §10.1） | 计划 + 完成判据 + `serves`；成文格式权威是本文 |
| Gate 1 授权提请 | 每次 WC 授权 | 计划、完成判据、`serves`（直引 SG-n）、`scope` 与未验证范围 |
| Gate 2 关闭提请 | 每次 WC 关闭 | `result.criteria_checks` 逐条结论 + 已证实/未证实/残留 + `outcome` 建议 |
| sub-goal 达成证据链 | 25 §8 判定 `achieved` 前 | 机械反查 `serves` 收集名下 WC 关闭记录 |
| goal 修订级联 | 25 §11 goal 修订后 | 机械扫描 `serves` 受影响 SG-n 的 open WC，标记 `goal-changed 待核对` |
| Pitfall 贡献关联 | 执行期发现或验证踩坑经验时（23 §3.2） | 写 WC 侧 `contributed-to` 关系 |
| 蓝图「进行中/已完成」 | 每次蓝图渲染（10 号） | draft/open/closed 列表与 `outcome` 概览 |
| systemPrompt 注入 | 每会话（25 §10 已声明注入 active WC 列表一行摘要） | open WC 的 title + status + `serves` |

召回分层（03 §8）：F1 枚举 open WC 计数（title + status + `serves`）；F2 按类型、状态、稳定引用或 `serves` 命中的候选卡（`title`/`summary`/`scope` 有界摘录 + 命中依据）；F3 展开完整对象（含 `plan`、`attempt`、`result`）；F4 按需展开引用的 Goal/ADR/Spark/Research/Pitfall。默认候选只含 draft 与 open；closed 只在精确引用、证据链反查或历史追溯时展开。AI 展开候选后必须重新核对当前目标与 `scope` 边界——WorkCase 被召回不表示应当续跑、不表示授权仍然覆盖、也不表示可以提高优先级。

**与 31 号的交接契约**：讨论收敛产物进入 WorkCase 时，31 §10.1 保证「格式齐全、只待 Gate 1 批准」，即 `summary`、`scope`、`plan`（含逐条 `done_criteria`）与 `serves` 四项可填且未收敛点已显式分流；本文据此不设需求审核阶段——方案构建的拉锯不进入 WorkCase 状态机。交接缺失任一项时，工作包回到 31 号补收敛，不得以 draft 状态长期承载「还在变的方案」。

## 14. 受控操作

- **创建（draft）**：C1 提案对象模式（AI 只产出提案对象，含查重结果；Human 确认后经受控创建入口落盘）。创建前必须查重。机械校验：字段闭集合法、`plan` 每项 `done_criteria` 非空、`scope` 同时含做什么与不做什么、`serves`（若声明）匹配 goal.md 存在的 SG-n、`status = draft` 且无 `gate_1`/`attempt`/`result`。创建后精确回读。
- **Gate 1 批准（draft → open）**：Human Gate；AI 先做 F3 核对；Code 校验闭集、字段、指纹与回读；`gate_1` 与状态翻转与 change_log 在同一事务完成。
- **执行期更新**（进度、`result` 草稿、attempt 续接或作废）：03 §9.5 受控更新；CAS 以完整文件为单位，绑定 `content_fingerprint`；每次实际修改恰好一条 change_log（含理由）。attempt 续接必须已按 §10.4 第 3 点核对副作用范围。
- **Gate 2 关闭（open → closed）**：Human Gate；`result` + `outcome` + 状态翻转 + `attempt` 收口 + change_log 同一事务完成；写后精确回读。
- **局部重批（open → draft）**：由 §10.3 的授权失效触发；受影响范围重新组织后重走 Gate 1；`attempt` 作废；保留已取得的结果证据。
- **关系变更**（`contributed-to`）：随该次对象修改走完整更新入口，由 Code 追加恰好一条 change_log（03 §7.2 第 7 条）。WC 与 Pitfall 不要求原子共同成立（Pitfall 可独立存在并被多处引用），不按 03 §9.6 伪原子处理；但不得先写孤立关系再补对象。
- **删除**：不存在删除操作。closed WorkCase 随 `ldvh-base/workcases/` 保留为历史基线与达成证据。

## 15. 类型特有验证与类型退出

### 15.1 类型特有验证

本类型在 03 §9 公共契约之外的特有验证（与固定收尾章节 §16 验证表互补）：

- 授权钉扎校验：`gate_1.authorization_fingerprint` 与当前 `plan`+`scope` 内容指纹一致，不一致即授权失效并生成局部重批待办；
- attempt 唯一性：至多一个活跃 attempt；存在孤立 attempt 时，未完成副作用核对不得续跑或作废；
- 关闭完整性：`closed` 时 `result` 非空、`outcome` 在闭集内、`criteria_checks` 与 `plan` 逐条对应且长度一致；
- outcome 一致性：`outcome = completed` 时不得存在未达成的 `criteria_checks`；`partial`/`not-achieved` 时 `residual` 非空；
- `serves` 有效性：声明时匹配 goal.md 中存在的 SG-n；
- 关系闭集：`contributed-to` 目标必须可解析为同项目 Pitfall 对象；未知 relation key fail closed。

### 15.2 前提未满足时的声明限制（条件式）

本文以下能力在**其宿主或依赖实现补齐前**，不得被声称已经承接或已获保障：

| 依赖项 | 未满足时不得声称 | 替代保障 |
|---|---|---|
| attempt 的宿主实现（见 §10.4 第 4 项） | 不得声称 V6 接续与 HV2 受控可续中**依赖 attempt 的部分**已兑现 | **无**——在该实现补齐前，这些价值主张不成立 |
| 34 号规范的建立（见 `10 §6.2`） | 不得声称 `10 §6.2` 的 provisional 措辞已随之更新 | 本文 §3.3 已声明 Gate 语义随本文定稿不再 provisional，故 34 号未建不影响本文效力 |
| 锚点型字段命名的统一（见 `03 §7.2`） | 不得据字段名差异（`serves` vs `serves_sg`）推断语义差异 | `03 §7.2` 已登记三方同步纪律；同步完成前各类型现行登记名继续有效 |

**本节不得因依赖补齐而被改写为「已承接」或「已保障」**；依赖闭合后应删除对应行。

### 15.3 存量对象迁移

v4 存在 WorkCase 类对象（`docs/spark-workcase-rebuild.md` §5 记为高频类型）。迁移义务：**不自动迁入 v5 载体**，须经 Human 分批受控迁移，逐份满足：v4 计划 → `plan`（含逐条 `done_criteria`，v4 缺失判据的须补齐或如实标记迁移不完整）；v4 授权/范围 → `scope`；v4 归属 → `serves`（v4 无 SG-n 概念时省略并在 change_log 说明）；v4 执行状态 → `status` 与 `outcome`（v4 的收口形态须逐份映射到本文四值之一，无法映射的如实标记）。未迁移的 v4 对象保留在 v4 历史中，不进入 v5 事实源消费。迁移走受控入口（03 §9），逐份 CAS + 精确回读；未验证范围如实声明。本文不声称已完成任何实际迁移。

### 15.4 类型退出

若 Human 决定取消 WorkCase 类型，须按 03 §10 处理：处理仍适用事实、入向/出向关系（`serves`、`contributed-to`）与稳定引用，登记变化（01 §8.2）与受影响引用同步，走受控提交。退出属 00 §4.2 根决定。

## 16. 验证与证据边界

| 验证对象 | 验证时机 | 成立条件 | 可接受依据 | 验证入口 | 可证明范围 | 未满足时的处理 |
|---|---|---|---|---|---|---|
| 计划可判定性 | 创建或局部重批时 | `plan` 每项 `done_criteria` 非空且可被证据判定 | 计划全文 + AI 逐条自检 | AI 语义审核 + Human 确认 | 当次计划判据的可判定性 | 拒绝创建或回到 31 号补收敛 |
| serves 有效 | 创建时 | `serves` 匹配 goal.md 存在 SG-n | goal.md 子目标回读 | 机械（编号匹配） | 锚点解析成功 | 拒绝；或省略 `serves` 并说明 |
| 授权钉扎一致 | 执行期每次写入前与关闭前 | `authorization_fingerprint` 与当前 `plan`+`scope` 指纹一致 | 对象全文 + 内容指纹计算 | 机械（指纹比对） | 当次授权覆盖范围的机械一致性 | 授权失效 → 局部重批；不得继续执行受影响范围 |
| attempt 唯一与冷恢复 | 执行期、接管时 | 至多一个活跃 attempt；孤立 attempt 已核对副作用范围 | 对象 `attempt` + 实际文件/Git 状态 + 回读结果 | 机械（字段与状态检查）+ AI 核对 | 当次令牌状态与已核对的副作用范围 | 未核对前不续跑、不作废；如实交还残留 |
| 关闭完整性 | Gate 2 前 | `result` 与 `outcome` 落盘；`criteria_checks` 与 `plan` 逐条对应 | 对象全文 | 机械（闭集、形状、对应关系） | 当次关闭记录的机械完整性 | 拒绝关闭；补齐记录 |
| outcome 判定证据 | Gate 2 时 | 每条判据有可回读的核对结论；`partial`/`not-achieved` 的 `residual` 非空 | `criteria_checks` + 写后回读 + 机械校验结果 | AI 逐条语义核对 + Human 终判 | 各判据达成判定的证据覆盖 | 保持 open 或改判 outcome；不得补造证据 |
| 关系目标可解析 | 关系变更或消费展开时 | `contributed-to` 目标可解析为同项目 Pitfall 对象 | 关系条目 + 目标读取结果 | 机械（一跳目标读取） | 当次一跳关系与目标读取范围 | 保留实际边并报告失败范围，不静默删除 |

机械结果与语义判断互不替代：本章的机械结果只交还当次对象的存在性、格式、指纹、状态与关系校验范围，不证明计划正确、授权仍覆盖、执行推进、结果达成、残留已交接或价值成立；这些由 AI 语义审核与 Human 决定共同核对。

## 17. Human Gate

本文不新增 00 之外的 Human Gate。领域增量事项（00 §4.2 在工作执行领域的具体化）：

1. WorkCase 的创建（C1 提案对象模式）；
2. Gate 1 批准与 C2 失效后的局部重批；
3. Gate 2 关闭与 `outcome` 判定；
4. 计划或授权范围的实质变更（越过 `scope_snapshot` 的扩大或改写）；
5. `attempt` 续接或作废前对孤立 attempt 副作用范围的处置取舍；
6. WorkCase 类型本身的取消或合并。

### 17.1 决定边界

Human 决定只证明决定及其作用范围，不替代计划可判定性审核、授权钉扎的机械比对、attempt 副作用核对、结果证据核对或写后回读。

## 18. Stop Conditions

本文不新增根停止类型。领域触发与最小影响范围：

1. 未取得 Gate 1 批准（`gate_1` 缺失）却准备进入执行或分配 `attempt`；
2. `authorization_fingerprint` 与当前 `plan`+`scope` 不一致，却准备继续执行受影响范围（C2 失效未局部重批）；
3. 存在孤立 attempt，却未完成副作用范围核对就准备续跑或作废；
4. 声明了 `serves`，但 goal.md 缺失或该 SG-n 不存在；
5. 准备以 attempt 存在、`heartbeat_at` 刷新、子代理返回或工具成功冒充执行进展、授权覆盖或结果达成；
6. Gate 2 准备关闭时 `result` 缺失、`criteria_checks` 与 `plan` 不逐条对应，或存在判据核对缺口；
7. 准备重开已 `closed` 的对象，或把事实更正伪装成状态转换；
8. 准备执行越出 `scope_snapshot` 的动作（授权边界越界）；
9. `outcome = completed` 但存在未达成的判据（关闭声明超出依据支持范围）。

暂停期间只允许不越过停止边界的证据补取、指纹核对、副作用核对、引用修复、授权补走与条件核实。恢复须与触发原因逐项对应。同一停止条件恢复后再次触发的，按 00 §7.3 进入 Human Gate。

## 19. 反过度设计红线

1. 不恢复需求审核阶段或状态——该职责已由 31 号前置收敛机制承接；
2. 不把 attempt 令牌当授权——授权只来自 Gate 1，attempt 只回答谁在做与做到哪里；
3. 不建 WorkCase 之间的父子、依赖或前后继关系——派生视图由消费方反查 `serves` 与正文引用得到；
4. 不为执行过程建完整日志字段——过程在会话 transcript 与 Git 提交，`change_log` 只留一句话语义摘要；
5. 不为「部分完成」「已取消」「未达成」建独立状态值——用 `closed` + `outcome` 四值承载；
6. 不在 WorkCase 复制 Goal、ADR、Spark、Research 或 Pitfall 的内容——引用 + F4 展开；
7. 不建 `urls` 字段——外部长期资料归 22/24 号，WorkCase 只承载当次执行的观察与回读；
8. 不为未来可能的并发执行预留多 attempt 字段——当前契约是至多一个活跃 attempt；
9. 不因 Web 呈现方便而增加状态、阶段或字段——10 号按本文已定稿的语义接线；
10. 不把 Gate 1 授权模板分给 04 或 34 号——它是 WorkCase 类型语义的一部分，唯一权威是本文。
