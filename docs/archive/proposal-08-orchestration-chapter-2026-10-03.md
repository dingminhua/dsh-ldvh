# 08 号「编排宿主契约」章起草输入（需求 → 宿主承载 → LDVH 现状 → 登记状态）

> **性质**：**起草输入**——非规范、非事实对象，**不改动 `specs/` 任何文件**。本文件只回答「新章要承接什么、宿主已经给了什么、LDVH 用到了什么、哪些还没登记」。
> **它不是规范正文，也不得被当作规范正文使用**：`specs/08` §3.3 明文「08 只定义 DSH 宿主接入点、部署形态与发布门面，**不另建第二权威**」；`specs/00` §5.4 明文 AI「不得自行创造规范效力、事实、授权或完成结论，**不得把实施性选择包装成可强制执行规则**」。本文件给出的所有「08 章应写什么」均为**候选**，逐项须经 Human 决定，且**不得以命令式语气写入也不得以命令式语气主张**。
> **基准**（本轮实测）：`dsh-ldvh` @ `9fd2ccc`（2026-10-03）；`specs/08-DSH环境接入与插件发布规范.md` 指纹 `1e62352f8ba2317c3d534658f6e6ba823d0a87f9e06834c284d6e8610b3c9d69`；运行中宿主 `0.2.0-rc.2`（tag `dsh-v0.2.0-rc.2` / `639ed01539`）。
> **证据分级**：**[亲验]** ＝本会话可复现的命令/读取结果；**[既有调研]** ＝仓库既有调研的二级结论；**[推断]** ＝我的判断。**凡属 [推断] 或未实测者，一律就地标注**（底座 §0.4 档位诚实性规则：未实测的宿主机制必须标注并降一档表述）。
> **上游冻结事实（范围已收窄）**：可主张「源码未变」的只有三处：`packages/subagent/**` 逐 blob 相同（仅 10 个 `package.json` 版本行变化）；`packages/bundle/web-app/presets/` 四个 preset 文件 blob 相同；`EVENT_API` 81 项 name+mode 逐条全等。
> **不得外推**：同区间的 `packages/experimental/**` **有实质变动**（`schedule-bundle/**` 为新增目录；`bundle/web-app/cordis.patch.yml` 改动 41 行；`workflow-ptc/src/guest-source.ts` 为重生成产物）。故「**编排子系统源码未变**」成立，「**宿主组合未变**」不成立——后者恰恰有变动，见 §4 第 4 项。
> **复现口径**（供读者自行核验，非本文件的结论）：
> - 事件目录：`git show <tag>:packages/extensions/tool-cordis/src/api-catalog.ts`，取 `EVENT_API` 块，统计 `name`/`mode` 对；`dsh-v0.1.7-rc.2` 与 `dsh-v0.2.0-rc.2` 各得 `81` 对（`emit 59 / waterfall 17 / parallel 3 / serial 2`），逐条 diff 为空。
> - 包源码：`git rev-parse <tag>:<path>` 逐文件比对。
> **版本 3 更正记录**（本轮，据两条隔离子代理对抗审核）：
> 1. **[亲验] `schedule` 并未装载**：`Service.listService` 是**已知服务契约目录**，不等于「此刻装载」。判据为「工具在不在 `Tool.listTools`、`Config` 能否查到条目」。
> 2. **`maxActiveSubagents=8` 不是并行天花板**：仅约束「可续子代理」；一次性委派与 `workflow` 扇出不占该额度（§3.6）——但**该结论为源码判定，未做运行时压力实测**。
> 3. **Agent Teams 已由 Human 关闭**，按**负向依赖**处置（§4 第 7 项）。
> 4. **必须修类更正（据规范符合性审核）**：① 缝消费纪律的出处是 `specs/08` **§6**（非 §5）；② 「三缝」非 08 §6 的 5 缝闭集，本文改称「**编排接入面**」；③ 接入点是 `ctx.subagents.listChildren`／`listDescendants`（`subagentCatalog` **不是**服务名）；④ 三处计数更正（§2.1 汇总、§2.2、§6）；⑤ 冻结范围收窄（抬头）；⑥ §5 骨架改为**条件式要求**（原 v2 的「登记当前消费状态」「核验版本推进到 X」与 `specs/01` §7.2 冲突，见 §5 说明）；⑦ 删除「§4 候选 after 文本可直接复用」的断言（§1 附注）。
> **审核记录**：本文经两条**隔离子代理**对抗审核（一线事实核验、一线规范符合性），两者均只读、未改任何文件。
> - **规范符合性线**：提出 13 项「必须修」，本文已逐项处置；其中**一项部分驳回**：其 M12 称「事件目录 81 项全等」不成立，经源码级三方比对判定**该论断不成立**（其 75 项读数属其自身会话的装配口径，非源码事实）；但其「冻结范围过宽」的意见成立，已收窄。
> - **事实核验线**：**未完成即失败，无结论**——该线负责的核验项（§3.6 三路径额度的运行时行为、LDVH 侧行号抽查）**属覆盖缺口**，本文已把其中可由静态核查完成的部分**自行补齐**（行号抽查结果：`child.js:37/67/74/75/92/164`、`lifecycle.js:155/201/274/277/303` 全部准确），并由此**自查补出第 14 项问题**（C5：`triggers.js:13` 的过期清单行）。**运行时压力实测（U2）仍未做**，故 §3.6 保持 [待实测] 标注。
> - **未自动重跑**该失败线（依 LDVH 纪律：部分失败须说明覆盖缺口，不自动重试）。

---

## 1. 为什么需要这一章：六处指向、一个落空

| # | 指向处（原文要点） | 指向 08 承接的内容 | 08 现状 |
|---|---|---|---|
| 1 | `specs/02` §8：「具体契约由 08 承接」 | 编排能力承载的宿主契约 | §3.1 六条职责**无编排条目** [亲验] |
| 2 | `specs/02` §19：「attempt、锁、冷恢复和宿主事件所需的术语、接入与实现由 08/09 按各自来源另行定义」 | 术语与接入 | 同上，未定义 |
| 3 | `specs/21` §3.2/§3.3：「attempt 的宿主实现与锁语义指定由 08/09 承接」 | attempt 宿主实现与锁语义 | 同上；21 §15.2 首行据此不得删 [亲验] |
| 4 | `specs/32` §12：「spawn/通信/中断回收的宿主机制归 08/09」；§17.2：「上限机械拒绝（具体数值随 08/09 承接落定）」 | spawn/通信/中断回收机制 + **上限数值** | 同上；上限数值至今无出处（§3.6 给出**候选**口径） |
| 5 | `specs/31`「适用条件」：「**编排能力承载可用**（隔离视角由子代理承接时，需 02 §8 / 08 支持）」 | 使该前提可被证实 | 该前提**无法由任何现行规范文本证实** [亲验]——六处指向中最尖锐的一处 |
| 6 | `specs/35` 附录 A.5-3：「空闲触发事件可用性……属实现现状（08 承接）」 | 空闲触发事件清单与可用性 | 未登记（**注**：35 号自述为候选草案、非当前规则源成员，见 §6） |

**结论**：并非宿主给得不够，而是承接章节缺席——宿主已提供的能力，LDVH 连「我登记消费了哪些」都无处可写。

**附注（关于 `specs/08` §5.4 的失真，修法本身需要更正）**：§5.4 现文本仍列 `agent/session-start`，且带核验标注「形态在 DSH 0.1.2-rc.1 与 0.1.5-alpha.1 一致，源码双版对照核验 2026-09-10」。[亲验] 运行宿主事件目录中 `agent/session-start` **不存在**（源码 `EVENT_API` 亦零命中）；`agent/created` 为 `serial`、载荷 `{agent, source: SessionStartSource, signal?}`。

**但修法不是「把版本号更新到 0.2.0-rc.2」**——`specs/01` §7.2 明文：规范正文**不得承载任何「当前如何」的事实陈述**，并列「实现状态」（某项能力「已实现／未实现」，以及实现所在的文件、函数或批次说明）为禁止项 1；其判据是「一句正文如果**随现状变化而需要修改**，它是状态，不得留在正文」。**「形态在某两个版本一致、核验于某日」正是这种句子**——它每次核验都要改，故属状态。

**故正确的修法是：删除这类「核验标注 / 版本对照」陈述，只保留要求**（该接哪些事件、在什么时机、承担什么），现状一律交回读取时的观察——`specs/08` §6 自己就给出了正确形态：「各缝的**实际消费现状**按 01 §7.2 由读取时的观察与实现核对取得，**本节不陈述其当前状态**」。同理，`docs/dsh-orchestration-ecosystem-research-2026-09-26.md` §4 的候选 after 文本**不构成可直接复用的修改**：它锚定 0.1.7-rc.1/rc.2 且覆盖非 subagent 事件的核验标注，须先按本节口径重写（去状态化）后再议。

---

## 2. 需求 → 宿主承载 → 登记状态

> 「覆盖度」三档：**够** ＝宿主已有可用的确定性承载；**部分** ＝有承载但缺机械保障或需 LDVH 侧补；**不覆盖** ＝宿主明确不提供。**「够」只表示「存在接入点」，不表示「已验证可用」**（`specs/02` §21：意图、存在、接入、可用和验证范围须可区分）。

| # | 需求（业务系统 + 规范依据） | 宿主承载（[亲验]，路径见 §3） | 覆盖度 | 登记状态 |
|---|---|---|---|---|
| **O1** | 讨论·隔离视角扩散：方案空间切分 2–4 方向 → 每方向一个隔离子代理 → 并行探索、上下文不串线（`specs/31` §8、§12、§17） | `ctx.subagents.startContinuable`；`subagent` 工具（preset 默认 `backgroundMode: continuable`） | 够 | **未登记**；31 适用条件反依赖它 |
| **O2** | 讨论·定向交接：主控撰写 Handoff、不复制原始过程（`specs/31` §8 第 3 步） | [推断] 无独立 Handoff 载体；机制上可经 `ctx.subagents.sendMessage` 投递，但「专用交接形态」未定义 | 部分 | 未登记。**注**：31 §8 原文为「视角间上下文不串线，**仅通过主控定向 Handoff 交接，无需全局同步**」，且「视角间上下文串线」列为**停止位置**（31 §8、停止位置章）——这是 **31 的行为要求**，其归属在 31（31 §16 红线 6 明确「不把视角子代理的 spawn、通信或恢复机制写入本文——这些属于编排接入实现，由 08 承载」），**不是 08 可代为规定的禁令** |
| **O3** | 调研·调研子代理：acceptance + scope 前置、三态证据提交、主控核对整合（`specs/30`「调研子代理职责」章及其子节，与「调研 vs 编排」节） | 同 O1（`subagent`），另有 `workflow` 扇出形态 | 够 | 未登记。**注**：30 号存在编号冲突（「### 15.3」与「## 15」并存、其子节编为 16.x），引用须用标题锚点而非纯章号 |
| **O4** | 调研·并行线规模 | **三路径不同额度**（§3.6）：可续子代理受 `maxActiveSubagents=8`；一次性委派与 `workflow` 扇出不占该额度 | 够（**额度口径须登记**） | 未登记。**[待实测]** 三路径的额度行为为**源码判定**，未做运行时压力实测；8 的含义是「同时保持可对话关系的子代理数」，非并行总量上限 |
| **O5** | 工单执行·执行模 spawn 成员：「一切 spawn 经主控之手」「先批准再物化」「上限机械拒绝」（`specs/32` §17.2） | 主控持 `subagent` 三路径；上限按 §3.6 分路径取值 | 部分（**上限数值待登记**；「经主控之手」当前无机械保障） | 未登记。**与 32 §17.2 一致**：其自述「宿主实现未落地前，本节为流程纪律（persona 档），不得声称已有机械保障」 |
| **O6** | 工单执行·attempt 令牌／心跳／接管／冷恢复（`specs/21` §10.4） | **无宿主原语**：无锁、无租约、无 fencing、无心跳过期、无迟到写入拒绝。唯一近似物是 session 日志跨进程写锁（`packages/session/session-persistence-jsonl/src/lease.ts`，**故意无过期**、进程退出才释放） | **不覆盖** | 21 §15.2 首行未闭合（替代保障＝无） |
| **O7** | 复核制度·独立／继承／新鲜／对抗执行体；关闭须有一条 reviews 会话身份 ≠ 实施者（`specs/02` §16、`specs/21` §14/§15.1） | 隔离子代理可 spawn；身份取自宿主子代理登记表（`agent.id`/`session.header.id`/`origin`/`parentSession`）；LDVH 已实现 `record_review` 回传通道 | 够 | **部分登记**：21 §15.2 载「01 §9 成员资格程序」未走完，条款未取得规则效力 |
| **O8** | 记忆与反思·空闲维护代理（评审／容量／体检）与 fail-closed（**主依据** `specs/02` §15、§17；`specs/35` §10 为其候选展开，**该号非当前规则源成员**） | **随发行交付的组合不提供 cron／定时设施**（§4 第 4 项）；可用锚点：`agent/turn-stopping`(serial)、`session/event` turn/end、`agent/created`(serial)、`session/flush`(parallel) | 部分（可做，未做） | 未登记；35 A.5-3 为开放问题（该号效力状态见 §6）；实现侧 skeleton（`triggers.js:12-15`） |
| **O9** | 目标与蓝图·蓝图校准的空闲触发调度（`specs/02` §14） | 同 O8；另有 `goals` 服务（`get`/`edit`/`pause`/`resume`/`complete`/`clear`）——据底座总则二，goals 只能承载**活动态编排镜像**，非权威 | 部分 | 未登记 |
| **O10** | 编排·漂移防护（`specs/02` §8 判据「漂移防护」；30 号已在「调研 vs 编排」节把漂移防护指给 02 §8 承载） | `ctx.tools.restrict` / `toolFilter`（`{allow,deny}`）＋ `ctx.tools.guard`；子代理运行上下文快照内含 delegation statement | 部分（有承载；**「防注入」无对应规范条款**；旧调研引的 schedule 域 untrusted 标注已失效） | 未登记 |
| **O11** | 编排·中断恢复（`specs/02` §8 判据「中断后有恢复路径」） | `subagents.interrupt`、`drainContinuableChildren`、`drainContinuableDescendants`；`workspace/session-activity`(waterfall) 与 `workspace/session-stop`(parallel)；驱动方为 `workspaceRegistry`／`workspaceController` | 够 | 未登记 |
| **O12** | 编排·结果回收（`specs/02` §8 判据「子代理产物被主控核对和整合」） | `subagent/start`、`subagent/end`(emit，带 `lastAssistantMessage` + `stopReason`)；`listChildren`/`listDescendants`（durable 投影）；LDVH 自建 `ldvh_collect_subagent_results` | 够 | 部分登记（实现已在，规范未登记；**且 LDVH 未消费前两者**，见 §2.2 C1） |
| **O13** | 编排·成本控制（`specs/02` §8 判据「成本受闸门约束」） | **未查到**宿主成本／预算闸门 API；仅 `tokenMeter`（计量，非闸门） | **不覆盖** | 未登记（无可回指承载） |
| **O14** | 跨会话接力与交还承载（`specs/00` §5.3、§7.4；`specs/02` §19/§20；`specs/08` §7.7） | 宿主**无**交还产物专用存储入口（据 §7.7 的 2026-09-10 结论；**未在 0.2.0-rc.2 复核**，见 §7 U7）；跨会话驱动由第三方插件在个别 profile 提供，非宿主原生 | **不覆盖** | §7.7 定案自持久化于 `~/.dsh/ldvh/`，**未建**；建成前不得声明 |
| **O15** | 编排限额登记 | `maxDepth`＝**1**、`maxActiveSubagents`＝**8**（两者均 `volatile`、可编辑，本机 profile 未覆盖） | 够（须登记） | 未登记。**[推断]** `maxDepth=1` 的**实现后果**是：实施者本身为子代理时无法再派复核者；21 §14/§15.1 的复核判据**未规定发起层**，故「复核须回主控层发起」应记为**实现约束**而非 21 的规范要求 |
| **O16** | 编排接入面的消费登记（`specs/08` **§6**：「未消费的缝必须与已消费的缝一同如实报告」） | 见 §2.3；实现侧**已有**逐缝报告（`plugin/lib/host-seams.js` 的 `snapshot()`，装载期亦逐缝记日志） | 部分 | 未登记。**缺口定位**：实现侧报告已在，缺的是 08 侧的**要求**；且据 `specs/01` §7.2，08 **不得**把「当前消费状态」写成清单（§5 说明） |

**汇总（逐行复算，口径：按「够／部分／不覆盖」首词归类）**：**够 7 项**（O1、O3、O4、O7、O11、O12、O15）、**部分 6 项**（O2、O5、O8、O9、O10、O16）、**不覆盖 3 项**（O6、O13、O14）。**已登记 0 项、部分登记 2 项、未登记 14 项。**

### 2.2 LDVH 现状与不足（实现侧逐项核验）

> 两轴分开陈述（避免混淆）：
> - **实现状态轴**：已实现／未实现。
> - **强制档位轴**（底座 §0.4 闭集）：**状态机断言**／**能力白名单**／**宿主网关**／**persona 自律**。未实测的宿主机制须标注「待实测」并降一档。

| # | 编排用在哪（含 [亲验] 出处） | 实现状态 | 强制档位 | 不足以至 | 加强方式 |
|---|---|---|---|---|---|
| **A1** | 子代理生命周期接管与管辖继承（`lifecycle.js:201`、`:155-164`；`child.js:74-75`） | 已实现 | persona 自律 | 以**自建内存 Map**（`children` + `retiredChildren`，含 50 条 FIFO：`child.js:37`、`:92`）替代宿主持久目录 | 换接 `ctx.subagents.listChildren`／`listDescendants` |
| **A2** | 子代理终止结论回收（`child.js:164` 扫 `session/event`；`subagent-result.js:76-121`） | 已实现（2026-09-26 修两处缺陷） | persona 自律 | ①未消费 `subagent/end` ②自设 50 条窗口，已结束即丢 ③`per-child tool-level provenance` 自述缺口 | 换接 `subagent/end` |
| **A3** | 独立复核者身份（`workcase-tools.js:611-700` + `lookupChild` + `session_source` 只认 `host`） | 已实现 | **状态机断言**（写入前拒绝，机械） | 21 §15.2 成员资格程序未走完，条款未生效 | 走 01 §9 程序（属条款生效问题，非编排问题） |
| **A4** | 注入缝消费（`system-prompt/assemble`、`agent/pre-step`、`agent/created`：`lifecycle.js:274-277`、`:303`） | 已实现 | 宿主网关 | 无 | 保持 |
| **A5** | 机械签名与署名归属（`session-signature.js:20-28`、`:41-56`、`signature-channel.js`） | 已实现 | 状态机断言 | shell 路可被环境变量伪造（已限 host 消费） | 保持 |
| **B1** | 讨论·隔离视角扩散（`specs/31` §8） | **未实现**（零消费） | — | 31 把「编排能力可用」列为适用条件而无法证实；发散上限无纪律 | 可续子代理×方向数 + 主控定向 Handoff；纪律入 08 仅限**接入面** |
| **B2** | 调研·并行线 | 未实现（本轮 3 线由主控手开） | — | [推断] 易把 8 误当并行天花板 | 大规模扇出可用 `workflow`（不占 8）；数额口径待 32/08 定 |
| **B3** | 工单执行·执行模 spawn 成员（`specs/32` §17.2） | **自律** | persona 自律 | 上限数值无出处；「一切 spawn 经主控之手」无机械保障 | 先补底座遗留第 7 项（`toolFilter`/`guard` 实测）升档 |
| **B4** | 记忆与反思·空闲维护代理（`specs/02` §15/§17 为主依据） | **skeleton**（`triggers.js:12-15` 只记 marker） | — | 无调度、无预算轮换、无 fail-closed、无待处置队列 | [待实测] 拟用 `agent/turn-stopping` + `agent/created` 两锚点，可用性未实测 |
| **B5** | 目标与蓝图·空闲触发调度（`specs/02` §14） | 未实现 | — | 与 B4 共用锚点却无实现 | 与 B4 合并建设 |
| **B6** | attempt 独占（`specs/21` §10.4） | 仅字段落盘（`workcase-writer.js:2252-2264` 分配、`:2375-2434` 心跳/接管） | persona 自律 | 无锁、无租约、无 fencing、无心跳过期、无孤儿判定；`specs/02` §24 红线 6 禁止为尚未成立的能力预设锁 | **先 Human 裁决**（§8 第 6 项） |
| **B7** | 编排漂移防护（`specs/02` §8 判据） | 部分（delegation statement 提示层） | persona 自律 | 无独立禁止指令类型 | 同 B3（实测后升档） |
| **C1** | 宿主编排事件消费（`subagent/start`、`subagent/end`、`tools/change`） | **零消费**（`plugin/lib` 订阅表无此三者） | — | 结论要自己扫、派活起点不可观测 | 随 A2 一并接入 || **C2** | 中途干预（`ctx.subagents.sendMessage`，`delivery: steer`） | **零消费** | — | 主控无法干预运行中的成员 | 接入后可支撑 O10 漂移防护 |
| **C3** | 成本闸门（`specs/02` §8 判据） | 无 | — | 宿主无成本 API | 登记为「不覆盖」 |
| **C4** | 交还产物承载（`specs/00` §7.4、`specs/08` §7.7） | 未建 | — | 宿主无专用存储入口 | 按已定案自持久化于 `~/.dsh/ldvh/` |
| **C5** | **[自查补出] 触发器清单注释过期**：`plugin/lib/triggers.js:13` 把 `agent/session-start` 标为 `[ACTIVE]`（「priming + session-scope record」） | 注释级 | — | 该事件自 0.1.7 已被宿主**删除**（[亲验] `EVENT_API` 零命中）；同文件其余 5 处提及**均已带「已删除」说明**（`child.js:119`、`lifecycle.js:171/270/299`、`index.js:26`），唯独此清单行未更新。**无实际订阅，不影响运行**，但会误导读者以为该锚点仍在用 | 更新该行为删除说明（纯注释修正） |

### 2.3 消费账（更正后口径）

- **LDVH 现消费的宿主服务：9 个**（`ctx.get()` 去重）：`agents`、`sessionPersistence`、`userQuestions`、`tools`、`invariants`、`fs`、`dshHomePath`、`commands`、`remote.directoryPicker`（共 12 处调用点）。
- **[亲验] 08 §6 的「宿主缝」是 5 道闭集**：`ctx.tools.register`、`ctx.tools.guard`、`ctx.invariants.register`、`fs/observed`（读观察＋写版本守卫两半）、`ctx.userQuestions.ask`。**该闭集内不含任何编排缝**——这正是本章要补的空白。**注意**：本文所说的「编排接入面」（subagent／workflow／skill）**不是** 08 §6 意义上的「宿主缝」，两者**不同名不同义**，写作时不得混用。
- **实现侧逐缝报告已在**：`plugin/lib/host-seams.js` 的 `snapshot()` 明列上述 5 缝，并声明「Unconsumed seams are reported alongside consumed ones, never omitted」；装载期逐缝记日志。
- **已消费但未在本文 O 表出现者**：`ctx.tools.guard`（`host-seams.js:193`）属 08 §6 缝且**已消费**。本文 O16 针对的是**编排接入面**，与该表不同轴。

---

## 3. 宿主承载清单（[亲验]，供 08 引用）

### 3.1 工具（**与本需求直接相关者**；非 `Tool.listTools` 全集）

`subagent`（`provider: spawn`）｜`subagent_fork`（`provider: fork`，`inheritsParentContext`）｜`send_message`｜`interrupt_agent`｜`list_agents`｜`workflow`（`agent` / `pipeline` / `parallel` / `phase` / `log` / `args` 六钩子）｜`job_list` / `job_output` / `job_kill`｜`todo_write`｜`skill`

> 归因澄清：`tool-subagent-fork` 只是 preset 的一个**行 id**，无对应独立包；`session_bridge_*` 工具族来自**第三方插件**（`dsh-session-bridge@0.5.2`），非宿主原生，LDVH 未消费。
> **Agent Teams 相关工具不在本表**——该 bundle 已由 Human 关闭，按 §4 第 7 项负向依赖处置。

### 3.2 服务（`Service.listService` 实测）

> **读法**：该目录是**已知服务契约目录**，不等于「此刻装载」。下表「装载」列给出该行的**实际判据**（工具名／Config 条目／本文件其他位置的直接证据）。

| 服务 | 与本需求直接相关的方法 | 装载 | 判据 |
|---|---|---|---|
| `subagents` | `startContinuable`、`sendMessage`、`interrupt`、`listChildren`、`listDescendants`、`drainContinuableChildren`、`drainContinuableDescendants`、`resolveMaxDepth`、`registerProvider`／`getProvider`／`list`／`start` | ✅ | `Tool.listTools` 含 `subagent`／`send_message`／`interrupt_agent`／`list_agents` |
| `agents` | `currentInitiator`／`requireInitiator`／`withInitiator`、`roots`、`isOwnedBy`、`announce` | ✅ | 宿主内部服务；委派链身份读取（`child.js:45-49` 实测可用） |
| `workflowEngine` | `start` | ✅ | `Tool.listTools` 含 `workflow` |
| `jobs` | `start`／`list`／`get`／`read`／`readAt`／`kill`／`wait`／`remove` | ✅ | `Tool.listTools` 含 `job_list`／`job_output`／`job_kill` |
| `tools` | `register`／`restrict`／`guard`／`get`／`schemas`／`execute` | ✅ | LDVH 实际调用（`host-seams.js`） |
| `systemPrompt` | `section`／`context`／`tools`／`variable`／`assemble`／`suppressRuntimeContext` | ✅ | LDVH 经 `system-prompt/assemble` 实际消费 |
| `skills` | `registerProvider`／`register`／`list`／`snapshot`／`get` | ✅ | Config 条目存在；LDVH 未消费（B3 族） |
| `sessionQuery` | `observeSession` | ✅ | `listChildren` 的实现依赖它（源码 `list-children.ts:36`） |
| `workspaceRegistry`／`workspaceController` | `archiveSession`／`unarchiveSession`／`pinSession`／`follow` | ✅ | 归档事件族存在；O11 的驱动方 |
| `goals` | `get`／`edit`／`pause`／`resume`／`complete`／`clear`／`create` | ✅ | Config/工具面存在；O9 的**活动态镜像**载体（底座总则二） |
| `approval` | `request`／`setPolicy`／`overrideOf` | ✅ | `specs/08` §5.5 已登记其承接；LDVH 未直接调用 |
| `sessionPersistence` | `locate` 等 | ✅ | LDVH 实际调用（`session-signature.js`） |
| `timer` | `timeout`／`interval`／`throttle`／`debounce` | ❌ | Config 行 `include:timer` 状态 `absent`——「独立定时设施」判断的相关面（§4 第 4 项） |
| `schedule` | `create`／`list`／`catalog`／`history`／`delete`／`update`（含 cron 规则类型） | ❌ | `Config.listConfigs(name:'@deepseek-ai/dsh-schedule')` → `total: 0` |
| `agentTeams` | `spawnTeammate`／`createTask`／`waitForChange` 等 | ❌ | `plugin_manager list_bundles` → `enabled: false`（Human 已关闭） |

### 3.3 事件（`EVENT_API` 源码为权威，81 项）

**取数与复现**：`git show dsh-v0.2.0-rc.2:packages/extensions/tool-cordis/src/api-catalog.ts` 的 `EVENT_API` 块 → `81` 项（`emit 59 / waterfall 17 / parallel 3 / serial 2`）；与 `dsh-v0.1.7-rc.2` 逐条相同。
**口径声明**：运行时 `Event.listEvents` 的**返回条数依赖会话的插件装配作用域**（本次审核中另一会话读到 75 项、2026-09-26 调研记 0.1.7-rc.1 为 77 项——三数不同源于作用域，非源码变动）。**故涉及「全等／全表」的断言一律以源码为权威**。

与本需求直接相关者：`agent/created`(**serial**)、`agent/pre-step`(waterfall)、`agent/turn-stopping`(**serial**)、`system-prompt/assemble`(waterfall)、`session/event`(emit)、`session/flush`(**parallel**)、`tools/change`(emit)、`subagent/start`／`subagent/end`／`subagent/provider-added`／`subagent/provider-removed`(emit)、`workflow/start`／`phase`／`log`／`agent-start`／`agent-end`／`end`(emit)、`agent/status`(emit)、`skills/change`(emit)、`workspace/session-activity`(waterfall)、`workspace/session-stop`(**parallel**)
**注**：`agent/session-start` **已不存在**。

### 3.4 限额（[亲验] 源码行）

| 项 | 值 | 出处 | 作用域 |
|---|---|---|---|
| `maxDepth` | 1（volatile） | `packages/subagent/subagent/src/index.ts:202` | 委派深度：`childDepth = 父深度 + 1 > maxDepth` 即拒 |
| `maxActiveSubagents` | 8（volatile） | 同上 `:203` | **仅「可续子代理」**（见 §3.6，[待实测]） |
| workflow caps | `maxTotalAgents` 1000／`maxItemsPerCall` 4096／`syncTimeoutMs` 5000／并发 `min(16, max(1, cores−2))` | `packages/workflow/workflow-ptc/src/index.ts:107-110` | workflow 扇出 |

> `maxDepth`／`maxActiveSubagents` 均为宿主可编辑项（`volatile`；宿主提供配套设置卡，其**具体文案本次未能在运行产物中读取**——`app.asar` 为归档不可直读）。上游默认值曾为 3 层，commit `a69bcf3636`（`feat(subagent): own editable delegation limits in the backend`，已核实存在）起改为默认 1 并交使用者配置——**[推断]** 属设计取向，非疏漏。

### 3.5 身份与归属（独立复核的依据）

`agent.id`、`session.header.id`、`session.header.origin`（`subagent` 判定）、`session.header.parentSession`（委派链）、`session.header.delegationDepth`（宿主权威且单调，运行期只能加深不能降低）。
**[亲验]** `child.js:67`：有 `parentSession` 字符串但无在册活体父级者（孤儿）不被授权。

### 3.6 委派三路径与额度口径（[待实测]）

`tool-subagent/src/index.ts:530-566` 三条分支：

| 路径 | 触发条件 | 是否占 `maxActiveSubagents` | 结果回收方式 | 适用场景 |
|---|---|---|---|---|
| 一次性·前台 | `run_in_background: false` → `subagents.start()` | **[待实测] 不占** | 调用直接返回结算结果 | 单次任务、需等结果 |
| 一次性·后台 | one-shot + 后台 → `jobs.start()` | **[待实测] 不占** | `job_list`／`job_output`／`job_kill` | 发射后不管，可多路并行 |
| 可续子代理 | `continuable` → `startContinuable()` | **占** | `subagent/end` 拿结论；`send_message` 续话 | 长协作、需中途插话与反复指派 |
| workflow 扇出 | `workflow` 脚本 | **[待实测] 不占**（`workflow-ptc/src/host.ts:200` 走 `subagents.start()`） | 脚本返回值；`workflow/*` 事件 | 大规模扇出 |

**额度计数点的源码位置（支持上述判定）**：额度在**可续子代理的物化路径**上扣减——`continuation-activation.ts` 的 `materialize()` 内 `pool.reserve(this.maxActiveSubagents())`，且 `materialize()` 仅被 `continuation.ts`（可续路径）调用。

**这是候选口径，不是落定结果。** `specs/32` §17.2 的「具体数值」唯一权威在 32 自身；`specs/08` §3.3 明文 08「**不另建第二权威**」。故本节只提供**候选**，供 32 侧与 Human 决定；且因 [待实测]，其表述须按底座档位诚实性规则降一档。

### 3.7 工作树（worktree）执行

- **有专门条款与实现**：`specs/07` §5.3「linked worktree 通过 Git common-dir 确定性识别同一项目」；实现 `plugin/lib/governance-scope.js` 内有**专门**的 linked-worktree 条款（直接包含判定失败后改用 common-dir 比对）→ worktree 内的会话仍判 `governed`。
- **Git Gate 的钩子位置**：装在 `<git common-dir>/hooks/commit-msg`（`hook-manager.js:85-98`），主 worktree 与 linked worktree 共享；脚本运行时取 `git rev-parse --show-toplevel`（`:138`）。`specs/08` §6 已承接该语义。**[待实测]** 「在 worktree 中端到端有效」属可用/验证层，本次未跑端到端（管辖、Gate、事实源写入三处均未实测）。
- **约束**：事实源随 worktree 走（`specs/01:286`）；受控读写以**唯一工作树**为前提（`specs/03:150`）；草案与审计绑定工作树、不得移植（`specs/03:277,281,335,463`）；管辖不跨多 worktree（`specs/07:199`）；多工作包并行未裁（`specs/32:169`）。
- **工具层硬事实**：子代理**恒定继承父级 cwd**（`child-agent.ts:147`），`tool-subagent` 与 `spawn_teammate` 均**不暴露 cwd** → 「把某个子代理放进另一个 worktree」当前做不到；能做的是**主控会话本身以 worktree 为 cwd**。
- **判定 [推断]**：worktree 适合隔离**爆炸半径**（瞬态产物、可丢弃尝试、并行工单防互踩），不适合隔离**权威**（事实源与受控提交必须单点）。

---

## 4. 宿主明确不提供的（诚实清单）

1. **attempt 的锁／租约／fencing／心跳过期／孤儿判定／迟到写入拒绝**——无任何原语（O6/B6）。
2. **成本／预算闸门**——未查到 API，仅有计量（O13/C3）；[待核验]「未查到」不等于「确定不存在」。
3. **交还产物的专用存储入口**——依 `specs/08` §7.7 的 2026-09-10 结论；**该结论本次未在 0.2.0-rc.2 复核**（§7 U7）。
4. **cron 与独立定时设施**——**准确表述**：**随发行交付的组合不提供**（`dsh-v0.2.0-rc.2:packages/bundle/web-app/README.md` 原文：「The shipped composition **carries no** `time-context`, `schedule`, or `ui-schedule` row」；同区间该三行由 `bundle/web-app/cordis.patch.yml` **移出**并改由可选实验性 bundle `@deepseek-ai/dsh-experimental-schedule-bundle` 提供）。宿主源码确有 `schedule` 服务（含 `cron`／`daily`／`weekly`／`every` 规则类型），且 `timer` 行（`include:timer`）为 `absent`。**故不得写「宿主不提供定时能力」，只能写「交付组合不提供」**——该结论同时影响 `specs/35` §10.2 那句「DSH 无 cron 与独立定时设施」的表述精度（35 号效力状态见 §6）。
5. **Git 提交门禁**——宿主零命中，受控提交完全由 LDVH 自供（本仓库独有价值）。
6. **独立禁止指令类型**——委托不转责仅以系统提示陈述 + untrusted 标注体现；且旧的 schedule 域标注已被上游**有意移除**（O10 的锚点变更）。
7. **Agent Teams 的协作模型（负向依赖）**：宿主随安装包发布可选 bundle `@deepseek-ai/dsh-experimental-agent-team-profile`（默认关，**本机已由 Human 关闭**）。**LDVH 不消费其协作模型**；依据（**属 Human 终审通过的设计输入，不取得规范效力**）：底座总则一「主控即队长——不设独立队长角色」、总则二活动态条款「不引入 AgentTeams 式状态目录当真相源」。**风险事实** [亲验，0.2.0-rc.2]：该 bundle 的装配会把 `tool-subagent`／`tool-subagent-fork`／`tool-subagent-control`／`list-agents` 四行设为 `disabled`——即打开它会改动 LDVH 依赖的委派面。**候选登记项（非命令）**：可把该负向依赖写入 08；「不消费」的可核判据为 `plugin/lib` 对相关符号零引用；并可将「该状态改变时如实报告、不静默降级」写成**条件式要求**。

---

## 5. 08 新章候选骨架（仅结构）

> 位置：`specs/08` §5 之后新增一节（编号待定），并在 §3.1 增列一条「本文负责」。
> 形式：只承接**宿主接入点与登记义务**，不复制 02/21/30/31/32/35 的语义（与 08 §3.3 相邻规范分工同一纪律）。
> **⚠ 三条写作纪律（据规范符合性审核，本文 v2 曾违反）**：
> 1. **不得承载实现状态**（`specs/01` §7.2 禁止项 1：某项能力「已实现／未实现／已接入」，以及实现所在的文件、函数或批次说明）。故新章**不得**写「当前消费状态」「核验版本为 X」「某能力已就绪」。
> 2. **不得承载下位文档的存在状态与过程进度**（同 §7.2 禁止项 2、3）。
> 3. 确需向读者提示现状时，用**条件式要求**（「在 X 具备之前，不得……并须披露未兑现范围」），把事实判断交还读取时的观察（`specs/01` §7.2 末段；`specs/08` §6 已给出正确样例）。

1. **适用与边界**：编排宿主契约的范围；不定义业务面流程纪律（归 04/30/31/32/35），不定义 attempt 语义（归 21）。
2. **编排接入面的注册来源与消费义务（条件式）**：对 subagent／workflow／skill 三个接入面，规定「**在某接入面被实际消费之前，不得主张其防护或编排能力已部署**」这一条件式要求，并规定「未消费者须与已消费者一同如实报告」；**不写当前处于何种状态**（与 08 §6 同形）。
3. **委派路径与额度**：以**条件式**表述额度约束（可续子代理受 `maxActiveSubagents` 约束；一次性与 workflow 扇出的额度归属）＋超限行为（`ACTIVATION_LIMIT_REACHED`）；`maxDepth` 的**实现后果**（复核须回主控层发起）——**此项须先由 32 侧定数值、本文只承接接入，不得代 32 定值**。
4. **事件面**：**只保留要求**（该接哪些事件、在什么时机、承担什么），**删除**任何「形态与某版本一致／核验于某日」的陈述；新增的编排观察锚点（`subagent/start`、`subagent/end`、`agent/status`、`tools/change`）同样以「要求」形式写入。
5. **空闲触发的宿主锚点（条件式）**：可用锚点清单与「三任务按预算轮换」的接入时机；未具备前按条件式要求处理（闭合 35 A.5-3 的**问题**，不以登记现状的方式闭合）。
6. **不提供的清单与替代路径**：§4 逐项写明替代保障（或明写「替代保障＝无」，与 21 §15.2 同形）。
7. **负向依赖与外部开关（条件式）**：§4 第 7 项；含「该状态改变时如实报告、不静默降级」的条件式要求。
8. **失败处置与 fail-closed**：承接 00 §7.2 宿主闲置纪律在编排面的落点。

---

## 6. 与既有未闭合项的关系

- **21 §15.2** 现行**8 条数据行**未闭合声明**一行未删**[亲验]。**本文只是转述** `specs/21` §15.2 末句的要求——「本节不得因依赖补齐而被改写为『已承接』或『已保障』；依赖闭合后应删除对应行」——**不以 08 章的口吻自设禁令**。删行须满足其末句条件。
- **A1（§5.4 事件面）现无在途工单承载**：旧承载 `workcase-8f4742f5` 已 closed。
- **底座遗留第 7 项（`toolFilter` 覆盖面、孙代传播、执行层 `UNKNOWN_TOOL` 拒绝实测）**：`plugin/lib` **零命中**，实测未做。它是 B3/B7 升档的前置——未实测不得当已验证能力用。
- **`specs/35` 的效力状态**：其文件头自述「本文是 35 号**候选草案**，尚未完成 01 §12 独立审核与 01 §9.2 成立程序，**不是当前规则源成员**」；`specs/01` §8.1 编号登记表列到 32 为止。故凡涉及记忆与反思的空闲维护、反思触发等，**当前唯一定义来源是 `specs/02` §15/§17**；引用 35 号时须附该声明（本文 §2.1 O8 已改）。
- **`specs/35` §10.2「DSH 无 cron 与独立定时设施」**：该句所在的 §10.2 小节标题本身即「空闲触发表达（**候选设计，待审核确认**）」，故它不是已生效条款；但据 §4 第 4 项的复核，其表述精度也需修正（应为「交付组合不提供」）。
- **`specs/30` 的编号冲突**：`30:436` 的「### 15.3」与 `30:463` 的「## 15」并存，其子节又编为 16.x——引用该号须用标题锚点（§2.1 O3 已改），该缺陷本身可另立修项。
- **C1（35 号是否显式化「历史记忆不凌驾当前指令」）与 C2（30 号防注入条款）** 仍属规范修订判断，未立项；本文件不代为决定。

---

## 7. 未证实与缺口

| # | 类型 | 内容 |
|---|---|---|
| U1 | 上限取值 | `maxDepth`／`maxActiveSubagents` 为 volatile，本机 profile 未覆盖；未遍历全部 profile |
| U2 | 三路径额度 | §3.6 为**源码判定**，未做运行时压力实测（多次并发是否真不报 `ACTIVATION_LIMIT_REACHED`）。**已就地标注 [待实测]** |
| U3 | `subagent/end` 粒度 | 源码与测试支持「按 residency epoch 发、且只取本 epoch 后缀」（`lifecycle.ts` 的 `createActivationObserver`：`boundary = child.session.seq` → `snapshotEvents(boundary)` → `finalAssistantOutput`）；**运行时未实测** |
| U4 | 成本闸门 | 未穷举宿主全部包；「未查到」≠「确定不存在」 |
| U5 | 空闲锚点可用性 | 会话检查点与启动事件在 0.2.0-rc.2 的可用性与时序未实测（与 §8 第 4 项的「现成锚点」表述冲突已就地降档） |
| U6 | worktree 端到端 | 「主控会话以 worktree 为 cwd」未实测（管辖、Gate、事实源写入三处） |
| U7 | `specs/08` §7.7 结论的时效 | 该结论核验于 2026-09-10 且内容关于 `session-persistence`；**本次冻结比对不含该包**，故未在 0.2.0-rc.2 复核（O14/C4 引用须附此声明） |
| U8 | 事件计数口径 | `EVENT_API` 源码 = 81（权威）；运行时 `Event.listEvents` 条数依赖装配作用域（本次审核另一会话读得 75 项）——凡「全表」断言须声明口径 |
| U9 | 设置卡文案 | 宿主设置卡的字段文案本次不可直读（`app.asar` 为归档）；仅取值与 `volatile` 属性可证 |
| G1 | 上游时间线 | attempt 锁／成本闸门是否在宿主路线图中未知；编排子系统源码已两代未变，不应据「以后会有」预设设计 |
| G2 | 生态 | 兄弟编排仓自 2026-09-26 起 7/8 零提交（唯一变化者只做子代理模型路由） |

---

## 8. 处置建议（按优先序）

> **程序说明（补审核意见）**：下列各项中凡涉及「改动实现」或「推进规范」者，其**是否建工单、以及判断依据**应按 `specs/21` §6.3 路由提请，并在交还中说明依据（`specs/32` §17.1 同款要求：「不经裁决前，主控按『是否需要跨会话保留授权与结果』判断并**在交还中说明依据**」）。本节**不代替**该程序。

1. **P0 · 三件换接 + 一件接入**（不动规范）：A1 换 `ctx.subagents.listChildren`／`listDescendants`；A2 换 `subagent/end`；C1 随 A2 一并接入 `subagent/start`；C2 接入 `sendMessage(steer)`。**前置**：先验 U3。**性质**：这是**改实现**，须按上述程序路由，不因「纯减法」而免除。
2. **P0 · 本文件作为 08 章写作输入**：据 §5 骨架（含三条写作纪律）产出**去状态化**的正文候选；如涉及 `specs/08` §5.4，按 §1 附注的口径**删除核验标注**而非更新版本号。
3. **P1 · 补底座遗留第 7 项**：`toolFilter`／`tools.guard` 实测 → B3/B7 从 persona 自律升到能力白名单／宿主网关档。
4. **P1 · 空闲维护代理（条件式）**：用 `agent/turn-stopping` + `agent/created` 两锚点实现；**锚点可用性须先实测**（U5），未具备前按 `specs/02` §17 的条件式要求处理。
5. **P1 · 真实验证**：B1/B2 在真实工单／调研／讨论上跑一轮并如实记录卡点。
6. **P2 · B6 须先经 Human 裁决**：`specs/02` §24 红线 6 明文「不为尚未成立的未来能力预设锁、调度器、恢复协议或跨环境兼容层」。
   - ~~①由 08 承接为宿主缝并要求上游补面~~
   - ~~**①已删除**：该路径即「为尚未成立的能力预设锁」，与红线 6 不相容；且 `specs/08` §6 的「宿主缝」明确指**已在提供**的缝（`:130`「上列宿主缝是**可用手段**」），「要求上游补面」超出该语义。~~
   - **②（与红线相容）**：明写作「次序与核对为执行者义务、当前无机械编排」，并按 `specs/01` §7.2 以条件式要求表达。
   - 裁决前 21 §15.2 首行不得删。
7. **载体处置（补审核意见）**：本文件当前**未被 git 跟踪**，处于可丢失状态（仓库纪律见 `docs/docs-cleanup-retention-table.md`：未跟踪文档「先 `git add`」）。其性质（开发设计输入）合规，但**建议 `git add` 或按其内容转 Spark／WorkCase**——否则 `docs/` 的一次清理即真删除其唯一副本。**该处置属 Human 决定**。
8. **本文件不产生任何授权**：不构成规范修订、不构成事实对象、不构成对任何未完成能力的「已保障」声明。

---

## 附：本文件的核对方式与边界

- 宿主面：`cordis_inspect_query`（host：`Service.listService`／`Event.listEvents`／`Config.listConfigs`／`Tool.listTools`）＋ 源码读取（路径与行号随表给出）。**装载判据**：`plugin_manager list_bundles` + `Config.listConfigs` 条目数 + `Tool.listTools`，**不以 `Service.listService` 单独判定**。
- 事件目录：以 `packages/extensions/tool-cordis/src/api-catalog.ts` 的 `EVENT_API` 为权威（含复现命令，见抬头）。
- 版本与冻结：`git diff <tagA>..<tagB> --stat -- <path>`；`git rev-parse <tag>:<path>` 逐文件 blob 比对。
- 规范侧：`specs/00`（§4.2、§5.4）、`specs/01`（§7.2 实现状态禁令）、`specs/02`（§8、§14–§19、§21、§24）、`specs/03`、`specs/07`（§5.3）、`specs/08`（§2、§3.1、§3.3、§5、§5.4、§6、§7.7）、`specs/21`（§3.2、§10.4、§14、§15.1、§15.2、§19）、`specs/30`（调研子代理职责章、调研 vs 编排节、红线）、`specs/31`（适用条件、§8、§12、§16、§17、停止位置）、`specs/32`（§12、§16、§17.1、§17.2）、`specs/35`（文件头效力自述、§10.1–10.6、附录 A.5、附录 B）；底座 `docs/archive/team-control-foundation-draft.md`（总则、§0.4、§1.1、§1.7、遗留表，**性质为 Human 终审通过的设计输入，不取得规范效力**）。
- **本文件为只读调研与起草输入的产出**：未修改 `specs/`、未创建任何事实对象、未提交。
