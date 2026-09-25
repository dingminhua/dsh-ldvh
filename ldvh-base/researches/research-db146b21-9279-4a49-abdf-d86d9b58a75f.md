---
title: DSH 0.1.5-rc.2→0.1.7-rc.1 升级调研（会话格式 v4 单向门、设置模型重建、客户端接缝删除与默认值翻转）
status: active
research_question: DSH 从 0.1.5-rc.2 到 0.1.7-rc.1 有哪些影响 dsh-ldvh 宿主插件对接与 LDVH 消费面的实质变更
research_purpose: 为 dsh-ldvh 与家族插件提供从 0.1.5-rc.2 到 0.1.7-rc.1 的适配与升级决策依据：本机宿主已实际跃迁到 0.1.7-rc.1，需要定出该差量中哪些是必须适配的破坏面、哪些是可利用的新能力面、哪些是只能由 Human 裁夺的不可逆取舍，以及消费仓当前实际处于什么状态
stopping_reason: sufficient
confirmed_statements:
  - F1 会话格式 V3→V4 使旧版读不回新会话，影子遮蔽把回退变成单向门
  - F2 设置模型整体重建为 SettingsForms，公开面不再有 register 且存储改走 profile patch
  - F3 dsh-settings 的两个自由函数导出自 0.1.2-alpha.2 起已移除，linked-root 解析让命名导入取到宿主副本
  - F4 客户端设置面双删除：settingsScope 服务与 settings.plugin.item 槽位
  - F5 agent/session-start 事件删除，agent/created 由 emit 改 serial 并新增 source 载荷
  - F6 dsh-client-ui-primitives 图标族改粗细语义后缀，导出 75→186
  - F7 区间为 3304 提交，且「默认是否可用」须同时看 base、web-app 与 presets 三处 patch
  - F8 隐私与行为默认值同批翻转：会话日志上传默认开启、子代理深度降为 1、内联预算改按 token
  - F9 报告的影响评估描述的是适配前状态，消费面适配已在本地 dev 落地并通过 931 项测试
uncertain:
  - issue: 影子遮蔽是源码推断，未做回退复现
    reason: resolveGenerationInDirectory 两版逐字相同且按版本号最大者选取，据此推出「新版只要写打开过一次、旧版就再也打不开」；但本次未构造真实 v3 会话并在旧版上验证拒开行为，结论强度是「由源码必然推出」而非「实测观察到」
  - issue: 加载失败形态未在适配前代码上复现
    reason: 本对象以适配后代码在该宿主上正常运行作为间接对照，未让适配前代码在 0.1.7-rc.1 上真实启动观察那条 does not provide an export named 报错，故失败形态仍属静态推断
  - issue: settings.yaml 导入映射未逐项核对
    reason: 只确认了 ui-developer-tools→ui-settings 等个别 section→entry 映射与「导入后改名 settings.yaml.imported」机制，完整映射表与冲突处置未逐项比对
  - issue: agent/created 的 serial 语义未逐行核对
    reason: 运行时事件目录给出 mode 为 serial 与含 signal? 的签名，但该模式与 scoped-events.generated.ts 生成物的交互、以及「抛错回滚创建事务」的边界条件未逐行读码确认
  - issue: 运行时枚举为单次内省，未与仓库生成物逐项对账
    reason: 88 个服务、77 个事件与 92 个 Slot 均为当次装配的观察值，故「运行时有几个」与「仓库声明了几个」的一致性未证
  - issue: 本机环境与报告所载基线已漂移
    reason: 观测到的宿主是 DSH Desktop.app 2.0.14（捆绑 0.1.7-rc.1），profile 只有 desktop 与 web、dsh-ldvh 装在 desktop profile，不存在报告所载的 DSH NEXT.app 与 test profile；按报告逐步复现的路径在当前环境下不成立
gaps:
  - description: 未在 0.1.7-rc.1 上复现原报告推断的失败形态
    priority: medium
    blocked_scope: 「原报告 P0-1/P0-2 的失败形态已获实测复现」一类断言——该断言不被本对象主张，F2–F6 只作机制说明；若需该复现，须在隔离环境下对适配前代码做一次受控启动
  - description: 0.1.7-rc.1 到 0.1.7-rc.2 的 346 提交 / 3429 文件未纳入
    priority: medium
    blocked_scope: 「以 rc.2 为对齐目标」的结论——本对象只对 rc.1 成立，rc.2 在 plugin-manager 与 settings 面另有变更需另核
  - description: 第三方插件（dsh-better-sidebar 等）对新宿主的兼容性未验证
    priority: low
    blocked_scope: 「本机插件族整体可用」类结论——ctx.inject 指向的 betterSidebar 命名空间在两版 DSH 仓中都不存在，DSH 升级不直接涉及它
  - description: 桌面壳自身变更未获官方发布说明对照
    priority: low
    blocked_scope: 壳层行为变化结论——DSH Desktop.app 2.0.14 的壳层改动只有本机安装产物观察，无上游文本佐证
implications:
  - finding_ref: F1 会话格式 V3→V4 使旧版读不回新会话，影子遮蔽把回退变成单向门
    implication: 会话数据面从「可回滚的版本升级」变为「单向门」：升级前必须整目录备份会话根，且回退预期不能作为风险缓解手段计入；dsh-ldvh 作为会话消费者与其它消费者同等暴露。
  - finding_ref: F2 设置模型整体重建为 SettingsForms，公开面不再有 register 且存储改走 profile patch
    implication: 「注册一个设置命名空间」的旧心智模型整体失效——修好符号引用也不等于设置可用；设置必须改为声明进本插件 Loader 条目的 Config 并标 .volatile()，写入走 configEditor。
  - finding_ref: F3 dsh-settings 的两个自由函数导出自 0.1.2-alpha.2 起已移除，linked-root 解析让命名导入取到宿主副本
    implication: peer 版本范围覆盖不等于 API 兼容：凡以「范围含该版本」代替「符号仍存在」的核对都会漏判；符号面须逐项在目标 tag 上复核。
  - finding_ref: F4 客户端设置面双删除：settingsScope 服务与 settings.plugin.item 槽位
    implication: 客户端服务缺失是静默失效（inject 未满足则 apply 不执行），「没报错」不能作为客户端适配完成的判据；核对只有服务目录与 Slot 拓扑两条。
  - finding_ref: F5 agent/session-start 事件删除，agent/created 由 emit 改 serial 并新增 source 载荷
    implication: 「删除 + 改模式」是本轮最易漏过的破坏形态：旧事件不存在不报错、只让初始化永不执行，故生命周期监听须在运行时事件目录逐个核对存在性与 mode。
  - finding_ref: F6 dsh-client-ui-primitives 图标族改粗细语义后缀，导出 75→186
    implication: 宿主具名导出改名对「按名取用」毫无韧性且崩溃点在 try/catch 之外；应按名探测加回退，把硬崩溃降级为视觉降级。这类回归与设置面无关，需独立核对。
  - finding_ref: F7 区间为 3304 提交，且「默认是否可用」须同时看 base、web-app 与 presets 三处 patch
    implication: 「默认是否可用」须三处 patch 联看（base / web-app / presets），只看 base 会系统性误判；这解释了为什么本区间「源码搜得到」与「装起来能用」经常不一致。
  - finding_ref: F8 隐私与行为默认值同批翻转：会话日志上传默认开启、子代理深度降为 1、内联预算改按 token
    implication: 默认值翻转与 API 破坏是两类风险：前者不使插件加载失败却改变行为与数据去向，对「升级后正常」无贡献；隐私默认属 Human 取舍，子代理深度属必须显式配置项。
  - finding_ref: F9 报告的影响评估描述的是适配前状态，消费面适配已在本地 dev 落地并通过 931 项测试
    implication: 消费本对象时须区分机制说明与当前状态：F2–F6 说明上游移除了什么、旧写法为何会坏，F9 才是当前状态（适配已落地、931 项测试通过、尚未推送）。不区分会把已修复项当作现行故障传递。
urls:
  - ref: https://github.com/deepseek-ai/deepseek-harness
    title: deepseek-harness（DSH 内核源码仓）
    summary: 全部内核侧发现的对照源：两 tag（dsh-v0.1.5-rc.2 = fb2c4b9e69、dsh-v0.1.7-rc.1 = 46a7f68b09）的只读差分，覆盖会话格式目录、设置包、客户端 UI 包、bundle patch、事件与服务声明源。限制：仓库根无 CHANGELOG，变更语义须由源码与 .agents/notes/** 决策记录反推；静态差分只证明「发布内容」，不证明运行时装了什么
  - ref: https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.5-rc.2...dsh-v0.1.7-rc.1
    title: 两 tag 的区间对照（GitHub compare）
    summary: 区间提交与文件改动的可复核入口，可重新定位到具体提交。限制：只给发布线差异，不含运行时装配
  - ref: https://registry.npmjs.org/@deepseek-ai/dsh
    title: "@deepseek-ai/dsh（npm registry 元数据）"
    summary: dist-tags 读取（latest = 0.1.5-rc.3、alpha = 0.1.7-alpha.2、next = 0.1.7-rc.2），支撑「rc.2 已是 next 通道」的判断。限制：只给版本与标签，不给变更内容；npmjs.com 包页本次返回 403，故以 registry 元数据端点为准
  - ref: https://github.com/dingminhua/dsh-ldvh
    title: dsh-ldvh（受辖项目仓）
    summary: 消费面核对的发生地：插件接缝枚举、适配提交（3c07fda、9f09596）与 931 项测试基线。限制：截至观测时点两个适配提交尚未推送，origin/dev 仍停在 30cecc1（2026-09-15），故远端仓只承载适配前的消费面代码
relations:
  - relation_key: updates
    target:
      object_uid: 4ee122a9-517e-44c0-a7b3-76578a710901
  - relation_key: informs
    target:
      object_uid: 76ee7b7b-208c-4ed3-bade-6cf85ba307d3
object_uid: db146b21-9279-4a49-abdf-d86d9b58a75f
fact_type_key: research
created_at: 2026-09-25T03:44:23.565Z
change_log:
  - at: 2026-09-25T03:44:23.565Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Research 对象：DSH 0.1.5-rc.2→0.1.7-rc.1 升级调研（9 项关键发现、6 项未证实、4 项缺口、5 条建议）
---

## 研究问题

DSH 从 0.1.5-rc.2 到 0.1.7-rc.1 有哪些影响 dsh-ldvh 宿主插件对接与 LDVH 消费面的实质变更

本轮调研的对象是 DSH 内核（`deepseek-ai/deepseek-harness`）在 `dsh-v0.1.5-rc.2`（`fb2c4b9e69`，2026-09-10）与 `dsh-v0.1.7-rc.1`（`46a7f68b09`，2026-09-23）之间的变更全量。要回答的是：这段差量里哪些是必须适配的破坏面、哪些是可利用的新能力面、哪些是只能由 Human 裁夺的不可逆取舍，以及 dsh-ldvh 现有消费点各自面临什么。原报告（`docs/dsh-0.1.5-rc2-to-0.1.7-rc1-research.md`，3419 行）把 3304 个提交拆成 7 条并行调研线：会话格式与持久化、插件体系与安装生命周期、宿主服务契约、客户端与 Web 契约、新增能力面语义、Agent 循环与默认值、dsh-ldvh 宿主接缝逐条核对。

**查重结论**：`ldvh-base/researches/` 既有 26 份对象中，三份 DSH 版本调研分别覆盖 `0.1.2-rc.1→0.1.5-alpha.1`（`research-65363842`）、`0.1.2-rc.1→0.1.5-rc.1`（`research-6c81daa2`）与 `0.1.5-rc.1→0.1.5-rc.2`（`research-4ee122a9`），**没有任何对象触及 0.1.6 或 0.1.7**。本区间与 `research-4ee122a9` 同源（同为 DSH 内核、同为家族/消费面视角）但版本对与问题实质不同，按 24 §6「外部对象版本发生足以改变结论的重大变化时新建对象」处理：新建本对象并以 `updates` 关系回指 `research-4ee122a9`；旧对象在其问题范围内（`rc.1→rc.2` 差量）仍为当前依据，本对象不处置其状态。

**子阶段判定**：调研对象与问题在启动时已明确（两个 tag 已定），无需先行调查阶段收敛问题，故为明确方向型；正文不含 `调查阶段` H2。

**与 `docs/` 其它两份升级备忘的关系**：`dsh-0.1.2-upgrade-survey.md` 自述「开发设计输入（非规范、非事实对象）」，且已被 `docs-to-spark-census.md` B-04 归入 `spark-76ee7b7b`（上游 DSH 能力变化的吸收）作长期跟踪；`dsh-0.1.5-rc2-to-0.1.6-research.md` 的对象 `0.1.6-alpha.2` 落在本区间之内，其结论被本对象覆盖。两者本次都不另建对象。

## 输入与边界

- `https://github.com/deepseek-ai/deepseek-harness`：全部内核侧发现的对照源。本地克隆含两 tag（`dsh-v0.1.5-rc.2` = `fb2c4b9e69`、`dsh-v0.1.7-rc.1` = `46a7f68b09`）及区间内四个 `0.1.7` 标签（alpha.1/alpha.2/rc.1/rc.2）。**方法**：`git show`／`git grep`／`git ls-tree`／`git rev-list`／`git diff` 的只读双 tag 差分，覆盖会话格式目录、设置包、客户端 UI 包、bundle patch、事件与服务的声明源。**限制**：仓库根无 `CHANGELOG`，变更语义须由源码与 `.agents/notes/**` 决策记录反推；静态差分只证明「发布内容」，不证明运行时装了什么。
- `https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.5-rc.2...dsh-v0.1.7-rc.1`：区间提交与文件改动的可复核入口（可重新定位到具体提交）。**限制**：只给发布线差异，不含运行时装配。
- `https://registry.npmjs.org/@deepseek-ai/dsh`：dist-tags 读取。**限制**：只给版本与标签，不给变更内容；`npmjs.com` 包页在本次观测返回 403，故以 registry 元数据端点为准。
- `https://github.com/dingminhua/dsh-ldvh`：消费面核对的发生地（插件接缝枚举、适配提交与测试基线）。**限制**：截至观测时点，消费面适配提交（`3c07fda`、`9f09596`）**尚未推送**到该仓的 `origin/dev`（`origin/dev` 仍停在 `30cecc1`，2026-09-15），故远端仓只承载适配前的消费面代码。
- `https://www.npmjs.com/package/@deepseek-ai/dsh`：上一轮对象使用过的 npm 包页。本次观测返回 403，未能复核，故不作为本对象证据。

**运行时内省（本地机械观察，不是外部来源）**：运行中宿主经 `cordis_inspect_*` 的只读取证——服务目录 88 个 `ctx.*`、事件目录（`emit` 55／`waterfall` 17／`parallel` 3／`serial` 2）、客户端 Slot 拓扑（91 个 slot 节点 + 1 个 factory 节点）。该类数字是**当次装配**的观察，与仓库生成物（`api-catalog.ts` 一族）不必然逐项相等，故按本地观察登记、不作为外部证据。

**观察时点**：2026-09-25 10:30–11:30 CST。**分析方法**：git 双 tag 静态差分 + 运行中宿主的 Inspect 服务/事件/Slot 目录取证 + 消费仓接缝逐条核对 + 插件测试套件运行。**独立复核**：本对象落档前，对 13 项头条事实做了一轮独立只读复核（另一子代理，`git show`/`git grep`/`git ls-tree` 只读命令），13/13 全部复现，其中 2 项为口径限定（见「未证实与缺口」）。

**不覆盖范围**：

1. **未做受控启动复现**：没有在 `0.1.5-rc.2` 上真实启动旧版插件以复现「加载失败」，故原报告 §4 的失败形态属静态推断而非实测结论（本轮以适配后代码在该宿主上实际运行作为间接对照）。
2. **未覆盖 `0.1.7-rc.2`**：该 tag（`477b4f42`）较 `rc.1` 另有 **346 提交 / 3429 文件**，不在本次范围。
3. **未验证第三方插件**：`dsh-better-sidebar` 等社区插件对新宿主的兼容性不在本次范围。
4. **环境已漂移**：原报告记载的宿主为 `/Applications/DSH NEXT.app`（`dsh-desktop-next@2.0.14-next`）、`dsh-ldvh` 装在 `test` profile；本次观测实际为 `/Applications/DSH Desktop.app`（`dsh-plugin-desktop` 2.0.14，捆绑 `@deepseek-ai/dsh` **0.1.7-rc.1**），profile 只有 `desktop` 与 `web`，`dsh-ldvh` 装在 **`desktop`** profile，不存在 `test` profile。按原报告逐步复现的路径需先按此更正。

## 关键发现

### F1 会话格式 V3→V4 使旧版读不回新会话，影子遮蔽把回退变成单向门

`SESSION_FORMAT_VERSION` 由 **3 改 4**；`session-format-catalog` 生成物的 `currentVersion` 3→4、`currentEncoder` 换为 `releasedV4SessionFormatCodec`、`migrations` 追加 `sessionFormatV3ToV4`，并新增独立迁移包 `packages/session/session-format-v3-to-v4`。迁移动作含 tool-result 扁平化、消息 source 改名（`compact`→`compact-checkpoint`、`tools-ptc`→`ptc-mode`、`system-prompt`→`runtime-context`、未知→`plugin:<名>`）、未知 ignorable 事件命名空间化、补写中断的 `turn/end{interrupted}`、密集重编号与引用重映射、补写父级 `subagent/catalog`。方向性判定：旧→新架构上可读（打开只在内存准备，**写打开才发布** `session.v4.jsonl.zstd` 后继，前代文件原样保留）；新→旧**不可读**——`sessionFormatVersionRefusal` 以运行中的 `SESSION_FORMAT_VERSION` 判定出「更新代」即抛 `SessionFormatUnsupportedError`。放大效应在于 `resolveGenerationInDirectory` 按**版本号最大**选文件：新版只要对某旧会话做过一次写打开，旧版就再也打不开它，即使可读的前代文件仍完好同目录。另有硬拒绝面：嵌套 `tool-result`、未知非 ignorable 事件等会被拒绝打开而非迁移。

**价值判断**：这是一次**单向门**，且 dsh-ldvh 正好是会话数据面的直接消费者（`session-signature` 尾读 `model/selection`／`request/context` 取路由、`event-stream` 扫描 `turn/start`→`turn/end`），因此它与其他消费者同等暴露在回退不可逆之下。与「改坏了改回来」的常规预期不同，这里唯一的保险是**升级前对会话根做整目录备份**；把它当成可事后补救的版本升级会误判风险等级。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.5-rc.2 与 dsh-v0.1.7-rc.1：packages/core/session/src/types.ts 的 SESSION_FORMAT_VERSION；packages/session/session-format-catalog/src/generated.ts；packages/session/session-format-v3-to-v4/；packages/session/session-persistence-jsonl/src/index.ts 的 resolveGenerationInDirectory；docs/persistence-changes/2026-09-16-session-format-v4.md）

### F2 设置模型整体重建为 SettingsForms，公开面不再有 register 且存储改走 profile patch

旧版 `SettingsProvider`（含 `settings-file` 提供者、`$DSH_HOME/settings.yaml` 存储、独立 settings 命名空间）被 `SettingsForms`（`inject: ['configEditor','profileContext']`）整体替换。公开方法集从 `get/watch/update/replace` + `installSection` 变为 `configure / prepareDocument / describe / update / replace / mutate / write / schema`——**没有 `register`**，这一点在运行时服务目录上得到确认。三个语义同时改变：**存储**从 `settings.yaml` 改为 profile 的 `cordis.patch.yml`（经 `configEditor`）；**命名空间**从独立 settings 命名空间改为 **profile 插件条目 id**；**可热改字段**从命名空间 schema 改为插件 Cordis `Config` 中标记 `.volatile()` 的字段，且 `applies` 只剩 `'live'`。关联事件 `settings/updated` 删除、改为 `settings/document-updated`(ns, revision)。旧 `settings.yaml` 在设置启动且 Loader 稳定后一次性导入（section id → entry id）随后改名为 `settings.yaml.imported` 以防重复导入，被组合拒绝的段落只留在改名后的文件里。

**价值判断**：这是**架构级**而非 API 级的破坏——「设置」从一份独立文档变成了 profile 配置的一等公民。对第三方插件的正确写法只有一条路径：把可配置值声明进**本插件 Loader 条目的 `Config`**，需要热改的字段包 `.volatile()`，写入走 `configEditor.edit(entry, …)`。凡按旧心智模型「注册一个设置命名空间」写的插件，修好符号引用也仍然无处存值——加载成功不等于设置可用，这是两件事。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.7-rc.1：packages/settings/settings/src/index.ts 的 SettingsForms 导出面；packages/ 内 settingsScope 零命中；.agents/notes/implemented/architecture/2026-09-19-profile-owned-live-configuration.md；packages/client/ui-settings/src/client/config-form.ts 的 super(ctx, 'configForms')）

### F3 dsh-settings 的两个自由函数导出自 0.1.2-alpha.2 起已移除，linked-root 解析让命名导入取到宿主副本

`installSettingsSection` 与 `settingsNamespace` 在 `dsh-v0.1.2-alpha.1` 是真实具名导出（`packages/settings/settings/src/index.ts`），到 `dsh-v0.1.2-alpha.2` 已为 0 命中（改由 `SettingsProvider.installSection` 方法承担），此后一路消失，`rc.1` 的设置包只导出 `redactSecrets`、`SettingsConflictError`、`SettingsForms` 与若干类型。关键机制在解析规则而非导出本身：按 linked-root 规则，当插件以 `link:` 方式装到 profile 且包名被声明为 `peerDependencies`、运行时解析表又提供该名字时，解析取的是**宿主副本**而不是插件自己的物理副本。于是这个失效从「能 import 但在 `ctx.settings.register` 上静默失效」升级为**模块链接期报错、整个宿主插件无法装载**。旧行为之所以长期未被发现，是因为插件 `devDependencies` 里钉着 `0.1.0-rc.6` 的旧副本——只有在按新解析规则取宿主副本时才暴露。

**价值判断**：这条最值得沉淀的不是某个符号改名，而是一个可复用的工程教训：**peer 版本范围不能替代 API 兼容性判断**。插件的 `peerDependencies` 写着 `>=0.1.2-alpha.1 <0.2.0`，语义上**允许** `0.1.7-rc.1`，但被导入的 API 早在该区间起点之后的第一个 alpha 就不存在了——半开区间只约束版本序，不约束符号面。凡以「范围覆盖了」代替「符号还在」的核对，都会在这里漏判。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.2-alpha.1 与 dsh-v0.1.2-alpha.2 与 dsh-v0.1.7-rc.1：packages/settings/settings/src/index.ts 的具名导出对照；packages/boot/app-boot/src/profile-resolution/resolver.ts 的 linked-root peer 拦截规则；.agents/notes/implemented/architecture/2026-09-19-profile-resolution-lookup-order.md）

### F4 客户端设置面双删除：settingsScope 服务与 settings.plugin.item 槽位

客户端两个接缝同时消失，且互不替代。**服务侧**：`ctx.settingsScope` 在 `rc.1` 的 `packages/` 内**零命中**（全仓仅剩文档与笔记提及），替代品是 `ctx.configForms`（由 `ui-settings` 的 `config-form.ts` 以 `super(ctx, 'configForms')` 提供，API 含 `get(ns)` 与 `whileServed(namespaces, register)`）。**槽位侧**：`settings.plugin.item` 在运行时 92 个 Slot 中不存在，设置页注册面迁到 Plugins 页的 `plugins.item` / `plugins.bundle.config`（key = 包名）/ `plugins.row.config`（key = `<包名>#<row id>`）/ `plugins.detail.*`，并以 `view: 'page'` 加自带保存控件呈现。失败形态是**静默的**：声明式 `inject` 未满足则 `apply` 根本不执行，于是对话 Tab、设置卡与侧栏 Tab 的全部注册都不发生，表现为「插件在 Web 上整体消失」而只有控制台留一行报错。

**价值判断**：这条的代价集中在**可发现性**——服务缺失不抛门禁错误，只让功能悄悄不出现，因此靠「没报错」判定客户端适配完成是无效判据。可用的核对只有两条：服务目录里有没有 `configForms`，以及 Slot 拓扑里有没有目标槽位。迁移方向明确（`settingsScope.bind(ns)` → `configForms.get(<entry id>)` + 槽位改投 Plugins 页），但两个缺失点必须都修，只修一个仍旧是半侧不工作。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.5-rc.2 与 dsh-v0.1.7-rc.1：settings.plugin.item 由 13 处命中降为 1 处、plugins.bundle.config 由 0 升为 12 处、conversation.view 两版均 16 处；packages/client/ui-settings/src/client/config-form.ts 的 configForms 服务声明；.agents/notes/implemented/architecture/2026-09-17-settings-pages-as-companion-packages.md）

### F5 agent/session-start 事件删除，agent/created 由 emit 改 serial 并新增 source 载荷

`agent/session-start` 在 `rc.1` 的 `packages/` 内**零命中**（`rc.2` 为 31 个文件命中），语义并入 `agent/created` 的 `source` 载荷，取值闭集为 `startup | resume | clear | compact`。同一次改动还改了**模式**：`agent/created` 由 `emit` 改为 **`serial`**，新签名允许监听器返回 `Promise` 并被串行 `await`——运行时事件目录确认为 `mode: "serial"`，签名为 `payload: { agent, source, signal? }`。两处变化共同意味着：原本「发射后不管」的会话初始化监听，现在既换了事件名，又**站到了 agent 创建事务的关键路径上**——抛错会回滚创建。消费仓的两处监听（`lifecycle.js` 的 pre-step prime 与 scope 映射、`child.js` 的子代理 stop 注册）正落在这个失效面上，且因事件被删除而**不报错、不触发**。

**价值判断**：这是本轮最容易被漏过的一类破坏——**删除 + 改模式**的静默失效。旧事件不存在不会产生任何异常，只会让初始化逻辑永不执行；等到功能出问题时，排查方向通常已经偏离事件面。可复用的判据：凡监听宿主生命周期事件的插件，升级后应逐个事件在**运行时事件目录**里核对存在性与 `mode`，而不是只核对源码里的事件名是否还能搜到。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.5-rc.2 与 dsh-v0.1.7-rc.1：packages/ 内 agent/session-start 由 31 文件命中降为 0；packages/core/scope/src/scoped-events.generated.ts；packages/core/agent-loop 的 announce 路径；运行时事件目录 mode 为 serial）

### F6 dsh-client-ui-primitives 图标族改粗细语义后缀，导出 75→186

图标命名族整体改名：尺寸数字后缀（`IconChevronDownOutline14`）改为粗细语义后缀（`IconChevronDownOutlineRegular` / `…Medium`）。`packages/client/ui-primitives/src/icons/index.tsx` 的 `export const Icon*` 由 **75 增至 186**，包公共入口的 `export` 行由 62 增至 86，并新增 `icons/shared-artwork.tsx`。老名字在新包里**零定义**。消费仓对旧名的引用会取到 `undefined`，而把 `undefined` 交给 `React.createElement` 是**渲染期崩溃**——且该崩溃发生在 `apply` 的 try/catch **之外**，不会被吞掉。

**价值判断**：这是与设置面**无关的独立回归**——即便 F2/F4 全部修好，只要渲染到使用该图标的界面仍会崩。它同时说明「按名取具名导出」这种用法对宿主改名毫无韧性；可行的加固是按名探测 + 回退（该消费仓的新代码已改为依次探测 `Regular`/`Medium`/旧名，全缺失时自绘字形），把一次硬崩溃降级为一次视觉降级。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.5-rc.2 与 dsh-v0.1.7-rc.1：packages/client/ui-primitives/src/icons/index.tsx 的 export const Icon 计数 75 对 186；packages/client/ui-primitives/src/index.ts 的 export 行 62 对 86；两 tag 下 IconChevronDownOutline14 与 IconChevronDownOutlineRegular 的存在性互补）

### F7 区间为 3304 提交，且「默认是否可用」须同时看 base、web-app 与 presets 三处 patch

区间规模：**3304 个提交**，`7872` 文件变更、`+1,206,215 / −127,437`；`packages/` 下以 `@deepseek-ai/dsh` 起名的包由 **267 增至 307**；`bundle/base/cordis.patch.yml` 条目由 **84 增至 92**；`docs/persistence-changes/` 由 0 个文件变为 155 个。装配模型本身未变（bundle → profile patch → Loader 的方言 `insert`／按 id 覆盖／`group`／`disabled`／`isolate`／`!!js` 逐字未变），但**默认可用性的判定位置**变了：`bundle/web-app` 用大量 `- id: X / disabled: true`（该层 25 处 `disabled: true`）把能力从 host 平面搬到 preset 平面，最终状态由 `bundle/web-app/presets/{standard,minimal,ptc,cordis}.patch.yml` 决定。典型例证：`workflow-ptc` 在 `base` 启用、被 `web-app` 关掉、由 `standard` 与 `cordis` preset 启用、在 `ptc` preset 内又是 `disabled: true`——**四个位置状态各异**。

**价值判断**：这条给出的是**核对方法**而非某个能力结论：只看 `bundle/base` 判断「某能力默认是否可用」在本版本上会系统性误判，必须三处联看。它也解释了为什么「源码里搜得到」与「装起来能用」在本区间经常不一致——本区间大量的能力搬运都发生在 patch 层，而不在实现层。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.5-rc.2 与 dsh-v0.1.7-rc.1：git rev-list --count 为 3304；git diff --shortstat 为 7872 files changed, 1206215 insertions, 127437 deletions；packages/**/package.json 的 @deepseek-ai/dsh* 计数 267 与 307；packages/bundle/base/cordis.patch.yml 的 84 与 92；packages/bundle/web-app/cordis.patch.yml 与 presets 四件的 workflow-ptc 状态）

### F8 隐私与行为默认值同批翻转：会话日志上传默认开启、子代理深度降为 1、内联预算改按 token

被翻转的默认值不止一处，其中一项性质特殊。`session-log-deepseek.enabled` 由 `false` 改为 **`true`**——即**默认把完整会话日志（消息正文、工具入参与结果、工作区路径、反馈）上传到 DeepSeek 端点**。同批还有：`subagent.maxDepth` 实际生效默认由 3 降为 **1**（源码为 `.default(1).volatile()`，`0` 完全禁止）；`subagent.maxActiveSubagents` 新键默认 8；`tool-jobs.maxConsecutiveWakes` 由 3 改为**无上限**；`ui-settings.enabled` 由 `false` 改 `true`（新装即暴露 developer tools）；`tool-ralph` 默认 `disabled: true`；`spill-policy` 由 `maxInlineBytes: 50000` 改为 **`maxInlineTokens: 12500`**（键名与单位双变）；`compaction-basic` 摘要预算提高约 8 倍；`ui-chat` 记录视图由 `compact` 改 `standard`；`llm-deepseek` 的 `DEFAULT_MODELS` 由 4 个减为 2 个。

**价值判断**：默认值翻转与 API 破坏是**两类不同的风险**——前者不会让任何插件加载失败，却会改变实际行为与数据去向，因此对「升级后一切正常」的判据没有贡献。其中隐私默认值是**取舍而非技术默认**：是否上传完整会话日志应由 Human 决定，不能由升级动作顺带接受；子代理深度 3→1 则会直接改变既有的委派编排假设，属必须显式配置而非接受的项。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.5-rc.2 与 dsh-v0.1.7-rc.1：packages/session/session-log-deepseek/src/index.ts 的 enabled 默认 false 对 true；packages/subagent/subagent/src/index.ts 的 maxDepth 默认；packages/bundle/base/cordis.patch.yml 的 maxInlineBytes 对 maxInlineTokens；packages/llm 的 DEFAULT_MODELS）

### F9 报告的影响评估描述的是适配前状态，消费面适配已在本地 dev 落地并通过 931 项测试

需要与 F2–F6 的机制描述分开记录一件当前性事实：原报告 §4 所枚举的消费面损坏（`index.js` 对 `installSettingsSection` 的命名导入、`client.js` 的 `inject` 含 `settingsScope` 与 `ctx.settingsScope.bind`、对 `IconChevronDownOutline14` 旧名的引用）描述的是**适配前**的代码。本地 `dev` 上，适配提交 `3c07fda`（2026-09-25 10:14:23）已把上述三处一并处置：移除设置包的命名导入并把设置接入改为随宿主注入的 `ctx.settings`／`configEditor` 路径、`inject` 收窄为 `["slots","locale"]` 并把设置卡改走 `ctx.inject(["configForms"])` 软注入、图标改为按名探测加回退；随后 `9f09596` 把 `peerDependencies` 收窄为 `>=0.1.7-rc.1 <0.2.0`。落档前实跑插件测试套件：**931 项全部通过**（`node --test test/*.test.mjs`）。**两个提交都尚未推送**——`origin/dev` 仍停在 `30cecc1`（2026-09-15），即远端仓上仍是适配前代码。

**价值判断**：不记录这一条，本对象会把「插件当前必然崩溃」当作现行结论传递给后续消费者，而事实是适配已落地且已在本机 0.1.7-rc.1 宿主上实际运行。它同时给出一组可复用的**证据分级示范**：原报告的这些结论自述为「推断，待运行时复现」，随后被一次真实适配与一次全量测试替代；因此消费本对象时应把 F2–F6 当作**机制说明**（上游确实移除了什么、为什么旧写法会坏），把 F9 当作**当前状态**（消费仓已经改成什么、验证到什么程度）。

溯源：https://github.com/dingminhua/dsh-ldvh（dev 分支 3c07fda 与 9f09596；plugin/lib/index.js 与 plugin/lib/client.js 的适配后代码；plugin/package.json 的 peerDependencies 与 devDependencies；origin/dev 停在 30cecc1；插件测试套件 931 项通过）

## 未证实与缺口

未证实：

- **影子遮蔽是源码推断，未做回退复现**：`resolveGenerationInDirectory` 按版本号最大者选取两版逐字相同，据此推出「新版只要写打开过一次，旧版就再也打不开」；但本次没有构造真实 v3 会话并在旧版上验证拒开行为，因此该结论的强度是「由源码必然推出」而非「实测观察到」。
- **加载失败形态未在旧代码上复现**：本对象以「适配后代码在该宿主上正常运行」作为间接对照，并没有让适配前的代码在 0.1.7-rc.1 上真实启动去观察那条 `does not provide an export named …` 报错，故失败形态仍属静态推断。
- **`settings.yaml` 导入映射未逐项核对**：只确认了 `ui-developer-tools`→`ui-settings` 等个别 section→entry 映射与「导入后改名 `settings.yaml.imported`」的机制，完整映射表与冲突处置未逐项比对。
- **`agent/created` 的 serial 语义未逐行核对**：运行时事件目录给出了 `mode: "serial"` 与含 `signal?` 的签名，但该模式与 `scoped-events.generated.ts` 生成物的交互、以及「抛错回滚创建事务」的边界条件未逐行读码确认。
- **运行时枚举为单次内省**：88 个服务、77 个事件（55/17/3/2）与 92 个 Slot（single 39／list 32／keyed 18／chain 2，另 1 个 factory）都是当次装配的观察值，未与仓库生成物逐项对账，因此「运行时有几个」与「仓库声明了几个」的一致性未证。
- **本机环境与报告所载已漂移**：观测到的宿主是 `DSH Desktop.app`（2.0.14，捆绑 0.1.7-rc.1），profile 只有 `desktop` 与 `web`，`dsh-ldvh` 装在 `desktop` profile，不存在报告所载的 `DSH NEXT.app` 与 `test` profile。报告中的环境基线在其观测时点可能为真，但**按报告逐步复现的路径在当前环境下不成立**。

缺口：

- 未在 0.1.7-rc.1 上复现原报告推断的失败形态（medium；阻塞范围：「原报告 P0-1/P0-2 的失败形态已获实测复现」一类断言。该断言不被本对象主张，F2–F6 只作机制说明；若后续需要该复现，须在隔离环境下对适配前代码做一次受控启动）。
- 0.1.7-rc.1 → 0.1.7-rc.2 的 346 提交 / 3429 文件未纳入（medium；阻塞范围：「以 rc.2 为对齐目标」的结论——本对象只对 rc.1 成立，rc.2 在 plugin-manager 与 settings 面另有变更需另核）。
- 第三方插件（`dsh-better-sidebar` 等）对新宿主的兼容性未验证（low；阻塞范围：「本机插件族整体可用」类结论——`ctx.inject(["betterSidebar"])` 指向的是社区插件，其命名空间在两版 DSH 仓中都不存在，DSH 升级不直接涉及它）。
- 桌面壳自身变更未获官方发布说明对照（low；阻塞范围：壳层行为变化结论——`DSH Desktop.app` 2.0.14 的壳层改动只有本机安装产物观察，无上游文本佐证）。

## 建议

**A1（判断：建议建 WorkCase——推送与发布适配）**：把已落地的消费面适配提交（`3c07fda`、`9f09596`）推送到 `origin/dev` 并完成发布收尾，因为它是当前唯一阻止远端仓停留在「与 1.0 宿主不兼容」状态的项。目标对象类型：WorkCase（承接推送、版本声明与 CHANGELOG 收尾）。预期目标：远端 `origin/dev` 上的 dsh-ldvh 与 0.1.7-rc.1 契约一致，且 `peerDependencies` 不再声明已被替换的 API 面。验收条件：`origin/dev` 含两个适配提交；推送后从远端重取的工作树通过 `npm test` 全绿；`plugin/package.json` 的 peer 范围为 `>=0.1.7-rc.1 <0.2.0`。判断依据：F3/F9 与「输入与边界」的推送状态核对。

**A2（判断：建议建 WorkCase——升级前不可逆保护）**：在进行任何宿主升级动作前，对会话根做一次整目录备份并记录备份位置与时间。目标对象类型：WorkCase（一次性保护动作，含备份与校验步骤）。预期目标：v4 单向门下存在可回退的会话根副本。验收条件：备份目录存在且与源目录的文件数与总字节一致（有核对输出）；备份路径登记在案。判断依据：F1 的影子遮蔽与方向性判定。监测条件：每次宿主跨版本升级前重跑；备份策略本身若改为自动，则改由 ADR 固定。

**A3（判断：提请 Human 决定——隐私默认值与行为默认值）**：`session-log-deepseek.enabled` 默认由 `false` 翻为 `true`，属数据去向的取舍；`subagent.maxDepth` 默认由 3 降为 1，属会改变既有委派编排假设的行为变更。二者都不因升级而必须接受，也都不是技术默认可以替代的决定。目标对象类型：Human Gate 提请；决定落定后由 ADR 承载（规则性取舍）或直接进入 profile patch 配置（一次性配置）。预期目标：对「完整会话日志是否随请求上传」有明确且显式的决定；对子代理深度上限有明确取值。验收条件：profile 配置中该两项均为显式值而非依赖默认；决定内容与作用范围有记录。判断依据：F8。监测条件：上游再次翻转隐私相关默认值时重提。

**A4（判断：建议建 WorkCase 或 Research 更新——核对 rc.2 与第三方插件面）**：本对象只对 `0.1.7-rc.1` 成立，而 npm `next` 已是 `0.1.7-rc.2`（较 rc.1 另有 346 提交 / 3429 文件）。目标对象类型：若仅做差量核对，建 WorkCase；若结论涉及新的契约变化，新建 Research 并以 `updates` 回指本对象。预期目标：确认 rc.2 在 plugin-manager 与 settings 面是否改变了本对象的结论。验收条件：rc.1→rc.2 的 diff 已覆盖 `packages/plugin-manager` 与 settings 相关包；本对象 F2/F3/F4 的结论在 rc.2 上逐条复核并记录差异。判断依据：F7 的规模数据与「输入与边界」的未覆盖声明。监测条件：宿主实际升级到 rc.2 时立即执行。

**A5（判断：无需对象化——核对方法的复用）**：F3 的「peer 版本范围不能替代 API 兼容性判断」与 F7 的「默认可用性须三处 patch 联看」，可直接作为后续任何 DSH 升级的核对清单，不需另建对象承载。目标对象类型：无需创建（写作纪律，由本对象 F3/F7 与 implications 承载）。预期目标：后续升级核对时不再以版本范围覆盖或单一 patch 文件作为通过判据。验收条件：后续任一次升级核对记录中，符号面核对与三处 patch 核对均有实际执行痕迹。判断依据：F3/F7。

## 后续分流

- A1 → **WorkCase**（推送与发布适配）。创建信号：准备让远端仓反映适配结果时。继续无需对象化的条件：若本次推送在当次会话内直接完成且无需独立复核，可按直接行动处置并仅在 `change_log` 登记。
- A2 → **WorkCase**（升级前整目录备份）。创建信号：出现跨版本宿主升级的实际计划时。可继续不创建的条件：升级动作本身尚未排期；一旦排期，备份必须先于升级执行。
- A3 → **Human Gate**。提请信号：现在即可提请（默认值已在宿主侧生效）。落定后按取舍性质分流：规则性取舍转 **ADR**（`22`），一次性配置直接落 profile patch。不创建的边界：在 Human 给出作用范围清楚的回应前，该事项保持暂停，不得以「默认已是该值」视为已决定。
- A4 → **Research（新建，以 `updates` 回指本对象）或 WorkCase**。新建 Research 的信号：rc.2 的差量改变了本对象 F2/F3/F4 中任一条的结论。只需一次性核对的信号：rc.2 未触及 settings 与 plugin-manager 面。可继续不创建的条件：宿主未升级到 rc.2 且无排期。
- A5 → **无需对象化**（写作纪律）。若后续多次升级反复出现同类误判，再考虑升级为 Norm 或 Pitfall；在此之前不新建对象。
- **本对象与 `research-4ee122a9`（`0.1.5-rc.1→0.1.5-rc.2`）的关系**：本对象以 `updates` 回指；旧对象在其问题范围内仍为当前依据，其登记的监测条件（「0.1.5-rc.3 或 0.1.6+ 发布、npm latest 标签移动、桌面壳再次跃迁时须刷新本对象或新建」）由本对象闭合；不处置旧对象状态。
- **本对象与 `spark-76ee7b7b`（上游 DSH 能力变化的吸收）的关系**：本对象以 `informs` 回指该长期跟踪议题——本对象的三态证据与边界结论应影响该 Spark 的存续判断；该 Spark 保持 open，其 `scope_boundary`（「当前已知版本差异已吸收或明确不采用、且后续版本变化有跟踪机制时停止」）不因本对象而满足——0.1.7-rc.2 与本机插件族的兼容面仍未覆盖。
- **与 `docs/` 两份备忘的关系**：`dsh-0.1.2-upgrade-survey.md` 保持其自述的「开发设计输入」性质，其内容由 `spark-76ee7b7b` 跟踪，不在本对象内重建；`dsh-0.1.5-rc2-to-0.1.6-research.md` 的区间被本对象覆盖，可继续作为 `docs/` 下的过程备忘保留，不另建对象。
- **监测条件**：宿主实际升级到 `0.1.7-rc.2` 或更高、会话格式再次升版、`dsh-ldvh` 的 `origin/dev` 推送状态变化、或 `settingsScope`／`settings.plugin.item` 一族出现回归时，须刷新本对象或新建。
