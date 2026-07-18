# ADR 0006 — Rewrite freeze with whole-silo blue/green cutover

- **Status:** Accepted
- **Date:** 2026-07-16
- **Task:** `#245` — Phase A decision record
- **Supersedes / superseded by:** selects the rewrite-freeze route over the proposed strangler route
- **Related:** [ADR 0005](0005-opencrane-owned-agent-runtime.md) ·
  [`personal-agent-platform-rewrite-freeze-plan.md`](../design/personal-agent-platform-rewrite-freeze-plan.md) ·
  [`personal-agent-platform-simplification-plan.md`](../design/personal-agent-platform-simplification-plan.md)

## Context

ADR 0005 defines an OpenClaw-free target but does not by itself choose how production reaches it.
The strangler proposal would replace capabilities behind temporary live bridges and projections.
The rewrite-freeze proposal instead stabilizes one immutable blue release, builds the complete green
platform without compatibility imports, and replaces one complete ClusterTenant silo at a time.

The owner selected the rewrite-freeze route on 2026-07-16 to hard-rewire the OpenClaw tenant in one
go, as far as safely possible, and retain direct control over the runtime. This is not authorization
for a fleet-wide big bang: the ClusterTenant remains the atomic isolation and cutover unit.

## Decision

- Stabilize, test, sign, and freeze one immutable OpenClaw-based blue release.
- Keep `main` as the protected blue maintenance line and integrate green through ordinary reviewed
  pull requests on protected `feat/agent-platform-v2`.
- Build green with no OpenClaw bridge, transcript mirror, dual-write compatibility adapter, legacy
  import, or reverse bridge in runtime paths.
- Export blue read-only and import green idempotently from checkpoint-bound snapshots or explicitly
  approved reset/archive/reconnect inputs.
- Rehearse production-shaped migration and failure paths, qualify one entire dogfood silo, then cut
  one complete ClusterTenant at a time.
- Before the commit point, rollback restores the exact signed blue manifest under a new generation.
  After green accepts writes or performs side effects, recovery is forward unless the program is
  explicitly reclassified and funds a reverse bridge.

The active-slot/quarantine mechanism is migration infrastructure only. It is removed after all
ClusterTenants and rollback windows complete.

## R0 escape hatch

R0 must inventory the real estate and classify every ClusterTenant as reset-eligible or requiring
full-fidelity migration. It must also decide whether post-write rollback is mandatory. If mandatory
post-write rollback is a product or operating requirement, this ADR's route is no longer viable:
the program stops and reverts to the strangler/hybrid strategy unless the organization explicitly
funds and operates a reverse event/side-effect bridge.

This is a decision gate, not a documentation formality.

## Alternatives considered

- **Feature-by-feature strangler** — rejected for the current route because it adds temporary live
  compatibility seams to the same domain being replaced. It remains the mandatory escape hatch if
  R0 requires post-write rollback.
- **Fleet-wide big bang** — rejected. One failed migration must not expose every ClusterTenant.
- **Permanent blue/green runtime choice** — rejected. A silo has one active runtime and one writer;
  dual operation exists only as quarantined migration infrastructure.
- **Reverse bridge by default** — rejected. It recreates a dual-runtime contract and invalidates the
  claimed rewrite-freeze simplicity.

## Consequences

- No green product capability serves a live blue ClusterTenant before its atomic cutover.
- Blue receives only the named stabilization runway and later security/availability-class fixes;
  green applicability is assessed for every exception.
- Migration correctness, credential custody, side-effect fencing, immutable manifests, and
  deterministic rehearsal become release-blocking work.
- Product value is delayed until full green qualification, and blue/green capacity must coexist
  during the program.
- R10 replaces `main` only after every silo's retention window, then deletes blue and the
  migration-only slot machinery.
