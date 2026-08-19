# OpenCrane docs

Engineering reference material for the platform: durable design decisions, implemented contracts,
research, and canonical agent guidance. Reader-facing product documentation lives in
[`website/`](../website) and is published to opencrane.ai.

Forward work stays in the repository plans and issue tracker. Once work ships, capability notes
belong in `CHANGELOG.md`, while only lasting design contracts remain under `docs/`.

| Folder | What it holds |
|--------|---------------|
| [`ci-and-deploy.md`](ci-and-deploy.md) | The CI pipeline, its caching layers, the deploy engine, operational warnings, and the release-version and migration process. |
| [`agents/`](agents/) | Canonical agent guidance, indexed by [`AGENTS.md`](../AGENTS.md). |
| [`adr/`](adr/) | Accepted architecture decisions and the exact clauses they supersede. |
| [`design/`](design/) | Durable product and platform contracts grounded in current implementations. |
| [`decisions/`](decisions/) | Point decisions too small for an ADR but still worth recording. |
| [`research/`](research/) | Research reports that informed supported platform capabilities. |

## Conventions

- Use UK English, sentence-case headings, and no frontmatter.
- Keep delivery sequencing, temporary qualification evidence, and investigation notes out of durable
  design documents.
- Link directly to the implementation that grounds a mechanism.
- Treat live qualification as validation of the supported contract, not as a second authority or a
  reason to retain another product path.
