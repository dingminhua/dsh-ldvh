# Changelog

All notable changes to this project will be documented in this file.

The format follows Keep a Changelog. This development changelog records only implemented and committed scope; it does not announce unfinished roadmap items as delivered features.

## [Unreleased]

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
