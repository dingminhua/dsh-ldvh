# dsh-ldvh

English | [简体中文](README.md)

> Status: `1.0.0-dev.2` development preview. Governed-project management, Git Gate, the LDVH Web, and the `ldvh_*` tool surface have all landed; full real-UI acceptance is not yet complete and **no real Windows host has verified this plugin**, so it is still not recommended for regular users or marketplace submission.

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
- settings card: governed-project management and Web presentation preferences;
- the LDVH Web SPA (v4 migration step 1 landed, with the governed-federation views and project colours) and the LDVH Conversation View;
- the `ldvh_*` tool surface and the rule-guidance injection;
- Host route lifecycle tests.

## Not implemented yet

- four of the six real-UI acceptance items remain unchecked (settings card, conversation view, disable/restart, uninstall cleanup);
- release screenshots and a marketplace-ready version;
- real-machine Windows acceptance (see "Platform support" below).

## Development installation

```bash
dsh plugin --profile desktop add /absolute/path/to/dsh-ldvh/plugin
```

Restart DSH Desktop after installing or changing Host, Client, or bundle-patch code. Current target environment (observed locally on 2026-09-29):

- DSH Desktop `0.2.0-rc.1` (`/Applications/DeepSeek Harness.app`)
- `@deepseek-ai/dsh` `0.2.0-rc.1`
- Node.js `>=22.15.0` (code floor; the DSH host `dsh-plugin-desktop` itself requires `^22.19.0 || >=24.0.0`)

> **Host compatibility (since `1.0.0-dev.2`)**: this plugin only supports `@deepseek-ai/dsh >= 0.1.7-rc.1 < 0.3.0` (peerDependencies narrowed accordingly). The breaking changes introduced by the 0.1.7 line (rc.1 and rc.2) — the settings model rebuild (`SettingsProvider` → plugin Config + volatile), the client settings surface (`settingsScope` / `settings.plugin.item` removed → `configForms` / `plugins.*`), the removed `agent/session-start` event, and the mandatory tool `output` contract — have all been adapted. 0.1.7-rc.2 adds to rc.1 without removing or changing contract (zero service/event/slot deletions), so it needs no further adaptation; 0.2.0-rc.1 likewise breaks no contract versus rc.2 (services 89→91 with zero deletions, events 81→81 unchanged, client slot entries 89→89 with zero additions or removals, model-visible tools unchanged, and the 11 host-side services and eight events this plugin consumes are verbatim unchanged in mode and signature), so the upper bound moves to `< 0.3.0` to cover the 0.2.x line. Hosts on 0.1.6 and earlier are not supported; see [CHANGELOG.md](CHANGELOG.md).

What is registered here is the development target baseline, not verified support: of the six real-UI acceptance items required by `specs/08` §8, `/ldvh` and `/ldvh/api/health` are evidenced, while the settings card, conversation view, disable/restart, and uninstall cleanup have not been checked.

## Platform support

The plugin targets DSH Desktop and **declares macOS and Windows as its supported platforms**. Linux runs against the same host contract (CI executes the full suite on Ubuntu) but has no real-machine desktop acceptance, so it is outside the support declaration.

`specs/08` §8 forbids passing implemented behaviour off as acceptance, so the two states are recorded separately:

| Platform | Implementation | Real-machine acceptance |
|---|---|---|
| macOS | Complete | Measured: 10 governed-project lifecycle items, `/ldvh`, `/ldvh/api/health` |
| Windows | Implemented (below) | **Not verified on a real Windows host (`unverified`)** |
| Linux | Runs against the same contract | CI-covered only, not accepted |

The 10 measured macOS items (each recorded in the repository's `docs/governed-project-lifecycle-verification.md`): the candidate path must be the real Git root; first install creates the five `ldvh-base/` directories; first install writes the registration and sets the default project; the hook lands in the Git common-dir; the hook marker digest reads back as `managed`; an invalid message is blocked in a real commit; a conforming message is admitted; the registration and `ldvh-base/` survive hook removal; re-installing repairs a missing hook without duplicating registration; unregistering removes the registration and auto-removes the hook.

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
