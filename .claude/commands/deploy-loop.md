---
description: Deploy fleet orchestrator — put dev/staging live via the deploy scripts only, triage every failure into a fix PR / issue / design question, mine friction into config simplifications, and run the docs-coverage pass.
argument-hint: "[dev|staging] [fleet|clustertenant] [extra deploy flags]"
---

You are orchestrating an OpenCrane deploy run end-to-end. The fleet's contract with
the humans: **the cluster only ever changes through the deploy scripts, and every
lesson a run teaches becomes a PR, an issue, or a documented answer — never tribal
knowledge.** Each phase spends the cheapest resource that can do the job.

Target from the caller: **$ARGUMENTS** (env defaults to `dev`, profile to `fleet` —
`apps/fleet-platform/deploy.sh`; `clustertenant` means
`apps/_infra/deploy-k8s/deploy.sh`).

## Phase 0 — preflight (main session, no subagents)

1. Read `docs/agents/deploy-ledger.md` § Standing lessons and § Simplification
   counters — they steer everything below.
2. Read `docs/agents/versioning.md` and resolve the current release manifest
   (`releases/<version>.json`): the database baseline digest and PostgreSQL operand image it binds.
   Pre-1.0 there is no source release or database transition to resolve — an existing silo on an
   older schema is rebuilt, never upgraded in place.
3. Working tree must be clean and on a known sha (record it). If dirty, stop and ask.
4. Confirm `kubectl config current-context` plausibly matches the target env. **If
   ambiguous, ask the user — a wrong-context deploy is the one unrecoverable
   mistake.** This is the only mandatory question; everything else proceeds
   autonomously.

## Phase 1 — deploy run (the `deploy` agent)

Spawn ONE `deploy` agent with: env, profile, extra flags, the relevant ledger
lessons, and the values preset to use (`apps/_infra/deploy-k8s/platform/values/opencrane-dev.yaml`
for dev unless the caller said otherwise). It deploys via the scripts, verifies
liveness, and returns the structured run report (RUN/OUTCOME/TIMELINE/FINDINGS/
FRICTION/LEDGER).

While it runs, do nothing else with the cluster — two writers is how drift starts.

## Phase 2 — triage every finding (main session decides, cheap agents verify)

For each FINDING in the report, route by class — one destination each:

- **`chart` / `script` / `config`** → implement the fix in this repo:
  1. Make the change (chart template, script, values preset, `values.schema.json`
     guard). Validate locally: `helm lint` + `helm template` (default and the failing
     values), `bash -n` for scripts, and the app-owned current-chart-sources helper,
     which packages the checked-out `file://` dependencies in a disposable fixture.
  2. Confidence gate before it becomes a PR: run the `review` agent (or `/review-loop`
     for a multi-file fix) on the diff.
  3. If the failure is cheap to re-test and the env is dev, re-run Phase 1 once to
     prove the fix; say so in the PR. If not re-testable now, the PR says that too.
  4. Open a PR per coherent fix (not one mega-PR): title states the failure it fixes,
     body carries the run evidence verbatim (that IS the defence). **Defend the PR
     only when necessary:** answer reviewer questions with run evidence; if a reviewer
     pushes back and the evidence is not decisive, concede and close rather than
     argue — a disputed auto-fix is a design question, so convert it to one.
- **`codebase`** → GitHub issue (`gh issue create`), per the repo convention: context
  + evidence + a todo checklist. Label it, link the run. Do NOT fix app code from a
  deploy run — that change deserves its own workstream.
- **`data`** → GitHub issue with the read-only SQL evidence (counts/ids, never secret
  values). Never mutate data to make a deploy pass.
- **`infra`** → ledger note; if it implies a policy choice (quotas, DNS ownership,
  IAM grants), raise it as a design question.
- **`flake`** → ledger note with retry evidence; two sightings of the same flake
  graduates it to a real finding.

**Design questions** (this is where the fleet is allowed to ask): when a finding
exposes a real decision — two defensible defaults, a security/convenience trade,
an isolation-tier implication — ask the user with concrete options and your
recommendation first. Do not ask about anything a preset, the ledger, or the docs
already answers.

## Phase 3 — configuration simplification (make next runs cheaper)

1. Merge the report's FRICTION lines into the ledger's Simplification counters.
2. Any counter reaching **2** becomes work NOW: prefer deriving/defaulting a value in
   the chart or script (the `--auto-ingress-ip` pattern — derive, don't demand) over
   documenting a workaround. Ship it through the same Phase-2 PR pipeline.
3. The direction of travel: every run should need fewer flags than the last. A new
   required flag added by any fix PR must justify itself in the PR body.

## Phase 4 — docs run (script finds gaps, `website` agent closes them)

1. Run `scripts/config-docs-coverage.sh --strict`. It checks the explicit contract of public
   umbrella inputs: every top-level values key is classified as an operator input, an app-forwarded
   value, or an internal chart value, and each operator input names its documentation.
2. If gaps exist, delegate to the `website` agent: document the **top-level section
   with the missing operator inputs** (one coherent batch per run, not all 500 —
   sustainable beats heroic), in the operators section. Do not document forwarded or internal keys
   merely to silence the check: classify them with their owning app or chart instead. The website
   agent builds to validate links as usual.
3. Anything the deploy run itself proved about configuration behaviour (a flag's real
   default, an ordering constraint) goes to the website agent as ground truth to
   include — deploy evidence is the best documentation source there is.

## Phase 5 — close the loop

1. Append the run's LEDGER block to `docs/agents/deploy-ledger.md` (rewrite any
   standing lesson the run just fixed to a `fixed → PR #NNN` pointer).
2. Commit the ledger + docs changes on this branch; PRs from Phase 2/3 ride their own
   branches.
3. Final report to the user: outcome, findings table (class → destination link),
   simplification counters that moved, docs coverage delta, and open design questions.

Recurring use: run `/deploy-loop` after merges that touch an app-owned `deploy.sh`,
`apps/_infra/deploy-k8s/platform/`, or either chart — or on a cadence via `/loop`. The ledger makes
each run start smarter than the last; keep it terse so that stays cheap.
