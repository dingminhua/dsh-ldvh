# Changelog

All notable changes to this project will be documented in this file.

The format follows Keep a Changelog. This changelog records only implemented and committed scope; it does not announce unfinished roadmap items as delivered features. Entries are release-level summaries by subsystem — the commit-by-commit record lives in the git history.

## [Unreleased]

（尚未封存新的发布版本；本节留空占位。）

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
