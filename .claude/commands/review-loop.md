---
description: Review one explicit change with relevant mechanical evidence and proportionate independent review.
argument-hint: "<base SHA> <head SHA> [owned files and overlay scope]"
---

Review the caller's explicit change: **$ARGUMENTS**. Follow `AGENTS.md` and the risk policy in
`.claude/review-policy.md`. Never default to `git diff HEAD`: it hides committed work.

## Establish scope and evidence

Require immutable base/head SHAs. Inspect their diff plus staged, unstaged, and untracked source
as separate overlays. Resolve a missing base before review. For a PR checkpoint, use the live
ancestry evidence required by `docs/agents/workflow.md`; local review does not prove remote ancestry.

Use supplied mechanical and test results when they cover the same source. Run missing relevant
style, module-growth, ownership, and boundary checks once. Module size identifies a review candidate;
it is not a defect without an ownership, ordering, dependency, or testability problem.

## Independent review

Default to one `review` agent covering correctness, security, maintainability, and residue for the
selected slice. Fan out dimensions only when independent risk areas justify parallel reviewers,
not because the diff exceeds a line-count threshold. Pass the same exact scope and evidence to each.
An ordinary residue check does not require a second reaper; use that specialist when a replacement
needs a survivor/drop decision.

Deduplicate findings. Require a concrete trigger, code evidence, impact, and smallest fix direction.
Use `review-verifier` for disputed findings or consequential claims whose evidence is uncertain.
Do not automatically dispatch another model for every Medium/Low suggestion. Refuted claims are
dropped; uncertainty is reported plainly. Resolve Critical/High findings before the slice closes.

## Documentation and completion

The implementer documents the change, and the reviewer checks that it is understandable. Call the
`comments` specialist after code settles for consequential contracts, unresolved documentation
findings, or an explicit request. Reuse green build/test evidence after proven comments-only edits;
run syntax/lint/doctest checks that can actually change.

Return one severity-first report with actionable findings, uncertainty, relevant validation gaps,
and the reviewed base/head and overlays. Re-review only source changed by a fix and affected
invariants; do not repeat completed baseline review without new evidence.
