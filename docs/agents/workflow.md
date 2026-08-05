# Workflow, Planning & Review Gate

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.

## Repo State Model

Three files track work, each with a distinct role — keep them from drifting:

- **`plan.md`** — the open backlog: phases/tracks not yet complete. Items carry status; completed tracks leave a one-line `✅ COMPLETE (see plan-done.md)` pointer.
- **`plan-done.md`** — the historical record of finished tracks (large; the detailed "what shipped and how" lives here, e.g. multi-instance Track MI, ClusterTenant CT.*).
- **`CHANGELOG.md`** — capability log; sections map to git tags, `## [Unreleased]` holds in-flight work. Written in functional terms, not commit restatement.

## Planning Discipline

- Keep `plan.md` updated as implementation progresses.
- When a roadmap item changes state due to code, validation, or a discovered blocker, update `plan.md` in the same work cycle.
- Do not leave completed or partially implemented backlog items stale in `plan.md` after landing the corresponding code.
- When a track or phase is **fully complete**, move it out of `plan.md` into `plan-done.md` (the historical record) and leave a one-line `✅ COMPLETE (see plan-done.md)` pointer in its place.
- **When a phase or track completes, update `CHANGELOG.md` in the same work cycle**, version by version (sections map to git tags; in-progress work goes under `## [Unreleased]`). Never let a release/tag land without a corresponding changelog entry.
  - Write entries in **functional, capability-first terms** — *what an operator/tenant/integrator can now do, or do differently, that they couldn't before* — never a restatement of commits. Name a mechanism (flag or endpoint) only when it helps the reader use the feature. Collapse many commits into the single capability they deliver.
  - Delegate this to the **`changelog` agent** (`.claude/agents/changelog.md`, runs on Sonnet), which encodes this style; or follow that file's rules if writing the entry inline.

## PR Ancestry And Single-Review Gate

Before creating, refreshing, rebasing, or reporting a pull request, inspect the **live** PR list and
the candidate's actual commit/diff ancestry. Identify every earlier PR whose branch, commits, or
functional diff the candidate builds on. Resolve each predecessor in exactly one of these ways:

- **Stack it:** set the candidate PR's base to the predecessor's head branch. The candidate diff must
  then contain only its incremental change. Name the review order in the PR body and status report.
- **Absorb it:** include the predecessor completely in the candidate, close the superseded PR, and
  retarget any dependants. The surviving PR becomes the only place where that combined diff is
  reviewed.

Never leave a PR based on the integration branch while its diff repeats an open predecessor. Never
ask for review until `base...head` has been checked against the chosen live base and contains no
already-reviewed predecessor material except an explicitly documented, inseparable absorption.
When neither stacking nor absorption is safe, stop and resolve the ancestry before publishing.

The hand-off must state the resulting stack order, absorbed/closed PRs, and intentionally independent
PRs. A passing check, remembered branch relationship, or similar title is not evidence of ancestry;
re-read the current PR bases, heads, commits, and changed files.

Run `npm run check:pr-stack-integrity -- --current-branch "$(git branch --show-current)"` at every
PR checkpoint. The checker takes two live GitHub snapshots around exact ref fetches, rejects a graph
that changed during inspection, and binds its evidence to every open PR's base/head SHA, incremental
diff digest, stable patch id, parent edge, and topological review level. It fails when an open child
still targets a merged/closed feature branch, when a parent head was rewritten without restacking its
children, or when one open PR contains another outside its declared base chain. Patch ids detect
replayed whole patches; semantic overlap after squashing still needs reviewer judgment.

### Long-running checkpoint cadence

Re-read the live graph and regenerate SHA-bound evidence after every event that can invalidate an
earlier conclusion, and at least once per hour while a task remains active:

| Event | Required checkpoint |
|-------|---------------------|
| Slice/wave commit or review-fix commit | Record the new `HEAD`; review the explicit `WAVE_BASE...HEAD` range plus staged, unstaged, and untracked overlays. |
| Parent push, force-update, or rebase | Re-fetch the parent SHA and restack every descendant before unrelated work continues. |
| Parent PR merged | Before merging its child, retarget that child to the integration branch and prove the merged parent head is now ancestral there. Never merge a child into an already-merged feature branch. |
| Authorized push | Confirm the remote head equals the reviewed local `HEAD`; stale local evidence is invalid. |
| PR open, refresh, edit, or base change | Run the live stack checker and record the PR number, base ref/SHA, head ref/SHA, and review order. |
| Pre-handoff or pre-merge report | Validate both the incremental `base...head` diff and the cumulative integration-base-to-stack-tip range. If integration is not ancestral to the tip, require a clean `git merge-tree --write-tree <integration-sha> <tip-sha>` simulation. |

Treat committed, staged, unstaged, and untracked files as four separate overlays. Never use
`git diff HEAD` as proof of a complete change set: staged and unstaged changes can cancel in that
view, and committed work disappears from it. Evidence from an earlier SHA, base, remote head, or
overlay manifest is stale and must not be reported as current.

At the first wave checkpoint, persist the immutable local review base with
`git config "branch.$(git branch --show-current).opencraneWaveBase" "$(git rev-parse HEAD)"`. The
Stop gate fails closed on a committed pre-PR branch when neither live PR evidence nor this recorded
base exists. Update it only when deliberately starting a new reviewed wave, never to silence a gate.

## Commit Messages

- Always end each work cycle with a suggested commit message.
- **Every commit subject must start with an emoji** that matches the primary intent of the change.
  Use the table below — it is **derived from this repository's own commit history**, so following it
  keeps `git log` consistent with the convention already established here.
- Use imperative mood for the subject line (e.g. `add`, `fix`, `update`, not `added` or `adding`).
- Keep the subject line under 72 characters.
- If the change touches multiple concerns, list them as bullet points in the body. When a secondary
  concern is significant, you may append a second emoji after the first (history does this — e.g.
  `🎱✨`, `🚀 🔧`, `🔧 🔥`); lead with the emoji for the primary intent.
- **Do not add a Claude / AI co-author trailer** (no `Co-Authored-By: Claude …`). Commits are authored solely by the configured git user.

Emoji convention (derived from commit history; the count is how often it already appears):

| Intent | Emoji | Notes / what it has marked here |
|--------|-------|----------------------------------|
| Configuration / tooling / infra wiring (most common) | 🔧 | Helm scaffold, cluster/scope config, deploy plumbing (45×) |
| New feature / capability | ✨ | A new subsystem or API surface (19×) |
| Enhancement / extend an existing capability | ⚡ | Increment to a shipped capability — metrics, versioning, bindings (5×) |
| Bug fix / typing fix / address review findings | 🐛 | (7×) |
| Refactor — no behaviour change | ♻️ | Move shared code, align typing/signals (7×) |
| Move / rename / restructure files | 🚚 | Split `src/` into packages, relocate tests (4×) |
| Remove code, files, or infra | 🔥 | Delete dead infra (e.g. remove Crossplane) (13×) |
| Security / auth / RBAC / TLS / NetworkPolicy | 🔒️ | IAM-first changes (13×) |
| Documentation | 📝 | Docs + `plan.md` updates (14×) |
| Notes / progress / readmes | 📓 | Lighter-weight notes & progress (6×) |
| Architecture / plan / design updates | 🏡 | High-level design & phase planning (6×) |
| Agent / prompt / AI-loop / meta-config | 🎱 | `AGENTS.md`, agent defs, prompt/loop tuning (5×) |
| Cosmetic / UI polish | 🎨 | Visual-only tweaks (10×) |
| Deploy / launch | 🚀 | Launch scripts, local deploy fixes (2×) |
| Tests | 🧪 | Test-only additions |
| Work in progress | 🚧 | Incomplete checkpoint |

When an intent isn't covered above, pick the closest [gitmoji](https://gitmoji.dev/) and prefer
reusing an emoji already in this table over introducing a new one.

## Language-neutral module-growth gate

Before adding substantial production code in any language, run:

```bash
npm run check:module-growth
```

For a branch or PR range, use `npm run check:module-growth -- --diff <base-ref>`. The checker is
diff-scoped and excludes tests, generated code, dependencies, fixtures, and build output.

- A review candidate requires a responsibility inventory and the maintainability review dimension.
- A module that crosses or grows beyond the configured hard maximum must be split or receive a
  temporary exact-path exception with an owner, reason, and expiry.
- Size is only the trigger. Architecture and review findings must demonstrate a concrete cohesion,
  ownership, dependency, ordering, or core-path testing problem.

See [`maintainability.md`](./maintainability.md) for the cross-language policy and exception
contract.

## Mandatory Independent Review (Policy-Driven Gate)

The [self-review compliance table](./typescript.md#self-review-before-finishing) is a self-check and
is not sufficient on its own. A policy-driven `Stop` gate decides — per change — whether an
independent review is required before the turn can end. When the gate asks for review you must:

1. Delegate to the **`@review` subagent** against the changed files — or, for a
   multi-file or risky diff, run the **`/review-loop` skill** (parallel single-dimension
   finders + a `review-verifier` per candidate finding); either satisfies the gate.
2. Resolve every **Critical** and **High** finding it returns — fix it, or justify in
   your response why it is not applicable.
3. Only then finish the turn.

A change to a package's public surface, boundary, invariant, owned Prisma models, or config that
does **not** update that package's `README.md` in the same change is an incomplete change — the
review gate treats a stale or missing package README as a finding. See
[`package-docs.md`](./package-docs.md) for the standard.

Run `scripts/agent-style-check.sh`, `npm run check:prisma-boundaries -- --diff <base-ref>`,
`npm run check:module-growth`, and `npm run check:pr-stack-integrity -- --current-branch <branch>`
before delegating. The first checks TypeScript mechanics and invokes
the same diff-scoped Prisma ownership floor; the explicit Prisma command is useful when reporting
that gate separately; the final command produces language-neutral architecture candidates.
The Prisma gate authorizes exact adapter class/path/contract tuples, raw-query ownership, transaction
ownership, and transaction-scoped repository construction. A policy-only rename or stale
construction declaration is therefore a failing change, not an implicit exemption. Construction
also proves the target constructor and exact callback binding are transaction-scoped; a root client
substitution fails even when the class and import still match policy.
Mechanical errors are cheaper to fix before review, while module-growth warnings give the reviewer
the exact files that need a responsibility inventory.

When a change touches a workload, app composition, agent-domain project metadata, TypeScript alias,
or dependency boundary, run its current boundary guard before review:

- `npm run check:workload-ownership-app-composition` and its negative test for workload ownership,
  rendered profiles, runtime-created Jobs, and thin app roots;
- `npm run check:agent-domain-boundary` and its negative test for personal, shared execution, and
  operator domains.

**How the gate decides**:

- `.claude/hooks/require-review.sh` — a free shell pre-filter. It skips the obvious
  cases (no supported production-source change, trivial size, test/type-only/generated files,
  already-reviewed) and escalates the rest. Its fingerprint includes the live PR-stack evidence,
  committed base range, `HEAD`, staged diff, unstaged diff, and untracked source bodies. It writes
  `.claude/.review-context.md` for the judge.
- In Claude Code, a **Haiku agent hook** reads that context plus `.claude/review-policy.md` in
  parallel with the pre-filter. It judges whether the change carries real risk (auth, secrets,
  network, IAM, money, or non-trivial production control flow) and blocks only when warranted.
- In Codex, `.codex/hooks/require-review.sh` runs the same pre-filter and translates `JUDGE` into a
  blocking `Stop` continuation that requires the independent review agent. Only a fresh, explicit
  `SKIP` lets the turn end; a checker crash, missing context, or unknown verdict blocks closed.

**`.claude/review-policy.md` is the single tunable surface.** If review fires too often
and burns tokens — or misses something — edit that file (threshold, `always-review`
keywords, `never-review-paths`, or the judgment guidance) and record it in its tuning log.

The gate blocks **at most once per stop sequence** (loop-safety via `stop_hook_active`),
so it can never trap a turn — but skipping the review when it fires defeats the purpose.
Treat a block as a hard requirement, not a suggestion.
