# @opencrane/backend/agents/personal/revisions — materialise personal model choices

> [backend](../../../../README.md) › [agents](../../../README.md) › [personal](../../README.md) › revisions

## What it owns

This package is the personal-agent revision step between an owner accepting a model preference and
the next immutable run input. It locks one user's accepted-change queue inside the existing run
admission transaction, clones the current personal `AgentRevision`, and changes only its registered
model definition. It then publishes the clone, advances the active service pointer, and records the
applied revision IDs in the same transaction.

```
 accepted configuration request
        │
        ▼
 ┌────────────────────────────────┐
 │ personal revision materialiser  │ ◄── HERE
 └────────────────────────────────┘
        │ one published active revision
        ▼
 frozen RunInputSnapshot
```

**In this flow:** [configuration](../../configuration/main/README.md) · [execution inputs](../../../execution/inputs/main/README.md)

At most one accepted `model_alias` request can advance per admission. This first session seam uses
only globally registered models because its command has no trusted ClusterTenant identity; a scoped
model is never inferred from a silo ID. A stale request or an alias no longer globally registered
becomes `Superseded`; it never changes a prior run. `persona_refresh` is deliberately left accepted
because only the interview and approval authority can create a truthful persona revision.

## Public surface

- `PrismaPersonalConfigurationMaterializer` implements the session-assembly materialisation port.
- `PersonalConfigurationMaterializationResult` reports whether the active revision changed.

## Boundary

The materialiser does not create or approve persona revisions, write run snapshots, accept user
decisions, or open a nested transaction. Session assembly remains the only snapshot compiler and
reads the new active revision only after this package finishes.

## Dependency direction

Tagged `scope:personal-revisions` at the backend layer, it can use the configuration journal,
admission contracts, and the shared canonical digest; it cannot depend on an app or UI.

## Data & persistence

This package materialises the `PersonalConfigurationChange` and `AgentRevision` target-database
records in one existing transaction. The clean target baseline contains the lifecycle fence that
rejects unproven application evidence.

## See also

- Parent index: [personal](../../README.md)
- Related state: [configuration](../../configuration/main/README.md) · [personas](../../personas/main/README.md)
