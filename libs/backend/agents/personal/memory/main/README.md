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
- `PersonalMemoryDatasetResolutionOutcomes` / `PersonalMemoryDatasetResolutionDenialReasons` — the
  stable, serialized allow/deny vocabulary for proof-bound dataset selection.

## Boundary

Consumed by execution-input assembly. The dedicated personal-session factory can compose this
package's repository into both personal memory sources inside an existing run-admission transaction.
That factory has no production app caller yet: OpenCrane currently composes only managed admission,
which deliberately freezes no personal-memory scope. A later trusted personal-request slice must
derive the thread-bound service and signed user identity before invoking this factory; it must not
accept dataset or fact coordinates from an HTTP request.

This package itself must not write generic fact metadata, own a transaction, derive a dataset from a
subject outside admission, read durable fact text, call Cognee, or compose a runtime. It remains the
narrow identity-bound selection owner and cannot be used as a personal fallback when identity or
dataset evidence is unavailable.

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
