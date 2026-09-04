# dsh-mnemon 检查点复查机制研究：对 LDVH 反思触发与沉淀读取的设计输入

> 性质：开发设计输入（非规范、非事实对象），供八维反思维/沉淀维与 20–24/30–38、`eight-dimension-action-baseline.md` 起草参考。
> 任务来源：Human 观察到 dsh-mnemon 在 session 中注入 "Review the inherited completed checkpoint now."，要求研究该记忆系统的**触发时机、触发方式、以及记录后如何读取**，并评估对 LDVH 反思/沉淀维的意义。
> 研究对象：dsh-mnemon v0.4.4（已调研，见 `docs/investigation-report-dsh-mnemon.md`）。本文件聚焦其"idle checkpoint review"（空闲检查点复查）完整链路。
> 方法：主控第一手源码核验（lifecycle.ts / subagent.ts / review-activity.ts / memory-view.ts / tools.ts / guidance.ts），所有引用回指代码位置；§9 为同一机制在本机的实测故障取证（session 流交叉，非源码推断）。
> 关联：八维讨论记录 §5.4（反思何时触发、避免每轮复盘、HV4 只增不减）、§6.6–6.10（闲聊→提炼→沉淀定位：可检索档案 + Spark=记录有价值闲聊）、读维 F0-F4 分层召回、writebackMode/recallMode。

---

## 1. 一句话结论

dsh-mnemon 把"检讨"做成了 **"turn 结束后、空闲时、过三重机械门槛才触发的一次有界独立复盘"**——只消化已完成检查点、默认不动、最多动一处、绝不越层写入；"沉淀"则**分层落库、每层准入不同、回读三拉一推**。这套"触发饥饿控制 + 分层沉淀 + 预算化回读"是 LDVH 把反思/沉淀从"语义自觉"推向"机械可证"的最成熟参考；但其"at most one 靠 persona 而非 Host 计数"的自陈局限，是 LDVH 必须避免的反面教训。

---

## 2. 触发时机（何时触发）——三重机械门控

调度入口 `scheduleIdleReview`（lifecycle.ts:435-449），触发不是"每轮都查"，而是"本轮结束、且过三道廉价门槛、且轮空时才查"：

**① 总开关（lifecycle.ts:436）**：`lifecycleEnabled && writeEnabled && writebackMode==='guided'` 三条件同真才启动。任一不满足整条链路不存在。

**② 廉价 Host 信号准入 `reviewAdmitted`（lifecycle.ts:503-537）**——先判断"本轮是否值得花一次 LLM 调用"，四 OR 任一为真：
- 用户显式记忆候选（`EXPLICIT_MEMORY_CANDIDATE` 正则：`记住/记下来/please remember` 等）；
- 累计用户文本 ≥ **320 字符**；
- 累计助手文本 ≥ **600 字符**；
- 做过非 `mnemon_*` 工具调用。

**否决优先**：`NO_MEMORY_MAINTENANCE` 正则（"不要/禁止记住/保存…"）命中即整个本轮豁免——**用户显式拒绝优先于一切准入**。

**③ 确定性评分门槛 `scoreReviewActivity`（review-activity.ts:7-46，策略源自 QoderWork 0.9.12）**：
```
score = min(floor(用户文本/50), 3)     // 文本长度分 cap3
      + turnCount×1                     // 轮数分
      + min(floor(工具调用/5), 2)       // 工具调用分 cap2
      + min(唯一工具数-3+1, 2) (≥3)     // 工具多样性分 cap2
threshold=5；eligible = score>=5
```
**用文本长度而非 token 用量**——保证 adapter 缺 usage 数据时门禁仍稳定。

**④ 空闲 + 延迟**：门槛全过后 `setTimeout(idleReviewMs 默认 30s)`，届时再确认 agent 仍 `idle` 且 `turn/end` 已完成才真正执行（lifecycle.ts:445-451）——**后置检查点**，在用户不再输入时才批处理、不打断进行中工作。

## 3. 触发方式（怎么触发）——fork 有界委派

准入通过后 `runIdleReview`（lifecycle.ts:452-475）：

- **fork provider 子代理**（subagent.ts:1333），fork 语义=**继承父会话已完成检查点**（`inheritsParentContext=true`），即"只看到已结束的父对话，非延续当前任务"；
- **工具有界**：`REVIEW_TOOLS = [mnemon_document_search, mnemon_runtime_memory, mnemon_document_manage]`（subagent.ts:45）——**排除了 mnemon_remember/forget 与 Memory Space 维护工具**，后台审查不能直接写长期记忆；
- maxDepth 1、可取消、一次性随机命名 result 工具、`WRITE_SCHEMA` 强制结构化输出（`{summary, action∈[skipped/stored/…], memoryBodyIds, documentIds}`，subagent.ts:135-141）；
- **REVIEW_PERSONA**（subagent.ts:672-698）："默认不写、最多一次热记忆变更或一个文档、绝不转冷归档、绝不二次委派、父 TurnView 关闭后深度召回不可用、只用继承检查点与有界文档搜索"；`action` 默认 `skipped`。

> **诚实边界**（workflows.md:299，已核验）："at most one hot-memory mutation **by persona**"——"至多一个"目前是 persona 约束而非 Host 计数器。这是 dsh-mnemon 自陈的局限。**LDVH 的直接教训**：反思是否执行、至多几处，必须 Host 机械可证（计数器/守卫），不能只写进提示词。

## 4. 写什么 + 怎么写（沉淀判定与分层去向）

REVIEW_PERSONA + REVIEW_TOOLS 规定**三层不同目的地、每层准入不等**：

| 目的地 | 工具 | 判定标准 | LDVH 对接 |
|---|---|---|---|
| **热记忆（MEMORY/USER）** | mnemon_runtime_memory | 仅用户**显式/持久**论断；问题、一次性格式请求、AI 声明、推理、原始工具输出一律不合格；target=user 仅偏好/身份 | **沉淀**（同 Spark 受控承接的判断门槛） |
| **项目文档** | document_search + document_manage | 检查点产出**实质可复用工件**（调研设计/架构理由/操作步骤/带证据调查/交接）→ 更新/新建一个文档 | 反思产物→可沉淀文档（≈ ADR/Pitfall/Study） |
| **不写** | — | `skipped` 默认；用户 no-maintenance 覆盖一切 | 反思后判定"无需沉淀" |

**分层纪律**：Memory Spaces（mnemon_remember）在 REVIEW_TOOLS **被排除**——审查 worker 不能直接做长期记忆写入；长期迁移走另一条独立 MEMORY 归档 worker（容量超限时触发）。即：**热记忆/文档是审查 worker 能到的最大深度，长期记忆需单独准入**。

## 5. 怎么读取记录（回读路径）——三拉一推，四通道

所有渠道经 `requireLayer(exec, layer, capability)` 门控，分"拉"与"推"：

**🟢 拉取（on-demand，模型主动调用才查）——三种工具各有 budget：**

1. **mnemon_recall**（Memory Spaces 深度召回，tools.ts:218-240）：每轮初始 1 次 + 至多 1 次实质不同细化，两轮共享 ≤6 条/4,800 字符 envelope；`requirePinnedView:true`（绑本 turn 的 MemorySource）；**重复查询按 digest 回放零 Provider 成本**（subagent.ts:1024）；可 `mnemon_related` 沿图遍历一次。**关键语义**（subagent.ts:975）："模型选的 category/source/intent 语义过滤太脆、不能当权威——一个错 category 可能藏住确凿证据"，故只用 query + pinned Source 作完整路由契约，不用语义过滤。
2. **mnemon_document_search**（Documents 词法检索，tools.ts:283）：每 turn **一次**；title/desc/content 加权评分 + `lexicalRequiredMatchCount` 门槛；命中写回 `lastAccessedAt`（LRU 归档依赖它）。
3. **mnemon_runtime_memory**（热记忆写回查重）：写入前先 compare against latest snapshot 再决定 add/replace/remove——**写入前回读，保证不重复、精确替换**。

**🔴 推（proactive，每轮自动进上下文）——两类 source：**

4. **Runtime MEMORY.md/USER.md 快照（eager Wake）**：`createRuntimeMemorySource`（memory-view.ts:36-49）把热记忆全文作为 **eager 源**每轮注入——**唯一"记录后天然在场"的通道**，热记忆条目用不到"主动读取"。
5. **Documents / Memory Spaces 仅路由覆盖（routed Wake）**：不注入内容只注入数量摘要——`"N active of M configured Memory Space across K Provider."`（memory-view.ts:78-105，本会话当前路由即此输出）+ `state.documentIds` 权威但不进 Wake；完整内容不在 prompt，需模型主动拉取。

**读取决策引导**：GUIDANCE（guidance.ts:9，即本会话 `[MNEMON]` 提醒）写死"**Use memory only when needed**……Call mnemon_recall for durable history or exact prior details; never infer a missing historical rule"——**默认不用，缺历史才主动拉**；routed wake 提供"存在 N 个空间/文档"的低成本信号，让模型知道"有可挖、细节要花钱（budget）取"。

## 6. 对 LDVH 八维的直接启示（与差异）

这是 dsh-mnemon 对**反思维最有价值**的部分——它把"何时值得回顾并固化"量化为机械门槛，而 LDVH 反思触发目前仍是语义的。

| dsh-mnemon 检查点复查 | LDVH 反思/沉淀现状与讨论 | 启示 |
|---|---|---|
| 触发=三重机械门控（总开关×信号准入×评分≥5+空段+断言 turn/end 完成） | 反思触发靠语义（v4 conductor 失败→定位→重试→三次上限为最强证据；讨论 §5.4"何时触发、避免每轮强制"） | **反思触发可部分机械化**：文本量/工具多样/失败计数/候选词可做廉价前置门槛，先滤掉"不值得反思"的轮次，预算留给真正的 LLM 反思轮 |
| fork 有界委派（继承已完成检查点、排除写类工具、maxDepth 1、可取消、单上限） | v4 复盘会话、反思 worker | **复盘会话应与主对话隔离**：只继承已完成检查点、不能写事实源、默认不动、有终止条件——fork 五件套是现成范本 |
| 评分用文本长度不用 token（adapter 缺 usage 也稳定） | 反思是否每轮强制、成本面 | 连门禁都要考虑数据缺失时的行为；LDVH 亦然 |
| 沉淀分层 + 每层准入不同 + 审查只到文档层 | 沉淀分层（Spark→事实、闲聊→Spark、讨论 §6.8-6.10） | 沉淀必须分层 + 各层准入不同；审查 worker 不应有最深层写权限 |
| "at most one" 靠 persona 非 Host 计数（自陈局限） | LDVH 写维"实际变化可核对" | **直接反面教训**：反思是否执行必须 Host 机械可证，别靠提示词 |
| 回读三拉一推：MEMORY 时刻在场（eager）、文档/空间仅数量覆盖（routed）、深度内容才拉（recall 进 budget）；拉取前先回读查重 | 读维 F0-F4 分层召回 | **F0-F4 预算模型**：一层时时在场（热）、一层给路由覆盖（不消费上下文）、一层深度召回进 envelope；写入前先查重（沉淀前先查重，呼应 v4"开 Spark 前查重"） |
| 语义过滤不当权威（category/source 过滤可能藏证据），只用 query+pinned source 作路由契约 | 03 §8 相似度不自动裁决；v4"开 Spark 前查重" | **召回路由不要靠脆弱语义过滤**；pinned source 权威（本 turn 绑定空间子集）防拉越界/跨项目 |
| 分层写入（worker 写热记/文档→独立 worker 迁记忆） | 沉淀维语义判断 + Helper 确定性执行 | 语义判断与机械写入分离：模型定"值得/去哪"，机械层定"字节/回读/revision" |

## 7. 关键词句回指（file:line）

- 触发调度：`lifecycle.ts:435-451`（scheduleIdleReview 三重门控 + setTimeout + 空段确认）
- 信号准入：`lifecycle.ts:503-537`（reviewAdmitted 四 OR + noMaintenance 否决优先）；正则 `lifecycle.ts:131-152`
- 评分：`review-activity.ts:7-46`（QoderWork 策略、threshold 5、用文本长度）
- 执行：`lifecycle.ts:452-475`（runIdleReview 标记/失败处理/turnActivity 清空）
- 委派：`subagent.ts:1332-1341`（"Review the inherited completed checkpoint now." + fork + REVIEW_TOOLS + WRITE_SCHEMA + REVIEW_PERSONA）
- persona："默认不写/最多一处/不转冷归档/不二次委派/深度召回不可用" `subagent.ts:672-698`
- 诚实边界："at most one by persona" `docs/en/workflows.md:299`
- 读取四通道：`tools.ts:218-240`（recall）、`tools.ts:283`（document_search）、`memory-view.ts:36-49`（eager runtime）、`memory-view.ts:78-105`（routed documents/memory-spaces）
- recall 预算/回放/语义过滤弃用：`subagent.ts:973-1084`
- 引导："Use memory only when needed…never infer" `guidance.ts:9`

## 8. 待决/未验证

- "至多一次"如何从 persona 升为 Host 计数（LDVH 若吸收须自行实现，不能照搬其薄弱点）；
- 三重门控的阈值（320/600 字符、threshold 5）能否直接迁移到 LDVH，还是需据 LDVH 实际 action 频率重标定（本文件不预设）；
- 复查失败的兜底记录、Mnemon runtime pin 的并发归属与释放策略如何设计（实测故障依据见 §9）；
- 本文为设计输入，不构成任何机制已在 LDVH 落实的证明；落 20-24/30-38 与行动基线前按受控流程另行处理。

## 9. 实测故障观察（2026-09-04，本机第一手取证）

> 上述 §2–§5 为源码核验；本节是**同一机制在本机真实运行的一次完整故障实录**——研究该机制当天，它恰好被本项目的 dsh-ldvh 工作会话触发并故障，两条 session 流交叉取证。日期以 session 流 time 字段与 git 提交时间的机器时间戳为准（2026-09-04）；对话内文本与提交信息正文自称"2026-09-06"，两处不一致，未裁断。

### 9.1 故障时间线（父/子两流按 seq 对齐）

| 机器时间 | 流 | 事件 |
|---|---|---|
| 16:12:36 | 父 `session-d181f1ff` | turn 35 完成（八维串联战果总结 + 提交 `43a2d4c`；末步 usage `totalTokens: 200285`）。文本量、工具多样性必然过 §2 三重门槛 |
| 16:13:06 | 子 `6b065362…` | 复查 fork 创建：one-shot / provider=fork / label "Mnemon idle checkpoint review"；**seed=49,620 事件全量继承**；prompt 即 §3 那句 "Review the inherited completed checkpoint now."；路由 deepseek-v4-flash@zzztoken（contextWindow 512,000） |
| 16:16:31 | 父 | 用户发「继续」→ turn 36 立即 `turn/end` 错误：**"Mnemon runtime is already pinned for Agent session-d181f1ff-…"**（code UNKNOWN）。父会话被卡死，此后父流再无任何事件 |
| 16:18:06 | 子 | 首次请求 `finish.reason=error`：**"pi-ai stream idle timeout after 300000ms"（TIMEOUT）**——请求发出整整 300 秒零输出 |
| 16:18:07 | 子 | `llm/retry` #1（max 5）启动后，子流再无任何事件——**复查零产出死亡** |
| 16:19+ | 新会话 | Mnemon 快照正常注入（runtime pin 已随复查会话死亡释放） |

### 9.2 故障 A：大上下文复查请求整段流式超时

复查 fork 继承全量历史（父会话末轮 usage 约 20 万 token 量级），走 deepseek-v4-flash + zzztoken 中转：300 秒 idle timeout 零字节 → 重试挂起 → 会话死亡。**因果归因不裁断**——超时只能证明"大 seed × 该路由"组合实测不可用，不能证明单一因素。后果：复查完全未执行，且**无任何兜底记录**——若无人事后取证，这轮"值得复盘"的判定就静默丢失了。

### 9.3 故障 B：复查在飞期间 Mnemon runtime pin 阻塞父会话

pin 以 Agent 会话为粒度（错误消息点名父 Agent id）。复查 fork 在飞时，**父会话自己的下一轮直接报错终止**——一个"默认不动、最多动一处"的后台复查，失败时能把主会话卡死。父会话无重试、无自动恢复迹象；用户视角是「继续」指令无声失败（错误只在会话流里，未回报给用户）。

### 9.4 对 LDVH 反思维/沉淀维的新教训（补充 §6 表）

1. **复查失败必须有机械兜底记录**：至少留一条"复查未执行 + 原因"的痕迹（呼应 06 "机械可证"），不能让"值得复盘"的判定静默蒸发；
2. **后台复查绝不得阻塞前台**：LDVH 若吸收 fork 复盘会话，pin 归属/释放/并发要在设计里明确——父会话继续工作必须是独立通路（这是比 §6 "at most one 靠 persona" 更根本的反面教训：连"不动"的复查都能伤到主会话）；
3. **复查通道按"继承全量历史"量级选型**：路由、预算、超时都要按最坏 seed 大小定，且大上下文下 5 分钟超时可能根本不够首字节；
4. **取证方法可复用**：`zstd -d` 解开父/子两条 `session.jsonl.zstd`，按事件 seq 与 time 交叉对时间线（本次完整故障链就是这样对出来的）。