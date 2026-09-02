# 架构对话记录：LDVH 以 dsh-mnemon 为工程基底（2026-09-03）

> 性质：会话决策记录（Human 要求专门记录本次谈话），非规范、非事实对象。
> 参与者：Human（老丁）与主控 AI。
> 前置阅读：`docs/technical-framework-mnemon-base.md`（本次谈话催生的技术框架文档）。
> 状态：方向已由 Human 定案；具体实施顺序待 Human 逐项拍板。

## 1. 本次谈话的起点与结论链

### 1.1 起点：插件接入远未完成

Human 指出此前"下一步做 20 Spark / v4 Web 迁入"的建议方向不对——**插件接入本身还没做对**：启动流程不对、管辖判断没做对。这触发了一轮从规范源到参考实现的重新核对。

### 1.2 结论链（按谈话推进顺序）

1. **LDVH 插件以 dsh-mnemon 为原始工程参考**（Human 定案）：mnemon 已验证的宿主接入模式（挂载、注入、缓存、清理、降级）是 LDVH 的工程基底；LDVH 在其上叠加自己的思想与功能。读侧（召回/预热/注入）与 mnemon 高度同构，直接以其为范本。
2. **写侧根本不同，按 v4 架构**：mnemon 是自由写（remember 随时写）；LDVH 写必须落成五类事实对象（ADR/Pitfall/Spark/WorkCase/Study），走 03 §9 受控写入管线，Git Gate 最终闸门。mnemon 写侧只有编排件（idleReview、委派协调）可借，自由写路径不采用。
3. **服务范围是架构级分水岭**（Human 补充定案）：mnemon 为所有项目服务，LDVH 只为管辖项目服务——因为 LDVH 要具体写进用户项目目录（`ldvh-base/` 随 Git 仓库走），写错就是污染用户仓库的事故。管辖判定是**门禁**不是路由。
4. **召回内核不照抄 mnemon**：mnemon 是 provider/embedding 概率召回（smart=graph 增强、keyword、basic 三模式，9 个可插拔 provider）；LDVH 规范明文禁止相似度/embedding/关键词权重/AI 输出裁决相关性（v4 05 §8.1 / v5 03 §8）。mnemon 贡献"召回结果怎么进上下文"，不是"候选怎么算出来"。
5. **召回路线终局定案（同日下午，Human 定）：明确不走向量路线。** 谈话中曾形成"到场候选层允许概率召回（本地 embedding 自实现）"的中间结论，经两轮现实检验被否决——云端 embedding API 要把事实内容发往第三方服务器（违反"数据随 Git 走"的治理立场），本地 embedding 服务要求用户装 Ollama + 拉 GB 级模型（部署负担对大部分用户不可接受）。联网调查佐证：AI 记忆业界三路线并存且向文件派回摆——向量派内部退位为 hybrid；**文件派**（Claude Code/Manus 用 Markdown 做记忆）是编码 agent 主流，Letta 基准实测纯文件系统 agent 74.0% 超过 mem0 最强图谱变体 68.5%。详见框架文档 §2.3。
6. **读写总纲定案（Human 提出并定案）："格式化写、程序化读、大模型理解"。** 关键推论链：① 召回形态决定写入形态，而 Human 进一步指出**写入格式 = 召回路径的预埋**（第零原则）——向量库"无所谓怎么写，反正是计算出来的"，LDVH 反其道，靠格式让召回变简单；② 五类对象的召回与写入各不相同，分类型设计（ADR 常驻 / Pitfall 触发 / Spark 查重 / Study 按需 / WorkCase 状态枚举）；③ 分工为"LLM 语义判断 + CLI 确定性支援"——v4 CLI 的 `text_match` 不重建、BM25 方案一并放弃（本质是二次数据源），文本匹配归 LLM 读摘要自筛；④ **尽量不要二次数据源**——直扫权威 YAML，不建持久索引（v4 find-fact-object-candidates 原教旨）；⑤ 写入侧三机制：分级门槛（Spark 快通道/ADR·Pitfall·Study 标准通道）、创建前查重（治同题多开）、关系声明提示（治声明率 0/8）；⑥ 字段语义质量进独立复核（"symptoms 是不是观察者语言"由 LLM 把关，防形式主义填充）。行业四范式对比评估结论：可行且是面向 LLM 时代的正确押注——人用格式保证质量，程序用确定性保证准确，LLM 用语义保证理解。
7. **事实源"人能看"承诺与规范类文档议题（Human 提出，设计建议已记录、准入属 Human Gate）**：两类新内容冲击"人能看"承诺——code/web 设计文档（人不看，消费对象是 AI）与规范类文档（审计/测试/发布规范，人要看，且"像规范又像 ADR"）。建议：① 设计文档**不对象化**，保持 docs/，立纪律"设计文档禁止藏规则"；② 规范类文档立新类型候选（暂名 **Practice/实践规范**），与 ADR 按行业"决定与规则分离"共识分工——ADR 记"为什么"（决定+理由，快照式），Practice 记"怎么做"（检查清单/步骤/标准，长期演化），互引（ADR consequences 指向 Practice；Practice change_log 首条回指 ADR）；与 specs/ 的边界=治理规范 vs 项目业务规范（用户拿 LDVH 管自己项目时区分立显）；**双态 Policy-as-Code**（清单条目机械可检查，CLI 提供 check，审计规范自动变审计工具）；召回=触发式，Web 侧为 Human 高频阅读区。行业对照：ADR 运动决定/规则分离、IETF BCP 系列、Diátaxis 四象限、Policy-as-Code、开源根目录惯例。详见框架文档 §8.1。

## 2. 启动流程定稿（六条，对现状 `plugin/lib/index.js` 的修正）

| # | 修正 | 依据 |
|---|---|---|
| 1 | 主挂载点 `agent/session-start` → **`ctx.on('agent/created')`**，per-agent `agent.ctx.effect` 自动清理（废弃手动 Map + disposed 记账） | mnemon `lifecycle.ts install()`；dsh-agent 669 行 emit 实证 |
| 2 | 管辖判定进入 **agent 级 `system-prompt/assemble` async waterfall**：`await` 判定后按态注入引导段，**首轮 prompt 即正确**（修掉同步快照首轮为空的竞态） | dsh-system-prompt 331 行 waterfall 是 async 实证；mnemon `assemblePrompt()` |
| 3 | webServer 从 inject 硬门槛改为 **`ctx.inject(['webServer'], cb)` 软回调**：核心 inject 最小集 `['tools','settings','systemPrompt']`，headless profile 不挡核心能力 | mnemon `ctx.inject(['connection'])` 模式 |
| 4 | `origin==='subagent'` 子代理走单独路径 | mnemon `installChild()`；子代理工具策略待 Human 定 |
| 5 | `agent/session-start` 只留状态记录（sessionScopes 供 /ldvh/state 端点）与重置 | mnemon `lifecycle.start()` 职责分层 |
| 6 | 工具保持 **agent-scoped 注册**（governed 才注册，动态切换）——这是 LDVH 强于 mnemon 全局注册的地方，不改 | §15-1 零干扰；dsh-tools ScopedLayers 实证 |

**明确不动的**：判定器本身（07 §5.3 语义 + mtime 缓存，热路径 0.03ms）、/ldvh/state 常驻端点、Git Gate 共享 validator、Client 标记方案。

## 3. 上下文注入四通道（mnemon 实证，LDVH 采用但全部过管辖门）

| 通道 | DSH 机制 | LDVH 用途 |
|---|---|---|
| ① 全局 section | `systemPrompt(ctx).section` | 七锚点最小引导（01 §10.4），text 函数按管辖态返回 |
| ② agent 级 shadow | `agent.ctx.get('systemPrompt').section/context` | 管辖态/项目身份段 |
| ③ runtime context | ~~`systemPrompt(ctx).context`~~ | **不用**（mnemon 已弃用：共享投影一次写入全贡献者重发） |
| ④ 插件自有消息 ★ | `agent/pre-step` 瀑布追加 `{role:'user', source:{kind:'plugin', plugin:'dsh-ldvh', form}}` | **事实候选预热 / 行动模板路由**（08 §5.3 行动前引导） |

④通道工程细节照抄清单：prepend 拿全量批次；只在 step 1 注入；ownRequest 防自激；digest 去重；`cueAlreadyVisible()` 扫 `session.surface.nodes` 判可见性（rewind 不发 session-start，flag 不可靠）；快照追加在本插件消息块最底部；`form` 区分语义（LDVH 增 `template`）。

## 4. 管辖门禁推出的三条硬约束（§1.1 已入框架文档）

1. **一切能力先过管辖判定**：工具、引导、pre-step 预热、Web 呈现——mnemon 的"全局生效"模式一律降级为"governed 会话生效"；
2. **两类写入授权路径不得混用**：`ldvh-base/` 在工作区内（会话沙箱 + Helper 契约），`governed-projects.yaml` 登记载体是跨工作区路径（授权归 08 §6）；
3. **agent-scoped 注册是硬要求**：同 Host 并存时 not_governed 会话零感知——mnemon 全局工具注册模式**不可采用**（不是风格选择，是门禁语义）。

## 5. v4/v5 补课确认（Human 要求"都很熟悉"后完成的阅读）

### 5.1 已通读/精读

- **v5 规范**：00（根方案）、01（规范模型/L0–L4/七锚点）、02（八维定义与机制指向，本次补）、03（五类/公共字段/F0–F4/§8 召回红线/§9 受控写入）、04（行动模板五机制/风险路由/预检落实记录，本次补）、05（DSH 原生工具直通/声明形状/能力发现五态，本次补）、07（管辖登记制度全章）、08（DSH 接入 §5–§6）。
- **v4 规范**：05 事实模型 §8.1（发现/召回/展开/语义消费四层 + F0–F4 全表 + "不因 lifecycle 自动触发"保留条款）与 §11.5–11.6（find-fact-object-candidates 输入/结果字段闭集、relation_navigation 边模型、coverage 分页语义）；04 Helper（公开操作声明表格模式：规范正文表格声明 operation_key，Code 只从规则源发现）。
- **v4 实物**：`ldvh-base/` 五目录、ADR 完整 YAML 样例、`code/ldvh/facts/` 模块（candidate_discovery/relations/repository/schema 指纹）、Helper operations/ 目录（~25 操作）、**Spark 098 预热方案全文**。
- **桥接文档**：v4→v5 迁移矩阵、v4 问题账（103 Spark + 152 WorkCase 盘点）、49 份 Study 吸收账、v5-handoff 四根支柱。

### 5.2 补课后改变判断的三个点

1. **v4 规范对自动预热有明文保留**：05 §8.1——`find-fact-object-candidates` "仍只在 AI 已明确进入事实消费分支后由 AI 显式请求，**不因环境 lifecycle、当前工作对象、关系存在或本段语义自动触发**"；且"本节不因定义语义模型而使……环境触发或**上下文注入能力**自动成立；这些能力必须在后续增量中另行定义预算、请求结果契约、失败语义"。Spark 098 的论证（目标驱动的有差别注入 ≠ 无差别 dump）正是对这个保留的回应，但 **v5 规范层尚无对应授权条款**——pre-step 预热落地前需要规范增量（大概率是 03 §8 修订 + 08 §5.3 核验登记），这是 Human Gate 事项。
2. **v4 F2 召回比记忆中转述的更严格**：不建持久索引、不 embedding、不要相关性分数、不要 AI 摘要、不要第二事实权威；`text_match` 是区分大小写的精确字面 substring（连大小写折叠都不做）；`match_reasons` 只记录命中依据，禁止相关性说明。mnemon 式 mtime 缓存可以用于管辖判定（已做），但搬到事实扫描上必须保持"可随时从权威对象复核"的性质。
3. **v4 公开操作声明模式值得 v5 工具面继承**：操作由规范正文固定表格声明（operation_key/summary/effect/双契约位置回指），Code 只从规则源表格发现，实现不能反向创造公开操作——v5 05 §6.1 已继承此形状（声明形状 + availability 五态），`ldvh_*` 工具的 operation_key 应与规范声明表一一对应。

### 5.3 v4 失败模式对当前工作的直接约束

- wc-56/wc-35 过度设计被 Human 撤回 → 启动/预热实现要"薄"，警惕机械完备性压倒简单流程；
- Spark 095（过度合规，P1 open）→ pre-step 注入必须有预算与快通道意识，不能每回合大段注入；
- 研究→执行断层（16 retired 中 13 个"不引入"）→ 本次谈话结论必须落到实施批次，不停留文档；
- 独立审核 7 次返工 → 涉及复核维的设计一次到位，不串行补丁。

## 6. 待 Human 拍板/讨论的事项（谈话中悬而未决）

1. **预热注入的规范授权**（Human Gate）：03 §8.2 当前只授权"已满足事实消费进入条件时"的预热；自动 pre-step 注入需要规范增量定义预算、触发时机、去重、失败语义。Spark 098 留下的 5 个待调查问题（注入时机/注入量/去重/与引导分工/搜索 profile）要在此一并回答。
2. **子代理会话策略**：`origin==='subagent'` 的子代理——按 governed 同等对待（注册工具）还是只给引导不给工具？
3. **unavailable 引导段文案**：fail-closed 提示内容是否维持现状？
4. **实施批次启动确认**：批次 1 = 启动修正六条 + pre-step 通道空壳（governed 门控 + ownRequest 防护 + digest 骨架，不注入真实候选）。

## 7. 实施批次（谈话形成的顺序，未开始）

- **批次 1**：启动修正（§2 六条）+ pre-step 空壳；
- **批次 2**：子代理分路（待 §6.2 拍板）；
- **批次 3（阶段二）**：事实只读内核——五类 repository/索引/指纹按 v4 `facts/` 选择性重建 + F0–F2 候选工具；
- **批次 4（阶段三）**：预热接真实候选（以 §6.1 规范授权为前置）；
- **批次 5（阶段四）**：受控写入管线（03 §9）；**批次 6（阶段五）**：WorkCase 执行模型。

## 8. 参考实现坐标（备查）

- mnemon：`../dsh-mnemon/src/` —— `lifecycle.ts`（install/preStep/assemblePrompt/cueAlreadyVisible）、`guidance.ts`（section/context/shadow）、`index.ts`（inject 最小集 + ctx.inject 软回调）、`live-runtime.ts`（settings validate+swap）、`providers/`（9 provider 概率召回，不采用）。
- DSH 宿主实证：`dsh-agent` 669 行 `agent/created` emit；`dsh-system-prompt` 331 行 async waterfall `system-prompt/assemble`；dsh-tools ScopedLayers agent 级 shadow。
- v4：`/Users/dmh2002/poker_hud_projects/ld-vibe-harness-v4/` —— specs/05 §8.1/§11.5–11.6、code/ldvh/facts/、ldvh-base/sparks/spark-01M0MY3Q15F0XRAKEQRRAHHXJS.yaml（098 预热方案）。
