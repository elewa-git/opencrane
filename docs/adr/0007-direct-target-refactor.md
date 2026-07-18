# ADR 0007 — Direct target refactor without an estate migration

- **Status:** Accepted
- **Date:** 2026-07-18
- **Task:** `#252` — R0 decision-gate outcome
- **Supersedes / superseded by:** supersedes ADR 0006 (rewrite freeze with whole-silo blue/green
  cutover; deleted — see git history); amends the migration-era consequences of
  [ADR 0005](0005-opencrane-owned-agent-runtime.md)
- **Related:**
  [`personal-agent-platform-direct-refactor-plan.md`](../design/personal-agent-platform-direct-refactor-plan.md) ·
  [`personal-agent-platform-product-contract.md`](../design/personal-agent-platform-product-contract.md)

## Context

ADR 0006 selected the rewrite-freeze route and pre-committed R0 (`#252`) as the gate that would
validate it against the real estate: inventory every ClusterTenant, classify each as reset-eligible
or requiring full-fidelity migration, and decide whether post-write rollback is mandatory. Its named
escape hatch was reverting to the strangler route.

The R0 audit invalidated the premise both routes share: OpenCrane is not a live platform. There are
no production ClusterTenants, no customer data or transcripts requiring fidelity, no credential
estate requiring custody decisions, and no availability contract a cutover could violate. Every
reachable environment is reset-eligible; none qualifies for full-fidelity migration. Both prior
routes exist to protect live estate while it is replaced — with no live estate, both buy their full
cost (freeze discipline, migration factory, rollback machinery, dual blue/green capacity) and none
of their value.

This outcome is deliberately outside ADR 0006's escape-hatch menu. That gate enumerated two exits —
proceed with the freeze, or fall back to the strangler — because both presumed estate worth
migrating. The audit showed there is none, so the gate's evidence test was applied and its
enumerated outcomes were not. The gate's purpose (decide from estate evidence before irreversible
work) was served; its option list was not exhaustive.

## Decision

- Refactor the repository directly to the target state defined by the
  [direct-refactor plan](../design/personal-agent-platform-direct-refactor-plan.md) and the
  [product contract](../design/personal-agent-platform-product-contract.md).
- Existing OpenCrane systems and data are out of scope: no migration, transformation, bridge,
  compatibility surface, or reverse path is built or retained. Environments are reprovisioned
  fresh from the target path.
- OpenClaw and every obsolete schema, protocol, app, token path, configuration switch, test,
  deployment unit, and document are deleted as their replacements become ready — per replacement
  slice, not at an end-state cutover.
- OpenClaw is a deletion target only. It is not a dependency, fixture source, behavior oracle, or
  conformance baseline; runtime fixtures are authored from the accepted product contract. (This
  amends ADR 0005, whose accepted consequences made the frozen image a behavioral oracle and its
  trajectories the bake-off fixtures.)
- Delivery is sequential phase gates C–G on protected `feat/agent-platform-v2`, with independent
  lanes parallelized inside the active phase (plan.md is the working sequence).

## Alternatives considered

- **Rewrite freeze with whole-silo blue/green cutover (ADR 0006)** — rejected. Signed frozen
  manifests, cutover rehearsal, commit points, and rollback windows protect live tenants that do
  not exist.
- **Strangler (ADR 0006's escape hatch)** — rejected for the same reason. Temporary live bridges
  and dual-write projections protect uninterrupted service that no one consumes yet.
- **Defer the route decision until closer to launch** — rejected. Every pre-launch week spent on
  migration machinery grows legacy surface that must itself later be deleted, and the R-phase
  roadmap was already sequencing work around machinery with no beneficiary.

## Consequences

- plan.md replaces the R0–R10 program with sequential Phases C–G; the rewrite-freeze and
  simplification route documents are removed, and transition-program vocabulary is enforced as
  historical-only by `scripts/phase-a-forbidden-references.sh` (`TRANSITION-PROGRAM`).
- There is no rollback machinery below ordinary application updates; the product contract instead
  requires future application updates to restore ready traffic-serving target Pods within five
  minutes per silo, without predecessor runtimes or data transformation.
- Workload ownership drops time-boxed and compatibility exceptions entirely: paths slated for
  removal carry `classification: "delete"` with the replacement that triggers deletion.
- **Revisit trigger:** this ADR must be revisited if the platform accepts live users before
  Phase G completes. Going live re-creates exactly the estate ADR 0006 existed to protect, and a
  new decision record must then choose a migration posture for it.
