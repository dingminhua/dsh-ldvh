# LDVH 插件技术框架：以 dsh-mnemon 为工程基底的架构定稿

> 性质：开发设计文档（技术框架决策记录），非规范、非事实对象。
> 依据：specs/00/03/05/07/08（规范源）；`../dsh-mnemon` 源码研读（工程参考）；v4 仓库 `/Users/dmh2002/poker_hud_projects/ld-vibe-harness-v4`（架构前身）。
> 日期：2026-09-03。
> Human 定案方向：**LDVH 插件以 dsh-mnemon 为原始工程参考，在其已验证的宿主接入模式上叠加 LDVH 的思想与功能**。读侧（召回/预热/注入）与 mnemon 高度同构，直接以其为范本；写侧按 v4 架构——五类事实对象受控写入，与 mnemon 的"随意写"根本不同。
>
> **成熟度定位（Human 确认 2026-09-03）**：mnemon 工程成熟（宿主机制坑已躺过、实战验证、分层架构），LDVH 治理思想成熟（v4 用 152 个 WorkCase / 103 个 Spark 换来的规范体系）而工程实现还幼稚——所以是"mnemon 基底 + LDVH 思想"，不是反过来。**向 mnemon 学工程，不因 mnemon 改治理语义**（三条红线：概率召回、自由写、全局生效）。

## 1. 一句话定位

- **dsh-mnemon**：三层记忆控制面（runtime 热记忆 / Documents 项目文档 / Memory Spaces 长期记忆）。写得自由（模型随时 remember），读得聪明（provider 概率召回 + 预热注入）。
- **LDVH**：长程 Vibe Coding 治理。读侧与 mnemon 同构（候选召回 + 预热注入 + 生命周期工程）；写侧是**受控写入**——事实只能落成五类事实对象（ADR / Pitfall / Spark / WorkCase / Study），经 Helper 确定性执行 + Git Gate 机械守护，AI 无自由写权限。

### 1.1 服务范围：架构级分水岭（Human 补充定案 2026-09-03）

**mnemon 为所有项目服务；LDVH 只为管辖项目服务。** 这不是功能差异，是架构前提差异：

| 维度 | mnemon | LDVH |
|---|---|---|
| 作用域 | 全局：任何会话、任何 cwd 都激活 | **门控**：仅登记在 `governed-projects.yaml` 的管辖项目（07 §5） |
| 数据落点 | DSH 用户配置根（`~/.dsh` 体系），插件自己的存储 | **用户项目目录内**（`ldvh-base/` 事实源随项目 Git 仓库走） |
| 写入后果 | 写进插件私有空间，与项目无关 | **写进用户项目**，随 Git 版本化、随仓库分发，污染即事故 |
| 门控失败语义 | 无此概念 | not_governed 零干扰（§15-1）；unavailable fail-closed 不猜态（07 §7） |

由此推出三条硬约束：

1. **一切能力先过管辖判定**：工具注册（agent-scoped）、引导注入、pre-step 预热、Web 呈现都以三态为前置——mnemon 的任何"全局生效"模式都不能直接照搬，必须先过 governance 门；
2. **写入路径的双重边界**：写 `ldvh-base/` 既受 Helper 受控写入契约约束（03 §9），也受 DSH 文件沙箱约束——它落在**当前会话工作区内**（管辖项目 Git 根下），与用户配置根的登记载体（跨工作区路径，写入授权归 08 §6）是两类授权路径，不得混用；
3. **跨项目隔离**：同一 Host 多会话并存时，governed 会话有工具/引导/预热，not_governed 会话（哪怕同一插件实例）必须零感知——agent-scoped 注册是硬要求，不是风格选择（mnemon 全局注册模式在此不可采用）。

mnemon 也有 per-workspace 概念（workspaceRegistry、cwd 路由、agent 级 shadow），但其用途是"把记忆路由到对应项目"；LDVH 的管辖判定用途是"决定这个会话**配不配**有 LDVH"——方向相反，前者是分发，后者是门禁。

**分工结论**：mnemon 补"记忆的工程形态"，LDVH 补"治理的语义与边界"。凡是 mnemon 已经做对的宿主机制（挂载、注入、缓存、清理、降级），LDVH 不重新发明；凡是 LDVH 规范已有定义的部分（三态判定、五类事实、受控写入、机械签名），mnemon 没有对应物，按规范源自建。

## 2. 读侧同构对照（以 mnemon 为范本）

### 2.1 上下文注入四通道（mnemon 实证，LDVH 采用但全部过管辖门）

> 注：通道机制照用，但每个通道的激活都以管辖三态为前置（§1.1 硬约束 1/3）——mnemon 的"全局生效"在 LDVH 一律降级为"governed 会话生效"。

| 通道 | DSH 机制 | mnemon 用途 | LDVH 对应 |
|---|---|---|---|
| ① 全局 section | `systemPrompt(ctx).section({name, order, text})` | 路由引导一行 | **七锚点最小引导**（01 §10.4），text 函数按管辖态返回引导/空/fail-closed |
| ② agent 级 shadow | `agent.ctx.get('systemPrompt').section/context` | per-agent 覆盖全局同名段 | 管辖态/项目身份段（governed 会话 shadow 全局空段） |
| ③ runtime context | `systemPrompt(ctx).context(...)` | （已弃用，见 ★） | 不用 |
| ④ 插件自有消息 ★ | `agent/pre-step` 瀑布追加 `{role:'user', source:{kind:'plugin', plugin, form}}` | 记忆快照 + recall/remember 提醒 | **事实候选预热 / 模板路由**（08 §5.3 行动前引导） |

★ mnemon 的关键教训（代码注释原话）：大块易变内容曾经走 ③ 共享 runtime-context 投影，结果一次写入导致**所有**贡献者 section 全部重发；改走 ④ 自有消息后，快照归属插件自己，supersede 靠"完整块 + 渲染文本 digest 键"自行实现，不污染他人缓存。LDVH 直接继承该结论：**稳定引导走 ①②，易变预热走 ④**。

### 2.2 ④通道的工程细节（照抄清单）

- 挂 `agent/pre-step`，`{ prepend: true }` 拿到全量批次；只在 `step === 1` 注入；
- `ownRequest` 检查：本回合消息已是本插件产出时不叠加（防自激）；
- digest 去重：渲染文本未变不重复注入；
- `cueAlreadyVisible()` 扫 `session.surface.nodes` 判可见性——rewind 不触发 session-start，不能用会话级 flag；
- 快照追加在本插件消息块最底部（离生成最近）；
- `form` 字段区分语义：mnemon 用 `recall/notice/instructions`，LDVH 增 `template`（行动模板路由）。

### 2.3 读写总纲：格式化写、程序化读、大模型理解（Human 定案 2026-09-03）

**LDVH 读写架构总纲十二字：格式化写、程序化读、大模型理解。** 本节为最高原则，统领召回（§2.3.1）、写入（§2.3.2）与分类型设计（§2.3.3）。

**与向量派的哲学分野**：向量库"无所谓怎么写，反正是计算出来的"——写入无格式、读靠向量计算、LLM 只看到召回结果；LDVH 反其道——**写入格式 = 召回路径的预埋**（第零原则），读靠程序确定性枚举/投影，语义理解明确划给 LLM。

**第零原则：写入格式是召回路径的预埋。** 召回的难度在写入那一刻被决定；每个必填字段都必须回答"这个字段支撑哪个召回场景"——没有召回场景的字段不设计，没有字段支撑的召回场景不承诺。字段质量纪律（decision 一句话、symptoms 观察者语言、title 即检索键）不是写作建议，是对象成立的校验项：形状校验 CLI 机械做（非空、长度、结构），**语义质量进独立复核**（"这句话真的说清了约束吗"由 LLM 复核把关）。

**行业四范式对比与可行性（2026-09-03 调查后评估）**：

| 范式 | 写 | 读 | 理解 | 代表 |
|---|---|---|---|---|
| 向量派 | 随便写 | 向量计算 | LLM 只见召回结果 | mem0、mnemon、RAG 系 |
| 文件派 | 半格式化（Markdown 纪律） | agent 翻文件 | LLM 全程 | Claude Code、Letta、Manus |
| 结构化知识派 | 强格式化 | 程序化查询 | 机器消费为主 | 知识图谱、CMS |
| **LDVH** | **格式化写** | **程序化读** | **大模型理解** | 三者拼齐 |

可行性的三个行业实证：① 格式化写——v4 自己实证（237 对象 24 天 dogfood）+ ADR 运动全球先例；② 程序化读——纯软件工程，v4 Helper 生产强度验证（1903 测试），几百对象规模无焦虑；③ 大模型理解——Letta LoCoMo 基准：纯文件 agent 74.0% 超 mem0 图谱变体 68.5%，且 LLM 语义能力持续增强。**赢向量派三点**：可审计（命中依据可回指，治理硬需求）、零外发零部署、写入即质量关卡（向量派结构性做不到"写入把关"）。**让的一点**：十万级以上模糊召回——但单项目事实资产规模被问题域天然封死，该阵地永不受攻击。**风险盯防**：格式过重没人写（v4 Spark 095 病灶）与字段形式主义——靠分级门槛 + 语义质量复核对治。

**否决向量路线的两条理由（Human 定）**：① 云端 embedding API 须把事实内容发往第三方服务器，违反"数据随 Git 走、用户掌控"立场；② 本地 embedding 服务要求用户装运行时 + 拉 GB 级模型，部署负担不可接受（插件内置模型同理否决）。若未来 DSH 宿主原生提供零部署 embedding 能力可复议——当前不预留。

#### 2.3.1 召回：程序化读（确定性，无二次数据源）

- **形态**：F0–F4 分层 + 类型×状态×关系闭包结构化过滤 + 关系一跳导航（v4 `facts/` 路线），**直扫权威对象，不建持久索引**（无二次数据源原则——v4 find-fact-object-candidates"直接扫描当前权威对象"原教旨）；
- **文本匹配归 LLM**：v4 CLI 的 `text_match`（字面 substring）**不重建**——CLI 只摆摘要字段，语义筛选由 LLM 做（LLM 语义理解覆盖且强于 BM25/向量的模糊匹配价值；BM25 索引方案一并放弃，它本质也是二次数据源）；
- **召回机制按类型定义**（03 §8.2 授权）：见 §2.3.3 分类型设计；
- 03 §8 红线更简洁：全部召回确定性，语义消费判断归 AI，无概率件需隔离。

#### 2.3.2 写入：格式化写（两个通道 + 分级门槛）

**通道一·热记忆（零散、高频）**：复用 DSH 宿主 runtime memory（USER.md/MEMORY.md + 宿主工具纪律），LDVH 不自建——零开发量。

**通道二·事实对象（稳定、跨会话）**：五类（+可能的第六类项目文档）受控写入管线（03 §9：草案→校验→创建/CAS→回读）。三个写入侧机制：

1. **分级门槛**（治过度合规）：Spark/文档=快通道（草案→机械校验→创建）；ADR/Pitfall/Study=标准通道（+独立复核）；WorkCase=Gate 1/2 既有设计；
2. **创建前查重**（治 v4 同题多开）：创建 Spark/Pitfall 前管线强制一步——CLI 列同类 open 对象摘要，LLM 判断是否同题，确定新建才继续；
3. **关系声明提示**（治 v4 ADR/Pitfall 声明率 0/8）：创建时机械提示"与现有哪些对象相关？"，AI 确认后写入；跳过须留痕（change_log 记"创建时未声明关系"），让稀疏可审计。

#### 2.3.3 分类型读写设计（召回场景决定字段纪律）

| 类型 | 召回形态 | CLI 支援 | LLM 判断 | 写入门槛 | 字段纪律（=召回键） |
|---|---|---|---|---|---|
| ADR | **F1 常驻**：active 摘要预热注入（量小，v4 仅 8 个） | 枚举 active + 投影 decision/applicability | 摘要与当前工作相关性 | 标准 | `decision` 一句话说清方向约束；`applicability` 写清何时适用——常驻摘要的源 |
| Pitfall | **触发式**：开始一类操作前自查 | 列 active 的 symptoms/trigger_conditions | "我要做的事像不像这个症状"（语义比对） | 标准 | `symptoms` 用**观察者语言**写（给不知道答案的人看） |
| Spark | **创建前查重**为主；浏览=open 枚举 | 列 open 的 title+summary | 是否同题 | 快 | `title` 即检索键（动宾结构含主题词） |
| Study | **按需**：任务涉及研究过的主题时 | 列 research_question+abstract | 是否相关，选中才 F3 展开 | 标准 | `recommendation_summary` 写明吸收/不采用/承接去向（治研究→执行断层） |
| WorkCase | **状态枚举**：active + open/blocked items F1 | 状态过滤 + 卡片投影 | —（结构召回） | Gate 1/2 | 状态纪律 + 关闭时剩余责任结构化 |
| 项目文档（第六类，若准入） | **找得到**：标题+摘要列表枚举 | 列表投影 | 语义筛选 | 快 | title+description 即检索键 |

**CLI 确定性支援原语（全部只读直扫，五类共用）**：`scan`（枚举计数/F0F1）、`list-summaries`（摘要投影，供 LLM 筛）、`read`（F3 精确读取+机械检查）、`relations`（一跳导航）、`write` 管线（草案→校验→创建/CAS→回读，唯一写入口）。

**预热注入形态**：每回合 pre-step 维护常驻块（digest 去重）：active ADR 摘要（一行各）+ active WorkCase 状态 + open Spark 计数；Pitfall/Study 的语义筛选不自动跑，由引导段告知 AI"开始 X 类操作前列 Pitfall 摘要自查"——自动注入的只是 F1 枚举摘要，不含"替你判断好的相关性"，符合 03 §8.2 进入条件语义（规范增量仍按 Human Gate 走）。

### 2.4 终局目标：装了 LDVH 就不用装 mnemon（Human 定案 2026-09-03）

LDVH 要成为 DSH 上"AI 信息与治理"的完整答案，mnemon 的三层记忆能力（热记忆 / 项目文档 / 长期知识）由 LDVH **自实现**（参考 mnemon 工程形态，代码不依赖；召回内核不参考其向量路线）。这意味着：

1. 可能出现**新类型事实对象**承担 mnemon 三层记忆的对应职能——准入按 03 §5.2 六问判（满足什么问题、为何普通文档承载不了、消费价值对谁、维护成本、定义来源）；
2. 新类型讨论已启动（见本文档 §8）；

### 2.5 mnemon 召回引擎的处置

mnemon 的 provider 生态（9 个外部服务集成 + 底层 CLI 的 SQLite/embedding）**不采用**（向量路线已否决，见 §2.3）；其工程形态（smart/keyword/basic 降级链概念、策略注册表、容量预算、预热注入）作为参考范本。v4 `facts/` 确定性内核承担全部召回。

## 3. 写侧：v4 架构承接（与 mnemon 根本不同）

### 3.1 五类事实对象（03 §5）

`ldvh-base/` 五目录 = 五类型：`adrs/ pitfalls/ sparks/ studies/ workcases/`。公共身份字段（03 §6.1）：`object_uid`（Code 生成 UUIDv7，AI 不得自造）、`fact_type_key`、`title`、`created_at`（Code 填写）、`status`/`urls`/`relations`/`change_log`（类型条件）。

v4 实物样例（ADR YAML）：decision_question/decision/applicability/rationale/consequences/trigger_signal + change_log 流水（每次修改一条，署名 product/model/runtime + at + summary）。v5 迁移时对象身份重建（新 UID/指纹/change_log），不复制文件（05 禁止直写 ldvh-base/）。

### 3.2 受控写入契约（03 §9，mnemon 无对应物）

共同前提 → 只读路径 → 无副作用草案 → 受控创建 → CAS 更新/更正 → 多对象边界 → 写后回读与完整性审计 → 部分结果交还。AI 只提供语义摘要；身份、时间戳、签名由 Code 托管。写入唯一通道是 Helper；Git Gate 是最终闸门。

### 3.3 mnemon 写侧可借的只有工程件

mnemon 的 `idleReview`（turn 结束后定时复盘）、`superviseTask`（独立 task agent 执行写回）、pending 离线队列是**写回编排**的成熟件；LDVH 未来做"灵感/经验落事实对象"的引导式写回时可参考其编排，但写入动作本身必须走受控创建管线，mnemon 的 `remember` 自由写路径**不采用**。

## 4. 启动与挂载（已定稿，见前次会话结论）

1. `inject: ['tools','settings','systemPrompt']` 核心最小集；webServer 走 `ctx.inject(['webServer'], cb)` 软回调（headless 不挡核心）；
2. `ctx.on('agent/created')` 主挂载点 → per-agent `agent.ctx.effect` 注册全部钩子，随 agent 纤维自动清理（替现状 session-start 手动 Map）；
3. agent 级 `system-prompt/assemble` async waterfall：`await` 管辖判定（mtime 缓存，热路径 ~0.03ms）→ 首轮 prompt 即按态注入引导（修掉同步快照的首轮竞态）；
4. `agent/session-start` 只做状态记录（sessionScopes 供 /ldvh/state 端点）与重置；
5. `origin==='subagent'` 区分路径（mnemon installChild 模式）；工具保持 agent-scoped 注册（§15-1 零干扰，优于 mnemon 全局注册）；
6. 全量 side effect 归 `ctx.effect` 链。

## 5. 模块映射：mnemon 件 → LDVH 件

| mnemon（src/） | 角色 | LDVH 处置 |
|---|---|---|
| `lifecycle.ts` | per-agent 生命周期/事件编排 | **参照重建**：agent/created 挂载、pre-step、turn-stopping、session/event |
| `guidance.ts` | section/context 注册 + shadow | **参照重建**：七锚点 + 管辖态段 |
| `runtime-memory.ts` | USER.md/MEMORY.md 热记忆 | **自实现**（终局目标 §2.4：DSH 宿主 runtime memory 只是宿主件；LDVH 需要自己的热记忆职能，形态待 §8 新类型讨论） |
| `documents.ts` | 项目 Documents | **自实现**（终局目标：项目文档职能由 LDVH 承担，可能对应新事实类型；候选层可参考概率召回） |
| `memory-bodies.ts` / providers/ | Memory Spaces + provider 生态 | **自实现**（长期知识职能；provider 外部集成不依赖，概念分层参考） |
| `subagent.ts` | 委派写回协调 | 未来 WorkCase 队长式执行可参考（v5-handoff 四根支柱之二） |
| `settings.ts` / `rpc.ts` / `commands.ts` | 设置/RPC/命令 | **参照**：设置段注册、web 连接 RPC、slash 命令形态 |
| `activity.ts` / `review-activity.ts` | turn 活动投影/复盘评分 | 可选参考（八维"反思"维度的工程落点） |
| `live-runtime.ts` / config 热交换 | settings validate+swap 模式 | **参照**：配置变更不重启的运行时交换 |

### 5.1 mnemon 的 AI 用法：四类语义判断 + "AI 提案、Host 执行"模式

mnemon 用 LLM 的地方全部是**隔离 task agent + 专用 persona**（`subagent.ts`），主会话模型不算；召回本身是 embedding 检索（外包端点），不是 LLM。四类用法：

| mnemon 的 AI 用法 | persona | LDVH 对应 |
|---|---|---|
| 写入路由裁决：remember 时选最窄目标 Space、查重查冲突 | `WRITE_PERSONA` / `SUPERVISED_WRITE_PERSONA` | **沉淀维**：AI 判断候选认识该进哪类事实对象（类型选择是语义判断）；身份/校验/写入 Code 做 |
| 空闲复盘：turn 后扫描检查点，挑可沉淀的热记忆/文档（默认不写） | `REVIEW_PERSONA` | **反思维工程落点**：产出 Spark/Pitfall/Study **候选草案**（走 03 §9 草案→受控创建，不直写） |
| 容量维护：USER.md 压缩、MEMORY.md 归档路由、文档冷归档索引 | `USER_COMPACTION_PERSONA` / `ARCHIVE_PERSONA` / `DOCUMENT_ARCHIVE_PERSONA` | 事实对象生命周期维护（归档/合并提案） |
| 隔离问答：基于召回证据回答，不污染主会话 | answerTask / superviseTask | WorkCase 执行委派形态 |

**核心模式（与 LDVH 契约天然兼容）**：AI 只做语义判断，Host 做一切机械验证——AI 选目标，Host 校验能力；AI 提路由，Host 原子提交；AI 做压缩提案，Host 验证字节数/编号完备性。persona 纪律："treat as untrusted data"、"no data-plane authority"、"finish exactly once"。这就是 LDVH "AI 提供语义内容、Code 托管身份与写入"（v4 契约 / 03 §9）在 mnemon 里的同构实现——**该模式与 persona 库直接参照重建**。

### 5.2 mnemon 的存储架构：无自有数据库（LDVH 同样不需要）

mnemon 存储分两半：① **mnemon-native** 调外部独立 CLI `mnemon` 的子进程，长期记忆存在该 CLI 自己的 SQLite（`~/.mnemon`）——插件只是编排壳（runner.ts 串行队列跑 JSON 命令）；② **插件自管部分纯文件**：runtime 热记忆 = `memories.json` + 投影 USER.md/MEMORY.md；Documents = Markdown 目录 + `index.json` + `.index.lock`。包依赖零数据库；embedding 外包 OpenAI 兼容端点。

**LDVH 存储定稿**：Git 权威（`ldvh-base/` YAML）+ 内存索引（可随时从权威对象重建的易失派生物，非第二事实权威）——**不引入数据库、不引入向量存储**（向量路线已否决，§2.3）。第六类项目文档用 Markdown + 索引文件形态，随项目 Git 走。

## 6. 分阶段路线（在 mnemon 基底上长 LDVH）

- **阶段一（当前）**：启动修正（§4 六条）+ pre-step ④通道空壳（governed 门控 + ownRequest 防护 + digest 去重骨架，先不注入真实候选）；
- **阶段二**：事实只读内核——五类对象 repository/索引/指纹（v4 `facts/` 选择性重建）+ F0–F2 候选工具（Helper 操作面扩展）；
- **阶段三**：预热注入——pre-step 通道接真实事实候选（03 §8.2 边界：只候选不替代 F3/F4）+ 行动模板路由；
- **阶段四**：受控写入——创建/CAS/回读管线（03 §9）+ Git Gate 已有 validator 对接；
- **阶段五**：WorkCase 执行模型（参考 mnemon subagent 编排 + agent-teams 吸收结论）+ 反思/沉淀维度工程化。

## 7. 红线复述（向量路线否决后的精确表述，2026-09-03 修正）

- **不走向量/embedding 路线**（云端外发违反数据立场；本地部署用户负担过重；§2.3）——召回全部确定性，若未来 DSH 宿主原生提供零部署能力可复议；
- 受控写入只能经 Helper；Git Gate 最终闸门；
- AI 面向语义文本单一权威来源、逐字节一致、不复制规则正文、不成第二规则源；
- 事实对象身份/时间戳/签名 Code 托管，AI 不自造 object_uid；
- 预热不替代 F3/F4 精确读取与语义消费判断；partial/unavailable 如实交还；
- mnemon 能力一律自实现，不引入其代码/provider/CLI 依赖（参考实现，非运行时依赖）。

## 8. 新事实对象讨论（已启动，2026-09-03）

**议题**：mnemon 三层记忆（热记忆 / 项目文档 / 长期知识）的对应职能，在 LDVH 里以什么形态承载？候选方向（未定案，按 03 §5.2 准入六问逐项判）：

| mnemon 层 | 职能 | LDVH 候选承载形态 | 关键问题 |
|---|---|---|---|
| Runtime 热记忆（USER.md/MEMORY.md） | 用户偏好、项目热知识，每次组装注入 | 不一定是事实对象——可能只是插件自管的注入层（类似 DSH 宿主 runtime memory 的 LDVH 版），或五类之外的轻量载体 | 与 DSH 宿主 runtime memory 的边界：重复还是增强？写入是否也受控？ |
| Documents（项目文档） | substantial 项目记录，搜索召回 | 可能是新事实类型（如"项目文档/笔记"），也可能归入 Study/Spark 扩展 | 与 Study 的边界：Study 是"研究报告"，项目文档是"工作记录"——分开还是合并？ |
| Memory Spaces（长期知识） | 跨项目/长期语义记忆，向量召回 | 可能根本不需要对象化——LDVH 知识长期化本来就走五类事实对象（进 Git 随项目走）；跨项目长期记忆与 07 单项目工作对象边界冲突，需 Human 定夺 | LDVH 是否要"跨项目记忆"？这与管辖单项目语义如何调和？ |

**讨论原则**：以"满足什么问题"为准入唯一依据（Human 定）；mnemon 的形态是参照不是模板；任何新类型在 20–24 重建之后按同节奏起草规范（编号待分配，可能 25+）。

## 8.1 补充议题：事实源的"人能看"承诺与规范类文档（Human 提出 2026-09-03）

**背景**：LDVH 事实源隐含承诺"人能看"（HV：可阅读、可核对、可接手）。两类新内容候选冲击该承诺：① **code/web 设计文档**——人不看也看不懂，消费对象是 AI；② **规范类文档**（审计规范、测试规范、发布规范）——人要看要遵守，且"像规范又像 ADR"（张力核心：一条"发布前必须跑全量测试"到底是 ADR、规范还是行动模板？）。

**行业对照**：ADR 运动共识"决定与规则分离"（ADR 记录决定与理由，规则主体放政策文档，互相引用）；IETF RFC 的 BCP 系列（实践规范独立于标准编号）；Diátaxis 四象限（explanation 与 reference 服务对象不同不混类型）；Policy-as-Code（规范双态：人读文本 + 机器可检查规则同源）；开源根目录惯例（CONTRIBUTING/RELEASING 等约定文件，最轻可不对象化）。

**建议（未定案，准入属 Human Gate）**：

1. **设计文档不对象化**，保持 docs/ 现状——消费对象是 AI，召回=列目录+读文件已够用；立纪律：**设计文档禁止藏规则**，约束性内容必须上浮为 ADR 或规范。docs/ 是解释，不是约束。
2. **规范类文档立新类型（暂名 Practice/实践规范）**，与 ADR 分工（"决定与规则分离"的 LDVH 版）：

   | | ADR | Practice |
   |---|---|---|
   | 回答 | "**为什么**这样做"——决定+理由+适用范围 | "**怎么做**"——可反复适用的检查清单/步骤/标准 |
   | 时效 | 决策时刻快照，改决策=新 ADR 替代 | 长期演化，change_log 承载修订 |
   | 消费 | 判断方向时召回（F1 常驻摘要） | 执行对应操作时召回（触发式，类 Pitfall） |
   | 互引 | consequences 指向具体 Practice | change_log 首条回指建立它的 ADR |

   与 specs/ 边界：specs/ 是 LDVH 治理规范（体系自身的规则）；Practice 是**项目业务规范**——管辖项目不是 LDVH 自己时（用户拿 LDVH 管自己的项目），区分立显价值。**双态（Policy-as-Code）**：检查清单条目尽量写成机械可检查形式，CLI 提供 `check` 对照执行——审计规范自动变成审计工具。
3. **召回形态**：Practice 触发式（发布/审计/提测前列摘要，LLM 判断适用后 F3 展开当检查单）；Web 侧是 Human 高频阅读区。

**事实源体系全景（若均准入）**：specs/（治理规范，开发者看）→ Practice（项目业务规范，人常看）→ ADR/Pitfall/Spark/Study/WorkCase（现有五类，人看）→ 项目文档（第六类候选，人偶尔看）→ docs/ 设计文档（不对象化，AI 看）。
