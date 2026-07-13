# ADR 0004 — Open-core licence split at the fleet ↔ silo boundary

- **Status:** Accepted
- **Date:** 2026-07-07
- **Task:** `#150` (Phase 3 pull-forward — the fleet/silo repo split preparation)
- **Supersedes / superseded by:** none — establishes the licensing posture for the Phase 3 repo split.
- **Related:** [`docs/design/fleet-silo-contract.md`](../design/fleet-silo-contract.md) (the one contract that
  survives the split) · [ADR 0002 — per-ClusterTenant silo architecture](0002-per-clustertenant-silo-architecture.md)
  (the fleet vs. silo boundary this licence line follows) · [`libs/contracts/README.md`](../../libs/contracts/README.md)
  (the pre-existing MIT relicensing of the SDK).

## Context

OpenCrane is being restructured (Phase 3) so that `opencrane-2` becomes a **standalone ClusterTenant
template** — deployable alone (self-hosted, single-tenant) or fleet-managed by an external fleet manager that
lives in a separate repo, `weownai`. The fleet manager (`apps/fleet-operator`'s HTTP/provisioning routes plus
the `apps/fleet-platform` Helm chart) moves OUT to `weownai`; the per-silo control plane
(`apps/opencrane`) and the rest of `opencrane-2` stay behind, joined to the fleet only by the
cross-repo contract specified in the fleet↔silo contract design.

Today the whole platform is **AGPL-3.0-or-later** (root `LICENSE`; `apps/fleet-operator` and
`apps/opencrane` both declare `"license": "AGPL-3.0-or-later"`), with **one deliberate
exception already in place**: `libs/contracts` is **MIT** so external — including proprietary — consumers can
generate a typed client from the published OpenAPI spec without inheriting AGPL obligations
(`libs/contracts/README.md`).

The owner has decided the platform's commercial model: **open core.** A self-hostable AGPL template
(the silo) plus a **proprietary hosted fleet manager** (the value-add: multi-tenant provisioning, Zitadel org
provisioning, billing, platform DNS, the dedicated-cluster provisioner). This requires settling *which
components are proprietary, which stay AGPL, and when the relicense happens* — before the Phase 3 move, so the
split lands the code on the correct side of the licence line rather than relicensing after the fact.

Two constraints shape the decision:

1. **The AGPL boundary must be a process/network boundary, not a code link.** AGPL's network-use clause makes
   an in-process link between AGPL and proprietary code untenable; the split is only clean if the two planes
   talk exclusively through the versioned contract (CR schema, OpenAPI, the MIT SDK).
2. **The template must stay genuinely self-hostable.** A user who takes only `opencrane-2` must get a working
   single-tenant OpenCrane under AGPL, with no proprietary component required to run it.

## Decision

### The licence line follows the fleet ↔ silo contract boundary

Components are relicensed by which side of the [fleet↔silo contract](../design/fleet-silo-contract.md) they
sit on:

| Component | Repo after Phase 3 | Licence | Rationale |
|---|---|---|---|
| Fleet manager — `apps/fleet-operator` provisioning/HTTP routes (cluster-tenants, billing, platform DNS, Zitadel admin) | `weownai` | **Proprietary** | The hosted multi-tenant value-add; the commercial product. |
| `apps/fleet-platform` Helm chart | `weownai` | **Proprietary** | Deploys the proprietary fleet manager. |
| Dedicated-cluster provisioner (behind the webhook seam) | `weownai` | **Proprietary** | The enterprise dedicated-tier backend (ADR 0001/0002's arm's-length seam). |
| `apps/opencrane` (the silo control plane) | `opencrane-2` | **AGPL-3.0-or-later** | The self-hostable template. |
| Silo planes, operator, per-org identity/tenant/model/skill surfaces | `opencrane-2` | **AGPL-3.0-or-later** | The template. |
| Control-plane frontend (arriving from weownai) | `opencrane-2` | **AGPL-3.0-or-later** | Ships with the template as its UI. |
| `libs/contracts` (shared DTOs + generated clients + CR types) | `opencrane-2` | **MIT** (unchanged) | The contract must be linkable from BOTH the AGPL silo and the proprietary fleet without imposing AGPL on the latter. |
| The CR schema + published OpenAPI + CRD YAML | `opencrane-2` (emitted) | Contract artifacts | The interface itself is the licence boundary. |

The single test for "which side": **does this component implement the hosted fleet's value-add (multi-tenant
provisioning / billing / IdP org provisioning / dedicated-cluster backend)?** If yes → proprietary, moves to
`weownai`. If it is part of what a self-hoster runs to get a working OpenCrane → AGPL, stays in `opencrane-2`.

### The AGPL boundary IS the fleet ↔ silo contract

The contract (CR `spec`/`status`, the OpenAPI provisioning API, the `spec.zitadel` OIDC delegation payload,
the dedicated-cluster webhook) is deliberately the licence boundary. The AGPL silo and the proprietary fleet
manager share **no code** — only the MIT `@opencrane/contracts` types and the wire artifacts. This is why the
delegation payload is carried on the CR (public OIDC ids only) rather than by an in-process call: it keeps the
proprietary IdP authority entirely on the fleet side of an arm's-length boundary.

### The relicense happens AHEAD of the Phase 3 move, not now

The relicensing of `fleet-operator` + `fleet-platform` to proprietary happens **as part of preparing the
Phase 3 move** — before the code physically moves to `weownai`, so it moves already correctly licensed. It
does **not** happen in this pull-forward change (#150): #150 writes down the decision and the contract; it
flips no licence headers and moves no code. The AGPL template and the MIT `libs/contracts` posture are
unchanged today.

## Alternatives considered

- **Keep everything AGPL (no proprietary split).** Rejected. It forecloses the hosted commercial model the
  owner has chosen: a competitor could run the fleet manager as a service under AGPL without contributing the
  hosted value-add back in any way that protects the business. Open core (AGPL template + proprietary fleet)
  is the deliberate model.
- **Dual-track licensing (AGPL + a paid commercial licence for the SAME fleet code).** Rejected as the
  primary model — it needs a CLA with copyright assignment from every contributor to relicense their
  contributions, which is heavier governance than the split warrants and muddies the "what's open" story. The
  cleaner line is a *physical* split: the open template and the proprietary fleet are different codebases in
  different repos, not the same code under two licences. (A commercial licence for the proprietary fleet
  remains possible on top of the split — it is orthogonal.)
- **Make the whole platform permissively licensed (MIT/Apache).** Rejected. AGPL's network-use protection is
  the point for the self-hostable template — it keeps hosted forks of the *template* honest — while the
  proprietary fleet manager carries the commercial terms. A permissive template would give away the network
  protection with no offsetting benefit.
- **Relicense after the move rather than before.** Rejected. Moving AGPL-headered code into a proprietary repo
  and relicensing it there is error-prone (mixed headers, unclear provenance) and creates a window of
  ambiguous licensing. Relicensing while the code is still owner-controlled and in one tree is cleaner.

## Consequences

- **Contributor / CLA implications.** New contributions to code destined to become proprietary
  (`fleet-operator`, `fleet-platform`) must be covered by a contributor agreement that permits the
  proprietary relicense — put this in place **before** accepting outside contributions to those paths, or keep
  them owner-authored until the move. Contributions to the AGPL silo and the MIT `libs/contracts` follow their
  existing inbound=outbound terms. Until the CLA exists, treat the fleet paths as owner-authored.
- **The contract is now a licence-load-bearing artifact.** Because the AGPL boundary is the contract, any
  change that would force AGPL and proprietary code to link in-process is a licence regression, not just a
  design one. The contract must stay expressible as CR + wire + MIT types (this is why `spec.zitadel` carries
  only public ids — see the contract design's new-work list).
- **Third-party-notice hygiene.** The split creates two dependency-licence surfaces. The AGPL template's
  third-party notices stay in `opencrane-2`; the proprietary fleet's move with it to `weownai`. Any dependency
  currently shared but only *used* by fleet code must be attributed on the correct side after the move — audit
  the dependency graph as part of the physical split so no proprietary build ships AGPL/GPL transitive deps it
  cannot comply with, and no AGPL build claims notices for fleet-only deps.
- **`libs/contracts` MIT posture is reaffirmed, not new.** The one pre-existing exception (MIT SDK) is exactly
  the mechanism this ADR generalises; no change to it is needed, and its rationale (external proprietary
  consumers) now formally includes the fleet manager itself.
- **Self-hostability is preserved by construction.** Because the delegation payload degrades to a no-op
  (a silo with no fleet stamping `spec.zitadel` uses its masters client), the AGPL template runs standalone
  with zero proprietary components — satisfying the "genuinely self-hostable" constraint and unblocking #151.
- **Open questions deliberately left to the owner.** The *terms* of the proprietary licence and of the
  contributor agreement are commercial decisions not settled here; this ADR settles only the **split itself**
  (which components, which side, when) — that part is decided.
