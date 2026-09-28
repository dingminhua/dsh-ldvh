# Changelog

All notable changes to this project will be documented in this file.

The format follows Keep a Changelog. This development changelog records only implemented and committed scope; it does not announce unfinished roadmap items as delivered features.

## [Unreleased]

### Changed

- **宿主兼容声明推进至覆盖 `0.2.x`（Human 决定）**：`peerDependencies` 三条 dsh 包的上界由 `>=0.1.7-rc.1 <0.2.0` 推进为 `>=0.1.7-rc.1 <0.3.0`，`devDependencies` 的 `dsh-llm` / `dsh-sandbox` / `dsh-scope` / `dsh-tools` 由 `0.1.7-rc.2` 升至 `0.2.0-rc.1`（`package-lock.json` 同步）；README 中英双版的宿主兼容段同步更新。机械依据：`0.2.0-rc.1` 相对 `0.1.7-rc.2` 无契约破坏——服务 89→91（新增 `otel` / `productAnalytics`，**删除 0**）、事件 81→81（**零变化**）、客户端槽位条目 89→89（**零增删**）、模型可见工具**零变化**、包集合 321→325（**零删除零改名**）；本插件消费的主机侧 11 个宿主服务（`agents` / `commands` / `dshHomePath` / `fs` / `invariants` / `sessionPersistence` / `tools` / `userQuestions` / `systemPrompt` / `webServer` / `connection`）与八个事件（`agent/created`、`agent/pre-step`、`agent/turn-stopping`、`fs/edit-intent`、`fs/observed`、`fs/write-intent`、`session/event`、`system-prompt/assemble`）的 mode 与签名**逐字未变**（`dshHomePath` 经 `ctx.provide` 提供，其所在的 `packages/boot/app-boot/src/index.ts` 两版 blob 全等；其余 10 个均不在本区间的服务变更集内——该集合唯一变更是 `deepseekAccount`，本插件不消费）；两个 `dependencies` 的 src 零改动。上界取 `<0.3.0` 而非 `<0.2.1` 是为覆盖整个 `0.2.x` 线；经宿主自带 semver 7.8.5 以 `includePrerelease: true` 实跑确认：`0.2.0-rc.1` 与 `0.2.0` 匹配、`0.3.0` 不匹配。**如实登记的取舍**：在宿主该判定语义下 `<0.3.0` 亦会接纳 `0.3.0` 的预发布版（`0.3.0-0` / `0.3.0-rc.1` 实测均为 `true`）；若须严格止于 `0.2.x`，`<0.3.0-0` 是更紧的写法。此处选择较宽的上界，是因为本区间的教训正是「上界过紧会让可用的宿主被门禁拒收」，故宁可让 0.3 线预发布版通过、由 0.3 线自身的契约复核负责收紧。依据：Research 对象 `2772f0d3-9b5c-44c9-b666-4f89593b629a`（DSH 0.1.7-rc.2→0.2.0-rc.1 变更调研）。
- **DSH 宿主基线推进至 `0.1.7-rc.2`**：开发目标环境登记值由 `DSH Desktop 2.0.14-next / @deepseek-ai/dsh 0.1.7-rc.1` 更新为 `2.0.15-next / 0.1.7-rc.2`（README.md 与 README.en.md 同步）。机械依据：本机 `/Applications/DSH NEXT.app` 壳版本 `2.0.15-next`，其 `package.json` 声明 153 个 `@deepseek-ai/dsh*` 依赖，`Resources/app/node_modules/@deepseek-ai` 下实测 275 个 `dsh*` 包版本**全部**为 `0.1.7-rc.2`。依据：`docs/dsh-0.1.7-rc1-to-0.1.7-rc2-research.md`。
- **`0.1.7-rc.2` 无需契约适配**（该区间为契约只增不改）：服务 88→89（仅新增 `schedule`，删除 0）、事件 77→81（新增 4 项全为 `emit`，删除 0、既有 mode 零变化）、客户端槽位 86→89（新增 3 项，删除 0）、模型可见 Tool 零删除。本插件消费的 12 个宿主服务、8 个事件与 `conversation.chat.node` / `conversation.view` 两槽位在该区间全部保持；`tools.guard` 与 `tools.register` 形态未变。
- **开发工具链对齐 `0.1.7-rc.2`**：devDependencies 的 `dsh-tools` / `dsh-scope` / `dsh-llm` / `dsh-sandbox` 由 `0.1.7-rc.1` 升至 `0.1.7-rc.2`，`package-lock.json` 同步（含传递依赖 `dsh-brand` / `dsh-timeout` / `dsh-typert-protocol` / `dsh-util-crypto` / `dsh-util-values`）。`peerDependencies` 维持 `>=0.1.7-rc.1 <0.2.0`——该范围本已覆盖 rc.2，无需改动。验证：`npm --prefix plugin ci` 退出码 0；测试 933/933 通过、0 失败、0 跳过。
- **撤回「为审批面补 `displayReason`」评估项**：rc.2 新增的 `PreToolDecision.ask.displayReason` 由 `tools/pre-execute` 事件返回，而本插件消费的是 `tools.guard`——其契约是返回**纯字符串**拒绝理由（`packages/core/tools/src/index.ts` 的 `guardReason(exec): string | undefined`），拿不到结构化载荷。两者不是同一条缝，该增强在本插件当前形态下不适用。

### Known

- **平台支持范围已声明（macOS 与 Windows）**：README（中英双版）新增「平台支持 / Platform support」节，把 macOS 与 Windows 登记为**声明的支持平台**，并如实标注 Windows **未在真实 Windows 主机验证（`unverified`）**、Linux 不在支持声明内。本次同时修正该声明的上游代码缺陷：`lib/governance-scope.js` 的包含判定原以硬编码 `/` 拼接根路径，而 `realpath` 返回宿主原生分隔符（win32 为 `\`），win32 下 `C:\repo/` 永不匹配 `C:\repo\sub`——直接包含热路径被架空，每个子目录退化为 Git common-dir 子进程回查。现改为按宿主平台路径语义判定（`path.relative`），并注入 `pathImpl` 使两个平台的真值表可在任一宿主上机械验证；`test/governance-scope.test.mjs` 新增两条跨平台守卫。验证：测试 935/935 通过（原 933）。
- **win32 无自动化验证背书（如实登记）**：CI 两个 job 均运行于 `ubuntu-latest`，win32 分支不经 CI 执行；全套测试中 4 处断言在 win32 上早退（`plugin/test/` 3 处依赖 POSIX 权限语义：`closure-items.test.mjs` 2 处、`goal-writer.test.mjs` 1 处；`plugin/web/tests/api/truthful-reading-projection.test.ts` 1 处依赖可执行位）。该范围与 README「平台支持」节同源登记，**不得据「已实现」主张 Windows 已验收**。
- **README「当前已实现／尚未实现」段按实际对齐**：原段仍称管辖项目管理与 v4 Git Gate validator「尚未实现」、v4 Web「仍在迁移」，与本变更日志的 Added 段及实际代码不符（该段早于实现落地，未随实现同步）。现按实际登记；未完成项收敛为「真实 UI 验收四项未核对」「正式市场截图与发布版本」「Windows 真机验收」。
- **`dsh-atomic-write` 锁接管的部署约束**：`0.1.7-rc.2` 起该包新增「已退出持有者锁接管」——锁文件记录 `<pid>`，持有者进程被证明不存在（`ESRCH`）时接管锁。本插件的 `lib/governed-projects.js` 经 `withFileLock` / `writeFileAtomic` 消费它，但**只写管辖登记载体**（`$DSH_HOME/ldvh/governed-projects.yaml`）；事实源 `ldvh-base/` 不经该包——各 fact writer 自带无锁原子替换（`writeFile` + 回读校验 + `rename`）。该实现的 PID 比较在**竞争者主机上**进行，官方明确「不支持跨宿主或跨 PID namespace 共享同一文件」（`packages/util/atomic-write/src/index.ts`）。故**登记载体所在的 DSH 用户配置根**不得置于网络文件系统或跨 PID namespace 的共享卷；当前单机单 PID namespace 部署不触发该边界，部署形态改变时须重评。
- **未声明「已验证支持 `0.1.7-rc.2`」**：按 `specs/08` §8 与 `local-dev-workflow` 红线 3，支持声明须以真实 UI 验收六项全项完成为前提；`/ldvh` 与 `/ldvh/api/health` 已实证，设置卡片、会话视图、停用与重启、卸载清理四项尚未核对。
- **兼容声明推进 ≠ 已验证支持 `0.2.0-rc.1`（本次推进的边界）**：上条推进的是**声明范围**，其主要依据是同区间无契约破坏的静态机械比对，**不等于**真实 UI 验收六项已全部完成。就本机实际状态而言：运行中的宿主为 `/Applications/DeepSeek Harness.app`（`CFBundleShortVersionString` `0.2.0-rc.1`，其 asar 内 `dsh/node_modules/@deepseek-ai` 下 279 个 `dsh*` 包全为该版本），本插件经 `~/.dsh/profiles/desktop` 的 `link:` 指向本仓库并**已在该宿主上实际加载运行**——`/ldvh` 与 `/ldvh/api/health` 均返回 HTTP 200，`ldvh_*` 工具面、引导注入与 Git Gate 在该宿主上均实际工作。故真实 UI 验收六项中**前两项已是在 `0.2.0-rc.1` 上取得**，其余四项（设置卡片、会话视图、停用与重启、卸载清理）仍未核对。目标环境基线登记值经 Human 决定同期推进为 `0.2.0-rc.1`（README 双版与 `local-dev-workflow` 同步），与上条的声明范围保持一致。依据：Research 对象 `2772f0d3-9b5c-44c9-b666-4f89593b629a` 的 F9、F10 与未证实 1（其中 F10 的本机宿主指认已知有误，待该对象更正）。
- **更正：本机「实际承载宿主」的原指认有误（独立审核发现）**：`local-dev-workflow` 与 README 双版此前把承载本插件的宿主记为 `/Applications/DSH NEXT.app`（`2.0.15-next` / 内核 `0.1.7-rc.2`）。经核验该指认错误——`DSH NEXT.app` 当前**未运行**（`pgrep` 实测 0 进程），只是本机同时安装的另一个宿主产物；实际运行并承载本插件的是 `/Applications/DeepSeek Harness.app`（内核 `0.2.0-rc.1`，持有 GUI 端口 19387 与插件 web api 端口 3299）。连带影响：`/ldvh` 与 `/ldvh/api/health` 两项验收实证**自始即是在 `0.2.0-rc.1` 上取得的**。规范侧据此新增禁止项 7（禁止以同名 app 目录存在推定该宿主正在运行）与「按目录名指认宿主」反模式及对应验证行，使宿主指认须以进程、端口持有者、运行产物内核版本与 profile 安装形态四项实证支撑。

### Added

- Initial `dsh-ldvh` Cordis plugin package skeleton.
- Host `/ldvh` and `/ldvh/api` route skeletons with live enable/disable and disposal cleanup.
- Client settings-card and LDVH Conversation View skeletons.
- Host route lifecycle tests.
- v4 migration, current-DSH compatibility, and marketplace-gap plans.
- Governed-project lifecycle: registration carrier at the DSH user-config root (auto-initialized empty at plugin load), Git-root resolution, ldvh-base fact-source initialization, install/update/unregister transactions with rollback, and the `dsh-ldvh governed-project` CLI.
- Git Gate: managed commit-msg hook (install/inspect/preflight with a synthetic index), message contract (header / 关键变更 / LDVH-Provider + LDVH-Model trailers mechanically sourced from the DSH session record).
- Settings-card governed-project management (list / add / check / conditional update / unregister) and single-source Web status reporting.
- Settings-card footer “鼓励一下 ★” cheer link to the GitHub repo (family-wide pattern from dsh-sub-cli / dsh-subagent-default-model: URL constant + zh/en `row.cheer` copy + footer-left placement, with the save status moving into the left container).

### Changed

- Web-route registration now uses a declarative `webServer` injection (fixes the load-order race where routes never registered on real hosts).
- `output.schema` is now open (`{ type: "object", additionalProperties: true }`), matching dsh-mnemon. It constrains our own handler return, not a model emission — model output is constrained by `parameters`, which stays strict. The per-field output schema is what rejected every structured gap noted below.

### Fixed

- `ldvh_*` tool results never reached the model: `output.render` returned a bare string, but the DSH tool layer calls `result.content.some(...)` on the result, throwing `content.some is not a function` and silently failing the whole tool batch. `renderEnvelope` now returns an array of content blocks through a single `text()` choke point (the dsh-mnemon idiom), so a bare-string return is structurally impossible rather than merely absent (contract verified against `dsh-tools` and the MCP spec).
- `gaps` schema rejected the structured scan gaps (`{ responsibility_key, canonical_path, reason }`) emitted by `scanSpecCandidates`; the renderer stringifies structured gaps instead of printing `[object Object]`.
- `ldvh_research_session` submit-round rejected schema-compliant uncertain/gap findings: the tool schema declares `issue`/`gap` as nested objects (mirroring the Research frontmatter entries) while `shapeEvidence` read flat top-level fields, so AI callers following the schema were always rejected with a misleading error (2026-09-10 R1 field report). The shaper now reads the nested payloads and the error messages point at the declared shape.
- `ldvh_research_session` finalize was unusable: submit-round's automatic source registration passed an `undefined` summary, so the finalize bundle's `urls` array failed the harness lossless-JSON round-trip with an "invalid output" tool error. `registerSource` now normalizes title/summary to strings and auto-registration carries an empty summary; regression tests pin both fixes.

### Known

- The LDVH Web SPA is **no longer a placeholder**: the v4 migration step 1 landed (`plugin/web/`, 15 pages with the federation views and project colours) and `plugin/web/dist` builds a real SPA. The known couplings that remain are listed in `plugin/web/README-MIGRATION.md` (the Express API's v4 Python Helper dependency for legacy paths, and the fact that `study`-type lists are empty on v5 projects because the Research reading engine is not yet wired).
- Windows validation of the install/uninstall flow remains `unverified`. The platform-wide statement — and the automated-coverage gap on win32 — is recorded in the README "Platform support / 平台支持" section and in the `[Unreleased]` Known entries above; that section is the user-facing source for this claim.

## [1.0.0-dev.2] — 2026-09-25

### Breaking

- **宿主最低版本提升至 `@deepseek-ai/dsh >= 0.1.7-rc.1`**：peerDependencies 收窄为 `>=0.1.7-rc.1 <0.2.0`（`dsh-client-ui-primitives` / `dsh-host-webserver`）。0.1.6 及更早宿主不再兼容——旧设置模型（`SettingsProvider` / `installSettingsSection`）、客户端 `settingsScope` 与 `settings.plugin.item` 槽位、`agent/session-start` 事件在 0.1.7 已被删除，本插件相应契约全部迁移（见下），旧宿主无法回退运行。依据：`docs/dsh-0.1.5-rc2-to-0.1.7-rc1-research.md`。

### Changed

- **设置接入迁移到 0.1.7「插件 Config 即设置」模型**（§3.2/§3.3）：`lib/index.js` 导出 `Config`（`webEnabled` / `showInConversationTab` / `showInSidebarTab` 三开关，字段 `.volatile()` 支持热改），移除对 `@deepseek-ai/dsh-settings` 的命名导入（`installSettingsSection` / `settingsNamespace` 自 `dsh-v0.1.2-alpha.2` 起已从该包移除——加载期阻断点，§4.2）；不再注册独立 settings 命名空间，也不再消费 `ctx.settings` 服务。宿主按 Loader 条目 id（`dsh-ldvh`）把 volatile 字段投影成设置表单并写回 profile patch。
- **Web 路由开关改请求路径现判**：volatile 字段没有变更通知，`webEnabled` 由 `gated()` 在每次请求时判定（关闭立即生效），不再依赖设置回调挂/卸路由。
- **客户端设置面双迁移**（§3.3）：硬注入 `settingsScope`（服务已删除）改为 `configForms` 软注入；设置卡从已删除的 `settings.plugin.item` 迁到 `plugins.bundle.config`（key = 包名 `dsh-ldvh`）与 `plugins.row.config`（key = `dsh-ldvh#dsh-ldvh`）双注册（dsh-connect-workbuddy 同款，`view: 'page'` 默认展开）；写入由三次 `scope.set` 改为一次带 revision fence 的 `scope.mutate`。
- **事件迁移**（§3.4）：`agent/session-start`（已删除）→ `agent/created` 按 `payload.source`（`startup` / `resume` / `clear` / `compact`）分发；新增 `reprimeAgent()` 覆盖 resume/clear/compact 的再次 announce，child 侧委派状态刷新改在安装时执行。
- **工具描述符补 `output` 契约**：`goal-tools.js` 等工具层统一声明 `output: { schema, render }`（0.1.7 强制，缺则 `ctx.tools.register` 抛错并刷 already-registered 噪声）。
- **消息 source 退役共享 `kind: "plugin"`**（§3.7）：写入端改用自有 producer kind `"dsh-ldvh"`（v3→v4 迁移准入显式拒绝 `kind: "plugin"` 字面量），读取端 `isOwnMessage` 兼容历史行。
- **`dsh-client-ui-primitives` 图标命名族适配**（§4.3 致命点 B）：尺寸数字后缀 → 粗细语义后缀，运行时按名探测回退，杜绝 `undefined` 进 `React.createElement` 的渲染期崩溃。
- **开发工具链对齐 0.1.7 线**：devDependencies 的 `dsh-tools` / `dsh-scope` / `dsh-llm` / `dsh-sandbox` 升至 `0.1.7-rc.1`、`cordis` 升至 `~4.0.4`（测试实测全绿 930/930）。

### Fixed

- **客户端插件在 0.1.7 宿主上整体不装载**（§4.3 致命点 A）：`settingsScope` 留在硬注入列表会让客户端插件永不 apply；已去除。
- **宿主插件加载期 ESM 链接失败**（§4.2）：移除已不存在的 `installSettingsSection` / `settingsNamespace` 命名导入。

### Tests

- 新增 `source-kind-contract.test.mjs`：退役 `kind: "plugin"` 消息源契约守卫（写端禁止、读端兼容）。
- 新增 `tool-descriptor-contract.test.mjs`：工具层 `output` 声明契约守卫（凡注册工具必带 output 块）。
- 更新 `client-contract` / `client-fallback` / `lifecycle` / `web-routes`：configForms 软注入、plugins.* 双注册、agent/created 分发、gated 路由现判断言。
- 套件规模 928 → 930（+2 契约文件；2026-09-25 desktop profile 真机回归亦通过）。
