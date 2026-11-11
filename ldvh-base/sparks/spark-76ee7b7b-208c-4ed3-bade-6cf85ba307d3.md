---
title: 建立上游 DSH 能力变化的吸收与同步机制
status: implemented
question: 上游 DSH 能力变化（版本推进、契约面增删改、破坏性迁移）如何被持续地机械吸收与同步，而不是靠人工事后补？
scope_boundary: 宿主基线有唯一权威登记点、契约面差分可取数、差动能机械落到「破坏／降级／无关」三态，且落地时机点被规范写明时停止。
intent: 保留理由——上游持续演进，能力面变化直接影响插件实现与「四档纪律」的档位诚实性（依赖未实测宿主机制的档位必须标注待实测并降一档）。现状核实表明：本仓已有一次真实破坏（0.2.1-rc.1 移除 start/startContinuable）由人工事后补，而版本推进记录仍停在 norm 的观察值；故须从「泛方向跟踪」收紧为「可机械执行并记录落地时机的机制」。
summary: 已关闭为 implemented：四要件齐备——②③差分与三态机械落地（host-contract-diff.mjs，回归锚复现人工登记数字与三次已知破坏）；④落地时机点经 Human 裁定由 Norm host-upgrade-followup 承载；①登记点沿用 norm a1b559a6。specs/10 §8 验证行降为可选优化。
serves: af93e218-e9d9-4234-b436-33dc0c7c37dc
disposition: ②③本轮落地为 host-contract-diff.mjs（三通道差分＋三态初值，回归锚复现人工登记数字与三次已知破坏）；④经 Human 2026-11-11 裁定由 Norm host-upgrade-followup 第3/6步承载落地时机点，四要件齐备。specs/10 §8 验证行降为可选优化、另行提请。详见 devlog-b8d40abe。
object_uid: 76ee7b7b-208c-4ed3-bade-6cf85ba307d3
fact_type_key: spark
created_at: 2026-09-12T21:52:17.976Z
change_log:
  - at: 2026-09-12T21:52:17.976Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Spark 对象
  - at: 2026-09-13T15:08:54.035Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 回填 priority=P1（20 §8 新增字段，Human 裁定 A；AI 出初值，Human 可随时调整）
  - at: 2026-09-26T09:12:45.339Z
    provider: glm
    model: glm-5.3
    summary: refs 回挂编排生态调研（research-25a34e54）：auto-review 转正跟踪与 workflow 消费方式评估的证据基线，当前理解补一段最新摘要
  - at: 2026-10-19T04:56:46.345Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: Human 指令 m00496：由「上游 DSH 能力变化的吸收」收紧为「建立上游 DSH 能力变化的吸收与同步机制」，标题/问题/边界/当前理解实质重写并补 2026-10-19 实测取证
  - at: 2026-10-24T05:59:45.832Z
    provider: minmax
    model: MiniMax-M3.1-Flash
    summary: 补记 2026-10-24 实测：宿主已到 0.2.1-rc.3（基线经 Human 决定推进），0.2.1-rc.2→rc.3 服务端零契约变更且客户端槽位纯新增，0.2.0-rc.2→0.2.1-rc.3 的比对缺口已补上并把 ctx.invariants 的移除定位到提交 f028f25667（首个缺失该缝的发布 tag 为 0.2.1-alpha.1），两个宿主库依赖的版本分叉已对齐
  - at: 2026-11-01T23:39:15.893Z
    provider: workbuddy-global
    model: deepseek-v4.1-flash
    summary: 补入 2026-11-02 只读重核节：四要件逐项核为 1/4——① 基线登记点已成立且已追平实测（norm a1b559a6 第 75 行登记 0.2.1-rc.5，与本机 CFBundleShortVersionString 一致，change_log 记 rc.1→rc.5 四步推进与逐次差分结论，故「登记值已被实测推翻」已不成立）；② 差分人工可取但无机械通道（plugin/scripts 8 个脚本无宿主契约差分器）；③ 三态机械判据未落（host-seams snapshot 是运行时软探测，对「上游新增方法」无感）；④ 落地时机点无规范条文（specs/10 §8 与 specs/06 均无上游比对行）。summary 未改
  - at: 2026-11-10T10:47:30.435Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 补 recall_digest：为召回提供高密度关键词面（02 §7.1）
  - at: 2026-11-11T12:00:27.918Z
    provider: qoder-global
    model: qmodel_38max
    summary: Human 2026-11-11 裁定认可 Norm host-upgrade-followup 承载④「落地时机点」，四要件齐备，Spark 转 implemented。正文补记本轮②③机械落地（host-contract-diff.mjs + 消费面清单 + 三态初值，回归锚复现人工登记数字与三次已知破坏）与两次真实漏判修正（subagents 可选链漏登、upgrade-guide 回填陷阱）；移除终态不得出现的 priority，补 disposition。残留不可判面如实保留。
refs:
  - object_uid: 25a34e54-fa56-45e7-92a9-85eb222aee97
---

# 建立上游 DSH 能力变化的吸收与同步机制

## 当前理解

本 Spark 已由「上游 DSH 能力变化的吸收」（泛方向跟踪）收紧为「建立上游 DSH 能力变化的吸收与同步机制」（Human 指令 m00496）。原摘要所据的两份 docs 调研（`dsh-current-version-and-market-gap.md` 128 行、`dsh-0.1.2-upgrade-survey.md` 154 行）已随提交 ec19ba6（2026-10-12）整体删除 docs/ 而不可再取，凭据链断裂，故不再作为当前理解的依据。

### 现状核实（2026-10-19 实测）

- 宿主已推进到 **0.2.1-rc.2**（`CFBundleShortVersionString`；asar 内 296 个 dsh* 包全为 0.2.1-rc.2），而 norm `a1b559a6`（本地开发工作流）的「目标环境」仍登记 0.2.0-rc.2（观察时点 2026-09-30）——登记值已被实测推翻。
- 区间 dsh-v0.2.0-rc.2（2026-09-29）→ dsh-v0.2.1-rc.2（2026-10-17）共 1925 commits：契约表服务 91→98（删 1 增 8、改 24）、事件 81→82（改 1）、类型 936→1053（删 9 增 126、改 51）、模型可见工具名 65→68（零删除）、会话事件 type 闭集与 SESSION_FORMAT_VERSION(4) 未变。
- 本插件消费面 12 服务 / 9 事件，逐条比对后**唯一被删除的服务是 `invariants`**（替换为软探测惰性，不构成运行时破坏，但造成安装期 schema 断言静默降级）；所消费的 systemPrompt / webServer / connection 成员均未变（仅新增方法）。
- 已发生过一次真实破坏并由人工吸收：宿主 0.2.1-rc.1 起 `start` / `startContinuable` 移除、`SubagentRun.localAgent` 消失（见 plugin/lib/friction-discovery-provider.js:8-16、plugin/lib/session-signature.js:206-228）。
- specs 全文无「宿主版本追踪 / 契约快照 / 侵入性检查 / 基线核对」条款；spec 10 §8 验证表 10 行全部是「本仓内部一致性」，没有一行比对上游版本差异。
- 现有实现只有**运行时软探测**（plugin/lib/host-seams.js 的 `snapshot()` 对五缝返回 consumed/absent/available/partial，plugin/lib/index.js:373-390 在装载期逐条 logger.info），它探测「宿主缺该能力」，不比对「宿主版本变了」，且派发点 friction-discovery-provider.js:386 直接调用 `subagents.startActivation(...)`、无存在性守卫。
- 现有「版本推进 → CHANGELOG 记一条 + 契约差分数字」是**手工惯例**（plugin/CHANGELOG.md 已有 0.1.7-rc.2 / 0.2.0-rc.1 / 0.2.0-rc.2 三条先例），未被任何机械检查承接。

### 现状核实（2026-10-24 实测）

- 宿主已推进到 **0.2.1-rc.3**（`CFBundleShortVersionString`；asar 内 `dsh/node_modules/@deepseek-ai` 下 297 个 `dsh*` 包全为 `0.2.1-rc.3`，该目录共 308 个 `@deepseek-ai` 包）；本仓登记的开发基线（norm `a1b559a6`）已按 Human 决定推进到该版。
- 区间 dsh-v0.2.1-rc.2（2026-10-17）→ dsh-v0.2.1-rc.3（2026-10-23）共 6 commits、640 文件：**服务端零契约变更**——本插件消费的 10 条宿主缝（tools.register/guard、userQuestions.ask、fs/observed 与 fs 服务、webServer.register、systemPrompt、sessionPersistence、三个 agent 事件、dshHomePath、atomic-write）所在目录的差异**仅为 package.json 版本行**；客户端槽位纯新增（74→77，新增三个 `*.actions` 槽位，零删除），本插件使用的四个槽位 registration 字段逐字未变。
- 此前登记的「0.2.0-rc.2 → 0.2.1-rc.2 区间未做契约比对」缺口已补上：区间 dsh-v0.2.0-rc.2 → dsh-v0.2.1-rc.3 共 1931 commits，本插件消费的 10 条缝签名**全部保留**；唯一被删除的宿主服务 `invariants` 已定位到唯一提交 `f028f25667`（2026-09-30，`refactor: remove runtime invariant plugins`，1355 files / −15409 行），**首个缺失该缝的发布 tag 是 `0.2.1-alpha.1`**（`packages/**/src/invariant.ts` 计数 0.2.0-rc.2=38 → 0.2.1-alpha.1 起=0）；区间内两处取值域收窄（tools 的 `mode:'both'` 被移除、webserver 的 `host` 不再接受 `'0.0.0.0'`）属宿主侧配置，本插件不写这两处配置。
- 本轮实际落地：两个**普通依赖**（自带副本）`@deepseek-ai/dsh-atomic-write` 与 `@deepseek-ai/dsh-home-paths` 此前解析到 `0.1.2-alpha.3`、与宿主内的 `0.2.1-rc.3` 分叉（旧副本不含「已退出持有者锁接管」的 `ESRCH` 探针，而插件的部署约束登记一直按该语义陈述），已钉到 `^0.2.1-rc.3`；devDependencies 的四个 dsh 包与 cordis 同步对齐宿主。
- 仍未决：`dsh-client-ui-primitives` 在 rc.3 的 asar（打包区与 unpacked 区）均缺席而插件客户端仍能加载，本轮以同一提取方式复现该观察，**不作结论**；「宿主装了什么」的权威取值方式仍待定；机制落点（spec 10 新增条款 vs CLI 侧确定性检查）仍待 Human 决定。

### 机制须回答的问题

1. 基线登记：宿主基线的权威登记点在哪（现分散于 norm a1b559a6 目标环境、CHANGELOG、package.json peer/dev）且如何一处为权威。
2. 差分取证：契约面差分的机械取数方式（服务/事件/类型/工具名/槽位闭集 + 条目指纹），及「只比本插件消费面」的收敛口径。
3. 侵入性判定：差分结果如何机械落到「对插件是破坏 / 静默降级 / 无关」三态，避免每次靠人工通读 40 份 upgrade-guide。
4. 落地时序：机制停留在「报告」还是可以「阻断」；参照 36 号规范 §11/§12 的 fail-closed 与待处置队列范式。

### 边界与未决

- 本机制的实现须守住 spec 10 §11 与 spec 36 §21 的反过度设计红线：只针对 DSH 一个宿主、不建通用抽象、不为每个场景建独立账本。
- 未决：「宿主装了什么」的权威取值方式（asar 解析已建成取证脚本但仍有偏移脆弱性，见 pitfall d8d4bc4a）；peer 包 `dsh-client-ui-primitives` 在 0.2.1-rc.2 asar 中缺席而插件仍运行，此事实尚未解释，**不得据此主张任何结论**。
- 未决：机制落点是 spec 10 新增条款、还是 CLI 侧确定性检查（spec 05 helper-service-contract）由 Human 决定。

（来源：本地仓 /Users/dmh2002/DshProject/deepseek-harness 的 tag dsh-v0.2.0-rc.2 / dsh-v0.2.1-rc.2；宿主 asar 实测；plugin/lib 实测；普查原条目 B-04）

### 2026-11-02 重核（只读）：四要件 1/4，基线登记点已建并在用

> 本节给出**当前**证据；上文是记录时点叙述，未改写。

`scope_boundary` 四要件逐项核：

**①「宿主基线有唯一权威登记点」——已成立，且已追平实测**。`ldvh-base/norms/norm-a1b559a6-6c13-494b-974a-a9368686bc7b.md` 第 75 行登记「DSH Desktop `0.2.1-rc.5`（`/Applications/DeepSeek Harness.app`）」；本机实测 `CFBundleShortVersionString` 亦为 **0.2.1-rc.5**，登记值与实测一致。该 norm 的 change_log 逐次记录了 0.2.0-rc.1 → rc.2 → 0.2.1-rc.3 → rc.5 四步推进，每次均注明「四项实证重新独立取得」并附契约差分结论（第 48 条记 rc.3→rc.5：「服务端仅两处非消费面变更、客户端槽位键 103→103 全等、reasoning.body 新增 rawText 但本插件未注册该槽位」）。**即上文所记「norm 登记值已被实测推翻」已不再成立**——2026-10-24 与 2026-10-30 两次 Human 决定的推进已把它追平。故「登记点分散」的问题也已收敛：norm 为权威，CHANGELOG 与 package.json 为派生。

**②「契约面差分可取数」——人工可取，无机械通道**。差分结论确实被逐次取得并写入 change_log，但取得方式是人读上游仓库 tag 与 asar 清单；`plugin/scripts/` 下 8 个脚本（`affected-tests`／`backfill-spark-priority`／`bench-tests`／`drift-check`／`mutation-check`／`run-tests`／`specs-bundle`／`test-lint`）**没有一个是宿主契约差分器**。`drift-check.mjs` 是「召回-源一致性检查」（制造源变动验证召回模块能否感知），对象是 `specs/` 与 `ldvh-base/`，不是上游契约面。

**③「差动能机械落到破坏／降级／无关三态」——未落**。现有 `plugin/lib/host-seams.js` 的 `snapshot()` 是**运行时软探测**（装载期看缝在不在），它回答「此刻这缝可用吗」，不回答「相对登记基线，哪些契约面变了、变的是否破坏」。二者判据不同：软探测对「上游新增了方法」无感（不影响可用性），而三态判定要能报出「新增」并归入「无关」。故上文所记「只有软探测」在 2026-11-02 仍成立。

**④「落地时机点被规范写明」——未落**。`specs/10` §8 验证表现 11 行，全为本仓内部一致性（新增的一行是「宿主缝消费」），无一行比对上游版本差异；`specs/06`（Code 实践与测试规范）全文无「宿主版本／上游／契约快照」条款。

**故本条的完成度是 1/4**：登记点已建且已在使用中追平两次，差分靠人工、三态无机械判据、时机点无规范条文。上文「靠人工事后补」的诊断在**结果**层面已被两次及时推进部分证伪（两次都赶在破坏发生前吸收），但在**机制**层面未被推翻——那两次推进靠的是 Human 决定与人工核对，不是机制触发。剩余工作的性质因此收敛为：**把已经稳定运行的人工流程机械化**，而不是「建立一个还没有的流程」。

### 2026-11-11 落地：机制建成，四要件齐备（Human 授权直接执行后关闭）

> 本节给出**当前**证据；上文是记录时点叙述，未改写。

本轮按 Human 需求形态（「每次上游更新，只告知 AI，AI 就知道怎么跟进」）落地机制，四要件逐项收口：

**②「契约面差分可取数」——已落地为机械通道**。上游仓内已提交三张带 CI 新鲜度门禁的生成物：`api-catalog.ts`（SERVICE_API/EVENT_API/TYPE_API 三表）、`slot-catalog.ts`（CLIENT_SLOT_API）、upgrade-guide 目录（官方破坏性变更自述）。新增 `plugin/scripts/host-contract-diff.mjs` 对其做三通道差分（括号深度解析，见 `plugin/lib/host-contract-catalog.js`），不再需要 asar 解析或人工通读源码。回归锚点复现了历史人工登记数字：`dsh-v0.2.1-rc.5`→`dsh-v0.2.2-rc.1` 服务 98→107、槽位键 103→109，与 norm a1b559a6 的 2026-11-05 登记吻合。

**③「差动能机械落到三态」——已落地为初值判定**。对照机器可读消费面清单（`plugin/lib/host-consumption.json`：14 服务 / 10 事件 / 4 槽位，逐项带 callSites），差分器把每条变更落为「破坏／须审／无关」初值，并按字段分层（契约字段 vs 噪音字段，见 FIELD_LAYERS）滤除 standardProps/source 等非契约漂移。三次已知真实破坏（remove-runtime-invariants / subagent-activations / schedule-agent-tools）全部被差分器命中。**三态是初值不是结论**：最终归类须 AI 读 guide 原文后提请、Human 落定（Norm 第 4–6 步）。

**④「落地时机点被规范写明」——经 Human 裁定由 Norm 承载（本轮授权决定）**。上文 2026-11-02 重核把④判为「未落」，因其判据指向 specs/10 §8 验证表；本轮新建 Norm `host-upgrade-followup`（norm-0e0436c1）以七步 runbook 承载落地时机点（第 3 步差分、第 6 步登记时序、fail-closed 纪律）。Human 2026-11-11 裁定：认可 Norm 已承载④，四要件齐备，Spark 可关闭；specs/10 §8 验证行的增补降为可选优化、不阻塞关闭，另行提请（属元规范修订、独立 Human Gate）。

**本轮修正的两次真实漏判（机制自身在开发中暴露）**：① 消费面清单曾漏登 `subagents` 服务——它经 `agent?.ctx?.get?.("subagents")` 可选链取得，按 receiver 名匹配的提取正则抓不到，而它正是第二次已知破坏 subagent-activations 的消费面；一致性测试改 receiver-agnostic 提取后抓到并补登。② upgrade-guide 事后回填陷阱——`subagent-activations` guide 在 dsh-v0.2.1-alpha.1 tag 当时不存在、由上游回填到后续 tree，按 `git diff base..target` 新增文件判区间会完全漏掉该已知破坏；改为从最高版本 tag tree 读、按版本号筛 (基线,目标] 区间，并立回归锚防退化。

**产出与留痕**：见 devlog-b8d40abe（本轮受控创建）、norm-0e0436c1（七步 runbook）；受控提交 3a8d3154（11 文件，全量套件 3184 pass / 0 fail，31 条新测试全部经变异检验确证检测力）。

**残留边界（如实报告，不因关闭而消失）**：差分器只在 macOS 本机克隆实跑过；值服务（dshHomePath 等）与客户端服务（slots/locale 等）无仓内生成物目录、差分不可判，报告逐项列因不假装覆盖；非契约 CSS 锚点（提问卡 DOM）不可判，靠真机验收兜底；锚 B 的 guide 总数 22 依赖上游不再向 alpha.1 目录回填。这些属机制的已知不可判面，不是缺陷，由 Norm「不可判面」条目承载；下次上游更新按 Norm 七步 runbook 执行即触发本机制。

## 调查问题

上游 DSH 能力变化（版本推进、契约面增删改、破坏性迁移）如何被持续地机械吸收与同步，而不是靠人工事后补？

## 调查边界

宿主基线有唯一权威登记点、契约面差分可取数、差动能机械落到「破坏／降级／无关」三态，且落地时机点被规范写明时停止。
