# Architecture Decision Records

Long-lived design decisions for the OpenCrane platform. An ADR captures **why** a
decision was made, the alternatives that were weighed, and the consequences we accepted —
so a later reader (or a later agent) does not relitigate a settled question.

The index holds only decisions that currently bind the platform: a superseded ADR is
deleted in the same change that supersedes it, and git history keeps the retired record.
ADRs sit next to the agent guidance in [`docs/agents/`](../agents/) and complement the
forward plans at the repo root (`plan.md`, `silo-multi-tenant-plan.md`). Reader-facing
operator and integrator docs live in [`website/`](../../website); an ADR may be the source
a website page summarises, but it is not itself published.

| ADR | Title | Status |
|-----|-------|--------|
| [0002](0002-per-clustertenant-silo-architecture.md) | Per-ClusterTenant silo architecture (dedicated operator, planes, API/DB per tenant) | Accepted |
| [0003](0003-cilium-spiffe-identity-substrate.md) | Cilium identity and network-policy substrate | Accepted; corrected 2026-07-16 |
| [0004](0004-open-core-fleet-silo-licence-split.md) | Open-core licence split at the fleet ↔ silo boundary (AGPL template + proprietary fleet) | Accepted |
| [0005](0005-opencrane-owned-agent-runtime.md) | OpenCrane-owned agent runtime | Accepted; amended 2026-07-18 |
| [0007](0007-direct-target-refactor.md) | Direct target refactor without an estate migration | Accepted |
| [0008](0008-target-agent-contracts-and-workload-identity.md) | Target agent contracts and workload identity | Accepted; amended by 0009 |
| [0009](0009-opensandbox-sandbox-job-substrate.md) | OpenSandbox as the sandbox-job execution substrate | Accepted |

## Writing a new ADR

- Number sequentially (`NNNN-short-slug.md`); never reuse or renumber.
- Keep the shape: **Status · Context · Decision · Alternatives considered · Consequences**.
- Record the **decided** outcome. Open questions belong in a plan file, not an ADR.
- When a decision changes, write a new ADR whose context summarises what it replaces and
  why, then delete the superseded file in the same change — git history keeps the record.
  Numbering gaps are expected; never reuse or renumber.
- Reference the originating task ID (e.g. `task_5164276f`) so the record traces back to the
  roadmap that requested it.
