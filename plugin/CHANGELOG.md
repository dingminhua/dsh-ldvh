# Changelog

All notable changes to this project will be documented in this file.

The format follows Keep a Changelog. This changelog records only implemented and committed scope; it does not announce unfinished roadmap items as delivered features. Entries are release-level summaries by subsystem — the commit-by-commit record lives in the git history.

## [Unreleased]

（尚未封存新的发布版本；本节留空占位。）

## [2.0.6] — 2026-11-27

两处修复与一处流程工具改进。

### Fixed

- **宿主换代后旧 Git Hook 因「假 managed」逃过自动修复**：`hook-manager.js` 的 `inspectOneHook` 在 digest 与版本校验之后，新增 hook 正文中 runner／workspace 路径的存在性校验——宿主升级或迁目录后，正文里的路径已失效但内容摘要未变，旧实现据此判为 `managed` 且不修复，Hook 实际已不可用。现判为 `outdated` 并附具体原因，由既有修复流程重写。新增 `parseHookPaths`（兼容新旧两代 hook 正文的 shell 单引号路径解析）与 `pathExists`。
- `client.js` 的 `notReadyDetail` 经 `detailText` 兜底为字符串或 `null`——`detail` 可能是对象或非字符串，直接进渲染会产出异常内容。

### Changed

- `scripts/sync-release.mjs` 退出码区分成功与中止（`0` 一致／apply 成功、`1` 检出差异、`2` 参数错误、`3` dev 已跟踪目标线专有清单、`4` target 脏且 apply 已中止）。此前 apply 成功写入与脏树中止共用 `1`，调用方无法区分「写入成功」与「什么都没做就中止」。

### Added

- `plugin/test/sync-release.test.mjs`（5 例）：检出差异、apply 成功、apply 后提交归零、脏树中止且不写入、未知参数——此前该脚本无任何测试覆盖。
- `hook-manager.test.mjs` 补 `parseHookPaths`、假 managed 判定、workspace 失效与 `installHook` 重写 4 例；`hook-repair.test.mjs` 补启动修复重写失效 runner hook 的回归测试（测试基线 2671→2676）。

## [2.0.5-dev.1] — 2026-11-27

开发迭代轮次开启：2.0.5 已封存发布，dev 线进入下一轮。

## [2.0.5] — 2026-11-27

署名校验披露取值来源与规则，新增只读查询口（issue #9）。

### Added

- 新增只读查询口 `ldvh_session_signature`：回报当前权威署名、来源事件类型与 `seq`、取值规则，并同时报出宿主通道与 shell 通道的取值及两者是否一致（`channels_agree`）——中途切换过模型的会话可直接取到权威值，不再靠试错。

### Fixed

- 署名校验不匹配时的报错补出**来源**：印出取值事件的 `eventType` 与 `seq`、以及「取会话日志中最后一条路由事件」的规则；`signature_trailer_missing` 也指向该规则与查询口，不再只说「does not match」而不给出处。代码与载体共用同一份规则文本（`ROUTE_SELECTION_RULE`）。
- 载体 `controlled-commit` 的 `message-trailer` 条目补写取值规则与查询口，与代码同步。

## [2.0.4-dev.1] — 2026-11-26

开发迭代轮次开启：2.0.4 已封存发布，dev 线进入下一轮。

## [2.0.4] — 2026-11-26

三处修复：Git Gate 二进制正文、cognition 治理错误表达、摩擦派发文案。

### Fixed

- **Git Gate 不再读取二进制正文（issue #5）**：staged diff 去掉 `--binary`——二进制正文以 base64 进 diff，10MB PDF 即撑出 12.9MB，超过 `maxBuffer` 致 pre-commit 与 commit-msg 双双失败；`git()` 的 `maxBuffer` 由 8MiB 提到 64MiB 兜住大文本文件。precheck 侧同一处 `git diff --cached` 同步修复（此前含大文件的 precheck 必报 unverifiable）。已论证 `snapshotIdentity` 区分力不受损：二进制内容虽不进 diff，git 保留的 `index <old>..<new>` 行已含 blob hash，且有端到端回归测试钉住（10MB 随机二进制、改动后快照仍变化）。
- **cognition 无管辖项目时透出可判定错误**：聚合与目标读取两处 catch 捕获 `WebGovernanceError`，返回 503 并带 `exitCode=governance_unavailable` 与底层治理原因，不再统一吞成泛化 500「Cognition aggregation failed」。
- **摩擦派发文案说清执行体工具面**：判据补「派发时须把执行体的工具面说清」——执行体只持有 `ldvh_friction_record_observation`、无 `ldvh_friction_write`，写观察／达阈值晋升／补充级更新均在同一次调用内由机制完成，结果经返回值 `promotion` 字段交回；派发文案不得要求它「登记/创建摩擦账目」，未晋升不等于执行体失败。

## [2.0.3-dev.1] — 2026-11-26

开发迭代轮次开启：2.0.3 已封存发布，dev 线进入下一轮。

## [2.0.3] — 2026-11-26

诊断页收敛与写入关卡性能优化。

### Changed

- 移除诊断页「运行痕迹」tab（`QueuePanel` 与 `queue` tab），Tab 闭集收为 gate／observations／cleanup，同步移除 `fetchQueueReport` 与 `QueueReport` 引用及失效 i18n 键（`diagnostics.tab.runs`、`diagnostics.queue.*`）。
- 日志清理清单收敛：运行痕迹（`checkpoint-runs`）退出可清理目标，只剩摩擦观察一项；随之不可达的 ring 清理分支与未使用导入一并删除。
- 摩擦观察面板的明细时间与分组时间改走 `formatTime` 本地化（跨年补年份、同年只出 `MM-DD HH:mm`），不再直出 ISO 串。

### Performance

- 写入关卡只扫描最近 **100** 个会话（按会话日志 mtime 取最新后解压解析），冷启动由 **5.8 秒降到 1.2 秒**。目录总数与已扫描数分开记账，新增 `sessionsLimited` 标记：超限时在 `scope.limits` 追加覆盖范围说明，诊断页相应卡片带提示并以警告色呈现——扫描范围有界且对使用者透明。

## [2.0.2-dev.1] — 2026-11-26

开发迭代轮次开启：2.0.2 已封存发布，dev 线进入下一轮。

## [2.0.2] — 2026-11-26

收口前复核补结论摘要机械闸，并收尾动态端口发现与 pack 门禁。

**版本档位说明（如实登记）**：本次含一处**破坏性契约变更**——`ldvh_review_ask` 的收口前（post-work）入口新增必填参数 `conclusion_summary`，缺失或超限（1–200 字符）的旧调用自此被 rejected，与 2.0.0 把 `candidate_summary` 改为必填属同构变更，按纯 SemVer 口径本应升主版本。Human 2026-11-26 决定以 `2.0.2`（PATCH）发布，特此登记档位与变更性质不符，不作掩饰。

### Added

- `ldvh_review_ask` 收口前入口新增结论摘要机械闸：`conclusion_summary` 必填、去除首尾空白后 1–200 字符，缺或超限即 rejected（不发问、不派代理、不进静默模板）；摘要写入 ask 题面（「结论摘要：…」）并参与内容指纹。与行动前 `candidate_summary` 对称，`review-ask.js` 抽出通用 `checkSummary` 供两处共用。
- `gate-consult-system-foundation` 载体补结论摘要机械闸的对称规则（含静默档口径），注入文案与工具说明同步。
- pack 门禁新增编译产物端口上报校验（`require-web-dist.mjs`），防陈旧构建产物进包。

### Fixed

- 动态端口发现改为失败不缓存、按次重试，探活确认端口已应用；跟随会话的 `src` 改为每次渲染重算，重试时重置发现状态。
- `health` 默认端口无有效值时返回 `0` 而非 `3299`，避免误报固定端口。
- 子进程端口上报改为按行缓冲解析，避免跨 chunk 截断；日志与进程退出时清理上报端口。

### Breaking

- `ldvh_review_ask` 收口前入口的 `conclusion_summary` 为**必填**——此前不带该字段的合法调用自此失败。

## [2.0.1-dev.1] — 2026-11-26

开发迭代轮次开启：2.0.1 已封存发布，dev 线进入下一轮。

## [2.0.1] — 2026-11-26

补丁发布：web-api 动态端口隔离，修复多实例端口争抢。

### Fixed

- `web/api/server.ts` 子进程改绑 OS 分配端口并经 stdout 上报实际端口，默认不再固定 3299；`web-mount.js` 解析上报端口、探活与代理改用真实端口，`ensureReady` 返回真实端口并新增 `currentPort`；`lib/index.js` 默认端口改动态、`health` 返回子进程真实端口，保留 `LDVH_WEB_API_PORT` 可强制固定端口的回退路径。新增端口回报、双实例隔离、无回报回退三例测试（测试基线 2644→2647）。

## [2.0.0-dev.1] — 2026-11-25

开发迭代轮次开启：2.0.0 已封存发布，dev 线进入下一轮。

## [2.0.0] — 2026-11-25

主版本发布：把关请示行动前新增候选摘要机械闸（契约收紧）。

### Added

- 行动前把关请示新增候选摘要机械闸：候选摘要必填、1–200 字符上限、占位文本禁令，纳入请示指纹；`gate-consult-system-foundation` 载体同步机械闸、占位禁令、指纹与静默档口径，工具面说明与注入文案同步。

### Breaking

- `ldvh_review_ask` 行动前入口对无候选摘要或超限摘要的请示直接拒绝——此前不带摘要的合法调用自此失败。机械闸 fail-closed：校验不过即拒，不降级放行。

## [1.2.0-dev.1] — 2026-11-25

开发迭代轮次开启：1.2.0 已封存发布，dev 线进入下一轮。

## [1.2.0] — 2026-11-25

次版本发布：Web 界面导航与项目范围选择改进。

### Added

- 聚焦页新增项目/分支两级选择条（`ProjectScopeBar`）：在受辖多项目间直接切换项目与分支，不必回设置页。
- 全站统一页头顶栏（`PageHeader`）：各页（Changelog、Changes、CognitionCenter、Diagnostics、GoalDetail、Help、ObjectDetail、ObjectList、ProjectFiles、FederationObjects）顶栏布局一致。
- 根 README 新增「与 AI 配合的主线」使用引导（目标 → 火花 → 调研的主线说明）与完整指南入口。

### Changed

- 项目选择条去掉选中项打勾图标（视觉收敛）；契约测试随布局统一同步更新（help-presentation、navigation-layout）。

## [1.1.6-dev.1] — 2026-11-24

开发迭代轮次开启：1.1.6 已封存发布，dev 线进入下一轮。

## [1.1.6] — 2026-11-24

补丁发布：bundle 安装死锁修复与使用指南。

### Fixed

- **bundle 安装的 Git Hook preflight 死锁（issue #7）**：`lib/git-gate-runner.js` 的 `checkLint` 原先在 eslint 缺失时返回阻塞判定、之后才判断零 lint 文件，导致 bundle 安装（插件目录无 `node_modules`、eslint 仅在 devDependencies）下 preflight 合成 index 无 lint 文件也必被拒，Hook 装不上。现把零 lint 文件跳过提前到工具检查之前——preflight 与无 lint 面文件的提交直接放行；有 lint 文件而缺 eslint 仍拒绝，保留 refuses-rather-than-skipping 决策。错误提示同步去掉无 lockfile 时不可执行的 `npm ci`，给出可执行的补齐依赖命令。

### Added

- `USAGE.md` 使用指南：Web 帮助页（`/ldvh/help`）主要内容的静态快照，按四个问题展开；仓库根 README 加使用指南入口。两者不一致时以 Web 帮助页为准。

## [1.1.5-dev.1] — 2026-11-24

开发迭代轮次开启：1.1.5 已封存发布，dev 线进入下一轮。

## [1.1.5] — 2026-11-24

正式发布版本：对外发布线封存于 `1.1.5`（已发布至 npm，`dist-tags.latest = 1.1.5`）。该版本随 dev→main 机械同步流程推进，发布线内容与 `1.1.4` 一致（逐条变更见 `1.1.4` 条目与 git 历史）；本条目据现有发布记录与 npm 实测补记，不新增未提交内容。

## [1.1.4-dev.1] — 2026-11-24

开发迭代轮次开启：1.1.4 已封存发布，dev 线进入下一轮。

### Fixed

- Web API 访问检查：`/ldvh/api` 与 `/ldvh/state` 路由接入 DSH `connection.requestRejection` 信任栅栏，未通过信任判定的请求以 401/403 就地短路（DSH GUI 已认证 peer 照常通过）；子进程直连端口对 `/api` 全路由实施本地 Host 白名单与 `Sec-Fetch-Site: cross-site` 拒绝（DNS 重绑定与跨站 CSRF 防护）。修复 awesome-dsh-plugin 收录条目上维护者标注的「HTTP 路由无 DSH 访问检查」安全告示。

### Changed

- Web 对象列表分面计数与状态术语：形态、优先级、serves 计数改按各自状态池独立计算（`formTotal`/`priorityTotal`/`servesTotal`/`statusDisplayTotal` 后端路由到前端列表全链路）；状态过滤 fallback 的 `research` 键修正为 `report`；状态术语统一 active=生效、retired=归档，并补 report 状态的本地化描述；宿主代理转发前剥离浏览器来源元数据头（`Sec-Fetch-*`/`Origin`/`Referer`），使子进程直连栅栏仅凭请求自身来源判定。

## [1.1.4] — 2026-11-24

发布线与仓库基建补丁：`plugin/lib` 源码与 1.1.3 零差异，npm 包内容变化限于判据表 bundle 与文档元数据；本条目的主要修复在仓库与发布线层面，并作为 dev→main 机械同步新流程的首次发版试点。

### Fixed

- main 发布线补回 CI 工作流并首次转绿：README 徽章自 1.0.0 起显示未通过，根因是首次同步发布树时漏搬 `.github/` 整个目录（GitHub 无 workflow 文件即不启动流水线）；测试步骤按发布规范门禁 3 分流——main 只验发布产物，全量测试在有事实源的 dev 侧执行。
- 依赖仓库语料的 25 个测试用例补 `skipWithoutCorpus` 保护：缺语料检出不再假失败，有语料环境零影响。

### Added

- CI 新增分支纪律机械检查：main 树（`git ls-tree`）与发布产物（`npm pack` 清单）均不得含事实对象目录 `ldvh-base/`。
- 版本声明点五处一致机械门禁 `scripts/require-version-consistency.mjs`：dev/release 双态校验，release 态五处任一缺失或不一致即失败，挂 `prepack` 首位自动执行。
- `scripts/sync-release.mjs`：dev→main 发布树机械同步，取代手工挑文件；`--check` 退出码 0 为同步一致判据。
- 发布规范新增分支纪律第 7 条「dev→main 同步必须机械化」与禁止项第 12 条（事实源载体，不随包分发）。

## [1.1.3] — 2026-11-23

补丁发布：纳入 1.1.2 封存后 dev 线上的在途改动——经验与摩擦判据固化为每轮固定自查、代理派后发射后不管与失败两类分类，以及注入去重。

### Added

- 经验与摩擦「当场判据」独立注入行：每轮固定自查「有无可回指材料（原文＋定位）」，有材料即当场派生零上下文代理、不预判成立、不因判不准跳过；失败按默认不放行登记并区分意外损耗与系统性故障（bug）。

### Changed

- 代理辅助任务派后改为发射后不管：回执自动到达才转告 Human，未到达不等不追、交还也不提结果未知；执行体侧失败留痕不依赖回执。
- 注入去重：召回里的 Norm 候选不再输出重复定位摘录（独立「事实规范目录」行已带全量标题与定位）；开发引导大段删除「把关请示」浓缩行，把关请示只保留独立注入行。
- 把关请示三处统一入口的三选一措辞（安排代理／主控自己做／跳过）在规范与引导各面统一。

### Known

- 真实 UI 验收（`/ldvh` 路由与 `/ldvh/api/health`）本轮未重做，单元测试通过不替代真机验收；19 项环境依赖 skip 未逐条补跑。

## [1.1.2] — 2026-11-23

补丁发布：纳入 1.1.1 封存后 dev 线上的在途改动——把关请示三处统一入口，以及经验与摩擦两类辅助记录按新定义修正代理落笔职责。

### Added

- 把关请示三处统一入口：`ldvh_review_ask` 的 `point` 闭集接纳 `research`，委托既有 `research-consult` 逻辑（内部查找＋联网提请），不再只接受行动前/收口前两处。

### Changed

- 经验侧：`pitfall-fact-type` 的 entry-channels／delegate-draft／cross-type-pairing 改为零上下文代理辅助任务执行体经受控入口落笔、写后回读、回执主控转告 Human，主控只交材料与收执；移除两处被语料校验禁止的跨载体引用。
- 摩擦侧：`friction-settlement-system-foundation` 的 discovery-trigger 补「代理落笔后回执主控、转告 Human」，落笔权本就不在主控。
- 引导行：经验主动记录引导行、设置页中英双语开关提示与开发期锚点按新定义同步。

### Known

- 真实 UI 验收（`/ldvh` 路由与 `/ldvh/api/health`）本轮未重做，单元测试通过不替代真机验收；19 项环境依赖 skip 未逐条补跑。

## [1.1.1] — 2026-11-23

补丁发布：纳入 1.1.0 封存后 dev 线上的在途改动。

### Added

- 经验与摩擦「当场判据」常驻注入行：按开关把何时该记录的判据摆到手边，不触发记录、不派发代理、不设周期或静置检查点。

### Changed

- 规范目录按承载位收敛；报告来源与召回注入细节同步。
- 两条已完结方向线（过程引导规则供给、插件内部模块边界评估）转 discarded，残留如实登记。

## [1.1.0] — 2026-11-23

架构级发布：规范源解绑完成，运行期规则只由随包 YAML 载体承载。

### Changed

- 运行期规则源统一改为随包 `plugin-specs/` 载体（19 份／524 条），`specs/` 全面退为开发需求文档、不再进入发布包。
- 运行期召回从"规范源＋事实源＋载体"三源收敛为"事实源＋运行时机制载体"两源；事实对象 F0–F4 与载体的索引→按需读条目两套渐进式读取保留。
- 工具公开操作声明与召回判据表改为构建期生成的随包数据文件，代码与能力发现只读随包那一份。
- 发布门禁第 6 项按当前情况重制：市场登记 YAML 当前未采用、截图消费格式未确认，原"市场产物一致"硬门槛不可执行，改为截图资产的声明性核对（不阻断发布）。

### Removed

- `read-specification-candidates`／`read-specification-content` 两个 L0–L4 读取工具与相关分层/披露/一致性校验；代码注释按规范全量剥离。

## [1.0.4] — 2026-11-21

补丁发布：让 GitHub 仓库地址可直接作为 DSH 插件安装源（此前只有 npm 包名可装）。

### Added

- **GitHub 仓库地址安装**：仓库根新增薄壳 `package.json`（`dsh.bundle` 指向 `./plugin/cordis.patch.yml`，入口指向 `./plugin/lib/*`），使 DSH 插件管理页填入 `https://github.com/dingminhua/dsh-ldvh` 即可安装；此前裸 git 地址因仓库根无 manifest 被判「没有声明组合包」。

### Changed

- **构建产物入库**：`web/dist`、`web/api-js`、`web/shared-js` 纳入发布树版本控制，git 安装clone 后即得到可运行包，无需在安装期执行构建脚本（避免 pnpm 对 git 依赖 prepare 脚本的审批门，`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`）。发布树放开 `.gitignore`，dev 分支保持忽略以免日常构建弄脏工作区。
- 版本声明点统一为 `1.0.4`。

## [1.0.3] — 2026-11-21

补丁发布：修复 1.0.2 默认配置下安装失败（issue #3）。

### Fixed

- **安装失败（pnpm 构建脚本审批门）**：1.0.2 为修 #2 把 `tsx` 提升为运行依赖，带入 `esbuild@0.28.2` 的 postinstall；pnpm 11 默认拒绝未审批构建脚本，`ERR_PNPM_IGNORED_BUILDS` 致安装失败并回滚到 1.0.1。本版把 `web/api` 与 `web/shared` 预编译为 `web/api-js`、`web/shared-js`（`scripts/build-api.mjs`，NodeNext ESM），子进程直接执行编译产物，`tsx` 与 `esbuild` 不再进入依赖闭包——allowBuilds 为空的干净 pnpm workspace 安装实测通过。

### Changed

- 源码 link 安装仍走 tsx 源码态并保留后端热重载；registry 安装走随包编译产物；`resolveWebApiCommand` 按 tsx 可用性选择，两种形态并存时优先源码态。
- 打包门禁更新：校验编译产物、依赖声明不含 tsx；发布门槛规范与快速开始文档同步两条后端路径。

## [1.0.2] — 2026-11-21

补丁发布：补齐 1.0.1 发布包遗漏的 Web 后端运行物（issue #2）。

### Fixed

- **Web 后端缺件**：1.0.1 仅含 `web/dist` 前端产物，缺 `web/api` 与 `web/shared` 后端源码及运行时依赖（tsx/express/cors/compression/dotenv/js-yaml），web-api 子进程以 `--import tsx api/server.ts` 启动时即失败，会话面板落到「当前不可用」兜底页；本版把 `web/api`、`web/shared` 纳入 `files`，并将 6 个运行时包提升为 plugin 的 `dependencies`。
- **打包门禁补强**：`require-web-dist.mjs` 在 `web/dist/index.html` 之外同时校验 `web/api/server.ts`、`web/shared`、运行时依赖声明与 `files` 条目，任一项缺失即 `npm pack/publish` 失败。

## [1.0.1] — 2026-11-20

补丁发布：修复 1.0.0 发布包缺少 Web SPA 静态资源的问题，并加固发布打包门禁。

### Fixed

- **Web dist 缺件**：`npm pack` 因 `plugin/web/.gitignore` 的 `dist` 规则连带排除 `web/dist`，导致 1.0.0 发布包无 Web 面板静态资源（issue #1）；新增 `plugin/web/.npmignore` 解除连带排除，发布包含 `web/dist/index.html` 等 17 个静态文件。
- **发布打包门禁**：`prepack` 串接 `scripts/require-web-dist.mjs`，`web/dist/index.html` 缺失时 `npm pack/publish` 直接失败，把人工核对变为机械门禁；发布流水线（定义在 `dev` 分支 `.github/workflows/ci.yml`）在 pack 前先构建 SPA。

### Changed

- **不兼容变更（迁移须知）**：Spark 的 `serves` 字段由可选升为全状态必填（`22 §8`，Human 决定），缺 `serves` 的 Spark 创建或更新将被拒绝。存量 Spark 若缺 `serves`，须先为其补上所服务的 SubGoal `object_uid` 再执行更新；该变更随 1.0.1 一并发布，请存量项目据此迁移。
- 测试计数守卫兼容 TAP 方言（Node 22 CI 输出 `# tests N`），判定改到 stdio 关闭后，`run-tests` 与 `affected-tests` 双入口覆盖。
- 包描述改为 `specs/00 §1` 的权威定位表述（对齐 Vibe、协调 Coding）。

## [1.0.0] — 2026-11-20

v5 重构线（自 2026-09-25 起）的发布级汇总，按子系统归纳已实现并已提交的范围；逐条变更以 git 历史为准，每条给出可回读依据。条目内容覆盖至 2026-11-20；版本号按 `specs/10 §7.1` 于 2026-11-20 从 1.0.0-dev.1 封存为正式发布版 1.0.0。

### Added

- **规范源**：根规范（`specs/00`）确立核心价值「对齐 Vibe、协调 Coding」与六条根方案；模型规范、业务系统规范、七类事实类型规范与附件全部建立并进入当前规则源（`specs/00`、`specs/01`、`specs/02`、`specs/03` 及 `specs/20`–`specs/26`）。
- **事实源**：Goal / SubGoal / Spark / Norm / Report / Pitfall / Friction 七类事实对象，各带受控写入通道与写后精确回读；Spark 与 SubGoal 另有独立的建前机械预检入口（`ldvh_spark_precheck_create`、`ldvh_subgoal_precheck_create`）；事实对象引用支持五种书写形态并解析到唯一对象（`plugin/lib/friction-tools.js`、`plugin/lib/norm-tools.js`）。
- **双源召回**：行动前从规范源与事实源召回当前相关候选，保留命中依据与未检查范围；事实规范的定位段可召回；召回预算按档位等比收敛（`specs/34`、`plugin/lib/recall-injection.js`）。
- **把关请示**：行动前与收口前两处向 Human 请示是否安排一次独立核对；第三处「遇难题：联网调查提请」先在内部事实源查找、未命中才提请联网；另设「静默执行」档位（不问、直接安排）与请示倒计时档位（`specs/32`、`plugin/lib/review-ask.js`、`plugin/lib/research-consult.js`）。
- **经验积累**：主控主动记录支线承担捕获，经验成文与入档为两通道，创建即 `active`（取消 `draft` 待确认态）；经验索引改为按需召回（`specs/25`、`specs/35`）。
- **摩擦销账**：观察先进本地缓冲，同源阻碍达阈值晋升为待修账目；`accepted` 命中递增计数但仍不记录不报告；补终态事实更正通道，使销错的账可改（`specs/26`、`specs/36`）。
- **调研吸收**：围绕主控不掌握的问题取证，直到不再产生新的确认认识；补终态事实更正的受控工具面（`specs/33`、`specs/24`）。
- **目标规划**：Goal 与 SubGoal 两级，达成条件可判定并声明证明方式（`specs/20`、`specs/21`、`specs/30`）。
- **宿主契约差分**：把上游 DSH 的服务/事件/槽位/类型差分做成可重复运行的三通道差分器，并维护本插件的消费面清单（`plugin/scripts/host-contract-diff.mjs`、`plugin/lib/host-contract-catalog.js`）。
- **插件面**：Host 侧 `/ldvh` 与 `/ldvh/api` 路由（`plugin/lib/web-mount.js`）；管辖项目的登记、安装、检查、卸载与取消管辖；Git Gate（受管 `commit-msg` 与 `pre-commit` 两枚 Hook，`plugin/lib/hook-manager.js`）；设置页一节 `Settings → LDVH`（`plugin/lib/client.js`）；LDVH 会话视图；LDVH Web SPA（聚焦 / 火花 / 规范 / 报告 / 经验 / 摩擦 / 目录 / 变更 / 提交 / 帮助 / 诊断，`plugin/web/src/pages/`）；`ldvh_*` 工具面（主控会话可调用 36 个，另有 1 个仅在子代理面注册；`plugin/lib/ldvh-tools.js` 与各 `*-tools.js`）；AI 工作引导与最小规则集注入。

### Changed

- 引导面与召回预算分离：管辖判定、最小规则引导与规范目录为固定内容，不占召回预算；规范目录改为独立一行注入（`plugin/lib/guidance-budget.js`、`plugin/lib/recall-injection.js`）。
- 工具描述补齐各 action 的必填参数组合，减少「调用方事先无从得知」类失败；`ldvh_discover_capabilities` 覆盖全部 LDVH 能力，并为各承载规范补公开操作声明（`plugin/lib/ldvh-tools.js`）。
- Web 呈现：子目标呈现「火花落实」比值（`plugin/web/src/components/SubGoalCardParts.tsx`）；事实对象的呈现与筛选随各类型规范的演进同步调整（`plugin/web/src/`）。

### Fixed

- 提问卡 DOM 结构变化（宿主 `0.2.2-rc.1`，即 `0.2.1-rc.5`→`0.2.2-rc.1` 区间的首个破坏面之一）导致的双边框与选中态错位：改为外层行承接外观、内层按钮退为内容盒，并补两条机械守卫（`plugin/lib/client.js`）。
- `schedule` 服务重建（同一 `0.2.2-rc.1` 区间）导致的调用形状变化：工具描述与清理指引同步为新形状（`plugin/lib/ldvh-tools.js`、`plugin/lib/host-automation-probe.js`）。
- Windows 三项平台缺陷：Git 路径转义、`fs.watch` 短名、测试强制退出（`plugin/lib/` 与 `plugin/test/` 的 win32 分支）。
- 闲时辅助适配宿主 `subagents.startActivation` 的形状变化（`3f4e78a0`；该机制随后随审核层撤除，见 `ddae5f72`）。
- 摩擦子面工具因缺 output 契约从未挂载（`plugin/lib/friction-tools.js`）。
- 测试条数守卫补 skip 对账，避免以跳过替代通过结论（`plugin/lib/test-run-report.js`）。

### Removed

- DevLog 事实类型及其 Web 呈现栈撤除（规范层 `aeb5cb7b`、代码层 `6c1b15e3`、Web 残留 `2a0c635f`）。
- 诊断页「经验观察」页签与相关后端接口撤除（`9017d6d1`）。
- WorkCase / 工单类型及其 56 个存量载体撤除（`refactor(plugin): 删除 WorkCase 代码层与 56 个存量载体`）。
- ADR 事实类型的规范层承载撤除（`refactor(adr): 撤除 ADR 事实类型的规范层承载`）。
- 自建管辖判定行撤除，交还宿主原生 Context 行（`c2b47d3f`）。
- 待处置队列删除，代理辅助任务的失败改由当次回执与运行痕迹承载（`921a1466`）。
- 经验留观缓冲与经验候选的机械通道（含审核段）取消（`ddae5f72`）。
- AGENTS.md 指针有效性机械校验曾接入（`8f798371`），随 `AGENTS.md` 撤销而一并撤除（`9deb33a1`）。

### Known

- 正式发布版 1.0.0。
- 真实 UI 验收按 2026-11-19 的 Human 决定收为两项（`/ldvh` 路由与 `/ldvh/api/health` 健康检查），二者均已取得本机实证；设置卡片、会话视图、停用与重启、卸载清理四项移出验收范围（依据载体：`ldvh-base/norms/norm-a1b559a6-6c13-494b-974a-a9368686bc7b.md`）。
- Windows 真机验证覆盖管辖项目生命周期 10 项与权限判据（2026-11-10 实测），但该验收结论此后代码有变动、未在当前代码上重验；UNC / junction、NTFS 占用竞争、ACL 读不到的构造场景未覆盖，不得据此认为 Windows 已完整验收通过。
- Linux 仅由 CI 覆盖，无真机验收，不在支持声明内。
- 提问卡观感覆写的真机观感自 `0.2.1-rc.2` 后未在 `0.2.2-rc.5` 上取得样本：结构前提不变，但不得以静态核对充抵真机验收。

## [1.0.0-dev.1] — 2026-09-25

v5 重构线（自 2026-09-25 起）的发布级汇总，按子系统归纳已实现并已提交的范围；逐条变更以 git 历史为准，每条给出可回读依据。条目日期沿用 1.0.0-dev.1 的形成日（2026-09-25），内容覆盖至 2026-11-19；版本号于 2026-10-02 按 `specs/10 §7.1` 定为 dev.1。

### Added

- **规范源**：根规范（`specs/00`）确立核心价值「对齐 Vibe、协调 Coding」与六条根方案；模型规范、业务系统规范、七类事实类型规范与附件全部建立并进入当前规则源（`specs/00`、`specs/01`、`specs/02`、`specs/03` 及 `specs/20`–`specs/26`）。
- **事实源**：Goal / SubGoal / Spark / Norm / Report / Pitfall / Friction 七类事实对象，各带受控写入通道与写后精确回读；Spark 与 SubGoal 另有独立的建前机械预检入口（`ldvh_spark_precheck_create`、`ldvh_subgoal_precheck_create`）；事实对象引用支持五种书写形态并解析到唯一对象（`plugin/lib/friction-tools.js`、`plugin/lib/norm-tools.js`）。
- **双源召回**：行动前从规范源与事实源召回当前相关候选，保留命中依据与未检查范围；事实规范的定位段可召回；召回预算按档位等比收敛（`specs/34`、`plugin/lib/recall-injection.js`）。
- **把关请示**：行动前与收口前两处向 Human 请示是否安排一次独立核对；第三处「遇难题：联网调查提请」先在内部事实源查找、未命中才提请联网；另设「静默执行」档位（不问、直接安排）与请示倒计时档位（`specs/32`、`plugin/lib/review-ask.js`、`plugin/lib/research-consult.js`）。
- **经验积累**：主控主动记录支线承担捕获，经验成文与入档为两通道，创建即 `active`（取消 `draft` 待确认态）；经验索引改为按需召回（`specs/25`、`specs/35`）。
- **摩擦销账**：观察先进本地缓冲，同源阻碍达阈值晋升为待修账目；`accepted` 命中递增计数但仍不记录不报告；补终态事实更正通道，使销错的账可改（`specs/26`、`specs/36`）。
- **调研吸收**：围绕主控不掌握的问题取证，直到不再产生新的确认认识；补终态事实更正的受控工具面（`specs/33`、`specs/24`）。
- **目标规划**：Goal 与 SubGoal 两级，达成条件可判定并声明证明方式（`specs/20`、`specs/21`、`specs/30`）。
- **宿主契约差分**：把上游 DSH 的服务/事件/槽位/类型差分做成可重复运行的三通道差分器，并维护本插件的消费面清单（`plugin/scripts/host-contract-diff.mjs`、`plugin/lib/host-contract-catalog.js`）。
- **插件面**：Host 侧 `/ldvh` 与 `/ldvh/api` 路由（`plugin/lib/web-mount.js`）；管辖项目的登记、安装、检查、卸载与取消管辖；Git Gate（受管 `commit-msg` 与 `pre-commit` 两枚 Hook，`plugin/lib/hook-manager.js`）；设置页一节 `Settings → LDVH`（`plugin/lib/client.js`）；LDVH 会话视图；LDVH Web SPA（聚焦 / 火花 / 规范 / 报告 / 经验 / 摩擦 / 目录 / 变更 / 提交 / 帮助 / 诊断，`plugin/web/src/pages/`）；`ldvh_*` 工具面（主控会话可调用 36 个，另有 1 个仅在子代理面注册；`plugin/lib/ldvh-tools.js` 与各 `*-tools.js`）；AI 工作引导与最小规则集注入。

### Changed

- 引导面与召回预算分离：管辖判定、最小规则引导与规范目录为固定内容，不占召回预算；规范目录改为独立一行注入（`plugin/lib/guidance-budget.js`、`plugin/lib/recall-injection.js`）。
- 工具描述补齐各 action 的必填参数组合，减少「调用方事先无从得知」类失败；`ldvh_discover_capabilities` 覆盖全部 LDVH 能力，并为各承载规范补公开操作声明（`plugin/lib/ldvh-tools.js`）。
- Web 呈现：子目标呈现「火花落实」比值（`plugin/web/src/components/SubGoalCardParts.tsx`）；事实对象的呈现与筛选随各类型规范的演进同步调整（`plugin/web/src/`）。

### Fixed

- 提问卡 DOM 结构变化（宿主 `0.2.2-rc.1`，即 `0.2.1-rc.5`→`0.2.2-rc.1` 区间的首个破坏面之一）导致的双边框与选中态错位：改为外层行承接外观、内层按钮退为内容盒，并补两条机械守卫（`plugin/lib/client.js`）。
- `schedule` 服务重建（同一 `0.2.2-rc.1` 区间）导致的调用形状变化：工具描述与清理指引同步为新形状（`plugin/lib/ldvh-tools.js`、`plugin/lib/host-automation-probe.js`）。
- Windows 三项平台缺陷：Git 路径转义、`fs.watch` 短名、测试强制退出（`plugin/lib/` 与 `plugin/test/` 的 win32 分支）。
- 闲时辅助适配宿主 `subagents.startActivation` 的形状变化（`3f4e78a0`；该机制随后随审核层撤除，见 `ddae5f72`）。
- 摩擦子面工具因缺 output 契约从未挂载（`plugin/lib/friction-tools.js`）。
- 测试条数守卫补 skip 对账，避免以跳过替代通过结论（`plugin/lib/test-run-report.js`）。

### Removed

- DevLog 事实类型及其 Web 呈现栈撤除（规范层 `aeb5cb7b`、代码层 `6c1b15e3`、Web 残留 `2a0c635f`）。
- 诊断页「经验观察」页签与相关后端接口撤除（`9017d6d1`）。
- WorkCase / 工单类型及其 56 个存量载体撤除（`refactor(plugin): 删除 WorkCase 代码层与 56 个存量载体`）。
- ADR 事实类型的规范层承载撤除（`refactor(adr): 撤除 ADR 事实类型的规范层承载`）。
- 自建管辖判定行撤除，交还宿主原生 Context 行（`c2b47d3f`）。
- 待处置队列删除，代理辅助任务的失败改由当次回执与运行痕迹承载（`921a1466`）。
- 经验留观缓冲与经验候选的机械通道（含审核段）取消（`ddae5f72`）。
- AGENTS.md 指针有效性机械校验曾接入（`8f798371`），随 `AGENTS.md` 撤销而一并撤除（`9deb33a1`）。

### Known

- 尚未发布正式版本，`1.0.0-dev.1` 为开发预览。
- 真实 UI 验收按 2026-11-19 的 Human 决定收为两项（`/ldvh` 路由与 `/ldvh/api/health` 健康检查），二者均已取得本机实证；设置卡片、会话视图、停用与重启、卸载清理四项移出验收范围（依据载体：`ldvh-base/norms/norm-a1b559a6-6c13-494b-974a-a9368686bc7b.md`）。
- Windows 真机验证覆盖管辖项目生命周期 10 项与权限判据（2026-11-10 实测），但该验收结论此后代码有变动、未在当前代码上重验；UNC / junction、NTFS 占用竞争、ACL 读不到的构造场景未覆盖，不得据此认为 Windows 已完整验收通过。
- Linux 仅由 CI 覆盖，无真机验收，不在支持声明内。
- 提问卡观感覆写的真机观感自 `0.2.1-rc.2` 后未在 `0.2.2-rc.5` 上取得样本：结构前提不变，但不得以静态核对充抵真机验收。
