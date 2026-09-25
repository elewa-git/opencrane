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
| **Comment language** | [`docs/agents/typescript.md#comment-language`](docs/agents/typescript.md#comment-language) | writing ANY comment, in any language (`.ts`, `.py`, shell, Helm). Plain English, evidence-backed contracts, documentation depth proportional to consequence, and enums documented with what each member's state means. Applies to every agent that writes code, not only TypeScript work. |
| **Angular / Frontend** | [`docs/agents/angular.md`](docs/agents/angular.md) | working in the `apps/opencrane-ui` Angular SPA or `libs/frontend/*` (ported from WeOwnAI, #152) — PrimeNG, layering, signals/resources, standalone components. |
| **Architecture & Identity** | [`docs/agents/architecture.md`](docs/agents/architecture.md) | making IAM, identity, auth, or token-policy decisions (the IAM-first philosophy). |
| **Kubernetes** | [`docs/agents/k8s.md`](docs/agents/k8s.md) | touching service accounts, RBAC, NetworkPolicy, or routes excluded from auth middleware. |
| **Prisma & target baseline** | [`docs/agents/prisma.md`](docs/agents/prisma.md) | adding/altering database models or regenerating the clean target baseline — per-domain schema files under `prisma/schema/`, reviewed SQL under `prisma/bootstrap/`. |
| **Cluster topology** | [`docs/agents/cluster-architecture.md`](docs/agents/cluster-architecture.md) | you need the whole-cluster picture — planes, namespaces, Helm templates, isolation tiers, multi-instance, Workload Identity. |
| **Monorepo boundaries** | [`docs/agents/monorepo.md`](docs/agents/monorepo.md) | creating/moving an app or library, adding a deployable workload, or changing NX tags/dependency direction. |
| **Build, Test & Infra** | [`docs/agents/infra.md`](docs/agents/infra.md) | building/testing, or editing Terraform/Helm/deploy under `platform/`. |
| **Repository context** | [`docs/agents/repository-context.md`](docs/agents/repository-context.md) | starting or resuming a long-running task, tracing an unfamiliar capability, recording durable context, or deciding whether semantic context belongs in CI. |
| **Workflow & Review Gate** | [`docs/agents/workflow.md`](docs/agents/workflow.md) | planning (`plan.md`/`CHANGELOG.md`), creating or updating a PR/stack, writing commit messages, or hitting the review gate. |
| **Release versioning (pre-1.0)** | [`docs/agents/versioning.md`](docs/agents/versioning.md) | changing the database schema, the release manifest, or the repository version — the baseline-only policy: what the current manifest binds, what the checker enforces, and how a schema change is made. |
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
| `architecture` | Sonnet | Preflight and post-diff review for new/moved apps or libraries, changed trust or responsibility boundaries, and demonstrated module-cohesion problems. Checks app ownership, dependency direction, thin routed pages, IAM, package documentation, and direct replacements. Read-only; returns concrete PASS/BLOCK findings. |
| `review` | Haiku | Independent, fresh-context code review of a changed slice — correctness bugs, regressions, security/IAM-policy drift, routed-page/store ownership, maintainability risks, residue, and missing tests. Accepts `DIMENSION: correctness\|security\|maintainability\|residue` for a single-concern pass; mechanical style comes from `scripts/agent-style-check.sh`, while maintainability is evidence-based. Read-only; severity-first. **Required by the review gate before a turn ends** (see [Mandatory Independent Review](docs/agents/workflow.md#mandatory-independent-review-policy-driven-gate)); for larger diffs prefer the `/review-loop` skill, which satisfies the same gate. |
| `review-verifier` | Haiku | Adversarially verifies ONE candidate review finding — default stance: refute it. Returns `CONFIRMED / REFUTED / UNCERTAIN` with a concrete evidence walk. Used for disputed findings or uncertain consequential claims; also useful standalone before acting on a risky claim. |
| `changelog` | Sonnet | Maintain `CHANGELOG.md` in functional, capability-first terms when a phase/track completes or a tag is cut. Reads `plan.md`/`plan-done.md` + git range; writes capability, not commit history. |
| `readme` | Sonnet | Maintain `README.md` as the project front door — the problem, the vision, and what the repo does. Keeps design decisions, phase history, threat models, and deep mechanism OUT (those go to `CHANGELOG.md`/`plan-done.md`/the docs site). |
| `component-manager` | Sonnet | Frontend component-system owner. Pair it with the frontend implementer before and after a screen/feature change to map regions to approved component states, map routed-page responsibilities to page/store/mapper/presentational owners, extend/compose/extract only where needed, and maintain visual/behaviour/accessibility contracts. Applies component-system changes when explicitly asked; otherwise returns an evidence-backed handoff and `PASS`/`BLOCK` gate. |
| `observability` | Sonnet | Telemetry + logging in one (they share the `@opencrane/backend/observability` lib and trace-wrap seam). Audits or wires a slice so external-I/O paths are traced (`___DoWithTrace` spans) and output is structured (no raw `console.*`, secrets redacted, errors under `err`), plus per-app `instrument.ts`/shutdown-flush/Helm env. Reads the lib barrel each run for current API names. |
| `deploy` | Sonnet | Deploy/retirement executor + diagnostician for dev/staging clusters. Mutates the cluster ONLY via app-owned deploy or teardown scripts under `apps/_infra/deploy-k8s/`; reads freely for diagnosis (kubectl read verbs, helm status, read-only SQL through the cnpg primary). Reads `docs/agents/deploy-ledger.md` and the current release manifest before every run; returns a structured run report (findings classed `chart`/`script`/`config`/`codebase`/`data`/`infra`/`flake`) for `/deploy-loop` to triage. Never edits code. |
| `release-manager` | Sonnet | Exceptional release orchestrator for explicitly selected medium/major work or an explicit release request — never for ordinary PRs. Freezes and repairs the cumulative candidate through reviewed PRs, commits the functional changelog before qualification, requires fresh-install proof on one immutable SHA (predecessor-upgrade proof returns with the MVP upgrade contracts), delegates authorized cluster mutation to `deploy`, and closes the tag and ledger only after live proof. |
| `memory-engineer` | Sonnet | Memory-layer specialist — the personal/org memory gateway boundary (`libs/backend/server/infra/memory-gateway-client`), the personal memory-fact catalog (`libs/backend/agents/personal/memory/main`), the shared contracts in `libs/contracts/src/memory/memory.types.ts`, and the operator-side Cognee wiring behind the gateway (identity, persistence, LLM/embedding routing through LiteLLM). Use when changing/auditing anything memory-related or when memory isn't recalling/persisting. Enforces the standing policy: **every read and write goes through the gateway port — never a direct Cognee call from a scattered call site**; Cognee holds durable fact content while OpenCrane's catalog holds only metadata, provenance, consent, sensitivity, and a content digest; and a recall must name the gateway-native dataset frozen in the admitted run snapshot, never select one from a subject id alone. Grounds every claim in the package barrels and the live wiring, never a stale doc. Audits by default; applies when asked. |
| `comments` | Sonnet | Comment and docstring specialist for consequential contracts, unresolved documentation findings, or explicit documentation work. Runs after relevant review and deletions. Writes plain, evidence-backed comments with depth proportional to consequence; never changes code or invents a reason. Ordinary documentation stays with the implementer. |
| `reaper` | Sonnet | Pre/post deletion review for replacements requiring a survivor/drop decision. Finds superseded code, exports, config, tests, deployment wiring, and documentation. No compatibility shims or deprecation periods. Ordinary residue stays with the integrated reviewer. Read-only, with evidence. |

**Roadmap execution** uses `.claude/commands/execute-plan.md`: define the user outcome and immutable
review base, dispatch independent implementation lanes, validate the changed responsibilities,
perform required independent review, and commit/push each coherent slice when authorized.

**Specialists follow the change's risk.** Ordinary bounded work uses the implementer and one
integrated reviewer when `.claude/review-policy.md` requires review. Architecture pre/post applies
to new or moved deployables/libraries, changed trust or responsibility boundaries, and demonstrated
module-cohesion problems. Reaper pre/post applies to replacements needing a survivor/drop decision.
The integrated reviewer covers ordinary cohesion and residue. The implementer owns ordinary
comments; call `comments` after code settles for consequential contracts, unresolved documentation
findings, or explicit documentation work. The dispatch decision follows these scope rules once per slice.

**Decomposition is part of delivery.** Keep `opencrane` production source bootstrap-only and group
library internals by capability and role. For frontend changes, inspect the complete screen,
including inherited presenters, templates, styles, stores, and component contracts. Extract a
cohesive interactive region even with one consumer. Before removing reusable component
infrastructure, the component-manager and reviewer must name its consumers, supported states,
coverage, and the surviving owner of each still-needed capability. Do not replace it with page
markup or delete stories to conceal missing states. See the folder and removal rules in
[`monorepo.md`](docs/agents/monorepo.md) and [`angular.md`](docs/agents/angular.md).

**Independent review** uses `.claude/commands/review-loop.md` for explicit base/head SHAs and
separate source overlays. Default to one integrated reviewer. Parallel dimensions and adversarial
verification are available for independent risk areas, disputed findings, and uncertain consequential
claims. Reuse supplied green checks for unchanged code. Resolve Critical/High findings before
completion; lesser suggestions do not automatically open another cleanup cycle. Live PR ancestry
remains required at PR/push/rebase and handoff checkpoints and in CI.

**Deploy fleet** is the `/deploy-loop` **skill** (`.claude/commands/deploy-loop.md`): preflight →
one `deploy` agent run (script-only mutations) → triage every finding into a fix PR (chart/script/
config, defended with run evidence and conceded quickly when disputed), a GitHub issue (codebase/
data), or a design question to the user → friction mined into configuration simplifications (2
sightings = fix it) → a docs-coverage pass (`scripts/config-docs-coverage.sh` checks the explicit
operator-input contract; the `website` agent documents one missing batch per run) → ledger append
(`docs/agents/deploy-ledger.md`, the fleet's cross-run memory).

**Release management is exceptional**, not a gate on every PR. Invoke `release-manager` only after the
user explicitly selects medium/major work for readiness or explicitly asks to release, tag, or deploy a
named candidate. It freezes the complete previous-tag-to-candidate composition, repairs release
blockers through reviewed PRs, requires fresh-install proof on the same SHA — pre-1.0 that is the
only supported installation path; predecessor-upgrade proof returns with the MVP upgrade contracts
([`docs/agents/versioning.md`](docs/agents/versioning.md)) — then locks inputs and delegates the only
cluster-writing step to `deploy`. It freezes the
functional changelog before qualification; a final tag and ledger closure follow live proof. Any repair
invalidates earlier evidence and restarts candidate assembly. Deployment and tagging are separately
authorized: a deploy request never silently creates a release tag. The `/release-manager` workflow
enforces this order: admit and freeze, converge and validate, freeze the changelog and prove the
installation path, delegate an authorized deployment, close an authorized tag, then record the ledger
and plan result.

**Built-in platform agent types** (available via the Agent tool, not repo-defined): `Explore`
(read-only broad search — locating code across many files), `Plan` (design an implementation plan),
`general-purpose` (multi-step research/execution). The `architecture` and `angular` types also apply
to the WeOwnAI repo, which still owns the fleet app and the FORK libs (`core`, `platform`,
`state/core`, `state/gateways`, `state/tenant/adapter`) shared with
`libs/frontend/*` here.

When adding a new agent, write the definition once in `.claude/agents/<name>.md`, add a row above, and
mirror it to the other two harness surfaces so Claude Code and Codex behave the same:

| Surface | Path | Format |
|---------|------|--------|
| Claude Code | `.claude/agents/<name>.md` | Markdown body, YAML frontmatter (`name`, `description`, `tools`, `model`). This is the source the other two are generated from. |
| Codex | `.codex/agents/<name>.toml` | `name`, `description` (the frontmatter description flattened to one line, quotes escaped), `developer_instructions = """<body>"""`. |
| Generic skills | `.agents/skills/<name>/SKILL.md` | Byte-identical copy of the `.claude/agents/` file. Mirror the agents that read as documentation or review skills. |

A mirror that drifts is worse than a missing one, because only one harness then follows the rule. After
editing any agent, `diff` the skills copy against `.claude/agents/` and confirm the TOML still parses
(`python3 -c "import tomllib,pathlib; tomllib.loads(pathlib.Path('.codex/agents/<name>.toml').read_text())"`).
Do not reintroduce a parallel `.github/agents/` copy. Add a user-invocable workflow as a skill under
`.claude/commands/`, and describe its gate order here as well, since Codex has no `.claude/commands/`
surface and reads this file instead.


<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax


<!-- nx configuration end-->
