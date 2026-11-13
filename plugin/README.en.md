# dsh-ldvh

English | [简体中文](README.md)

> Status: `1.0.0-dev.1` development preview. Governed-project management, Git Gate, the LDVH Web, and the `ldvh_*` tool surface have all landed; full real-UI acceptance is not yet complete and **no real Windows host has verified this plugin**, so it is still not recommended for regular users or marketplace submission.

The native DeepSeek Harness plugin for LD Vibe Harness (LDVH). Its target capabilities include:

- an LDVH Conversation View;
- governed-project and default governance configuration management;
- Git Gate inspection, installation, upgrade, and removal;
- LDVH Web presentation;
- AI guidance and deterministic LDVH CLI entry points.

## Implemented so far

- Host `/ldvh` and `/ldvh/api` routes, including live Web-route enable/disable and unload cleanup;
- governed-project lifecycle: registration carrier, install / check / hook removal / unregister transactions;
- Git Gate: the managed `commit-msg` hook and the controlled-commit message contract;
- settings section (`Settings → LDVH`): governed-project management and Web presentation preferences (moved out of the Plugins-page card on 2026-11-13 — the Plugins page no longer carries settings);
- the LDVH Web SPA (v4 migration step 1 landed, with the governed-federation views and project colours) and the LDVH Conversation View;
- the `ldvh_*` tool surface and the rule-guidance injection;
- Host route lifecycle tests.

## Not implemented yet

- four of the six real-UI acceptance items remain unchecked (settings section, conversation view, disable/restart, uninstall cleanup);
- release screenshots and a marketplace-ready version;
- real-machine Windows acceptance (see "Platform support" below).

## Development installation

```bash
dsh plugin --profile desktop add /absolute/path/to/dsh-ldvh/plugin
```

Restart DSH Desktop after installing or changing Host, Client, or bundle-patch code. Current target environment (observed locally on 2026-10-30):

- DSH Desktop `0.2.2-rc.1` (`/Applications/DeepSeek Harness.app`)
- `@deepseek-ai/dsh` `0.2.2-rc.1`
- Node.js `>=22.15.0` (code floor; the DSH host `dsh-plugin-desktop` itself requires `^22.19.0 || >=24.0.0`)

> **Host compatibility (since `1.0.0-dev.1`; this assertion is first registered in this version)**: this plugin only supports `@deepseek-ai/dsh >= 0.1.7-rc.1 < 0.3.0` (peerDependencies narrowed accordingly). The breaking changes introduced by the 0.1.7 line (rc.1 and rc.2) — the settings model rebuild (`SettingsProvider` → plugin Config + volatile), the client settings surface (`settingsScope` / `settings.plugin.item` removed → `configForms` / `plugins.*`), the removed `agent/session-start` event, and the mandatory tool `output` contract — have all been adapted. 0.1.7-rc.2 adds to rc.1 without removing or changing contract (zero service/event/slot deletions), so it needs no further adaptation; 0.2.0-rc.1 likewise breaks no contract versus rc.2 (services 89→91 with zero deletions, events 81→81 unchanged, client slot entries 89→89 with zero additions or removals, model-visible tools unchanged, and the 11 host-side services and eight events this plugin consumes are verbatim unchanged in mode and signature); 0.2.0-rc.2 versus rc.1 is again additive-only (services 91→91 with zero additions or removals, events 81→81 unchanged, tool names 65→65 unchanged, package set 325→325 with zero additions or removals, and the single changed service `userQuestions` keeps its existing `ask` method signature verbatim while adding three parallel methods). The 0.2.1 line (rc.1–rc.3) likewise breaks nothing for this plugin — the consumed services and events are additive except for `ctx.invariants` below (project measurement on 2026-10-19: comparing the consumed surface of 0.2.0-rc.2→0.2.1-rc.2 service by service, the only deleted service was `invariants`), and the separately measured 0.2.1-rc.2→0.2.1-rc.3 interval is **zero server-side contract change** (every consumed host service package changed only its `package.json` version line) with **purely additive client slots** (74→77 slot keys; `conversation.session.header.views.actions`, `sidebar.panellist.actions`, `sidebar.right.tab.guide.actions` added, zero removed), so the four slots this plugin uses and the signatures it consumes are verbatim unchanged and **no code-level adaptation is required**. **The 0.2.1-rc.3→0.2.1-rc.5 interval (measured 2026-10-30, 13 commits / 388 files) also requires no code-level adaptation**: 349 of those files are `package.json` version lines, and of the 39 non-manifest changes across the interval (34 of them inside `packages/`) only two are server-side **src** changes, both on surfaces this plugin does not consume (`llm-deepseek-account` moves account-catalog logging from `console.info` to `console.error` because ACP reserves stdout; `mcp-client` now checks whether the server advertises the `resources` capability before listing, so the SDK never writes `console.debug` to stdout). Server-side also changed three packages' READMEs (9 files: zh/en/i18n) and two test files — documentation and tests, not implementation. Every package holding a host service this plugin consumes — `core/tools`, `interaction/user-questions`, `core/system-prompt`, `session/session-persistence`, `fs/fs`, `core/agent`, `interaction/commands`, `util/home-paths`, `util/atomic-write`, `host/webserver`, plus four more that are also consumed (`goal/goal`, `schedule/schedule`, `api/session-controller`, `api/workspace-controller`) — changed only its `package.json` version line across that interval (checked package by package: each matches only its own manifest file); the client slot **keys** are 103→103 with no additions, removals or renames, while 9 entries changed content — 8 only touch a `source:` documentation line reference and 1 is the summary/doc/ownerProps of `conversation.chat.reasoning.body`; the registration and owner props of the four slots this plugin uses are verbatim unchanged (verified through Cordis Inspect on the running rc.5 host: the `ldvh` occupant of `conversation.view`, the `ldvh-notice` key of `conversation.chat.node`, and the `dsh-ldvh` keys of `plugins.bundle.config` and `plugins.row.config` are all present and active — **those four were measured on rc.1**; since 2026-11-13 the settings surface moved to `settings.section` (`plugins.bundle.config` / `plugins.row.config` two keyed slots retired, and `conversation.chat.node`'s self-built row handed back to the host's native Context row), so it is now three: `conversation.view` + `settings.section` / `settings.section.icon`); the question card's CSS module local-name set (`eyebrow`, `options`, `detail`, `optionLabel`, `pager`, …) and the `data-question-key` contract attribute are verbatim unchanged between rc.3 and rc.5, so GATE_CSS's static selector hit surface is unchanged. Also worth knowing: `@deepseek-ai/dsh-client-ui-conversation`, which this plugin declares in `dsh.client.inject`, has 2 src changes in that interval (one `session.moreViewsCurrent` locale key removed, and View tab labels now get a tooltip only when they overflow); neither is a contract change and neither touches the `uiConversation.events.register` or `conversation.chat.node` surfaces this plugin consumes. **The one client contract change is the new `rawText` field on `conversation.chat.reasoning.body`** (where `text` now means "display text prepared by Chat"): it only affects reasoning renderers and translation wrappers registered on that slot, and this plugin **does not register it**, so it is unaffected — it is upstream's migration notice for third-party extensions and carries no migration duty here. The single contract removal is the host service `ctx.invariants` (the runtime invariant registrar was retired wholesale in upstream commit `f028f25667` and is no longer provided since `0.2.1-alpha.1`): this plugin's install-time assertion on that seam is no longer deployed on 0.2.1-line hosts, and the plugin honestly reports the seam as unconsumed per `specs/10` §6, **without claiming** its protection is in effect; the replacement direction is left to a Spark decision. **`0.2.1-rc.5`→`0.2.2-rc.1` DOES require code-level adaptation (measured 2026-11-05, 2623 commits / 8120 files)** — the first breaking change to this plugin on the 0.2 line, unlike the additive-only intervals above: (1) **the `schedule` service was rebuilt** (`packages/schedule/schedule`, +545/−213): `create(sessionId, request, signal)` became `create(request, actorSessionId?, signal)` with the Session moving into `request.target`; the timing selectors moved from top-level request fields (`every_seconds`, …) into `request.timing` (`{ kind: 'every', every_seconds }`); and `delete(request, signal)` was **removed**, with deletion folded into `edit({ id, action: 'delete' })`. This plugin's `lib/host-automation-probe.js` called the old signature and would throw on rc.1 — it is rewritten for the new signature (its cleanup guidance now names `edit`'s delete action) and the tool description in `lib/ldvh-tools.js` is updated. A live read-only probe confirms `schedule.delete` is `undefined` while `schedule.create` is still a function. (2) **the `system-prompt/assemble` payload narrowed** (`packages/core/system-prompt`, +24/−16): the waterfall signature changed from `PromptAssembly` to `PromptPresentation`, moving `tools` out of the waterfall payload (`PromptAssembly extends PromptPresentation`; tool declarations became provider-owned and are re-attached by `assemble()` after the waterfall). This plugin's `createAssembleHandler` in `lib/guidance.js` only replaces entries in `assembled.sections` and returns `{ ...assembled, sections }` — it neither reads nor writes `tools`, so it is structurally compatible; this is an **honestly registered contract change**, not an adaptation this plugin performs. (3) **the question card's DOM structure changed** (`packages/client/ui-user-questions`, CSS +208 lines, TSX +175 lines): an option went from a single `button[role=radio]` to a `div.optionRow[data-option-row]` wrapping `button.option[role=radio]`, with the `optionSelected` class now on the outer row; a new `descriptionToggle` class also contains the `description` substring. This plugin's `GATE_CSS` used to draw the card border, background, hover and selected state entirely on `[role=radio]`, which under the new structure yields **double borders** and states covering only the inner box — it now attaches appearance to `[data-option-row]`, demotes the inner button to a content box, and takes the selected state from `[data-option-row][class*="optionSelected"]`; the `description` override now carries `:not([class*="descriptionToggle"])` to avoid the substring collision. Two mechanical guards were added (the outer row carries the border and minimum height while the inner button drops its border, and the selected state lands on the outer row; `description` excludes the toggle), both confirmed to catch a regression by mutation testing. **No other consumed surface changed in this interval**: `tools.register`/`tools.guard` (the `ToolGuard` signature and `timeoutMs` semantics are verbatim unchanged; `ToolExecutionInput` only gained an optional `toolSet`), `userQuestions.ask`, `sessionPersistence.open`, `agents.get/list`, `goals.*`, `sessionController.list/create`, `commands.*`, `fs` and its three `fs/*` events, `webServer.register` (`kind:'prefix'` is still in the closed set; the new `WebResourceRoute` is a parallel form), `dshHomePath`, and `withFileLock`/`writeFileAtomic` (both libraries have **zero src changes** across the interval — version lines only); `ctx.invariants` is still absent (the existing registration stands). All four client slots this plugin uses were verified present and active through Cordis Inspect on the running rc.1 host (`ldvh` at order 20 in `conversation.view`, `ldvh-notice` in `conversation.chat.node`, and `dsh-ldvh` in both `plugins.bundle.config` and `plugins.row.config`). **Dependency alignment**: `dsh-atomic-write`/`dsh-home-paths` moved from `^0.2.1-rc.5` to `^0.2.2-rc.1` (under semver, `^0.2.1-rc.5` does **not** match `0.2.2-rc.1` — a prerelease only matches a range on the same `major.minor.patch`), the four dsh devDependencies and `@deepseek-ai/cordis` (`~4.1.0`) follow the host, and `peerDependencies` stay at `>=0.1.7-rc.1 <0.3.0` (already covering rc.1). **The upper bound of `< 0.3.0` exists to cover the stable 0.2.x line**: under the host's evaluation semantics (`includePrerelease: true`) `< 0.2.0` and `< 0.3.0` give the same result for their respective prereleases — the real difference is the **non-prerelease** `0.2.0` (the former rejects it, the latter admits it), so advancing the bound guards against the bundle being rejected by the compatibility gate once upstream ships a stable release. Hosts on 0.1.6 and earlier are not supported; see [CHANGELOG.md](CHANGELOG.md).

What is registered here is the development target baseline, not verified support: of the six real-UI acceptance items required by `specs/08` §8, `/ldvh` and `/ldvh/api/health` are evidenced, while the settings section, conversation view, disable/restart, and uninstall cleanup have not been checked.

## Platform support

The plugin targets DSH Desktop and **declares macOS and Windows as its supported platforms**. Linux runs against the same host contract (CI executes the full suite on Ubuntu) but has no real-machine desktop acceptance, so it is outside the support declaration.

`specs/08` §8 forbids passing implemented behaviour off as acceptance, so the two states are recorded separately:

| Platform | Implementation | Real-machine acceptance |
|---|---|---|
| macOS | Complete | Measured: 10 governed-project lifecycle items, `/ldvh`, `/ldvh/api/health` |
| Windows | Implemented (below) | **Not verified on a real Windows host (`unverified`)** |
| Linux | Runs against the same contract | CI-covered only, not accepted |

The 10 measured macOS items (each recorded in the repository's `../docs/governed-project-lifecycle-verification.md`): the candidate path must be the real Git root; first install creates the five `ldvh-base/` directories; first install writes the registration and sets the default project; the hook lands in the Git common-dir; the hook marker digest reads back as `managed`; an invalid message is blocked in a real commit; a conforming message is admitted; the registration and `ldvh-base/` survive hook removal; re-installing repairs a missing hook without duplicating registration; unregistering removes the registration and auto-removes the hook.

Platform differences fall in three core mechanisms, plus one interaction adaptation:

- **Path semantics**: drive-letter absolute paths (`C:/…`) and UNC paths (`//server/share/…`) are taken by Node/Git realpath plus Git-root resolution; containment is decided by the host platform's own separator and drive-letter semantics rather than assuming POSIX with a hard-coded `/`;
- **Git-hook carrier**: the hook script is rendered with `#!/bin/sh`; on `win32` the preflight is invoked through the `sh` shipped with Git for Windows (`bin/sh.exe` → `usr/bin/sh.exe` → PATH), avoiding direct execution of an extensionless script; the script recognises drive-letter and UNC message-file paths in its `${1}` case; the executable bit is carried by Git for Windows' shebang handling (`chmod` is inert on NTFS);
- **File permissions**: writes to the governance-registration carrier land through DSH atomic-write (same-directory temp file + atomic replace); fact-source objects are written by each writer's own same-directory temp file + read-back verification + rename. Windows inherits the DSH user-config ACL instead of faking POSIX mode;
- **Directory selection**: under the Desktop page marker `dsh-desktop-platform=win32` the main-process native dialog is used, falling back to the host remote picker and manual entry. Starting a PowerShell/cmd terminal is the Desktop host's own behaviour; LDVH neither chooses the shell nor elevates privileges.

Limitations recorded honestly for Windows:

- `ldvh_register_governed_project` (the AI registration entry) returns `registration_permission_unverified` on Windows: this implementation has no ACL verifier, while `specs/07` §5.6 requires high-risk writes to fail closed when the ACL cannot be verified. The settings-page "Install" path (an explicit Human action) is unaffected.
- the **DSH user-config root holding the registration carrier** must not live on a network filesystem or a share crossing PID namespaces (UNC shares included): the registration carrier's lock takeover identifies the holder by PID, and sharing one file across hosts is not supported. The fact source `ldvh-base/` does not use that lock package (each fact writer brings its own lock-free atomic replace), so this constraint targets the config root, not the project directory. See the Known section of [CHANGELOG.md](CHANGELOG.md).
- both CI jobs run on Ubuntu, so **win32 branches are never executed by CI**; 4 assertions across the suite early-return on win32 (3 in `plugin/test/` depending on POSIX permission semantics, 1 in `plugin/web/tests/` depending on the executable bit), so neither win32 paths nor those assertions run on Windows. win32 paths therefore have code-level implementation only, with no automated verification backing them.
- unverified risks: whether Git Bash/MSYS `sh` is discoverable in the target Windows environment; how an atomic-replace failure caused by an NTFS file lock surfaces; the real behaviour of UNC paths and junctions.

"Windows support" declares the platform scope covered; until real-machine acceptance is complete, nothing here means Windows has passed acceptance.

## Verification

```bash
npm --prefix plugin test
npm --prefix plugin pack --dry-run
```

Passing tests proves only the covered mechanical scope; it does not prove complete product functionality, current-DSH compatibility, or marketplace readiness.

## Boundaries

- Migrate and adapt validated v4 mechanical cores before considering rewrites.
- DSH provides the host carrier; it does not become the semantic authority for LDVH rules or facts.
- Governance and Git Gate state changes require explicit Human action.
- Unknown third-party `commit-msg` hooks are never overwritten or automatically chained.
- Tests, rendering, or installation success alone do not prove completion.

## License

MIT © LaoDing
