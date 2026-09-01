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

### Changed

- Web-route registration now uses a declarative `webServer` injection (fixes the load-order race where routes never registered on real hosts).

### Known

- The LDVH Web SPA is still a placeholder page; the v4 web migration is pending.
- Windows validation of the install/uninstall flow remains `unverified`.
