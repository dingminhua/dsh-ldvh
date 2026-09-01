# dsh-deep-research 单项调研：自适应深度研究编排器对 LDVH 的参考价值

> 性质：开发设计输入，非规范、非事实对象。
> 调研对象：[omdsh-dev/dsh-deep-research](https://github.com/omdsh-dev/dsh-deep-research)（npm 名 `@dsh-external/dsh-deep-research` v0.1.0，MIT，作者 dsh2026）。已迁出至 `/Users/dmh2002/DshProject/dsh-deep-research`（2026-09-01 克隆快照，11 commits，2026-08-06 至 08-12）。
> 方法：主控第一手源码核验（全仓库仅 1 个源文件 + 1 个测试文件，已逐行通读），并**实际运行了其回归测试**（6/6 通过——本调研系列中唯一执行过测试套件的项目）。
> 与前两份调研的关系：七插件调研（`investigation-report-context-plugins.md`）聚焦上下文管理（读维）；dsh_workflow 调研（`investigation-report-dsh-workflow.md`）聚焦持久流程治理（执行/写维）；本项聚焦**审议维与复核维**——"把一次调查/研究做成自适应闭环"的设计模式，同时它是"寄生在官方 workflow 引擎上做扩展"的最小样本，与 dsh_workflow（自建引擎）形成架构路线的两极对照。

---

## 0. 执行摘要

1. **极简主义样本**：整个插件 = 1 个源文件（559 行，其中 ~210 行是 workflow 脚本字符串）+ 1 个测试文件 + cordis.patch（6 行）。与 dsh_workflow 的 5435 行自建引擎相比，它证明了"官方 workflow 引擎（`ctx.workflows`）之上做编排扩展"的最低成本形态——**零自研调度、零网络逻辑、零 UI 面**。
2. **设计理念与 LDVH 高度同源**：三态证据模型（confirmed/uncertain/gaps）几乎就是 LDVH `completed/not_completed/gaps` 交还语义的研究版；规划先行定义"答案空间"（scope/acceptance）对应 LDVH"审议先收敛方案再执行"；对抗性审查对应复核维的独立视角。**它是目前调研过的项目里与 LDVH 00 §9"诚实报告"哲学最贴近的一个。**
3. **自适应闭环的收敛判据值得吸收**：边际信息增益为零即停（信息论）+ 轮次硬上限 + 队列语义（超并发的子问题跨轮续研绝不丢弃）——LDVH 审议维"扩散后收敛"、执行维"最小充分"的信息论化表达。
4. **对 LDVH 最大的架构启示是"引擎与编排分离"**：它自己只是"编排策略提供者"，运行时全靠官方引擎（worker 隔离、并发上限、取消传播、进度事件、wf-runs 记录）。LDVH 五件套的执行层若走 dsh_workflow 式自建，本插件演示了另一条路：**策略插件化 + 引擎宿主化**。
5. **风险**：单文件交付、peer 钉 0.0.1 线（旧一代）、11 commits 单作者、无 CI——但测试设计（镜像引擎的 vm 仿真 + 6 场景回归）质量意外地高。

---

## 1. 项目概况

| 维度 | 现状 |
|---|---|
| 定位 | "把 deep-research 流程做成 DSH 扩展插件，基于官方 workflow 引擎（`ctx.workflows`），按控制论 + 信息论设计——不是固定提示词流水线，而是活的、自适应的研究闭环" |
| 规模 | src/index.ts 单文件 559 行（含 ~210 行 workflow 脚本字符串）；test/regression.test.mjs 1 个文件 6 个场景；lib/types/index.js 为编译产物（npm/lib 模式入口） |
| 提交史 | 11 commits，2026-08-06 至 08-12（一周），作者 dsh2026；演化轨迹清晰可见：初始 plugin → bundle 形态 → 原生 TS 重构 → 队列语义修复 → 回归套件 → 编译入口 → provider 兼容声明 |
| 测试 | **已实测：6/6 通过**（`node --test 'test/**'`）；零依赖（node:test + node:vm 仿真引擎运行时） |
| 依赖 | peer：`@deepseek-ai/dsh-tools ^0.0.1`、`@deepseek-ai/dsh-workflow ^0.0.1`、`cordis ^4.0.0-rc.7`；dev 仅 typescript + @types/node |
| 文档 | README 123 行：理论→机制映射表（7 行理论对照）、结构、参数、配置、设计说明、Profile 兼容性 |

**cordis.patch.yml**：仅 `insert` 一行 `id: dsh-deep-research`——bundle 补丁把插件行插入任何声明了它的 profile。

---

## 2. DSH 接入机制（第一手核验）

- **inject 门控**（`src/index.ts:70`）：`inject = ['tools', 'workflows']`——**官方 workflow 服务在场才激活**；profile 无 workflows provider 时插件保持 pending（README:119-123 明确这一行为并给出处理指引，还自述了 Web Profile 组合可能不提供该 provider 的兼容坑）。
- **唯一模型工具 `deep_research`**（`src/index.ts:401-538`）：`defineTool` + `ctx.tools.register`；6 个参数（topic 必填，purpose/questions/depth/synthesize/review 可选）；输出 schema 带 ok/report/review 三字段。
- **引擎调用**（`src/index.ts:483-516`）：`ctx.workflows.start({ script: SCRIPT, meta: WorkflowMeta, args, subagentProvider?, maxTotalAgents?, parent, signal: exec.signal })`——脚本为**静态文本**（String.raw，无模板插值、无注入面，动态输入全部走 `args`）；meta 声明 8 个 phase（规划/研究·第1-4轮/综合/审查，`src/index.ts:489-500`——phase 标题必须精确匹配引擎约定，有注释说明）。
- **取消传播**：`exec.signal` 传入 workflow run，用户取消时子代理随之中止（README:112）。
- **模型分层**（`src/index.ts:477-481`）：四角色（planner/researcher/synthesizer/reviewer）各自可配独立模型，缺省继承父路由——"规划/综合用强模型、研究用便宜模型"的成本策略。
- **生命周期**：`await run.result` + `await run.dispose()`（`src/index.ts:518-519`）——非 completed 即抛错并把 stopReason/error 带给主代理。
- **刻意不做的事**（README:109-114）：不注册 skill（与 skill 体系分开，触发靠工具描述）；不碰 TUI（无 tuiPrompt/overlay/system-prompt 注入，规避槽位 disposed 类崩溃）；插件零网络逻辑（搜索/抓取全靠子代理继承的内置 `web_search`/`web_fetch`）。

---

## 3. 编排设计（核心：一个字符串里的自适应闭环）

### 3.1 理论→机制映射（README:10-18，全在脚本中兑现）

| 理论 | 落地 |
|---|---|
| 参考信号校准（控制论） | 规划先定义**答案空间**（scope：研究支撑什么判断/决策）+ 每个子问题的**验收标准**（acceptance） |
| Ashby 必要多样性定律 | 枚举信息维度，每子问题映射一个维度，输出 `coverage_gaps` 覆盖度自检 |
| 信息 = 不确定性减少 | 研究子代理三态证据 confirmed/uncertain/gaps（条件熵的工程表达） |
| 边际增益递减 ⇒ 无限搜索是错的 | 预测→行动→更新→**边际增益验证**；连续零增益即停 + 轮次硬上限 |
| 自适应控制 | 闭环再规划：每轮收集 high-priority 缺口自动派发下一轮；规划盲区被定向侦察验证（假设被实验检验） |
| 率失真 | 综合子代理有损压缩：只保留对结论有区分度的信息 |
| 信道冗余/纠错 | 可选对抗性审查 = 奇偶校验：引用抽查、覆盖度审计、矛盾/过度自信标注 |

### 3.2 脚本结构（`src/index.ts:173-383`）

**规划阶段**：planner 输出结构化 JSON（scope/dimensions/questions/coverage_gaps，PLANNER_SCHEMA `src/index.ts:88-117`）；**盲区假设不丢弃而是入队**（`src/index.ts:239`：`gaps.map(g => ({ question: g, dimension: '盲区侦察', blind: true }))`）——被后续轮次实际验证，若信息其实可得自动补充研究，若确实不可得作为"已验证盲区"写入报告。

**研究闭环**（`src/index.ts:276-312`）：
- 队列语义：`pending = [...pending.slice(maxParallel), ...leads]`——本轮超并发的子问题留在队首下轮续研（**绝不静默丢弃**，git 史 fc72fdb 专门修复过此点），high-priority 缺口排在它们之后；
- 收敛判据双重：无新 high-priority 缺口（边际增益≈0）或 `round < depth + 1` 轮次上限；
- 研究者提示词内嵌感知-行动循环（第 0 步先写当前最佳答案 → 预测高熵点与预期增益 → 行动 → 三态更新 → 边际增益自问）与三停准则（`src/index.ts:262-265`）；来源评估分级（A 政府/学术 → D 自媒体，`src/index.ts:266-268`）；"宁可不确认，也不要编造"。

**综合阶段**（opt-out）：率失真提示词——"不确定性本身就是重要信息，必须保留而非掩盖"（`src/index.ts:342`）；报告六节结构（摘要/背景/核心发现按维度/不确定性与矛盾/信息缺口与已验证盲区/结论）；**附原始证据状态全文**（`src/index.ts:350`：`report + '\n\n---\n\n## 附录：原始证据状态\n\n' + intermediate`——最终报告可回溯到三态证据底稿）。

**审查阶段**（opt-in）：五维对抗审查（引用纠错——幻觉来源=信道噪声必须标出/覆盖度审计——对照规划维度/矛盾保留/时效性/过度自信，`src/index.ts:359-364`）；只输出审查意见不改写报告本身；给出"需要补充研究的最高优先级缺口"供下一步定向研究。

**返回值**（`src/index.ts:375-382`）：report + review + **量化元数据**（rounds/subquestions/completed/failed）——完成度可见。

### 3.3 测试设计（`test/regression.test.mjs`，已实测 6/6）

零依赖回归：从 src/index.ts 抽取 SCRIPT 字符串 → `node:vm` 仿真引擎运行时（phase/agent/parallel/args 全局钩子，agent 按 label 从 mock 队列取值）→ 6 个场景：①questions 已给跳过规划单轮收敛 ②high-priority 缺口自动进第 2 轮直到零增益 ③无 questions 时规划+盲区侦察入队 ④工具注册与输出 schema 编译 ⑤参数校验（空 topic/depth>3 抛错且**不进入** workflows.start）⑥队列语义（超 maxParallel 跨轮续研全部被研究）。工具注册层测试优先动态 import 真实模块、失败退化为 vm 求值剥离后的源码——**对"源码即运行时"交付形态的完整测试策略**。

---

## 4. 对 LDVH 的参考价值（重点）

### 4.1 审议维：先定"答案空间"再行动

规划代理先界定 scope（研究要支撑什么判断/决策）再拆解——与 LDVH 审议维"把 Human 意图经信息读取与约束收敛为可执行方案"同构。**可借鉴的具体形式**：WorkCase/Study 类事实对象的创建入口应先要求"purpose/用途"声明（缺省时 AI 声明假设用途并显式标注——本插件 planner 的做法，`src/index.ts:216`：'若用途未说明，明确写出你假设的用途'）；Study 的调研问题应先过"验收标准"定义（acceptance：怎样算回答了）。

### 4.2 复核维：三态证据 + 对抗审查 + 量化完成度

- **三态证据模型**（confirmed/uncertain/gaps）与 LDVH 交还语义（completed/not_completed/gaps，00 §7.4）几乎逐字对应——本插件证明该语义可以内嵌到**子代理提示词与结构化输出 schema**里强制执行（RESEARCHER_SCHEMA 的 required 字段即语义约束），而非只靠规范文本要求 AI 自觉。LDVH 的 Helper 响应与事实对象状态字段可同构：每个 claim 带 confidence 与 source。
- **对抗性审查作为独立角色**（opt-in，五维清单）——对应 LDVH 复核维"独立/对抗执行体"的按需启用（00 §5 最小充分原则）；其"只输出意见不改写报告本身"的边界纪律值得照抄（复核不越权修改）。
- **完成度量化**（rounds/subquestions/completed/failed 显式返回）——LDVH 交还应带同款量化（读了多少规范/召回多少事实/验证多少声明/失败几项），而非只有结论。

### 4.3 读维：证据可回指链

最终报告 + **附录原始证据状态**（三态底稿全文附加）——"AI 提炼输出永远是候选 + 原文回指"（read-dimension-understanding §8）的现成实现：压缩报告可回溯到未压缩底稿。LDVH 的 Study 对象与 Web 呈现可采用同款两层结构（结论层 + 证据层）。

### 4.4 执行维：收敛判据与队列语义

- **边际增益为零即停**：审议扩散（多方案/多视角）的收敛判据可借鉴信息论表述——"新一轮没有产生新的高优先级缺口"就是停止信号，避免无限发散；
- **轮次硬上限**（depth+1）：一切自适应循环配硬上限兜底——LDVH 行动模板的停止条件设计参照；
- **队列不丢弃**：超并发/超预算的工作项留在队列显式续处理——对应 WorkCase work items 的 pending 语义（不因单轮容量限制静默丢弃任务）。

### 4.5 架构启示：引擎与编排分离（与 dsh_workflow 两极对照）

| | dsh-deep-research | dsh_workflow |
|---|---|---|
| 引擎 | **官方 `ctx.workflows`**（worker 隔离/并发上限/取消/进度/wf-runs 全宿主提供） | **自建引擎**（QuickJS VM + 自建 run graph + effect cache） |
| 编排 | 一个静态脚本文本（策略层） | 完整服务 + catalog + 生命周期 API |
| 交付 | 单文件、零构建、源码即运行时 | 5435 行 + 构建产物 + 兼容矩阵 |
| 治理 | 无（信任宿主引擎的 caps） | 完整（审批/验证证据/effect cache 门槛） |
| 适用 | 单次策略性编排 | 长期流程资产 |

**对 LDVH 五件套执行层的启示**：LDVH 的"Helper 确定性执行"更接近两极的中间——确定性操作（受控写入/CAS/审计）必须自建（宿主没有），但**调度原语应尽量用宿主**（本插件路线）。v5-handoff §4 的"插件五件套 + Host Hook"吸收 agent-teams 调度器与吸收 DSH 原生 workflow 引擎并不冲突：**策略 LDVH 自持，引擎宿主化**。若 LDVH 需要类似 deep-research 的调查行动模板（Study 类），本插件的"静态脚本 + 结构化 args + 引擎 meta 声明 phase"是最低摩擦的落地形态。

### 4.6 LDVH 应避免/警惕的

1. **单文件 559 行含 210 行脚本文本**——脚本体与宿主代码混在一个字符串里，测试要靠 vm 仿真抽取（本插件测试设计高明地消化了这点，但维护性仍是隐患）；LDVH 行动模板若走脚本形态应模板文件独立、可分别测试；
2. **peer 钉 0.0.1 线 + 无 CI + 单作者一周**——成熟度低；其"源码即运行时"依赖 DSH 源码启动器的 tsx hook 与 Node ≥22.18 原生剥离的精确行为（node_modules 内文件被原生剥离拒绝——README:39-43），**对宿主加载机制的高度耦合**是 LDVH 08 规范应记录的兼容坑；
3. **结构化输出的引擎依赖**：planner/researcher 的 schema 约束依赖引擎的 structured capture；引擎不支持时退化为纯文本（DSH rc.2 缺捕获问题在 dsh_workflow 中有专门修复，本插件未处理此坑）；
4. **对抗审查无预算/轮次上限声明**（审查子代理自身无 LIMIT 约束）——审查也是成本，LDVH 复核维的"最小充分视角"应给审查也配上界。

### 4.7 与 LDVH 哲学的直接共鸣点（收束）

这个项目最有价值的不是代码（559 行），而是它**把"如何诚实地做一次调查"编译成了可执行的机制**：先声明答案空间与验收标准（防参考信号错校准）、按多样性定律拆解并自审覆盖（防盲区）、三态证据带置信与来源（防过度自信）、边际增益为零即停（防无限搜索）、盲区假设被实验验证而非静态接受（防假设冒充事实）、报告保留不确定性与矛盾（防掩盖）、最终报告附证据底稿（防失真不可回溯）、可选对抗审查（防幻觉来源）。——这八条每一条都能在 LDVH 00（防自欺/诚实报告）与 02（审议/复核/反思维判据）里找到直接对应，可以作为"LDVH 研究类行动模板（Study 模板）"的行为规格输入。

---

## 5. 证据清单（主控第一手核验，全仓库已通读）

| 结论 | 证据 |
|---|---|
| 单文件规模与结构 | src/index.ts 559 行（wc -l 实测）；包入口直指源码，零构建（README:27,39-43） |
| inject 门控（依赖官方 workflow 服务） | src/index.ts:70；README:119-123（pending 行为与 Profile 兼容） |
| 唯一工具 deep_research + 6 参数 | src/index.ts:401-439 |
| 引擎调用（script/meta/args/parent/signal） | src/index.ts:483-516；meta phase 精确匹配注释 492-493 |
| 静态脚本无注入面 | src/index.ts:165-172（String.raw + args 驱动注释） |
| PLANNER/RESEARCHER 结构化 schema | src/index.ts:88-117,120-163 |
| 盲区假设入队不丢弃 | src/index.ts:236-239；git fc72fdb（队列语义修复） |
| 自适应闭环 + 双收敛判据 | src/index.ts:276-312（`while (pending.length > 0 && round < depth + 1)`） |
| 三态证据 + 来源分级 + 不编造纪律 | src/index.ts:260-272（研究者提示词） |
| 综合保留不确定性 + 证据附录 | src/index.ts:342,350 |
| 对抗审查五维 + 不改写报告 | src/index.ts:354-372 |
| 量化完成度返回 | src/index.ts:375-382 |
| 模型分层四角色 | src/index.ts:477-481；README:68-69,104 |
| 取消传播 | README:112；src/index.ts:515 |
| 测试 6/6 实测通过 | `node --test 'test/**'` 实测输出；测试文件头注释（镜像引擎机制说明） |
| 11 commits 演化轨迹 | git log（2026-08-06 至 08-12） |
| peer 0.0.1 线 | package.json:32-36 |

### 未验证/残留风险

- 未在真实 DSH 环境安装运行（测试通过的是 vm 仿真层，非真实引擎与真实子代理）；
- peer 钉 `^0.0.1`（dsh-tools/dsh-workflow）与 `cordis ^4.0.0-rc.7`——在当前 DSH Desktop 2.0.4（0.1.2-alpha 线）上的实际兼容性未验证；`ctx.workflows.start` 的 meta/args 形状可能已变；
- 结构化输出在引擎缺原生捕获时的退化行为未验证（dsh_workflow 有专门修复，本插件未见处理）；
- 本报告为设计输入，不构成任何机制"已在 LDVH 实现"的证明。
