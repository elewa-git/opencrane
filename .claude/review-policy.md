# Review Gate Policy

This file is the **single tunable surface** for the automated review gate. When the
gate fires too often (burning tokens) or misses things, edit this file — nothing else.

Two consumers read it:
- `.claude/hooks/require-review.sh` (free shell pre-filter) reads the machine-config
  block below to cheaply skip the obvious cases.
- The Haiku `Stop` agent hook reads the **Judgment guidance** prose to decide the
  ambiguous middle.

---

## Machine config (parsed by the shell pre-filter)

Keep this block's format stable: `key=value`, space-separated tokens. Edit the values,
not the keys.

<!-- GATE-CONFIG-START -->
threshold=150
always-review=secret credential rbac networkpolicy network-policy egress
never-review-paths=__tests__/ /tests/ /test/ /spec/ /test_ _test.go Test.java Test.kt .test. .spec. .types.ts /generated/ /dist/ /fixtures/ /vendor/
<!-- GATE-CONFIG-END -->

- **threshold** — supported production-source changes of this many total lines or fewer skip the gate
  (unless an `always-review` keyword matches). Raise it to review less; lower to review more.
- **always-review** — case-insensitive keywords. If any changed file path or diff line
  contains one, the change is escalated to the Haiku judge regardless of size.
- **never-review-paths** — path substrings. If *every* changed file matches one of these,
  the change is skipped without invoking the judge.

---

## Judgment guidance (read by the Haiku judge)

You are deciding whether a production-source change needs an independent `@review` pass before
the turn ends. Block (`ok:false`) only when the change carries real risk. Allow (`ok:true`)
otherwise — over-blocking wastes tokens.

**Block when the change involves any of:**
- Authentication / authorization logic, token validation, session handling, OIDC flows.
- Secret, credential, or API-key handling.
- Network boundaries: NetworkPolicy, egress rules, routes added without auth middleware.
- IAM / RBAC grants or trust bindings.
- Money: budget, spend, or billing logic.
- Non-trivial control flow in production code (new branching, error handling, retries,
  concurrency) where a subtle bug would cause incorrect behaviour or data loss.
- Maintainability-sensitive production changes: complex transaction orchestration,
  repository adapters that span several domain responsibilities, cross-package Prisma
  writes, duplicated domain algorithms, or core workflows whose success path is not
  exercised through the public boundary. These need an evidence-based maintainability
  pass; raw function or line length alone is not enough to block.
- Any file reported by the language-neutral module-growth checker. Treat the report as a
  responsibility-inventory trigger, then judge the real cohesion, dependency direction,
  authority ownership, ordering, and public test seam.

**Allow (skip review) when the change is:**
- Comments, JSDoc, logging, or formatting only.
- Test files, fixtures, or type-only declarations.
- Mechanical renames or import reordering with no behavioural change.
- A small, self-contained change with an obvious, low-risk effect.

When genuinely uncertain on a production-code change, lean toward allowing. The project
is pre-MVP with no external users: development speed matters more than catching every
subtle regression, and the explicit `/review-loop` remains available for the changes
that deserve it. Revisit this default at the MVP release.

---

## Tuning log

Record changes here so the feedback loop is visible to the team.

- _(initial)_ threshold=10; always-review covers auth/secret/network/iam/money; tests,
  type-only, and generated code are skipped.
- 2026-07-29: model maintainability explicitly for complex transactions, persistence
  ownership, duplicated domain algorithms, and untested core orchestration paths.
- 2026-07-30: extend the pre-filter and module-growth trigger across supported production
  languages; keep size as a review trigger rather than a modeled finding.
- 2026-08-31: pre-MVP relax — the gate fired on nearly every substantive change and became
  the main drag on iteration speed. threshold 10→150; always-review trimmed to the keywords
  that are dangerous on their own (secret/credential/rbac/networkpolicy/egress — `token`,
  `session`, `middleware`, `budget` matched half the codebase); uncertainty default flipped
  from block to allow. Restore the defensive posture at the MVP release.
- 2026-08-31: carry the same relaxation into Codex — its Stop hook asked for a full review on
  every `JUDGE` verdict because Codex has no judge model, so it now hands the change to the model
  to judge against this guidance instead.
