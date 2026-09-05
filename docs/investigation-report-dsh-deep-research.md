# dsh-deep-research 深度调研：控制论/信息论自适应深度研究编排器对 LDVH 的吸收参考

> 性质声明：开发设计输入（非规范、非事实对象）。  
> 调研对象：[omdsh-dev/dsh-deep-research](https://github.com/omdsh-dev/dsh-deep-research)（`@dsh-external/dsh-deep-research` v0.1.0，MIT，源码 checkout 位于 `/Users/dmh2002/DshProject/dsh-deep-research`）。  
> 方法：主控第一手源码全量通读（`src/index.ts` 559 行、`package.json` 46 行、`cordis.patch.yml` 8 行、`lib/types/index.js` 531 行、`lib/types/index.d.ts` 80 行、`test/regression.test.mjs` 605 行），并实跑回归测试（`node --test`，6/6 场景全绿）。

---

## 0. 一句话结论

1. **理论到机制的高保真映射**：将控制论（参考信号校准、Ashby 必要多样性、自适应控制）与信息论（条件熵、EIG 边际信息增益、率失真压缩、信道冗余纠错）完全编译为确定性的结构化 Schema、提示词感知循环与停止判据，而非玄学概念。
2. **三态证据与诚实交付**：以 `confirmed` / `uncertain` / `gaps` 结构化对象强制表达条件不确定性，在综合报告中保留矛盾与已验证盲区，并附带未压缩的原始证据底稿，与 LDVH 00 §7/§9"防自欺与诚实报告"理念深度同构。
3. **闭环收敛与队列不变量**：以"上一轮边际增益为零"作为信息论收敛信号，叠加 `depth + 1` 硬上限与先进先出队列语义（超并发子问题跨轮保留绝不静默丢弃），杜绝无节制发散。
4. **极致克制的宿主寄生架构**：单一插件入口仅注册 1 个模型工具，零网络请求、零 UI 扩展、不注册 skills，全量复用官方 `ctx.workflows` 引擎（Worker 线程隔离、并发上限、取消传播）。

---

## 1. 项目概况

- **定位与版本**：`@dsh-external/dsh-deep-research` v0.1.0（`package.json:2-4`），定位于基于 DSH 官方 workflow 引擎的自适应深度研究编排插件（`package.json:3`）。
- **代码规模**：极简单文件架构。源码 `src/index.ts` 共 559 行（含约 210 行静态 workflow 脚本）；编译入口 `lib/types/index.js`（531 行）与类型 `lib/types/index.d.ts`（80 行）；测试 `test/regression.test.mjs`（605 行）；安装补丁 `cordis.patch.yml`（8 行）。
- **依赖关系**：无任何第三方运行时依赖。`peerDependencies` 声明 `@deepseek-ai/dsh-tools: ^0.0.1`、`@deepseek-ai/dsh-workflow: ^0.0.1`、`cordis: ^4.0.0-rc.7`（`package.json:32-36`）；通过 `cordis.patch.yml`（`cordis.patch.yml:6-8`）将自身插入 Profile。
- **Commit 历史**：共 11 个 commit（2026-08-06 至 08-12，作者 dsh2026）。演进链：原型搭建(`1616eb4`) → bundle patch 改写(`46ca346`) → 原生 TS 重构(`afa0762`) → 队列语义与 null config 修复(`fc72fdb`) → 回归测试集成(`405e781`) → 构建产物与 Profile 兼容文档(`094bdf1`, `c0b329e`)。

---

## 2. 核心数据模型 / 工作流设计：控制论与信息论的工程映射

项目将抽象学术概念逐一具象化为工程 Schema 与流程控制（`src/index.ts:12-46`）：

| 理论维度 | 理论内核 | 源码工程机制落地（file:line） |
|---|---|---|
| **参考信号校准**（控制论） | 闭环系统若参考信号偏差，后续调节全部失效 | 规划代理首先界定答案空间 `scope`（明确支撑何种决策），并为子问题逐一指定验收标准 `acceptance`（`src/index.ts:92,106,216,219`）。 |
| **Ashby 必要多样性**（控制论） | 控制器的多样性必须匹配被控系统的多样性，否则必有盲区 | 枚举主题的信息维度 `dimensions`，强制各子问题映射所属维度，并自审声明覆盖缺口 `coverage_gaps`（`src/index.ts:93-96,111-114,218-219`）。 |
| **条件熵显式化**（信息论） | 信息即不确定性的减少，未知状态必须具象化 | 证据强制归入三态模型 `confirmed` / `uncertain` / `gaps`，显式追踪置信度与优先级（`src/index.ts:120-163,260`）。 |
| **EIG 边际增益**（信息论） | 边际收益递减，搜索应在增益衰减至阈值时停止 | 提示词驱动"预测高熵点→行动→更新→边际验证"闭环；连续一轮零增益或高优先级缺口清空立即停机（`src/index.ts:257-265`）。 |
| **自适应感知-行动**（控制论） | 流程是活的，环境反馈驱动状态机自发调整 | 轮次间动态收集 high-priority gaps 作为新子问题派发；规划假设的盲区作为实验假设由研究轮定向侦察验证（`src/index.ts:239,280-312`）。 |
| **率失真有损压缩**（信息论） | 给定报告容量（率），最大化保留决策区分度（最小失真） | 综合代理只保留对最终判断有区分度的结论，明确保留不确定性与矛盾，并附录完整原始证据底稿（`src/index.ts:337-351`）。 |
| **信道纠错奇偶校验**（信息论） | 对抗信道噪声与幻觉生成 | 独立审查代理进行五维对抗性审查（引用可达性抽查、维度覆盖审计、冲突与过度自信标注），只提意见不改写正文（`src/index.ts:356-373`）。 |

---

## 3. 工具与子代理：deep_research 工具参数、模型分层与调度

- **工具注册与参数规范**：通过 `ctx.tools.register(defineTool({...}))` 注册 `deep_research`（`src/index.ts:401-402`）。
  - 参数集：`topic`（必填）、`purpose`（定义答案空间）、`questions`（直接传入跳过规划）、`depth`（1/2/3 容差档位，对应 2/3/4 轮硬上限）、`synthesize`（默认 true）、`review`（默认 false）（`src/index.ts:414-440,469-472`）。
  - 输出契约：严格返回 JSON `{ ok, report, review? }`，并提供文本渲染函数（`src/index.ts:442-456,532-536`）。
- **四级模型分层（成本/精度解耦）**：
  - 支持角色独立配置：`plannerModel`（规划）、`researcherModel`（并行调研）、`synthesizerModel`（报告综合）、`reviewerModel`（对抗审阅）（`src/index.ts:76-80,388-391`）。
  - 调度执行时组装为 `models` 字典透传至脚本（`src/index.ts:477-481`），脚本内调用各代理时动态解构注入（`src/index.ts:225,288,347,370`）。缺省时完全继承父代理路由。
- **子代理调度与宿主集成**：
  - 插件自身不编写子代理调度器，全量调用宿主 `ctx.workflows.start({...})`（`src/index.ts:483`）。
  - 传递 `parent: exec.agent`（`src/index.ts:459,514`）、`signal: exec.signal`（`src/index.ts:515`），支持宿主级生命周期管理与取消级联。

---

## 4. 自适应闭环实现：并行、缺口反馈、重规划与停止条件

研究执行阶段是完整的自适应闭环状态机（`src/index.ts:276-312`）：
1. **第 1 轮并行研究**：
   - 若用户未提供 `questions`，规划代理产出子问题及 `coverage_gaps`；盲区假设作为 `blind: true` 标记直接并入待研队列 `subs`（`src/index.ts:239`）。
   - 首轮从 `pending` 截取最多 `maxParallel`（默认 4）个任务，使用 `parallel(batch.map(...))` 触发并发 Worker（`src/index.ts:283-284,398`）。
2. **动态缺口收集与重规划**：
   - 每轮结束后，遍历当前批次返回的 `RESEARCHER_SCHEMA` 结果，抽取 `priority === 'high'` 的 gaps（`src/index.ts:298-307`）。
   - 去重后生成补充研究课题 `leads`（`src/index.ts:305`），标明 `followUp: true`（在提示词中明确标注为针对上一轮缺口的补充研究，`src/index.ts:244`）。
3. **队列语义不变量（杜绝丢弃）**：
   - 待研队列更新式：`pending = [...pending.slice(maxParallel), ...leads]`（`src/index.ts:308`）。
   - 核心不变量：单轮处理未完的剩余子问题保留在队首，下一轮优先消费；新发现的高优先级缺口排在队尾追加，绝不丢弃（`src/index.ts:309-311`，修复自 commit `fc72fdb`）。
4. **收敛判据与停止条件**：
   - 外部循环硬停止：`while (pending.length > 0 && round < depth + 1)`（`src/index.ts:280`）。当轮次耗尽或待研队列为空时终止。
   - 内部信息论收敛：当且仅当某轮未产生任何新的 high-priority gap 且队首无积压时，`leads` 为空导致 `pending` 耗尽自然收敛（`src/index.ts:311-312`）。单个研究员内部亦遵从零增益停止准则（`src/index.ts:262-264`）。

---

## 5. 证据表达与覆盖率审计：三态证据、盲区侦察与对抗性审查

- **三态证据结构化 Schema**：
  - `RESEARCHER_SCHEMA`（`src/index.ts:120-163`）强制要求返回 `confirmed`（必须含结论、引用 URL、置信度高/中/低）、`uncertain`（疑点与原因）、`gaps`（未获信息与优先级）。
  - 格式化输出函数 `renderFindings`（`src/index.ts:183-205`）将三态证据如实转换为 Markdown。若未获得任何确认事实，明确标注"未获得任何可确认的证据"（`src/index.ts:203`）。
- **盲区侦察与覆盖度假设检验**：
  - 规划代理主动声明 `coverage_gaps`（`src/index.ts:111-114,219`），即承认现有认知之不足。
  - 盲区不被隐瞒，而是转化为 `blind: true` 的侦察任务进入研究闭环（`src/index.ts:239`），提示研究员专门验证是否公开信息确实匮乏（`src/index.ts:246-248`）。验证结果作为"已验证盲区"写入最终报告（`src/index.ts:342`）。
- **率失真综合与附录保真**：
  - 综合代理提示词明确要求"不确定性本身就是重要信息，必须保留而非掩盖"，严禁编造（`src/index.ts:342-343`）。
  - 输出报告末尾强制附加完整原始证据底稿：`report + '\n\n---\n\n## 附录：原始证据状态\n\n' + intermediate`（`src/index.ts:350`），确保高层压缩结论与底层三态证据链可回溯。
- **独立对抗性审查（五维奇偶校验）**：
  - 审查代理独立于综合代理（`src/index.ts:354-373`），五维审查清单：①引用纠错（URL 真实性与观点支撑度，将幻觉定义为信道噪声）、②覆盖度审计（对照规划阶段 dimensions 查漏）、③信息矛盾检视、④时效性判定、⑤过度自信识别（`src/index.ts:358-364`）。
  - 严格遵守边界纪律：仅输出审查意见与补充缺口，绝不直接改写报告正文（`src/index.ts:365`）。

---

## 6. 复用官方能力的边界：依赖、调度与隔离

- **Plugin 边界（不是 Skill）**：
  - 插件明确不注册 Skill（`src/index.ts:3-7`），不入侵用户提示词槽位，无 TUI overlay 依赖，消除 slot disposed 崩溃隐患。
  - 仅作为一个标准 Cordis 插件，依赖 `inject = ['tools', 'workflows']`（`src/index.ts:70`），提供 1 个纯粹的外部工具。
- **完全复用官方 Workflow 引擎**：
  - 编排逻辑全部写在静态文本 `SCRIPT` 中（`src/index.ts:173-383`），交由官方 Worker 线程引擎执行。
  - 工作流运行环境的原语直接来自宿主：`agent`（子代理调用）、`parallel`（并发屏障）、`phase`（进度阶段上报）（`src/index.ts:207,227,242,284,336,355`）。
- **零外部网络逻辑与沙盒继承**：
  - 插件自身不发任何 HTTP 请求，亦未内置网络抓取代码。研究子代理提示词显式引导使用宿主内置的 `web_search` / `web_fetch` 工具（`src/index.ts:231,255,259,357`），完全继承宿主的安全审计与沙盒权限。
- **取消传播与故障隔离**：
  - 执行上下文绑定 `signal: exec.signal`（`src/index.ts:515`），父会话中断时信号自动级联终止子代理。
  - 单个子问题研究失败仅在报告中标记占位符（`src/index.ts:327`），不导致整批研究崩溃；汇总统计精确返回 `completed` 与 `failed` 指标（`src/index.ts:380-381`）。

---

## 7. 对 LDVH 的参考价值（核心）

### 7.1 调研作为审议工具的可移植隐喻（2026-09-07 边界澄清）

**澄清**：调研**不是第九维**——00 §3.1 八维工作模型（读/写/遵守/审议/复核/执行/反思/沉淀）定案未含；调研在 LDVH 体系里的位置=**审议维「扩散」阶段的工具动作**（spec-kit 调研 agent 全程在场的范式），由审议模的 dormant 分支承载。如下四点仍是有效可移植机制，但本节主张的是「调研如何为审议服务」，不是「LDVH 有调研维」。

1. **理论映射为确定性工程机制**：LDVH 的理念（如反自欺、诚实报告、最小充分）不可仅停留于提示词规训，应借鉴本项目做法，将其转化为结构化 Output Schema（强校验字段）、阶段循环与代码级退出阈值。
2. **EIG 边际增益的停止条件**：在 LDVH 的审议维与反思维中，多方案扩散与调研探索常陷入无限发散。引入"连续单轮边际增益为零（无新增确认事实）"作为机械收敛条件，可大幅收紧 Token 预算。
3. **模型分层与角色特化**：将任务解耦为 Planner（强逻辑）、Researcher（低成本搜索抓取）、Synthesizer（精炼归纳）与 Reviewer（批判审阅），为 LDVH 的多子代理协同提供了兼顾成本与精度的落地方案。
4. **三态证据模型（confirmed/uncertain/gaps）**：直接对应 LDVH 交还状态的三态表达（`completed` / `not_completed` / `gaps`），为 LDVH 的事实对象构建（如 Study / Review 事实底稿）提供了天然的属性字段模板。

### 7.2 与已有调研项目的异同对比
- **vs `dsh-solo-thinking`（多分支思考树）**：
  - `solo-thinking` 侧重**交互式长程发散**，以独立 DSH Session 为节点，构建人类可审阅、带侧边栏 UI 的思考树，依赖人机共同决策推进。
  - `dsh-deep-research` 侧重**自主式短程收敛**，运行于无头 Worker 线程，以信息增益为单一目标实现全自动闭环探索，无长程持久树，无 UI 面。
- **vs `dsh-mnemon`（记忆控制平面）**：
  - `mnemon` 侧重**跨会话的知识治理**，拥有三代际令牌（Catalog/Topology/Guard）、持久化 JSON 事实源、LRU 归档与 revision 冲突拦截，属于稳态存储。
  - `dsh-deep-research` 侧重**会话内的即时证据采集**，产物为单次 Markdown 报告与临时证据底稿，不碰跨会话记忆，属于瞬态工作流。

### 7.3 LDVH 应避免的陷阱
1. **严禁二次包装成冗余插件**：LDVH 应遵循"吸收=思想，交付=LDVH 自己的实现"原则，吸纳其控制论/信息论状态机内核，而不要直接引入其插件代码作为不可控外部黑盒。
2. **避免大段内嵌脚本字符串**：本项目将 210 行 JS 编排代码以 `String.raw` 字符串硬编码于 TS 文件中（`src/index.ts:173`），导致语法高亮缺失、静态类型失效、单元测试依赖 `vm.Script` 抽取。LDVH 编写工作流模板必须坚持模块化与独立文件测试。
3. **防止控制论术语的空转欺瞒**：控制论名词若脱离具体的 Schema 与终止判定，极易沦为 LLM 自嗨的空洞修辞。LDVH 落地时必须确保每个理论声明都有断言级代码把关。

---

## 8. 证据与未验证范围

### 8.1 已核验源码证据
- 插件入口与 inject 声明：`src/index.ts:67,70`
- 数据 Schema 定义：`src/index.ts:88-117`（PLANNER）、`120-163`（RESEARCHER）
- 工作流脚本与动态执行逻辑：`src/index.ts:173-383`
- 工具注册契约与参数解析：`src/index.ts:401-440,464-472`
- 宿主 Workflow 启动与生命周期管理：`src/index.ts:483-520`
- 补丁定义与包声明：`cordis.patch.yml:6-8`、`package.json:1-46`
- 回归测试用例设计与 vm 隔离执行：`test/regression.test.mjs:1-605`（全量测试在 Node 22 环境下实跑 6/6 通过）

### 8.2 未验证范围与风险
- **真实 LLM 线上环境表现**：测试使用的是 `test/regression.test.mjs` 中的 Mock 数据，真实大模型在生成复杂 Schema 时是否存在 JSON 解析失败、幻觉字段等退化现象未在真机 Profile 下长期实测。
- **旧版 Peer 依赖兼容性**：其声明的 `@deepseek-ai/dsh-workflow: ^0.0.1` 属于早期版本规范，在最新 DSH 宿主环境下的 API 演进兼容度未经真机加载确认。

> **声明**：本文仅为 LDVH 架构演进与调研维设计的输入参考，不构成任何机制已在 LDVH 落地或可免除审计的证明。

---

## 9. 关键词句回指（file:line）

- 插件名称与服务注入：`src/index.ts:67,70`
- 规划输出 Schema（答案空间/维度/盲区）：`src/index.ts:88-117`
- 研究员三态证据 Schema（confirmed/uncertain/gaps）：`src/index.ts:120-163`
- 规划阶段提示词（定义答案空间与验收标准）：`src/index.ts:211-220`
- 盲区侦察任务转化与标记注入：`src/index.ts:239`
- 研究员感知-行动循环与停止准则提示词：`src/index.ts:256-265`
- 自适应研究循环与并行批处理：`src/index.ts:280-289`
- 缺口收集与跟进任务提取：`src/index.ts:296-307`
- 队列保护语义（未处理子问题跨轮续研）：`src/index.ts:308-311`
- 综合代理率失真提示词（保留不确定性与盲区）：`src/index.ts:337-343`
- 报告与三态证据底稿拼接：`src/index.ts:350`
- 对抗性审查代理提示词与五维清单：`src/index.ts:356-365`
- 工具定义与参数校验：`src/index.ts:401-440,464-472`
- 宿主 Workflow 启动与取消信号透传：`src/index.ts:483-516`
- 工作流生命周期销毁：`src/index.ts:518-520`
- Profile Bundle 补丁注入：`cordis.patch.yml:6-8`
- 回归测试 6 场景 vm 验证：`test/regression.test.mjs:177,205,232,497,516,574`
