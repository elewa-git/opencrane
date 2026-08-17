# Repository context for long-running agent work

OpenCrane uses [rag-rat](https://github.com/cq27-dev/rag-rat) as opt-in, source-anchored semantic
context for developers and coding agents. It improves navigation and continuity across long tasks.
It is an advisory retrieval layer: Nx remains the authority for project boundaries, dependency
direction, affected calculation, builds, lint, and tests.

## Set up a clone

Run the pinned workspace setup after `npm ci`:

```bash
npm run agent-context:setup
```

The command downloads rag-rat `0.23.0` on first use, builds the initial index, installs the selected
local embedding model, reconciles the index, and installs non-blocking Git maintenance hooks for the
clone. The index and remembered context live in rag-rat's machine-local data directory rather than
Git. `.rag-rat/` is ignored as a safeguard for local overrides and logs.

The workspace runner refuses a stale package version or an executable whose SHA-256 differs from the
reviewed `v0.23.0` release bytes. Upgrading rag-rat therefore requires an explicit version change,
reviewed checksums for every supported platform, and the integration-contract test.

The packaged binary supports Apple Silicon macOS, x64 Windows, and Linux systems with glibc 2.39 or
newer. Developers on Intel macOS, musl Linux, or older glibc must use rag-rat's documented Cargo
installation. The tool stays out of `package.json` dependencies so an unsupported optional developer
tool cannot break `npm ci`, Nx, or release builds.

## Use it in the agent loop

At the start or resumption of a substantial task:

1. Run `npm run agent-context:doctor` when index freshness is uncertain.
2. Query before broad text search: `npm run agent-context -- query "<capability or invariant>"`.
3. Inspect the returned source anchors before making a claim or changing code.
4. Use Nx to confirm the dependency and affected surface before validation.

During a long run, use `npm run agent-context:refresh` after a large move, generated-code refresh,
or branch transition when the installed hooks have not already reconciled the change. Agents using
MCP can start the same pinned server with `npm run agent-context -- mcp`; register that command in
the agent client as a project-scoped MCP server.

At the end of a task, record only durable decisions, invariants, and known risks, and attach them to
the source that proves them. Rag-rat memory is machine-local, so any decision another developer must
inherit belongs in Git-tracked documentation, tests, or code comments under the repository's normal
review rules. Never treat a retrieved memory as newer or more authoritative than current source.

## Nx and CI boundary

Rag-rat spans the whole workspace and therefore is deliberately not modelled as an Nx project. A
semantic match is not dependency evidence, and indexing should not make an otherwise unaffected Nx
project affected.

Pull-request and nightly CI run `npm run test:agent-context`. This static contract proves that the
tool version stays pinned, the workspace commands remain available, machine-local state stays
ignored, and obvious generated or vendored trees stay excluded. CI does not download the binary,
build an index, or judge retrieval quality. The released binary does not currently expose a stable
evaluation command suitable for a blocking quality gate; add a scheduled evaluation before making
retrieval quality an acceptance condition.

## Configuration choices

[`rag-rat.toml`](../../rag-rat.toml) indexes authored TypeScript, Python, and Markdown while excluding
vendored upstream snapshots and generated output. It uses a local embedding model, disables remote
distillation and background version checks, and keeps the file watcher conservative enough for long
editing sessions. Changes to these boundaries require the same review as other developer tooling.

## Selection record

A local cold-pass comparison on this repository informed the pilot. Nx produced its 280 KB project
graph almost immediately and remains the right build authority, but it does not provide semantic
retrieval or task memory. Graphify built a useful 30 MB structural graph in about 32 seconds, while
its broad query returned 1,520 nodes and truncated the result. Madar took about four minutes and 182
MB, then returned a 0.40-confidence answer that misidentified the requested entrypoint. Rag-rat took
about 44 seconds and 128 MB, and its first semantic query found the relevant runtime, admission,
snapshot, and dispatch sources with usable anchors.

These figures are one workstation snapshot, not a performance guarantee. The selection is based on
fit for long-running agent continuity; Graphify remains the stronger candidate if the objective
changes to exact graph analysis or visualisation.
