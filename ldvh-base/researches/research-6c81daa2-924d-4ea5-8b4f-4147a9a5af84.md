---
title: DSH 内核 0.1.2-rc.1→0.1.5-rc.1 家族插件对接变更对照（27 项目受影响面）
status: active
research_question: DSH 内核从 0.1.2-rc.1 到 0.1.5-rc.1 有哪些影响家族插件对接的实质变更
research_purpose: 为家族目录（~/DshProject 下引用受影响包的 27 个 dsh-* 插件项目）提供版本跃迁的对照调整依据：定出已移除/改名的公共接口、需优先排查的项目与新增可用能力，使各项目按同一份机械差分各自核对，而不是逐个重新摸索
stopping_reason: sufficient
confirmed_statements:
  - F1 会话持久化改为句柄化接缝，locate/readRaw/DSH_SESSION_JSONL 已移除
  - F2 会话格式升至 v3，并随发布引入 v0→v1→v2→v3 迁移链
  - F3 PERSONA_SECTION 更名为 PERSONA_PREFIX_SECTION/PERSONA_SUFFIX_SECTION 且段 key 变更
  - F4 12 个包导出符号减少，18 个新包补齐资源协议与文件交付能力
  - F5 0.1.5-rc.1 即 npm latest，rc.2 已进入 next 通道
uncertain:
  - issue: dsh-attachment 的 admitPromptContent → admitEncodedFile 等 7 个新导出的等价性未核对
    reason: 仅做符号集合差分，未逐一比对函数签名与语义；命名差异大（prompt 内容准入 vs 编码附件准入），可能是准入通道拆分而非等价改名
  - issue: dsh-message-feedback 减少的 8 个符号的替代来源未验证
    reason: 同期 dsh-command-feedback 新增 SessionFeedbackService/FEEDBACK_CATEGORIES，时间上吻合但未逐一核对符号对应关系
gaps:
  - description: 导出符号差分只取各包 src/index.ts，未覆盖其他 entry 文件与 export * from 的传递导出；未打 ! 标记的破坏性变更可能存在
    priority: medium
    blocked_scope: 破坏项清单的完备性——清单可用于逐项对照排查，不能作为『除此之外无破坏』的证明
  - description: 未对任何家族项目执行真实编译或测试，全部破坏项均为机械差分推断
    priority: medium
    blocked_scope: 『某项目已确定无法构建或运行』类结论
  - description: 未含 0.1.5-rc.1 → 0.1.5-rc.2 的差异（rc.2 已在远端 tag 与 npm next 通道）
    priority: low
implications:
  - finding_ref: F1 会话持久化改为句柄化接缝，locate/readRaw/DSH_SESSION_JSONL 已移除
    implication: 会话日志读写类插件（含 LDVH 的 session-signature 与 zstd-compat）必须从『按路径直读日志文件』改走会话句柄，否则升级后静默失效或报错
  - finding_ref: F2 会话格式升至 v3，并随发布引入 v0→v1→v2→v3 迁移链
    implication: 读取会话日志的插件需按 v3 结构解析，并依赖迁移链消费 v0-v2 老日志，历史会话不再能按旧结构直读
  - finding_ref: F3 PERSONA_SECTION 更名为 PERSONA_PREFIX_SECTION/PERSONA_SUFFIX_SECTION 且段 key 变更
    implication: 按段 key 字符串注入 persona 前缀的插件必须同步改名与新 key，否则注入位置失效
  - finding_ref: F4 12 个包导出符号减少，18 个新包补齐资源协议与文件交付能力
    implication: 引用已移除符号的项目会在编译或加载期失败；同时新包给出资源协议、文件交付声明等可直接对齐的新承载
  - finding_ref: F5 0.1.5-rc.1 即 npm latest，rc.2 已进入 next 通道
    implication: 升级基座应锁定 0.1.5-rc.1（与桌面内捆绑一致），且不宜写死补丁版本，rc.2 已在通道上
urls:
  - ref: https://github.com/deepseek-ai/deepseek-harness
    title: deepseek-harness（DSH 内核源码仓）
    summary: 支撑内核包清单、tag/commit 级差分与导出符号比对（tag dsh-v0.1.2-rc.1 对 dsh-v0.1.5-rc.1）；仓库无 CHANGELOG，不提供官方变更说明，运行行为不在覆盖内
  - ref: https://github.com/anywhere-labs/dsh-desktop/releases/tag/v2.0.9
    title: DSH Desktop v2.0.9 发布页
    summary: 支撑桌面壳版本与发布时点、以及『社区维护、非 DeepSeek 官方产品』声明；只描述壳层改动，不含内核包级变更
  - ref: https://www.npmjs.com/package/@deepseek-ai/dsh
    title: "@deepseek-ai/dsh（npm 包页）"
    summary: 支撑内核公开发布版本史与 dist-tags（latest=0.1.5-rc.1 / next=0.1.5-rc.2 / alpha=0.1.5-alpha.2）
object_uid: 6c81daa2-924d-4ea5-8b4f-4147a9a5af84
fact_type_key: research
created_at: 2026-09-10T15:21:27.162Z
change_log:
  - at: 2026-09-10T15:21:27.162Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 受控创建 Research 对象
---

## 研究问题

DSH 内核从 0.1.2-rc.1 到 0.1.5-rc.1 有哪些影响家族插件对接的实质变更

本机运行的 DSH Desktop 2.0.9 所捆绑的内核已由 0.1.2-rc.1 跃迁到 0.1.5-rc.1（捆绑 234 个 `@deepseek-ai/dsh*` 包）。家族目录下 27 个项目通过 npm 依赖或运行时接入引用其中若干包，若不做对照排查，升级后会在编译期或运行期以不同方式失败。本调研回答该差量中哪些公共接口已移除或改名、哪些项目落在影响面内、以及新增了哪些可对齐的能力。

查重结论：既有对象 `research-65363842`（「DSH 0.1.2-rc.1→0.1.5-alpha.1 前瞻兼容性审计（LDVH 消费面）」）与本对象同源外部对象、同基线，但终点为 0.1.5-alpha.1（本对象终点 rc.1 比其多 279 个提交、含 alpha.2 与 rc.1 两次发布），且其消费者面为 LDVH 单一项目的第 0-1 波建造决定，本对象为家族全体项目的对接面。按 24 §6「调研问题实质变化、或外部对象版本发生足以改变结论的重大变化时新建对象」，本对象新建而非更新原对象；原对象在其问题范围内仍为当前依据，本对象不处置其状态。

## 输入与边界

输入来源分工与限制：

- `https://github.com/deepseek-ai/deepseek-harness`：本对象全部内核侧发现的来源。用于 `dsh-v0.1.2-rc.1` 与 `dsh-v0.1.5-rc.1` 两个 tag 的提交/文件/包清单差分，以及各包 `src/index.ts` 导出符号集合比对。限制：仓库无 CHANGELOG 或官方变更说明，结论全部由机械差分得出，无官方文本可对照。
- `https://github.com/anywhere-labs/dsh-desktop/releases/tag/v2.0.9`：用于确认桌面壳版本与发布时点、以及项目定位声明（社区维护、非官方产品）。限制：只覆盖壳层，不描述内核包级变更。
- `https://www.npmjs.com/package/@deepseek-ai/dsh`：用于确认内核的公开版本史与 dist-tags（经 registry 读取）。限制：只给版本与标签，不给变更内容。

观察时点与版本：2026-09-10 23:00-23:20 CST；本地内核仓库已 fetch 全部 tag 并切换至 `dsh-v0.1.5-rc.1`（HEAD `183f08e9c6`）；基线 `dsh-v0.1.2-rc.1`。

分析方法：git 两 tag 差分（提交/文件/行）；`packages/*/*/package.json` 清单逐包读取比对；各包 `src/index.ts` 导出标识符集合差分（脚本机械提取，含 `export {...}` 与 `export default`，`export * from` 单独计数）；`!` 破坏性标记检索；家族依赖扫描。

**家族依赖扫描为本地机械分析，不是外部来源**：扫描 `~/DshProject/*`（含二层）各项目 package.json 的 dependencies/peerDependencies/devDependencies，命中本次受影响包的共 27 个项目。该扫描结果用于界定影响面与排序，其本身不作为外部证据。

不覆盖范围：未对任何家族项目执行编译或测试；未含 rc.1→rc.2 差异；导出差分不覆盖非 `src/index.ts` 入口与传递导出；未核对改名类变更的签名等价性（见「未证实与缺口」）。

## 关键发现

### F1 会话持久化改为句柄化接缝，locate/readRaw/DSH_SESSION_JSONL 已移除

会话持久化接缝改为 `create/open/stat/list` 返回每会话 `SessionHandle`（`read/append/flush/close`），所有日志读写经所属句柄。提交信息逐一列举被移除的既有表面：服务方法 `locate`/`readRaw`/`supportsRawArtifacts`、旧事件形状的读取迁移、**zstd 撕裂帧抢救（改为撕裂末帧整体丢弃）**、**环境变量 `DSH_SESSION_JSONL`**、hook 的 `transcript_path` 填充。同一包导出面减少 11 个（`PersistenceBackend`/`PersistenceCoordinator` 等）、新增 21 个（`SessionHandle`/`SessionAccess`/各类 `SessionHandle*Error`）。

家族价值判断：这是本次跃迁中影响面最大的一条——凡「绕过服务按路径直读会话日志」的实现都被切断，而本机已观察到同会话内 `DSH_SESSION_JSONL` 由可用变为 undefined，与该移除一致。对 LDVH 尤其直接：其 `session-signature` 正依赖 `locate()` 取路径、`zstd-compat` 正实现撕裂帧兼容，三者同时命中。

溯源：https://github.com/deepseek-ai/deepseek-harness（commit bec6805d6a 提交信息；packages/session/session-persistence 导出面差分）

### F2 会话格式升至 v3，并随发布引入 v0→v1→v2→v3 迁移链

`packages/core/session/src/types.ts:88` 定义 `SESSION_FORMAT_VERSION = 3`，读取侧按 `header.version` 校验、不匹配即报错。同期新增 5 个包承载流式迁移：`dsh-session-format`（迁移机制）、`-catalog`（构建期静态编解码与迁移目录）、`-v0-to-v1`、`-v1-to-v2`、`-v2-to-v3`。两个 `feat(session)!` 提交分别引入「assistant 流内嵌进 v2」与「已发布格式迁移」。

家族价值判断：会话日志消费方从此面对一个带版本号与迁移链的格式，历史会话需经迁移链消费，不能再按旧结构直读；这使「读会话日志」从稳定接口变成需要跟随格式版本的接口，家族中会话分析类插件应把它当作版本敏感面登记。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.5-rc.1；packages/core/session/src/types.ts:88；packages/session/session-format-v0-to-v1 … -v2-to-v3）

### F3 PERSONA_SECTION 更名为 PERSONA_PREFIX_SECTION/PERSONA_SUFFIX_SECTION 且段 key 变更

`packages/core/system-prompt/src/index.ts:174,177` 定义 `PERSONA_PREFIX_SECTION = 'deployment:persona-prefix'` 与 `PERSONA_SUFFIX_SECTION = 'deployment:persona-suffix'`；两 tag 比对显示原 `PERSONA_SECTION` 已不存在（`dsh-persona` 与 `dsh-system-prompt` 两包同步减少该导出、各新增两个新常量）。

家族价值判断：这是「名字变了、值也变了」的双重变更——按常量导入的项目会在编译期失败（易发现），而按段 key 字符串（旧 `deployment:persona`）匹配或注入的项目会在运行期静默失效（难发现）。后者是本次最易漏的一类破坏。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.5-rc.1；packages/core/system-prompt/src/index.ts:174,177）

### F4 12 个包导出符号减少，18 个新包补齐资源协议与文件交付能力

包清单：`packages/` 下 package.json 由 256 增至 274（`@deepseek-ai/dsh*` 249→267），**新增 18、移除 0**。导出面减少的 12 个包为 `dsh-session-persistence`(−11)、`dsh-message-feedback`(−8)、`dsh-app-boot`(−4)、`dsh-session`(−4)、`dsh-typert-protocol`(−2)，以及 `dsh-attachment`/`dsh-persona`/`dsh-system-prompt`/`dsh-client-ui-primitives`/`dsh-session-snapshot`/`dsh-session-persistence-jsonl`/`dsh-subagent` 各 −1。新增包中 `dsh-tool-present`（显式文件交付声明）、`dsh-client-resources` + `dsh-api-workspace-files`（统一 Client 资源协议）、`dsh-client-file-upload`、`dsh-client-ui-dockkit`/`-sidebar-*`、`dsh-http-proxy`、`dsh-chunked-list`、`dsh-package-manifest` 等在列。

家族价值判断：移除项（`dsh-session` 的 `ChunkRow`/`StorageRecord`/`decodeStorageRecord`/`packChunkRuns`、`dsh-subagent` 的 `seedDescriptorTurn`、`dsh-client-ui-primitives` 的 `MessageText` 等）是编译期硬失败，可机械排查；新增包则给出家族可对齐的新承载（交付声明、资源协议、代理策略），属可选升级项而非义务。

溯源：https://github.com/deepseek-ai/deepseek-harness（tag dsh-v0.1.2-rc.1 与 dsh-v0.1.5-rc.1 的 packages/*/*/package.json 清单与各包 src/index.ts 导出集合差分）

### F5 0.1.5-rc.1 即 npm latest，rc.2 已进入 next 通道

npm dist-tags：`latest=0.1.5-rc.1`、`next=0.1.5-rc.2`、`alpha=0.1.5-alpha.2`；公开版本史显示 0.1.2-rc.1 之后依次为 0.1.3-alpha.2、0.1.5-alpha.1、0.1.5-alpha.2、0.1.5-rc.1、0.1.5-rc.2——**无 0.1.4 版本线，0.1.3 只出到 alpha**。

家族价值判断：桌面内捆绑的正是 `latest` 标签版本，说明家族面对的不是过期快照而是当前发布通道；同时也意味着 rc.2 已在 next 上，任何写死补丁版本或假定「rc.1 是终点」的依赖声明都应避免。

溯源：https://www.npmjs.com/package/@deepseek-ai/dsh（dist-tags 与 versions 列表）

## 未证实与缺口

未证实：

- `dsh-attachment` 的 `admitPromptContent` → `admitEncodedFile` 等 7 个新导出的等价性未核对：仅做符号集合差分，未比对函数签名与语义；命名差异较大，可能是准入通道拆分而非等价改名。
- `dsh-message-feedback` 减少的 8 个符号的替代来源未验证：同期 `dsh-command-feedback` 新增 `SessionFeedbackService`/`FEEDBACK_CATEGORIES`，时间上吻合，但未逐一核对符号对应关系。

缺口：

- 导出符号差分只取各包 `src/index.ts`，未覆盖其他 entry 文件与 `export * from` 的传递导出；未打 `!` 标记的破坏性变更可能存在（medium；阻塞范围：破坏项清单的完备性——清单可用于逐项对照排查，不能作为「除此之外无破坏」的证明）。
- 未对任何家族项目执行真实编译或测试，全部破坏项均为机械差分推断（medium；阻塞范围：「某项目已确定无法构建或运行」类结论）。
- 未含 0.1.5-rc.1 → 0.1.5-rc.2 的差异（low）。

## 建议

A1 家族受影响项目按本清单做一次机械排查并就各自结论留痕：重点为改走会话句柄（F1）、persona 段改名与新 key（F3）、替换已移除导出（F4）。目标对象类型：各项目自身的 WorkCase。预期目标：每个引用受影响包的项目获得「受否受影响 + 如何改」的结论。验收条件：每个项目至少完成一次构建或加载运行，且受影响项有对应改动或明确的「不适用」判断。创建/更新判断：单个项目涉及多处改动时创建该项目的 WorkCase，而非在本对象上继续追加。判断依据：F1/F3/F4。

A2 LDVH 本项目优先处理会话日志读取两处：`plugin/lib/session-signature.js`（`locate()` 取路径已移除）与 `plugin/lib/zstd-compat.js`（撕裂帧语义已改为整体丢弃）。目标对象类型：dsh-ldvh 的 WorkCase。预期目标：在 0.1.5-rc.1 上仍能取得会话路由签名。验收条件：插件在 0.1.5-rc.1 运行时成功取到 provider/model 签名，且不再依赖 `DSH_SESSION_JSONL`。判断依据：F1/F2。

A3 把「升级前留存内核包清单快照」做成可复用做法：本次因上一版 app.asar 未留存而无法给出包级增删（只能给计数），下次升级前先落一份包清单。目标对象类型：流程改进（可入 ADR 或 WorkCase）。预期目标：任何一次内核跃迁都能给出包级差分。验收条件：下一次内核升级前存在可对照的上一版包清单。判断依据：F4 与 gaps（包清单为本清单基础）。

A4 家族依赖声明对齐运行时捆绑子集：桌面应用只捆绑 267 个 `dsh*` 包中的 234 个（testkit/仅测试包不在内），各项目应确认自己声明的依赖落在捆绑子集内，避免声明了运行时并不存在的包。目标对象类型：各项目依赖声明修订。预期目标：声明依赖与运行时可用集一致。验收条件：项目声明的 dsh 包全部可在应用捆绑集内找到。判断依据：F5 与输入与边界中的口径说明。

A5 依赖声明避免写死补丁版本：鉴于 rc.2 已在 next、且历史版本线存在跳版（无 0.1.4），按范围声明而非精确锁定。目标对象类型：各项目 package.json。预期目标：升级时不需要逐包改版本号。验收条件：依赖声明使用范围或不得低于某版本。判断依据：F5。若判定为无需对象化，则依据是本条属包管理惯例、可由各项目自行落实，后续监测条件为某项目因写死版本导致升级受阻时再对象化。

## 后续分流

- A1 → 各家族项目工作线（WorkCase）；信号：某项目升级到 0.1.5-rc.1 后构建或加载失败，或该项目启动升级动作时。
- A2 → dsh-ldvh 工作线（WorkCase）；信号：LDVH 插件在 0.1.5-rc.1 上取不到会话路由签名，或本轮升级动工。
- A3 → 流程/工具改进（ADR 或 WorkCase）；信号：下一次内核升级前，或再次出现「无上一版可比对」的情况时。
- A4 → 各项目依赖声明核对；信号：项目声明或审查依赖范围时。
- A5 → 各项目 package.json；信号：某项目因写死版本导致升级受阻时（否则无需对象化）。
- 与既有 Research `research-65363842`（0.1.2-rc.1→0.1.5-alpha.1 LDVH 消费面）的关系：同源外部对象、同基线、不同终点与不同消费者面；本对象不替代其结论，其在其问题范围内（LDVH 消费面与第 0-1 波建造决定）仍为当前依据，消费时应按各自终点取用。
- 监测条件：0.1.5-rc.2 或后续版本发布、桌面壳捆绑内核再次跃迁、或任一家族项目完成实际升级验证并有反例时，须刷新本对象或新建。
- 未决：`dsh-attachment` 与 `dsh-message-feedback` 两处改名/替代的等价性（见未证实）在任一项目实际编译触及时，应升级为缺口并补核对。
