# OpenCrane Agent Guidance

## Source Of Truth

This file is the canonical agent instruction file for the repository.

- Read this file first when working in the repo.
- Treat legacy guidance in `CLAUDE.md` as redirected here.
- Detailed rules are split into focused files under [`docs/agents/`](docs/agents/). This file is the
  index and the agent roster; load the topic file that matches the work in front of you.

## Guidance Map

| Topic | File | Read it when you are… |
|-------|------|------------------------|
| **TypeScript** | [`docs/agents/typescript.md`](docs/agents/typescript.md) | writing or editing any `.ts` file — bracket placement, arrow functions, JSDoc, naming, imports, type-file separation, self-review table. |
| **Angular / Frontend** | [`docs/agents/angular.md`](docs/agents/angular.md) | working in the `apps/opencrane-ui` Angular SPA or `libs/frontend/*` (ported from WeOwnAI, #152) — PrimeNG, layering, signals/resources, standalone components. |
| **Architecture & Identity** | [`docs/agents/architecture.md`](docs/agents/architecture.md) | making IAM, identity, auth, or token-policy decisions (the IAM-first philosophy). |
| **Kubernetes** | [`docs/agents/k8s.md`](docs/agents/k8s.md) | touching service accounts, RBAC, NetworkPolicy, or routes excluded from auth middleware. |
| **Prisma & target baseline** | [`docs/agents/prisma.md`](docs/agents/prisma.md) | adding/altering database models or regenerating the clean target baseline — per-domain schema files under `prisma/schema/`, reviewed SQL under `prisma/bootstrap/`. |
| **Cluster topology** | [`docs/agents/cluster-architecture.md`](docs/agents/cluster-architecture.md) | you need the whole-cluster picture — planes, namespaces, Helm templates, isolation tiers, multi-instance, Workload Identity. |
| **Monorepo boundaries** | [`docs/agents/monorepo.md`](docs/agents/monorepo.md) | creating/moving an app or library, adding a deployable workload, or changing NX tags/dependency direction. |
| **Build, Test & Infra** | [`docs/agents/infra.md`](docs/agents/infra.md) | building/testing, or editing Terraform/Helm/deploy under `platform/`. |
| **Workflow & Review Gate** | [`docs/agents/workflow.md`](docs/agents/workflow.md) | planning (`plan.md`/`CHANGELOG.md`), creating or updating a PR/stack, writing commit messages, or hitting the review gate. |
| **Language-neutral maintainability** | [`docs/agents/maintainability.md`](docs/agents/maintainability.md) | adding substantial production code in any language, growing an already-large module, or reviewing cohesion and responsibility boundaries. |
| **App-Specific** | [`docs/agents/app-specific.md`](docs/agents/app-specific.md) | working inside a specific `apps/*` or `libs/*` package; per-package map + API-first rule. |
| **Package docs** | [`docs/agents/package-docs.md`](docs/agents/package-docs.md) | writing or editing any package `README.md`, or adding/moving/deleting a package — the README standard, the junior-dev voice, and the "update the README in the same change" rule. |

## Agent Index

The repository defines specialised agents in two formats. Delegate to the right one rather than
doing everything inline; **dispatch independent agents concurrently** (multiple agent calls in one
message) wherever the work has no dependency between them.

**Claude Code subagents** (`.claude/agents/*.md` — invoked via the Agent tool by `name`):

| Agent | Model | Use it for |
|-------|-------|-----------|
| `architecture` | Sonnet | Required preflight + post-diff architecture gate for roadmap slices that add/move apps, libraries, cluster workloads, identity boundaries, direct-replacement code, change a routed component's inputs/dependencies/reactive state/commands/mapping/navigation/interactive regions, or trigger a language-neutral module-growth candidate. For routed pages it requires the canonical page/store/mapper/presentation owner table and blocks every forbidden or ambiguous owner independently. It also enforces cohesive responsibility ownership, thin app roots, functional-first placement, NX dependency direction, IAM-first trust boundaries, zero legacy compatibility, and package READMEs. Read-only; returns `PASS`/`BLOCK` with exact moves/deletions. |
| `review` | Haiku | Independent, fresh-context code review of a changed slice — correctness bugs, regressions, security/IAM-policy drift, routed-page/store ownership, maintainability risks, residue, and missing tests. Every changed routed page requires an evidence-backed responsibility owner table even below growth thresholds; generic runners and helper-only extraction cannot earn PASS. Accepts `DIMENSION: correctness\|security\|maintainability\|residue` for a single-concern pass; mechanical style comes from `scripts/agent-style-check.sh`, while maintainability is evidence-based. Read-only; severity-first. **Required by the review gate before a turn ends** (see [Mandatory Independent Review](docs/agents/workflow.md#mandatory-independent-review-policy-driven-gate)); for larger diffs prefer the `/review-loop` skill, which satisfies the same gate. |
| `review-verifier` | Haiku | Adversarially verifies ONE candidate review finding — default stance: refute it. Returns `CONFIRMED / REFUTED / UNCERTAIN` with a concrete evidence walk. Spawned per-candidate by `/review-loop` (sonnet override for Critical/High candidates); also useful standalone before acting on any single risky claim. |
| `changelog` | Sonnet | Maintain `CHANGELOG.md` in functional, capability-first terms when a phase/track completes or a tag is cut. Reads `plan.md`/`plan-done.md` + git range; writes capability, not commit history. |
| `readme` | Sonnet | Maintain `README.md` as the project front door — the problem, the vision, and what the repo does. Keeps design decisions, phase history, threat models, and deep mechanism OUT (those go to `CHANGELOG.md`/`plan-done.md`/the docs site). |
| `component-manager` | Sonnet | Required PLAN + POST-DIFF frontend component-system owner for every materially changed screen. It maps regions to approved component states, requires an unambiguous page/store/mapper/presentational responsibility table, blocks high-responsibility pages and oversized replacement stores, and maintains visual/behaviour/accessibility contracts. Applies component-system changes when explicitly asked; otherwise returns an evidence-backed handoff and `PASS`/`BLOCK` gate. |
| `observability` | Sonnet | Telemetry + logging in one (they share the `@opencrane/backend/observability` lib and trace-wrap seam). Audits or wires a slice so external-I/O paths are traced (`___DoWithTrace` spans) and output is structured (no raw `console.*`, secrets redacted, errors under `err`), plus per-app `instrument.ts`/shutdown-flush/Helm env. Reads the lib barrel each run for current API names. |
| `deploy` | Sonnet | Deploy executor + diagnostician for dev/staging clusters. Mutates the cluster ONLY via app-owned deploy scripts, including `apps/_infra/deploy-k8s/deploy.sh`, over `apps/_infra/deploy-k8s/platform/k8s-deploy.sh`; reads freely for diagnosis (kubectl read verbs, helm status, read-only SQL through the cnpg primary). Reads `docs/agents/deploy-ledger.md` before every run; returns a structured run report (findings classed `chart`/`script`/`config`/`codebase`/`data`/`infra`/`flake`) for `/deploy-loop` to triage. Never edits code. |
| `memory-engineer` | Sonnet | Memory-layer specialist — the personal/org memory gateway boundary (`libs/backend/_server/memory-gateway-client`), the personal memory-fact catalog (`libs/backend/agents/personal/memory/main`), the shared contracts in `libs/contracts/src/memory.types.ts`, and the operator-side Cognee wiring behind the gateway (identity, persistence, LLM/embedding routing through LiteLLM). Use when changing/auditing anything memory-related or when memory isn't recalling/persisting. Enforces the standing policy: **every read and write goes through the gateway port — never a direct Cognee call from a scattered call site**; Cognee holds durable fact content while OpenCrane's catalog holds only metadata, provenance, consent, sensitivity, and a content digest; and a recall must name the gateway-native dataset frozen in the admitted run snapshot, never select one from a subject id alone. Grounds every claim in the package barrels and the live wiring, never a stale doc. Audits by default; applies when asked. |
| `reaper` | Sonnet | Deletion gate for rewrite/refactor slices. Runs before implementation to classify survivor/drop paths and after implementation to remove superseded code, exports, contracts, config, tests, deployment wiring, and docs — a deleted package drops its `README.md` and its parent-index/`app-specific.md` map rows with it. No compatibility shims, migration staging, or deprecation periods; read-only verdicts with evidence. |

**Roadmap execution** is the `/execute-plan` **skill** (`.claude/commands/execute-plan.md`), not an
agent — it runs in the main session, parallelises via a dependency DAG + waves (one `general-purpose`
subagent per lane), uses `architecture` before/after structural waves and `reaper` before/after every
rewrite slice, commits at each gate, and delegates the final review gate to `review` above.

**Cost-tiered review** is the `/review-loop` **skill** (`.claude/commands/review-loop.md`): free
style + language-neutral module-growth scripts → parallel single-dimension `review` finders → a
`review-verifier` per candidate finding → one merged severity-first report. Use it for multi-file or
risky diffs; a direct `review` delegation stays right for small ones.

**Deploy fleet** is the `/deploy-loop` **skill** (`.claude/commands/deploy-loop.md`): preflight →
one `deploy` agent run (script-only mutations) → triage every finding into a fix PR (chart/script/
config, defended with run evidence and conceded quickly when disputed), a GitHub issue (codebase/
data), or a design question to the user → friction mined into configuration simplifications (2
sightings = fix it) → a docs-coverage pass (`scripts/config-docs-coverage.sh` checks the explicit
operator-input contract; the `website` agent documents one missing batch per run) → ledger append
(`docs/agents/deploy-ledger.md`, the fleet's cross-run memory).

**Built-in platform agent types** (available via the Agent tool, not repo-defined): `Explore`
(read-only broad search — locating code across many files), `Plan` (design an implementation plan),
`general-purpose` (multi-step research/execution). The `architecture` and `angular` types also apply
to the WeOwnAI repo, which still owns the fleet app and the FORK libs (`core`, `platform`,
`state/core`, `state/gateways`, `state/tenant/adapter`) shared with
`libs/frontend/*` here.

When adding a new agent: put Claude Code subagents in `.claude/agents/` and add a row above — that is
the single home for agent definitions (do not reintroduce a parallel `.github/agents/` copy). Add a
user-invocable workflow as a skill under `.claude/commands/`.
