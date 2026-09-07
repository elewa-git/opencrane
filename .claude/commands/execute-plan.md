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

Classify the selected slice once. Use an architecture preflight and post-diff check when it adds or
moves a deployable/library, changes a trust or responsibility boundary, or has a demonstrated
module-cohesion problem. Use reaper pre/post only when replacing a mechanism requires an explicit
survivor/drop decision. Ordinary fixes use the implementer and integrated reviewer for residue and
cohesion. A file count or a roadmap label alone does not require specialist dispatch.

Apply each requirement to its relevant scope:

1. For a structural, trust, or demonstrated cohesion change, delegate to `architecture`.
   For every proposed cluster workload require the
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
6. For a replacement, delegate `PRE-SLICE DIRECT-REPLACEMENT` to the `reaper`. Remove `DROP` work from the
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
- **Commit each validated, reviewed slice** (see Commit cadence) — do not leave finished, green slices uncommitted.
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

## Commit cadence

Commit each coherent slice after its relevant validation and required review. Include ordinary
comments and package documentation in that commit. Do not create an extra commit merely to mark
another specialist handoff. Push as each slice lands when the user has authorized pushing.

Use a feature branch, a gitmoji imperative subject under 72 characters, and the configured git
author. Never add an AI co-author trailer or stage unrelated files.

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

1. Read the selected plan entry and controlling issue/ADR. State the user-visible outcome and
   acceptance criteria; record the immutable `WAVE_BASE` and intended integration SHA.
2. Classify structural, replacement, security, schema, and user-interface impact. Run only the
   applicable preflights above; resolve concrete BLOCK findings before dependent implementation.
3. Implement the smallest useful slice. Keep package documentation and tests with the code. Schema
   changes follow `docs/agents/versioning.md`; no compatibility or transition scaffolding is added.
4. Apply the applicable reaper and architecture post-diff findings. The integrated reviewer covers
   ordinary residue and cohesion when no separate specialist is needed.
5. Run relevant focused Nx tasks and changed guard contracts. At the wave gate run
   `npm run lint:boundaries` and the affected targets against `WAVE_BASE`. Reuse green evidence for
   unchanged code. Mechanical scripts, render checks, and authority proofs follow the changed
   responsibility; they are not an unconditional whole-repository checklist.
6. When policy requires independent review, delegate one integrated `review` pass with exact
   `WAVE_BASE` and head SHAs and separate staged, unstaged, and untracked overlays. Supply validation
   evidence so it need not be rerun. Use parallel dimensions only for large independent risk areas.
   Resolve Critical/High findings; verify disputed or consequential findings separately.
7. Document the decisions in the owning code and package README. Call `comments` after code settles
   only for consequential contracts, unresolved documentation findings, or explicit documentation
   work. Comments-only changes need their relevant syntax/lint/doc checks, not another full test wave.
8. Update `plan.md` with implemented, validated, and blocked facts. Commit the coherent slice and
   push when authorized. Refresh live ancestry at PR/push/rebase checkpoints; the installed Stop
   hook remains an additional check until its separate change is approved. If a blocker needs
   unavailable input, record it and continue independent accepted work.

At the final replacement phase, run `WHOLE-REPO-DECOMMISSION` against the entire repository; a
diff-local clean result is insufficient.

## Output

Report the delivered user capability, the relevant validation and independent-review result, the
pushed commit/PR, and any remaining blocker. Name specialist verdicts only for specialists that
were needed. Distinguish source implementation, CI qualification, deployment, and live journey
proof; do not repeat unchanged historical evidence.
