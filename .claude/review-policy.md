# Review Gate Policy

This file is the **single tunable surface** for the automated review gate. When the
gate fires too often (burning tokens) or misses things, edit this file — nothing else.

The shared `.claude/hooks/require-review.sh` reads the machine config to skip only the modeled safe
cases and blocks deterministically on `JUDGE`. The continued main session and repository review
agents use the **Review-dimension guidance** to select and execute the required review dimensions.

---

## Machine config (parsed by the shell pre-filter)

Keep this block's format stable: `key=value`, space-separated tokens. Edit the values,
not the keys.

<!-- GATE-CONFIG-START -->
threshold=10
always-review=auth token secret credential oidc iam rbac networkpolicy network-policy egress middleware bearer session budget spend payment .component. .store. .mapper. .view. resource( rxresource( httpresource( _run _execute withloading
never-review-paths=__tests__/ /tests/ /test/ /spec/ /test_ _test.go Test.java Test.kt .test. .spec. .types.ts /generated/ /dist/ /fixtures/ /vendor/
<!-- GATE-CONFIG-END -->

- **threshold** — supported production-source changes of this many total lines or fewer skip the gate
  (unless an `always-review` keyword matches). Raise it to review less; lower to review more.
- **always-review** — case-insensitive keywords. If any changed file path or diff line
  contains one, the change is escalated to the mandatory review gate regardless of size.
- **never-review-paths** — path substrings. If *every* changed file matches one of these,
  the change is skipped without invoking review.

---

## Review-dimension guidance

`JUDGE` already means an independent `@review` pass is required before the turn ends. Use this
guidance to select the relevant review dimensions and any additional specialist gates.

**Select the relevant review dimensions and specialist gates when the change involves:**
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
  responsibility-inventory trigger, then review the real cohesion, dependency direction,
  authority ownership, ordering, and public test seam.
- Any routed Angular component change, or a change to its component-scoped store, mapper, or
  presentational tree. These always require the canonical owner table in `docs/agents/angular.md`
  plus architecture, component-manager, and independent-review gates; size is irrelevant.

**The deterministic prefilter may skip review when the change is:**
- Comments, JSDoc, logging, or formatting only.
- Test files, fixtures, or type-only declarations.
- Mechanical renames or import reordering with no behavioural change.
- A small, self-contained change with an obvious, low-risk effect.

When genuinely uncertain which dimension applies to a production-code change, include it. A focused
independent review is cheaper than a regression reaching `main`.

---

## Tuning log

Record changes here so the feedback loop is visible to the team.

- _(initial)_ threshold=10; always-review covers auth/secret/network/iam/money; tests,
  type-only, and generated code are skipped.
- 2026-07-29: model maintainability explicitly for complex transactions, persistence
  ownership, duplicated domain algorithms, and untested core orchestration paths.
- 2026-07-30: extend the pre-filter and module-growth trigger across supported production
  languages; keep size as a review trigger rather than a modeled finding.
- 2026-08-10: route every Angular component/reactive-page change through review regardless of size;
  routed screens also require the canonical architecture and component-manager ownership gates.
