---
title: Utopia 企业世界模型调研（deeplethe/utopia v0.1.0-rc5：双时态知识图谱/本体契约治理/叙事化决策记录——对 dsh-ldvh 的同构参照与工程借鉴）
status: active
research_question: 开源项目 deeplethe/utopia（自称首个开源企业世界模型）是什么、其架构与工程实践如何构成、能力与成熟度边界在哪里，对 dsh-ldvh 项目有何参照与借鉴价值？
research_purpose: 为 dsh-ldvh 项目提供对当前 GitHub 高热度相邻开源项目的定位理解与后续投入判断：utopia 与本仓库同属「知识治理 + 台账 + 人机分工」问题域，其双时态事实账本、本体契约化写入、叙事化决策记录与本仓库 03 受控写入、22 ADR、24 Research 存在直接同构，需要一手证据确认其真实形态与成熟度以决定是否跟进与如何参照。本调研由用户直接指令发起（拉取本地同级目录 + 撰写调研报告），以项目需求为主，涉及机制吸收的发现按 30 §1.2 显式标注为机制需求。
stopping_reason: sufficient
confirmed_statements:
  - F1 Utopia 是 DeepLethe 公司支持、单核心维护者主导的新项目：公开仓库 3 周 499 次提交、8,351 stars（2026-09-15 观测）
  - F2 产品定位是「企业世界模型」：单 Rust 二进制 + 单 Postgres 的自托管知识工程平台，官方明确拒绝 Palantir 类比
  - F3 核心数据模型是双时态知识图谱：每条事实携带世界轴与认知轴两条时间线，账本 append-only、更正走 supersedes 链、删除是事件
  - F4 文档到图谱的流水线采用两阶段设计：嵌入完成即可检索问答，抽取后台化，每个阶段显式登记丢弃原因
  - F5 本体被当作契约执行：写入路径强制签名检查并留痕，实测把签名违规率从 57% 降到 4%、真反转从 39 降到 0
  - F6 42 篇叙事化决策记录构成与代码并行的「为什么」权威：修订原地保留、PR 必须声明实现或推翻了哪条记录；57 个迁移文件名同样承载意图
  - F7 工程架构 8 个 Rust crate 分层清晰：store 与 server 为主，任务队列即 Postgres 表，无外部 broker
  - F8 人机分工贯穿全流程：低置信度与疑似重复进人工复核队列，Agent 治理先读台账先例再裁决，自动合并受「可撤销性闸门」约束，裁决理由被记录并回流为提示先例
  - F9 Agent 能力面覆盖会话、MCP 只读工具与本体驱动问数：MCP 无状态每请求重认证，问数引擎只放行只读 SQL，官方声称 Ontology2SQL 在 BIRD Mini-Dev 上为 SOTA
  - F10 前端是完整产品级 Web 应用（React 19 + Vite 6 + sigma 图可视化），设计规范六条规则由 CI 强制，交付为 Docker Compose 两服务一键部署
  - F11 成熟度边界明确：v0.1 阶段、迁移只进不退、推理物化默认关闭、类型消解仍靠手工触发、路线图多项目未完成
  - F12 Utopia 与 LDVH 是同一治理思想在两种载体上的实现（数据库图谱 vs Git 规范/事实文件），互为参照而非替代
uncertain:
  - issue: 「30 日 star 增长 +11,592」未证实
    reason: 来源为第三方趋势站（wuzao.com）月度榜，与 GitHub API 总星数 8,351（2026-09-15）直接矛盾（增长数不可能超过总星数），口径不明已弃用；仅保留 API 可核实的总星数与创建日期
  - issue: 治理链（0025/0026/0027/0028）与 chat runner（0042）的实现细节以决策索引状态行为准，未读全文与源码逐行核对
    reason: 状态行自述 Implemented 且引用实测（411 对人工标注姓名对、govern.mjs），但与源码一致性未逐行验证，细节粒度受限
  - issue: 五个内置本体包（schema.org/W3C Org/PROV-O/FOAF/IOF Core）的内容完整性未验证
    reason: 未部署运行，无法导入检查；README 声称其随二进制内置，冷启动实际效果未实测
gaps:
  - description: 未实际部署与运行 Utopia（Docker 安装体验、真实文档抽取质量、检索/问答效果、性能均未实测）
    priority: medium
  - description: 42 篇决策记录中仅精读 0003/0012 两篇与全部索引行，其余未读全文
    priority: low
  - description: utopia.bi/philosophy 长文与 GitHub Discussions/Issues 社区讨论内容未调研
    priority: low
  - description: bench 语料（tech/pharma/holmes/identity）的实测成绩数字未采集
    priority: low
clarification_log:
  - answer: deeplethe/utopia——GitHub 检索同名项目 10+，其中 deeplethe/utopia（8,351★，自称首个开源企业世界模型，topics 含 knowledge-graph/temporal-knowledge-graph/agent-memory/graphrag/bitemporal）为当前趋势热门且与本项目问题域重合；另一主要候选 concrete-utopia/utopia（3,782★，React 设计工具）已排除
    answered_by: external
    question: 用户所说「utopia 这个项目」指哪个项目？
implications:
  - finding_ref: F3 核心数据模型是双时态知识图谱：每条事实携带世界轴与认知轴两条时间线，账本 append-only、更正走 supersedes 链、删除是事件
    implication: LDVH 事实源三件套（CAS 指纹更新、change_log、retired 不删）与其 supersedes/墓碑机制等价，无需引入数据库形态；「删除是事件」可作为 06 提交契约撤销语义的旁证储备（机制需求）
  - finding_ref: F5 本体被当作契约执行：写入路径强制签名检查并留痕，实测把签名违规率从 57% 降到 4%、真反转从 39 降到 0
    implication: 「写入时机械闸门优于提示词恳求与事后清洗」获得独立量化证据（57%→4%），印证 LDVH 受控写入/Git Gate 路线的外部有效性，LDVH 无需改动、作旁证储备（机制需求）
  - finding_ref: F6 42 篇叙事化决策记录构成与代码并行的「为什么」权威：修订原地保留、PR 必须声明实现或推翻了哪条记录；57 个迁移文件名同样承载意图
    implication: 22 号 ADR 规范可对照吸收其「修订原地保留（反转带日期注记）」与「PR↔记录状态联动」两条纪律（见建议 1，机制需求）
  - finding_ref: F8 人机分工贯穿全流程：低置信度与疑似重复进人工复核队列，Agent 治理先读台账先例再裁决，自动合并受「可撤销性闸门」约束，裁决理由被记录并回流为提示先例
    implication: 「先例进 prompt、理由回流、可撤销性闸门」与 LDVH 反稀释/最小交还结构同向，对 35 号记忆与反思系统有直接参考价值（机制需求）
  - finding_ref: F1 Utopia 是 DeepLethe 公司支持、单核心维护者主导的新项目：公开仓库 3 周 499 次提交、8,351 stars（2026-09-15 观测）
    implication: 爆发增长但 v0.1+92% 单维护者构成采用风险，任何接入决策应以版本稳定信号为前提（项目需求，见建议 2）
  - finding_ref: F9 Agent 能力面覆盖会话、MCP 只读工具与本体驱动问数：MCP 无状态每请求重认证，问数引擎只放行只读 SQL，官方声称 Ontology2SQL 在 BIRD Mini-Dev 上为 SOTA
    implication: utopia 是 DSH 生态「可对话企业知识库」的现成 MCP 服务端候选，只读面可低成本试用（项目需求，见建议 2 信号 A）
urls:
  - ref: https://api.github.com/repos/deeplethe/utopia
    summary: 提供规模与活跃度事实：stars/forks/创建时间/主分支/许可/语言构成，2026-09-15 观测；贡献者与发布端点用于 F1
    title: deeplethe/utopia 仓库元数据（GitHub API）
  - ref: https://github.com/deeplethe/utopia
    summary: 仓库根：克隆对象与目录结构来源（crates/、migrations/、docs/、web/），F7 的 crate 行数统计基于 dev@4e9b19c 本地克隆
    title: deeplethe/utopia（GitHub 仓库根）
  - ref: https://github.com/deeplethe/utopia/blob/dev/README.md
    summary: 定位与哲学（F2/F12）、特性表（F3 双时态、F8 台账、F9 问数）、Status 与 Roadmap（F11）；观察版本 dev@4e9b19c
    title: Utopia README
  - ref: https://github.com/deeplethe/utopia/blob/dev/docs/pipeline.md
    summary: 文档→图谱全流程（F4）：两阶段设计、11 类丢弃原因、实体消解三级与双阈值；「每个阶段 drops things」体例
    title: How a Document Becomes a Graph（pipeline.md）
  - ref: https://github.com/deeplethe/utopia/blob/dev/docs/decisions/README.md
    summary: 42 条决策记录的约定与索引（F6/F8）：修订原地保留、PR↔记录联动；0025-0028 治理链状态行
    title: Decision records 索引（docs/decisions/README.md）
  - ref: https://github.com/deeplethe/utopia/blob/dev/docs/decisions/0012-the-ontology-is-a-contract-not-a-suggestion.md
    summary: F5 的主要证据：本体即契约的实测数字（57%→4%、39→0）、写入时方向纠正与留痕设计
    title: 0012 The ontology is a contract, not a suggestion
  - ref: https://github.com/deeplethe/utopia/blob/dev/docs/decisions/0003-ontology-growth-loop.md
    summary: 本体生长循环精读样本：三级采纳、 dismissal 记忆、MIN_SIGNALS=3 两文档阈值与 Dead ends 记录
    title: 0003 The ontology grows out of the corpus
  - ref: https://github.com/deeplethe/utopia/blob/dev/Cargo.toml
    summary: F7 架构证据：8 crate workspace、sqlx/tantivy/pgvector 依赖选择注释（中文注释带理由）
    title: Cargo.toml（workspace 与依赖）
  - ref: https://github.com/deeplethe/utopia/blob/dev/migrations/0003_graph.sql
    summary: F3 数据模型证据：facts 双时态列设计、精度 CHECK、entity_types/relation_types 表与设计注释
    title: 0003_graph.sql（图谱层迁移）
  - ref: https://github.com/deeplethe/utopia/blob/dev/crates/utopia-server/src/api/mcp.rs
    summary: F9 的 MCP 证据：EXPOSED 常量 11 个只读工具、WRITABLE 与 can_write 门槛
    title: api/mcp.rs（MCP server 实现）
  - ref: https://github.com/deeplethe/utopia/blob/dev/web/DESIGN.md
    summary: F10 前端证据：六条设计规则与 pnpm guard 的 CI 强制声明
    title: The interface, in six rules（web/DESIGN.md）
  - ref: https://github.com/deeplethe/utopia/blob/dev/.github/workflows/ci.yml
    summary: F10 的 CI 证据：backend/migrations/web 三作业、迁移号重复检查、连库测试强制（含注释教训）
    title: CI workflow（ci.yml）
  - ref: https://github.com/deeplethe/utopia/blob/dev/CONTRIBUTING.md
    summary: F6 辅证：分支模型、DCO、数据模型/本体契约/公共 API 变更须先落 ADR 再写码
    title: Contributing to Utopia
  - ref: https://github.com/deeplethe/utopia/blob/dev/docker-compose.yml
    summary: F10 部署辅证：app + pgvector db 两服务、1516/1517 端口、profile 划分
    title: docker-compose.yml
  - ref: https://github.com/deeplethe/utopia/releases
    summary: F1 发布节奏辅证：rc3/rc4/rc5 两周内连发
    title: Utopia releases
  - ref: https://github.com/deeplethe/ontology2sql
    summary: "F9 辅证：本体驱动 text-to-SQL 姊妹仓库（README 声称 BIRD Mini-Dev SOTA，提交 bird-bench PR #218）；实现细节未调研"
    title: Ontology2SQL（姊妹仓库）
object_uid: 6ba53f52-ef89-4afa-9676-9d8a69aa58e4
fact_type_key: research
created_at: 2026-09-15T11:23:43.282Z
change_log:
  - at: 2026-09-15T11:23:43.282Z
    provider: zzztoken-glm
    model: glm-5.3
    summary: 初始创建：克隆 deeplethe/utopia（dev@4e9b19c）完成静态调研，形成 12 项已证实发现、3 项疑点、4 项缺口与 4 条建议（机制纪律对照/选型跟踪/无需对象化判断/对象维护）
---

## 研究问题

本调研回答：开源项目 deeplethe/utopia（自称首个开源企业世界模型）是什么、其架构与工程实践如何构成、能力与成熟度边界在哪里，对 dsh-ldvh 项目有何参照与借鉴价值？

对象为 2026-08-07 创建、DeepLethe 公司支持的 Rust 项目 Utopia（官网 utopia.bi），观察版本 v0.1.0-rc5（dev@4e9b19c9b596d5a55299362dbb62dde8f164f656，2026-09-15 克隆至本地同级目录）。问题分四个子面：定位（想解决什么问题、与既有知识图谱/RAG 产品的差异）、构成（技术栈、代码架构、数据模型、流水线、工程流程）、边界（成熟度、已知限制、风险）、参照（对 dsh-ldvh 的同构与差异、可借鉴点）。

服务对象声明（30 §1.2）：本调研以项目需求为主——dsh-ldvh 需要理解该相邻开源项目的真实形态以判断是否跟进与如何参照；其中「LDVH 机制可吸收什么」的发现与建议（F5/F6/F8 及其 implications）显式标注为机制需求，不构成调研默认方向。探索型说明：对象身份与范围经「调查阶段」收敛后进入分析，收敛后的最终问题即本节首句。

## 输入与边界

实际读取来源与分工：README.md（定位、特性表、路线图、状态）；docs/pipeline.md（文档→图谱全流程，含五张流程图）；docs/decisions/README.md（42 条决策记录的约定与全部索引状态行）；docs/decisions/0003 与 0012（全文精读）；Cargo.toml（workspace 结构与带理由的依赖注释）；migrations/0003_graph.sql（实体/关系/事实表设计，前 90 行精读）；web/package.json 与 web/DESIGN.md（前端栈与六条设计规则）；.github/workflows/ci.yml（全文）；CONTRIBUTING.md（分支、DCO、ADR 前置流程）；docker-compose.yml 与 release.yml；GitHub API 元数据（规模、贡献者、发布节奏）。另由两个后台子代理分工读取后端 crate 结构（server/store 模块组织、任务队列、MCP、chat 循环、问数引擎、测试组织）与前端/工程化（页面组件、CI、部署、bench），其关键结论均经本主控抽查核实（ci.yml、package.json、DESIGN.md、0003_graph.sql、mcp.rs EXPOSED 常量、jobs.rs 队列注释、chat.rs rig 依赖）。

方法为静态调研：代码与文档阅读 + git 历史统计（499 次提交的周分布与作者分布），未部署、未运行、未跑基准。观察时点 2026-09-15。不覆盖：安装与运行体验、真实文档抽取/检索质量、性能、42 篇决策全文（以索引行为准，另精读 0003/0012）、GitHub Discussions/Issues、utopia.bi/philosophy 长文、Ontology2SQL 独立仓库实现细节。来源冲突处理：第三方趋势站月增星数与 GitHub API 总星数矛盾，弃用趋势站数字（见「未证实与缺口」）。

## 调查阶段

### 调查问题与范围
启动指令为「utopia 这个项目拉取到本地同级目录研究并写调研报告」，未指明组织或 URL，而 GitHub 同名项目十余个，调查阶段的首要问题是对象身份消歧：确认「utopia」指哪个仓库。其次是范围收敛：把「研究一下」细化为可单句表述的调研问题（是什么、如何构建、边界在哪、对本项目何用），并划定不覆盖范围。排除方向：与开发工具链无关的同名项目（游戏引擎、Ruby Web 框架、窗口管理器、模糊测试工具等）。

### 调查方法与来源
方法为检索与元数据核验：GitHub 平台检索（关键词 utopia）取得候选清单；GitHub API（repo 元数据、topics、contributors、commits、releases、languages）核验规模与主题；第三方趋势页（wuzao.com）仅作线索交叉参考、不作证据来源。观察时点 2026-09-15。来源分工：api.github.com 提供规模、活跃度与许可事实（其月增数字与 API 总星数矛盾，未采纳，见「未证实与缺口」）；平台检索结果提供候选空间；趋势页不作为证据。

### 调查发现
候选空间（部分）：deeplethe/utopia（8,351★，「World's first open-source enterprise world model」，Rust，topics：knowledge-graph/temporal-knowledge-graph/agent-memory/graphrag/bitemporal/ontology，Apache-2.0）、concrete-utopia/utopia（3,782★，React 设计工具）、Ubpa/Utopia（游戏引擎）、Samsung/UTopia（模糊测试）、socketry/utopia（Ruby 框架）等。判定：deeplethe/utopia 是唯一同时满足「当前高热度增长 + 主题与 dsh-ldvh 问题域（知识图谱、记忆、治理）直接重合」的候选——其 README 自述定位（知识工程、被动学习、自治理）与 LDVH 的事实治理方向同域；其余候选或为同名不同域、或规模与相关性不足。结论：对象确定为 deeplethe/utopia，默认分支 dev（HEAD 4e9b19c9b596d5a55299362dbb62dde8f164f656，2026-09-15 克隆至本地同级目录）。

### 调查停止与交接
调查阶段在对象身份确认且无残留歧义时停止（一轮检索加 API 核验即收敛）；调研问题随之收敛为「deeplethe/utopia 是什么、如何构建、边界在哪、对 dsh-ldvh 何用」。未覆盖并移交分析阶段边界声明的：utopia.bi 官网 philosophy 长文、GitHub Discussions/Issues 社区讨论、月增星数确切口径。交接物：仓库元数据（stars、贡献者、发布节奏）、克隆计划（本地同级目录）、既定不覆盖范围。

## 关键发现

### F1 Utopia 是 DeepLethe 公司支持、单核心维护者主导的新项目：公开仓库 3 周 499 次提交、8,351 stars（2026-09-15 观测）
观察：仓库 2026-08-07 创建，2026-09-15 观测 8,351 stars、1,093 forks、456 watchers，Apache-2.0，主语言 Rust（约 4.0MB）+ TypeScript（约 1.4MB）；公开 git 历史 3 周 499 次提交（W35:95、W36:245、W37:141、W38:18），WaylandYang 一人 461 次（92%）；两周内连发 v0.1.0-rc3/rc4/rc5。判断：五周 8.3k star 属爆发式增长，但「公司支持 + 92% 单维护者 + v0.1」意味着组织成熟度低、bus factor 高，是采用决策的首要风险项（见建议 2 监测信号）；对 dsh-ldvh 的参照意义在于观察小团队项目在聚光灯下的自我约束方式（其 0016 决策「先补既有裂缝再开新口」即此类）。
溯源：https://api.github.com/repos/deeplethe/utopia（stargazers_count/forks_count/created_at 字段、contributors 与 releases 端点，2026-09-15 观测；提交统计自本地克隆 dev@4e9b19c 的 git log）

### F2 产品定位是「企业世界模型」：单 Rust 二进制 + 单 Postgres 的自托管知识工程平台，官方明确拒绝 Palantir 类比
观察：README 开篇自述「the first open substrate for knowledge engineering that learns passively and governs itself」，把时间感知与本体放进基础层，冲突检测、推理与决策都跑在本体之上，支持离线部署；特性表首行「One Rust binary and one Postgres. Full-text search is embedded in the binary, vectors go in pgvector, and the job queue is a table: nothing else to run」；并显式声明不愿被视为「an open-source take on Palantir」，自称「a different route to enterprise intelligence, built bottom up from knowledge governance to trustworthy decisions and simulation」。判断：与 LDVH「离线可部署、治理优先于智能炫技」的价值观同向；「一个二进制 + 一个库、零外部 broker」的交付极简主义是 DSH 生态自托管件可对齐的部署形态标准。
溯源：https://github.com/deeplethe/utopia/blob/dev/README.md（开篇定位段、Features 表首行、Palantir 声明引用块）

### F3 核心数据模型是双时态知识图谱：每条事实携带世界轴与认知轴两条时间线，账本 append-only、更正走 supersedes 链、删除是事件
观察：migrations/0003_graph.sql 建立 facts 账本——valid_from/valid_to 加精度列（CHECK 强制「无日期则无精度」，防无知处填确定值）承载世界轴，recorded_at/invalidated_at 承载认知轴；更正插入新行 supersedes 旧行而非原地改写；README 表述「the graph keeps two timelines: when something was true in the world, and when the system came to believe it」；文档删除为事件（0022 墓碑 deleted_at + document_deletions 记 invalidated_facts/superseded_chunks 数组，支持撤销与重传后原路复活）。判断（机制需求）：与 LDVH 事实源三件套（03 CAS 指纹更新、change_log 流水、retired 不删）是同一治理思想在「运行时数据库」与「开发期 Git 文件」两种载体上的实现；LDVH 无需引入其形态，但其「删除是事件、复活走原路读回」对 06 提交契约的撤销语义是有价值的旁证（LDVH 现以 retired 状态表达等价语义）。
溯源：https://github.com/deeplethe/utopia/blob/dev/migrations/0003_graph.sql（facts 表列设计、精度 CHECK 约束与文件头注释）

### F4 文档到图谱的流水线采用两阶段设计：嵌入完成即可检索问答，抽取后台化，每个阶段显式登记丢弃原因
观察：pipeline.md 定义 Upload→Parse→Chunk（1200 字符、重叠 150）→Embed（此时文档 ready，秒级可检索可问答）→Extract（每 chunk 一次 LLM 调用）→实体消解→事实入账→类型消解→本体生长循环；抽取路径 11 类 drop 原因全部落 extraction_drops 表且 UI 可见（truncated_reply 整块弃、malformed_item 只弃单条、direction_corrected 是痕迹非丢弃、attr_domain_mismatch 最昂贵——事后重定型无法找回）；实体消解三级召回（等名/别名→包含召回→相似度 0.55/0.35 双阈值→LLM 批量裁决），设计准则「prefer splitting over merging」。判断：把丢弃当一等公民显式登记、拒绝静默失败，与 LDVH「证据不悬空、fail loud、不得静默降级」纪律同构；其「每个阶段列出 where this stage drops things」的文档体例对 LDVH 各类型规范「证明边界」的写法有直接参照价值。
溯源：https://github.com/deeplethe/utopia/blob/dev/docs/pipeline.md（Overview 节、§1「Where this stage drops things」十一类丢弃表、§2 双阈值）

### F5 本体被当作契约执行：写入路径强制签名检查并留痕，实测把签名违规率从 57% 降到 4%、真反转从 39 降到 0
观察：决策 0012 记录：schema.org 声明 employee(organization→person) 而图谱出现 Musk—employee→Microsoft，130 条可检事实 102 条反向；三轮提示词调优只把违规率 57%→35%（全是类型错误），真反转 22.7%→17.1%→17.6% 纹丝不动（「English 'X is an employee of Y' is too strong」）；改由写入路径 ontology::judge_direction 强制执行签名（可换向则换并记 direction_corrected、换不得则弃谓词但保留主宾/时间/证据）+ 检索类必带祖先下限，实测 57%→4%、反转 39→0；同一守卫随后扩展到 adoption 与 merge 写入路径（#190/#196）。判断（机制需求）：「写入时机械闸门优于提示词恳求与事后清洗」的量化证据，直接印证 LDVH 受控写入/Git Gate 路线的外部有效性；其「被守卫纠正的动作必须留痕、never silently」与 LDVH 机械锚点思想一致——LDVH 已走此路线，本发现作为外部旁证储备。
溯源：https://github.com/deeplethe/utopia/blob/dev/docs/decisions/0012-the-ontology-is-a-contract-not-a-suggestion.md（Status 行实测数字、Decisions 1–5、Dead ends 首条）

### F6 42 篇叙事化决策记录构成与代码并行的「为什么」权威：修订原地保留、PR 必须声明实现或推翻了哪条记录；57 个迁移文件名同样承载意图
观察：docs/decisions/ 以「NNNN-英文短题」平铺命名，索引表逐条维护状态行；Conventions 明文「When a conclusion changes... keep a dated revision note where the original claim stood」，理由是「The ledger this product keeps never updates a fact in place; a correction inserts a new row that supersedes the old one, because the change of mind is information」——决策文档自身遵循产品的双时态哲学；另两条：变更过大时新记录 + 旧记录标 superseded by NNNN；「The PR that implements a record updates its status line」。CONTRIBUTING 规定数据模型、本体契约、公共 API 变更必须先落 ADR 再写码。57 个迁移文件名即意图陈述（deleting_is_an_event、a_decision_records_why、the_agent_asks_before_it_guesses、governance_reads_the_ledger）。判断（机制需求）：与 22 号 ADR 规范同构且在两处更细——「修订原地保留（反转带日期注记而非重写）」与「PR↔记录状态联动」是 22 号可对照吸收的候选纪律（见建议 1）；「迁移名=意图」与 LDVH 规范命名的可读性实践互证。
溯源：https://github.com/deeplethe/utopia/blob/dev/docs/decisions/README.md（Conventions 节四条约定与 Index 表结构）

### F7 工程架构 8 个 Rust crate 分层清晰：store 与 server 为主，任务队列即 Postgres 表，无外部 broker
观察：workspace 8 crate——core（共享模型/错误/配置，约 2.3k 行）、store（sqlx 仓储+迁移+任务队列，约 49.8k 行、42 模块，图谱核心 graph.rs 约 2,400 行）、server（axum HTTP+后台 worker+MCP+chat，约 38.3k 行，api/ 下 35 个路由模块）、ingest（解析/切块）、extract（抽取归一化）、reason（纯逻辑一致性检查，不碰 DB）、search（Tantivy 全文检索含 jieba 中文分词）、llm（OpenAI 兼容薄客户端，覆盖 DeepSeek/Qwen/GLM/Ollama/vLLM）；任务队列 jobs.rs 用 Postgres FOR UPDATE SKIP LOCKED 消费 + PgListener 通道 utopia_jobs 唤醒，失败按 30s×attempts² 退避、max_attempts=3；store 另有 93 个集成测试文件。判断：数据访问/编排/纯逻辑的分层与 LDVH「规范源/事实源/CLI/Code」职责分离同哲学；「队列即表」印证 DSH 生态「不引外部基础设施」的部署取向；reason crate 纯函数零风险面设计对 LDVH 机械校验层是同型做法。
溯源：https://github.com/deeplethe/utopia/blob/dev/Cargo.toml（workspace members 表与 sqlx/tantivy/pgvector 依赖注释；各 crate 行数为 dev@4e9b19c 本地统计）

### F8 人机分工贯穿全流程：低置信度与疑似重复进人工复核队列，Agent 治理先读台账先例再裁决，自动合并受「可撤销性闸门」约束，裁决理由被记录并回流为提示先例
观察：决策索引（四条状态行均为 Implemented）：0025 治理任务按 FIFO 处理重复队列、先例从台账拉进 prompt、Agent 置信度与历史决定升降门槛、一周两次 revert 即自动关闸并告警、每眼看一行 agent_decisions、按 411 对人工标注姓名对实测（govern.mjs）；0026 人工裁决的 rationale 从每个人工决定路径入台账、先例引用进 prompt 与 ledger_search 工具、模型自己的 why 保存在机器决策旁；0027 自动合并前问 execution_gate——会开一致性矛盾、有推导依赖、答案曾引用任一侧的一律升级人工（escalate_impact），无视置信度；0028 裁决者先带 consequences 工具（查合并会动什么、类型是否同族）再看。判断（机制需求）：与 LDVH「Human 决定权 + AI 责任 + 反稀释」三原则高度同构——先例进 prompt ≈ LDVH F2 召回相邻事实；可撤销性闸门 ≈ LDVH 最小交还结构；「理由回流为后续先例」对 35 号记忆与反思系统有直接参考价值（utopia 用台账先例约束 Agent 自由裁量，是 LDVH 反稀释目标的一种运行时实现形态）。
溯源：https://github.com/deeplethe/utopia/blob/dev/docs/decisions/README.md（Index 表 0025/0026/0027/0028 四行状态行）

### F9 Agent 能力面覆盖会话、MCP 只读工具与本体驱动问数：MCP 无状态每请求重认证，问数引擎只放行只读 SQL，官方声称 Ontology2SQL 在 BIRD Mini-Dev 上为 SOTA
观察：chat 循环按 0042 实现为「runner + hooks」（基于 rig 框架：工具调用不得被跳过、空回复追问一次、跳过率按模型记录不预防）；MCP server 在 api/mcp.rs 以 JSON-RPC 2.0 Streamable HTTP 暴露 EXPOSED 数组 11 个只读工具（另有 can_write 管控的 WRITABLE 集），无状态、每请求重认证（0014）；问数引擎 query_engine/ 支持 Postgres/MySQL/Trino（Iceberg/Delta/Hive）/Databricks/Snowflake，安全闸只放行 SELECT/WITH、强制 LIMIT、只读会话加超时；表-本体映射由 LLM 提议、人工确认；README 声称 Ontology2SQL（姊妹仓库）在 BIRD Mini-Dev 的 SQLite/PostgreSQL 赛道为 SOTA（bird-bench 提交 PR #218）。判断（项目需求）：这是 DSH 生态现成的「可对话企业知识库」MCP 服务端——与 Claude Desktop/Cursor/Workbuddy 等 MCP 客户端的接入路径已打通，只读面加无状态认证使其可低成本挂进现有工作流试用（见建议 2 信号 A）；对模型生成 SQL 的多层不信任防御与 LDVH 对 LLM 输出的机械校验立场一致。
溯源：https://github.com/deeplethe/utopia/blob/dev/crates/utopia-server/src/api/mcp.rs（EXPOSED 常量 11 个只读工具、WRITABLE 与 can_write 门槛）

### F10 前端是完整产品级 Web 应用（React 19 + Vite 6 + sigma 图可视化），设计规范六条规则由 CI 强制，交付为 Docker Compose 两服务一键部署
观察：web/ 为 React 19.3 + Vite 6 + TypeScript 5.7 + TanStack Router/Query + shadcn/ui（radix Nova 预设）+ Tailwind 4 + sigma 3/graphology/forceatlas2 图可视化 + 双语 i18n；DESIGN.md 六条规则（五级字号、六档间距、四类角色圆角、颜色全走 token 双主题、组件统一定义状态页面只渲染 shell、面板为同类内容容器）由 pnpm guard 在 CI 强制——「a page that breaks them does not merge」；CI 三作业：backend（fmt/clippy -D warnings/test/build）、migrations（起 pgvector:pg16 真库、查迁移号重复、migrate run 跑两遍、连库跑 store 测试缺库即红——注释记录「两个 PR 各带一个 0025、各自通过、合并后服务起不来」的教训）、web（test + build 含类型检查）；release 先本地冒烟（健康检查、注册用户验证迁移/argon2/JWT）再推镜像；部署 docker compose --profile app up 一键起 app+db 两服务（1516 端口）。判断：产品完成度显著高于同星量级新项目均值；「设计规范用 guard 机械化执行、违反即不能合并」与 LDVH「规范即可执行规则」理念同构——10 号 Web 呈现规范若引入 lint 式守卫是同型演进方向（弱参照，机制需求）。
溯源：https://github.com/deeplethe/utopia/blob/dev/web/DESIGN.md（六规则全文与 pnpm guard 强制声明）

### F11 成熟度边界明确：v0.1 阶段、迁移只进不退、推理物化默认关闭、类型消解仍靠手工触发、路线图多项目未完成
观察：README Status 自述「still at v0.1. The database schema evolves between versions and migrations only roll forward, with no rollback」，生产须锁版本并备库；推理物化默认关（错公理会派生错事实，派生事实单独表、断言严格优先、上限与截断显式报告）；pipeline.md 记录类型消解「runs only by hand today... depends on someone remembering to click. This is a real gap (0001 P3a)」；路线图决策推理、业务规则、执行闸门、MaxCompute、飞书源、100k 文档基准等均未完成。判断：自我边界陈述诚实（Dead ends 文化一以贯之）；对 dsh-ldvh 的意义当前以参照为主——v0.1 + 无回滚迁移 + 单维护者（F1）构成采用三重风险，任何接入决策都应以版本稳定信号为前提（见建议 2）。
溯源：https://github.com/deeplethe/utopia/blob/dev/README.md（Status 节、Roadmap 未勾选项与 Features 表 Reasoning 行的默认关闭声明）

### F12 Utopia 与 LDVH 是同一治理思想在两种载体上的实现（数据库图谱 vs Git 规范/事实文件），互为参照而非替代
观察：utopia 把「知识何时为真、系统何时开始相信」存入 Postgres 双时态表，治理靠服务内写入闸门、append-only 台账、人工复核队列；LDVH 把规范与事实存 Git 文件，治理靠受控读写、Git Gate、Human 决定权；两者独立发展出相同的核心原语集：写入时强制契约、显式登记丢弃与失败、人机分工与先例回流、可撤销性、理由留痕、时间感知（双时态 vs CAS+change_log）。判断：同构性印证 LDVH 治理路线的外部有效性（独立收敛是路线稳健性的证据）；载体差异决定互补定位——utopia 管运行时企业数据知识，LDVH 管开发过程知识，DSH 生态若出现运行时知识底座需求，utopia 是候选而非竞品（支撑建议 2 的定位判断）。
溯源：https://github.com/deeplethe/utopia/blob/dev/README.md（Philosophy 节与 Features 表 Decision ledger 行）

## 未证实与缺口

疑点（对应 frontmatter uncertain）：

1. 「30 日 star 增长 +11,592」未证实。来源为第三方趋势站（wuzao.com）月度榜，与 GitHub API 总星数 8,351（2026-09-15）直接矛盾——增长数不可能超过总星数，口径不明，已弃用；仅保留「仓库创建于 2026-08-07、总星数 8,351」这一 API 直接可核实事实。对判断的阻塞：不影响定位、构成、边界结论，仅热度斜率的表述受限。
2. 治理链（0025/0026/0027/0028）与 chat runner（0042）的实现细节以决策索引状态行为准，未读四篇全文与对应源码逐行核对。状态行自述 Implemented 且引用实测（411 对姓名对、govern.mjs），与源码一致性未验证。对判断的阻塞：F8/F9 的细节粒度受限，方向性结论不受影响。
3. README 宣称的五个内置本体包（schema.org、W3C Org、PROV-O、FOAF、IOF Core）的内容完整性未验证——未部署运行，无法导入检查。对判断的阻塞：不影响架构结论，影响「冷启动实际效果」的评估。

缺口（对应 frontmatter gaps）：

1. 未实际部署与运行 Utopia（Docker 安装体验、真实文档抽取质量、检索/问答效果、性能均未实测）——medium 优先级——对「怎么用、好不好用」的结论形成边界（本报告以静态调研为边界声明，见「输入与边界」）。
2. 42 篇决策记录中仅精读 0003/0012 两篇，其余以索引行为准——low 优先级。
3. utopia.bi/philosophy 长文与 GitHub Discussions/Issues 社区讨论未调研——low 优先级。
4. bench 语料（tech/pharma/holmes/identity）的实测成绩数字未采集——low 优先级。

## 建议

1. 机制纪律对照（机制需求，显式标注）：将 utopia 决策记录的两条纪律带入 22 号 ADR 规范的下一次修订评审。目标对象类型：ADR（specs/22 修订）；预期目标：在 22 的载体与修订约束中评估加入 (a)「修订原地保留——结论被推翻时在原处留带日期的修订注记而非重写，被推翻结论保持可读」与 (b)「实现某条 ADR 的变更须声明实现或推翻了哪条记录并同步其状态行」；验收条件：22 号修订稿包含或显式拒绝该两条并给出理由，经 Human 批准；创建/更新判断：当 22 号规范因实质问题进入修订时一并评审，不为此单独开修订；不成立边界：若 Human 认定现有 change_log + retired 语义已覆盖等价信息，记录不吸收理由即可。
2. 选型跟踪（项目需求）：当前不接入 utopia，建立两个监测信号。信号 A：DSH 生态出现「自托管知识库/世界模型」具体需求（如 LDVH 事实源需挂运行时知识底座、或某插件需要企业文档问答能力）→ 创建 WorkCase 试用评估（docker compose 部署 + tech/pharma 语料基准 + MCP 经 DSH 侧客户端实测），验收条件：试用记录含抽取质量、检索效果、升级风险三组数据。信号 B：utopia 发布 v0.2 或作出 schema 稳定/回滚承诺 → 对本对象做同问题观察刷新（受控更新）。
3. 无需对象化判断（当前）：utopia 的其余工程模式（迁移即文档、丢弃原因表、无 broker 队列、guard 化设计规范）作为背景认知由本对象承载即可，不逐条建立 Spark——判断依据：无具体承接工作，逐条立项不满足 20 号准入的现实价值条件；监测条件：仅当某项后续工作显式需要落地某条模式（如 06 提交契约的撤销语义参考）时，由该工作按其准入创建对应对象并引用本对象。
4. 本对象维护：utopia 发生足以改变结论的重大变化（v0.2、治理模型变更、许可证变更、仓库转归档）时更新本对象；在上述变化发生前，本对象作为「dsh-ldvh 理解 utopia 的当前入口」可长期回查，来源以 GitHub 仓库 dev 分支为准。

## 后续分流

- 建议 1：当 22 号规范进入修订窗口 → 在该修订中评审吸收或显式拒绝；若判定不吸收，在当次修订讨论中记录本对象为已读输入即可，无需对象化。
- 建议 2 信号 A：出现自托管知识底座需求 → 创建 WorkCase（试用评估）；信号 B：v0.2 发布 → 本 Research 受控更新（同对象同问题刷新观察）。
- 建议 3：维持无需对象化；其监测条件出现时由相应工作按各自准入承接。
- 疑点 1（热度口径）：无需对象化；后续如需热度追踪，以 GitHub API 为唯一数据源。
- F8「先例回流」机制若要在 35 号记忆与反思系统中承接：当 35 号起草或修订进入议程时，以规范依据或 inspired-by 关系引用本对象，不提前建对象。
- 本轮调研无未消化的开放议题，不创建 Spark。
