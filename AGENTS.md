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
| **Prisma & migrations** | [`docs/agents/prisma.md`](docs/agents/prisma.md) | adding/altering database models or writing a migration — per-domain schema files under `prisma/schema/`, migration naming. |
| **Cluster topology** | [`docs/agents/cluster-architecture.md`](docs/agents/cluster-architecture.md) | you need the whole-cluster picture — planes, namespaces, Helm templates, isolation tiers, multi-instance, Workload Identity. |
| **Monorepo boundaries** | [`docs/agents/monorepo.md`](docs/agents/monorepo.md) | creating/moving an app or library, adding a deployable workload, or changing NX tags/dependency direction. |
| **Build, Test & Infra** | [`docs/agents/infra.md`](docs/agents/infra.md) | building/testing, or editing Terraform/Helm/deploy under `platform/`. |
| **Workflow & Review Gate** | [`docs/agents/workflow.md`](docs/agents/workflow.md) | planning (`plan.md`/`CHANGELOG.md`), writing commit messages, or hitting the review gate. |
| **App-Specific** | [`docs/agents/app-specific.md`](docs/agents/app-specific.md) | working inside a specific `apps/*` or `libs/*` package; per-package map + API/CLI-first rule. |

## Agent Index

The repository defines specialised agents in two formats. Delegate to the right one rather than
doing everything inline; **dispatch independent agents concurrently** (multiple agent calls in one
message) wherever the work has no dependency between them.

**Claude Code subagents** (`.claude/agents/*.md` — invoked via the Agent tool by `name`):

| Agent | Model | Use it for |
|-------|-------|-----------|
| `architecture` | Sonnet | Required preflight + post-diff architecture gate for roadmap slices that add/move apps, libraries, cluster workloads, identity boundaries, or rewrite-freeze green code. Enforces one `apps/<name>` owner per deployable, thin app roots, functional-first `libs/*` placement, NX dependency direction, IAM-first trust boundaries, and zero legacy compatibility in green. Read-only; returns `PASS`/`BLOCK` with exact moves/deletions. |
| `review` | Haiku | Independent, fresh-context code review of a changed slice — correctness bugs, regressions, security/IAM-policy drift, missing tests. Accepts `DIMENSION: correctness\|security\|residue` for a single-concern pass; mechanical style comes from `scripts/agent-style-check.sh`, never from eyeballing. Read-only; severity-first. **Required by the review gate before a turn ends** (see [Mandatory Independent Review](docs/agents/workflow.md#mandatory-independent-review-policy-driven-gate)); for larger diffs prefer the `/review-loop` skill, which satisfies the same gate. |
| `review-verifier` | Haiku | Adversarially verifies ONE candidate review finding — default stance: refute it. Returns `CONFIRMED / REFUTED / UNCERTAIN` with a concrete evidence walk. Spawned per-candidate by `/review-loop` (sonnet override for Critical/High candidates); also useful standalone before acting on any single risky claim. |
| `changelog` | Sonnet | Maintain `CHANGELOG.md` in functional, capability-first terms when a phase/track completes or a tag is cut. Reads `plan.md`/`plan-done.md` + git range; writes capability, not commit history. |
| `readme` | Sonnet | Maintain `README.md` as the project front door — the problem, the vision, and what the repo does. Keeps design decisions, phase history, threat models, and deep mechanism OUT (those go to `CHANGELOG.md`/`plan-done.md`/the docs site). |
| `observability` | Sonnet | Telemetry + logging in one (they share the `@opencrane/observability` lib and trace-wrap seam). Audits or wires a slice so external-I/O paths are traced (`___DoWithTrace` spans) and output is structured (no raw `console.*`, secrets redacted, errors under `err`), plus per-app `instrument.ts`/shutdown-flush/Helm env. Reads the lib barrel each run for current API names. |
| `deploy` | Sonnet | Deploy executor + diagnostician for dev/staging clusters. Mutates the cluster ONLY via the deploy scripts (`apps/*/deploy.sh` → `libs/k8s-platform/k8s-deploy.sh`); reads freely for diagnosis (kubectl read verbs, helm status, read-only SQL through the cnpg primary). Reads `docs/agents/deploy-ledger.md` before every run; returns a structured run report (findings classed `chart`/`script`/`config`/`codebase`/`data`/`infra`/`flake`) for `/deploy-loop` to triage. Never edits code. |
| `memory-engineer` | Sonnet | Memory-layer specialist — OpenClaw workspace memory (`MEMORY.md`, `memory/*.md`, seeded workspace files) AND the Cognee org-memory plugin integration (operator wiring/identity/persistence + LLM/embedding routing through LiteLLM, the plugin render in `2-config-map.ts`, the `TOOLS.md` contract). Use when changing/auditing anything memory-related or when memory isn't recalling/persisting. Grounds every claim in the pinned plugin's ACTUAL behaviour + the live render (never a stale doc/assumption); enforces the "Cognee is the authoritative durable store, MEMORY.md is transient" policy. Audits by default; applies when asked. |
| `reaper` | Sonnet | Deletion gate for rewrite/refactor slices. Runs before implementation to classify survivor/stabilize/migrate/drop paths and after implementation to remove superseded code, exports, contracts, config, tests, deployment wiring, and docs. No green compatibility shims or deprecation periods; read-only verdicts with evidence. |

**Roadmap execution** is the `/execute-plan` **skill** (`.claude/commands/execute-plan.md`), not an
agent — it runs in the main session, parallelises via a dependency DAG + waves (one `general-purpose`
subagent per lane), uses `architecture` before/after structural waves and `reaper` before/after every
rewrite slice, commits at each gate, and delegates the final review gate to `review` above.

**Cost-tiered review** is the `/review-loop` **skill** (`.claude/commands/review-loop.md`): free
style script → parallel single-dimension `review` finders → a `review-verifier` per candidate
finding → one merged severity-first report. Use it for multi-file or risky diffs; a direct `review`
delegation stays right for small ones.

**Deploy fleet** is the `/deploy-loop` **skill** (`.claude/commands/deploy-loop.md`): preflight →
one `deploy` agent run (script-only mutations) → triage every finding into a fix PR (chart/script/
config, defended with run evidence and conceded quickly when disputed), a GitHub issue (codebase/
data), or a design question to the user → friction mined into configuration simplifications (2
sightings = fix it) → a docs-coverage pass (`scripts/config-docs-coverage.sh` finds undocumented
values keys; the `website` agent documents one batch per run) → ledger append
(`docs/agents/deploy-ledger.md`, the fleet's cross-run memory).

**Built-in platform agent types** (available via the Agent tool, not repo-defined): `Explore`
(read-only broad search — locating code across many files), `Plan` (design an implementation plan),
`general-purpose` (multi-step research/execution). The `architecture` and `angular` types also apply
to the WeOwnAI repo, which still owns the fleet app and the FORK libs (`core`, `platform`,
`state/core`, `state/gateways`, `state/utils/storage`, `state/tenant/adapter`) shared with
`libs/frontend/*` here.

When adding a new agent: put Claude Code subagents in `.claude/agents/` and add a row above — that is
the single home for agent definitions (do not reintroduce a parallel `.github/agents/` copy). Add a
user-invocable workflow as a skill under `.claude/commands/`.
