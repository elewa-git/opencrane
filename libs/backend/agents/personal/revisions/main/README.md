# @opencrane/backend/agents/personal/revisions — materialise personal agent changes

> [backend](../../../../README.md) › [agents](../../../README.md) › [personal](../../README.md) › revisions

## What it owns

This package is the personal-agent revision step between an owner accepting a model preference and
the next immutable run input. It locks one user's accepted-change queue inside the existing run
admission transaction, clones the current personal `AgentRevision`, and changes only its registered
model definition. It also binds an accepted persona refresh to one real reviewed interview; once its
resulting persona draft is approved, one separate transaction advances both the persona and agent
heads and records the applied revision pair.

```
 accepted configuration request
        │
        ▼
 ┌────────────────────────────────┐
 │ personal revision materialiser  │ ◄── HERE
 └────────────────────────────────┘
        │ one published active revision pair
        ▼
 frozen RunInputSnapshot
```

**In this flow:** [configuration](../../configuration/main/README.md) · [execution inputs](../../../execution/inputs/main/README.md)

At most one accepted `model_alias` request can advance per admission. This first session seam uses
only globally registered models because its command has no trusted ClusterTenant identity; a scoped
model is never inferred from a silo ID. A stale request or an alias no longer globally registered
becomes `Superseded`; it never changes a prior run. A `persona_refresh` first starts a linked
interview, then uses the ordinary reviewed interview and draft evidence. Its special approval step
does not invent SOUL content: it atomically approves the evidenced persona, publishes a clone of the
current personal agent revision with that persona, and marks the linked change applied.

## Public surface

- `PrismaPersonalConfigurationMaterializer` implements the session-assembly materialisation port.
- `PersonalConfigurationMaterializationResult` reports whether the active revision changed.
- `__StartPersonaRefreshInterview` and `PrismaPersonaRefreshInterviewRepository` create the one
  refresh-linked reviewed interview while refusing unrelated in-progress evidence.
- `__ApprovePersonaRefresh` and `PrismaPersonaRefreshApprovalRepository` atomically approve the
  linked persona, publish the matching agent revision, and seal the configuration-change evidence.

## Boundary

The model materialiser does not write run snapshots, accept user decisions, or open a nested
transaction. The refresh approval authority is the sole exception: it owns the complete transaction
for a linked refresh pair. Session assembly remains the only snapshot compiler and reads the new
active revision only after this package finishes.

## Dependency direction

Tagged `scope:personal-revisions` at the backend layer, it can use the configuration journal,
admission contracts, the persona package's transaction-scoped interview primitive, and the shared
canonical digest; it cannot depend on an app or UI. This one-way dependency keeps persona evidence
as the sole lifecycle implementation while revisions owns the refresh journal fence.

## Data & persistence

This package materialises the `PersonalConfigurationChange` and `AgentRevision` target-database
records in one existing transaction. The clean target baseline contains the lifecycle fence that
rejects unproven application evidence.

## See also

- Parent index: [personal](../../README.md)
- Related state: [configuration](../../configuration/main/README.md) · [personas](../../personas/main/README.md)
