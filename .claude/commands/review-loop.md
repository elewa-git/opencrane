---
description: Cost-tiered independent review — free style script, parallel single-dimension haiku finders, adversarial verification of every candidate, merged severity-first report.
argument-hint: "[files / git range — default: working tree vs HEAD]"
---

You are orchestrating the OpenCrane review pipeline. The design principle: **spend the
cheapest resource that can do each job** — a shell script for mechanics, haiku for
single-concern finding and refuting, sonnet only to confirm the findings that matter
most. Satisfies the review gate in `docs/agents/workflow.md` § Mandatory Independent
Review.

Scope from the caller: **$ARGUMENTS** (if empty, review the working tree vs `HEAD`).

## Tier 0 — free (no model)

1. Determine the diff: `git diff --stat HEAD` (or the caller's range/files). If there
   are no reviewable changes, say so and stop.
2. Run `scripts/agent-style-check.sh` (pass the same range/files if the caller named
   any). Keep its output verbatim — it goes in the final report as-is. Do NOT spend
   any agent time on style beyond this.

## Tier 1 — cheap finders (haiku)

**Small-diff short-circuit:** if the diff is under ~80 changed lines, spawn ONE
`review` agent covering all dimensions (no `DIMENSION:` line) and skip to Tier 2.

Otherwise fan out THREE `review` agents **in a single message** (they are independent),
each prompt containing:

- `DIMENSION: correctness` / `DIMENSION: security` / `DIMENSION: residue`
- The scope (files or git range) and any context you have (what the change is meant to
  do, what is intentionally gated off or mock-only — this prevents false positives).
- "Skip step 3 of your procedure (the style script) — the orchestrator already ran it."

Skip the `security` finder when the diff plainly touches no auth/route/token/secret/
RBAC/network surface, and the `residue` finder when the change adds no replacement for
an existing mechanism (pure addition). Say in the report which finders you skipped and
why — never skip silently.

**Rewrite-freeze override:** never skip the residue finder for R0-R10 green, migration, or
decommission work, even when the diff looks purely additive. New green code must be checked for
legacy imports/compatibility/fallback residue, and migration code must be checked for runtime reach
and expiry. The dedicated `reaper` gate remains mandatory; this finder does not replace it.

## Tier 2 — adversarial verification

1. Collect all candidate findings. Dedupe: same `file:line` + same defect = one
   candidate (keep the highest severity).
2. If there are zero candidates, skip to Tier 3 — do not spawn verifiers for nothing.
3. For each candidate spawn a `review-verifier` agent — all of them **in one message**.
   Model tiering:
   - candidate severity **Critical or High** → `model: sonnet` (a wrong high-severity
     claim is the most expensive mistake in either direction);
   - **Medium or Low** → default (haiku).
   Each verifier prompt: the single claim, its `file:line`, the finder's reasoning, and
   the caller context.
4. Apply verdicts: REFUTED → drop (keep a one-line note). UNCERTAIN → move to *Open
   questions*. CONFIRMED → keep, with the verifier's severity adjustment.

## Tier 3 — merged report

Produce one report, sections in order:

1. **Findings** — Critical, High, Medium, Low; only CONFIRMED items; each with
   `file:line`, defect, why it matters, fix direction. Style-script ERROR lines go
   under Low as a compact block (verbatim), WARN lines only if a finder confirmed them.
2. **Open questions / assumptions** — UNCERTAIN verdicts and finder questions.
3. **Refuted candidates** — one line each: the claim and why it died (this is signal
   about finder quality, and prevents the same false positive resurfacing next run).
4. **Residual risks / testing gaps.**
5. **Summary** — one paragraph: verdict on the change, plus which tiers/finders ran
   and which were skipped.

If the review gate invoked this pipeline, resolve every Critical and High finding
(fix or justify) before ending the turn — same rule as a direct `review` delegation.
