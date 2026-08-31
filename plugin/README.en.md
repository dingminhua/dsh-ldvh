# dsh-ldvh

English | [简体中文](README.md)

> Status: `1.0.0-dev.1` development preview. The plugin shell exists, while governed-project management, Git Gate, and the full LDVH Web migration remain incomplete. It is not yet recommended for regular users or marketplace submission.

The native DeepSeek Harness plugin for LD Vibe Harness (LDVH). Its target capabilities include:

- an LDVH Conversation View;
- governed-project and default governance configuration management;
- Git Gate inspection, installation, upgrade, and removal;
- LDVH Web presentation;
- AI guidance and deterministic Helper entry points.

## Implemented so far

- Host route skeletons for `/ldvh` and `/ldvh/api`;
- live route enable/disable and unload cleanup;
- plugin settings-card skeleton;
- LDVH `conversation.view` skeleton;
- Host route lifecycle tests.

## Not implemented yet

- governed-project registration, removal, and default-project management;
- migration of the validated v4 Git Gate validator and Hook Manager;
- the full v4 Web application;
- real installation acceptance against the current DSH Desktop;
- release screenshots and a marketplace-ready version.

## Development installation

```bash
dsh plugin --profile desktop add /absolute/path/to/dsh-ldvh/plugin
```

Restart DSH Desktop after installing or changing Host, Client, or bundle-patch code. Current target environment:

- DSH Desktop `2.0.4`
- `@deepseek-ai/dsh` `0.1.2-alpha.1`
- Node.js `>=20`

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
