# @opencrane/backend/agents/personal/configuration — future-snapshot change provenance

> [backend](../../../../README.md) › [agents](../../../README.md) › [personal](../../README.md) › configuration

## What it owns

This package records a person's request to change how their agent behaves. It binds the request to
the user, conversation, run, current persona revision, and current agent revision. A run input
snapshot is immutable, so the package never changes work already in progress. An owner may first
mark a request `Accepted`; a later materialisation authority may mark it `Applied` only while assembling a new
snapshot and only while the recorded active revisions still match.

```
 conversation request ─► configuration proposal ◄── HERE ─► later approved revision
                                      │                         │
                                      └──── applies only to the next RunInputSnapshot ────► next run
```

**In this flow:** [conversations](../../conversations/main/README.md) · [personas](../../personas/main/README.md) · [execution inputs](../../../execution/inputs/main/README.md)

The invariant is that a proposal is durable provenance, not mutable session state. Missing or
cross-owner source coordinates fail closed. This foundation does not itself apply a patch; its
owner-only browser API can list durable proposal history, while a later decision route will use the
existing atomic decision authority. Its first-party `upgrade_session` descriptor is always callable in
a personal conversation, but its call records only a proposed change in this same journal; it never
means the request is already user-approved or applied.

## Public surface

- `__ProposePersonalConfigurationChange` validates and records one future-snapshot proposal.
- `PersonalConfigurationChangeRepository` is the persistence port that proves source ownership in
  its atomic insert.
- `ProposePersonalConfigurationChangeCommand` and `Result` describe the stable proposal boundary.
- `__DecidePersonalConfigurationChange` records the owner's `Accepted` or `Rejected` decision but
  never applies a patch itself.
- `__CreatePersonalConfigurationRouter` and `PrismaPersonalConfigurationChangeRepository` provide
  the owner-only `GET /api/v1/me/configuration/changes` history. It lists at most fifty proposals
  in the signed-in owner's selected silo and does not alter any current run snapshot.
- `UPGRADE_SESSION_TOOL` / `__IsUpgradeSessionAvailable` describe the built-in, non-MCP tool the app
  adds only to personal conversation inputs.
- `PersonalConfigurationPatch` is a closed union: `persona_refresh` requests the normal interview
  and authored-persona workflow; `model_alias` requests a human-visible model alias. It cannot carry
  raw SOUL text, budgets, credentials, policy IDs, tools, skills, integrations, or revision IDs.

## Boundary

The package does not mutate `RunInputSnapshot`, perform persona synthesis, apply a user decision,
or invoke an MCP tool. The app composes its Prisma adapter and `ToolInvocation` ledger; runtime
transport and UI remain separate owners.

## Dependency direction

Tagged `scope:personal-configuration` at the backend layer, it may depend only on itself and shared
contracts. It cannot import another personal specialization, a server control-plane domain, or an app.

## Data & persistence

Owns the `PersonalConfigurationChange` target-database model. It stores immutable request evidence
and later decision/application coordinates; it is not a replacement persona or agent-revision store.

## See also

- Parent index: [personal](../../README.md)
- Related state: [personas](../../personas/main/README.md) · [conversations](../../conversations/main/README.md)
