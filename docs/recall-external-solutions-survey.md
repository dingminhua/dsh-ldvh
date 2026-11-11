# 外部方案调查：注入式召回为什么被忽略，别人怎么做

**时间**：2026-11-11。
**触发**：独立复核推翻我的两处判断后，Human 说「联网调查，看看有没有更好的解决方案」。
**约束**：`34 §8.2` 禁止用相似度、embedding、关键词权重裁决相关性。故本文如实报告外部做法（含向量方案），并标明哪些受此约束、哪些不受。

**方法说明**：本环境 `web_search` 提供方未注册，改用 `curl` 直取一手来源（官方工程博客、arXiv 摘要页、GitHub README）。**未经二次转述**，数字均引自原文。

---

## 一句话结论

**我的方案里最核心的假设（「预注入更多候选 → 更多被用上」）在外部已有明确的反向证据。** Anthropic 自己的工程结论是「少而准的常驻 + 按需深取」，并明确说预注入式检索正在被「即时取用」补充甚至替代。而我的实测（2.4% 落盘率）恰好是这条外部结论的又一个数据点。

---

## 一、Anthropic：预注入 vs 即时取用

**来源**：Anthropic Engineering《Effective context engineering for AI agents》（2025-09-29）
<https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>

原文关键段（我抓取的正文）：

> Today, many AI-native applications employ some form of **embedding-based pre-inference time retrieval** to surface important context for the agent to reason over. As the field transitions to more agentic approaches, we increasingly see teams **augmenting these retrieval systems with "just in time" context strategies**. Rather than pre-processing all relevant data up front, agents built with the "just in time" approach **maintain lightweight identifiers (file paths, stored queries, web links, etc.)** and use these references to **dynamically load data into context at runtime using tools**.

> ...a file named `test_utils.py` in a `tests` folder implies a different purpose than a file with the same name located in `src/core_logic/`. **Folder hierarchies, naming conventions, and timestamps all provide important signals** that help both humans and agents understand how and when to utilize information.

> Letting agents navigate and retrieve data autonomously also enables **progressive disclosure** — allows agents to incrementally discover relevant context through exploration. **Each interaction yields context that informs the next decision**: file sizes suggest complexity; naming conventions hint at purpose; timestamps can be a proxy for relevance.

> Of course, there's a trade-off: **runtime exploration is slower** than retrieving pre-computed data. ... In certain settings, the most effective agents might employ a **hybrid strategy**, retrieving some data up front for speed, and pursuing further...

**对我的意义**：这段几乎逐条对应我的问题。
- 我的注入是 `pre-inference retrieval`——外部明确把它列为「正在被补充/替代」的旧形态。
- 我的 2.4% 落盘率，正是「预注入的内容不进入决策」的量化形态，而外部给的解释是「模型没有把它们当作要用起来的东西，而是一堆要处理的文本」。
- 它给的替代路径是**路径/标识符 + 工具按需取**，不是我调参数。

---

## 二、为什么注入多了反而更差（可引用的实证）

### 2.1 长上下文里，中间位置的信息最容易被丢

**来源**：Liu et al.《Lost in the Middle: How Language Models Use Long Contexts》（TACL 2024）
<https://arxiv.org/abs/2307.03172>

> ...performance can degrade significantly when changing the **position** of relevant information... performance is often highest when relevant information occurs at the **beginning or end** of the input context, and significantly degrades when models must access relevant information in the **middle** of long contexts.

**对我的意义**：LDVH 的注入结构是「固定声明 → 基线 → L0 索引 → 词法候选 → 披露行」。**候选正好落在中间**，前后都是固定文本。按这条证据，候选被忽略是结构性的，不是偶然。

### 2.2 输入一长，推理质量本身下降（不只是「忘了」）

**来源**：Levy et al.《Same Task, More Tokens: the Impact of Input Length on the Reasoning Performance of Large Language Models》（ACL 2024）
<https://arxiv.org/abs/2402.14848>

> ...a **notable degradation in LLMs' reasoning performance at much shorter input lengths than their technical maximum**. We show that the degradation trend appears in **every version** of our dataset.

**对我的意义**：这条更狠——即便我把候选放在「好位置」，只要总长度上去了，推理质量本身就降。所以「塞更多候选 + 声明它们很重要」这个思路在根上是错的。

### 2.3 长上下文基准：技术上限 ≠ 实际可用

**来源**：Hsieh et al.《RULER: What's the Real Context Size of Your Long-Context Language Models?》（COLM 2024）
<https://arxiv.org/abs/2404.06654>

> ...this simple retrieval-based test is indicative of only a **superficial form of long-context understanding**... RULER expands upon the vanilla NIAH test to encompass variations with diverse types and quantities of needles...

**对我的意义**：我此前用「主题命中 10/10」证明「不漏」——那正是 NIAH 式的表层检索测试。RULER 的批评正好打在这个口径上：**能找到 ≠ 会用**。

---

## 三、同类项目怎么做（可直接对照的工程形态）

### 3.1 `tigerless-labs/agent-memory`（★4.3k）——形态与 LDVH 最接近

**来源**：<https://github.com/tigerless-labs/agent-memory>（README）

它的「设计承诺」里有几条与我的问题直接相关：

> - **Three read tracks, so a miss on one is not a miss.** Deterministic `MEMORY.md` injection at session start; **BM25 recall** over an FTS5 index, with a vector plugin fused in by **RRF** when you want one; and **the plain directory tree, reachable with `ls` and `grep`** when both fail.
> - **Files are the truth; every index is a rebuildable cache.** `rm -rf .index/ && mem rebuild` loses zero knowledge — **enforced by a test, not promised in a doc**.
> - **No LLM client inside the library.** Zero keys to install... judgement is borrowed from the host agent's own CLI.

它的读取形态是**分级**的：

> Recall does **not paste text into your context**. It answers with an **L0 list** — one-line abstract, file path, anchor, score — and the agent opens what it wants at the depth the task needs:
> ```
> mem recall "why files instead of a database"              # L0 list, 8 entries by default
> mem read <name> --level outline                           # headings only; or abstract, or full
> mem context "why files instead of a database"             # both in one call, top few expanded in full
> ```
> **Index line → abstract → full file → raw material: each rung costs an order of magnitude more than the last, and each is a place to stop.**

**它与 LDVH 的差距（我认为最值得抄的一条）**：
- 它的常驻注入**只有 `MEMORY.md` 一个根索引**（"the only resident injection"），其余全部按需取。
- 它把「索引不必完美」当成设计前提——**三条读路径互为兜底**，所以召回质量差一点不会致命，因为还有 `ls`/`grep`。

**LDVH 当前缺的正是这两点**：L0 索引 + 词法候选都常驻，且没有「取不到就自己找」的兜底路径（AI 可以自己 grep，但注入面没有把这件事变成明确指示）。

**它自报的实测**（LongMemEval-S，120 episodes，`claude -p` Haiku 4.5 作 host，Sonnet 5 作判官，两轮回放）：

| arm | pooled accuracy |
|---|---|
| agent-memory | 127/240 = 52.9% |
| 同类系统 | 86/240 = 35.8% |
| **无记忆** | **7/120 = 5.8%** |

它自己也声明了边界：「haystack 被限制在每 episode 12 个会话，所以这是**写策略研究**，不是语料规模研究」。

### 3.2 `ratel-ai/ratel`（★556）——「按需披露工具与技能」

**来源**：<https://github.com/ratel-ai/ratel>；基准页 <https://benchmark.ratel.sh>

> - **Cost:** Every tool schema, every skill, and a growing list of instructions in the system prompt are tokens you pay for **on every call**.
> - **Accuracy:** **Models get worse as that context grows.** Crowd it with tools, skills, and instructions a turn doesn't need and the model **picks the wrong option and drifts off task**.
> - **Ratel fixes both:** it indexes your tools and skills into a catalog the agent **progressively discloses**, searching for what each turn needs and **injecting only the matching capabilities** instead of loading everything up front.

基准页的形态是**哑铃图**：`Oracle`（只给金标工具，是地板）vs `With Ratel`（网关）vs `Baseline`（全量工具池）。它承认「Oracle」是最优下界，把「接近 Oracle」当目标。

**对我的意义**：它把「上下文越多越糟」写成产品第一句话，并用 token 量 + 准确率两条腿度量。LDVH 只量了「注入了什么」，没量「模型因此做对了什么」。

### 3.3 `Caph-dev/agents-progressive-disclosure`（★75）——同名方法论，且有反直觉的自我修正

**来源**：<https://github.com/Caph-dev/agents-progressive-disclosure>（README，中文原文）

它的核心主张与 LDVH 的形态几乎一致：

> 核心思路是渐进式披露：**根指令文件保持精简，只保留高频、长期有效、必须始终遵守的规则**；项目细节、规范、技术文档和任务专项流程下沉到 `docs/`，由项目级 `AGENTS.md` 按需引用。

**但作者自己加了一条反直觉的警告，我认为这条最有价值**：

> [!CAUTION]
> 其实将**全局** `AGENTS.md` 拆分的必要性并不高，主要是方便维护。**省上下文的收益几乎为 0**，反正都会命中缓存。
> 但是对于**项目级**的 `AGENTS.md` 用处就不小了...

**对我的意义**：这是一条反证——**拆分/精简本身并不直接带来收益**，收益来自「按需加载」这个动作，而不是「文件变短」。我此前把「少给几条候选」当成改进，正好犯了它警告的错。

---

## 四、对照表：外部做法 vs LDVH 现状

| 维度 | 外部共识 | LDVH 现状 | 我的评估 |
|---|---|---|---|
| 常驻注入量 | 尽量小，只留高频必守规则（agent-memory 只留 `MEMORY.md`） | L0 三类索引 + 词法候选 + 固定声明，约 6-8KB | **偏大**，且候选落在上下文中间 |
| 取用方式 | 给标识符（路径/查询），用工具按需深取 | 一次性全量给出，无深取层级 | **缺层级**（虽已有 L0-L4 规范读取工具，但注入面没引导去用） |
| 命中失败的兜底 | 三条读路径互备（索引 / BM25 / 目录树） | 仅一条路径（词法匹配） | **单点** |
| 「相关性」判定 | 允许 embedding / RRF / BM25 | `34 §8.2` 禁止 | **受规范约束**，但可用 BM25/字面（不受禁） |
| 度量 | 端到端任务准确率 + token 量 | 召回精确率、命中率 | **缺端到端**：没量「注入后做对了什么」 |
| 精简的收益 | **拆文件不等于省 token**（缓存命中）；收益来自按需加载 | 我一度把「少给候选」当收益 | **认知错误**，已被复核与外部双重纠正 |

---

## 五、我认为更好的方案（按可行性排序）

### 方案 A：把「候选」降级为「索引指针」，深取交给工具（改动最小、最符合外部共识）

**做法**：注入面不再给「候选 + 摘录」，只给**一行指针**（标题 + 路径 + 命中词），并明确写「要读全文请用 `ldvh_*_read`」。摘录（约 120 字符/条）不再常驻。

**依据**：Anthropic 的「lightweight identifiers + 按需加载」；agent-memory 的「index line → abstract → full file，每级贵一个数量级」；Caph 的警告「收益来自按需加载，不是变短」。

**代价**：AI 要多一次工具调用才知道那条候选讲什么。**这正好是「有改变」的形态**——外部把它叫 progressive disclosure，我此前的实测把它叫「落实」。

**是否受限**：不受 `34 §8.2` 约束（不涉及相关性判定，只涉及交付形态）。但**改变注入形式**，属 `10 §9.1` 第 2 项 Human Gate。

### 方案 B：加一条「自取」兜底路径，写进注入面

**做法**：注入面末行明确写：「若以上候选都不适用，用 `grep`/`ldvh_*_list` 按机制自行检索——**未命中不代表没有同类教训**」。

**依据**：agent-memory 的三条读路径互备；我现在的注入面虽有类似措辞（「查故障时请自行按机制检索」），但**没有给出具体工具与判据**。

**代价**：几乎为零（只加一句话）。**收益**：把「单点失败」变成「可恢复」。**这一条我认为最该先做，且不需要 Human Gate**（不改注入预算与形式，只补一句已有能力的指引）。

### 方案 C：补端到端度量（解决「改了不知道有没有用」）

**做法**：不只量「注入了什么」，量「注入后 AI 做对了什么」——这正是复核指出我漏掉的（改了召回却没重测 2.4%）。

**依据**：Ratel 用 token + 准确率双腿度量；agent-memory 用 LongMemEval 端到端准确率；RULER 批评「NIAH 式表层检索不算理解」。

**代价**：要人工标注任务成败，成本高。**建议先做小样本（20-30 个真实任务）**，复用我已有的会话日志取证脚本。

### 方案 D（不建议）：引入向量/BM25 检索

**理由**：这是外部主流（agent-memory 的 vector plugin + RRF，MemOS/MemMachine/memvid 等都以向量为核），但 `34 §8.2` 明确禁止用相似度裁决相关性。**若要采用，须先经 Human 改规范**，不能由我以「外部都这么做」为由自行引入。

**补充**：注意 BM25 是**字面统计**而非语义相似度，与 §8.2 的禁止项是否冲突需要 Human 判定，我不替规范做解释。**这一条我建议单独立项请 Human 裁定，不在本 Spark 内推进。**

---

## 六、这份调查改变了什么

1. **我的核心假设被外部证据否定**：不是「候选不够多/不够准」，而是「预注入这个形态本身在退化」。继续在精确率上打转，方向就错了。
2. **「少给就等于好」也被否定**（Caph 的 CAUTION）：收益来自**按需加载**，不是内容变短。我上一轮的改动正是这个误区。
3. **最该做的三件事**：A（指针化）、B（自取兜底）、C（端到端度量）。B 可立即做且不需 Gate；A、C 需 Human 决定或较多投入。
4. **D 单独立项**：向量检索与 `34 §8.2` 的关系须 Human 裁定，我不自行跨越。

## 未验证的范围

- 未找到 LDVH 这类「中文、强规范约束、事实对象分型」场景的同类项目；上述项目均为英文工作流，**迁移性未验证**。
- agent-memory 的 LongMemEval 分数是它自报的，我未复现；它自己也声明 haystack 被限制。
- Ratel 的基准是它自家的（BFCL v3 + 自家对比），**存在自证嫌疑**——与复核批评我的问题同型，引用时须打折。
- 我未验证「指针化」在 LDVH 上的实际效果。这是一个可测量的假设，但需要先做 A 才能测。
- 未查询中文社区的同类实践（本次只用英文检索词）。

## 引用清单

- Anthropic, *Effective context engineering for AI agents*, 2025-09-29 — <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents>
- Liu et al., *Lost in the Middle*, TACL 2024 — <https://arxiv.org/abs/2307.03172>
- Levy et al., *Same Task, More Tokens*, ACL 2024 — <https://arxiv.org/abs/2402.14848>
- Hsieh et al., *RULER*, COLM 2024 — <https://arxiv.org/abs/2404.06654>
- tigerless-labs/agent-memory — <https://github.com/tigerless-labs/agent-memory>
- ratel-ai/ratel — <https://github.com/ratel-ai/ratel> / <https://benchmark.ratel.sh>
- Caph-dev/agents-progressive-disclosure — <https://github.com/Caph-dev/agents-progressive-disclosure>
