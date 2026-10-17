---
title: DSH 0.2.0-rc.2→0.2.1-rc.1 变更调研（两处契约破坏）
status: active
research_question: DSH 从 0.2.0-rc.2 到 0.2.1-rc.1 有哪些变更，其中哪些影响 dsh-ldvh 的宿主对接与 LDVH 消费面？
research_purpose: 为 dsh-ldvh 提供从 0.2.0-rc.2 到 0.2.1-rc.1 的升级决策依据：宿主已实际跃迁到该版本（本机运行中 DeepSeek Harness.app 内核 0.2.1-rc.1，进程 2026-10-17T15:52:32 启动），且本区间首次出现对 LDVH 的两处真实契约破坏（invariants 服务被整体移除、subagents.start 被 startActivation 取代），需判定适配范围、验证破坏的运行时表现、评估兼容声明与支持基线是否仍需调整。
stopping_reason: sufficient
confirmed_statements:
  - F1 区间规模 1916 commits、8361 files +315,897/−84,270，是上一区间（187 commits / 1022 files）的约十倍
  - F2 契约三表首次出现净删除：服务 91→98（+8/−1）、事件 81→82（+1/−0）、类型 936→1053（+126/−9）
  - F3 被删除的唯一服务 `invariants` 恰是 LDVH 消费的服务；官方迁移指南逐字明示该服务与相关类型不再发布
  - F4 LDVH 经 path 硬依赖 `subagents.start`，该方法在本区间被整体移除并由 `startActivation` 取代，已在 rc.1 宿主上实测抛 TypeError
  - F5 LDVH 消费的其余 9 个在册服务与全部 10 个事件逐条未变：`userQuestions` 与 `tools` 整条全等，10 个事件 mode 与签名逐字全等
  - "F6 持久化格式仍 v4、`roots` 62→65 新增 3 个零删除、6 个 root digest 变化，7 份变更记录全部 `decision: same-version`"
  - F7 客户端槽位 90→100，89 条公共槽位的 `registerOptions` 逐字全等零差异，被删的 `conversation.message.images` 是空契约槽位
  - F8 包集合 325→349（+27/−3），peer 声明零收窄（NARROWED=0），`engines` 字段零变化
  - F9 `engines.dsh` 兼容判定优先级变更对 LDVH 无影响：LDVH 未声明 `engines.dsh`，按指南回退到 peer 规则
  - F10 其余四份与 LDVH 相关度较高的迁移指南均不击中 LDVH 的消费面
  - F11 宿主已实际跃迁到 0.2.1-rc.1，LDVH 仍加载运行（`/ldvh` 与 `/ldvh/api/health` 均 HTTP 200），但闲时辅助的派发路径已在 rc.1 上实测失败
uncertain:
  - issue: dsh-ldvh 在 0.2.1-rc.1 上未做完备的真实 UI 验收
    reason: 六项中 /ldvh 与 /ldvh/api/health 有 HTTP 200 实证，设置卡片、LDVH 会话视图、停用与重启、卸载清理四项未核对；故声明范围覆盖 rc.1 由 semver 实跑确定、两项路由可用有运行时实证，但六项全数通过不能由本轮证据主张
  - issue: invariants 静默失效的实际后果未量化
    reason: "F3 的优雅降级是源码级判定（host-seams.js 在 ctx.get('invariants') 为 undefined 时返回 consumed: false 而不抛错），运行宿主 asar 内已确认零 invariant 包；但该断言失效后「管辖注册载体不满足 v5 schema」这一情形是否仍被其它通道拦住，未实测"
  - issue: 全部 8361 个变更文件未逐字审阅
    reason: 覆盖策略为集合级机械比对（契约三表、槽位目录、包集合、peer/engines 声明、持久化 schema）加 LDVH 消费点定向核对；残余风险主要落在远程访问、插件市场、PTC/沙箱、桌面壳层与客户端展示层
  - issue: 适配后的 subagents.startActivation 行为未验证
    reason: F4 的破坏已由运行时铁证确认，但迁移到 startActivation 后 activation.result 的结算语义、dispose 与取消之间的关系、以及 outputSchema 的传递形态，均须实际改造后观察
gaps:
  - description: 真实 UI 验收其余四项仍未执行：设置卡片、LDVH 会话视图、停用与重启、卸载清理；这是当前唯一阻塞已验证支持声明的缺口，与上一轮同源、至今未消
    priority: medium
  - description: 本轮出现两处必须适配的破坏，但适配本身（改 host-seams.js 的 invariants 路径、改 friction-discovery-provider.js 的 subagents 调用）尚未执行，属代码工作不在本调研对象内
    priority: medium
  - description: 仓库根目录仍无 CHANGELOG，变更语义须由 Release 说明与决策记录反推
    priority: low
implications:
  - finding_ref: F3 被删除的唯一服务 `invariants` 恰是 LDVH 消费的服务；官方迁移指南逐字明示该服务与相关类型不再发布
    implication: 「服务存在但变了」与「服务整个不存在」是两种不同风险：上一轮消费面零破坏的经验不能外推到新区间，每轮都必须重新核对服务集合的删除方向。
  - finding_ref: F4 LDVH 经 path 硬依赖 `subagents.start`，该方法在本区间被整体移除并由 `startActivation` 取代，已在 rc.1 宿主上实测抛 TypeError
    implication: "静态契约比对给出的破坏必须由运行时现象印证才算成立；而运行时的静默停摆（stage: stopped，per_task 为空）会被误读为「本次没有可做的事」，故必须读 pending-queue 的 reason 才能定位到 subagents.start is not a function。"
  - finding_ref: F5 LDVH 消费的其余 9 个在册服务与全部 10 个事件逐条未变：`userQuestions` 与 `tools` 整条全等，10 个事件 mode 与签名逐字全等
    implication: userQuestions 与 tools 的源文件 blob 全等是比「条目摘要相等」更强的证据；对本轮而言，核心问答门与工具守卫两条最重的缝并未受损，破坏集中在两个较窄的缝上。
  - finding_ref: F7 客户端槽位 90→100，89 条公共槽位的 `registerOptions` 逐字全等零差异，被删的 `conversation.message.images` 是空契约槽位
    implication: 槽位目录的条目级 changed 计数（89 条）会把 standardProps 的新增与 ownerProps 注释改写一并计入，误读成「注册契约广泛变更」；必须先剥掉这些字段再比 registerOptions 才能得出正确结论。
  - finding_ref: F9 `engines.dsh` 兼容判定优先级变更对 LDVH 无影响：LDVH 未声明 `engines.dsh`，按指南回退到 peer 规则
    implication: 宿主引入新的兼容判定主键时，「未声明新主键」反而是安全的：规则明确只有缺少 engines.dsh 时才使用 peer 规则，故在本轮无需为它改动清单。
  - finding_ref: F11 宿主已实际跃迁到 0.2.1-rc.1，LDVH 仍加载运行（`/ldvh` 与 `/ldvh/api/health` 均 HTTP 200），但闲时辅助的派发路径已在 rc.1 上实测失败
    implication: 「插件能加载」与「插件功能完好」是两件事：健康端点 200 只证明 web 挂载与路由活着，闲时辅助这条旁路业务已经在 rc.1 上停摆，两者必须在报告里分开陈述。
urls:
  - ref: https://github.com/deepseek-ai/deepseek-harness
    title: deepseek-harness（DSH 内核源码仓）
    summary: 全部内核侧发现的对照源：两 tag（dsh-v0.2.0-rc.2 = 639ed015397290b3745d163aafe02ffee4aa3f84、dsh-v0.2.1-rc.1 = 1600d8a1e140dcde43a1a0941940a0480712c011）的只读差分，覆盖契约三表、槽位目录、包集合、peer/engines 声明、持久化 schema 与变更记录、升级指南。限制：仓库根无 CHANGELOG，变更语义须由 Release 说明与决策记录反推；静态差分只证明发布内容，不证明运行时装了什么
  - ref: https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.1
    title: DSH v0.2.1-rc.1 官方发布说明
    summary: "本区间产品面变更的权威全量清单：中英各四节，正文约 23KB，prerelease: true、published_at 2026-10-17T05:22:10Z。明确列出移除运行时 invariant 插件（其余为 engines.dsh 优先级、stats 拆分、Agent Team inbox、规划审阅、pi-ai 1.0.2 等）；限制：面向用户措辞，不含 API 契约细节"
  - ref: https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.1/docs/upgrade-guide/v0.2.0-rc.2/remove-runtime-invariants/guide.zh.md
    title: 升级指南：运行时不变式插件被移除
    summary: F3 的权威依据：逐字列明不再发布 @deepseek-ai/dsh-invariants、InvariantRegistry、InvariantInstaller、InvariantFailure、InvariantError 及任何 <package>/invariant 子路径，并给出四步迁移与验证口径
  - ref: https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.1/docs/upgrade-guide/v0.2.1-alpha.1/subagent-activations/guide.zh.md
    title: 升级指南：将委派迁移到受管理的子 agent activation
    summary: "F4 的权威依据：逐字给出将 ctx.subagents.start() 或 startContinuable() 替换为 startActivation() 及 delivery: caller 的完整示例，并说明 result 在清理结束后结算、启动信号不再控制取消"
  - ref: https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.1/docs/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.zh.md
    title: 升级指南：插件兼容性先读 engines.dsh
    summary: F9 的权威依据：逐字写明包自身的 engines.dsh 范围单独决定结果并忽略 peer，只有缺少 engines.dsh 时才使用 peer 规则；同时记录 IncompatiblePlugin 的 peers 字段改名为 requirements
  - ref: https://registry.npmjs.org/@deepseek-ai/dsh
    title: "@deepseek-ai/dsh（npm registry 元数据）"
    summary: 版本通道事实：dist-tags 为 latest = 0.2.0-rc.2、next = 0.2.1-rc.1、alpha = 0.2.1-alpha.5；0.2.1-rc.1 于 2026-10-17T03:17:24.154Z 发布。限制：只给版本号与标签，不能说明本机运行宿主的版本
  - ref: https://github.com/dingminhua/dsh-ldvh
    title: dsh-ldvh（受辖项目仓）
    summary: 消费面核对的发生地：plugin/package.json 的 peerDependencies（>=0.1.7-rc.1 <0.3.0）与 engines（仅 node），plugin/lib/host-seams.js 的 invariants 与 userQuestions 安装点，plugin/lib/friction-discovery-provider.js 的 subagents.start 调用，plugin/lib/lifecycle.js 的事件订阅。限制：本机运行宿主的进程、端口与内核版本实证为本地观察，不由该 URL 承载
object_uid: 21ea3e9f-4f12-4c7b-b16a-123fb49b33b8
fact_type_key: research
created_at: 2026-10-17T08:06:46.053Z
change_log:
  - at: 2026-10-17T08:06:46.053Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Research 对象
  - at: 2026-10-17T08:08:48.728Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 修正正文中上游仓 docs/ 路径的表述（加「上游仓」前缀以示与本仓路径区分），并统一一处 LVH 笔误；结论与三态不变
  - at: 2026-10-17T08:10:11.866Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 正文改为以指南名称（remove-runtime-invariants / subagent-activations / plugin-engines-dsh）而非上游 docs/ 路径来指称来源，使事实对象在受辖仓内不产生悬空 docs/ 引用；结论与三态不变
---

## 研究问题

DSH 从 0.2.0-rc.2 到 0.2.1-rc.1 有哪些变更，其中哪些影响 dsh-ldvh 的宿主对接与 LDVH 消费面？

本轮调研的对象是 DSH 内核仓 `deepseek-ai/deepseek-harness` 从 tag `dsh-v0.2.0-rc.2`（`639ed01539`，2026-09-29）到 tag `dsh-v0.2.1-rc.1`（`1600d8a1e1`，2026-10-16）的发布差量。选此区间的直接背景是宿主已实际跃迁：本机运行中的 `/Applications/DeepSeek Harness.app` 现为 `CFBundleShortVersionString` `0.2.1-rc.1`（进程 `2026-10-17T15:52:32` 启动，`app.asar` 于 `10:53:48` 替换），插件仍经 profile 的 `link:` 指向本仓库。上一轮调研（`0.2.0-rc.1`→`0.2.0-rc.2`）的结论是「无需代码适配」，本轮要回答那个结论是否还能延续。

本轮调研支撑的项目判断有三条：dsh-ldvh 是否需要为 `0.2.1-rc.1` 做契约适配（以及适配范围）；兼容声明 `>=0.1.7-rc.1 <0.3.0` 在 rc.1 上是否仍覆盖；支持基线登记值是否应从 `0.2.0-rc.2` 推进到 `0.2.1-rc.1`。

## 输入与边界

来源按四分法分工，全部为长期可复核的 HTTP(S) 资料，配合本地只读差分：

- **DSH 内核源码仓**（`https://github.com/deepseek-ai/deepseek-harness`）承担全部内核侧发现：两 tag 的只读差分，覆盖三张生成式契约目录、槽位目录、包集合、peer/engines 声明、持久化 schema 与变更记录、升级指南目录。
- **官方发布说明**（`releases/tag/dsh-v0.2.1-rc.1`）承担产品面变更的权威骨架，用于与机械差分交叉验证并暴露机械比对不易察觉的清单外变更（如 pi-ai 升级、Azure 提供方改名）。
- **升级指南目录**（上游 upgrade-guide，本区间新增 44 份）承担**破坏性变更的官方自述**——这是本轮最有效的一类来源，因为它逐字写着「什么不再发布」与「怎么迁移」。
- **受辖项目仓**（`https://github.com/dingminhua/dsh-ldvh`）承担消费面核对：`plugin/package.json` 的声明、`plugin/lib/host-seams.js` 的宿主缝消费清单、`plugin/lib/friction-discovery-provider.js` 的 `subagents.start` 调用点。
- 另有**运行时来源**两项：本机运行宿主的 asar 内实际包集合（经 asar 头解析逐包取版本），以及 LDVH 自身的闲时运行痕迹 `~/.dsh/ldvh/idle-checkpoint-runs.json`、`pending-queue.jsonl`。

方法为静态差分与集合级机械比对：以字符串感知的括号深度解析器从生成物中抽取条目集合与 `signature` 字段逐条对照；对包集合提取 `package.json` 的 `name` 字段求差集；对关键文件取 blob hash 判等；对声明与宿主的兼容性按 `includePrerelease: true` 语义做版本区间求值；对宿主指认取四项实证（进程、端口持有者、运行产物内核版本、profile 安装形态）。

**方法论要点（本轮教训）**：槽位目录的「条目 changed 计数」会被 `standardProps` 新增与 `ownerProps` 注释改写污染（89/89 条全标 changed），必须剥掉这些字段后单比 `registerOptions` 才能得出正确结论——修正后差异为 **0**。同理，契约表的「entry 相等」不等于「成员未变」，必须细到方法签名。

不覆盖范围与来源限制：本轮未做完备的端到端 UI 验收（六项中 `/ldvh` 与 `/ldvh/api/health` 两项有运行时实证，其余四项未核对）；未逐字审阅全部 8361 个变更文件，覆盖依赖集合级比对与 LDVH 消费点的定向核对；模型目录的逐条 ID 增删未穷举；适配改造本身不在本对象范围内。

## 关键发现

### F1 区间规模 1916 commits、8361 files +315,897/−84,270，是上一区间（187 commits / 1022 files）的约十倍

区间为 **1916 commits**（1477 非 merge），**8361 files changed，+315,897/−84,270**；其中上游仓的文档目录为 453 files `+45,770/−6,885`，即**非文档部分仍有 7908 files +270,127/−77,385**。这是 `0.2.0` 线到 `0.2.1` 线的整代跃迁，不是候选版内的小修。

单文件改动量前列：三份新增的持久化 schema 文档（`2026-10-13-user-rpc-principal` +11,559、`2026-10-05-working-directory-attribution` +11,474、`2026-10-07-title-reasoning-effort` +2,990）、`pnpm-lock.yaml` `+4,495/−2,814`、上游持久化 schema 清单（persistence-schema.json）`+3,028/−2,302`。**把这三份上万行的 schema 文档误读为格式升级会得出完全相反的数据面风险判断**——它们是新 root 的完整定义文档，不是会话日志本身（见 F6）。

对 LDVH 的意义：规模本身不构成风险判断，但它宣告了上一轮「契约只增不改」的经验不可外推——必须重新逐面取证。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.2.0-rc.2 的 639ed01539 与 dsh-v0.2.1-rc.1 的 1600d8a1e1：git rev-list --count 1916 与非 merge 1477；git diff --shortstat 的全量与仅文档目录两组口径；git diff --numstat 排序前列文件）

### F2 契约三表首次出现净删除：服务 91→98（+8/−1）、事件 81→82（+1/−0）、类型 936→1053（+126/−9）

对三张生成式契约目录做集合级比对：

- `SERVICE_API` **91→98**：新增 8（`claudeCodeMods`、`cotTranslation`、`pluginMarket`、`remoteAccess`、`translator`、`webApp`、`workingDirectory`、`worktrees`），**删除 1（`invariants`）**，另有 24 条条目内容变化。
- `EVENT_API` **81→82**：新增 `plugin-market/changed`，**零删除**，1 条变化（`credentials/reference-updated`）。
- `TYPE_API` **936→1053**：新增 126，**删除 9**（`ContinuableStart`、`ContinuableStartSpec`、`ContinuableSubagentDescriptorData`、`InvariantFailure`、`InvariantInstaller`、`OneShotSubagentDescriptorData`、`SubagentDescriptorData`、`TeamMessageId`、`TerminalAttachmentId`），51 条变化。

这是**本区间相对过去三轮的根本区别**：此前每一轮的三表都是「零删除」。`SERVICE_API` 的 −1 就是服务层的破坏性变更，而它恰好落在 LDVH 的消费清单里（F3）。

对 LDVH 的意义：风险命题从「新增的东西会不会冲突」翻转为「被删的东西是不是我在用的」。后者不能靠 diff 的行数判断，只能靠消费清单与删除名单求交。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.2.0-rc.2 与 dsh-v0.2.1-rc.1：packages/extensions/tool-cordis/src/api-catalog.ts 的三段常量经括号深度解析后按 key/name 求差；SERVICE_API 91→98、EVENT_API 81→82、TYPE_API 936→1053）

### F3 被删除的唯一服务 `invariants` 恰是 LDVH 消费的服务；官方迁移指南逐字明示该服务与相关类型不再发布

`packages/*/**/invariant` 相关插件由提交 `f028f25667 refactor: remove runtime invariant plugins` 整体移除。上游升级指南「运行时不变式插件被移除」（remove-runtime-invariants）逐字写明：

> 下一版本不再发布 `@deepseek-ai/dsh-invariants`、`InvariantRegistry`、`InvariantInstaller`、`InvariantFailure`、`InvariantError`，也不再发布任何 `/<package>/invariant` 子路径。`sdk-minimal` profile 不再包含这五行。

四项独立证据互相印证：① `SERVICE_API` 里 `invariants` 条目消失、`TYPE_API` 里 `InvariantFailure`/`InvariantInstaller` 消失；② 包集合里 `@deepseek-ai/dsh-invariants` 消失（F8）；③ 源码 `grep` 零命中（`provide('invariants'`、`InvariantRegistry`、`InvariantInstaller` 全部无结果）；④ **运行宿主 asar 内 305 个 `@deepseek-ai` 包中零个含 `invariant`**。

对 LDVH 的意义：这是**第二处必须处理的破坏**，但**不致命**——`plugin/lib/host-seams.js` 的 `installInvariants` 已做防御式取值：`ctx.get("invariants")` 为 `undefined` 或 `register` 非函数时返回 `{ consumed: false, detail: "ctx.invariants.register is unavailable in this composition" }`，**不抛错**。故其表现是**静默失效**：该 seam 从「已消费」降级为「不可用」，08 §6 的「管辖注册载体满足 v5 schema」运行时断言在这台宿主上不再执行。

**这是本对象最重要的一条判断**：静默失效比抛错更危险——它不会产生任何错误日志或失败痕迹，只是少了一道检查。若不在报告中点名，这道断言会在无人察觉的情况下长期缺席。

溯源：https://github.com/deepseek-ai/deepseek-harness（上游升级指南 remove-runtime-invariants 的变更段逐字不再发布清单；配套提交 f028f25667；api-catalog.ts 两 tag 的 invariants 条目与 InvariantFailure/InvariantInstaller 消失；packages 下 grep 零命中；本机 app.asar 头解析后 @deepseek-ai 下 305 包零 invariant；消费侧为 dsh-ldvh 的 plugin/lib/host-seams.js 中 installInvariants 的 consumed:false 降级分支，见 https://github.com/dingminhua/dsh-ldvh）

### F4 LDVH 经 path 硬依赖 `subagents.start`，该方法在本区间被整体移除并由 `startActivation` 取代，已在 rc.1 宿主上实测抛 TypeError

`subagents` 服务 `14→15` 方法，**删除 4、新增 5**。删除项为：

```
async start(name: string, request: SubagentStartRequest): Promise<SubagentRun>
async startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>
async drainContinuableChildren(parent, childIds): Promise<void>
async drainContinuableDescendants(parents): Promise<void>
```

`plugin/lib/friction-discovery-provider.js:377` 调的正是被删的第一个：

```js
const run = await subagents.start(picked.value.name, {
  label: `ldvh-idle ${dispatchedAt}`,
  prompt: [{ type: "text", text: prompt }],
  parent, signal, outputSchema,
});
```

上游升级指南「将委派迁移到受管理的子 agent activation」（subagent-activations）逐字给出迁移路径：「对于必须等待结果的宿主代码，将 `ctx.subagents.start()` 或 `startContinuable()` 替换为 `startActivation()`，并选择调用方投递」，并附 `delivery: 'caller'` 的完整示例与语义说明（`result` 在清理结束后结算、启动信号不再控制取消、`dispose()` 取消该次 activation）。

**运行时铁证**（不是推断，是实测）：rc.1 进程（15:52:32 启动）下的闲时检查点 `2026-10-17T08:03:51Z` 以 `stage: stopped`、`code: idle_checkpoint/stopped`、`per_task: {}` 收场，`pending-queue.jsonl` 中对应的 `entry_id: bcc60770-…` 的 `reason` 逐字为：

> 执行体（受管辖隔离子代理）失败：**subagents.start is not a function**

另需登记一处**证据甄别**：同一日志里 `2026-10-17T07:40:17Z` 那次运行**成功**（`friction-discovery: landed`，创建了 `b389a3bd`）。但该时刻（北京 15:40）在 `app.asar` 替换（10:53）之后、**当前进程启动（15:52）之前**——它跑在旧内核的进程里，**不能**被当作「rc.1 下 `start` 可用」的证据。若不做这步时间线核对，会把这次的 TypeError 误判为偶发。

对 LDVH 的意义：这是**第一处必须处理的破坏**，且已经**实际发生**——闲时辅助的全部任务（`friction-discovery`、`experience-capture`）在 rc.1 上从派发环节即失败，`per_task` 空、无产出。主会话的 `ldvh_*` 工具、Human Gate、Git Gate 不受影响（它们走 `tools`/`userQuestions`，见 F5）。

溯源：https://github.com/deepseek-ai/deepseek-harness（上游升级指南 subagent-activations 第 3 条逐字给出 startActivation 与 delivery caller 示例；api-catalog.ts 两 tag 的 subagents 方法集差 14→15、删 4 增 5；运行宿主 asar 内 dsh-subagent@0.2.1-rc.1 的 SubagentRuntime 类仅有 startActivation；消费侧为 dsh-ldvh 的 plugin/lib/friction-discovery-provider.js:377 的 start 调用，见 https://github.com/dingminhua/dsh-ldvh）

### F5 LDVH 消费的其余 9 个在册服务与全部 10 个事件逐条未变：`userQuestions` 与 `tools` 整条全等，10 个事件 mode 与签名逐字全等

按 `plugin/lib/*.js` 的实际消费点，LDVH 使用**主机侧 12 个宿主服务**与**10 个事件**。逐一核对：

| 服务 | 状态 |
|---|---|
| `userQuestions` | **整条全等**（4→4 方法，源文件 blob 两 tag 同一） |
| `tools` | **整条全等**（8→8 方法） |
| `sessionPersistence` / `goals` / `agents` / `commands` / `fs` | **整条全等** |
| `webServer` | 7→8，新增 `getOrigin()`；**`register` 未变** |
| `systemPrompt` | 8→9，新增 `refreshContext()`；`suppressRuntimeContext` 仅描述改写 |
| `subagents` | **`list`/`getProvider` 未变，`start` 被删**（F4） |
| `invariants` | **服务整个消失**（F3） |
| `connection` | 8→11（`operator`→`browserPeer`+`allowsRemoteAuthorities`，新增 `createPeer`/`admitConnection`）；LDVH 用的 `connection.handle` 属 **TYPE_API 的 `HostConnectionRpc`**，两 tag 逐字全等 |
| `dshHomePath` | 值服务（`ctx.provide`），不在 `SERVICE_API` |

十个事件——`agent/created`、`agent/pre-step`、`agent/status`、`agent/turn-stopping`、`fs/edit-intent`、`fs/observed`、`fs/write-intent`、`session/event`、`subagent/end`、`system-prompt/assemble`——**mode 与 signature 逐条逐字全等**。

这比上一轮更强：上一轮 `EVENT_API` 条目级变化数为 0 但其说法依赖整表零变化；本轮 `EVENT_API` 确有 1 条变化（`credentials/reference-updated`）与 1 条新增，而 LDVH 的十个事件**逐条落在变化集之外**，是逐条实证而非整表推断。

对 LDVH 的意义：破坏高度收敛在两条较窄的缝上。**最重的两条缝未受损**——`userQuestions.ask` 承载全部三个 Human Gate（07 §5.6、21 §6.3、20 §16），`tools.register`/`tools.guard` 承载全部 `ldvh_*` 操作与写入守卫。这解释了 F11 中「插件仍能加载且主流程可用」的现象。

溯源：https://github.com/deepseek-ai/deepseek-harness（api-catalog.ts 两 tag 的 12 个服务与 10 个事件逐条比对；packages/interaction/user-questions/src/index.ts 与 types.ts 两 tag blob 全等；HostConnectionRpc 声明两 tag 逐字全等；消费点枚举见 https://github.com/dingminhua/dsh-ldvh 的 plugin/lib/host-seams.js、lifecycle.js、child.js、rpc.js）

### F6 持久化格式仍 v4、`roots` 62→65 新增 3 个零删除、6 个 root digest 变化，7 份变更记录全部 `decision: same-version`

`SESSION_FORMAT_VERSION` 两 tag **仍为 `4`**（`packages/core/session/src/types.ts`）。上游持久化 schema 清单的 `formatVersion` **2→2**、`roots` **62→65**（新增 `event:job/registered`、`event:job/settled`、`event:working-directory/change`，**零删除**）、`types` **590→612**。

有 **6 个 root 的 `digest` 变化**：`event:agent/inbox/spliced`、`event:developer/message`、`event:session/title-llm-request`、`event:subagent/catalog`、`event:tool/ptc-dispatch`、`event:user/message`。

本区间新增 **7 份**变更记录（`2026-09-13-working-directory`、`2026-09-19-external-subagent-catalog`、`2026-09-30-job-session-lifecycle`、`2026-10-05-ptc-operation-metadata`、`2026-10-05-working-directory-attribution`、`2026-10-07-title-reasoning-effort`、`2026-10-13-user-rpc-principal`），其 `decision` **全部为 `same-version`**（逐条 grep 确认，无一条 `minor`/`major`）。

结论：v4 内的**向后兼容加法**。对 LDVH 的意义：作为会话消费者无需迁移动作；`event:subagent/catalog` 的 digest 变化与 F4 的子代理改造同源，值得在适配时留意子代理会话的可读性，但 schema 层面未删除任何既有字段。

溯源：https://github.com/deepseek-ai/deepseek-harness（packages/core/session/src/types.ts 的 SESSION_FORMAT_VERSION 两 tag 均为 4；上游持久化 schema 清单的 formatVersion 2 对 2、roots 62 对 65 求差、6 个 root digest 前后值、types 590 对 612；上游持久化变更记录（persistence-changes）下 7 份新增 md 的 decision 逐条 grep 全部 same-version）

### F7 客户端槽位 90→100，89 条公共槽位的 `registerOptions` 逐字全等零差异，被删的 `conversation.message.images` 是空契约槽位

`CLIENT_SLOT_API` 由 **90 增至 100**：新增 11（`conversation.chat.flow`、`conversation.chat.message.images`、`conversation.chat.reasoning.body`、`conversation.chat.user.images`、`conversation.hero.options`、`conversation.input.model.label`、`conversation.user.text.node`、`plugins.add.actions`、`plugins.tab`、`shell.bottom`、`workspace.toast`），**删除 1（`conversation.message.images`）**。

**关键判定**：朴素比对会报「89 条槽位 changed」，但这几乎全是噪声——变化集中在 `standardProps` 新增三条远程访问钩子（`useRemoteAccess`、`useSessionAccess`、`useWorkspaceAccess`）与 `ownerProps` 注释改写。**剥掉这些字段后单比 `registerOptions`（第三方注册契约），89 条公共槽位差异为 0**。被删的 `conversation.message.images` 的 `registerOptions` 为 `[]`（空契约），LDVH 未使用。

LDVH 注册的两个槽位是 `conversation.chat.node`（key `ldvh-notice`）与 `conversation.view`，二者均在公共集内且注册契约全等。

对 LDVH 的意义：客户端注册面**安全**，无需改动。

溯源：https://github.com/deepseek-ai/deepseek-harness（packages/extensions/cordis-client-runner/src/client/slot-catalog.ts 两 tag 的 CLIENT_SLOT_API 90 对 100、added 11 项、removed 为 conversation.message.images 且其 registerOptions 为空数组；89 条公共槽位剥离 source/standardProps/ownerProps 后 registerOptions 零差异；注册点见 https://github.com/dingminhua/dsh-ldvh 的 plugin/lib/client.js）

### F8 包集合 325→349（+27/−3），peer 声明零收窄（NARROWED=0），`engines` 字段零变化

包集合（`packages/**/package.json` 的 `name`）**325→349**：新增 27（含 `dsh-plugin-market`、`dsh-api-remote-access`、`dsh-working-directory`、`dsh-tool-working-directory`、`dsh-experimental-worktree`、`dsh-experimental-cua-macos`、`dsh-experimental-translator` 等），**删除 3**：`@deepseek-ai/dsh-invariants`（F3）、`@deepseek-ai/dsh-subagent-in-process-driver`（F4 的驱动包移除）、`@deepseek-ai/dsh-experimental-schedule-bundle`。

`peerDependencies` 全区间 **73 个包有变化**，但按方向拆开后：**区间收窄（NARROWED）为 0**——没有任何既有权重的范围被收紧或改类型。删除 70 处（其中绝大多数是 `@deepseek-ai/dsh-invariants` 随服务消失而必然移除的引用），新增 37 处（主要是 `dsh-working-directory`、`dsh-subagent`、`dsh-fs-local` 等新缝）。`engines` 字段**零变化**（全部 349 个包比对，0 处差异）。

组合面：六个 bundle 的 `package.json` 均有变化（不再只是 `version` 行），`cordis.patch.yml` 与 `presets/*.patch.yml` 有实质改动（`web-app` 的四个 preset 合计 `+119/−102`），`sdk-minimal` 移除了 `dsh-invariants` 与 `dsh-scope` 两行并新增 `dsh-subagent` 等。

对 LDVH 的意义：**peer 零收窄是好消息**——本插件的四条 peer 声明不会被任何上游改动顶掉。但「bundle 补丁有实质改动」意味着**能力的默认可用性可能翻转**（与上一轮「零变化」形成对照），任何依赖默认装配的假设都要重新核对。

溯源：https://github.com/deepseek-ai/deepseek-harness（packages/**/package.json 的 name 集合 325 对 349 求差；73 个包的 peer 按 added/removed/narrowed 三向拆分且 narrowed 集合为空；engines 字段全量比对 0 差异；packages/bundle/ 下 package.json 与 cordis.patch.yml 的 diff 统计）

### F9 `engines.dsh` 兼容判定优先级变更对 LDVH 无影响：LDVH 未声明 `engines.dsh`，按指南回退到 peer 规则

上游升级指南「插件兼容性先读 engines.dsh」（plugin-engines-dsh）逐字写明判定规则的翻转：

> 下一版本中，包自身的 `engines.dsh` 范围单独决定结果，并忽略这些 peer；**只有缺少 `engines.dsh` 时才使用 peer 规则**。

机械侧确证宿主实现一致：`packages/boot/app-boot/src/plugin-compatibility.ts` 的 `unmetRequirements` 先查 `engines.dsh`，命中即以它判定，否则回落到 peer。同一变更把拒绝记录里的 `peers` 改名为 `requirements`。

LDVH 的 `plugin/package.json` 的 `engines` **只有 `node: ">=22.15.0"`，无 `dsh` 键**，故优雅回落到 peer 规则——四条 peer 声明照旧生效，行为**不变**。

另核对发布说明里两项易被忽略的用户面变更：**`pi-ai` 由 0.85.1 升至 1.0.2**（上游模型目录更新与适配器修复）、**Azure 提供方名由 `azure-openai-responses` 统一为 `azure`**（旧配置需迁移）。二者均不击中 LDVH（本插件不消费模型选择面与提供方配置），但对本机其他插件的配置有效性有影响。

对 LDVH 的意义：本轮**无需**为 `engines.dsh` 改动清单。但这是一条**将来会咬人**的机制：若日后本插件声明了 `engines.dsh`，该范围将**单独决定**兼容结果、且 peer 不再放宽或收窄它——届时两处声明必须自洽。

溯源：https://github.com/deepseek-ai/deepseek-harness（上游升级指南 plugin-engines-dsh 的变更段与迁移第 1、2 条逐字；宿主实现见 packages/boot/app-boot/src/plugin-compatibility.ts 的 unmetRequirements 分支；pi-ai 1.0.2 与 azure 改名两条见 releases/tag/dsh-v0.2.1-rc.1 的其他变更段；消费侧清单见 https://github.com/dingminhua/dsh-ldvh 的 plugin/package.json，engines 仅含 node）

### F10 其余四份与 LDVH 相关度较高的迁移指南均不击中 LDVH 的消费面

本区间新增 44 份升级指南（`v0.2.0-rc.2` 6 份、`v0.2.1-alpha.1` 24 份、`alpha.2` 10 份、`alpha.3` 1 份、`alpha.4` 1 份）。按与 LDVH 的贴近度逐一核对四份：

- **`working-directory`**（会话工作目录取代内置 cwd 配置，新增 `workingDirectory` 服务与相关事件）：LDVH 读 `ctx.get("cwd")` 与 `session/event`，但 `workingDirectory` 是**新增**服务、`event:working-directory/change` 是**新增** root（F6），旧路径未被移除。
- **`instruction-home-override`**（`agent-instructions` 行不再接受 `dshHome`）：LDVH 的规则引导注入走 `system-prompt/assemble`（F5 全等），不经 `agent-instructions` 行配置。
- **`team-direct-inbox`**（Agent Team 消息改直投目标 Inbox，移除 outbox 与重试去重）：LDVH 不消费 Agent Team 投递通道，其子代理走 `subagents`。
- **`tool-presentation-mode`**（移除 `both` 混合模式）：LDVH 的工具注册走 `tools.register`（整条全等），不依赖展示模式配置。

另核对发布说明中三项潜在相关项：**「输入区统计扩展拆为 `activity` 和 `usage`」**——LDVH 的 `client.js` 中 `grep stats` 零命中，未使用该槽位；**「子路径插件不再读取独立 `package.json`」**——LDVH 是**主入口插件**（`main: lib/index.js`）而非子路径插件，不适用；**「Agent Team 消息改直投 Inbox」**——不适用。

对 LDVH 的意义：44 份指南里，真正击中的只有 `remove-runtime-invariants`（F3）与 `subagent-activations`（F4）两份。这为适配范围给出了**闭合的边界**。

溯源：https://github.com/deepseek-ai/deepseek-harness（上游 upgrade-guide 下 v0.2.0-rc.2 与 v0.2.1-alpha.* 共 44 份中文指南的清单与各首段 description；四份正文；release 说明的 stats 拆分、子路径插件、Agent Team 三条；消费侧见 https://github.com/dingminhua/dsh-ldvh 的 plugin/lib/client.js 无 stats 引用与 plugin/package.json 为 main 入口插件）

### F11 宿主已实际跃迁到 0.2.1-rc.1，LDVH 仍加载运行（`/ldvh` 与 `/ldvh/api/health` 均 HTTP 200），但闲时辅助的派发路径已在 rc.1 上实测失败

按红线 7 取四项实证：① 进程——`DeepSeek Harness.app` 在运行，PID 18669 启动于 **2026-10-17T15:52:32**；② 端口——GUI `60520` 与插件 web api `3299` 的持有者均为该 app；③ 运行产物内核版本——`CFBundleShortVersionString` 为 **`0.2.1-rc.1`**，其 `app.asar` 内 `dsh/node_modules/@deepseek-ai` 下实测 **305 个包**（其中 `dsh-subagent` 逐包读取为 `0.2.1-rc.1`），且**零个含 `invariant`**；④ profile 安装形态——`~/.dsh/profiles/desktop/node_modules/dsh-ldvh` 仍为 `link:` 指向本仓库。

运行时实证：`/ldvh/api/health` 返回 `{"ok":true,"service":"dsh-ldvh","status":"ok",...}`，`/ldvh` 返回 **HTTP 200**。

声明覆盖判定：以 `includePrerelease: true` 语义求值，`0.2.1-rc.1` 对 `>=0.1.7-rc.1 <0.3.0` **匹配**（`0.2.1` 正式版亦匹配，`0.3.0` 不匹配），故兼容声明**仍覆盖** rc.1，无需改动。

**但「能加载」不等于「功能完好」**：如 F3、F4 所述，两条 seam 已分别静默失效与硬失败。健康端点 200 只证明 web 挂载与路由活着；闲时辅助这条旁路业务在 rc.1 上从 08:03:51Z 起即停摆。二者的区别必须在报告中并列表述。

另需登记一处**既有缺口未消**：真实 UI 验收六项中，设置卡片、LDVH 会话视图、停用与重启、卸载清理**四项仍未核对**（与上一轮同源）。

溯源：https://github.com/dingminhua/dsh-ldvh（plugin/package.json 的 peer 声明；本机四项实证为 /Applications/DeepSeek Harness.app 的 CFBundleShortVersionString 0.2.1-rc.1、app.asar 头解析后 @deepseek-ai 下 305 包与 dsh-subagent@0.2.1-rc.1、ps 显示 PID 18669 启动于 15:52:32、lsof 显示 60520 与 3299 持有者、~/.dsh/profiles/desktop/node_modules/dsh-ldvh 的 link 指向；运行时为 /ldvh 与 /ldvh/api/health 的 HTTP 200）

## 未证实与缺口

**未证实 1：dsh-ldvh 在 0.2.1-rc.1 上未做完备的真实 UI 验收。** 六项中 `/ldvh` 与 `/ldvh/api/health` 有 HTTP 200 实证（F11），设置卡片、LDVH 会话视图、停用与重启、卸载清理四项**未核对**。故「声明范围覆盖 rc.1」由版本区间求值确定、「两项路由可用」有运行时实证，但「六项全数通过」不能由本轮证据主张。

**未证实 2：`invariants` 静默失效的实际后果未量化。** F3 的优雅降级是源码级判定（`host-seams.js` 在 `ctx.get('invariants')` 为 `undefined` 时返回 `consumed: false` 而不抛错），运行宿主 asar 内已确认零 invariant 包；但该断言失效后，「管辖注册载体不满足 v5 schema」这一情形是否仍被其它通道拦住，未实测。

**未证实 3：全部 8361 个变更文件未逐字审阅。** 覆盖策略为集合级机械比对（契约三表、槽位目录、包集合、peer/engines 声明、持久化 schema）加 LDVH 消费点定向核对。残余风险主要落在远程访问、插件市场、PTC/沙箱、桌面壳层与客户端展示层——不在 LDVH 消费面内。

**未证实 4：适配后的 `subagents.startActivation` 行为未验证。** F4 的破坏已由运行时铁证确认，但迁移到 `startActivation` 后 `activation.result` 的结算语义、`dispose` 与取消之间的关系、以及 `outputSchema` 的传递形态，均须实际改造后观察。本对象只给出迁移路径，不主张改造后必然等价。

**缺口 1（medium）：两处破坏的适配改造尚未执行。** 改 `host-seams.js` 的 invariants 路径、改 `friction-discovery-provider.js` 的 `subagents` 调用，是代码工作，不在本调研对象范围内；本对象只能为中优先级，因为调研结论本身已充分（破坏已定位、迁移路径已由官方指南给出），未执行的是下一阶段的实现工作。

**缺口 2（medium）：真实 UI 验收其余四项仍未执行。** 与上一轮同源、至今未消，是「已验证支持」声明的唯一前提。

**缺口 3（low）：仓库根目录仍无 CHANGELOG，变更语义须由 Release 说明与升级指南反推。**

## 建议

1. **把 `subagents.start` → `startActivation({ delivery: 'caller' })` 的适配提为待办——须经 Human 决定。** 目标对象类型：WorkCase。预期目标：使闲时辅助在 `0.2.1-rc.1` 上恢复派发。依据 F4（运行时铁证 `subagents.start is not a function`）与官方指南第 3 条。验收条件：在 rc.1 宿主上实跑一次闲时检查点，`idle-checkpoint-runs.json` 出现 `stage` 非 `stopped` 且有 `per_task` 产出。创建/更新判断：属跨文件代码改造且需独立复核，归 WorkCase。

2. **为 `invariants` 的静默失效补一条替代通道——须经 Human 决定。** 目标对象类型：WorkCase（或与建议 1 同批）。预期目标：让 08 §6 的「管辖注册载体满足 v5 schema」断言在 rc.1 上仍被执行，或在规范中明确该断言降级为「按需校验」。依据 F3。验收条件：明确二选一（补通道 / 降级并在 specs 写明理由）有据可查。创建/更新判断：涉及规范条款，须 Human 裁夺；若不补，则必须让该 seam 的「不可用」状态对 Human 可见，而非静默。

3. **支持基线登记值推进到 `0.2.1-rc.1`——须经 Human 决定。** 目标对象类型：规范受控更新（`local-dev-workflow`）。预期目标：使登记值与运行中宿主的实测版本一致（现登记 `0.2.0-rc.2`，实测 `0.2.1-rc.1`）。验收条件：规范、README 双版与 CHANGELOG 三处一致推进，并**如实登记两处未适配置**（不得因基线推进而暗示功能完好）。创建/更新判断：`local-dev-workflow` 明载该值为 Human 制定，AI 不得自行改写。

4. **兼容声明 `>=0.1.7-rc.1 <0.3.0` 无需改动。** 依据 F11 的版本区间求值（`0.2.1-rc.1` 匹配、`0.2.1` 匹配、`0.3.0` 不匹配）与 F8 的 peer 零收窄。此条不构成「已验证支持 `0.2.1-rc.1`」——该声明需要建议 5 的验收完成后才能成立。

5. **补齐真实 UI 验收四项（承上一轮同源缺口）。** 目标对象类型：WorkCase。预期目标：把 F11 的两项路由实证扩展为六项全数通过。验收条件：设置卡片、LDVH 会话视图、停用与重启、卸载清理四项在运行宿主上逐项实操并记录。创建/更新判断：该缺口已跨两轮未消。

6. **暂不为 `engines.dsh` 改动清单，但登记其未来风险。** 依据 F9。LDVH 未声明该键，回落 peer 规则，行为不变；但一旦声明，该范围将**单独决定**兼容结果且 peer 不再参与。本对象只作登记，不产出对象。

## 后续分流

- **建议 1（subagents 适配）→ WorkCase。** 信号：Human 确认要恢复闲时辅助时创建；或闲时辅助连续三次以上以 `subagents.start is not a function` 入队时自动触发提请。
- **建议 2（invariants 失效）→ WorkCase 或规范受控更新，与建议 1 同批裁决。** 信号：Human 就「补通道 / 降级」给出答复时启动；在此之前，该 seam 的不可用状态须对 Human 可见。
- **建议 3（基线推进）→ 规范受控更新。** 信号：Human 就「基线是否推进到 `0.2.1-rc.1`」给出答复时启动；在答复前保持现状，相关判断不引用 `0.2.1-rc.1` 为已验证环境。
- **建议 4（声明无需改动）本身不对象化**：它是本对象的证据结论，已由 F11 与 F8 承载；跨越下一个 DSH 区间时须重新取证。
- **建议 5（四项验收）→ WorkCase。** 信号：Human 或主控启动下一轮验证时创建。跨两轮未消。
- **建议 6（engines.dsh 风险）→ 暂不对象化。** 信号：本插件首次声明 `engines.dsh` 时，须同步核对它与四条 peer 声明是否自洽。
- **本对象自身的回查条件**：当上游发布非预发布的 `0.2.1`、或 dsh-ldvh 完成上述适配、或运行宿主升级到 `0.2.2` 线时，本对象的三态与结论须按 specs/24 §12 做 F4 来源展开复核；在此之前，其结论作为 `0.2.0-rc.2 → 0.2.1-rc.1` 这一区间的当前调研入口。
