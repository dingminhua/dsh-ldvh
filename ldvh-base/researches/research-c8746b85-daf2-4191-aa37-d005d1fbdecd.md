---
title: DSH rc.1→rc.2 变更调研（契约只增不改）
status: active
research_question: DSH 从 0.1.7-rc.1 到 0.1.7-rc.2 有哪些影响 dsh-ldvh 宿主插件对接与 LDVH 消费面的实质变更？
research_purpose: 为 dsh-ldvh 提供从 0.1.7-rc.1 到 0.1.7-rc.2 的升级决策依据：本机宿主已实际跃迁到 0.1.7-rc.2（DSH NEXT.app 2.0.15-next，153 个 dsh 包全为该版本），需要定出该差量中哪些是必须适配的破坏面、哪些是可利用的新能力面、哪些是只能由 Human 裁夺的取舍，并回应该版本是否构成又一个「单向门」风险。
stopping_reason: sufficient
confirmed_statements:
  - F1 宿主公开契约面近乎只增不改：服务 88→89、事件 77→81、客户端槽位 86→89、模型可见 Tool 零删除
  - F2 会话持久化格式未再升级，持久化根零增删，回退不再是单向门
  - F3 唯一实际击中 dsh-ldvh 的接缝是 atomic-write 锁接管，且带跨 PID namespace 边界
  - F4 账号服务四个方法签名破坏性变更无兼容层，LDVH 未消费故不击中
  - F5 DeepSeek LLM 适配器拆包改名：包仍存在但被移出默认组合
  - F6 官方决策记录与 rc.2 实际装配相反，判定默认可用性须读 patch
  - F7 官方发布说明是权威全量清单，且该仓根目录没有 CHANGELOG
  - F8 生成式目录是宿主公开面的机械化权威证据源，门禁确在 CI 主路径
  - F9 权限预设 Auto 由 danger-full-access 加 never 改为加 ask
  - F10 翻译配对改按标题分节键，大量 i18n 改动属格式切换而非决策变化
  - F11 LDVH 的 peer 范围本就覆盖 rc.2，本机宿主全部 dsh 包已是 rc.2
uncertain:
  - issue: apps/web 与 apps/desktop 的 CSP 与启动握手是否影响第三方插件的挂载时序未定
    reason: 两目录共 144 与 96 个文件未全量审阅，只确认了 base 为 './' 未变且无 CSP 文件的结构性修改；对 LDVH 而言其注入面为 host 与 client 的 service/slot，不涉及 asset 路径，故不改变本对象结论，但完整覆盖未达成
  - issue: dsh-client-ui-primitives 的导出在运行时的可用性未在浏览器侧求值
    reason: 只比对了 src/index.ts 的导出名集合（155 对 165，删除 OnboardingSurface 一项，新增 11 项），未在运行中的浏览器侧实际求值；LDVH 实际使用的四个符号在两版均存在，故不改变结论
  - issue: docs/config-catalog.md 其余约 130 个插件的 Config 字段未逐字比对
    reason: 只对 6 处声明变化做了逐字对照，其余依据集合级比对（inject 变更 0、条目净增 4 删 1）覆盖主要面；残余风险为个别插件新增可选字段未被列出
  - issue: 上一份同类调研所载环境基线与本机实际已漂移
    reason: docs/dsh-0.1.5-rc2-to-0.1.7-rc1-research.md 记载的 DSH Desktop.app 2.0.14 / 0.1.7-rc.1 / desktop+web profile 在本机已不存在，现为 DSH NEXT.app 2.0.15-next / 0.1.7-rc.2；按该报告逐步复现的路径在当前环境下不成立
gaps:
  - blocked_scope: 「dsh-ldvh 已验证支持 0.1.7-rc.2」类声明——该声明不在本对象 research_purpose 覆盖范围内（本对象只回答变更事实与影响面评估），故不阻塞 sufficient 收敛；它是本对象建议段第 2 条的输入
    description: 真实 UI 验收四项未核对（设置卡片、LDVH 会话视图、停用与重启、卸载清理）
    priority: medium
  - blocked_scope: 「第三方插件在 rc.2 的失败形态已获实测」类断言——F4 与 F5 的破坏性目前是由源码必然推出，而非实测观察到
    description: 未在 rc.2 上对依赖旧包名或旧账户签名的第三方插件做受控启动复现
    priority: medium
  - blocked_scope: 「本机插件族在 rc.2 整体可用」类结论——本对象只主张 dsh-ldvh 自身
    description: 本机 desktop profile 的 12 个第三方依赖未逐一核对 rc.2 兼容性
    priority: medium
  - blocked_scope: 壳层行为变化结论——只有本机安装产物的观察，无官方说明佐证
    description: 桌面壳从 2.0.14-next 到 2.0.15-next 的变更无上游文本对照
    priority: low
  - blocked_scope: 面向用户的文档变更细节——不影响契约面与消费面结论
    description: docs/user/ 与部分顶层文档未逐篇审阅
    priority: low
implications:
  - finding_ref: F1 宿主公开契约面近乎只增不改：服务 88→89、事件 77→81、客户端槽位 86→89、模型可见 Tool 零删除
    implication: 本区间不需要任何契约适配，且最易漏过的「服务删除/事件改 mode」两类破坏面在场为零，排查精力应从「找静默失效」转向「找组合面破坏」。
  - finding_ref: F2 会话持久化格式未再升级，持久化根零增删，回退不再是单向门
    implication: 上一区间最重的数据面风险（v3→v4 回退单向门）本轮不重演：无需备份、无需迁移，LDVH 作为会话消费者的数据面暴露为零，这条风险线可以关闭。
  - finding_ref: F3 唯一实际击中 dsh-ldvh 的接缝是 atomic-write 锁接管，且带跨 PID namespace 边界
    implication: 该变更不应记成适配待办而应记成部署约束——登记载体所在的 DSH 用户配置根不得置于跨 PID namespace 的共享卷或网络文件系统（勘误：原记作事实源目录；该锁只作用于登记载体，事实源不经该包），此条件须在部署形态改变时可被复查。
  - finding_ref: F4 账号服务四个方法签名破坏性变更无兼容层，LDVH 未消费故不击中
    implication: 破坏面的判定必须落到消费清单上：本区间 4 处签名破坏加 1 处拆包，加上「是否被消费」的比对后实际冲击仅为 1，只列签名变更会得出失真的高危结论。
  - finding_ref: F5 DeepSeek LLM 适配器拆包改名：包仍存在但被移出默认组合
    implication: 「包存在」与「包被装载」是两件事，判定时必须读 patch 而非目录清单；据此需对本机 profile 的 12 个第三方依赖做一次包名引用清查。
  - finding_ref: F6 官方决策记录与 rc.2 实际装配相反，判定默认可用性须读 patch
    implication: 决策记录只保证「应与交付同步」的纪律、不保证已做到，故判定默认可用性时 patch 行状态才是机械真相；这条口径应固化为后续同类调研的固定方法。
  - finding_ref: F7 官方发布说明是权威全量清单，且该仓根目录没有 CHANGELOG
    implication: 同类调研的最优路径顺序应改为「先取 Release 说明建立全量骨架，再用源码差分做契约级精确化」，本轮先搜源码等于用较高成本重建了一份已有清单。
  - finding_ref: F8 生成式目录是宿主公开面的机械化权威证据源，门禁确在 CI 主路径
    implication: 对七张生成式目录做集合与签名比对可在十几分钟内得到六维确定性结论，是高杠杆方法；同时附带纪律——不能以「workflow 文件里搜不到门禁名」推断门禁不存在。
  - finding_ref: F9 权限预设 Auto 由 danger-full-access 加 never 改为加 ask
    implication: 该翻转改善 Human Gate 语境（越权动作回到用户审批），不需要 LDVH 改代码但影响对「当前默认是否安全」的判断：升级前若见动作不提示即执行，那是旧默认值的表现而非 LDVH 守卫失效。
  - finding_ref: F10 翻译配对改按标题分节键，大量 i18n 改动属格式切换而非决策变化
    implication: 统计文档改动量时必须把 .i18n.yaml 与 .md 分开计数，否则 681 这类数字会被误读为决策记录被大幅改写，系统性高估变更规模。
  - finding_ref: F11 LDVH 的 peer 范围本就覆盖 rc.2，本机宿主全部 dsh 包已是 rc.2
    implication: 零适配结论不是由 peer 范围推出（该口径只约束版本解析、不约束符号存在性），而是由逐符号比对独立得出；本机已运行 rc.2 只是旁证，不等于已验证支持。
urls:
  - ref: https://github.com/deepseek-ai/deepseek-harness
    summary: 全部内核侧发现的对照源：两 tag（dsh-v0.1.7-rc.1 = 46a7f68b09、dsh-v0.1.7-rc.2 = 477b4f4205）的只读差分，覆盖七张生成式目录、bundle patch、持久化目录与 .agents/notes 决策记录。限制：仓库根无 CHANGELOG，变更语义须由 Release 说明与决策记录反推；静态差分只证明「发布内容」，不证明运行时装了什么；决策记录可能与实际装配不一致（见 F6）
    title: deepseek-harness（DSH 内核源码仓）
  - ref: https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2
    summary: "本区间产品面变更的权威全量清单：中英各四节（新增/修复/调整/优化），prerelease: true、draft: false、published_at 2026-09-24T14:10:21Z。限制：面向用户措辞，不含 API 契约细节（不给方法签名级破坏面），须与源码交叉使用"
    title: DSH v0.1.7-rc.2 官方发布说明
  - ref: https://registry.npmjs.org/@deepseek-ai/dsh
    summary: 版本通道与发布时间：dist-tags 为 latest 0.1.5-rc.3、alpha 0.1.7-alpha.2、next 0.1.7-rc.2；0.1.7-rc.2 发布时间 2026-09-24T14:18:11.337Z，支撑「rc.2 是 next 通道当前版本」的判断。限制：只给版本与标签，不给变更内容
    title: "@deepseek-ai/dsh（npm registry 元数据）"
  - ref: https://github.com/dingminhua/dsh-ldvh
    summary: 消费面核对的发生地：plugin/package.json 的 peerDependencies 与 devDependencies、lib/host-seams.js 的宿主缝消费清单、lib/event-stream.js 的事件清单、lib/governed-projects.js 的 atomic-write 用法。限制：本地工作树含未纳入版本控制的调研报告与另一份提案文档，远端仓只承载已推送内容
    title: dsh-ldvh（受辖项目仓）
object_uid: c8746b85-daf2-4191-aa37-d005d1fbdecd
fact_type_key: research
created_at: 2026-09-26T00:55:12.808Z
change_log:
  - at: 2026-09-26T00:55:12.808Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Research 对象：DSH 0.1.7-rc.1→0.1.7-rc.2 全量变更调研（11 项关键发现、4 项未证实、5 项缺口、6 条建议），结论为本区间不需要 dsh-ldvh 做契约适配，唯一实际击中点为 atomic-write 锁接管且属条件性部署约束
  - at: 2026-09-26T04:47:36.629Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 勘误 F3、F11 与建议 3：(a) atomic-write 的 PID 锁只作用于管辖登记载体（$DSH_HOME/ldvh/governed-projects.yaml），事实源 ldvh-base/ 不经该包（8 个 fact writer 各自无锁原子替换），原表述把约束误挂到事实源目录；(b) 153 是宿主 package.json 的声明依赖数，node_modules 下实测 275 个 dsh* 包全为 rc.2
---

## 研究问题

DSH 从 0.1.7-rc.1 到 0.1.7-rc.2 有哪些影响 dsh-ldvh 宿主插件对接与 LDVH 消费面的实质变更？

本题以外部对象（DSH 内核的一次版本迭代）为主体，不含 Human 原话与执行目标。研究对象锁定两 tag 之间的差量：tag `dsh-v0.1.7-rc.1`（`46a7f68b09`，2026-09-23）→ `dsh-v0.1.7-rc.2`（`477b4f4205`，2026-09-24），共 346 提交（224 非 merge）、3429 文件 `+136,313 / −24,518`。范围口径为**全量**（Human 裁定 2026-09-26），但「影响 LDVH 消费面」的判定以 dsh-ldvh 实际的消费清单为比对基准，不以「是否技术动作」为准。

## 输入与边界

**输入**：同级仓 `/Users/dmh2002/DshProject/deepseek-harness` 的双 tag 只读差分；该仓的官方生成式目录（服务/事件/类型/槽位/工具/配置/持久化七张表，均带 CI 新鲜度门禁）；官方 GitHub Release 发布说明；npm registry 元数据；dsh-ldvh 自身消费面代码（`plugin/`）。

**边界**：本对象回答「有哪些变更、哪些击中 LDVH」，不产出「应当选哪条升级路径」的方案结论（归讨论系统），也不宣布「dsh-ldvh 已验证支持 0.1.7-rc.2」（该声明须以真实 UI 验收全项为前提，见 gaps）。不覆盖 rc.2 之后的版本，不覆盖第三方插件各自的兼容性。

**方法**：对七张生成式目录做集合/签名/哈希级**机械化比对**（而非逐文件语义阅读）；官方发布说明作为全量分线的对照基准；对子代理取证结论逐条复核，包括对三处误判的裁决纠正。

## 关键发现

### F1 宿主公开契约面近乎只增不改：服务 88→89、事件 77→81、客户端槽位 86→89、模型可见 Tool 零删除

对七张生成式目录做集合级比对：服务 88 → 89（唯一新增 `schedule`，**零删除**）；事件 77 → 81（新增 4 项全为 `emit`，**零删除且既有事件 mode 零变化**）；客户端槽位 86 → 89（新增 3 项，**零删除、零 kind/scope 变更**）；模型可见 Tool 30 个工具包零增删，工具名净变化仅 `+schedule_update`；workspace 包 307 → 312（**零删除**）。

**价值判断**：这一结果直接否证了「每个小版本都带静默失效」的预期——上一区间（0.1.5-rc.2→0.1.7-rc.1）曾删除 `agent/session-start` 并把 `agent/created` 由 `emit` 改 `serial`，那类破坏形态在本区间**没有发生**。对 LDVH 的含义是：本区间不需要任何契约适配，且「服务删除/事件改 mode」这类最易漏过的破坏面在场上是**零**，可以把排查精力从「找静默失效」转向「找组合面破坏」（后者才是本区间真正的战场，见 F5）。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.7-rc.1 的 46a7f68b09 与 dsh-v0.1.7-rc.2 的 477b4f4205：packages/extensions/tool-cordis/src/api-catalog.ts 的 SERVICE_API 88 对 89 与 EVENT_API 77 对 81；packages/extensions/cordis-client-runner/src/client/slot-catalog.ts 槽位 86 对 89；docs/tool-catalog.md 的 Tool Package Map 30 对 30；git ls-tree 的 packages|apps/*/*/package.json 307 对 312）

### F2 会话持久化格式未再升级，持久化根零增删，回退不再是单向门

`SESSION_FORMAT_VERSION` 在 rc.1 与 rc.2 同为 `4`（`packages/core/session/src/types.ts` L89），格式迁移链止于 `sessionFormatV3ToV4`，**不存在 v4→v5**。持久化根表 62 → 62，可达持久化类型定义 577 → 577；全部变化限于 schedule 域：4 对改名（`ScheduleRecord`→`LegacyScheduleRecord` 等）与 3 处哈希变化。对应持久化变更记录标记 `decision: same-version`，兼容性说明为「旧日志无 title 成员仍可解码而非被拒」。

**价值判断**：上一区间的 v3→v4 曾是**单向门**（新版写过一次，旧版再也打不开），是该轮调研最重的风险项。本区间**不构成同类风险**：无需备份动作、无需迁移、不存在「回退后旧版读不回」的问题。对 LDVH 的含义是——它作为会话消费者的数据面暴露为零，这条最贵的风险线本轮可以关闭。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.7-rc.1 与 dsh-v0.1.7-rc.2：packages/core/session/src/types.ts 的 SESSION_FORMAT_VERSION 两版均 L89；docs/persistence-catalog.md 的 Persistence type fingerprints 表 62 行与 Resolved persistence types 段 577 个类型定义、唯一哈希变化根 event:schedule/change 由 2a7f86849ae54b3398ee49661a757c4fcb59a6192b7036ee2ff514617e13fb42 变为 a0a2e5c42e1c929445ecd1cd70f49be6b66441894ec72c08e8ae332821d4a3cb；docs/persistence-changes/2026-09-18-schedule-optional-title.md 的声明段与兼容性段）

### F3 唯一实际击中 dsh-ldvh 的接缝是 atomic-write 锁接管，且带跨 PID namespace 边界

`packages/util/atomic-write/src/index.ts` 新增锁接管语义：锁文件记录 `<pid>`，用信号探针判定持有者进程确实不存在（ESRCH）则接管该锁。逐字注释为「whose recorded holder process no longer exists is taken over.」（L10），同时给出明确边界：「other PID namespaces sharing the file are unsupported and could both hold」（L228）。而 dsh-ldvh 的消费侧代码 `plugin/lib/governed-projects.js` L7 直接 `import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write"`。

**约束对象（勘误，2026-09-26）**：该包的锁**只作用于管辖登记载体**——`governed-projects.js` 中 4 处 `withFileLock` / `writeFileAtomic` 的目标全部是 `registrationPath(dshHomePath)`，即 `$DSH_HOME/ldvh/governed-projects.yaml`。事实源 `ldvh-base/` **不经该包**：8 个 fact writer（workcase / norm / spark / adr / pitfall / research / friction / goal）各自带本地「`writeFile` + 回读校验 + `rename`」的**无锁**原子替换，`initializeFactSource` 亦只用普通 `mkdir`。故受该边界约束的是**登记载体所在的 DSH 用户配置根**，不是项目内的事实源目录。原表述把约束记在事实源目录上，属对象误挂。

**价值判断**：这是本区间**唯一**真实击中 LDVH 的宿主接缝。方向上它是改善（此前崩溃遗留锁需人工清理，现在自动接管，对应官方修复条目「应用异常退出或安装中断后，后续插件安装和配置保存持续失败」）。但它附带一个**条件性风险**：PID 探针在竞争者主机上比较，若**登记载体所在的 DSH 用户配置根**位于网络文件系统或跨 PID namespace 的共享卷，可能误判存活持有者为已退出并造成双重持有。LDVH 当前为单机单 PID namespace 部署，不触发该边界——**因此这条风险的性质不是「要不要适配」，而是「未来部署形态改变时须重评」**，它不适合记成待办，适合记成部署约束。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.7-rc.2 的 477b4f4205：packages/util/atomic-write/src/index.ts L10 与 L228，同包 L111-181 的 takeOverExitedLock 实现，.agents/notes/implemented/bug-fix/2026-09-24-exited-holder-lock-takeover.md；受辖仓消费侧见 /Users/dmh2002/DshProject/dsh-ldvh 的 plugin/lib/governed-projects.js L7 及该文件 4 处 withFileLock 调用点与 8 个 fact writer 的本地 atomicWriteFile）

### F4 账号服务四个方法签名破坏性变更无兼容层，LDVH 未消费故不击中

`ctx.deepseekAccount` 的四个方法首参由无参改为必填 `client: AccountClientMetadata`（`getProfile`/`getBalance`/`signOut`），`startSignIn` 的首参由 `locale` 改为 `client`（语言信息改由 `client.locale` 承载）。`AccountClientMetadata`（`{version, locale, timezoneOffsetSeconds}`）是**基线不存在的新增必填类型**，仓库内调用点已全部改写，**无重载或可选兼容层**。同时新增 `getUnnotifiedBonuses`/`ackBonusNotified`/`rejectToken`。

**价值判断**：这是本区间**破坏性最强**的一处，但它对 LDVH 的冲击为零——dsh-ldvh 的消费清单中不含 `deepseekAccount`。真正的含义在于**证据分级的方法论**：本区间共有 4 处签名级破坏加 1 处拆包，若只做「改了哪些签名」的清单会得出「高危」结论，而**加上「是否被消费」的比对后实际冲击为 1**。这印证了 specs/08 §6 的口径——宿主缝存在不等于 LDVH 受其保护；反过来，宿主缝破坏也不等于 LDVH 受损，两个方向都必须落到消费清单上才成立。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.7-rc.1 与 dsh-v0.1.7-rc.2：packages/extensions/tool-cordis/src/api-catalog.ts 的 SERVICE_API 中 deepseekAccount 条目方法签名前后对照；packages/credentials/deepseek-account/src/types.ts 的 AccountClientMetadata 类型声明；packages/credentials/deepseek-account/src/account-tasks.ts 的 signed-out 取消逻辑；docs/subsystems/credentials.md 的 deepseek-account/* 事件章节）

### F5 DeepSeek LLM 适配器拆包改名：包仍存在但被移出默认组合

`packages/bundle/base/cordis.patch.yml` 把 `- name: '@deepseek-ai/dsh-llm-deepseek'` 改为 `'@deepseek-ai/dsh-llm-deepseek-api-key'`，并新增 `id: llm-deepseek-account`；`packages/bundle/sdk-minimal/cordis.patch.yml` 同步改名；两个 bundle 的 `package.json` 依赖同步替换。但 `packages/llm/llm-deepseek` **这个包本身在 rc.2 仍然存在**（版本 `0.1.7-rc.2`），只是不再被默认组合引用。

**价值判断**：这是本区间对第三方组合面最实际的破坏点，也是**最容易被误判的一处**——只看 `ls packages/` 会得出「包还在，没事」，只看 patch 会得出「包被删了」。准确表述是「包存在但被移出默认组合」，因此任何在 profile patch 或用例里**按该包名引用**它的部署/插件在 rc.2 上要么装载失败，要么装载了一个不再被 base 支持的包。对 LDVH 本身不击中（其 peer/dep 清单中无该包），但**对本机 profile 里 12 个第三方依赖构成真实的待查面**。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.7-rc.1 与 dsh-v0.1.7-rc.2：packages/bundle/base/cordis.patch.yml L522-527 与 packages/bundle/sdk-minimal/cordis.patch.yml L27 的 name 行改名前后；两 bundle 的 package.json dependencies 对照；packages/llm/llm-deepseek/package.json 在 rc.2 仍为 0.1.7-rc.2）

### F6 官方决策记录与 rc.2 实际装配相反，判定默认可用性须读 patch

`.agents/notes/implemented/architecture/2026-09-24-web-default-schedule-composition.md` 在 rc.2 标签上仍写着「and leaves `ui-schedule` enabled」。但 rc.2 的 `packages/bundle/web-app/cordis.patch.yml` 中 `time-context`、`schedule`、`ui-schedule` 三行**均为 `disabled: true`**，`packages/bundle/web-app/README.md` 亦逐字写明「The shipped composition disables `schedule`, `ui-schedule`, and `time-context` by default.」。落地时序经核验：`e896737840`（09-24 16:11 启用）→ `cad6fef2fd`（09-24 20:27 **禁用**，推翻前一提交）→ `787b746b80`（21:24 release rc.2），且 `git merge-base --is-ancestor cad6fef2fd dsh-v0.1.7-rc.2` 通过。

**价值判断**：这是本轮最有普适价值的发现。`.agents/notes/implemented/` 的纪律要求记录与实际交付同步，但**纪律不等于已做到**——同一份记录被同日更晚的提交推翻而未同步更新，而记录与代码两侧都「看起来权威」。对 LDVH 的长期含义是：**判定宿主默认可用性时，决策记录只能当线索，bundle patch 行状态才是机械真相**；这条口径应进入后续同类调研的固定方法，而不是每次重新踩。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.7-rc.2 的 477b4f4205：packages/bundle/web-app/cordis.patch.yml 的 time-context/schedule/ui-schedule 三行均带 disabled: true；packages/bundle/web-app/README.md 与 README.zh.md 的 default-disabled 段；.agents/notes/implemented/architecture/2026-09-24-web-default-schedule-composition.md 的 Decision 段；提交 cad6fef2fd 与 release 提交 787b746b80 的时序）

### F7 官方发布说明是权威全量清单，且该仓根目录没有 CHANGELOG

Release `dsh-v0.1.7-rc.2` 存在且内容完整：`prerelease: true`、`draft: false`、`published_at: 2026-09-24T14:10:21Z`，正文含中文「✨ 新增 / 🐛 修复 / ⚠️ 调整 / 🎨 优化」四节与对应英文四节。而该仓根目录**没有** `CHANGELOG`（本地只读核对），版本语义由 Release 说明、`docs/persistence-changes/`（带 schema 的日期化记录）与 `.agents/notes/`（决策记录）三处承载。

**价值判断**：这改变了同类调研的最优路径顺序。本轮开始时先做源码差分、后才发现官方说明存在，等于用较高成本重建了一份已有的清单。对 LDVH 的含义是方法论层面的：**下一轮同类调研应先取 Release 说明建立全量骨架，再用源码差分做契约级精确化与破坏面判定**——两者不是替代关系，官方说明给全量但不给 API 契约细节（例如它不会告诉你 `getProfile` 多了一个必填参数），源码差分给契约但不给产品意图的完整性。

溯源：https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2（Release v0.1.7-rc.2 的 prerelease/draft/published_at 元数据与正文四节；同仓根目录的文件清单可核无 CHANGELOG；docs/persistence-changes/ 与 .agents/notes/ 两个承载目录）

### F8 生成式目录是宿主公开面的机械化权威证据源，门禁确在 CI 主路径

该仓内置七张生成式目录，由脚本从源码 AST 或运行时装配产出：`api-catalog.ts`（服务+事件+类型）、客户端 `api-catalog.ts` 与 `slot-catalog.ts`、`docs/tool-catalog.md`、`docs/config-catalog.md`、`docs/persistence-catalog.md`。它们由 `scripts/run-gates.ts` 的 `docSyncLeafGates()` 统一编排的新鲜度门禁强制，而该函数**同时被 `ciPrimaryGates()`（`run-gates.ts:381`）与 `ciStaticGates()`（`:479`）引入**，对应 `package.json` 的 `check:ci` / `check:ci:static`，并由 `.github/workflows/ci.yml` 实际调用。

**价值判断**：这是本轮「机械级证据」分级的成立基础，也是工具选择的真正收获。它带来一个**可复制的高杠杆方法**：对生成式目录做集合/签名/哈希比对，可以在十几分钟内得到服务、事件、槽位、工具、配置、持久化六维的确定性结论，远优于逐文件读 diff。同时它附一条方法纪律：**不能以「workflow 文件里搜不到门禁名」推断门禁不存在**——工作流只调用聚合入口，具体门禁在脚本内展开（本轮一条取证线正因此误判，经复核纠正）。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.7-rc.2 的 477b4f4205：scripts/run-gates.ts 的 docSyncLeafGates 定义与 L321、L381、L479 三处引用；.github/workflows/ci.yml 的 check:ci:static 调用；scripts/gen-cordis-api.ts 与 gen-client-catalog.ts 与 gen-tool-catalog.ts 与 gen-config-catalog.ts 与 gen-persistence-catalog.ts 各文件头的生成与门禁声明）

### F9 权限预设 Auto 由 danger-full-access 加 never 改为加 ask

`docs/subsystems/permission-presets.md` L49 逐字：「This service fixes the `auto` identity and its `danger-full-access` plus `ask` bundle, and a recorded Auto selection also matches the `never` policy that delegated children pin」。即 Auto 的审批策略由 `never` 改为 `ask`，同时保留对已记录 `never` 选择的匹配。

**价值判断**：这条落在 LDVH 的**授权语义**面上而非接缝面上——它改变的是 Human Gate 运行语境。`never` 意味着越权动作被静默放行，`ask` 意味着会回到用户审批；对以 Human 决定权为根方案之一的系统而言，这是一个方向有利的翻转。它不需要 LDVH 做代码适配，但**影响对「当前默认是否安全」的判断**：升级前若曾观察到「某些动作不提示就执行」，那是旧默认值的表现，不是 LDVH 守卫失效。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.7-rc.1 与 dsh-v0.1.7-rc.2：docs/subsystems/permission-presets.md L49 的 bundle 描述由 danger-full-access plus never 改为 plus ask 并新增 never 匹配句；同文件 Current preset 与 registerAuto 段落的前后对照）

### F10 翻译配对改按标题分节键，大量 i18n 改动属格式切换而非决策变化

区间删除 `scripts/translation-pairing-merge.*` 与 `scripts/merge-translation-pairing*`，新增决策记录 `2026-09-23-section-keyed-translation-pairing-records`。根因（逐字）：「A consistency record held the full blob hash of each language file. Any edit to a pair changed both lines, so two branches that edited different parts of the same pair always conflicted on the record, even when Git merged both Markdown files cleanly.」。键由整文件 blob hash 改为每章节英文标题 slug 路径。`.agents/notes` 的 681 个改动文件中，566 个是 `.i18n.yaml`、114 个 `.md`、57 个 `.zh.md`、1 个 json。

**价值判断**：这是一处**会系统性误导改动规模判断**的变更。681 这个数字看起来像「决策记录被大幅改写」，实际上是配对记录格式切换引发的全量重录——若不区分 i18n sidecar 与正文，会严重高估本区间的决策变动量。对 LDVH 的含义是纪律性的：`docs/i18n/README.md` 明确「一个双语对是三个同级文件」且「两种语言具有同等规范效力」，因此**统计文档改动时必须把 `.i18n.yaml` 与 `.md` 分开计数**，否则任何「文档改动量」结论都会失真。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.7-rc.1 与 dsh-v0.1.7-rc.2：.agents/notes/implemented/process/2026-09-23-section-keyed-translation-pairing-records.md 的 Problem 与 Decision 段；docs/i18n/README.md 的 pair-as-three-files 与 equal-authority 两段；git diff --name-only 对 .agents/notes 的扩展名分布统计 566/114/57/1）

### F11 LDVH 的 peer 范围本就覆盖 rc.2，本机宿主全部 dsh 包已是 rc.2

`plugin/package.json` 的 peerDependencies 为 `">=0.1.7-rc.1 <0.2.0"`（`dsh-client-ui-conversation`、`dsh-client-ui-primitives`、`dsh-host-webserver` 三条同形），在语义上**已经覆盖 `0.1.7-rc.2`**，无需为容纳 rc.2 修改范围。同时本机 `/Applications/DSH NEXT.app` 为 `dsh-desktop-next@2.0.15-next`，其 `package.json` 声明 153 个 `@deepseek-ai/dsh*` 依赖，`node_modules/@deepseek-ai` 下实测 275 个 `dsh*` 包版本**全部**为 `0.1.7-rc.2`（原表述将 153 记作 node_modules 内的包数，属计数对象误挂，随本次勘误一并改正）。npm 侧 `dist-tags.next` 指向 `0.1.7-rc.2`，发布时间 `2026-09-24T14:18:11.337Z`。

**价值判断**：这解释了为什么本区间「无需适配」不是运气——LDVH 的 peer 范围采用的是**次版本内开放**口径（`>=0.1.7-rc.1 <0.2.0`），本身就为同线内的 rc 迭代留了空间。但要注意该口径**只约束版本解析，不约束符号存在性**：上一区间的教训正是「peer 范围含该版本」不等于「符号仍在」。因此本轮的零适配结论不是由 peer 范围推出的，而是由 F1 的逐符号比对独立得出的——两者一致才构成结论。本机已运行 rc.2 只是旁证，按 specs/08 §8 不等于「已验证支持」。

溯源：https://registry.npmjs.org/@deepseek-ai/dsh（dist-tags.next 为 0.1.7-rc.2 与 time 字段 2026-09-24T14:18:11.337Z；配合 https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2 的 prerelease 元数据；消费侧 peer 范围与运行时观察见受辖仓 /Users/dmh2002/DshProject/dsh-ldvh 的 plugin/package.json L72-74，以及本机 /Applications/DSH NEXT.app/Contents/Resources/app/package.json 的 version 与 dependencies）

## 未证实与缺口

本对象的三态分布为 confirmed 11 项（F1–F11）、uncertain 4 项、gaps 5 项。**未证实**与**缺口**两项由 frontmatter 的 `uncertain` 与 `gaps` 字段承载（该两处条目短小且无叙述展开需求），此处只声明其对本对象结论的影响：

- `uncertain` 中的四项均**不触及** F1–F11 的判定链条：它们分别是 apps/web 与 apps/desktop 的 CSP/启动握手覆盖不足、ui-primitives 的运行时可用性未求值、config-catalog 其余约 130 个插件的字段未逐字比对、以及上一份同类调研所载基线与本机实际环境已漂移。
- `gaps` 五项中优先级最高者为「真实 UI 验收四项未核对」（medium）。它**不阻塞本对象判定**：按 specs/24 §10.3，缺口优先级取「对 research_purpose 所支撑判断的阻塞程度」，而本对象的 purpose 是变更事实认定与影响面评估，不包含宣布支持成立；该缺口实际阻塞的是「dsh-ldvh 已验证支持 0.1.7-rc.2」这类**不在本对象覆盖范围内**的声明。它同时是本对象「建议」段第 2 条的输入。

## 建议

1. **本区间不需要 dsh-ldvh 做契约适配**：F1 的逐符号比对与 F11 的 peer 范围两条独立证据一致指向该结论，可直接据此不做升级动作。
2. **把「支持基线登记是否推进到 0.1.7-rc.2」提请注意并由 Human 决定**：本仓 `local-dev-workflow` 规范登记的目标环境为 `DSH Desktop 2.0.13 / @deepseek-ai/dsh 0.1.5-rc.2`，该登记是一次 Human 决定（规范原文标注 2026-09-20），与本机实测 `2.0.15-next / 0.1.7-rc.2` 已不一致；而该规范自身要求环境升级后走受控更新。AI 不得自行改写该登记值，故此项须 Human 裁夺。
3. **将 atomic-write 锁接管登记为部署约束而非适配任务**：当前单机部署不触发（F3），但应记录「**登记载体所在的 DSH 用户配置根**不得置于跨 PID namespace 的共享卷或网络文件系统」这一条件，以便部署形态改变时可被复查。（本条的约束对象随 F3 勘误一并改正；原表述记作事实源目录。）
4. **对依赖 `@deepseek-ai/dsh-llm-deepseek` 包名的周边环节做一次清查**：LDVH 自身不依赖该包，但本机 profile 装有 12 个第三方依赖，其中任何按该包名引用者会在 rc.2 下失败（F5）。
5. **可选增强：为 LDVH 的审批面补 `displayReason`**：宿主侧 `PreToolDecision.ask` 与 `ApprovalRequestEvent` 已新增可选的本地化 `displayReason`，LDVH 的写守卫目前只返回字符串拒绝理由；补上后可让审批呈现跟随界面语言。此项为增量改进，不构成适配义务。
6. **把本轮三条方法纪律固化进后续同类调研**：先取官方 Release 说明建立全量骨架（F7）；对生成式目录做机械化比对（F8）；判定默认可用性只读 patch 不读决策记录（F6）。

## 后续分流

本轮调研职责在本对象创建后收口。三态的完整证据结构与本对象正文的引用闭环一致；对 dsh-ldvh 而言，F1、F4、F5、F6、F9 属「变更事实认定」，已足以支撑升级决策；F3 的部署约束与建议第 2 条的支持基线登记事项属**待 Human 裁夺**，不由本对象自行接纳或定夺。本轮未发现需要新开 Spark、WorkCase 或 ADR 的议题——F3 的部署约束是否要写入规范、支持基线是否推进，都属于须由 Human 先行裁定的方向性问题，在该裁定作出前不宜对象化。
