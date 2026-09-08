# Spark 与 WorkCase 重建总纲（唯一讨论锚点）

> 性质：讨论工作稿 + 调研收敛文档（非规范、非事实对象）。
> 地位：**本文是 Spark（20 号）、WorkCase（21 号）、Goal（25 号）重建的唯一讨论锚点（Initiative 26 号已砍除——裁定 13）**——Human 指令（2026-09-06）：相关讨论此后只通过本文档展开，不再另开分散报告。
> 来源：收敛自已删除的九份文档（Spec Kit 调研、五 DSH 生态项目调研七件、v5 机制地图）+ v4 深读 + 本线架构问答。
> 收敛时间：2026-09-06；**2026-09-08 更新：事实对象架构定稿 v2 并入（§5，Human 基本认可）**。关键证据携带源仓库路径（六个迁出快照仍在 `/Users/dmh2002/DshProject/`，见 §11），file:line 可复核。

---

## 0. 一段话总纲

v4 用 24 天（103 Spark + 152 WorkCase）验证了「项目尺度治理」可行但死于自身重量；Spec Kit（133,595★）验证了「feature 尺度生成纪律」的市场；五个 DSH 生态项目从不同方向证明「单元端点治理」是全生态的结构性空位。三场调研拼合后的结论：**LDVH 的成立条件 = 用 Spec Kit 级的轻，做 v4 级的治理**。2026-09-08 架构问答收敛出完整方案（§5）：**一个锚（goal）、一条分解链（sub-goal→WC）、一间候诊室（Spark）、一个知识库（ADR/Pitfall/Research）、一张规划面（蓝图）**——七类型 + 蓝图特殊载体，每层一个职责、一种变化频率、一组消费点。

---

## 1. 三层概念图（v3，裁定 13 砍 Initiative）

```
goal.md          为什么 · 算成什么样          1 个｜年+ 尺度｜冻结（改动=Human Gate）
   │             目标陈述 + sub-goal SG-n 子目标锚点（锚点永不换号）
   ▼
WorkCase        执行件：授权·执行·验证·残留     多个｜天/周尺度｜Gate 1 必引 sub-goal 锚点
   │             Gate1 授权 → 执行 → 复核 → Gate2 关闭（四态终态）
   ▼
任务勾选         今天做什么                    WC 内部（T 编号 + [P] 并行标记 + 勾选）

Spark 横切全部层级（Goal 层方向疑问 / WC 层执行发现的候诊室）
BLUEPRINT.md = goal + active WC + open Spark 的投影（唯一 authored 规划区）
```

- **引用链（机械可查）**：`WC → sub-goal（serves: SG-n）→ goal`，每级只引上一级，不跳级。
- **粒度错位的实例证据**：v4 是 24 天 152 个 WC（日均 6 个），领域分布几乎全是维护性工作，没有一个是产品意义上的 feature；Spec Kit 的 feature 是数天级产品能力单元。sub-goal 吸收产品轴（feature ≈ SG-n 的产品语义特例——feature 直接 serves 某条子目标）与专项轴。
- **Spark 对应的空位**：Spec Kit 完全没有「悬置想法」层——想法只存在于聊天里。六样本光谱里另一个无人占据的位置。
- 谱系考古：`.trae/specs/`（本机 Trae 时代 v3 原型遗物，OpenSpec 格式族）显示 Task 轴（acceptance 勾选清单+独立 agent 验证）在 Trae 时期已被 Human 自己搭过——分层概念是长期演化结果，非新发明。

---

## 2. v4 证据库（24 天真实运行，仓库只读快照）

### 2.1 WorkCase 机制全景（v4 specs/21，1178 行）

- **生命周期**：对象外 Human 意图选择 → 受控创建（defs 全 pending、phase=human_plan_confirming）→ Gate 1 批准（写 execution_approval + baseline_fingerprint）→ executing（字段禁改 + 依赖拓扑）→ controller_checking（结果投影）→ independent_reviewing（subagent 复核）→ closure_preparing → human_closure_confirming → 原子 close（21:282-510）。
- **Gate 语义**：单次运行只有**两次**主动 Human 确认——Gate 1 = 计划+完整授权基线一次执行决定；Gate 2 = 复核后结果+完整关闭提案一次关闭决定；两 Gate 之间不得新增 Human Gate（21:30）。
- **状态闭集**：open/blocked/closed；phase 闭集 8 值；closed 不可重开（21:402-477）。
- **终态分类**：closure_outcome = completed / partial / not-achieved / cancelled，必须与 criterion results 一致；cancel 不得写成 completed；剩余责任落 residual_responsibilities（21:285, 32:178）。
- **授权包**（v4 最重的机制）：authorized_actions（逐项 target/effect/risk/rollback/rule_refs）、quality_gates、action_ceiling、prohibited_actions、allowed_adjustments、verification_and_rollback、out_of_bounds_handling、human_prerequisites；Gate 1 后以 SHA-256 baseline_fingerprint 冻结（21:580-598）。

### 2.2 Spark 机制全景（v4 specs/20，290 行）

- **准入六条件**（20:75-86）：跨行动有保留价值 / 无现有位置可自然承载 / 尚未形成明确目标/决定/经验/研究 / 可表达为单一可判断的信息单元 / 已召回查重 / intent-summary 据实表达。
- **字段三分工**（20:126-151）：`intent`（为什么保留+待判断什么，稳定不改）／`summary`（完整当前语义快照，后续执行者可脱离原聊天恢复）／`evolution`（1-20 条关键转折，每条只记「变化+影响」）。归位顺序固定：当前仍要用的内容进 summary，仅解释摘要为何变化的进 evolution。
- **三态**：open（priority 必填）→ implemented（落实或交给 WC，**只结束入口职责，不代表下游完成**）/ discarded（决定不追，无承接目标的终态）。关系闭集仅 related-to；routed-to 已废除（18 个 legacy 只读）（20:159-189）。
- **重量病灶**：25 条 Stop Conditions（20:260-288）为一个「记想法」的类型配 25 条暂停条件——v4 重量病晚期症状。
- **spark-0040 实例**（v4 最重要的 open Spark，116 行）：知识激活主线——v0.2 否定 L0 产品化 → v0.3 否定 L1-specific 触发 → v4 否定「补字段」→ 方向上移「知识激活」三层框架（召回主动化/呈现行动化/效用闭环）。跨 17 天、5 个 AI 运行时（Cindy/codex/claude-code/WorkBuddy/DSH）接力，四轮实验结论链浓缩在一个文件里——「进展不因切换而断裂」的真实形态。其根因分析（F2 候选卡告诉模型「这是什么」而非「这对当前行动意味着什么」）**正是 v5 记忆系统（12 号预留）的需求陈述**。

### 2.3 实例数据（真实文件统计）

- 体量：workcase 43-244 行（均值 ≈121/152 份）；spark 20-156 行；adr 37-38 行；pitfall 39-40 行；study 66-448 行。
- **如实失败的实证**：workcase-0068 以 partial 关闭，如实记录「criterion-02 not_satisfied / response_bytes 缺失 / 临时文件越界 / candidate 非法 JSON」+ 3 条 residual_responsibilities——机制真的允许并要求诚实关闭。
- **规范重实例轻**：21 号 1178 行 vs 实例均值 121 行（大量 43 行）；152 个 WC 中相当比例未呈现完整质量链。
- **backfill 之痛**：change_log 大量是迁移流水（补 object_uid、UUIDv7 迁移、时间戳加引号、补新必填字段）——字段契约每次变动，成本摊到所有旧对象。
- 仪式残留：specs 35-38 四份模板各含重复验证表（编辑残留）；priority 字段 open 后即废弃；跨对象重复的迁移审计签名。

### 2.4 三大优点 / 三大痛点（均经实例证实）

| 优点（必须保住） | 痛点（必须治好） |
|---|---|
| ① 防自欺设计密度：每份模板内置「把 X 冒充 Y 即 Stop」（命令成功≠commit 完成、F2 卡≠相关性证明） | ① 规范体积/维护成本：25 份规范 9314 行，同一语义跨文档重复（「补造 review 追认」出现在 21/31/32） |
| ② 如实失败机制：四态终态 + residual_responsibilities + validation_summary（0068 实证） | ② 字段演进→存量对象持续补写（backfill 流水淹没 change_log） |
| ③ 两级 Human Gate + SHA-256 授权冻结：同时拦住「假传圣旨」和「假完成」 | ③ 仪式残留与真实执行脱节；研究→执行断层（同一问题多次开 Spark：价值审计 3 次、Hook 架构 3 次、署名 5 个、独立审核 5 个） |

---

## 3. 生态证据库（六样本光谱，2026-09-08 五仓调研）

### 3.1 光谱（AI 治理强度轴）

| 项目 | AI 治理强度 | 状态持久 | 规模/成熟度 | 一句话 |
|---|---|---|---|---|
| dsh-openspec | 零（纯提示词） | 零（无运行态） | 101 行逻辑，v0.0.2 | OpenSpec 技能搬运壳；delta spec 模型（main+delta→sync）是唯一可参考点 |
| Spec Kit | 极薄（路径脚本+勾选框） | 勾选框+feature.json 单指针 | 133,595★，v1.0.4 | 提示词即流程；10 命令链；v1.0.4 已原生集成 DSH（`.dsh/skills/` + `dsh --profile headless`） |
| dsh-specflow | 薄（读+解析+goal 桥） | tasks.md 复选框+goal 前缀 | 746 行，v0.1.4，CI+兼容矩阵 | 最小可恢复闭环；goal 桥三态（无→create/disarmed→resume/异对象→拒，index.ts:147-157,260-272） |
| spec-driven (keel) | 中（纯机械表单门禁） | 工件文件三件套 | 2564 行，101 测试，v1.0.0 | 哲学与 LDVH 最近；19 条 KEEL-XXXX 规则 ID 结构化输出 {rule,severity,line}（review.ts:16-49） |
| dsh-spec-loop | 中（validator+审批门） | **事件折叠会话投影**（零自定义事件，重启重算） | **已死**（仓库删除，仅商店缓存 README） | 最 DS-native 状态机 + 死亡警示：预览期宿主深耦合维持成本 |
| dsh-spec-collab | **厚（requireHuman 四层机械门）** | Git 仓库+协作账本 | 3972 行，88 单测+10 e2e | 含金量最高；机械 AI 权限门+commit 钉扎失效 |

### 3.2 端点空位五重印证（Human「feature 积累」裁定的外部验证）

| 项目 | 单元关闭时做了什么 | 缺什么（LDVH 的位置） |
|---|---|---|
| openspec | verify→sync→archive，全靠自觉 | 无 Gate 2、无事实沉淀 |
| specflow | goal complete + 逐条 AC 审计，**零沉淀** | 端点完全空置——最干净的接入缝 |
| keel | AUDIT 归档 + 复盘进下轮锚定（有沉淀萌芽） | agent 自述审计、无独立复核、散件无累积 |
| spec-loop | delta 机械并入主规格 + 全量归档 | 无筛选（违反 v4「不保留过程流水」）、无 Gate 2 |
| spec-collab | 六门机械封口 + sha256 ReadyPackage | 止于 Ready 明确不做下一跳 |

**结论**：生成纪律各显神通，端点治理无人问津——LDVH 是光谱之外的第七格。

### 3.3 关键部件（已验证可组合）

**spec-collab requireHuman 四层机械门**（wc-62 的机械正解，全部代码强制+有测试）：
1. 动作级白名单：改正式状态的动作全部 `requireHuman(participant)`，AI 直接 throw（engine.ts:716 及 15+ 调用点，engine.spec.ts:172-176）；
2. AI 只有三条「只追加」通道：submitReview（结构化发现）/ submitPatch（pending 候选 patch，接受必须 human 走 patch.accept）/ submitAiReply——工具描述明示 "creates a reviewable candidate only; it never writes Git"（tools.ts:39-80, engine.ts:120-155, 288-301）；
3. commit 钉扎 + 过期失效：AI 提交必须命中当前 commit（engine.ts:123,140），基于旧 commit 的 patch 自动 stale（engine.ts:296）；scope 变化即 invalidate 并生成 reconfirm 待办（engine.ts:776-785）；
4. 身份角色绑定：AI 身份由 sessionId 派生，human 首次写入即绑定不可自换（engine.ts:100-101）。
**局限（如实）**：门卫只保护其规格账本，不保护 AI 会话的文件系统；loopback 信任非身份认证；sessionId 自报无强校验。

**keel 三件**：规则 ID 稳定引用（违规输出带 ID+行号+建议，Git Gate 可仿）；**规模变体**（微/常/大三档模板，同门禁不同工件——「微任务也要过门禁，只是工件更小」，spec.minimal.md:10，095 的正面解）；共享核心+双壳（插件 apply 与裸 CLI 复用同一实现，cli.ts:10-11，检查面可进 CI）。

**spec-loop 两件**（设计文档级证据，降权使用）：事件折叠状态机（运行态从标准事件日志重算投影，零自定义事件——02 §5.4「运行状态不自动进事实源」的最 DS-native 实现）；门与显示同源投影（Web 呈现读行为门同一载体，显示与行为永不分离——10 号的实现不变量）。

**Spec Kit 关键机制**（详见 §8 吸收账）：clarify ≤5 问+可答形状约束；plan Phase 0 未知项→研究子任务；checklist「英文单元测试」（问句清单代替 schema 校验）+reviewer-owned 勾选权（implement 明文 MUST NOT 标 [x]）；converge APPEND-ONLY 收敛核对；Done When 三勾收尾；Constitution 的 Sync Impact Report + 语义化版本；tasks.md 勾选框+T001 编号+[P] 并行标记。

### 3.4 生态警示与证据局限（诚实边界）

- spec-loop 已死：外置插件深度绑定预览期宿主，三条平台绕路（零自定义事件/ctx.shell 代 fs/重启加载）每条都可能断——LDVH 发布路线要版本钉扎+兼容区间声明+**自移除安全**（沉淀物不依赖插件存活；LDVH 事实源在 Working Tree+Git 天然满足，应显式写进 08）。
- 五项目全部早期（≤20 commits）、采纳度普遍 uncertain——「机械路线可行」单点证明成立，「被大规模验证」不成立（后者仍只有 v4 自己 24 天）。
- spec-loop 证据仅缓存 README，其机制结论不可当已验证实现引用。
- DSH 生态窗口期真实：规格驱动工具一死五存全早期，LDVH 工程标准（260 测试/fail-loud/双 profile 验证）直接就是差异化。

---

## 4. Human 裁定记录（决策史，逐条保留）

| # | 时间 | 裁定（原话/要义） | 效果 |
|---|---|---|---|
| 1 | 2026-09-06 | 「有价值的东西可以吸收进来」 | §8 吸收账确认执行 |
| 2 | 2026-09-06 | 「**长程项目是一个一个 feature 积累起来的**」 | feature 是积累单元；生成纪律可由外部工具承担，**单元端点的治理（完成→沉淀→累积）属于 LDVH**；项目级总览 = 历次单元沉淀的累积投影，不是另建视图。后获五项目独立印证（§3.2） |
| 3 | 2026-09-06 | 「你是不是还不了解v4」（点破主控盲区） | 概念早已存在：feature↔WorkCase 谱系相接，21 号是迁移矩阵既定首批重建——是「重建进行中」不是「概念缺席」；吸收不新增独立机制（wc-56/wc-35 撤回教训约束） |
| 4 | 2026-09-07 | Research 类型定案（另线）：撤销 Investigation、Study 换名 Research，编号 24，五类不变（已全链路落地，commit 1a2a3c5） | 五类谱系：Spark/WorkCase/ADR/Pitfall/Research（20-24） |
| 5 | 2026-09-06 | 「整理收敛成一份文档……之后只通过一个文档来展开 spark和wc相关改建的事项」 | 本文档的地位依据；九份源文档已删除 |
| 6 | 2026-09-08 | 「adr 承载的是决策，并非是规划……adr、pitfall 的用法你没有搞清楚」 | 纠正主控混层：ADR/Pitfall 属知识层（回溯记录、前瞻消费），不承载「接下来做什么」；规划属前向层（§5 三层模型由此确立） |
| 7 | 2026-09-08 | 「我说的是项目目标，不是阶段目标」「要一个不能经常变动的项目目标，演进过程应该是其他载体」 | goal.md 定性为**冻结锚**（单例、近乎不变、改动走 Human Gate）；阶段/演进内容全部移出，由蓝图+WC+Spark 承载 |
| 8 | 2026-09-08 | 「阶段性目标其实就没有了，由 spark或者wc承载？」 | 主控确认阶段作为独立对象退役，拆解为四 residue（意图→蓝图手写区；实体→WC；判定→WC 关闭链；历史→蓝图 git 历史） |
| 9 | 2026-09-08 | 「是不是还少了一层呢？」（Goal 直接分解成 WC？） | **Initiative 层确立**：分解容器（专项陈述+完成判定+serves:G-SC），v1 阶段目标（带成功标准状态机）退役、v2 Initiative（纯分组容器）立型；并行发生在 Initiative 层，goal 永远单例 |
| 10 | 2026-09-08 | 「架构至此闭环……我基本认可，你先记录下来」 | **§5 架构定稿 v2 记录生效**；正式类型设立（25/26 新增）待重建启动时按 00 §4.2 走正式 Human Gate |
| 11 | 2026-09-08 | 「名词，你可能要调查一下，普遍做法是什么」→「epic这个词还是有点怪」→「Initiative 用这个」 | **26 号定名 Initiative（中文：专项）**——业界对表后换名（Epic 出局：隐喻隔层；Subproject 出局：与管辖「项目」撞保留词；Subgoal 出局：与 G-SC 语义槽撞车；Work Package 出局：PMBOK 通行名但与 02「工作包生命周期」硬撞）。对表结论见 §5.8 |
| 12 | 2026-09-08 | 「goal 我觉得还是在网页里引导摩擦低……需要 human和ai进行一次项目初始化，也就是人对ai说，帮我进行项目初始化」 | **goal 落地机制定案（§5.10）**：采集=项目初始化对话（安装表单方案作废——Web 横幅指路触发句）；级联=C2 链式扩展（失效标记+逐级局部确认，只到 active、Spark 豁免、每跳标记非动作、频率兜底）；三位置分工=Web 横幅/设置卡状态/会话注入+Gate 1 卡口（缺失时 fail-closed 恰好拦住授权工作，读操作不误伤） |

---

## 5. 事实对象架构定稿（v2，Human 基本认可 2026-09-08）

> 认可口径（Human 原话引，裁定 10 时代）：「一个锚（goal）、一条分解链、一间候诊室（Spark）、一个知识库（ADR/Pitfall/Research）、一张规划面（蓝图）。」**裁定 13 更新**：分解链= sub-goal→WC（两层），类型= 六个（21 WC / 20 Spark / 25 Goal / 22 ADR / 23 Pitfall / 24 Research）。**裁定 14 更新**：计划并入 goal（目标+计划一体），蓝图= 纯计算视图（无文件载体）——六类型 + 零特殊载体。

### 5.0 设计公理（四条）

1. **按消费点设型，不按信息分类学设型**——每个对象必须回答「哪个流程位**必引**它」；v1 阶段目标是「先造再找消费点」的反面教材，sub-goal 是「消费点先暴露缺口」（Gate 1 引用位、蓝图投影、锚点稳定性）的正面示范。
2. **变化频率决定载体重量**——冻结的住锚、月级的住轻容器、节点级的住活文档、日级的住事实对象；频率混装 = dev-memo 病根。
3. **单例用路径约束，多例才用身份机械**——goal.md 免 UID/目录/F0 召回；多例类型用全套身份机械。
4. **被历史引用的锚点，定义处必须低频稳定**——WC 是不可变历史，它引用的上游（Initiative→G-SC）不能住在常动文档里。

### 5.1 三层语义模型（内容按时间指向分层）

| 层 | 内容 | 消费方式 |
|---|---|---|
| **知识层**（已定之事·回溯记录） | ADR / Pitfall / Research | 行动前预检、审议上下文、故障调查入口——「回溯记录、前瞻消费」，不承载「接下来做什么」 |
| **前向层**（未来安排） | goal（锚）→ sub-goal（SG-n）→ WC（执行件） | Gate 1/Gate 2 强制引用；蓝图投影；跨会话恢复 |
| **悬置层**（未定之事） | Spark | 召回、查重、分流——宽进严出的候诊室，横切全部层级 |

### 5.2 事实对象名册（六件；裁定 14 后蓝图不再是载体——纯计算视图）

| 对象 | 编号 | 层 | 承载 | 状态机 | 实例量 | 创建/变更权 | 结构性消费点 |
|---|---|---|---|---|---|---|---|
| **WorkCase** | 21 | 前向·执行 | 授权包、执行、验证、残留责任 | open→closed；completed/partial/not-achieved/cancelled | 多（v4 日均 6） | 受控创建；C2 授权钉扎 | Gate 1/2 模板强制引用；蓝图「进行中/已完成」；跨会话恢复 |
| **Spark** | 20 | 悬置 | intent/summary/evolution 三分工 | open→implemented/discarded | 多（v4 103） | AI 问句准入 | 新主题召回；创建任何对象前查重；蓝图「悬而未决」 |
| **goal.md** | 25 | 前向·锚 | 目标陈述 + G-SC-x（冻结锚点）+ status | active→achieved（=项目收官，唯一翻转） | **单例** | Human Gate | Gate 1 链顶；蓝图「当前目标」投影源；讨论三件套之一 |
| **ADR** | 22 | 知识 | 决定/备选与理由/适用范围/证据 | active/retired | 低频 | 受控创建 | 遵守预检、审议上下文（「历史上否过什么」） |
| **Pitfall** | 23 | 知识 | 症状/触发条件/规避/验证 | active/discarded | 低频 | 受控创建 | 执行前预检、故障调查入口 |
| **Research** | 24 ✅已建 | 知识 | 三态证据、引用闭环、implications | — | 按需 | 11 号调研系统全链路 | 调研入口（已实现）；方案论证 |

- **goal.md 单例三免**：免 UID（路径 `ldvh-base/goal.md` 即身份，仓库先例 specs/00）、免目录/文件名编码、免 F0 召回（直读）；写入入口拒绝重复创建 = 免费基数校验。

### 5.3 蓝图（纯计算视图，裁定 14 后无文件载体）

裁定 14 将计划并入 goal.md 计划区后，蓝图不再有独立文件（BLUEPRINT.md 概念取消）——**蓝图 = Web 页面上的纯投影**，五区块全部计算生成、零 authored 内容：

| 区块 | 来源（纯投影） |
|---|---|
| 当前目标 | goal.md（陈述 + SG-n 达成概览） |
| 下一步 | goal.md 计划区（「下一步」H2 条目） |
| 已完成 | closed WC 关闭链（按 SG-n 分组） |
| 进行中 | open WC（按 SG-n 分组） |
| 悬而未决 | open Spark |

红线：不是第二事实源——字面成立（根本没有第二个文件）；全部区块沿 serves 引用链机械可重建，不依赖散文。

### 5.4 不立对象清单

| 候选 | 归宿 | 一句话 |
|---|---|---|
| 阶段目标（v1 设计） | **退役** | 带成功标准状态机的重阶段是过度设计；其意图/实体/判定/历史四部分各有归宿（蓝图手写区 / WC / WC 关闭链 / 蓝图 git 历史） |
| Milestone / Phase | 无对象 | 是 WC 的内部叙述，不设状态机 |
| Feature | sub-goal 的产品语义特例 | 产品项目里 feature≈SG-n；外部流水线工件（Spec Kit specs/ 目录等）经端点契约收割后挂靠对应 sub-goal，不做副本 |
| Plan（规划） | 视图，非对象 | = 冻结锚 + sub-goal + WC + Spark 联查投影；对象化即第二事实源 |
| Charter | 规范源（项目级 spec） | 「必须被遵守」是规则语义，进 specs/ 不进事实源 |
| 使用证据/效用账本 | 关系字段 + 轨迹只读聚合 | 待定项 18 已定 |
| 反思流水 | 运行状态 | 只记录不行动；采纳后经沉淀分流落位 |
| 会话裁定 | dev-memo 工作记录 | 稳定后升 ADR 或进规范（00 §4.4） |

### 5.5 流转路径（生命周期接线）

```
Spark（候诊室，横切三层）
  ├─ 值得追·是工作 ──────▶ WC（物化；Gate 1 引 SG-n）
  ├─   ├─ 动了方向本身 ────────▶ goal.md 修订（Human Gate；极罕见）
  ├─ 想清且属知识 ────────▶ ADR / Research
  ├─ 验证出坑 ────────────▶ Pitfall
  └─ 不追 ────────────────▶ discarded（留尸不占坑）

WC 关闭（Gate 2）
  → 沉淀判断：值得留的 → ADR/Pitfall/Research/模板改进
  → 蓝图投影刷新；外部流水线工件经端点契约收割挂 sub-goal

引用链：WC → sub-goal（serves: SG-n）→ goal，全链机械可查
```

### 5.6 家族统一约定

平铺单文件载体（YAML frontmatter 机器权威 + markdown 正文，24 号最终形态）；必填最小集 + 问句准入（每类型 4–6 问，替代 schema 校验先行）；字段变更必须声明存量对象迁移义务（Sync Impact Report 模式，治 v4 backfill 之痛）；署名两行机械取值（#29 零清理原则）；多例类型有 object_uid，goal.md 豁免。

### 5.7 痛点对照自检（00 §1 四个 Human 短板全覆盖）

| 痛点 | 承载 |
|---|---|
| 1 规划模糊、来去不可答 | goal（为什么/去哪）+ sub-goal 锚点链 + 蓝图（现在哪） |
| 2 灵感流失 | Spark（v4 103 实例验证） |
| 3 进展断续 | WC + sub-goal 分组 + 蓝图投影（双粒度恢复） |
| 4 经验沉没 | ADR/Pitfall/Research + 关闭沉淀端点 + 预检消费 |

AI 侧：漂移→Gate 1 引用链（WC↔sub-goal↔goal 对不上即暴露）；自欺→C2 授权钉扎 + WC 四态终态 + B3 复核专属勾选权；遗忘→结构性消费点（接线，不靠召回）。

### 5.8 命名对表（业界通行做法核查，2026-09-08）

> 依据：Atlassian 敏捷层级（Theme/Initiative > Epic > Story > Task）、OKR（Objective/Key Results，Atlassian 与 SAFe）、ADR 社区（adr.github.io、arc42 §9）、PMBOK、Spec Kit spec-of-specs、OpenSpec change 生命周期。核查触发：Human 指令「名词，你可能要调查一下，普遍做法是什么」。

| 类型名 | 核查结论 | 处置 |
|---|---|---|
| ADR | 业界标准词（Nygard 2011 起；已演化出「any decision record」用法——LDVH 记录架构外决策正是主流方向） | ✅ 免检 |
| Pitfall / Research | 无通行冲突词 | ✅ 免检 |
| WorkCase / Spark | LDVH 自造谱系词（v4 152+103 实例），语义比 task/issue 重，换名成本远大于收益 | ✅ 谱系保留 |
| **Initiative（专项）** | 该位置业界三家填法：Jira/Atlassian 用 Epic、Linear 用 Project、OKR 世界用 Initiative——语义同为「数周到数月、含多个工作项、有完成状态的大块工作」。Epic 出局（隐喻隔层，Human「有点怪」）；Project 出局（与管辖「项目」撞系统保留词）；**Initiative 胜出**：词面即「从目标发起的攻坚专项」（OKR 标准句式 "Objective is delivered through initiatives"），且词性与 Goal 分离（终点名词 vs 发起动作名词）天然防混淆 | ✅ **定名**（裁定 11） |
| **Goal（项目目标）** | 业界通行位置（OKR Objective/Theme/Initiative）是季度级、多并行、可判达成——LDVH goal.md 是**年+ 尺度、单例、冻结、翻转=项目收官**，粒度高一档 | ⚠️ 保留但须钉差异：25 号规范与 01.Att.01 术语表须标注「Goal（项目级单例冻结锚）≠ OKR Objective（季度级多并行）」；G-SC 与 OKR Key Results 同构（目标陈述↔Objective、G-SC↔KR），术语表登记此映射 |

术语表落点（随 25/26 号起草批次连带，现在不动 01.Att.01——其 provisional 纪律要求回填前不得据此执行）：01.Att.01 新增「事实对象类型术语」节（七类型+四层分解链+三层模型词汇）、Goal 与 Initiative 各带业界粒度差异脚注、BLUEPRINT 条目（非类型投影文档）。

### 5.9 命名防撞清单（未来新增类型/载体时过一遍）

1. 「项目」是管辖系统保留词——任何新类型不得含 project/项目；
2. 「工作包」已被 02 §3.1 用于 WC 级收口模式——PMBOK 的 work package 不再可用；
3. 「目标/Goal」已由 25 号占用（项目级单例）；OKR 家族的 Objective/KR 语感与其相邻，下层目标家族词只到 Initiative；**注**：`sub-goal`（SG-x）是 25 号 goal 对象**内部的字段名**与锚点编号，**不是独立类型、不占类型命名空间**——2026-09-09 由原「G-SC（成功标准锚点）」改名而来（Human 裁定：sub-goal 更直观；语义=「要达成什么」的目标维度，与 Initiative「做什么」的工作维度一眼可分）；
4. Charter 已裁定归规范源（项目级 spec），事实源不得复用。

### 5.10 goal.md 落地设计（Human 2026-09-08 裁定 12，25 号规范正文素材）

**采集：项目初始化对话**（表单方案作废——Human 修正：「在网页里引导摩擦低……需要 human 和 ai 进行一次项目初始化」）。安装事务不收 goal（登记+ldvh-base/+Hook 不变）；Web 首页横幅（goal 缺失时）指路：「在 DSH 会话中对 AI 说：**帮我进行项目初始化**」：

```
Human:「帮我进行项目初始化」
AI:   你想做一个什么项目？说说想实现什么
Human: 口语描述（松、多句、带背景均可）
AI:   提炼目标陈述 + G-SC 草案（编号锚点）→ 逐条确认/修改/删除
AI:   受控写入 ldvh-base/goal.md（change_log 首条，会话署名）
AI:   顺手提议「要不要先精化几条 sub-goal？」（可选跟跑，goal 可先独自存在）
```

理由：表单只拿到字符串，精化与事实源关联仍需对话——流程切成两半两半都别扭；对话形态人只说想说的话、AI 负责变成结构，摩擦最低。「项目初始化对话」有固定形态（触发句/引导步骤/产出契约），登记为行动模板候选（30-38 段），暂由引导段指引 AI 行为。

**三位置分工**（同一个源的三个投影面，不建第二套目标状态）：

| 位置 | 职责 |
|---|---|
| Web 首页 | 蓝图第一区块「当前目标」+ goal 缺失横幅（指路初始化） |
| 设置卡 | 状态展示（已初始化/未初始化）+ 修订入口（带确认对话：现值 vs 新值 + 影响提示） |
| AI 会话 | systemPrompt 注入当前项目目标（引导段 +1 项）+ Gate 1 卡口 + 首会话精化提议 |

**Enforcement 精确化**（「项目无法开展」精确为「无法开展需授权的工作」）：

| goal.md 状态 | 被阻止 | 不被阻止 |
|---|---|---|
| 缺失 | **Gate 1 无法受理**（授权无锚可引——架构上自然 fail-closed，无需额外规则）；注入段显著提醒，AI 主动引导初始化 | 一切读操作（浏览事实源/读规范/调研/讨论/Spark/Research 照常——正是想清楚目标的过程） |
| 只有陈述句 | — | WC 正常走（Gate 1 引 goal 本体）；注入段提示「G-SC 待精化」，AI 适时发起对齐 |

**级联：C2 链式扩展**（业界对表：OKR 周期对齐会=重流程；Jira/Linear 手动批量 triage=易烂；**spec-collab 失效标记+reconfirm=最好且已被吸收（C2）**——级联的正确形态不是自动重排，是失效标记+逐级局部确认）：

```
goal.md 修订（Human Gate + change_log 一句话理由；AI 只能提议修订——C1 模式）
  ▼ 机械扫描（纯引用链查询，无 AI 判断）
serves 受影响 sub-goal 的 active WC → 标记「goal-changed 待核对」
  ▼ 逐 WC 核对（AI+Human）
调整内容 / 关闭 / 保持原样（各留 change_log），按 C2 语义局部重批 → 到此为止
```

三约束（裁定 13 简化后）：①**只到 active 对象**（closed 是历史，锚定的是当时的 goal，不重写）；②**Spark 明确豁免**（横切不锚定 goal）；③**每一跳是标记非动作**（机械层只找受影响者/打标/生成待办；改动永远发生在对话里）。与 C2 共用同一套标记/待办机械，不为 goal 单独发明。

**升级路径**（存量管辖项目）：「更新修复」按钮扩展第三职能（刷 Hook+补事实源+**补 goal 检测**）；或首次 AI 会话检测缺失引导初始化；Web 横幅持续显示直至补齐。

**LDVH 自填样例**（设计示例，25 号起草与 G-SC 初始集的参考底稿）：

- Human 填的原始一句话（口语原样）：「做一个治理框架，让 AI 长程协作开发稳定、可控、高效」；
- AI 精化提议——陈述收紧：「建成一个深度绑定 DSH 的 AI 协作治理框架，让长程 Vibe Coding 稳定、可控、高效，并经受真实长程项目的使用验证」；G-SC 草案四条：G-SC-1 规范体系（00–26）全部成为当前规则源成员且互咬（进行中）；G-SC-2 七类型事实对象在真实工作流中完成一轮出生→消费→关闭（进行中）；G-SC-3 插件能力面 dogfood 闭环（部分达成）；G-SC-4 至少一个 LDVH 自举之外的真实长程项目从概念走到产品（未开始——外部验证硬标准）；
- 样例自证三点：一句话与精化分离是必要的（松话一回合收紧）；LDVH 是「陈述≈使命」的边界案例——G-SC-4 才是防「永远达不成」的闸；「v5 建成」被自然消化为 G-SC-1..3 合集+蓝图投影叙述，不占任何一层。

---

## 6. 20-Spark 重建议程

**必须保留的语义**（v4 实证价值）：
1. 类型本身——103 实例验证「悬置想法」捕获价值（对应 00 §1 Human 短板 2）；
2. intent / summary / evolution 三分工——spark-0040 证明跨会话跨模型接力靠它；
3. 三态 + **终态只结束入口职责**（implemented≠下游完成）——防「交了就当完成」的自欺防线，v4 被误解最深但语义正确的设计；
4. 创建前查重纪律（v4 教训 1 的对治目标）。

**必须砍的重量**：
1. 25 条 Stop Conditions → **问句准入**（4-6 个问题答完才准入：是否跨行动有保留价值/是否已有位置承载/是否单一可判断单元/谁消费/查重结果）——Spec Kit checklist「英文单元测试」模式（问句清单代替 schema 校验，成本 1/100）；
2. summary 语义充分性的三段规范密度（20:145-151 共 2000+ 字）→ 精简为判据句 + 正反例；
3. 字段条件闭集的严格性 → 新建必填收敛为最小集（intent/title/status），条件字段从简——backfill 之痛的根源治法：字段契约变更必须声明对存量对象的迁移义务。

**吸收项**：keel 锚定三问（目标/不做/成功，「不做必须至少一条」）；问句准入即 B2 模式。

**优先迁移保留**：spark-0040（知识激活主线）——它是 12 号记忆系统的现成需求陈述。

**分流去向（v2 更新）**：见 §5.5——新增「动了方向本身 → goal.md 修订（Human Gate）」。

---

## 7. 21-WorkCase 重建议程（首批迁移，受益最大）

**迁移矩阵既定基线**（v4-v5-spec-migration-matrix §5.2，必须保留六条）：可独立关闭的工作责任（非聊天计划/命令清单）；Gate 1=计划+授权基线、Gate 2=复核+关闭提案，仅此两 Gate；授权包显式限定目标/对象/范围/风险/禁止项/副作用；据实收敛结果/分类/验证范围/剩余责任；关闭后只保留有查重/结果理解/责任去向/后续决策价值的内容。**必须重新设计四项**：attempt 单调令牌与中断恢复；快通道与小工作准入（防 wc-39 误建）；partial/cancelled/not-achieved 终态收口；独立审核失败时的保证披露。

**本轮新增设计输入**：
1. **C1 AI 提案对象模式**（spec-collab 四层门）：`ldvh_*` 工具改造——AI 调用只产出提案对象（候选 patch/结构化发现/待办），写正式状态（受控写入/状态转换/关闭）的动作走 human 专属入口；
2. **C2 授权钉扎 + 受影响范围自动失效**：Gate 1 授权绑定 commit 快照；执行中范围变化→受影响 scope 授权自动失效→生成 reconfirm 待办，**局部重批不整单重走**（wc-62「批准的与做的相反」的机械正解）；
3. **端点契约五契位**（外部流水线产物如何被接住）：specflow goal-complete 接缝（最干净）/ keel AUDIT 三件套（结果+证据+偏差+复盘 = Gate 2 关闭提案的证据结构）/ openspec、spec-loop 的 archive 变更集 / spec-collab ReadyPackage+sha256——选型随 21 号实施定；收割产物挂靠对应 **sub-goal**（§5.4 Feature 归宿）；
4. **粒度裁决规则（v2 更新）**：WC = 可独立关闭的责任单元（天/周尺度，通常比 feature 小）；sub-goal 是其上的分组锚点（月级）；feature 是 sub-goal 的产品语义特例，可来自外部流水线；
5. **F1 复选框任务级进度**：tasks.md 形态（`[ ]`/`[x]`+T 编号+[P] 并行标记）作为 work items 的下限形态——30-38 模板从勾选框下限开始长，每加一层机制须回答「防 v4 哪个实际发生过的问题」，答不出不加；
6. **K1 关闭条件规则 ID**：21 的关闭判定每条给稳定 ID，Gate 输出 {rule, severity, line} 结构化 finding；
7. **B3 reviewer-owned 勾选权**：独立复核的最便宜形态——快通道档用「只能由复核方勾的清单」，标准档以上才上 subagent 对抗（对治 v4 独立审核 7 次返工的重量）；
8. **Gate 1 引用位（v2 更新）**：终态引用对象为 **sub-goal 锚点**（链：WC→SG-n→goal）。

**开放问题（随实施裁决）**：attempt 单调令牌 vs v4 指纹 CAS 的取舍；快通道准入判据（keel 规模变体判据可参考）；授权包字段集瘦身（v4 八组件 → 最小充分集）；Output Envelope 五方循环引用切分（02 定语义字段 / 05 定序列化 / 其余只引用——Spec Kit「Done When 三勾+Completion Report」为最小参照）。

---

## 8. 吸收总账（三场调研合并，按落点归位）

### 8.1 直接吸收（18 项；★=20/21 重建直接相关）

| # | 机制 | 来源 | 落点 |
|---|---|---|---|
| S1★ | Complexity Tracking 表（违反原则须填表自证无更简方案） | Spec Kit | 04 |
| S2 | clarify 十类歧义分类+可答形状约束（≤5 问/多选/短答） | Spec Kit | 11 实现 |
| S3 | 未知项→研究子任务转换 | Spec Kit | 11/编排 |
| S4 | 任务-需求覆盖映射（零覆盖即高危，可机械检查） | Spec Kit | 04+Git Gate |
| S5★ | feature↔WorkCase 对齐（端点契约=生态对齐点） | Spec Kit | 21/26 |
| C1★ | requireHuman 四层机械门（AI 提案对象模式） | spec-collab | 08/21 |
| C2★ | commit 钉扎确认+受影响范围自动失效 | spec-collab | 21 |
| C3 | FACT 强证据机械约束（accessible+versioned 否则 throw） | spec-collab | 11 |
| F1★ | tasks.md 复选框任务级进度（记录+进度+选择器三合一） | specflow | 21/04 |
| F2 | 单一发现入口+goal 前缀反推对象 | specflow | 08 |
| F3 | goal 桥三态恢复 | specflow | 08/02 |
| F4 | open question 必须显式留人、不静默决定 | specflow | 11/00 |
| K1★ | 规则 ID 稳定引用体系（finding{rule,severity,line}） | keel | Git Gate/21 |
| K2★ | 同门禁更小工件的模板规模变体（微/常/大三档） | keel | 04 |
| K3 | 共享核心+双壳（插件 apply 与裸 CLI 复用，检查面进 CI） | keel | 08 |
| L1 | 标准事件折叠状态机（运行态投影，零自定义事件） | spec-loop | 02 实现层 |
| L2 | 门与显示同源投影（呈现读行为门同一载体） | spec-loop | 10+Git Gate |
| L3 | 声明式 bash 验证命令+有界 judge 成本闸门 | spec-loop | 04 |

### 8.2 参考不吸收（9 项，择要）

ADDED/MODIFIED/REMOVED 变更词汇+change-id 校验（openspec/spec-loop→21/34 词汇层）；OpenSpec main+delta 增量规格（须论证低于「完整 after+change_log」摩擦才考虑）；spec-collab 六门机械检查形态（取「机械可判定+失败理由可枚举」形态不搬词汇）；阶段会话复用+增量提示；spec/plan/tasks 模板分组；命令=enqueue 解耦分派；ASSUMPTIONS 风险分级门禁形态；变更单 9 字段（含「推迟」显式状态）→ADR/21；审计表四要素→21 关闭提案。

### 8.3 红线（15 项，择要）

workflows YAML 引擎与四层定制栈（Spec Kit）；社区市场信任模型（维护者不审查代码）；会话级审批（spec-loop，违反 00 §4 跨会话决定）；无门 Status 头字段（specflow）；judge 自检冒充独立复核、agent 自报标记驱动流程门（spec-loop）；提示词纪律整体（Spec Kit 家族——LDVH 护城河必须在提示词给不了的地方）；整套协作账本/第二事实库、DOM hack 客户端挂载（spec-collab）；差量合并进事实源（已有完整 after+change_log）；模糊词表扫描（keel，中文正文误报高）。

### 8.4 吸收判据（恒定）

①吸模式不吸功能（落既有机制实现层，不新增独立机制——wc-56/wc-35 教训）；②必须降摩擦（095 教训：低风险不是跳过流程的理由，是换更小工件的理由）；③机械优先于自觉；④诚实报告（小/不成熟/名不副实如实说，证据不足标 uncertain）。

---

## 9. 建设顺序（v2，架构定稿后）

```
✅ 已成：11 调研系统 + 24 Research（research-writer/session 落地，347 测试绿；载体已定平铺单文件）

立即可做（不依赖类型重建）：
  ⓪ 蓝图=goal 计划区（裁定 14 后无独立文件；剩余工作=Web FocusV2 接线「下一步」区块渲染）
  ① K1 规则 ID 体系 → Git Gate 现有检查对表（纯机械增强，不动规范）
  ② K2 规模变体试点 → 04 实现层（微/常/大三档，同门禁小工件）

类型重建窗口（每步走质量链：候选起草 → 独立对抗审核 → Human 终审 → 受控提交）：
  ③ 21 WorkCase（最重投入：C1 提案对象模式 + C2 授权钉扎 + F1 勾选框下限 + B3 复核专属勾选权；
     Gate 1 引用位直引 sub-goal SG-n）
  ④ 20 Spark（问句准入替代 25 条 Stop；三分工保留；spark-0040 优先迁移）
  ⑤ goal.md + 25 号迷你规范（~80 行；单例三免；首个实例=狗粮「建成 LDVH」；
     落地设计已定稿见 §5.10——初始化对话采集/G-SC 延后精化/C2 链式级联/三位置分工）
  ⑥ 22 ADR / 23 Pitfall 最小骨架（4 字段下限；消费点[Gate 1 预检位]做实后再丰满；
     字段减法定案继承——trigger_signal/scope_of_impact/action_relevance 不回来）

存量迁移（随类型落地、走受控入口，不 git 复制）：
  dev-memo 32 条已定决策 → ADR；20 待定项+本线开放问题 → Spark；
  方向与阶段 → goal.md/蓝图；v4 高价值对象（spark-0040 等）→ 按类型受控重建
```

**v5 当前状态对照**（重建起点）：00-10 基础规范已立且互咬；三个结构缺口——08 约 8 处「待核验」的 DSH 最后一公里、20-23/25/26 编号全空（03 §11 已定 10 结构角色+12 问题框架）、Output Envelope 五方循环引用。ldvh-base/ 仅 research/ 有实例。

---

## 10. 讨论系统设计定稿（12 号规范起草输入，Human 2026-09-08 系列裁定）

### 10.1 定位：讨论 = AI 承担技术方案工作的方法规范

LDVH 问题分工：「做什么」归 Human（goal/意图，00 §4）；「怎么做」归讨论（技术选型/架构/流程/产品设计的方案工作）；「做得对不对」归复核（02 §13）；「按规矩做」归遵守（02 §12）。讨论系统是把主控的技术方案职责做好的纪律——多视角防自欺、格式驱动防不收敛、依据装配防违背既定决策（与 00 §5 单一主控最终负责一致：技术方案是主控核心职责，Human 只裁决关键取舍）。

本会话实证案例：载体形态之争（技术选型）、goal 落地设计（产品设计）、调研质量修复（架构决策）、WC 减负（流程设计）——全部是"怎么做"层面。

### 10.2 WC 减负：职责重划（v4 病灶的根治）

v4 WC 三阶段（需求审核+执行+结果审计）的摩擦病灶在需求审核：human_plan_confirming 到 Gate 1 反复拉锯（wc-62 授权语义鸿沟、独立审核 7 次返工）——根因是"方案从模糊到可执行"的构建过程被塞进确认态机械，方案还在变而指纹基线已冻结。v5 重划：

| | v4 | v5 |
|---|---|---|
| 需求审核（方案构建） | WC 内（human_plan_confirming 拉锯） | **前置到讨论**（扩散+收敛） |
| 执行+审计 | WC | **WC 只留这两段**（Gate 1 收熟料，一次确认） |

连带收益：human_plan_confirming phase 在 21 号重建时砍掉；授权包瘦身水到渠成（冻结的是收敛后方案，无需"允许调整"对冲字段——v4 八组件的存在就是因为方案会漂）。

### 10.3 双阶段机制

**扩散阶段**：方案空间切分 → 隔离视角各自探索（吸收 solo-thinking 三机制：隔离子会话分支/agent 撰写定向 Handoff/Return 收敛回流）。注意不装 solo-thinking 插件——按吸收原则（吸收=思想，交付=LDVH 自实现），DSH 原生 subagent 承载。依据装配前置：goal（服务性）/ADR active（决策一致性）/Pitfall active（陷阱规避）/规范源（符合性）先召回注入为不可违背清单，违背即淘汰候选方向；未来技术指标为第五类依据（出现量化需求时再入，不预设空维度）。

**收敛阶段：格式驱动**——收敛判据全部由下游类型规范的成文要求承载（12 号零定义，只引用）。按预选去向调出格式契约逐项填写，**填不出的项 = 未收敛点**，三条出路：立刻能解决→下一轮扩散（≤3 轮）；依赖外部信息→转 Research；依赖 Human 取舍→进 Spark 或直接问。全项可填→收敛完成→复用各类型 writer 受控创建。各下游格式的"思考强制项"：ADR=适用范围+触发信号+代价（22）；WC=范围边界+验收标准+价值审计项（21，独有）；Research=价值判断+承接验收+监测条件+分流信号（24 已定）；Spark=单一可判断问句（20）；goal=一句话目标（25）。

### 10.4 出口契约与过程纪律

- **不落文档**（B 方案）：过程在 transcript，产物在下游对象；Handoff 纯过程用途（是否随结论挂档为下游对象字段，起草时定）
- **出口四分流**：ADR（已定决策）/WC（可执行计划——格式齐全只待 Gate 1 批准）/Spark（未决残项，显式悬置不丢）/Research（信息缺口回炉）
- **轮次上限 3 轮**：不收敛交 Human Gate，不无限审（多轮收敛在讨论=开放问题清零，在复核=发现清零，含义不同）
- **评审≠讨论**：收敛性检查（多维审核/发现分级/修复循环）归复核制度（02 §13+01 §12 既有通道），不进 12 号——讨论纯扩散与收敛构建

### 10.5 与既有架构的挂靠

依据装配=架构定稿消费点的集中兑现（goal 召回=Gate 1 链顶必引同一入口；ADR 审议上下文=回溯记录前瞻消费；Pitfall=执行前预检）；v4 technical_assessment 类 Study 的归宿=讨论产物经收敛流向 ADR/Research（24 号迁移边界已定）。

## 11. 开放问题清单（v2 重整，2026-09-08）

| # | 问题 | 关联 | 状态 |
|---|---|---|---|
| 1 | Spark 查重入口的轻量化形态（防「绕过查重直接开新」） | 20 | 开放 |
| 2 | evolution 上限/priority 字段去留 | 20 | 开放 |
| 3 | Spark→Research 分流判据（含 Spark→goal 修订的新分流路径） | 20/24 | 开放 |
| 4 | attempt 令牌 vs 指纹 CAS | 21/08 | 开放 |
| 5 | 快通道准入判据（「小工作」的定义；keel 规模变体判据参考） | 21/04 | 开放 |
| 6 | 授权包字段集瘦身（八组件→最小充分集） | 21 | 开放 |
| 7 | 端点契约五契位选型 + 收割产物挂靠 sub-goal 的具体格式 | 21 | 开放 |
| 8 | Output Envelope 循环引用切分（02/05 权责） | 02/05 | 开放 |
| 9 | 独立复核分层（B3 清单 vs subagent 对抗的档位线） | 21/04 | 开放 |
| — | ~~Initiative 完成判定的形态~~ | — | **已关闭**：Initiative 层砍除（裁定 13） |
| — | ~~Initiative 关闭时名下未了 WC 的处置语义~~ | — | **已关闭**：Initiative 层砍除（裁定 13） |
| 12 | goal.md 措辞与 G-SC 初始集 | 25 | 开放（LDVH 自填样例已备 §5.10，起草时呈 Human 审） |
| 13 | 讨论视角切分方法（方案空间怎么切出互不重叠的候选路线） | 12 | 开放 |
| 14 | 依据装配的召回入口（复用 Gate 1 链顶/新建讨论前置装配器） | 12/08 | 开放 |
| 15 | Handoff 是否随结论挂档为下游对象字段 | 12 | 开放 |
| 16 | human_plan_confirming 砍除后 WC 受控创建的前置校验形态（收到料即合格 vs 收料时验格式） | 21/12 | 开放 |
| — | ~~feature 轴载体~~ | — | **已关闭**：feature = Initiative 产品语义特例（裁定 9 + §5.4） |
| — | ~~Goal 类型化时点~~ | — | **已关闭**：第 ⑤ 步，25 号（裁定 10） |
| — | ~~阶段目标形态~~ | — | **已关闭**：v1 退役、Initiative 立型（裁定 8/9） |
| — | ~~Goal 是否多并行~~ | — | **已关闭**：goal 永远单例，并行发生在 Initiative 层（裁定 9） |

---

## 12. 证据来源索引

| 快照 | 路径 | 状态 |
|---|---|---|
| Spec Kit | `/Users/dmh2002/DshProject/spec-kit`（commit 4a7341a9，2026-09-04） | 完整克隆 |
| dsh-openspec | `/Users/dmh2002/DshProject/dsh-openspec` | 完整克隆 |
| dsh-specflow | `/Users/dmh2002/DshProject/dsh-specflow` | 完整克隆 |
| keel (spec-driven) | `/Users/dmh2002/DshProject/spec-driven` | 完整克隆 |
| dsh-spec-loop | `/Users/dmh2002/DshProject/dsh-spec-loop`（仅 RECOVERED-README.md——原仓库已删 404） | 缓存恢复 |
| dsh-spec-collab | `/Users/dmh2002/DshProject/dsh-spec-collab` | 完整克隆 |
| v4 档案 | `/Users/dmh2002/poker_hud_projects/ld-vibe-harness-v4`（只读） | 完整（25 规范+323 事实对象实例） |

已删除的九份中间文档（内容已收敛进本文）：`docs/investigation-report-github-spec-kit.md`、`docs/spec-tools-research/{SHARED-BRIEF,SYNTHESIS,dsh-openspec,dsh-specflow,spec-driven-keel,dsh-spec-loop,dsh-spec-collab}.md`、`.subagent-map-output.md`。本文引用的 file:line 均指向上表快照，可独立复核。

> 相关但不在本文范围（保留原状）：`docs/v4-v5-spec-migration-matrix.md`（21/34 首批迁移的权威清单）、`docs/v4-problem-ledger.md`（v4 问题全账）、`docs/v5-handoff.md`（迁移纪律）、`docs/spec-candidate-11-research-system.md`（11 号候选）、`docs/blueprint-feature-draft.md`（蓝图功能草案，§5.3 的前驱——六区块结构以其为基，双区制为本架构演进；裁定 13 后已收敛为五区块）。
