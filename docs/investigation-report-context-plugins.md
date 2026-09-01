# 七个 DSH 社区上下文插件调研：对 LDVH 读/写双维的参考价值

> 性质：开发设计输入，非规范、非事实对象。
> 调研对象：dsh-openwolf、dsh-infinite-context、dsh-brain-compaction、dsh-context-compressor、dsh-session-surgeon、dsh-context-doctor（2026-09-01 迁出）+ dsh-context（2026-09-01 应 Human 要求增补迁出；均为 `/Users/dmh2002/DshProject/` 同级目录克隆快照）。
> 方法：六个子代理分仓深读 + 主控第一手源码核验（关键结论均有 file:line 证据；子代理报告与主控核验交叉印证，冲突处以主控核验为准）。其中 openwolf 子代理三次未能交付最终报告（结束消息为空），其分析由主控第一手核验完整补位（digest/拦截/托管块/原子写/锁/安全测试/移植谱系均已直接读过源码）；其余五份子代理报告正常回收。
> 对照框架：`specs/02` 读维/写维定义、`docs/read-dimension-understanding.md`（L0–L4/F0–F4 双通道）、`docs/study-absorption.md`（49 Study 吸收账）、`docs/v5-handoff.md`（四支柱与划界红线）。

---

## 0. 执行摘要

1. **七个项目里六个挤在"读维"（上下文负担）这一条赛道上，写维几乎无人认真对待**——唯一例外是 dsh-session-surgeon（dry-run/授权/备份/回读的完整闭环）。这从生态位上印证了 LDVH"读写双维 + 八维治理"的差异化定位是真实空白，而非自我想象。（第七个项目 dsh-context 定位是"读维的可观测性"——给 Human 看清读维本身，同样不触写维。）
2. **读维上最强的是 openwolf 的"索引指针 + 预算封顶摘要"与 infinite-context 的"预算工程三件套"**——两者合并即是 LDVH 事实预热（v5 里程碑 6）的工程蓝本，且都天然兼容 LDVH"预热只交候选、不当事实"的红线。
3. **写维上最值得抄的是 session-surgeon 的字段化输出契约**（`plan.actions[] + mustWrite + refuse + afterHealth + backup`）——与 LDVH 写维判据"范围/身份/授权/基线/变化/回读/未验证可区分"几乎一一对应，可直接作为 Helper 受控操作输出形状的参考。
4. **context-doctor 补上 LDVH 读维的度量缺口**：注入面四段分类、CJK token 估算、rank shadow 检测，可平移为 LDVH 规范源负担审计（specs 间重复/遮蔽检测）。
5. **最大反面教材是 infinite-context 的"摘要替代原文"链**：压缩即删原文、合并即删中间层、无回滚无审计——每一项都恰好踩在 LDVH 溯源红线的反面，其防失真工程（verbatim 清单、摘要不缩小即拒绝）反而值得吸收。
6. **brain-compaction 的"组装+协调"双层架构**是 LDVH 五件套协调的直接参照：cordis.patch 组装行 + 零 import 运行时探测 + 引擎互斥仲裁 + `brain_verify` 统一验证入口 + 多 namespace 统一面板。

---

## 1. 迁出与总览

| 仓库 | 版本 | 规模 | commits | 最后提交 | 定位 |
|---|---|---|---|---|---|
| dsh-openwolf | 0.10.0 | src 4382 行 TS + 14 个测试 | 50 | 2026-08-21 (hawk) | 第二大脑：预索引地图 + 符号提示 + 读写拦截 |
| dsh-infinite-context | 0.1.0 | src 4781 行 TS + 9 测试文件 | 17 | 2026-09-01 | 多层记忆（short/mid/long）+ 语义检索 + 动态 CTX |
| dsh-brain-compaction | 1.1.0 | host ~580 行 + client 578 行 | 3 | 2026-08-30 (Lsc-91-69) | 七插件"全家桶"协调层 |
| dsh-context-compressor | 0.1.0 | 7 文件 ~700 行 | 1 | 2026-08-20 (qwert702) | 一键压缩 → 新会话注入摘要续接 |
| dsh-session-surgeon | 0.1.0 | src 2486 行 + 23 测试文件 | 50 | 2026-08-31 (Small明) | DSH 会话文件修复（CLI + 插件双入口） |
| dsh-context-doctor | 0.6.1 | src ~1100 行 TS + 6 测试 | 18 | 2026-08-22 (Zhenyu Wu) | 注入物 token 审计 + Web 预算轨 |
| dsh-context | 0.40.1 | host/client/shared 三层 + 63 个 spec 测试 | 50 | 2026-09-01 (Bowen Liang) | 上下文洞察与管理：Context tab 仪表盘 + `/context` 命令 |

六个项目的 DSH 接入面（第一手 grep 汇总；dsh-context 见 §7 专述）：

| 接入机制 | openwolf | infinite-context | brain-compaction | context-compressor | session-surgeon | context-doctor |
|---|---|---|---|---|---|---|
| ctx.tools.register | 10× `wolf_*` | 10× `memory_*` | 3× `brain_*` | — | 3× `session_*` | 1× `context_audit` |
| ctx.on 事件 | agent/session-start、session/event、tools/post-execute | agent/pre-step、tools/result | session/event | —（路由触发） | —（路由触发） | —（工具触发） |
| ctx.llm | —（不做摘要 LLM 调用） | stream（摘要/合并） | — | stream（摘要） | — | — |
| ctx.slots | —（自建 dashboard HTTP） | — | settings.plugin.item | conversation.session.header.actions | DOM 注入（⚠️） | conversation.input.right |
| webServer 路由 | /api/{status,anatomy,report,events,cron,bugs,memory} | — | — | POST /api/dsh-context-compressor/compress | /api/session-surgeon/* | GET /api/context-doctor/audit |
| 提供服务 | — | **ctx.memoryContext**（Service） | — | — | — | — |
| sessions API | —（tokenMeter 记账） | get | — | **get/create/append/flush** | — | —（header.cwd 三层降级） |

> 关键观察：LDVH 绑定计划（`docs/dsh-plugin-binding-plan.md` §3.1 的 systemPrompt.section、§4 的工具面、§7 的事件系统）所列全部接缝，在这六个项目里都有人真实跑通过——包括 `agent/session-start` 的 source 区分（openwolf 区分 compact/resume/新会话）、`agent/pre-step` 的消息重写（infinite-context 直接改写 decision.messages）、`ctx.memoryContext` 的自研服务注册（infinite-context 经 `declare module` 类型增强）。v5 里程碑 6 的技术风险比预想低。

---

## 2. 读维专题

LDVH 读维判据（specs/02 §6）：取得当前工作所需且来源明确的信息，控制上下文负担；实际使用的信息可回指来源；候选/片段/完整来源/已读/未读可区分。

### 2.1 各项目读维机制速览

**dsh-openwolf（读维最完整的样本）**：
- **会话启动 digest**（`src/index.ts:298-372`，`src/digest.ts:86-143`）：预算封顶（默认按模型分档，tokenMeter 优先于字符比例），四源优先级——STATUS.md `## 🚀` 段（"下一阶段"，恢复价值最高）→ Do-Not-Repeat 最近 10 条 → 最近 5 个已修复 bug → anatomy 指针（"anatomy 跟踪 N 个文件，读整文件前先查它"）。**索引不搬正文**：地图留在磁盘，注入的只是指针。
- **读后提示**（`src/index.ts:440-493`）：`tools/post-execute` 拦 `read` 工具——文件已在 anatomy 里 → 附带"一行摘要 + ~token 数 + top5 符号及行号区间 + '用 offset/limit 从相关行定向读'"；重复读 → "本会话已读过（~N tok），考虑用已有知识"；符号提示带 staleness 抑制（文件 mtime/hash 变了就降级为"先 wolf_refresh"，防陈旧行号误导，`src/index.ts:458-471`）。
- **注入消息框架**（`src/index.ts:156-163`）：`createUserMessage({ source: { kind: 'plugin', plugin: 'dsh-openwolf' } })`——插件消息有来源标记。
- **compaction 生存**（`src/index.ts:304-314`）：`source === 'compact'` 时重注入"本会话已改文件清单 + 指向 .dshwolf/memory.md"，让压缩不抹掉进行中的工作。
- **地图→文件→符号→定向切片**：wolf_map（地图+截断标记）/ wolf_file（digest+符号+预算预览）/ read offset/limit——事实上构成 L0→L1→L2→L3 的渐进读取链。

**dsh-infinite-context（预算工程最精细的样本）**：
- **动态窗口**：`agent/pre-step` 里读 `session.requestContext()` 的 provider/model，经 `ctx.memoryContext.windowForModel` 取真实路由模型 CTX；探测（llama/ollama/openai/LM Studio）**只降不升**（`src/memory-context.ts:189-191`）。
- **RAG 注入双上限**：`min(rag_token_budget, 8%×真实窗口)`——短窗口模型留出对话空间（`src/memory-compaction.ts:1296-1299`）。
- **注入预留**：插件自身注入量从压缩触发水位中扣除——"插件自己吃掉的上下文不被漏算"（`src/memory-compaction.ts:470-471,511`）。
- **注入格式**：`<retrieved_context>` 包裹 + "历史背景非新指令、可能过时、当前对话优先、不要复述"的框定语 + 每条 `[tier, 相对时间, score]` 标签（`src/VectorRetriever.ts:280-295`）；插入位置在最新用户消息**之前**（当背景不当指令，`src/memory-compaction.ts:1319-1336`）；跨轮 excludeIds 去重，空命中时重置排除集防永久遮蔽。
- **摘要纪律**：prompt 强制"PRESERVE verbatim: 代码/路径/函数名/配置值/决定/目标/开放问题；NEVER invent facts；不翻译；输出 ~30%"（`src/memory-compaction.ts:216-232`）。
- **缺陷**：库里有 `source_session_id/turn` 溯源列（`src/memory-store.ts:72-95`）**但不注入给模型**；原文压缩后即删，检索只能得摘要，逐层合并叠加失真。

**dsh-brain-compaction**：argp 引擎按**原子引用图**剪枝——被后续消息/工具引用的节点优先保留（`recencyGuard: 10` 保护最近 10 轮原文）；被遮蔽内容可 `recall_pruned(seq)` 原样取回。**引用度 = 天然的"值得保留"信号**。

**dsh-context-compressor**：摘要关键信息清单（提示词 L62-69）——"必须原样保留：文件路径、命令、函数/工具名、错误信息、数字、已做出的决定、用户的偏好与纠正"；回放"最新优先 + maxInputChars 截断"保当前任务态。

**dsh-context-doctor（读维度量器）**：把进入上下文的静态注入变成可枚举对象——四段非重叠分类（instructions/skills/tools/mcp）、CJK 估算（ASCII/4 + 非ASCII/1.5）、跨文件完全相同块检测（≥40 字符）、同名技能 rank shadow（低 rank 胜出其余报被遮蔽）、MCP 跨 server FNV-1a 哈希去重、预算轨 + 阈值刻度可视化（`src/scan.ts`、`src/analyze.ts`、`src/tokens.ts`、`src/client/ContextAuditRing.tsx:33-35,280-292`）。

**dsh-session-surgeon**：诊断报告字段化——health 20 级分级、issue 带 line/frame/seqs 定位、inspect **明确不含用户正文**（隐私意识）、dry-run 计划预览（actions/mustWrite/refuse）。

### 2.2 LDVH 值得吸收的读维模式（按优先级）

1. **事实预热的"openwolf 形态"**（v5 里程碑 6 直接参照）：
   - 预算封顶 + 多源优先级（对应 LDVH：当前 WorkCase 摘要 > active ADR F1 卡 > 相关 Pitfall F2 候选 > 事实源索引指针）；
   - **只注入指针/卡片，不搬正文**（与 03 §8.3"预热只交付带来源与指纹的候选、卡片或恢复入口"逐字吻合——openwolf 用工程证明了这条红线的可行性）；
   - compaction/resume/新会话三种 source 分流（compact 时重注入恢复材料；resume 不注入因为历史完整——这个区分 LDVH 预热同样需要）。
2. **预算工程三件套**（infinite-context）：按路由模型取真实窗口、注入双上限、**把插件自身注入量计入水位**。LDVH 预热注入的 CJK 预算（study-absorption 已有此关注）应照此实现，且"只声明不执行"是它的反面（TokenBudget 仅 validate 不运行时强制）。
3. **注入框定语模板**：`<retrieved_context>` + "历史背景/可能过时/当前对话优先/不要复述" + 逐条 tier/时间/分数标签。LDVH F2 候选卡注入可用同构框架，把"这是候选不是结论"的语义直接写给模型。
4. **读后提示（post-execute hint）**：LDVH 的 Helper 读取若发现 AI 重复读同一规范/事实，可同样附"已读过（~N tok），F3 全文在本会话已取"提示；符号行号 + staleness 抑制（指纹不匹配就提示重新读）可平移为**事实 content_fingerprint 不匹配时的降级行为**。
5. **读维度量器**（context-doctor 平移）：specs/AGENTS.md 链 token 计量 + 段落重复检测（空行分块→改标题分块）+ L0–L4 rank shadow（同名规范多版本时报告胜出者）+ 预算轨。这补上 LDVH"控制上下文负担"判据目前**没有度量工具**的缺口；注意 rank 应从 L0–L4 分层现取而非硬编码。
6. **引用度保留信号**（brain-compaction/argp）：被引用的事实对象优先保留在预热候选中——LDVH 事实对象已有 relations 字段，"被 relations 指向次数"可直接作预热排序信号（且是确定性排序，不是概率召回）。

### 2.3 应避免的读维模式

- **摘要替代原文**（infinite-context）：检索只回摘要、原文已删、合并再失真。LDVH"AI 提炼输出永远是候选 + 原文回指"（read-dimension-understanding §8）是正解；其防失真三件（verbatim 清单/禁编造/摘要不缩小即拒绝+冷却）可吸收，路线本身不可取。
- **注入无回指**：infinite-context 库里有 source_session_id 却不注入——LDVH 预热卡必须带稳定引用与指纹（03 §8.1 已定义），这是现成的反面例证。
- **持久 user/message 注入制造 transcript 噪音**（infinite-context ARCHITECTURE.md:271-274 自述）：LDVH 预热若用 agent.inject/additionalContexts（如 openwolf）而非往事件流写消息，可避开此问题。
- **硬编码宿主词表**（surgeon known-types.mjs 手工同步 50+ 事件类型）：LDVH 08 规范要求宿主能力现取，不复制快照。
- **DOM 注入式 UI**（surgeon 的 MutationObserver 猜选择器）：DSH 前端升级即碎；LDVH Web 呈现走受支持 Slot（context-doctor 的 `conversation.input.right` 与 compressor 的 `conversation.session.header.actions` 都是正例）。
- **复刻而非读取宿主行为**（context-doctor 的 scanInstructionChain 用算法模拟 DSH 注入路径）：DSH 改注入规则即失真；LDVH 深度绑定路线应尽量读宿主真实状态（context-doctor 自己也把 `trimmed: unavailable` 显式承认，不冒充）。

---

## 3. 写维专题

LDVH 写维判据（specs/02 §7）：范围、身份、授权、当前基线、实际变化、回读和未验证范围可区分；机制指向受控写入与 CAS、Git 溯源。

### 3.1 各项目写维机制速览

**dsh-session-surgeon（写维教科书）**：
- 三重授权闸：CLI 显式 `--apply` / 工具参数 apply 默认 false / GUI confirm 弹窗（`plugin/client.js:219`）；
- 备份先行：`.bak.<utc>`（O_EXCL + 冲突随机后缀）→ fsync → `.tmp`+fsync+rename 原子替换（`src/encode.mjs:86-111`）；
- **修后回读验证**：重写后重新 decode，`eventsSeqOk` 不连续即抛错"原文保留在 .bak.*"（`src/repair.mjs:216-222`）；
- refuse 清单：header 坏/版本不符/退役字段/中间帧坏一律拒写；**不发明缺失数据**（"Never invents missing seqs in the committed middle"——缺失 seq 无原文，补了是伪造历史）；
- 字段化输出契约：`{plan:{actions[],mustWrite,refuse}, afterHealth, wrote, backup}`。

**dsh-openwolf（写维工程细节最扎实）**：
- 原子写：唯一临时名（pid+random）+ rename（`src/brain.ts:255-263`）；
- 跨进程锁：`.dshwolf/.lock` 目录锁 + 陈旧锁窃取（10s）+ 超时（`src/brain.ts:612-654`）；
- **托管块写入 AGENTS.md**（`src/render.ts:100-135`）：START/END 标记定位 → 幂等替换 → 文件其余部分逐字保留 → 内容相同则 no-op；
- 托管写入的对象化防护：时间戳备份 + `dshwolf restore` 回滚 + 全局项目注册表（`src/registry.ts`）；
- import-openwolf：**幂等增量合并**（additive、按内容去重、dry-run 预览、先备份）；
- 修复接口暴露给模型时带 dry-run 语义（`wolf_status` 读/写一体但 changed 字段区分）。

**dsh-context-compressor（"不碰原始数据"模式）**：原会话**只读**（仅读 events/surface），派生新会话承载摘要（`parentSession` 血缘 + 标题"· 续"）；忙态守卫（open turn / active compaction 拒 409）；写入 = create → append → flush 三步。缺陷：flush 前崩溃留孤儿会话、无幂等（连点确认建多个）。

**dsh-brain-compaction（旁路存储）**：压缩不改写原会话消息，只记 `compaction/summary` 事件（含 shadowed/checkpoint 前后对比叶子字段）+ `recall_pruned` 可原样恢复——**可审计、可回滚、不丢失**；Vault 写入必须显式 `memory_remember`，压缩不自动长期化。

**dsh-infinite-context（反面教材）**：合并即删 mid、遗忘即永久删除（无 tombstone）、consolidate 三步无事务、`mergedFrom` 只记 id 不记内容——合并后溯源链断裂。best-effort 写入异常仅 warn。

**dsh-context-doctor（严格只读 + 建议不动作）**：全程只读，suggestions 是文本建议，执行权留给 AI。

### 3.2 LDVH 值得吸收的写维模式（按优先级）

1. **Helper 受控操作输出契约照抄 surgeon 的形状**：每次受控写入返回 `{plan/actions（逐条列出将改什么）, mustWrite/refuse（要改/拒改）, actual_ref（实际回读入口）, afterState, backup/commit}`——LDVH 写维判据七个可区分项直接落成字段。surgeon 用 ~2500 行证明了这套契约在 DSH 上完整可行。
2. **dry-run 默认 + 显式 apply + confirm 的三重授权闸**：LDVH Helper 公开操作的写路径（create/update 事实对象）应同为默认 dry-run（prepare-draft 阶段）、显式确认才落盘；GUI 确认弹窗文案可参考 surgeon 的"将改写 X，并先留备份。确定？"
3. **备份策略分层**：surgeon 是文件级 `.bak`（单文件工具合理）；LDVH 是事实源级——**备份应由 Git 承担**（受控提交即快照，可 diff 可回退），这正是 LDVH 与 surgeon 的关键差异：surgeon 无 Git Gate，LDVH 把"备份-回滚"升级为"Git 溯源"。
4. **托管块模式**（openwolf render.ts）：LDVH 若需要在 AGENTS.md/README 维护生成内容（如管辖标记、索引指针），托管块（标记定位+幂等替换+其余保留+no-op 检测）是现成方案——但受保护文档（AGENTS.md 属指令链）必须走 06 的受保护文档合并承接，不能静默改写。
5. **跨进程锁 + 唯一临时名原子写**：多会话并发访问同一 `ldvh-base/` 时必需（openwolf 的陈旧锁窃取逻辑可直接参考实现）。
6. **"不发明缺失数据"原则**：repair 宁拒不编（缺失 seq/假 tool result）；LDVH Helper 同样**不得替 AI 补字段、造关系、填指纹**——v4 教训"关系闭集禁凭空猜"的机械贯彻。
7. **写维的隐私边界**：surgeon inspect 不含用户正文——LDVH Helper 的读取响应也应只交判断所需叶子字段，不整体 dump 事实对象（与 Cordis"不序列化活数据"纪律同构）。

### 3.3 应避免的写维模式

- **删除式转换**（infinite-context 的合并删 mid / 遗忘永删）：LDVH 事实对象退出走 03 的生命周期（retired 状态留档），不物理删除；任何"合并/替代"保留被合并对象的可回查记录。
- **无事务的多步写**：consolidate 的"插 long→删 mid→修剪"三步无事务，中途崩溃留半成品——LDVH 受控写入要么单文件原子（tmp+rename），要么显式两阶段（draft→confirm），不裸做多步。
- **best-effort 吞错**：写入失败仅 warn 继续跑——LDVH 写维失败必须如实交还（partial/unavailable），不得静默降级后声称成功。
- **孤儿产物**（compressor 的 create-后-flush-前崩溃）：LDVH 派生载体（如预热缓存、Web 投影）要么可清理要么可重入，不留不可达状态。
- **工具参数级授权冒充事实级授权**：surgeon 的 apply 参数证明"用户点了按钮"，不能证明"谁有权写这个项目的事实源"——LDVH 授权锚定管辖配置与 Human Gate，不锚定工具默认值。

---

## 4. 对 LDVH 的综合建议（映射 v5 里程碑）

### 4.1 里程碑 4（内核验证）——写维契约直接落地

- Helper CLI 的受控写操作采用 surgeon 形状的输出契约（plan/actions/mustWrite/refuse/actual_ref/afterState），配"健康输入必须 no-op"的验收测试（surgeon REPAIR-SPEC §4 验收表先例）。
- Git Gate 之外增加回读验证步（surgeon 的 eventsSeqOk 等价物 = 事实对象的 content_fingerprint 回读比对）——06 已定义，此处得到工程样板。

### 4.2 里程碑 6（DSH 绑定/记忆预热）——读维工程蓝本

- 预热注入走 openwolf 路线：`agent/session-start` 事件 + `agent.inject()`（带 plugin source 标记的 createUserMessage），digest 构建用"预算封顶 + 四源优先级 + 只注指针"；区分 compact/resume/新会话三种 source。
- 预算工程照抄 infinite-context 三件套（真实窗口/双上限/自身注入预留），但**运行时强制执行**而非仅 validate。
- 注入格式用 `<retrieved-candidates>` 框定语 + F2 候选卡逐条 `[type, 状态, 稳定引用, 指纹]`——与 03 §8.3"候选不当事实"红线一致。
- 被引用度（relations 入度）作预热排序信号——确定性排序，非概率召回。

### 4.3 插件五件套协调——brain-compaction 直接参照

- 组装层：单一 cordis.patch.yml 装五件套行，行级 disabled 裁剪；
- 协调层：零 import 运行时探测（ctx.get/tools.schemas），缺件降级不崩；
- 互斥仲裁：同一语义域（如"规范源读取服务"）单实例，工具重名注册期即抛；
- 统一验证入口（`ldvh_verify` 等价 brain_verify：五件套在场性矩阵 + 管辖状态 + 最近受控写入历史）+ 多 settings namespace 统一面板（scope 不可用自动隐藏小节）；
- 预设 persona 内嵌八维纪律（brain-compaction 把压缩纪律固化进 preset persona 的做法，对应 LDVH 把最小规则引导固化——但 LDVH 引导文本由规范源单一来源生成，不成第二规则源）。

### 4.4 08 规范（DSH 环境接入）——surgeon 的宿主知识直接输入

- goal 是日志内 `goal/change` 事件而非独立文件；续行权限不落盘（session-start 一律 disarm，显式 resume）；
- todo/write 无 id 整表替换，不可作 resume 句柄；
- 子代理 = 独立 session（parentSession + delegationDepth）；
- 会话 = append-only 事件日志（zstd 独立帧拼接），官方只自修 torn tail——**LDVH 不造第二数据库，事实写入以可回放事件留痕**。
- `agent/pre-step` 可重写 decision.messages（infinite-context 实证）——LDVH 预热的另一条注入通道，但注意其 transcript 噪音教训。

### 4.5 读维度量器（新增候选，优先级低于四支柱）

- context-doctor 架构平移：四段分类 → LDVH 注入面（规范引导/事实预热/模板提示/工具 schema）；段落重复检测（标题分块）→ specs 00–10 间重复规则检测；rank shadow → L 分层同名规范遮蔽报告；预算轨 → Web 呈现读维负担面板。**rank 从 L0–L4 现取，不硬编码**。

### 4.6 定位印证

六项目共同假设是"上下文是稀缺资源，压缩/索引/检索即可"；无一处理"AI 笃定但错误、人接不住偏差"（遵守/审议/复核维），无一有 Git 级事实溯源（除 surgeon 的文件级备份），无一有 Human Gate 概念。LDVH 的生态位判断（`docs/dsh-current-version-and-market-gap.md` 的市场差距）得到六个样本的一致支持。

---

## 5. 六项目分述摘要（不含 dsh-context，见 §5A 专述）

**dsh-openwolf**（MIT，v0.10.0，50 commits，hawk，最后提交 2026-08-21；src 4382 行 TS + 14 个测试文件）：移植自 Claude Code 版 OpenWolf v2.0.1（AGPL 参考项目仅读 tarball 理解机制、零代码复制的净室实现，复刻度 21/23，见 `docs/REPLICATION-REVIEW.md`；`docs/OPENWOLF-PORT.md` 有完整特征清单 A1–H3）。
- **脑目录 `.dshwolf/`**：`config.json`（每代理预算/重扫间隔）、`STATUS.md`（阶段交接，`## 🚀` 段喂 digest）、`cerebrum.md`（习得偏好/Do-Not-Repeat）、`memory.md`（动作流水）、`buglog.json`（bug 记忆）、`anatomy.md`/`anatomy-index.json`（项目索引）、`_session.json`（会话读写跟踪）、`token-ledger.json`、`cron-tasks.json`、`.lock`（跨进程锁）。
- **工具面**：10 个 `wolf_*`（map/file/refresh/scan/init/status/learn/bug/report/schedule）+ 自建 dashboard（127.0.0.1 + timing-safe token + SSE）+ 两个捆绑 skill（`wolf-security-audit` 四层审计、`wolf-reframe`）+ `dshwolf` CLI（init/scan/`--check`/report/bug/cron/register/update/restore/dashboard/daemon）。
- **安全测试四类**（`test/security.test.ts`）：路径穿越矩阵（绝对/父目录/编码/混合分隔符全拒）、秘密文件排除（.env/id_rsa/.npmrc 不入索引不入日志不入提示）、仪表盘鉴权（缺 token/错 token 拒）、源码审计（禁 exec/spawn 字符串、禁 shell:true）。
- **读写拦截**：DSH 无 pre-read 接缝，提示随 `tools/post-execute` 结果经 `additionalContexts` 附带回传。
- **对 LDVH**：读维渐进链 + 预热形态 + 托管块 + 原子写/锁的完整工程参照（详见 §2/§3）；注意其"AI 自由写 brain"（`wolf_learn`/`wolf_bug` 无准入查重、无指纹、无生命周期）恰是 LDVH 沉淀维要对治的（v4 教训：Spark 查重）；`import-openwolf` 的"幂等增量合并 + dry-run + 备份 + restore"是迁移工具的工程范本。

**dsh-infinite-context**：三 Cordis entry（memoryContext Service + MemoryCompactionEngine extends BasicCompactionEngine + tools）。三层金字塔（short 活会话表层/mid 压缩摘要/long 合并摘要）、SQLite+WAL、自研特征哈希嵌入（CJK 逐字）+ 线性余弦索引、遗忘打分（importance×w + recency×w，半衰期 30 天）。亮点：递归锁/失败冷却/surge 绕过/三层去重（精确+归一化+语义 0.92）。缺陷：接线层零测试、压缩删原文、合并删中间层、无审计回滚、short 层语义混乱（入库的全是工具结果而非近期原文）。

**dsh-brain-compaction**：七组件（argp/instant/headroom/vault/sgme/mcp-lens/routing-suite + 可选 context-doctor）组装 + 统一层（brain_status/brain_verify/brain_recall）。零 import 协调、引擎互斥（recall 重名）、统一面板多 namespace、15 项契约测试（行可解析/引擎互斥/compaction-basic 禁用/可分发性回归）。preset 分发（persona 纪律 + compaction 隔离组引擎行替换）。缺陷：引擎切换需重启、外部依赖组件默认禁用、仅契约测试无端到端。

**dsh-context-compressor**：POST 路由 + ctx.llm.stream（复用会话 system/tools 前缀命中 KV 缓存）+ sessions.create(parentSession) + append/flush。摘要当背景不当指令（`<compacted-summary>` 标记 + 前言）。多轮压缩把旧 checkpoint 当输入合并。小而美：全路径 smoke 测试、错误分级返回码。对 LDVH：摘要关键信息清单 → 沉淀维"跨行动保留判据"参考；parentSession 血缘 → 事实对象 sourceSessionId 字段设计；"只读原文 + 派生新载体"模式本身是 Output Envelope 会话接力的同类形态。

**dsh-session-surgeon**：零依赖、双入口（CLI + 插件）。四层文档纪律（PLAN/SESSION-FORMAT/REPAIR-SPEC/IMPLEMENTATION-CONTRACT，全部"对照官方实现整理"）。修复规格先行的典范；fixtures 程序化合成 5 类损坏样本 + 自检；官方包对照测试失败 skip 不破 CI。自更新 skill（社区反馈吸收 → 代码/测试/CHANGELOG → 推送）含"永不"合同清单——LDVH Stop Conditions 的同构物。缺陷：DOM 注入 UI、手工词表同步、截断修复的 GUI 预览不透明。

**dsh-context-doctor**：只读审计。AGENTS.md 链发现（git root 向上逐层）、ctx.skills.list、ctx.tools.schemas（MCP 按命名解析）、启发式 CJK token、完全相同块检测、rank shadow、MCP 跨 server 重复。agent-setup.md 是"让外部 agent 帮你装插件"的引导文档范本（LDVH AI 工作引导的同类形态）。诚实边界：`trimmed: unavailable` 显式承认不推测。缺陷：仅完全相等匹配、token 估算简化、复刻宿主行为而非读取。

---

## 5A. dsh-context 专述（第七个项目，应 Human 要求增补）

### 5A.0 项目概况

| 维度 | 现状 |
|---|---|
| 定位 | "Agent context insight and management"——上下文洞察与管理：**Context tab 仪表盘 + `/context` 斜杠命令**（bowenliang123/dsh-context，Apache-2.0，npm 已发布） |
| 版本/规模 | v0.40.1；host 10 模块（fold.ts 910 行为最大）+ client 30+ 模块（browser.tsx 1107 行）+ shared 3 模块；63 个 spec 测试文件 |
| 开发史 | git 历史仅 2026-08-29 至 09-01 三天 50 commits——高强度压缩开发，但 AGENTS.md/测试矩阵/兼容基线的成熟度远超时间跨度（版本号 0.40.1 暗示 npm 发布多轮） |
| 文档 | README 152 行带九张截图；**AGENTS.md 433 行是该插件生态里见过最严格的工程宪法**（见 5A.6） |

与 dsh-context-doctor 的关系：**互补而非竞品**。context-doctor 审计"静态注入物"（AGENTS.md 链/技能目录/工具 schema 的 token 与冲突）且复刻宿主扫描路径；dsh-context 观测"动态全貌"（每个请求实际组装了什么、何时为何变化、谁生产了每个工具）且直接读宿主投影与事件日志。前者偏快照体检，后者偏全时序活体监测——两者合起来才覆盖 LDVH 读维"负担可控"判据的度量面。

### 5A.1 DSH 接入机制（代际差异：投影单元架构）

这是七个项目中**唯一不用"自定义 RPC/路由轮询"而完全押注 DSH 原生 Session Projection 管道的**：

- **Host 半区**（`src/host/index.ts:27-46`）：`inject = ['sessionProjections']`（Cordis 门控：注册表不存在则插件 inert——安全降级）；在 `ctx.sessionProjections` 注册**两个纯投影单元**：
  - `contextTimeline`（`timeline.ts:1-219`）：把会话持久事件日志折叠成逐请求的上下文组成时间线；`apply` 每条 committed `session/event` 增量驱动、`Object.is` 引用稳定门控变更推送、状态持久化走投影缓存（checkpoint 行、冷读梯子、resume 安全）；
  - `contextHeaders`（`headers.ts:1-199`）：请求头 epoch 元数据（epoch 边界、逐工具 token 价格、插件归因）——**故意不存内容**（系统提示词全文/工具 schema 全文）：投影值随每个 session.list 行/推送帧/变更通知复制，存内容会乘以 sessions×epochs 爆炸；客户端按需 seq 锚定 history read 取内容（历史不可变，缓存永续）。
- **Client 半区**（`src/client/index.ts:73-117`）：四个 Slot——`conversation.view`（Context tab，与 Chat/Trajectory 并列）、`conversation.chat.assistant-actions`（回复旁"跳到该轮上下文"按钮）、`conversation.input.overlay`（`/context` 模态）、`settings.plugin.item`（设置卡）；数据经框架标准 `useProjection('contextTimeline')` 座位读取——**零轮询、零自建缓存通道**。
- **`/context` 命令**（`command.ts:20-53`）：客户端自有 '/' 触发源注册（`inputTriggers.registerSource`）——**不派发 host、不写会话日志、不进模型视野**；开模态时把 token 留在输入框，关闭时经 `scope.bail('slash/input-consume-token')` 消费（span CAS 防草稿竞争）。
- **共享类型**（`shared/types.ts:14-52`）：经 `declare module '@deepseek-ai/dsh-session-projection/types'` 的 declaration merge 把两个投影键注入框架类型系统（`SessionProjectionMap` + `SessionProjectionStateMap`）——与 infinite-context 给 `ctx.memoryContext` 做类型增强同一模式。

fold 消费的事件分派（`fold.ts:581-761`）：`request/header`、`request/context`、`tool/call`、`step/start`、`step/end`、`user/message`、`tool/result`、`assistant/message`、`plan/mode`、`compaction/summary`、`compaction/prune`——注意 fold 用结构化放宽信封而非依赖 `dsh-compaction` 包（插件合并词汇表不在核心 union 里，`fold.ts:36-46`）。

### 5A.2 上下文洞察模型（核心）

**展示面**（README:41-122，九卡片）：Context Stats（turns/steps/工具调用/图片/成本估算）、Token Stats（cache read/write/uncached/output 绕 cache 命中环）、Timing Stats（模型调用/工具运行/开销的活跃时间分配）、Current Context（**六色堆叠条**：system/tools/user/inject/assistant/tool 各占多少 vs 模型满窗，斜纹=余量）、Context Trend（**每请求一条堆叠条**+步骤简述三行：User/In/Response，点击跳浏览器）、Context Browser（任一请求实际组装内容的展开浏览）、Context Events（inject/compact/prune/switch/mode 五类窗口变更事件，带生产者标签与净 token delta）、File Activity（读/写/搜过的文件、行增删、每文件操作日志）、Agent Network（agent 家族图谱，环=该会话组成对窗口占比，点击跳入该会话自己的 Context tab）。

**关键口径决策**：
- **与宿主同口径**：headline 占用与组成读**官方 token-meter 投影**（`contextPressure`/`contextBreakdown`——与聊天 composer 的上下文环同源，`README:59`）；估算公式复刻 `dsh-token-meter/estimate.ts`（~4 字符≈1 token + 块/角色开销，`shared/estimate.ts:9-15`、`host/pricing.ts:17-25`）——**数字永远与官方环一致**，不自创口径；
- **图片唯一例外**：官方 meter 的通用 JSON 分支给图片 ~40 token，而 DeepSeek Vision 实际按像素 117–384 token 计费——`shared/imageTokens.ts` 移植官方 docs 计算器，尺寸未知时回退 JSON 价（`pricing.ts:66-70`）；
- **估算 vs 实际双轨**：类别数字用启发式，固定（pinned）趋势详情与 Token/时序环展示 provider 报告的实际值（README:142）；
- **成本**：定价表来自列表价（hover 显示每 1M 费率）。

**归因模型**（写维视角的前置能力，四层链 `attribution.ts:31-48`）：
1. 名字派生 `mcp:<server>`（dsh-mcp-client 命名规范 `mcp__<server>__<tool>`，`toolSources.ts:23-46`）；
2. **运行时钩子**：监听 Cordis `internal/get` 水瀑事件捕获读取 `tools` 服务的上下文 fiber 名（即即将调用 register 的插件），包装 register 捕获注册者；匿名入口（本地 link 安装）回退**调用栈解析**（栈帧上溯最近 package.json name）；
3. 引导前已注册工具：pinned 一线包名映射表（0.1.1-rc.2 官方工具目录快照）；
4. 兜底 `UNKNOWN_TOOL_SOURCE` 哨兵——诚实区分"无插件"与"未知插件"。
全链 best-effort（读与注册间隔 await 可能误归因，自承 `attribution.ts:42-48`）。

### 5A.3 读维视角（对 LDVH 的直接价值）

这是七个项目中**"信息可回指性"做得最好的**——LDVH 读维判据"实际使用的信息可回指来源"在它的 UI 里被完整实现：

- **任何数字可下钻到内容**：六类组成→每元素 token→展开即**实际内容**（系统提示词全文/工具 JSON schema/消息文本/推理/工具参数/工具输出原文，Raw/Markdown 切换，README:82-96）；
- **任何趋势条可定位到步**：点击 pin 完整分解（估算 + provider 实际值并排）；hover 趋势条实时联动浏览器预览该步组装内容（README:80）；
- **任何事件可指到生产者**：注入/压缩/剪枝带生产者（指令文件名/插件 id/技能名）与净 delta（README:100-104）；
- **任何文件操作可跳到工具结果**：File Activity 行展开逐操作日志，每个 op 直跳浏览器中该工具结果（README:116）；
- **压缩后近似诚实标注**：压缩前旧步从移除消息档案重建，卡片明示"该步组成仅为近似"（README:98）。

**给 AI 还是给 Human？**——纯 Human 侧：零模型工具、命令不进会话日志不进模型视野（`command.ts:5-11`）。这与 context-doctor（给模型 `context_audit` 工具）形成互补分工。

### 5A.4 写维视角

- **纯只读插件**：不压缩、不改会话、不写任何事实——写面只有用户设置卡（三个偏好项，原生 settings scope）；
- 投影单元是**纯函数**（init/apply/view 无订阅不触 client），状态有界（按整轮修剪、epoch 上限 50）、必须 plain JSON（投影缓存前提——一个 undefined 值属性会让该会话**所有**投影缓存写失败，`AGENTS.md:373`）；
- **`stateVersion` 治理纪律**：版本递增使全部缓存行失效且 idle 会话无刷新通道（#37 回归教训）——headers 把版本钉在 1 并让持久态收窄为超集（v1 内容行照读、新写只记元数据，`headers.ts:19-29`）；timeline 升到 11，每次递增原因都有注释记录。这是"持久态 schema 演进不破坏旧缓存"的工程范本。

### 5A.5 对 LDVH 的参考价值（重点）

**(a) 投影单元架构是 LDVH Web 呈现（10 规范）的首选数据通道**：
- LDVH 的 Web 信息呈现若自建 HTTP 轮询即踩"浮层+轮询"红线；dsh-context 证明**纯投影单元**（声明式注册、框架驱动折叠/持久化/推送、客户端标准座位消费）可承载完整仪表盘——这正是 10 规范要的"宿主原生体验"；
- **元数据/内容分离**模式对 LDVH 事实预热同样适用：投影值只带稳定引用与指纹（F0/F1 卡），全文走 seq 锚定按需取（F3/F4）——恰好是"预热只交候选"的数据面实现；
- declaration-merge 类型注入是 LDVH 声明自己的投影键的现成模式。

**(b) 与官方口径同源**：LDVH 读维度量若自创 token 口径，数字与宿主环打架会自损可信度；dsh-context 的"直接读 contextPressure/contextBreakdown 投影 + 复刻 meter 公式 + 图片唯一例外并注明"三层策略可整套照搬。**其 CJK 盲区**（4 字符≈1 token 对中文偏保守）提示 LDVH 若引入自己的 CJK 估算（study-absorption 已有此计划），须像它处理图片一样显式标注偏离口径的理由。

**(c) 归因模型支撑 LDVH"证据边界"**：LDVH 交还要求"已证实范围"可回指；dsh-context 的四层归因（名字派生→运行时钩子→pinned 快照→unknown 哨兵）+ "诚实区分无/未知"的兜底，是"best-effort 归因不冒充确定"的范本。LDVH 的 Web 呈现要标注"哪个规范源/事实源注入了多少 token"时，直接需要同款归因链。

**(d) HV4 效用审计的能力基座**：LDVH 已知能力缺口"事实对象效用审计"（specs/02 §13 边界：HV4 缺口不提前定义）——dsh-context 的 per-request 时序 + per-tool 归因 + provider 实际值 + 成本 + agent 网络就是现成的**度量基座**：在它之上叠加"LDVH 注入物（规范引导/事实预热卡）的 token 与命中追踪"，即得"哪些事实对象被消费了多少"的效用证据。LDVH 不必自建时序/成本/归因管道。

**(e) 工程纪律范本（AGENTS.md 宪法）**：
- **解析韧性信条**（`AGENTS.md:368-376`）：插件活在"不属于自己的数据"上（跨版本事件形状/手工重放/敌意对象）——每条坏记录降级为零行而非搞挂视图；host 投影折叠必须 TOTAL（一个 throw 永久卡死该单元推送）；客户端边界净化（集合重证、标量归零、缺值保持 null→loading 态）；**每个解析器配敌意 fixture，100% 覆盖率适用于每个守卫分支**——"未测的守卫是未兑现的承诺"。这套信条就是 LDVH Helper 读取边界（partial/unavailable 如实交还）的 UI/数据面镜像，可直接写入 09 Code 实践规范的测试纪律；
- **兼容基线单一事实源**（`tests/baselines.ts`：SUPPORTED_BASELINES + 每版本 seam face 表；加新版本=加一行 entry 跑矩阵，失败探针**点名 seam**）；真源码矩阵测试（真实 dsh registry + 各 baseline tag 的真实源码启动构建产物）——LDVH 的"宿主能力现取、版本钉扎"（08）正需要这种矩阵化验证而非散点兼容声明；
- 100% 文件覆盖率红线 + "最小改动/最高性能"编码纪律 + 发布由 tag 触发 workflow 全自动。

**(f) 应避免/警惕的设计**：
- **pinned 一线工具映射表**与 context-doctor 的 rank 表同病：宿主演进需人工同步（它至少把"names stable across supported range"声明为前提并把矩阵测试挂在基线上）；
- `internal/get` 水瀑包装 register 的**深度侵入**（+1.4µs/读，自评可忽略，但这是框架内部协议，非公开 API 契约）——LDVH 若需要同款归因应优先等官方暴露注册者字段（其 toolSources.ts 第 1 层正是为此预留的"未来 harness 字段直通"位）；
- 版本 0.40.1 与三天 50 commits 的**爆发式开发**：无长期维护记录可评估（与 openwolf/surgeon 的持续演进史不同），成熟度判断只能基于当前代码质量；
- 图片/`str_replace_editor`/PTC `run_code` 等大量**按宿主形态特判**的归并逻辑（fileActivity）——宿主形态变化时的维护热点。

### 5A.6 证据清单（dsh-context，主控第一手核验）

| 结论 | 证据 |
|---|---|
| 投影单元架构 + inject 门控 | src/host/index.ts:27-46；cordis.patch.yml:1-6 |
| contextTimeline 定义与 zod wire 校验 | src/host/timeline.ts:1-219（stateVersion: 11 见 216） |
| headers 元数据/内容分离 + #37 教训 | src/host/headers.ts:19-33（stateVersion: 1 见 196） |
| fold 事件分派 11 类 | src/host/fold.ts:581-761；结构化放宽信封 36-46 |
| 归因四层链 + best-effort 自评 | src/host/attribution.ts:1-80（特别是 31-48 注释）；toolSources.ts:23-60 |
| 估算与 meter 同口径 + 图片例外 | src/shared/estimate.ts:9-15；host/pricing.ts:1-25,66-70 |
| client 四 Slot + /context 不进日志 | src/client/index.ts:73-117；command.ts:5-53 |
| declaration merge 类型注入 | src/shared/types.ts:14-52 |
| 官方投影同源声明 | README.md:59,142 |
| 六类组成/浏览器/事件/文件活动/agent 网络 | README.md:61-122（九卡片区） |
| 解析韧性信条与 100% 覆盖红线 | AGENTS.md:368-376,359-366 |
| 兼容基线单一事实源 + 矩阵测试 | tests/baselines.ts:15-45；AGENTS.md:391-397 |
| 63 spec/三天 50 commits/v0.40.1 | find tests -name "*.spec.ts" \| wc -l；git log 实测；package.json |

---

## 6. 证据与未验证范围

### 6.1 已证实（主控第一手核验）

- 七仓克隆于 `/Users/dmh2002/DshProject/`，版本/规模/commit 数/日期见 §1 表（package.json + git log 实测）。
- 接入面矩阵（§1）来自对前六仓 src 的直接 grep（ctx.on/ctx.tools.register/ctx.slots.inject/webServer.register/ctx.llm/ctx.sessions.*）；dsh-context 接入面见 §5A.1 专述。
- openwolf：digest 四源优先级与预算封顶（digest.ts:86-143）、读后提示与 staleness 抑制（index.ts:440-493）、注入消息 source 标记（index.ts:156-163）、compaction 生存（index.ts:304-314）、托管块（render.ts:100-135）、原子写/锁（brain.ts:255-263,612-654）、wolf_* 10 工具、import 幂等合并与备份/restore（import-openwolf.ts、registry.ts）、安全测试四类。
- infinite-context：pre-step 截获与消息重写（memory-compaction.ts:1236-1330）、窗口采纳与双上限（1296-1299）、注入框定与 tier/score 标签（VectorRetriever.ts:235-304）、摘要指令 verbatim 清单（216-232）、SQLite schema 含溯源列（memory-store.ts:68-94）、失败冷却与"摘要不缩小即拒绝"（588-596）、遗忘打分（forgetting.ts:19-38）。
- brain-compaction：七组件表与零 import 探测（integration.ts:5-100）、session/event 记 compaction/summary 叶子（host/index.ts:46-59）、统一面板多 namespace（src/client.js:553-554）、preset persona + compaction 隔离组（preset/）。
- context-compressor：路由/命名空间/摘要提示词/框架标记/血缘/忙态守卫（lib/index.js 相关行，子代理报告与 README 双证）。
- session-surgeon：SESSION-FORMAT 帧拼接/seq 语义（docs/SESSION-FORMAT.md）、REPAIR-SPEC 修复步骤与不发明原则（docs/REPAIR-SPEC.md:60-115）、IMPLEMENTATION-CONTRACT 硬约束（docs/IMPLEMENTATION-CONTRACT.md:10-55）、三工具注册 apply 默认 false（plugin/index.mjs:61-113）、自更新 skill 合同（skills/*/SKILL.md）。
- context-doctor：scan 三函数（scan.ts:41-228）、CJK 估算（tokens.ts:9-17）、rank shadow（analyze.ts:95-124）、只读定位（README 安全边界段）。
- dsh-context：投影单元架构/inject 门控（host/index.ts:27-46）、timeline 定义（timeline.ts:1-219）、headers 元数据分离与 #37 教训（headers.ts:19-33）、fold 事件分派（fold.ts:581-761）、归因四层链（attribution.ts:31-48、toolSources.ts:23-60）、估算同口径与图片例外（estimate.ts:9-15、pricing.ts:17-70）、client 四 Slot 与 /context 不进日志（client/index.ts:73-117、command.ts:5-53）、declaration merge（shared/types.ts:14-52）、解析韧性与兼容矩阵（AGENTS.md:368-397、tests/baselines.ts）。dsh-context 子代理报告与主控核验交叉印证一致。

### 6.2 未验证/残留风险

- 七仓均为克隆快照，未运行其测试套件（结论基于源码阅读，非执行验证）；各仓 CI 状态、npm 发布物与仓库一致性未核对。
- 子代理报告中的行号引用未逐条复核（抽样核验一致，但个别行号可能有 ±数行漂移）。
- 各项目在真实 DSH Desktop 2.0.4 上的兼容性未实测（context-doctor 声明 rc.6/rc.2 验证过，surgeon 对齐 rc.6，dsh-context 声明 0.1.1-rc2+/0.1.2-alpha2+，其余未知）。
- openwolf 的 npm 下载量/stars、七项目的社区活跃度（issue/discussion 质量）未纳入评估。
- dsh-context 的 git 历史仅三天（2026-08-29 至 09-01，50 commits，v0.40.1）：可能是 squash 合并或仓库重建，长期维护轨迹不可据此评估。
- 本报告为设计输入，不构成对任何机制"已在 LDVH 实现"的证明；吸收项落 20–24/30–38 规范前需按行动基线做端到端走查（read-dimension-understanding §10.5 同款要求）。
