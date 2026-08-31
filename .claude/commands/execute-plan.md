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
   Any pod-bearing workload in the OpenCrane release without an `apps/<name>` or deployment-only
   `apps/_infra/<name>` root is a blocker.
2. Place reusable logic under a functional-first library root (`libs/models`, `libs/util`,
   `libs/backend`, `libs/frontend`) and then its bounded capability. Server-only runtime adapters
   belong under `libs/backend/server/infra`. Apps contain only
   entrypoint/composition/configuration/build/deployment wiring. Models remain dependency-light and
   cannot import databases, HTTP, Kubernetes, filesystems, frameworks, or apps.
3. Require reuse discovery before adding a new app, library, route, event/topic, chart template, or
   adapter. Record exact search terms, candidates, and the reuse/extend/new decision; code already
   classified for deletion is not a reuse candidate.
4. Require a communication matrix for every cross-process edge: public ingress, internal
   request/response, or internal message bus. Record contract, identity/authorization, NetworkPolicy,
   and failure semantics; do not expose an internal app merely for service-to-service calls.
5. Require NX registration plus distinct `type:app|lib`, functional `layer:*`, and bounded-capability
   `scope:*` tags with machine-enforced dependency direction. Apps never import apps; libraries
   never import apps; frontend never imports backend implementations; models are the bottom layer;
   cross-project imports use public barrels. The initial structure gate replaces the current
   layer-shaped scope tags before other target packages rely on them.
6. Delegate `PRE-SLICE DIRECT-REPLACEMENT` to the `reaper`. Remove `DROP` work from the
   implementation scope except for same-slice deletion; do not repair or refactor code that the
   target architecture retires.

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

## Direct-replacement constraints

- This repository is building a new product. Implement the accepted target architecture directly
  and treat the prior runtime as source code to replace and delete, not a system to preserve.
- Replacement code has no OpenClaw/retired imports, backwards-compatibility shims, deprecated
  aliases, dual writes, legacy fallbacks, legacy tooling, or legacy-shaped inputs.
- Classify touched code as `SURVIVE` or `DROP`. Do not fix, rename, abstract, add tests to, or
  otherwise improve a path classified for drop; delete it when its replacement lands.
- Implement each capability once in the target boundary. Do not create a temporary legacy version.
- Every replacement slice carries the superseded code, tests, exports, config, deployment wiring,
  and docs it can safely delete in the same slice. Version control preserves history.

## Commit cadence (commit at every gate)

- A *gate* is any checkpoint the work clears: the per-slice/per-wave **build + test** gate and the
  **independent review** gate. Commit *during* (when a slice's gate goes green) and *after* (once review
  passes) so each commit is a coherent, green, bisectable checkpoint.
- On a feature branch only — if on the default branch, branch first.
- Messages follow `AGENTS.md` → Commit Messages (gitmoji + imperative subject under 72 chars).
  **Do not add a Claude / AI co-author trailer** (`Co-Authored-By: Claude …`) — the commit is authored
  solely by the configured git user.
- Committing is local. Pushing / opening a PR is a separate, outward-facing action — only on explicit request.

## SHA-bound long-running checkpoints

- At wave start record `WAVE_BASE`, the intended integration ref, and its fetched SHA. Persist the
  immutable base for the local Stop gate with
  `git config "branch.$(git branch --show-current).opencraneWaveBase" "$WAVE_BASE"`. Do not use a
  moving branch name as review evidence.
- After every wave commit, review-fix commit, rebase, authorized push, PR open/edit/base change, and
  at least hourly during an active long-running task, refresh the live PR graph with
  `npm run check:pr-stack-integrity -- --current-branch "$(git branch --show-current)"`.
- A parent rewrite invalidates every descendant. Restack and revalidate the full descendant chain
  before starting unrelated work.
- When a parent PR merges, retarget its direct child to the integration branch before the child is
  merged. Merging the child into the already-merged parent branch closes the PR without landing its
  work on integration.
- Validate two ranges before handoff: the incremental live `base...head` PR diff and the cumulative
  integration-SHA-to-stack-tip range. Record exact SHAs for both. When integration is not ancestral
  to the tip, also run `git merge-tree --write-tree <integration-sha> <tip-sha>`; a three-dot diff
  alone cannot expose integration-side conflicts.
- Treat committed `WAVE_BASE...HEAD`, staged, unstaged, and untracked changes as separate review
  overlays. Any change to a SHA, PR base, remote head, or overlay invalidates earlier evidence.

## Procedure

1. Read `plan.md` once, then read the selected entry, linked implementation issue, and controlling
   design/ADR completely. Extract only accepted, unblocked acceptance criteria.
2. Run the architecture and reaper preflight above. Build the deployable/dependency ledger and the
   survivor/drop classification; stop on any BLOCK.
3. Read `docs/agents/versioning.md`. Note database-schema and PostgreSQL-operand impact in the wave
   ledger. A schema change updates `target-baseline.sql` and the current release manifest's
   baseline digest; pre-1.0 there are no per-app version stamps or version-to-version transitions.
4. Pick the smallest high-impact slice, build its dependency DAG/wave, state the direct target in
   one sentence, record `WAVE_BASE=$(git rev-parse HEAD)`, then implement it without compatibility
   scaffolding. Also record the intended integration target (`origin/main` or the explicitly chosen
   protected feature integration branch) and its fetched SHA.
5. Implement the selected slice(s), including tests and any required docs/config
   updates, following AGENTS.md conventions as you write — not as a cleanup pass. When a slice
   changes a package's public surface, boundary, invariant, owned models, or config, update that
   package's `README.md` in the same slice; when it adds a package, create the README from
   `docs/agents/README-TEMPLATE.md` and add it to the parent index (see `docs/agents/package-docs.md`).
6. **Reap before validation or commit.** Delegate `POST-SLICE DIRECT-REPLACEMENT`, apply every
   proven DELETE/REWRITE and resolve every `FORBIDDEN-REPLACEMENT` item. Run the resulting
   diff through `architecture` and resolve every BLOCK.
7. Run `scripts/agent-style-check.sh`, `npm run check:release-versioning`,
   the relevant NX project build/test/lint targets, and any
   manifest-rendering ownership/security checks. Use `npm run build|test -w <package>` or
   `npx nx run <project>:<target>` for a slice, then `npm run lint:boundaries` and
   `npx nx affected -t build test lint --base="$WAVE_BASE"` at the wave gate. Omitting `--head`
   includes the wave's uncommitted changes without revalidating all accumulated green history. One
   cycle per gate.
8. If a blocker is hit, record it in plan.md and move to the next unblocked item.
9. Update the `plan.md` checklist/state to reflect exactly what changed this cycle.
10. **Commit each slice only after reaper PASS, architecture PASS, and validation are green** —
   feature branch only, gitmoji +
   imperative subject, **no Claude/AI co-author trailer** (see Commit cadence).
11. **Delegate a review pass to the `review` subagent** with the exact `WAVE_BASE` and current
   `HEAD` SHAs plus separate staged, unstaged, and untracked manifests. Never default to
   `git diff HEAD` after committing: that hides the slice being reviewed. Resolve Critical/High
   findings. If review fixes change replacement/deletion boundaries, rerun reaper and architecture,
   revalidate, commit the resolution as a separate checkpoint, and review the refreshed explicit
   range again. Do not push or open a PR unless explicitly asked.
12. **Delegate the documentation gate to the `comments` subagent** once review has concluded and no
   further code changes are pending — it runs last because `reaper` has by then deleted what the
   slice superseded and review fixes have stopped moving the code. Give it the same explicit
   `WAVE_BASE...HEAD` range **and** the plan slice or issue behind the work: it may only document a
   *why* it can point at, so without the decision record it can only return questions. Apply its
   writes, answer its **ASK** list in your output rather than leaving the questions open, and commit
   the comment changes as their own checkpoint. A long ASK list is the gate working.

At the final replacement phase, run `WHOLE-REPO-DECOMMISSION` against the entire repository; a
diff-local clean result is insufficient.

## Output (return in this order)

1. **Implemented items** — one bullet per completed item with acceptance criterion met
2. **Architecture gate** — deployable inventory, library boundaries, PASS/BLOCK
3. **Reaper gate** — preflight classification and post-slice deletions
4. **Validation** — build, test, lint, boundary, and relevant render/security evidence
5. **plan.md updates** — exactly which items changed state
6. **Blockers** — items skipped and why (BLOCKED annotation, missing decision/tooling, etc.)
7. **Review findings summary** — from the review subagent, with resolution status
8. **Documentation gate** — from the `comments` subagent: what it documented, and every unanswered
   **ASK** with your answer, since an unexplained why is a finding about the change itself
9. **Commits** — the gate commits made this cycle (branch + subject line per commit)

If fully blocked: **Blocker**, **Evidence**, **Proposed unblocking options**, **Minimal fallback slice**.
