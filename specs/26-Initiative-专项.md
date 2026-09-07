# Initiative / 专项

```yaml
ldvh_spec:
  spec_key: "initiative-fact-type"
  spec_id: "26"
  spec_kind: "spec"
  title: "Initiative / 专项"
  canonical_path: "specs/26-Initiative-专项.md"
  parent_spec: "fact-model-foundation"
  relation: "refines"
  positioning: "定义 Initiative 事实类型的目的、对象边界、字段与载体、依赖即顺序机制、状态生命周期、消费点与受控操作，是实现 goal 子目标的步骤化工作分组的唯一类型权威"
  scope: "适用于管辖项目中承载步骤化工作专项的多例 Initiative 对象及其 serves/depends_on 关系、完成判定与收官语义；不定义 Goal 子目标锚点语义（25 号）、WorkCase Gate 1 授权模板（21 号）或蓝图投影格式（10 号）"
  basis:
    - "source-of-truth-traceability"
    - "goal-fact-type"
  authorized_attachments: []
  dimensions: ["comply"]
```

## 1. 价值判断

Initiative 解决 goal 与 WorkCase 之间缺少分组层的问题：goal 是年+ 尺度的冻结锚，WorkCase 是天/周尺度的执行件——直接分解跳崖（裁定 9），导致「要做的事情往往要几个 WC 才能完成」这个语义无处承载。v4 的 152 个 WC 无章节分组，规划散落 dev-memo 与对话中（「规划模糊、进展断续」的实际病因）。Initiative 以月级步骤化工作分组承载此层：专项陈述回答做什么来达成、完成判定记录翻篇条件（收官时 AI 逐条核对并将结果记入 change_log——达成/未达成/放弃，区分留痕）、serves 指向 goal 的子目标锚点，为 WC 的 Gate 1 引用提供中间稳定层。

主要支撑 V3 边界识别（Gate 1 引用链中间层——WC 说不清属于哪个 Initiative 即暴露工作漂移）与 V6 工作接续（跨会话恢复时 Initiative 提供章节级锚点）；HV2 授权执行受控可续（蓝图「当前专项」投影）、HV5 项目演进脉络可循（Initiative 链是走过的章节史）。

Initiative 对象存在或状态为 active，不能单独证明工作正在进行、目标正在被实现或项目价值成立——须在后续 WC 关闭链中按实际效果核对。

## 2. 规范依据

1. `fact-model-foundation`：03 §6.1 公共身份字段、§6.2 载体与权威位置、§7.2 关系公共形状、§9 受控读写、§11 类型规范共同结构。
2. `source-of-truth-traceability`：06 §6 受控提交契约、§5 事实源与溯源。
3. `goal-fact-type`：25 号 §6 字段契约中 sub-goal（SG-n）锚点定义——Initiative 的 `serves` 字段引用这些锚点。

本规范不依赖外部语法或行业标准定义 Initiative 类型语义。既有设计讨论与锚点文档只用于识别设计意图，不证明当前规则成立。

## 3. 职责边界

### 3.1 本文负责

1. Initiative 类型的对象边界（步骤化工作分组、多例 5–15 个/项目）；
2. Initiative 的身份与载体（标准多例机械，`ldvh-base/initiatives/initiative-<uid>.md`）；
3. Initiative 的字段契约（frontmatter 闭集含 serves/depends_on，正文两 H2）；
4. 依赖即顺序机制（depends_on 引用、无 order 字段、蓝图按拓扑投影）；
5. Initiative 的状态闭集（active/closed）与收官前提（名下 WC 全关闭）；
6. Initiative 的消费点（Gate 1 引用、蓝图投影、goal 级联标记目标）。

### 3.2 本文不负责

1. Goal 子目标锚点语义（25 号承载）；
2. WorkCase Gate 1 授权模板与授权包语义（21 号承载）；
3. 蓝图投影格式（10 号承载）；
4. Spark→Initiative 分流判据（20 号承载）；
5. 外部流水线工件收割格式（21 号端点契约承载）。

### 3.3 相邻规范分工与唯一权威

25 号是 Goal 类型与 sub-goal 锚点的唯一权威；21 号是 Gate 1 授权语义的唯一权威；03 是公共字段与受控写入的唯一权威。本文只定义 Initiative 类型自身的边界、字段、依赖与收官语义，不复制上述相邻规范规则。

## 4. 适用范围

### 4.1 适用对象

1. 管辖项目中的多例 Initiative 对象（`ldvh-base/initiatives/` 目录下平铺单文件）；
2. Initiative 之间的 depends_on 依赖关系（依赖即顺序）。

### 4.2 适用场景

本规范用于 Initiative 的创建（Spark 升级或初始化对话跟跑）、更新（陈述/判定精化、依赖调整）、收官（名下 WC 全关闭后翻篇）与消费（Gate 1 引用、蓝图投影、goal 级联目标）。

### 4.3 明确排除与证明边界

明确排除：阶段目标（带成功标准状态机的重阶段——v1 设计已退役，Initiative 是纯分组容器）；Milestone/Phase（是 Initiative 内部叙述，不设状态机）；Feature（是 Initiative 的产品语义特例，不另立类型）；预排 WC 列表（成员关系由 WC 的 Gate 1 引用建立，倒挂挂靠——Initiative 侧不存储成员清单）。Initiative 对象存在或 active，不能单独证明工作正确、方向对准或项目价值成立。

## 5. 身份与载体

| 项 | 定案 |
|---|---|
| `fact_type_key` | `initiative-fact-type`（唯一类型定义来源即本规范） |
| 载体 | 平铺单文件：YAML frontmatter（机器权威）+ markdown 正文（家族统一约定，24/25 号同形态） |
| 权威位置 | `ldvh-base/initiatives/initiative-<uid>.md`——**标准多例机械**：object_uid + 类型子目录 + F0–F2 候选召回 |
| 公共字段 | `object_uid`（UUIDv4）、`fact_type_key`、`title`、`status`、`created_at`、`change_log`（首修后必有）；不采用 `urls`、`relations`（依赖用 frontmatter `depends_on` 承载，见 §9） |

创建与变更权：创建与收官须经 Human 决定；中间更新（陈述精化、判定调整、依赖增删）可由 AI 提议 + Human 确认后执行。查重：创建前召回既有 active Initiative，检查同主题重复（同 serves 且 title/陈述实质重叠）；发现重复时向 Human 报告并建议合并或明确差异后再创建。

## 6. 字段契约

frontmatter 闭集（全部必填，除标注外创建时一次落定）：

| 字段 | 类型 | 语义 | 约束 |
|---|---|---|---|
| `fact_type_key` | string | 固定值 `initiative-fact-type` | 机械校验 |
| `object_uid` | UUIDv4 | Code 受控创建时生成 | 不可变；多例身份 |
| `title` | string | 专项陈述收紧后的短标题 | ≤ 40 字 |
| `status` | string | 闭集 `active` / `closed` | 初态必为 `active` |
| `serves` | array[string] | 服务哪条 sub-goal（goal.md 内 SG-n 锚点列表） | 可为空数组（goal.md sub-goal 空缺时的回退：语义=服务 goal 本体，与 25 号 Enforcement 对称）；非空时值必须匹配 goal.md 子目标锚点编号且**不得引用已作废锚点** |
| `depends_on` | array[string] | 依赖哪些 Initiative（object_uid 列表） | 可空数组（无依赖=可立即启动）；不得自引用；不得循环 |
| `created_at` | RFC3339 | Code 受控创建时填写 | AI 不得填写 |
| `change_log` | array | 每次实际修改恰好追加一条 | Code 托管；AI 提供语义摘要；含理由 |

正文两块固定 H2：

```
# <title>
## 专项陈述        ← 这章是什么、为什么做；一段话
## 完成判定        ← 何时翻篇；清单或叙述均可，但必须可判定
```

**serves 引用校验**：`serves` 数组的每个值必须匹配 `ldvh-base/goal.md` 子目标节中存在的 SG-n 编号。goal.md 不存在时创建 Initiative 应被拒绝（锚定前提缺失）。goal.md 存在但 sub-goal 空缺时，serves 可为空数组（语义=服务 goal 本体，与 25 号 Enforcement 的「sub-goal 空缺时 WC 可正常走」对称）。**新建或更新时禁止引用已作废锚点**（原位标记「已作废」的 SG-n——新工作锚定死目标无意义）；既有 Initiative 的历史 serves 引用不变（作废前的引用是合法历史，不回溯清除）。

**depends_on 校验**：数组中每个 object_uid 必须解析到 `ldvh-base/initiatives/` 目录下存在的 Initiative 对象。**不得形成循环**（机械检查：沿 depends_on 链遍历不得回到自身）。**依赖排序是蓝图展示性排序，不是 Gate 1 前置条件**——WC 可在任何 active Initiative 下被授权（依赖只影响蓝图「下一步」区块的排序与「当前专项」区块的可用性判断，不阻止授权）；多级链（A→B→C）中 B 收官即解锁 A（传递性：依赖的传递遍历到已关闭节点即视为该链满足）。依赖的 Initiative 收官不区分交付达成/放弃（纯排序约束）。

## 7. 状态与生命周期

状态闭集两值：`active`（进行中）→ `closed`（已收官）。

- `active → closed`：**收官前提**（两条同时满足）——①名下全部 WC 已处于 closed 终态（无 open WC）；②完成判定核对（AI 逐条核对，结果记入 change_log：达成收官/放弃收官，含理由）。若有 open WC：关闭它们（各走各的终态），或**重新归属**其他 active Initiative（见下），否则 Initiative 保持 active。收官操作=受控更新 status=closed，change_log 记录收官类型与理由。收官后 Initiative 成为历史（不重开；名下新工作应开新 Initiative）。
- **重新归属**：open WC 从本 Initiative 转入另一 active Initiative——目标 Initiative 必须 active 且其依赖约束不受影响；WC 的 Gate 1 授权按 21 号 C2 语义处理（范围变化→授权自动失效→局部重批）；两个 Initiative 的 change_log 各留一条（转出方记「WC 转出至 <uid>」，转入方记「WC 转入自 <uid>」）。
- **完成判定核对语义**：达成收官=完成判定条件满足（AI 核对，Human 确认）；放弃收官=完成判定条件未满足但工作已终止（AI 记录未满足项，Human 确认放弃理由）。两种都是合法收官，**必须在 change_log 中区分**（HV5 演进脉络）。
- 不存在的转换：不设 abandoned（放弃=放弃收官的一种，走正常 active→closed 转换，change_log 记「放弃收官」）。

## 8. 来源与证据

专项陈述与完成判定是 Human 意图的结构化表达，来源是 Human 决定（Spark 升级、初始化对话跟跑、或直接创建时的确认记录），不适用外部证据锚定。

完成判定的可判定性与 Goal sub-goal 相同的审核纪律：AI 提议时逐条自检（这条判定能被证据判定吗？判定材料是什么——名下 WC 的关闭记录？），Human 确认。

## 9. 关系契约

不使用 `relations` 字段（类型来源声明不采用，03 §7.2 允许）。两条核心关系以 frontmatter 字段承载：

- **`serves: [SG-n]`**——上引 Goal 的子目标锚点。这不是 fact-to-fact 关系（Goal 是单例，SG-n 是其内部字段），是「对象内字段引用」形态。反向投影（某 SG-n 名下有哪些 Initiative）由机械反查 serves 得到。
- **`depends_on: [object_uid]`**——平级 Initiative 间依赖。这是 fact-to-fact 关系，但依赖图是简单的 DAG（无循环、无证据定位），不值得引入 relations 完整机械。反向投影（谁依赖我）由机械反查 depends_on 得到。

## 10. 召回与消费

标准 F0–F2 候选召回（多例机械）。消费点：

| 消费点 | 时机 | 消费内容 |
|---|---|---|
| Gate 1 授权提请 | 每次 WC 授权 | 必含「本 WC 属于哪个 Initiative」——且该 Initiative 必须 active（closed Initiative 不可被新 WC 引用，机械拒绝） |
| 蓝图「当前专项」区块 | 每次蓝图渲染 | active 且依赖已满足的 Initiative 列表 |
| 蓝图「下一步」区块 | 每次蓝图渲染 | active 但依赖未满足的 Initiative，按 depends_on 拓扑排序 |
| 蓝图「已完成」区块 | 每次蓝图渲染 | closed Initiative 及其名下 WC 关闭链 |
| goal 级联标记 | goal 修订后 | serves 受影响 SG-n 的 active Initiative 被标记「goal-changed 待核对」 |
| systemPrompt 注入（引导段） | 每会话 | active Initiative 列表一行摘要 |

## 11. 受控操作

- **创建**：来源三途——①Spark 升级（Human 裁决「值得追·是专项」）；②项目初始化对话跟跑（AI 顺手提议「要不要先立一两个专项」）；③直接创建（Human 在任意会话中提出）。机械检查：goal.md 存在（锚定前提）、serves 值匹配 goal.md 子目标锚点、depends_on 无循环、title 非空、status=active。创建后回读。
- **更新**（陈述精化、判定调整、依赖增删）：03 §9.5 受控更新；CAS 绑定 content_fingerprint；AI 提议 + Human 确认。
- **收官**（active→closed）：前提=名下全部 WC closed；Human 确认；change_log 记录收官理由。收官后名下新工作应开新 Initiative（不重开旧 Initiative）。
- **删除**：不存在删除操作。Initiative 是历史记录。

## 12. 验证与证据边界

| 验证对象 | 验证时机 | 成立条件 | 可接受依据 | 验证入口 | 可证明范围 | 未满足时的处理 |
|---|---|---|---|---|---|---|
| serves 引用有效性 | 创建与更新时 | serves 值匹配 goal.md 子目标锚点编号 | goal.md 子目标节回读 | 机械（锚点匹配） | 当次引用可解析性 | 拒绝创建/更新；修正 serves 值 |
| depends_on 无循环 | 创建与更新时 | depends_on 链遍历不回到自身 | 依赖图遍历结果 | 机械（DAG 校验） | 依赖图无环性 | 拒绝创建/更新；修正依赖 |
| 收官前提 | status 翻转前 | 名下全部 WC 处于 closed 终态 | Gate 1 引用反查名下 WC 状态清单 | 机械（Gate 1 引用反查） | 当次收官的 WC 覆盖完整性 | 拒绝收官；先关闭/转移/保持 active |
| 完成判定核对 | status 翻转前 | AI 逐条核对完成判定，结果（达成/放弃）记入 change_log | change_log 收官条目含核对结果 | AI 审核 + Human 确认 | 当次收官的类型判定 | 补走核对；未核对不得收官 |
| Gate 1 active 约束 | 每次 WC 授权 | 被引用 Initiative 必须 status=active | Initiative 文件 status 字段 | 机械（status 检查） | 当次引用的 Initiative 可用性 | 拒绝引用 closed Initiative；提示开新 Initiative |
| 修订授权 | 每次更新 | change_log 对应一次 Human 确认记录 | change_log 条目 + 会话确认记录 | AI 语义审核 | 当次修订的授权事实 | 撤回未授权变更 |
| 级联标记正确性 | goal 修订后 | serves 受影响 active Initiative 全部被标记 | serves 反查结果与标记清单对照 | 机械（serves 反查） | 当次扫描的引用链完整性 | 补标遗漏项 |

Initiative 对象存在或 active，不能单独证明工作正确、方向对准或授权工作已开始。机械校验结果与 AI 语义判断互不替代——前者证明格式与引用完整性，后者证明语义合理性，两者通过不证明对方。

**类型退出**：若 Human 决定取消 Initiative 类型（如并入 Goal 或 WorkCase 承载），须按 03 §10 处理。退出属 00 §4.2 根决定。

## 13. Human Gate

本文不新增 00 之外的 Human Gate。领域增量事项：

1. Initiative 的创建与收官；
2. serves/depends_on 的实质变更（改变工作归属或顺序）。

Human 决定只证明决定及其作用范围，不替代 Initiative 的收官核对、依赖校验或机械检查。

## 14. Stop Conditions

本文不新增 00 之外的根停止类型。

出现以下任一情况时，按 00 §7.2 暂停最小受影响范围：

1. 创建时 goal.md 不存在（锚定前提缺失）；
2. serves 引用已作废锚点（新创建或更新时——作废锚点不可作为新工作目标）；
3. depends_on 形成循环（依赖图无环性违例）；
4. 收官时名下存在 open WC 或完成判定未核对（收官前提违例）；
5. Gate 1 引用 closed Initiative（active 约束违例）；
6. AI 未经 Human 确认直接修改 Initiative（授权缺失）。

暂停期间只允许不越过停止边界的证据补取、引用修复、授权补走与条件核实，不得继续受影响对象的创建、更新、收官或消费。恢复须与触发原因逐项对应。同一停止条件恢复后再次触发的，不得再次自行恢复，必须按 00 §7.3 进入 Human Gate。

## 15. 反过度设计红线

1. 不为 Initiative 建立自己的成功标准体系——完成判定是翻篇条件，不是 SC 层级（那是 Goal sub-goal 的职责）；
2. 不预排 WC 列表——成员关系由 WC 的 Gate 1 引用建立（倒挂挂靠），Initiative 侧不存储成员清单；
3. 不设 order/sequence 字段——顺序由 depends_on 依赖拓扑涌现，蓝图按拓扑投影，不手写维护排序；
4. 不为依赖关系引入 relations 完整机械——depends_on 是 frontmatter 字段，简单数组足够；
5. 不为 Initiative 收官设独立 Gate 形态——收官走普通受控更新+Human 确认。
