# Hy-Memory（Tencent-Hunyuan/Hy-Memory）调研报告

调研对象：https://github.com/Tencent-Hunyuan/Hy-Memory （克隆 @ 988667c，2026-10-28）
调研时点：2026-10-31 · 定位：对 dsh-ldvh 的吸收参照 + 技术尽调 · 证据基线：代码实证优先于文档宣称
登记对象：ldvh-base/researches/research-1883e8b4.md（本文件与其正文一致；引用经 ldvh_research_session rs-mvwiqhcp-2w0qwg 四轮收敛 + audit-citation / check-delivery 双检通过）

## 研究问题

Tencent-Hunyuan/Hy-Memory（双系统认知记忆 SDK + MemHub 本地优先产品）的架构机制、工程质量与实际成熟度处于什么水平，其中哪些机制对 dsh-ldvh 具有可吸收性、哪些构成警告？

选择此问题：本工作区宿主即 DeepSeek Harness，Hy-Memory 官方支持矩阵把它列为接入目标（且有 #230 未通事故），同时其「记忆+授权+常驻服务」与 LDVH 经验积累、事实源、宿主机制直面同构——评估一手资料完备（开源仓库可克隆实跑），具备吸收参照价值。

## 输入与边界

- 对象集：GitHub Tencent-Hunyuan/Hy-Memory 单仓库三层资产（hy_memory SDK / memhub 产品 / plugins），另核 PyPI hy-memory、npm memhub-cli、HF tencent/Hy-Memory-30B-A3B、arxiv 2606.09483 与 2610.22196、GitHub issue/release/contributors 面。
- 一手来源：本地克隆 /Users/dmh2002/DshProject/Hy-Memory @ 988667c（浅克隆 depth 50，可得 171 commits，全部落 2026-10-21..28）；GitHub/PyPI/npm API 于 2026-10-31 查询；pytest 本地实跑。
- 边界：不做记忆质量端到端评测（本地无 LLM API key，integration 标记用例默认 deselected）；不安装运行 MemHub Desktop/Runtime（源码与 CI 证据为准）；不看其内部未公开流程。全部文档宣称按代码实证复核。
- 背景数据：仓库 2026-10-15 创建，1897 stars / 122 forks / 91 open issues，Apache-2.0（含 Tencent 前言）；实质贡献者约 3 人；SDK 78,779 行 Python（132 文件），memhub 子项目 1,355 文件（537 py + 514 ts + 112 tsx），全仓测试文件约 793 个。

## 关键发现

### 定位：Hy-Memory 自称「生产级双系统认知记忆」，含 Python SDK（hy-memory）+ MemHub 本地优先产品两层，面向自演化 LLM Agent 提供 Chat/Working/Coding 三场景记忆管线

三层资产（SDK/桌面产品/30B 模型+论文）叠在一个仓库、各自独立发行；CHANGELOG 明言独立版本线；SDK 对 30B 零硬耦合（hy_memory/ grep 30B 零命中）。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory/blob/988667cd876fb80bee6d618482f78a2fe426402c/README.md（第7行、第24行，blob @ 988667c）

### Chat 场景八层结构 L0–L7（L0 BASIC_INFO / L1 RAW append-only / L2 FACT versioned immutable / L3 SUMMARY / L4 IDENTITY Reserved / L5 KNOWLEDGE Reserved / L6 SCHEMA / L7 INTENTION 带过期）；代码实测 L4 已停写、L5 无任何写入点，八层中两层为死层

README 层表 L4/L5 行标 Reserved；writer.py 起 L4 不再写入仅读历史，L5 全仓无写入分支。对外「八层」叙事含两层非活层。对 LDVH：分层本身（原始/事实/摘要/结构 分离 + 版本不可变事实）是好的，但能力叙事必须与写入点存在性对齐——据实声明的反面教材。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory/blob/988667cd876fb80bee6d618482f78a2fe426402c/README.md（Chat 层表 L4/L5 行）

### 双系统写路径：System1 逐条 ReconcileOp{ADD/SUPERSEDE/UPDATE}+关系边(causes/elaborates/contrasts/same_series)，LLM 不可用降级全 ADD 标 degraded；System2（ultra evolve() 显式触发）DBSCAN 聚类后 10 工具 schema agent 产出 L6 SCHEMA；记忆状态机 ACTIVE/SUPERSEDED/NEGATED/CONFLICTED/SHADOW/ARCHIVED（models/memory.py:121-129）

prompt 硬规则：UPDATE 仅限同一事件、SUPERSEDE 仅限矛盾且新 memory_at≥旧、content 只写新状态；聚类池只含未被 Schema 引用的新 fact。reconciler.py:82 类定义与 :124 relation_type 注释同仓可查。对 LDVH：这是本次调研最有分量的可吸收件——操作枚举+关系边闭集+六态状态机+降级标注，与事实源的更正/取代/change_log 语义直面同构。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory/blob/988667cd876fb80bee6d618482f78a2fe426402c/hy_memory/models/memory.py（:129 MemoryStatus 闭集末项）

### 检索主路径设计：单层巨型函数 _read_once（:1110–:3624 约 2500 行）承载全部召回通道——VDB 语义 + BM25(jieba) + tag 桥接 + L0 profile + 图通道并行，融合为加权求和（semantic .5/recency .3/importance .15/access .05）而非 RRF；LLM 完全不在检索路径（仅 judge/scene 层可选）

RRF 只用于 L6 图 forward/reverse 展开；ABSTAIN 阈值 0.15 支持弃答；池预算 VEC 30/TAG 20。设计面（多通道并行、确定性融合、可弃答）值得参照；实现面（2500 行单函数）是明确警告。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory/blob/988667cd876fb80bee6d618482f78a2fe426402c/hy_memory/pipelines/reader_base.py（:1110 async def _read_once，blob @ 988667c）

### SDK 主链路可达缺陷：MemAgent.process_recall 引用 self.abstractor 但 __init__ 从未创建该属性，调用即 AttributeError；MemAgent 被 writer.py:42 正式导入并在 pro/ultra 路径使用

同文件 :112-132 只创建 self.extractor/self.reflector，:303 却调用 self.abstractor.abstract(。全量单测绿说明该分支零覆盖——测试绿≠主链路可达。对 LDVH：独立复核视角必须含「可达性走查」，不能只看 CI 绿灯。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory/blob/988667cd876fb80bee6d618482f78a2fe426402c/hy_memory/agent/mem_agent.py（:303，对照 :112-132）

### SDK 测试基盘可运行：CI 固定跑 pytest（dev+faiss+qdrant extras）；本地同构实跑（克隆 @ 988667c，装齐三 extra）得到 1448 passed / 7 failed(缺 qdrant 时) → 补装后全组通过、约 1455 条用例 47.6s 跑完，套件真实可用

7 个失败全部 qdrant 相关（批量检索/时间过滤/写延迟守卫），非逻辑缺陷；本地 uv 解析 Python 3.12 与 CI 同构。正面项：测试不是摆设，量级与速度真实。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory/blob/988667cd876fb80bee6d618482f78a2fe426402c/.github/workflows/ci.yml（:39 uv sync --extra dev --extra faiss --extra qdrant）

### 写入价值门槛全在 prompt 不在代码：经验层 VALUE BAR 三条同时满足 + 排除清单（单文件 rename/git status/一次性命令/repo 已有信息…）+ 停滞会话强制 experiences:[] 防自我复制；无代码级 value_threshold 开关；confidence 分级 1.0/0.7/0.5

extractor.py 给 LLM 的硬门槛清单，代码侧无任何价值预过滤；门槛是否被执行完全取决于模型遵循度。对 LDVH：排除清单内容可直接复用进经验采集提示词，但必须机械+prompt 双承载（警告 1）。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory/blob/988667cd876fb80bee6d618482f78a2fe426402c/hy_memory/coding/extractor.py（:92 VALUE BAR，blob @ 988667c）

### MemHub 四道独立授权闸：Source grant（可读宿主数据根）/ harness sync（同步开关）/ Model-content permission（内容可否送模型）/ Host recall grant（外部宿主可否调召回工具）——四类问题不得合并；实测关同步不卸 MCP/Skill/Hook 不撤凭据

ARCHITECTURE.md 原文「These permissions answer different questions and must not be collapsed」后接四条编号问句；harness-support/README.md 记录关同步的保留语义。对 LDVH：与 Human 决定权+机械闸同构，是授权面设计的首选外部参照。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory/blob/988667cd876fb80bee6d618482f78a2fe426402c/memhub/docs/ARCHITECTURE.md（:147-152，blob @ 988667c）

### Local-first 承诺有文档+代码双重承载：PRIVACY.md 明列不采集屏幕/AXTree/OCR/键鼠/剪贴板/录音；全仓 grep telemetry/sentry 只命中关闭 Chroma 遥测的代码；出网仅用户自配模型服务+GitHub Release 下载；API key 存系统钥匙串；数据全在 ~/.one-memory

本地逐文件 grep 复核：无埋点、无上传路径；secrets.py 走钥匙串。承诺-代码一致性是本仓库最强正面项之一。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory/blob/988667cd876fb80bee6d618482f78a2fe426402c/memhub/PRIVACY.md（采集负面清单段，blob @ 988667c）

### 宿主接入三形态：hermes 纯标准库只读 provider（末轮预热/首轮取用、session 持久化已注入 memory_id 防重复）；openclaw 自建 venv 拉起 hy_memory.server 全 CRUD；自定义宿主走一次性 6 位 pairing code（TTL 10min、原子消费、拒 Origin 防 CSRF）换 host credential + MCP 配置——分级信任面清晰

recall-broker.ts 路由面仅 /health /pair /context；pairing 上限 1024、secret 仅返回一次。三形态按信任等级铺开（只读→全 CRUD→凭据交换），机制本身干净。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory/blob/988667cd876fb80bee6d618482f78a2fe426402c/plugins/hermes/README.md（生命周期段 queue_prefetch）

### 产品与 SDK 解耦方式为 PyPI 硬 pin：MemHub apps/core 依赖 hy-memory==2.0.8（非源码引用），两者独立发版（根 2.0.8 / memhub 全包 1.0.5）；SDK 是数据面唯一权威，Core 仅经 SdkClientHandle 构造公开客户端

core pyproject.toml:15 硬 pin；CHANGELOG:3 独立版本线声明；例外仅 Graph 可视化直查 Kuzu。「库=数据面唯一权威、产品只是消费者」的分层对 LDVH 的 CLI/宿主边界有参照价值。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory/blob/988667cd876fb80bee6d618482f78a2fe426402c/memhub/apps/core/pyproject.toml（:15 "hy-memory==2.0.8"）

### 平台能力诚实收缩：Windows 因缺 ACL 后端而刻意不支持（非遗漏，源码明言+CI 验证脚本故意 exit 1）；macOS 仅 arm64 App，Linux 仅 Runtime；无自动更新

host-grants.ts 注释直书 deliberate；verify-windows-support.mjs gate=blocked 恒 exit 1 作发行闸。「不做»做得含糊」的诚实收缩 + 用 CI 闸把承诺钉死，值得参照。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory/blob/988667cd876fb80bee6d618482f78a2fe426402c/memhub/packages/host-bridge/src/host-grants.ts（:13/:32，blob @ 988667c）

### 数据面权威迁移（SDK authority cutover）是当前事故第二区：#233 迁移后触发器引用已删表致授权不可撤销；#229/#234/#240 多个 sdk_migration 失败 issue；迁移带 pre-cutover 备份但成功性不足

issue 面证据：迁移成功后 source_grants 触发器指向已删除表，503 local_store_unavailable，用户无法撤销/重新授权来源。对 LDVH：任何存储/权威切换须配独立迁移验证与回滚预案，且「迁移成功性」本身要成为验收判据。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory/issues/233（issue 标题）

### 后台资源治理是当前最大痛点区：#245 无限重试无退避致 100%+CPU 24h+WAL 639MB；#227 后台 174–200% CPU 发热；#158 日志日增 1.45GiB；#231 running 任务不回收——本地常驻服务型记忆产品的运维面事故集中在地

重试无退避、队列空转、日志放大（client 重建 26 倍）三类治理缺陷互证；均 open。对 LDVH：闲置辅助/常驻机制自检清单须纳入「重试退避、日志增长上限、队列空转治理」三项。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory/issues/245（issue 标题，访问时点 2026-10-31）

### 对 DeepSeek Harness（即本工作区宿主）的官方集成现状：只能停在 install-only、一键插入返回 unsupported_host、无替代授权入口（#230 open）；历史扫描路径 $DSH_HOME/sessions 另有 #175 session.v4.jsonl.zstd 不匹配 issue——DSH 接入在其支持矩阵中属未跑通尾部

harness-support/README.md:43 DSH 行自述 Profile 级 MCP Patch/无自动 Hook/sessions 扫描；与 #230/#175 互证「文档声称支持、实路径未通」。现阶段与其互通会承接未通工程。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory/issues/230（issue 标题）

### 社区热度与处置能力不成比例：开源仅 16 天即 1897 stars / 122 forks（热度真实），但 open issues 91 vs closed 仅 24，实质贡献者约 3 人（txfei 85/kristinhe1111 40/u7-u7 20 commits），问题积压速度大于销账速度

GitHub API 与 contributors 图、issue 搜索计数于 2026-10-31 实测。吸收其机制按「自研参照」评估，不按「可依赖的活跃上游」评估。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory（API 字段 stargazers_count/forks_count/open_issues_count/created_at/pushed_at）

### 发行节奏极快：pypi hy-memory 1.0.0→2.0.8 共 46 个发行版（约 5.5 个月）；浅克隆 171 commits 全部落在 2026-10-21..28 八天内（日均 20+），属抢发布窗口式开发

PyPI 版本列表与本地 git rev-list 实测；根 pyproject.toml version 2.0.8。快节奏与上述事故区（迁移/治理）互为因果。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory/blob/988667cd876fb80bee6d618482f78a2fe426402c/pyproject.toml（:6-7 name/version，blob @ 988667c）

### 学术背书面真实可核：EMNLP 2026 录用论文（arxiv 2606.09483）与 30B-A3B 技术报告（arxiv 2610.22196）均实际存在；CMB benchmark 自述 submitted to ICLR 2027（未录用）；仓库文档不宣称 LOCOMO/LongMemEval 分数；30B 模型与 SDK 零代码耦合（grep 30B 在 hy_memory/ 零命中，SDK 只要求 OpenAI-compatible）

两个 arxiv ID curl 200 回验；README:41 Accepted 段、:40 CMB submitted 段。背书面不虚标（不刷榜、模型解耦），与工程面「死层叙事」形成对照——宣称纪律不一致。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory/blob/988667cd876fb80bee6d618482f78a2fe426402c/README.md（:41 新闻段，blob @ 988667c）

### 工程卫生存在细节失控：openclaw 插件清单 version 0.1.0 与 package.json 1.1.10 不一致；中英 prompt 双套手写平行副本无共享模板（issue #243 实证语言检测阈值对技术中文失效）；环境开关散落实现文件不在 config 集中

openclaw.plugin.json:5 vs package.json:3 实测漂移；103 个 py 文件含 CJK 提示词副本。LDVH 有 bilingual-terminology 规范，同类风险应走共享模板而非双副本。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory/blob/988667cd876fb80bee6d618482f78a2fe426402c/plugins/openclaw/openclaw.plugin.json（:5 version 字段）

### 新按 README 快速上手安装的用户会拿到落后版本：README 写 pip install hy-memory==2.0.4 而发行物已到 2.0.8；影响程度 UNVERIFIED（优先级 low，缺口编号 G3）——无用户反馈或实测损害证据，仅静态比对所得

README.md:65 与 pyproject.toml:7 版本号静态比对；未安装侧验证损害面。

溯源：https://github.com/Tencent-Hunyuan/Hy-Memory/blob/988667cd876fb80bee6d618482f78a2fe426402c/README.md（:65 pip install hy-memory==2.0.4）

## 未证实与缺口

- **G1（medium）**：记忆质量实际效果（检索精度/销账正确性/System2 聚类质量）未实测——本环境无 LLM API key，integration 用例默认 deselected；仓库文档本身也不宣称 LOCOMO/LongMemEval 分数（这点诚实）。吸收收益判断只能到「设计面」为止。
- **G2（low）**：MemHub 产品面（dmg/systemd Runtime、桌面 UI、pairing 实操）未安装运行验证，结论依据为源码+CI+文档。
- **G3（low）**：README 滞后（2.0.4 vs 2.0.8）对新用户的损害程度未实测（见发现单元 20 的 UNVERIFIED 标注）。
- **uncertain**：README 过时安装指令的实际损害面——仅静态比对（README:65 vs pyproject:7），无用户反馈或实跑佐证，对应缺口 G3。

## 建议

**可吸收（按价值序）**

1. **四道授权闸模型**（发现 8）：「不同问题不得合并」的 Source grant / harness sync / model-content / host recall 分闸，与 LDVH Human 决定权+机械闸同构且可直接对照。目标对象类型：Norm 讨论或 ADR 候选（宿主读取/闲置辅助授权面）；预期目标：LDVH 授权面能用四类独立问题表述且各自可单独撤销；验收条件：规范原文可指出对应闸位；创建判断：LDVH 启动来源授权或闲置辅助读取改造时建工单承接，当前无改造计划则不建、保持参照悬置。
2. **ReconcileOp + 记忆状态机**（发现 3）：SUPERSEDE/UPDATE 分离、关系边闭集、降级全 ADD 标 degraded 的做法，可参照 LDVH 事实源的更正/取代语义与 change_log 设计。目标对象类型：ADR 候选；验收条件：LDVH 冲突状态语义能对照其六态说明取舍；创建判断：当同一事实载体出现多载体冲突处理需求时提请。
3. **弃答阈值与池预算**（发现 4）：ABSTAIN 0.15、「检索可以明确说不确定」+ 名额分池是召回面板可直接借鉴的最小机制；对应 LDVH 双源召回改造时建 WorkCase，否则仅记参照。
4. **写入价值门槛清单化**（发现 7）：VALUE BAR 三条同时满足+排除清单（一次性命令/repo 已有信息/如何问 X…）+停滞会话强制空经验，可整段复用进 LDVH 经验采集 prompt；但须机械+prompt 双承载（见警告 1）。验收条件：清单进采集提示词且有一段机械预检。
5. **缺口以文档明记的工程卫生**（发现 9/12/18 佐证面）：其把未做项写成带状态标记的专项文档并由 CI 门禁联动，与 LDVH Friction/Pitfall 账本同族；无需对象化——LDVH 已有更强机制，仅作「文档承载 vs 账本承载」对照观察。

**警告**

1. **prompt-only 门槛不可靠**（发现 7）：LDVH 不得把价值判定完全交给提示词。
2. **死层叙事**（发现 2）：对外能力表述与代码能力不一致会侵蚀信任——LDVH §5.6 据实声明纪律的反面教材；机制分层须以写入点存在性为准声明。
3. **巨型函数+主链路带病+全量测试绿并存**（发现 4/5/6）：测试覆盖≠主链路可达性；LDVH 复核视角选择时须含「可达性走查」维度。
4. **数据面权威迁移即事故**（发现 13/14）：任何 authority cutover 与常驻资源治理都要独立验证与回滚预案；LDVH 若做存储权威切换须单开验证工单。

## 后续分流

1. **授权分闸吸收**：当 dsh-ldvh 启动来源授权/宿主读取机制改造时，创建 WorkCase 引用本对象发现 8；若无该计划信号，无需对象化，监测条件为 Norm 方向 catalog 出现相关方向立项。
2. **事实源状态机对照**：当 LDVH 事实载体出现 UPDATE/SUPERSEDE 取舍争议（Friction 或 Spark 出现同类现象）时创建 ADR 候选，引用发现 3。
3. **复研触发**：#230（DSH 接入）、#233（迁移授权）、#245（资源治理）任一进入 closed 且随版发布，或 closed:open 比例显著反转时，新建第二轮调研对象（本对象届时按 24 §6 重研规则处理）；此前不再投入。
4. **DSH 生态依赖判断**：LDVH 若考虑与 Hy-Memory 互通（其支持矩阵点名本宿主），当前警告：实路径未通（发现 15）——互通需求出现时先创建 Spark 记录而非直接实施。
5. **G1 记忆质量实测**：仅当环境出现可用 LLM 服务且 LDVH 需要评估自身经验销账质量时创建 WorkCase（用其 CMB 或自建集复测）；否则保持缺口记录，无需对象化。
