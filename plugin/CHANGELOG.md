# Changelog

All notable changes to this project will be documented in this file.

The format follows Keep a Changelog. This development changelog records only implemented and committed scope; it does not announce unfinished roadmap items as delivered features.

## [Unreleased]

### Changed

- **DSH 宿主基线推进至 `0.1.7-rc.2`**：开发目标环境登记值由 `DSH Desktop 2.0.14-next / @deepseek-ai/dsh 0.1.7-rc.1` 更新为 `2.0.15-next / 0.1.7-rc.2`（README.md 与 README.en.md 同步）。机械依据：本机 `/Applications/DSH NEXT.app` 壳版本 `2.0.15-next`，其 `package.json` 声明 153 个 `@deepseek-ai/dsh*` 依赖，`Resources/app/node_modules/@deepseek-ai` 下实测 275 个 `dsh*` 包版本**全部**为 `0.1.7-rc.2`。依据：`docs/dsh-0.1.7-rc1-to-0.1.7-rc2-research.md`。
- **`0.1.7-rc.2` 无需契约适配**（该区间为契约只增不改）：服务 88→89（仅新增 `schedule`，删除 0）、事件 77→81（新增 4 项全为 `emit`，删除 0、既有 mode 零变化）、客户端槽位 86→89（新增 3 项，删除 0）、模型可见 Tool 零删除。本插件消费的 12 个宿主服务、8 个事件与 `conversation.chat.node` / `conversation.view` 两槽位在该区间全部保持；`tools.guard` 与 `tools.register` 形态未变。
- **开发工具链对齐 `0.1.7-rc.2`**：devDependencies 的 `dsh-tools` / `dsh-scope` / `dsh-llm` / `dsh-sandbox` 由 `0.1.7-rc.1` 升至 `0.1.7-rc.2`，`package-lock.json` 同步（含传递依赖 `dsh-brand` / `dsh-timeout` / `dsh-typert-protocol` / `dsh-util-crypto` / `dsh-util-values`）。`peerDependencies` 维持 `>=0.1.7-rc.1 <0.2.0`——该范围本已覆盖 rc.2，无需改动。验证：`npm --prefix plugin ci` 退出码 0；测试 933/933 通过、0 失败、0 跳过。
- **撤回「为审批面补 `displayReason`」评估项**：rc.2 新增的 `PreToolDecision.ask.displayReason` 由 `tools/pre-execute` 事件返回，而本插件消费的是 `tools.guard`——其契约是返回**纯字符串**拒绝理由（`packages/core/tools/src/index.ts` 的 `guardReason(exec): string | undefined`），拿不到结构化载荷。两者不是同一条缝，该增强在本插件当前形态下不适用。

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

- The LDVH Web SPA is still a placeholder page; the v4 web migration is pending.
- Windows validation of the install/uninstall flow remains `unverified`.

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
