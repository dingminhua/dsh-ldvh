# 八维宿主指向表草案（讨论工作稿）

> 性质：**讨论工作稿（非规范、非候选、非事实对象）**——Human 与主控逐维讨论的记录，供后续起草规范修订候选时引用；全部外部调查结论附来源，可直接用于对抗审核。
> 更新：2026-09-05（读维、写维、遵守维三轮完成）；2026-09-06（串联复过第一站：读维——三条定案确认 + F0–F4 事实层五条设计裁决，见 §1.1；第二站：遵守维——四条结论，见 §3.1）
> 依据：docs/dsh-host-reference.md（617 行）、docs/dsh-host-capability-survey-data.md（687 行）、docs/dsh-host-capability-survey-interaction-ui.md（622 行）三份宿主能力盘点 + 联网调查（来源逐条附）
> 状态：结构全部定案（八维保留，Human 2026-09-05）——读/写/遵守/审议/复核/反思/沉淀七维内容定案；执行维暂缓（五点）；反思自查标准与项目清单、沉淀表达方式三点未决留开放
> **接续说明（Human 2026-09-05 定：八维有依赖关系，明天串联再过一遍）**：本文档是跨会话接续的锚点——新会话从「依赖关系图」入手即可恢复全部上下文；每维定案的依据、外部来源、内部锚点、吸收去向全部在文中可查。

## 0. 讨论框架（Human 确认）

**每维回答三问**：①宿主机制（哪条 DSH 通道承载，置信度）②参考项目（生态先例：mnemon / 官方包 / 业界）③采用技术（LDVH 的选择）。

**范围锚定（Human 确认）**：八维讨论**针对双源**（规范源 + 事实源）——00 §3.3 构成定义：八维界定工作职责，双源承载规则与事实，两者是动作与材料的关系。逐维核对 02 机制指向，每维都指向双源之一侧或两侧。

**两处范围澄清（Human 确认）**：
- 规范源修改**不走写维**——走 01 §11/§12 候选→对抗审核→Human 终审→受控提交流程（本会话的可见性候选即为实例）。
- 普通代码/文档不属于双源任何一边（02 §5.4：运行状态不自动进事实源；代码是 09 领域）。写维只管事实对象落位。

**宿主能力地图七组**（三份盘点的消化结果，贯穿全部八维）：

| 组 | 能力 | LDVH 现状 |
|---|---|---|
| A 影响模型上下文 | system-prompt/assemble 瀑布、agent/pre-step 瀑布、systemPrompt.section、commands | 前两个已用；commands 未用 |
| B 观察事件流 | 47 种会话事件（全形状已知）、agent 生命周期 5 事件、sessionProjections.register、sessionPersistence.readRaw/list、sessionQuery | 4 种事件 + readRaw 已用；projections/sessionQuery 未用 |
| C 拦截与否决 | tools/pre-execute 三态网关（allow/deny/ask，ask 串接 approval 卡）、sandboxPolicy 三态、sandbox_permissions 一次性升权 | 沙箱已用；网关未接 |
| D 问 Human | userQuestions.ask（detail/intent 模型面不可达，须自有工具直调）、approval.request（二值+审计对）、authorization 凭据流 | 全未用 |
| E 持久化 | settings 命名空间（expectedRevision=乐观锁）、storage KV、JSONL append-only（压缩不删原始事件） | settings 已用；storage 未用 |
| F 呈现 | 52 个 Slot、theme 三层 token、webServer 路由 | 3 个 slot + 部分 theme/webServer |
| G 组织与委派 | subagents（startContinuable/followup/reportFrom/registerContinuableSetup）、goals（生命周期+revision）、agents registry、team 事件 | 全未用（子代理问题冻结中，registerContinuableSetup 是未试过的正道） |

**贯穿性事实（影响全部八维）**：
- compaction 不删原始事件（dsh-compaction README 行 95「已遮蔽事件仍保留在原始日志中」；surface.js 行 36-41 官方注释：模型可见 surface 不是人类对话记录的正确来源；Chat UI 按 isAppendSurfaceEvent 渲染）→ 注入行压缩后仍在对话流显示；机械记录永久可回读
- 宿主无预算计量 API（assemble 无预算参数）→ LDVH 须自建
- 事件白名单 47 类（known-event-types.js）→ 挂钩前对照白名单，杜绝 agent/turn-end 类臆造

---

## 0.5 八维依赖关系图（串联讨论的骨架）

```
                    ┌─────────────┐
                    │   读维 §1    │ ← 一切的前提（信息进来）
                    └──────┬──────┘
                           │ 供料（规范锚点/事实/Goal-Charter-ADR 三件套）
                    ┌──────▼──────┐
        ┌──────────│   遵守维 §3  │ ← 规矩在场（读到的规则改变行动）
        │           └──────┬──────┘
        │ 约束扩散到每一维  │
        │           ┌──────▼──────┐         ┌──────────────┐
        │           │   审议维 §4  │ ──产出──▶│  执行维 §6     │
        │           │ （讨论收敛）  │◀──反馈──│（工作包编排）   │
        │           └──────┬──────┘         └──────┬───────┘
        │                  │ 方案（含排除理由）        │ 实际结果
        │           ┌──────▼──────┐         ┌──────▼───────┐
        │           │   写维 §2    │◀────────│   复核维 §5    │
        │           │ （落盘门）   │──双层───▶│（独立检查完成） │
        │           └──────┬──────┘  完成    └──────┬───────┘
        │                  │ 落位的事实/经验           │
        │           ┌──────▼──────┐         ┌──────▼───────┐
        └──────────▶│   沉淀维 §8  │◀──多入口──│   反思维 §7    │
          （Pitfall  │ （值得保留吗）│         │（自查漂移）    │
            进枚举）  └──────┬──────┘         └──────────────┘
                           │ 沉淀物回流（ADR 枚举/Charter 修订）
                           ▼
                    回到读维/遵守维（闭环）
```

**依赖关系要点（串联时的检查清单）**：

| # | 依赖 | 内容 | 串联时验证什么 |
|---|---|---|---|
| 1 | 读→一切 | 读维供料所有维（规范锚点、事实、三件套）| 规范层寻址缺陷（§1）不修，第二项目全盲——串联时确认修法时机 |
| 2 | 遵守→横切 | 遵守维的规矩在场面（引导+枚举+网关）约束全部七维 | ADR 枚举接线（§3 定案未接）；pre-execute 网关（§3 定案未接）|
| 3 | 审议⇄执行 | 审议产出方案（含 Goal/Charter 锚定），执行落为动作；反馈回路 | 执行维五点未决（§6.4）——串联时首攻 |
| 4 | 执行→复核 | 执行的结果交复核（双层完成声明）| 复核独立性通道（subagents）宿主✅ LDVH❌ |
| 5 | 复核→写 | 复核通过才落盘（双层之一）| 落盘器未实现（写维核心待建件）|
| 6 | 执行/复核→反思 | 摩擦驱动反思（失败/推翻/纠偏/重复）| 反思自查标准与清单未决（§7.3 前两点）|
| 7 | 反思+四入口→沉淀 | 反思候选只是沉淀入口之一 | 沉淀表达方式未决（§7.3 第三点）|
| 8 | 沉淀→读/遵守 | 沉淀物回流：Pitfall 进枚举、Charter 修订、Spark 分流 | 闭环是否真的转得起来（v4 8+8 待搬运是首批物料）|

**串联讨论的推荐顺序**（明天从这开始）：按数据流「读→遵守→审议→执行→复核→写→反思→沉淀」走一圈，每站验两件事：**上游给的东西够不够用** + **下游接得住吗**。三个未决口袋（执行五点、反思两点、沉淀一点）在串联中带到时顺手收，不单独开题。

**串联顺序修订（Human 2026-09-06 裁定）**：第三站改为**审议+执行联合站**——Human 直觉「审议涉及团队控制的问题，要和团队控制一起讨论」，与 §4.4 定案第 5 条（审议与执行同构，都是行动编排）互证：两维共享团队控制底座（spawn/信息传递/漂移防护/中断恢复/结果回收/成本控制），分开讨论必然重复；执行维五点未决的真正原因正是底座未清。联合站三段结构：①团队控制底座（维度无关）→ ②审议用法映射 → ③执行用法映射（五点未决顺势收口）。执行维「暂缓」随之解冻重估。

**接续锚点速查**：

| 想接续什么 | 看哪里 |
|---|---|
| 八维各自定案了什么 | §1–§8 每节开头「定案（五条/三点）」块 |
| 某个结论的证据 | 附录 A（21 个外部来源，URL 全附）+ 附录 B（25 个内部锚点，文件+行号）|
| 吸收了谁、吸收了什么 | 附录 C（吸收原则+全表+红线）|
| 还没定的事 | §6.4（执行五点）+ §7.3（反思沉淀三点）|
| 哪些定了还没实现 | 各维映射表「状态」列——✅已落地 / 宿主✅LDVH❌ / ❌待建 |

---

## 1. 读维（Human 定案 2026-09-05）

**02 锚点**：取得当前工作所需且来源明确的规范、事实、状态和能力信息，控制上下文负担。

**Human 关键裁定：读维 = 两个独立读通道**——规范层（LDVH 独有，全局一份）与事实层（每管辖项目各自）：

| 通道 | 宿主机制 | 参考项目 | 采用技术 | 状态 |
|---|---|---|---|---|
| 规范层读取 | agent-scoped 工具注册（per-agent shadow，not_governed 会话零干扰） | mnemon（15 工具同通道）、workbuddy | L0–L4 五工具 | ✅ 已落地 |
| 事实层读取 | 工具通道（宿主无事实存储） | mnemon recall/document_search（分层+命中依据的成熟先例） | F0–F4 待实现，分层思路参照 mnemon | ❌ 内容缺口 |
| 宿主引导 | system-prompt/assemble 瀑布（每回合） | mnemon（assemblePrompt+memoryWake 两段式）、官方 runtime-context | 七锚点+判定行 | ✅ 已落地 |
| 宿主预算 | **宿主无原生 API** | 无（盘点确认） | 自建计量（08 修订方向：从「待核验」改为「LDVH 自建」） | ❌ 待自建 |
| Web 阅读入口 | settings.section / conversation.view / webServer | mnemon 设置页、trajectory view tab | 设置卡已用；view tab 骨架在 | ⚠️ 10 侧后续 |
| 会话记录读取 | sessionPersistence.readRaw、sessionQuery | 官方投影/查询服务 | readRaw 已用（签名尾读）；sessionQuery 未探索 | ⚠️ 待探索 |

**已发现未修缺陷（Human 定「先记录不急着修」）**：ldvh-tools.js 第 77 行 `specsRoot = join(projectRoot, "specs")` 把规范源按**管辖项目路径**寻址——两层混淆。今天能跑纯因唯一管辖项目 = dsh-ldvh 仓库自身（dogfood 巧合）；管辖第二项目起 specs 扫描 ENOENT → unavailable，规范永不可读。修法取决于「LDVH 分发形态」（specs 随插件包 / 全局注册 LDVH 仓库路径 / governed-projects.yaml 登记），**属 08 修订要定的事**。

### 1.1 读维串联复过定案（Human 裁定，2026-09-06）

串联复过第一站。先过定案本身，再以「v4 现状盘点 + 行业联网调查」双份一手报告为依据，完成 F0–F4 事实层设计裁决。

**定案确认（三条）**：

1. **两通道划分成立**（规范层全局一份 / 事实层每项目各自）——读维承重墙，不变。
2. **读维无其他形态**——委派链信息传递（Handoff）不算读，归审议/沉淀侧。
3. **「控制上下文负担」= 渐进披露本身即要求，暂不量化**；新增传导关系：**它对写维是要求**（写入侧须考虑将来被读的形态与体积）。

**事实层 F0–F4 设计裁决（五条）**：

| # | 裁决 | 内容 |
|---|---|---|
| 1 | **F0 常驻枚举 = 仅 ADR（对象级）+ Pitfall（标签级）** | ADR 是规则性约束（不读会犯错），对象级常驻（标题+决定+适用条件，v4 当前 5 份 active，极轻）。Pitfall 是经验性知识（读了少走弯路），常驻只到**标签层**——注入「现有哪几类问题」的标签清单 |
| 2 | **Pitfall 三级渐进链** | 标签（常驻）→ 按标签取标题列表 → 标题对得上再读正文（六段）。结构性好处：常驻成本只随**标签数**涨不随对象数涨——问题域收敛、对象无限积累 |
| 3 | **Pitfall 元数据新增必填 `tags` 字段**（问题域/技术域关键词） | 面向检索，比 v4 trigger_conditions 更机器化；标签枚举须有登记处（防标签漂移/同义发散）。**⚠️ 待补：标签规范**（Human 2026-09-06 记——标签如何定义、命名、归并、演进，须有一纸规范，后续补写） |
| 4 | **存储格式与 v4 一致 = YAML** | 统一元数据骨架（object_id/object_uid/fact_type_key/title/status/created_at/updated_at/change_log 含三方签名）直接继承 v4，不重设计；物理路径即发现路径 |
| 5 | **首批范围 = ADR + Pitfall 两类**（承接 v4 的 8+8 欠账） | Spark / Study / WorkCase 去向、Charter/Goal 类型化，分开再定（Charter/Goal 轻量起步路线见 4.5，不变） |

**F 层映射定案**：

| 层 | 语义 | 说明 |
|---|---|---|
| F0 | 常驻枚举：ADR 对象级（标题/决定/适用条件）+ Pitfall 标签级（问题域清单） | ADR 枚举已实现待接线（adr-enumeration.js，见 §3）；Pitfall 标签云待建 |
| F1 | 候选清单（按类型/标签列出，带路由描述） | Pitfall 二级（标签→标题列表）在此层 |
| F2 | 单对象结构摘要（身份块+章节/字段骨架） | ADR 的 Y-Statement 式摘要、Pitfall 六段一句话版在此层 |
| F3 | 精确节/字段读取 | 对应 L3 |
| F4 | 全文 | 对应 L4 |

**调查依据（两份一手报告）**：
- **v4 现状盘点**（2026-09-06 子代理只读调研 /Users/dmh2002/poker_hud_projects/ld-vibe-harness-v4）：五类事实对象共 310 份（ADR 8 / Pitfall 8 / Spark 94 / Study 53 / WorkCase 157）；统一元数据骨架已收敛并经实战验证；Pitfall 六段（症状/触发条件/根因/解决/规避/验证摘要）为多轮修订后固定结构；ADR 已有 `trigger_signal` 必填字段（= Claude Skills description 规范的本土先例）；v4 无 Charter 类型；无静态注册表，物理路径即发现路径；v4 已有 F1/F2 雏形（facts/repository.py read_fact_object）。
- **行业联网调查**（2026-09-06 子代理，来源见附录 A #17–#30）：行业三层披露（元数据 ~100t / 正文 <5000t / 附件按需）与 F0–F4 五层不矛盾——F1–F3 是对「正文级」的细分，规范层 L0–L4 已验证该细分对 AI 自主寻址有效；元数据质量决定触发质量（description = 是什么+何时用+触发关键词）；不可变+状态机+supersede 指针是 ADR 生态最强共识（Nygard→adr-tools→log4brains），v4 retired/discarded+disposition_summary 同构可继承；ADR 摘要层行业验证形态 = Y-Statement 六要素单句；postmortem 模板（Google SRE）字段与 v4 Pitfall 六段高度同构。

---

## 2. 写维（Human 定案 2026-09-05，含 Human 三条直觉）

**02 锚点**：把已经明确去向的内容通过来源允许的受控入口写入，并核对实际结果。

**Human 三条直觉与调查印证**：

| 直觉 | 外部印证 | 结论 |
|---|---|---|
| 1.「写前知规矩 → AI 自由写 → 机械验证 → AI 自改」比受控写入摩擦小 | spec-kit（133k★，AI 写→checks/ 脚本验证→自修循环，github/spec-kit）；OpenSpec（67k★，validate 校验结构+正在迁 schema 声明式，Fission-AI/OpenSpec#829）；06 受控提交已是同模型（本会话两次提交实践） | **成立**——验证环管内容正确性（低摩擦） |
| 2. 机械字段（签名/时间）AI 不许填，Code 补充 | mnemon「LLM 只产候选，宿主做精确记账」（调查报告 §compaction 记账）；03 §9.4 现行条款「由 Code 生成并写入身份和托管字段」；06 签名零清理实践 | **已是现行规范，重申** |
| 3. 并行修改至少要感受到 | 社区实践：三方合并+锁+丢内容写入直接拒绝（reddit.com/r/ClaudeCode 多会话共享记忆帖）；OpenSpec 明确拒绝 mtime 方案（跨平台不可靠），采用换行归一化 SHA-256 做 drift 检测；mnemon「突变失败从 receipt 恢复绝不重试」 | **可实现**——写前指纹门 |

**两派路线不冲突的判断**：spec-kit/OpenSpec 产物是给人读的文档 → 验证环；mnemon 产物是给机器消费的记忆 → 受控写入。LDVH 事实对象介于两者——**内容正确性用验证环（低摩擦），并发完整性用落盘门（必须）**。v4 三层防线（问题 #103 写入层分层机械门）从未实施，「太复杂」的体感有实据。

**写维模型定案（一句话）**：**受控提交模式的推广——AI 自由产出，机械闸门落盘**。Git 提交是第一个实例（已闭环：引导告知格式→AI 写→precheck→自改→签名机械提取→snapshot_identity 防并发→真实 Gate 落盘→回读），事实对象落盘是第二个实例（待实现），两者共用同一套八步纪律。

**宿主通道四条**：

| 写入动作 | ①宿主机制 | ②参考项目 | ③采用技术 | 状态 |
|---|---|---|---|---|
| 事实对象落盘 | LDVH 落盘器（Code 侧） | mnemon（tmp+rename 原子写、expectedRevision CAS、串行队列、receipt 恢复）；settings 服务（expectedRevision=乐观锁同构） | 指纹门+托管字段+原子写+回读；**SHA-256 内容摘要，不用 mtime**（OpenSpec 教训——直接影响 governance-scope.js 现有 mtime+size 缓存策略，事实对象侧要换） | ❌ 待实现 |
| 受控提交 | commit-msg 钩子 + precheck 工具双入口 | 官方 hooks 体系 | 已闭环（dogfood 五提交） | ✅ |
| 写前设卡 | tools/pre-execute 三态网关（原生，fail-closed，ask 串接 approval 卡） | dsh-sub-cli（我们自己两代拦截实践：driver 层 tool_use 拦截 + onPermissionRequest 门控）；官方 permission-presets | **08 §6 修订方向**：机械守护=pre-execute 网关+既有 Git Gate，「不变量接口」说法废弃 | ❌ 待接 |
| 会话事件 | session.append（append-only+surfaceOp） | mnemon 插件消息 | 注入行已用 | ✅ |

**并发防护细则（Human 直觉 3 落地）**：落盘前比对 content fingerprint，不匹配→拒绝写入并报告（不是静默覆盖）；失败恢复参照 mnemon「从 receipt 恢复，绝不重试突变」；worktree 是用户自主行为 LDVH 不自动干预，但写时指纹门自然暴露分歧 + `git worktree list` 只读检测提醒（只报告不阻塞）。08 §6 的「version-guarded write」已要求此机制——规范先行、实现未跟。

**触及规范（Human 定「后面再改，攒进大批次」）**：03 §9.4「受控创建」须重新诠释——从「AI 必须经专用受控创建入口」改为「**AI 自由写草稿，Code 受控落盘**」（七条硬性要求不降，全移到落盘一步）。防自欺根基不丢：回读仍是机械的（落盘器回读，非 AI 自述）。属改可强制执行规则，需 00 §4.2 Human Gate。

---

## 3. 遵守维（Human 定案 2026-09-05，含 v4 ADR/Pitfall 追问与业界调查）

**02 锚点**：识别并落实当前适用的规则、事实、决定和授权，使约束实际改变行动。判据：适用条件、授权、禁止动作和未验证范围可回指；应暂停或缩小处实际执行。

**遵守维的独特性**：其他七维有「做完」的时刻，遵守维是**运行态纪律**——须回答两个特殊问题：规矩怎么持续在场而不漂移（Q1）、违反了怎么机械拦住（Q2）。

**Human 追问（v4 ADR/Pitfall）**：v4 设计「条件性必须读：召回时机成立时，全部 active ADR + Pitfall——会话级预检」（docs/read-dimension-understanding.md §5.1）；v4 有 8 ADR + 8 Pitfall 待搬，v5 的 ldvh-base/adrs/ 和 pitfalls/ 目录空着（机制未接、内容未搬）。ADR/Pitfall 本质是「特殊情况下必须知道并改变行为的经验」。追问暴露根本矛盾：**v4 设想「条件触发自动推送」vs 03 纪律「机器不做相关性裁决」（03 §8.2 禁相似度/embedding/关键词权重自动裁决）**。

**业界调查（四型分类 + 三层叠加答案）**：

*Cursor Rules 四型分类（cursor.com/docs/rules，官方文档）*——frontmatter 三字段（alwaysApply/globs/description）组合出四型：

| 型 | 触发 | 语义 | LDVH 对应 |
|---|---|---|---|
| Always | 每会话 | 全量在场 | 七锚点引导（已有） |
| Auto-attached（globs） | **文件路径精确匹配**（机械可判定） | 碰到 X 文件时规矩到场 | pre-execute 网关 + 按路径触发注入 |
| Agent-selected（description） | AI 读描述自己决定拉取 | 描述常驻，正文按需 | **ADR 常驻枚举 = 此型** |
| Manual（@提及） | 人显式点名 | 手动 | —— |

*关键发现*：globs 型证明**精确路径匹配的机械触发是业界共识**——glob 是字符串匹配不是相关性判断，**不违反 03 的「机器不做语义裁决」**；description 型证明「常驻描述+AI 自主拉取」是正交路线。**两者并存，不是二选一**——A/B 之争被业界答案消解。

*Claude Skills 渐进披露（platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices，官方）*：「启动时只预载全部 Skill 的元数据（name+description），Claude 只在 Skill 相关时才读 SKILL.md，再按需读更多文件」；description 写法规范=「包含做什么+何时使用（触发情境关键词）」。**与 ADR 常驻枚举设计镜像**——枚举注入标题/决定/适用条件（=元数据），正文 AI 按需 F3 展开。v4/v5 的 F1 方向与 Claude 官方架构不谋而合。

*Claude Code 权限系统（code.claude.com/docs/en/permissions）*：deny/ask 规则按 matcher 匹配路径，**deny 在任何模式（含 bypassPermissions）都生效**——「机械可判定的禁止」与「AI 判断」分层的又一官方实例。

*反直觉教训（arxiv.org/html/2602.11988v1 + reddit.com/r/ClaudeAI 1r7mvja）*：**LLM 生成的 AGENTS.md 会降低 agent 成功率、增加 20%+ 成本；人写的才有效**。对 LDVH 的含义：ADR/Pitfall 质量纪律比推送机制更重要——AI 起草的 ADR 须经验证环+Human 门才 active。v4「16 个 retired Study、13 个结论是不采用」的教训同源。

*mnemon 两项武器（源码级）*：①协议/快照分离（mnemon:runtime-memory-protocol 稳定 section order 145，易变快照作为插件自身消息按变化注入——防上下文漂移；LDVH 七锚点引导同理）；②cueAlreadyVisible（扫 surface 检查自己的提醒是否还在模型视图，rewind 后自动重注入——提醒类注入必须自愈；LDVH 注入行已实现同款丢失检测）。

**遵守维定案（五条）**：

1. **存在性**：ADR/Pitfall 常驻枚举注入——**触发情境必须写进注入摘要**（Claude description 规范：做什么+何时使用），让 AI 自主展开有据。已实现（adr-enumeration.js：全量枚举、无相关性过滤、partial 诚实报告、prompt 转义、每字段 200 字预算、超 20 对象报截断），接线待 F1 修订案定案（Human Gate draft v2 挂起中）。
2. **机械触发**：glob 型（路径/工具名**精确匹配**）合法——业界共识、不属语义裁决，03 禁令不覆盖字符串匹配。落法：pre-execute 网关（拦受保护路径/机械症状）+ 路径命中注入（提醒）。
3. **语义触发**：保持 03 纪律——AI 读枚举自主展开（F3），机器不做相关性裁决。**不需要改 03**。
4. **质量门**：AI 起草的 ADR/Pitfall 经验证环+Human 门才 active（防 LLM 自产规矩污染——arXiv 教训）。
5. **自愈**：一切提醒类注入带可见性自检（mnemon cueAlreadyVisible 模式，注入行已实现）。

**三层漏斗（越界拦截）**：

| 层 | 机制 | 状态 |
|---|---|---|
| 宿主沙箱 | workspace-write 内自由、跨出需审批卡 | ✅ 已用（每回合系统提示可见） |
| LDVH 网关 | tools/pre-execute：受保护路径（00 §4.3 五类）与事实对象结构的写操作 → deny（带 reason）或 ask（弹审批卡，宿主原生零 UI 开发） | ❌ 待接（08 §6 修订方向） |
| Git Gate 终闸 | commit-msg 钩子 | ✅ 已用 |

**深防御认知（Human 已确认接受）**：pre-execute 网拦的是「工具调用」——AI 用宿主外路径改文件（如让子代理改）网关看不见。网关=事前提示，落盘门=落盘保证（内容进仓库前的最后闸），Git Gate=终闸。三层各管一段，不是完整保证。

**Human 决定（相互作用）**：暂不动 03；机械字段纪律重申为现行规范；写前指纹门采用 SHA-256 非 mtime；03 §9.4 重新诠释攒进大批次。

**v4 内容搬运欠账（继承事项）**：8 ADR + 8 Pitfall 从 v4 仓库受控搬运（/Users/dmh2002/poker_hud_projects/ld-vibe-harness-v4，只读参考）——随 F0–F4 事实层批次；搬运即写维模型第一个真实用户。

### 3.1 遵守维串联复过记录（2026-09-06）

串联第二站。结论四条：

1. **定案第 1 条表述修订（与读维 §1.1 对齐）**：常驻枚举从「ADR/Pitfall 常驻枚举注入」改为「**ADR 对象级常驻 + Pitfall 标签级常驻**」（Human 裁定 Pitfall 也是常驻，但常驻的是标签层；见 §1.1 裁决 1/2）。**标签规范待补**（Human 2026-09-06 记：标签定义、命名、归并、演进须有一纸规范——待办已登记 §1.1 裁决 3）。
2. **ADR 枚举接线维持挂起**（Human 定「先挂着，事实对象都还没起草」）——顺序依据成立：枚举注入以存在 active ADR 为前提，内容先于机制接线。解冻时机=事实层首批起草/搬运完成之后。
3. **pre-execute 网关归写维站讨论**（Human 指正：拦截写操作属「写」的议题，不属遵守维）——本维只保留「机械触发合法性」的结论（定案第 2 条），网关实现排期移至写维站。
4. **定案第 2–5 条复核**：Human 明确「现在完全无法判断」——四条维持原定案不推翻，不视作串联确认；带实际使用经验回来再验（与 §6.4/§7.3 未决口袋同等待遇）。

---

## 4. 审议维（Human 定案 2026-09-05，含两项 Human 新增论点）

**02 锚点**：把 Human 意图经必要信息读取、多视角扩散和规范、事实、价值、能力、成本、风险约束，收敛为可执行或可交 Human 决定的方案。判据：问题、场景、反例、替代方案、排除范围和未解决取舍清楚；采纳和排除有依据。

### 4.1 Human 关键论点（本轮新增，两项）

**论点一：审议与执行同构（行动编排），但审议要求 AI 之间能讨论、紧紧围绕目标**
——审议不是「一个 AI 想完→写计划→交人」，而是**多 AI 实体围绕目标反复对话收敛**。比 spec-kit 单向命令链更接近 MAD 研究的 tit-for-tat 辩论结构。

**论点二：审议需要项目级锚——新增事实对象「项目目标」与「项目规范与价值」**
——LDVH 定义了自己的 00（存在理由/价值），但每个管辖项目也要定义自己的。理由（主控补强）：MAD 研究证明无结构的多视角会漂移（agents 聊着聊着忘了题目）；**讨论必须锚在比当前话题更高的目标对象上**——「目标的目标与方向」（Human 原话）。

**Human 补充（定案）**：已存在并激活的 ADR 也是讨论要知道的信息——审议的上下文三件套之一。

### 4.2 调查发现（四来源体系）

*发现一：审议是漏斗，三个不相干项目演化出同一形状*（[spec-kit](https://github.com/github/spec-kit)、[Claude Code plan mode 逆向](https://lucumr.pocoo.org/2025/12/17/what-is-plan-mode/)、[Refine-Plan-Act](https://medium.com/engineering-in-the-age-of-ai/the-refine-plan-act-pattern-for-agentic-ai-coding-59ee013e4427)）：

```
扩散（读+问+多视角） → 收敛（结构化文档） → 审查（Human Gate） → 执行
```

Claude plan mode 四阶段（Armin Ronacher 逆向系统提示词）：Phase 1 Initial Understanding（读代码+问用户）→ Phase 2 Design（子代理并行探索）→ Phase 3 Review（读关键文件+继续问+**确保与用户原始请求对齐**）→ Phase 4 Final Plan（**只写推荐方案不写备选**、含关键文件路径）。

spec-kit 命令链（spec-driven.md 官方）：`/speckit.clarify`（澄清 underspecified，推荐在 plan 之前，前身 quizme）→ `/speckit.specify`（模板强制 WHAT/WHY **禁止 HOW**）→ `/speckit.plan`（宪法合规检查）→ `/speckit.tasks`（任务派生+[P] 并行标记）。两个模板级约束：**[NEEDS CLARIFICATION] 强制不确定性标记**（逼 AI 承认没想清楚，而不是编）；**研究 agent 全程在场**（审议期读取是常态）。

spec-kit Constitution（宪法）：项目级价值与原则的对象化，每条 plan 过宪法合规检查——**「项目规范与价值」需要对象化且参与每次审议审查判据的业界印证**。

Claude plan mode 的弱点（反衬 Human 论点二）：Phase 3 对齐判据靠把原话塞上下文，**无持久化目标对象**——长对话后目标漂移只能靠人脑记。

*发现二：多视角的正确姿势——MAD 四代研究的边界条件*（[综述](https://hungleai.substack.com/p/agree-or-disagree-a-review-of-multi)：Du et al. 2023 Society of Minds → Liang et al. 2023 tit-for-tat+judge → ConfMAD → MAD-M2）：

| 结论 | LDVH 含义 |
|---|---|
| 广播式有效但不稳：agents 全错时辩论能拉向正确；**但错误共识会被相互确认** | 「多视角」不能只是多问几个 agent——同模型同 prompt 克隆有共同盲区 |
| **角色强制分歧（tit-for-tat+judge）是主要改进**：正反方+仲裁者，防过早收敛（DoT 退化） | LDVH 对抗审核（一/二/三审实例）恰好是这个结构——审查者与候选形成者角色隔离 |
| **judge 能力是天花板**：弱 judge 无法裁决强 debater | **主控（单一责任人）必须是 judge**——与 00 §5「单一主控最终负责」互证 |
| **错误记忆有毒性**：早期错误响应留在上下文毒化后续轮（MAD-M2 记忆遮罩动机） | 被否决方案须**明确标记排除理由**——02 判据「排除范围清楚」的机制依据 |

*发现三：mnemon 有界 worker——隔离视角的最成熟工程实现*（调查报告 §5.2，源码级）：spawn worker = 新隔离上下文 + 固定 persona + 最小工具允许清单（写类 12 个；answer/placement 类**零工具**）+ schema 校验**随机命名一次性 result 工具**（防状态复用）+ maxDepth 1 + per-op maxTokens。DSH 宿主对应：subagents.startContinuable + registerContinuableSetup——**冻结的子代理遗产在审议维复活**（委派链机制已建，缺审议型子代理的 persona/工具清单设计）。

### 4.3 审议上下文三件套（Human 定案）

讨论开始前必须到场的项目级信息（防无锚漂移）：

| 件 | 内容 | 承载 |
|---|---|---|
| **项目目标（Goal）** | 项目的长期目标与方向、当前意图——「目标的目标与方向」 | 新增项目级事实对象（Human 决定新增，形态待定） |
| **项目规范与价值（Charter）** | 项目自己的宪法——价值排序、质量红线、领域约束（LDVH 规范源管框架，Charter 管项目，分层） | 同上 |
| **已激活 ADR** | 项目的既有架构决定——讨论不得与既有决定冲突，冲突须显式提出重审 | ADR 常驻枚举（遵守维已定案，adr-enumeration.js 已实现待接线） |

三件套进上下文的通道：注入行机制（已建成）或系统段（已建成）——机制现成，内容层待建。

### 4.4 审议维定案（五条）

1. **漏斗形态**：扩散（读+问+多视角）→ 收敛（结构化文档）→ 审查（Human Gate）→ 执行。四阶段形态与业界三来源一致，LDVH 以 userQuestions.ask 直调 + plan-review intent 承载问询与计划审查（B′ 盘点：detail/intent 须自有工具，exit_plan_mode 为官方先例）。
2. **AI 间讨论**：多 AI 实体围绕目标反复对话收敛（Human 论点一）。**形态以 dsh-solo-thinking 思考树为参照（Human 2026-09-05 修正归属：它就是审议的技术手段，不是复核维的）**——独立 Session 思考树 + 显式 Handoff 交换（见 4.6）；通道层 subagents 多 spawn + team/message 事件；视角=persona+Charter 条款（正方引价值 A、反方引价值 B——**结构化分歧而非克隆吵架**，MAD tit-for-tat 结论）；**主控必须是 judge**（00 §5 单一主控与 MAD judge 天花板互证）。
3. **审议上下文三件套**：Goal/Charter/已激活 ADR 讨论前到场（Human 定案，含新增两项项目级事实对象——见 4.5）。
4. **错误记忆防护**：被否决方案明确标记排除理由（一行「为什么否」），防 MAD-M2 证实的毒化；最终文档只写推荐方案+排除理由一行（调和 Claude「只写推荐」与 02「排除范围清楚」——两端判据都保住）。
5. **与执行维同构**：都是行动编排（Human 论点）。差异在权限态——审议期讨论不落任何受控载体（除草案），执行期产出落盘走写维；形态上审议=编排对话，执行=编排动作；模板层（04）可共用骨架。

### 4.5 新增项目级事实对象（Human 决定，规范调整放后面——先入草案）

| 对象 | 语义 | 生命周期 | 消费方 |
|---|---|---|---|
| **项目目标（Goal）** | 项目长期目标与方向、当前意图 | 长期驻留、Human 定、定期回顾修订 | 审议的锚；执行维目标来源；反思维对照基线 |
| **项目规范与价值（Charter）** | 项目宪法——价值排序、质量红线、领域约束 | 长期驻留、Human 定、修订走 Human Gate | 审议的审查判据（spec-kit Constitution 同位）；遵守维项目级规则来源 |

分层图景：LDVH 规范源（全局一份，管框架）→ 项目 Charter/Goal（每项目，管价值与方向）→ WorkCase/ADR/Pitfall（每项目，管事件）。

**实现路线（Human 已定「规范放后面，先说草案」）**：轻量起步——Charter/Goal 先作为受控文档（走写维落盘模型：AI 起草→验证环→Human 门），审议维直接消费（注入行/系统段机制现成）；类型化（并入 20–24 或立 25+）在 20–24 起草时一并决定，不在本草案冻结字段闭集。

**注意**：03 现行五类为 ADR/Pitfall/Spark/WorkCase/Study（§5.3），无 Goal/Charter；新增类型属 00 §4.2 根决定（改变事实模型类型清单）。本草案只登记决定与轻量路线，类型化决定留给 20–24 起草批次的 Human Gate。

### 4.6 头脑风暴思考树——审议的技术手段（Human 2026-09-05 指定记录）

**归属修正（Human 裁定）**：dsh-solo-thinking 是审议维的技术手段，不是复核维的。复核维只借三样与讨论语义无关的工程件（独立 Session 证据池隔离 / turn-end 锁恢复 / revision 乐观锁+串行写）。

**它是什么**：独立 Session 思考树 + 显式 Handoff 交换（v0.1.19，本地 /Users/dmh2002/DshProject/dsh-solo-thinking；完整调研见 docs/investigation-report-dsh-solo-thinking.md，156 行双路子代理+主控源码核验）。每 ThinkingNode 1:1 一个 DSH Session，父子**永不共享原始对话**，分支间只交换 Agent 主动撰写的三种 Handoff：

| Handoff 角色 | 语义 | 审议维对应 |
|---|---|---|
| inherited（继承） | 父→子，不可变 | **审议三件套顺着树往下传**——Goal/Charter/父结论随分支出生（「锚」的机械载体，解决 Human 论点二） |
| checkpoint（现状） | 可替换的 Current State | 讨论中期成果的跨分支同步（不唤醒兄弟） |
| returned（回传） | 子→父终态，封存 | **讨论结论的只读交付**——后续复核/执行引用封存版而非漂移版 |

**为什么它比裸通道更适合审议**（对照草案原方案）：

| 原方案（仅通道） | 思考树给出结构 |
|---|---|
| subagents 多 spawn 只是通道 | 树形拓扑=视角关系显式化 |
| persona+Charter 分歧靠提示 | **+inherited Handoff 锚定**：每分支带 Goal 出生，MAD 研究的「无锚漂移」被结构性解决 |
| 自由消息往返 | **Handoff 六段结构**（目标/结论/证据/风险/未解/下一步）——讨论产出物有纪律形态，与 LDVH 交接包同构 |
| 无成本控制 | **休眠建议**：2-4 方向 dormant 物化、Human/主控选定才唤醒——扩散不等于全跑 |
| 结论可漂移 | **回传封存**：returned 终态只读，拓扑约束（根不可 return、有活跃子不可 return）机械强制审计完整性 |

**三条 Host 级硬不变量**（隔离/休眠/封存全部宿主强制非自律）：renderBranchContext 只渲染 published Handoff 且写死「Never infer or request another branch's raw transcript」；dormant:true 出生+pre-step 对 returned/pending 节点 reject；回传拓扑由状态机断言。

**工程件**：followup 模式（先写锁→推 user-role notice→await whenIdle「一次只让父干一件事」）；事件溯源 whole-value 投影（solo-thinking/state 事件、revision 乐观锁、serializeWrite 串行、turn/end 锁恢复 recoverIncompleteOperation 中断自动回滚）。

**LDVH 吸收边界**（三条避免 + v5-handoff 红线）：
- 避免 MARKER 文本路由（[solo-thinking:return-request] 靠 LLM 认前缀——脆弱，LDVH 走 tool calling 不必用 marker）
- 避免 whole-value 复制全节点（>40 节点膨胀；LDVH 审议分支少（2-5）可接受，全量编排应换 reference/event sourcing）
- 避免「at most one」靠 persona（凡「AI 必须不…」应自问机械可证还是自律）
- 红线（v5-handoff §4）：**不搬思考树/Handoff 作事实交换协议**（Agent 自述无指纹验证）——审议讨论用思考树，事实落位仍走写维落盘指纹门；不搬其状态机

**与 LDVH 已建机制的关系**：八维表宿主指向层面它是审议/复核的最佳形态参照；其「独立 Session + 继承检查点」与 mnemon fork worker（idle 审查、默认不动、审查推理不进主对话）互为印证；其 turn/end 锁恢复可服务执行维的中断恢复。

## 5. 复核维（Human 定案 2026-09-05，三点裁定全确认）

**02 锚点**：依据已确定的目标、方案、授权和成功标准，检查实际工作、结果、证据和完成声明。机制指向四项：行动模板完成门禁、事实证据边界、Helper 与 Code 的机械结果、独立/继承/新鲜或对抗执行体。

### 5.1 三份一手证据

*证据一：自检盲区是实测现象*（[信息论分析](https://www.preprints.org/manuscript/202601.0892)，14 模型实测）：**LLM 把自己的错误作为外部输入时能纠正，同样错误在自己输出里纠正不了**——Self-Correction Blind Spot 平均 **64.5% 失败率**。理论：共享盲区模型下 k 轮自我批评的置信度增量被共同潜在失败变量封顶——**自评加的置信不是独立证据**。

*证据二：新鲜上下文复核是工程共识*（[Rajiv Prab 13 步工作流](https://software.rajivprab.com/2026/07/13/using-subagents-to-improve-claude-code/)）：fresh subagent 复核「另一个 agent 的成果」，**同模型同 harness 也更有效**（消除作者先入之见）；分权制衡——测试/实现/验证不同 subagent（对 reward hacking 的对策：实现者无法用不全面测试骗过验证者）；**文件为信道**（防电话游戏）；循环终止条件——review→judge→修复→再 review，直到某轮只修 minor 或零发现；每轮留档成审计链。

*证据三：LDVH 自家活案例*：①失效样本——主控谎报「已修 7 处」实际零处落盘（00 §7 防自欺锚点拦下；同上下文自查不可信的实证）；②有效样本——可见性候选一/二/三审（一审抓 13 项、补审推翻主控 2/5 项判断：A2 与代码相反、E2 自证结构——隔离上下文对抗复核真实有效）；③反向验证方法论（断言「测试有效」前先禁用被测逻辑看测试变红）——机械复核的复核，本会话三次实践。

### 5.2 逐项映射

| 机制指向 | ①宿主机制 | ②参考项目 | ③采用技术 | 状态 |
|---|---|---|---|---|
| 独立执行体 | subagents.startContinuable（fresh Session）；solo-thinking 独立 Session 证据池隔离 | Rajiv fresh subagent；论文 64.5%；本会话补审实例 | **默认形态**：复核=新 Session 子代理 | 宿主✅ LDVH❌ |
| 继承执行体 | subagents fork（继承检查点） | mnemon fork worker（idle 审查、默认不动、审查推理不进主对话） | 修正案复核等轻量场景 | 宿主✅ LDVH❌ |
| 对抗执行体 | 多 spawn + persona | MAD tit-for-tat；三审实例 | 高风险：攻击者姿态（01 §12「主动寻找错误」原文） | 宿主✅ LDVH❌ |
| 机械结果 | tools/pre-execute 网关（准入）、Git Gate（终闸）、precheck | 本会话 294 测试+预检体系 | 已有——复核维机械底盘 | ✅ |
| 完成门禁 | —（宿主无门禁概念） | spec-kit converge（gap 评估→追加任务→复验）；[spec-kit#1865](https://github.com/github/spec-kit/issues/1865)（验证 [X] 任务：文件存在+git diff+模式匹配） | 门禁=验证行（机械）+独立复核（语义）双层，机械先行 | ❌ 04 承接 |
| 事实证据边界 | 读维通道（F0–F4） | 03 §9.7 写后回读+适用完整性审计 | 已定义，随事实层批次 | 03✅ 实现❌ |
| 复核结论形态 | — | solo-thinking returned 封存；Rajiv 每轮 review 文件留档 | **复核结论=封存交付**（不可编辑），轮次留档成审计链 | ❌ |

### 5.3 Human 三点裁定（全确认，2026-09-05）

1. **独立优先**：凡产生可强制执行规则/事实落位/完成声明的场合，复核必须独立（新 Session），**不接受同上下文自查**；低风险（格式/引用核对）可继承或自查。依据：64.5% 自检盲区实测 + 本会话谎报被独立复核抓住而自查漏掉的实证。02「按风险选择最小充分视角」保留，但独立性是高风险场合的下限不是选项。
2. **文件为信道**：复核任务的输入=**封存的被审对象+判断标准+证据锚点**三样，**不含形成过程**（防被叙述带偏）。与 solo-thinking「永不共享 raw」、Rajiv「不进对话只读文件」、本会话三审任务书实际做法（给候选文件+规范清单，不给讨论历史）四方一致。
3. **双层完成声明**：完成=「机械检查过（测试绿/Gate 放行/precheck 通过）」**且**「独立复核通过（按判据）」。机械层已闭环；**凡验证表存在的行动，完成声明前必过独立复核**——复核从「可选增强」升格为完成声明的组成部分。

### 5.4 复核维定案（五条）

1. 独立优先（新 Session 子代理为默认复核形态，高风险不接受自查——自检盲区 64.5% 实测封顶了自评价值）
2. 文件为信道（封存对象+标准+锚点三件输入，无形成过程——防叙述带偏）
3. 双层完成声明（机械+独立复核都过才算完成；验证表行动必过）
4. 分权制衡（测试/实现/验证不同子代理——Rajiv 分权对 reward hacking 的对策；防「实现者用不全面测试自证」）
5. 复核结论封存（returned 式只读交付+轮次留档审计链；复核结论不再被编辑，修正走新轮次）

## 6. 执行维（讨论中——Human 暂缓决定，记录于 2026-09-05，之后慢慢完善）

**状态**：未定案。本轮完成概念澄清与两层切分，两项裁定 Human 明确「现在做不了决定，之后慢慢完善」——本节如实记录讨论状态与待决点，不冒充定案。

**02 锚点**：由主控在规范、事实和授权范围内组织行动、委派、依赖、异常处置、恢复和验证，形成实际结果并完成交还。判据：行动与目标、方案、授权和作用范围一致；局部结果被主控核对和整合；完成声明不超过证据。边界：Team task、工具、测试或 commit 完成不证明整体完成；能力不可用时停止、缩小、分流或交还。

### 6.1 概念澄清（Human 提问触发：「执行还分很多执行，这个维度有点大，本意是 v4 的 WC 的执行」）

主控最初把执行维理解成「编排技术层」（怎么 spawn 子代理、恢复中断、复用哪个服务）——**Human 指出偏了**。v4 的 WC 执行是**完整的工作包生命周期治理**。主控随后读了 v4 真实 WorkCase（workcase-01KZXN5TXNE14BZVTYJ3Y64PKK.yaml 全文）与 v4 问题账 E 主题（20 项，最大主题），确认两层切分：

| 层 | 是什么 | v4 对应 | 宿主对应 |
|---|---|---|---|
| **工作包执行**（WC 本意，02 判据所指层） | 一次 Human 授权的完整工作包：批准冻结→执行循环→复核→关闭→交还 | WorkCase 生命周期（152 个实证）+ E 主题 18 项纪律 | **宿主原生 goals 服务**（create/edit/complete/blocked + goal/change 事件 + 轮次修订——与 WC 的 Gate1→executing→Gate2 同构） |
| **委派编排**（工作包的内件） | 工作包内部怎么分活给子代理、恢复中断 | WC 的 item 循环 | subagents/team/workflow——内部实现手段，细节归 04 模板 |

**v4 WorkCase 实证结构**（真实 YAML 核验）：goal（目标）/ scope（作用范围，精确到目录与排除项）/ success_criterion_definitions（成功判据逐条定义）/ success_criterion_results（逐条核对结果）/ change_log（带签名的行动流水：agent_id+session_id+时间戳+摘要）/ result_summary / validation_summary（主执行与独立只读复核双跑）。**E 主题 18 项 implemented 纪律**：谎报独立审核（051）、防止提前交还（056）、续跑守卫（060）、Human 主动终止链（074）、不可独立审核时报告询问（092）、Gate 1 授权完整性（034）、执行期 Human 输入（047）、item 生命周期拦截（067）等——全是执行期治理，防 AI 中途跑偏/谎报/越权/提前收工。

### 6.2 一项事实修正（Human 纠错：AgentTeams 不是宿主原生的）

主控曾把 @nanmicoder/dsh-agent-teams 当宿主原生——**错**。核实：它是第三方插件（profile node_modules，与 mnemon 同级）。**宿主原生执行编排服务**：dsh-subagent（startContinuable/followup/reportFrom）、dsh-goal + goal-round-driver、dsh-tool-ralph、dsh-workflow、team/* 四事件类型（白名单供消费）。AgentTeams 的正确位置=参考项目（study-01M0PQHMRVEA 已调研），attempt 单调令牌/冷恢复/归档是成熟设计思想，LDVH 参照但不依赖其运行（不能假设用户装了它）；v5-handoff 红线「不搬其状态机作 LDVH 事实或规则」由此自然守住。

### 6.3 映射草案（讨论态，非定案）

| 机制指向 | ①宿主机制 | ②参考项目 | ③采用技术（草案） |
|---|---|---|---|
| 工作包生命周期 | **宿主原生 goals 服务**（生命周期+轮次+修订，与 WC 同构） | **v4 WorkCase**（152 实证+18 纪律）；AgentTeams attempt 令牌（参考） | 工作包=goal 承载（宿主）+ WC 纪律（04 模板）：批准冻结、判据先行、逐条核对、签名流水 |
| 执行期治理 | approval 审计对（执行中授权）、注入行（执行事件可见） | v4 E 主题 18 项 | 大部分纪律层归 04 模板；执行中问询走审批卡/问询 |
| 委派编排（内件） | subagents + team 事件 + workflow | solo-thinking followup/锁恢复、AgentTeams（参考非依赖） | 编排纪律归 04；表只登记通道 |
| 交还 | session.append + 注入行；**宿主无原生 Stop 事件**（v5-handoff 已核） | 00 §7.4 交还结构 | 走 turn-stopping 等价物，需验证（v5-handoff 判断仍有效） |
| 中断恢复 | turn-stopping + solo-thinking recoverIncompleteOperation 模式 | mnemon「从 receipt 恢复绝不重试突变」 | **草案（未裁）**：可重入动作（读/幂等写）→重试换道；不可重入（非幂等写/外部副作用）→绝不重试，从 receipt/日志定位后人工裁决或缩小范围 |

### 6.4 待 Human 决定的点（Human 明确暂缓：「之后慢慢完善」）

1. **工作包层是否用宿主 goals 服务承载生命周期**（goals 与 WC 的 Gate1→executing→Gate2 同构度需进一步评估：goals 的轮次/修订模型是否够表达 WC 的判据逐条核对+签名流水；或 WC 语义需自建状态而非借用 goal）
2. **中断恢复默认策略**（6.3 末行的可重入/不可重入二分——草案方向已有，未裁）
3. 委派编排的纪律细节（归 04 起草时定）
4. 交还的宿主承载验证（turn-stopping 等价物实测）
5. v4 E 主题 18 项纪律中哪些进 04 模板、哪些是 LDVH 常驻纪律（如谎报禁已是 00 §7 根原则）

## 7. 反思维（结构定案：八维保留；自查标准与项目清单未决）

**结构定案（Human 2026-09-05）**：**还是八维**——反思维保留为独立维。定位：自查机制（「很多事情做着做着，不一定都围绕目标、围绕价值的」——发现漂移的职责，其他七维都不承接）。未决：自查标准、自查项目清单（见 7.3）。

### 7.1 三轮修正轨迹（如实记录）

1. **第一轮（合并提议）**：Human 提出「八个维度改七个，反思包括在沉淀里」，主控按合并写入。
2. **第二轮（撤回单一来源）**：Human 修正「沉淀不一定来自反思，而是经验的积累」——反思只是沉淀的来源之一（执行中自然积累、委派产出、复核结论、Human 决定都是入口）；**「反思是一种自查机制」**——定位从「沉淀的来源动作」改为「对全部过程的自查」。
3. **第三轮（明确未决）**：Human 指出自查的标准、自查的项目、沉淀的表达方式**都还没讨论**——不急于定案。

### 7.2 已收敛的部分（两轮修正后仍成立的）

- 反思的定位：**自查机制**——「很多事情做着做着，不一定都是围绕目标、围绕价值的」（Human 原话），反思维负责发现漂移。这补上了其他维都不管的洞：六维都预设「行动围绕 Goal/Charter」，漂移谁发现是空白。
- 沉淀的多入口：反思候选只是其一；执行积累、复核结论、委派产出、Human 决定同为入口。
- 触发纪律 B+C（摩擦驱动 + Human 手动，不常驻）与反思环节清单住 04/Charter——未受影响。
- 沉淀分流五路表（Pitfall/Spark/规范流程/Goal-Charter 修订/不对象化）——未受影响。

### 7.3 未决问题（Human 明确点名，本轮不强行定）

| # | 问题 | 已有候选材料 |
|---|---|---|
| 1 | **以什么标准自查** | 候选：Goal/Charter 对照（审议维三件套）；00 §6 V/HV 价值判据；02 各维判据。**未讨论** |
| 2 | **自查哪些项目** | 候选：五类摩擦（失败/复核推翻/纠偏/重复摩擦）+ 判据失准 + 反复问题 + 预检失守 + 交互断点。**未讨论**（此前只定了触发时机，没定自查对象清单） |
| 3 | **沉淀最后用什么方式表达** | v4 实证：YAML 对象（六段 Pitfall/分流 Spark）；候选：结构化对象 vs 受控文档 vs 简化为 Charter 附注。**新增候选（Human 2026-09-06 提出倾向「LDVH 也需要这个可选项」）：LDVH 自建可选热记忆层**——参照 mnemon runtime memory 机制（事实源/投影分离+原子写+容量纪律绝不静默截断+revision 门控压缩+分支作用域投影+协议/快照分离注入，源码级调研见 docs/investigation-report-dsh-mnemon.md §2.1）；定位=**沉淀分流的中间档**（不值得对象化但跨会话有保留价值的内容——补全「丢弃↔热记忆↔正式对象化」光谱）；**LDVH 加料纪律（防双源污染，调研报告 §5.5 预判）：条目不得转述事实对象只存指针、冲突时事实源胜、注入段明示「线索非权威，事实以回读为准」**——与读维「指针过信道」同根推广。**未讨论（沉淀维串联站正式裁决：可选开关形态/与 dsh-mnemon 共存策略/写入是否轻验证/compact 生命周期）** |
| 4 | ~~八维还是七维（结构本身）~~ | **已裁定（Human 2026-09-05）：还是八维**——反思保留为独立维（自查机制，发现漂移的职责其他维不承接），沉淀保留为独立维（多入口）。七维合并提议经三轮讨论撤回 |

## 8. 沉淀维（结构定案：独立维、多入口；表达方式未决）

**结构定案（Human 2026-09-05）**：沉淀保留为独立维。来源多入口（反思候选、执行积累、复核结论、委派产出、Human 决定——不止反思）。未决：表达方式（未决问题 3）。

### 8.1 已收敛的部分

- 职责不变（02 原文）：判断哪些认识和结果值得跨行动保留、进什么稳定位置。
- **来源多入口（Human 第二轮定）**：反思候选、执行积累、复核结论、委派产出、Human 决定——不止反思。
- 落位三问（消费对象/边界/去向）与五路分流表（见 7.2）。
- 效用回看：最小落法=召回/引用计数（mnemon lastAccessedAt 先例），HV4 审计不预定义。
- **热记忆中间档（Human 2026-09-06 倾向，候选非定案）**：LDVH 自建可选热记忆层——五路分流表「不对象化」一路获得中间去向（丢弃↔**热记忆（有限期/受容量纪律约束）**↔正式对象化）；机制移植清单与防双源纪律见 §7.3 第 3 行；沉淀维串联站裁决开关形态/与 dsh-mnemon 共存/写权限/生命周期四点。

### 8.2 与审议维 Goal/Charter 的呼应

沉淀的去向之一是 Goal/Charter 修订（学到的东西改宪法）——八维至此首尾相接；同时未决问题 3（表达方式）的答案可能影响 Goal/Charter 自身的轻量起步形态（审议维定的「先受控文档」路线是否也适用于 Pitfall/Spark）。

---

## 附录 A：外部调查来源清单（供对抗审核核对）

| # | 来源 | URL | 用于 |
|---|---|---|---|
| 1 | GitHub spec-kit | https://github.com/github/spec-kit | 写维验证环先例（133k★） |
| 2 | OpenSpec Issue #829 | https://github.com/Fission-AI/OpenSpec/issues/829 | 写维：schema 声明式验证提案；SHA-256 摒弃 mtime 的理由（跨平台）；「deterministic checks are CLI-shaped; semantic review is the skill」分层原则 |
| 3 | Reddit：多会话共享记忆 | https://www.reddit.com/r/ClaudeCode/comments/1v3q7cx/ | 写维并发：三方合并+锁+丢内容拒绝 |
| 4 | Cursor Rules 官方文档 | https://cursor.com/docs/rules | 遵守维四型分类（alwaysApply/globs/description/manual）；glob=机械匹配的业界共识 |
| 5 | Claude Skills 最佳实践 | https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices | 遵守维渐进披露（元数据预载+按需展开）；description 写法规范（做什么+何时使用）；反馈环模式；「AI 已很聪明，只加它不知道的」 |
| 6 | Claude Code 权限文档 | https://code.claude.com/docs/en/permissions | 遵守维：deny/ask 按路径 matcher；deny 全模式生效 |
| 7 | arXiv 2602.11988 | https://arxiv.org/html/2602.11988v1 | 遵守维质量门：LLM 生成上下文文件降低成功率、+20% 成本 |
| 8 | Reddit：AGENTS.md 研究讨论 | https://www.reddit.com/r/ClaudeAI/comments/1r7mvja/ | 同上社区印证 |
| 9 | HumanLayer：Writing a good CLAUDE.md | https://www.humanlayer.dev/blog/writing-a-good-claude-md | 写维/遵守维：「less is more」、CLAUDE.md 定位 WHY/WHAT/HOW |
| 10 | Claude Code Memory 文档 | https://code.claude.com/docs/en/memory | 读维：CLAUDE.md 200 行目标、.claude/rules/ 分模块、@import 机制 |
| 11 | mnemon 源码（本机 ~/.dsh/profiles/desktop/node_modules/dsh-mnemon） | — | 协议/快照分离（guidance.ts 56-62）；cueAlreadyVisible（lib/index.js 8248-8253）；expectedRevision CAS；receipt 恢复纪律；「LLM 只产候选宿主记账」（调查报告 docs/investigation-report-dsh-mnemon.md） |
| 12 | apenwarr 文件锁长文 | https://apenwarr.ca/log/20101213 | 写维并发：advisory lock 边界认知 |
| 13 | Claude Code plan mode 逆向（Armin Ronacher） | https://lucumr.pocoo.org/2025/12/17/what-is-plan-mode/ | 审议维：四阶段系统提示词解剖；Phase 3 对齐判据无持久化目标对象（反衬 Goal 对象必要性）；「只写推荐方案」原文 |
| 14 | spec-kit spec-driven.md（官方方法论文档） | https://github.com/github/spec-kit/blob/main/spec-driven.md | 审议维：SDD 四命令链；[NEEDS CLARIFICATION] 强制不确定性标记；Constitution 宪法合规检查（Charter 同位物）；模板禁 HOW 只写 WHAT/WHY |
| 15 | Refine-Plan-Act 模式（Medium 工程实践） | https://medium.com/engineering-in-the-age-of-ai/the-refine-plan-act-pattern-for-agentic-ai-coding-59ee013e4427 | 审议维：每阶段显式停（Do not proceed / ASK before proceeding） |
| 16 | 多智能体辩论综述（Neurocoder Tales） | https://hungleai.substack.com/p/agree-or-disagree-a-review-of-multi | 审议维：MAD 四代研究（Society of Minds→tit-for-tat+judge→ConfMAD→MAD-M2）；错误共识相互确认；judge 天花板；错误记忆毒化与遮罩 |
| 17 | spec-kit /clarify 教程（YouTube 官方系列 #4） | https://www.youtube.com/watch?v=h3LMQE_kKNs | 审议维：clarify 命令用法（coverage 表） |
| 18 | Self-Correction Blind Spot 信息论分析 | https://www.preprints.org/manuscript/202601.0892 | 复核维：14 模型实测 64.5% 自检盲区；共享盲区模型（自评置信非独立证据） |
| 19 | Rajiv Prab：Using Subagents（13 步工作流） | https://software.rajivprab.com/2026/07/13/using-subagents-to-improve-claude-code/ | 复核维：fresh subagent 复核、分权制衡（reward hacking 对策）、文件为信道、review 循环终止条件、审计链 |
| 20 | spec-kit Issue #1865（verify-tasks 提案） | https://github.com/github/spec-kit/issues/1865 | 复核维：[X] 任务真做了的机械验证（文件存在+diff+模式匹配） |
| 21 | 9 并行复核 agent 配置（HAMY 博客） | https://hamy.xyz/blog/2026-02_code-reviews-claude-subagents | 复核维：多视角并行复核的实践实例（test/lint/review/security/quality/test-quality/perf/deps/simplification 九路） |
| 22 | Michael Nygard：ADR 起点（2011） | https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions | 读维 F 层：ADR 五节结构；编号单调不复用；superseded 指针式演变（不可变+指针共识源头） |
| 23 | MADR 官网与模板精读 | https://adr.github.io/madr/ ；https://ozimmer.ch/practices/2022/11/22/MADRTemplatePrimer.html | 读维 F 层：ADR frontmatter 元数据（status/date/deciders/consulted/informed）；Confirmation 节（与复核维对齐）；大项目子目录分类 |
| 24 | Y-Statement（Olaf Zimmermann） | https://ozimmer.ch/practices/2020/04/27/ArchitectureDecisionMaking.html | 读维 F2 摘要层：六要素单句（context/facing/decided/neglected/achieve/accepting）= 行业验证的一屏决策摘要 |
| 25 | adr-tools / log4brains / adr-tooling | https://github.com/npryce/adr-tools ；https://github.com/thomvaill/log4brains ；https://adr.github.io/adr-tooling/ | 读维枚举层：行业事实标准=编号+标题+status(+date)，可由文件名/frontmatter/git log 推导；索引靠生成式 TOC+搜索而非全文扫描 |
| 26 | Agent Skills 开放规范 | https://agentskills.io/specification | 读维预算锚点：元数据 ~100 tokens/skill 预载、正文 <5000 tokens/<500 行、资源按需一层深 |
| 27 | Anthropic：Effective context engineering | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | 读维总原则：最小高信号 token 集；稳定关键上下文预载+JIT 探索混合策略；文件系统即元数据 |
| 28 | Claude Code Memory 官方文档 | https://code.claude.com/docs/en/memory | 读维预算锚点：CLAUDE.md <200 行、auto memory 前 200 行/25KB；子目录按需加载=两层披露先例 |
| 29 | Google SRE blameless postmortem（示例+文化章） | https://sre.google/sre-book/example-postmortem/ ；https://sre.google/sre-book/postmortem-culture/ | 读维 Pitfall 对照：postmortem 字段（Impact/Root Causes/Trigger/Resolution/Lessons/Where we got lucky/Action Items）与 v4 六段高度同构；「为机器可分析增强元数据」是 Google 自己的模板演进方向 |
| 30 | incident.io：SRE post-mortem 最佳实践 | https://incident.io/blog/sre-incident-postmortem-best-practices | 读维 Pitfall：最小机器可检索元数据集（编号/标题/类型/状态/严重度/日期/Owner/关联）；Severity 分级先例 |

## 附录 B：内部证据锚点（供对抗审核核对）

| # | 断言 | 证据位置 |
|---|---|---|
| 1 | compaction 不删原始事件 | dsh-compaction/README.zh.md 行 95；surface.js 行 36-41 注释；Chat UI isAppendSurfaceEvent 渲染（client.js 5181） |
| 2 | tools/pre-execute 三态 | dsh-tools/lib/types/index.js 869 起；serviceAsk 1078-1115 |
| 3 | userQuestions detail/intent 模型面不可达 | dsh-tool-ask-user/lib/index.js 96-111 |
| 4 | exit_plan_mode 先例 | dsh-plan-mode/lib/types/index.js 272-361 |
| 5 | 审计对 | dsh-user-approval/lib/index.js 148-158 |
| 6 | 沙箱三态与升权 | dsh-sandbox-policy 全文；dsh-sandbox/lib/index.js 29-111 |
| 7 | 47 事件白名单 | dsh-session/lib/types/known-event-types.js |
| 8 | settings expectedRevision=乐观锁 | dsh-settings/lib/index.js 316-430 |
| 9 | specs 寻址缺陷 | plugin/lib/ldvh-tools.js 第 77 行 |
| 10 | ADR 枚举已实现未接线 | plugin/lib/adr-enumeration.js 头注（F1 修订案 Human Gate draft v2 挂起） |
| 11 | v4 ADR/Pitfall 待搬 8+8 | docs/v5-handoff.md §5；v4 仓库路径见该文档 §5 |
| 12 | 注入行丢失检测已实现 | plugin/lib/guidance.js pre-step（rewind/clear 重注入，测试锁定） |
| 13 | 03 五类现行为 ADR/Pitfall/Spark/WorkCase/Study | specs/03 §5.2（第 94 行）+ §5.3（第 112-116 行）；无 Goal/Charter |
| 14 | team 消息协议在事件白名单 | specs/03 无关；docs/dsh-host-capability-survey-data.md §2.1 事件 35-38（team/member、team/task、team/message/queued、team/message/delivered） |
| 15 | subagents 服务含 registerContinuableSetup | docs/dsh-host-reference.md §6（ctx.subagents，行 396-423） |
| 16 | plan-review intent 唯一词汇 | docs/dsh-host-capability-survey-interaction-ui.md §2.2.3-2.2.4（intent.kind 闭集仅 plan-review；exit_plan_mode 行 272-361） |
| 17 | dsh-solo-thinking 完整调研（第一手源码核验） | docs/investigation-report-dsh-solo-thinking.md（156 行）；项目本体 /Users/dmh2002/DshProject/dsh-solo-thinking（v0.1.19）；架构 docs/ARCHITECTURE.md；硬不变量出处 domain.ts:407/481-489、index.ts:404-408 |
| 18 | AgentTeams 是第三方非宿主（Human 纠错） | 实测：宿主包无 team 编排服务（@deepseek-ai 下仅 client-ui-subagent/goal/workflow/ralph 等原生件）；dsh-agent-teams 位于 ~/.dsh/profiles/desktop/node_modules/@nanmicoder/（第三方，v5-handoff 行 92「@nanmicoder/dsh-agent-teams@0.1.13」） |
| 19 | v4 WorkCase 真实结构 | /Users/dmh2002/poker_hud_projects/ld-vibe-harness-v4/ldvh-base/workcases/workcase-01KZXN5TXNE14BZVTYJ3Y64PKK.yaml（全文核验：goal/scope/判据定义与结果/签名 change_log/双验证 summary）；152 个 WC 统计见 docs/v4-problem-ledger.md 行 12 |
| 20 | v4 E 主题 18 项执行纪律 | docs/v4-problem-ledger.md §E（WorkCase 与执行流程，最大主题 20 项：谎报审核/提前交还防护/续跑守卫/终止链/Gate1 授权完整性等） |
| 21 | 宿主原生 goals 服务 | docs/dsh-host-reference.md §6（ctx.goals：get/create/edit/complete/blocked + revision，行 374-394） |
| 22 | v4 Pitfall 真实结构（六段闭合） | /Users/dmh2002/poker_hud_projects/ld-vibe-harness-v4/ldvh-base/pitfalls/ 首个 YAML 全文核验（symptoms/trigger_conditions/root_cause/resolution/avoidance/applicability） |
| 23 | v4 Spark=分流器（disposition_summary 后退役） | 同仓库 sparks/ 首个 YAML 全文核验（intent+disposition_summary「已由 adr-0006 和 workcase-0013 承接，不再保留独立待处置内容」） |
| 24 | mnemon idle review（反思触发参照） | ~/.dsh/profiles/desktop/node_modules/dsh-mnemon lib/index.js scheduleIdleReview（调查报告 §5.4）；lastAccessedAt 进索引 LRU 归档（§3.1） |
| 25 | 八维→七维受影响的规范文本 | 实测 grep：00 行 75/92/96+§4.2；01 §8.1+Att.01；02 行 25/160+§6–13；03/08/10 各行 38 basis；插件 guidance-text.js 七锚点（受保护文本） |
| 26 | v4 事实对象全量盘点（2026-09-06 子代理只读调研） | v4 仓库 ldvh-base/：ADR 8（均 ~44 行，含 trigger_signal 必填字段）/ Pitfall 8（均 ~41 行，六段闭合：symptoms/trigger_conditions/root_cause/resolution/avoidance/validation_summary）/ Spark 94 / Study 53（唯一纯 Markdown）/ WorkCase 157；统一元数据骨架 object_id/object_uid/fact_type_key/title/status/created_at/updated_at/change_log（签名三元组）；无静态注册表，物理路径即发现路径；F1/F2 雏形 code/ldvh/facts/repository.py read_fact_object；无 Charter 类型（web/api/services/facts.ts 行 23 ACTIVE_OBJECT_TYPES 五类） |

## 附录 C：外部思想吸收清单（Human 定调 2026-09-05）

> **吸收原则（Human 原话）**：「我们现在说的都是吸收外部好的思想和做法，不是要依赖，甚至是之后要舍弃掉的，在 LDVH 内部完成 LDVH 所需的一些工具和方法。」
> ——吸收的是思想，交付的是 LDVH 自己的实现；外部项目是脚手架，建成后拆除。

### C.1 吸收的层级

| 层级 | 含义 | 例 |
|---|---|---|
| **机制移植** | 同宿主（DSH 插件）的代码模式，可直接学实现形态 | mnemon 注入行、solo-thinking 锁恢复 |
| **思想参照** | 跨宿主/跨领域，抄架构不抄代码 | spec-kit 验证环、MAD 角色分歧 |
| **结论采信** | 研究结论直接指导设计，无机制可抄 | arXiv AI 自产上下文有害、64.5% 自检盲区 |

**共同点**：三层都**不产生运行时依赖**——LDVH 的工具和方法在自己的 `plugin/lib/` 里完成，外部项目的作用在吸收完成即结束（甚至可以舍弃）。

### C.2 吸收清单（按来源，含去向）

| 来源 | 吸收物 | LDVH 内部去向 | 吸收层级 |
|---|---|---|---|
| **dsh-mnemon**（同宿主） | 插件消息注入+可见性自愈；协议/快照分离；expectedRevision CAS；LLM 产候选宿主记账；receipt 恢复纪律；fork worker 继承审查；lastAccessedAt 效用观测 | guidance.js（已建）；写维落盘器；执行维恢复；复核维继承执行体；沉淀维效用 | 机制移植 |
| **dsh-solo-thinking**（同宿主） | 独立 Session+三种 Handoff；dormant 休眠建议；回传拓扑封存；turn/end 锁恢复；revision 乐观锁 | 审议维讨论形态（思考树）；复核维结论封存；执行维中断恢复 | 机制移植 |
| **AgentTeams**（同宿主，第三方） | **attempt 单调令牌**（转派先撤旧 attempt 等原成员安静、迟到结果不可覆盖——代理并发 fencing）；质量门自动流水（需求→实现→验证→审查→集成，失败自动修复复审）；状态落盘为真相 | 执行维并发（委派链解冻必修）；04 模板五段编排参照；机械记录同构印证 | 思想参照（不依赖运行——第三方+版本脆弱） |
| **dsh-sub-cli**（自家两代实践） | driver 层拦截+统一 onPermissionRequest 门控+permission normalizer | 遵守维 pre-execute 网关的思想源头（宿主原生版承接） | 机制移植（已发生） |
| **GitHub spec-kit**（133k★） | 验证环（写→校验→自修→复验）；[NEED CLARIFICATION]；Constitution 宪法合规；converge gap 评估；模板禁 HOW | 写维模型；审议维（Charter 同位）；复核维完成门禁；04 模板 | 思想参照 |
| **OpenSpec**（67k★） | schema 声明式验证；SHA-256 摒弃 mtime；「确定性检查 CLI 化、语义审查技能化」 | 写维并发指纹；遵守/复核机械语义分层 | 思想参照 |
| **Claude Code 官方** | plan mode 四阶段；exit_plan_mode 直调模式；Skills 渐进披露+description 规范；deny 全模式生效 | 审议维漏斗；08 §5.5 实现路径；遵守维 ADR 枚举 | 思想参照 |
| **Cursor** | 四型规则（Always/globs/description/manual）——glob 精确匹配≠语义裁决 | 遵守维机械触发合法性 | 思想参照 |
| **MAD 研究**（四代演进） | tit-for-tat+judge；judge=天花板（主控当 judge）；错误记忆毒化（否决标记理由）；无锚漂移 | 审议维结构依据；复核维独立优先的理论根基 | 结论采信 |
| **v4（自家前身）** | WorkCase 生命周期+E 主题 18 纪律；Pitfall 六段闭合；Spark 分流器；8+8 待搬运；retired Study 教训 | 执行维（暂缓中）；沉淀维分流表；F0–F4 首批内容 | 机制移植（同根复用） |
| **arXiv 2602.11988 + 社区** | AI 自产上下文降成功率+20%；自检盲区 64.5%；并发写三方合并；LLM reward hacking 存在 | 沉淀质量门；复核独立优先+分权制衡；写维并发 | 结论采信 |

### C.3 明确不吸收（红线）

| 项 | 理由 |
|---|---|
| 任何外部项目的**运行时依赖** | Human 定调：LDVH 内部完成 LDVH 所需工具方法——外部是脚手架，建成即拆 |
| AgentTeams 状态机作 LDVH 事实/规则 | v5-handoff 红线维持（思想吸收≠模型搬运） |
| solo-thinking Handoff 作事实交换协议 | Agent 自述无指纹验证 |
| MARKER 文本路由 | LLM 认前缀，脆弱 |
| 外部记忆插件当事实源权威 | mnemon 与 LDVH 互补分层（记忆层 vs 事实权威层） |
