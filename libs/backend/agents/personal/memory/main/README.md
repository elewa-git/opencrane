# @opencrane/backend/agents/personal/memory — verified personal-memory selection

> [backend](../../../../README.md) › [agents](../../../README.md) › [personal](../../README.md) › memory

## What it owns

This package is the personal-agent boundary for two admission decisions: which active Cognee dataset
belongs to one verified user in one organisation, and which consented facts that user explicitly
supplied may personalise a frozen run input. It receives the existing run-admission transaction, so
both reads occur at the same final identity and revocation fence as every other snapshot input.

```
 verified user identity + RunAdmissionTransaction
          │ silo · organisation · subject
          ▼
 ┌──────────────────────────────────┐
 │  personal memory  ◄── HERE        │  exact dataset + explicit preference ids
 └──────────────────────────────────┘
          │ catalog id + Cognee dataset id / fact coordinates
          ▼
 execution input snapshot ── later recall through memory gateway
```

**In this flow:** [execution inputs](../../../execution/inputs/main/README.md) freezes the selected
coordinates, [agent memory](../../../memory/main/README.md) owns generic metadata and outbox writes,
and the [memory gateway](../../../../../server/_infra/memory-gateway-client/README.md) is the only
fact-content boundary.

The invariant is identity-bound selection: neither a request nor a tool argument can choose a
dataset by identifier. The repository reads only the exact silo, organisation, and verified subject;
it returns only active, consented facts whose provenance names that subject. It stores no fact text
and never calls Cognee.

## Public surface

- `__ResolvePersonalMemoryDataset(repository, unitOfWork, command)` — fail-closed selection of one
  active personal dataset from verified coordinates.
- `__SelectPersonalPreferenceFactIds(repository, unitOfWork, command)` — selects explicit,
  consented personal-preference metadata for the same coordinates.
- `PrismaPersonalMemoryAdmissionRepository` — transaction-scoped Prisma adapter for both reads.
- `PersonalMemoryAdmissionRepository` / `PersonalMemoryAdmissionUnitOfWork` — ports that preserve
  the caller-owned admission transaction without exposing Prisma delegates to execution inputs.

## Boundary

Consumed by execution-input assembly. It must not write generic fact metadata, own a transaction,
derive a dataset from a subject outside admission, read durable fact text, call Cognee, or compose a
runtime. Personal admission remains deliberately uncomposed in the current application; this package
is prepared for that future wiring but does not claim it is a live personal-memory feature.

## Dependency direction

Tagged `scope:personal-memory`, this backend package may depend only on its own scope and
`scope:shared`. It has no dependency on generic catalog/outbox authority, a gateway transport, or an
app composition root.

## Data & persistence

Reads `MemoryDataset` and `MemoryFactCatalog` through the repository port using the existing
`RunAdmissionTransaction`. Generic catalog and outbox writes belong to
[agent memory](../../../memory/main/README.md), which owns the `memory.prisma` persistence boundary.

## See also

- Parent group: [personal-agent domains](../../README.md)
- Snapshot assembly: [execution inputs](../../../execution/inputs/main/README.md)
- Generic catalogue: [agent memory](../../../memory/main/README.md)
