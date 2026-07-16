---
description: Execute accepted roadmap slices through architecture, implementation, deletion, validation, and review gates.
argument-hint: "[target plan section / phase] [constraints]"
---

You are executing the OpenCrane roadmap. Turn roadmap items in `plan.md` into
implemented, validated code changes while keeping the plan document accurate.

Target / constraints from the caller: **$ARGUMENTS**
(If empty, ask which plan section or phase to target before implementing anything.)

## First — load the rules

Read `AGENTS.md` at the repository root before writing any code. It is the canonical
rule set (coding conventions, IAM-first policy, planning discipline, commit format).

## Read the target once, completely

- Read `plan.md` once at loop start to confirm current sequencing and whether the target is accepted.
- Read the selected phase/item, every linked implementation issue, and its controlling design/ADR
  completely. `plan.md` is the sequencing index; linked issues/designs carry acceptance detail.
- Do not repeatedly re-read unchanged planning files inside a slice; pass their exact constraints to
  every lane.

## Efficiency rules (follow these to avoid slow sessions)

- **Act at the first clear signal.** Do not spend multiple rounds investigating before
  touching files. If the item has acceptance criteria and file anchors, start immediately.
- **One build + test cycle per slice.** Do not run redundant validation rounds.
  If build passes and tests pass, that is the evidence — move on.
- **Report blockers immediately.** If an item is blocked (missing decision, missing
  tooling, BLOCKED annotation in plan), record it and skip to the next item.
  Do not investigate the blocker further unless explicitly asked.

## Scope

- Execute concrete implementation tasks from `plan.md` that fit in the current cycle.
- Default to completing all unchecked items in the selected target phase, unless an
  item is blocked by a missing decision or external dependency.
- Update `plan.md` status/checklists in the **same cycle** as the code and validation.

## Architecture and deletion preflight

Before building the dependency DAG:

1. Delegate the target to the `architecture` agent. For every proposed cluster workload require the
   inventory `workload/kind -> image/entrypoint -> apps/<root> -> NX project -> deployment wiring ->
   libs -> KSA/RBAC -> network boundary -> state/PVC`.
   Any pod-bearing workload in the OpenCrane release without an `apps/<name>` root is a blocker.
2. Place reusable logic under a functional-first library root (`libs/models`, `libs/util`,
   `libs/backend`, `libs/frontend`, `libs/infra`) and then its bounded capability. Apps contain only
   entrypoint/composition/configuration/build/deployment wiring. Models remain dependency-light and
   cannot import databases, HTTP, Kubernetes, filesystems, frameworks, or apps.
3. Require reuse discovery before adding a new app, library, route, event/topic, chart template, or
   adapter. Record exact search terms, candidates, and the reuse/extend/new decision; frozen-blue
   drop/archive paths are not green reuse candidates.
4. Require a communication matrix for every cross-process edge: public ingress, internal
   request/response, or internal message bus. Record contract, identity/authorization, NetworkPolicy,
   and failure semantics; do not expose an internal app merely for service-to-service calls.
5. Require NX registration plus distinct `type:app|lib`, functional `layer:*`, and bounded-capability
   `scope:*` tags with machine-enforced dependency direction. Apps never import apps; libraries
   never import apps; frontend never imports backend implementations; models are the bottom layer;
   cross-project imports use public barrels. The first R2 structure gate migrates the current
   layer-shaped scope tags before other green packages rely on them.
6. Delegate `PRE-SLICE` plus the applicable phase mode (`GREEN-SLICE`, `BLUE-EXCEPTION`,
   `MIGRATION`, or `R10-DECOMMISSION`) to the `reaper`. Remove `DROP/ARCHIVE` work from the
   implementation scope; do not repair or refactor code that the target architecture retires.

Resolve every architecture BLOCK before implementation. An unresolved product decision remains a
blocker; do not hide it behind an interface.

## Parallelisation (maximise it)

- Before implementing, decompose the target into a **dependency DAG + waves**. Dependencies are
  *compile-time type coupling* and *file/package contention* only — logical affinity is **not** a
  dependency. Items with no unmet dependency form a wave and run concurrently.
- Land a small **keystone** first (shared types/contracts/interfaces) to open the widest wave.
- **Dispatch one `general-purpose` subagent per independent lane in a single message** so lanes run
  concurrently; reserve a lane per package to avoid edit contention. Never serialise work that has
  no dependency between lanes.
- If `plan.md` already encodes an execution chain / waves for the track (e.g. Track CT), follow it.
- Each lane still obeys the efficiency rules: act at first signal, one build + test cycle per slice.

## Constraints

- Do not treat strategic roadmap statements as automatically implementable. Only
  implement scoped items with clear acceptance criteria.
- Treat unresolved architecture-checkpoint questions in `plan.md` as **blockers** —
  do not guess hidden product decisions.
- Do not mark items complete in `plan.md` without code **and** validation evidence.
- **Commit at every gate** (see Commit cadence) — do not leave finished, green slices uncommitted.
- Never commit to the default branch (branch first), and **never push or open a PR unless explicitly asked**.
- Never rewrite shared history.
- Never revert unrelated user changes.

## Rewrite-freeze constraints (R0-R10)

- The route is not executable until R0 records acceptance, estate classification, data disposition,
  rollback truth, owners, and accepted ADRs. Do not infer those decisions from preference for a
  rewrite.
- Do not start green construction until the R1 stabilization/freeze gate it depends on is evidenced.
- Green is direct target architecture: no OpenClaw/retired imports, backwards-compatibility shims,
  deprecated aliases, dual writes, legacy fallbacks, or reverse bridge.
- One-way read-only blue exporters and idempotent green importers live in migration tooling; green
  runtime code cannot call them.
- Before touching blue, identify the exact R1 blocker or allowed post-freeze break-fix class. Do not
  fix, rename, abstract, add tests to, or otherwise improve a legacy path classified for drop unless
  the minimum change is required for safe export/cutover.
- Implement capabilities once in green. Do not create a temporary blue version.
- Every replacement slice carries its own same-slice deletion set or a named later deletion gate
  tied to a concrete cutover/retention condition.

## Commit cadence (commit at every gate)

- A *gate* is any checkpoint the work clears: the per-slice/per-wave **build + test** gate and the
  **independent review** gate. Commit *during* (when a slice's gate goes green) and *after* (once review
  passes) so each commit is a coherent, green, bisectable checkpoint.
- On a feature branch only — if on the default branch, branch first.
- Messages follow `AGENTS.md` → Commit Messages (gitmoji + imperative subject under 72 chars).
  **Do not add a Claude / AI co-author trailer** (`Co-Authored-By: Claude …`) — the commit is authored
  solely by the configured git user.
- Committing is local. Pushing / opening a PR is a separate, outward-facing action — only on explicit request.

## Procedure

1. Read `plan.md` once, then read the selected entry, linked implementation issue, and controlling
   design/ADR completely. Extract only accepted, unblocked acceptance criteria.
2. Run the architecture and reaper preflight above. Build the deployable/dependency ledger and the
   survivor/stabilize/migrate/drop classification; stop on any BLOCK.
3. Pick the smallest high-impact slice, build its dependency DAG/wave, state the direct target in
   one sentence, record `WAVE_BASE=$(git rev-parse HEAD)`, then implement it without compatibility
   scaffolding. Also record the intended integration target: `origin/main` normally or the protected
   green integration branch for rewrite-freeze work.
4. Implement the selected slice(s), including tests and any required docs/config
   updates, following AGENTS.md conventions as you write — not as a cleanup pass.
5. **Reap before validation or commit.** Delegate `POST-SLICE` with the same phase mode, apply every
   proven DELETE/REWRITE and resolve every FORBIDDEN-GREEN/MIGRATION-EXPIRY item. Run the resulting
   diff through `architecture` and resolve every BLOCK.
6. Run `scripts/agent-style-check.sh`, the relevant NX project build/test/lint targets, and any
   manifest-rendering ownership/security checks. Use `npm run build|test -w <package>` or
   `npx nx run <project>:<target>` for a slice, then `npm run lint:boundaries` and
   `npx nx affected -t build test lint --base="$WAVE_BASE"` at the wave gate. Omitting `--head`
   includes the wave's uncommitted changes without revalidating all accumulated green history. One
   cycle per gate.
7. If a blocker is hit, record it in plan.md and move to the next unblocked item.
8. Update the `plan.md` checklist/state to reflect exactly what changed this cycle.
9. **Commit each slice only after reaper PASS, architecture PASS, and validation are green** —
   feature branch only, gitmoji +
   imperative subject, **no Claude/AI co-author trailer** (see Commit cadence).
10. **Delegate a review pass to the `review` subagent** against the changed files. Resolve
   Critical/High findings. If review fixes change replacement/deletion boundaries, rerun reaper and
   architecture, then revalidate and **commit the resolution as a separate post-gate checkpoint**.
   Do not push or open a PR unless explicitly asked.

At R10, run `R10-DECOMMISSION` against the whole repository after the last retention window; a
diff-local clean result is insufficient.

## Output (return in this order)

1. **Implemented items** — one bullet per completed item with acceptance criterion met
2. **Architecture gate** — deployable inventory, library boundaries, PASS/BLOCK
3. **Reaper gate** — preflight classification and post-slice deletions
4. **Validation** — build, test, lint, boundary, and relevant render/security evidence
5. **plan.md updates** — exactly which items changed state
6. **Blockers** — items skipped and why (BLOCKED annotation, missing decision/tooling, etc.)
7. **Review findings summary** — from the review subagent, with resolution status
8. **Commits** — the gate commits made this cycle (branch + subject line per commit)

If fully blocked: **Blocker**, **Evidence**, **Proposed unblocking options**, **Minimal fallback slice**.
