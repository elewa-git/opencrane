# @opencrane/backend/agents/personal/configuration — future-snapshot change provenance

> [backend](../../../../README.md) › [agents](../../../README.md) › [personal](../../README.md) › configuration

## What it owns

This package records a person's request to change how their agent behaves. It binds the request to
the user, conversation, run, current persona revision, and current agent revision. A run input
snapshot is immutable, so the package never changes work already in progress. An owner may first
mark a request `Accepted`; a later materialisation authority may mark it `Applied` only while assembling a new
snapshot and only while the recorded active revisions still match. A `persona_refresh` proposal is
materialised by a new, proposal-bound onboarding interview; approving that interview's derived
persona revision applies that exact proposal atomically.

An accepted `model_alias` follows a separate owner-triggered materialization step. It copies the
current personal AgentService revision, changes only its registered model definition, publishes the
copy, and makes that copy active in the same database transaction. The next run therefore seals the
new model into its own input snapshot; a run already in progress keeps its old snapshot.

```
 conversation request ─► configuration proposal ◄── HERE ─► later approved revision
                                      │                         │
                                      └──── applies only to the next RunInputSnapshot ────► next run
```

**In this flow:** [conversation replay](../../../../server/agents/conversation-replay/main/README.md) · [personas](../../personas/main/README.md) · [execution inputs](../../../execution/inputs/main/README.md)

The invariant is that a proposal is durable provenance, not mutable session state. Missing or
cross-owner source coordinates fail closed. This foundation does not itself apply a patch; its
owner-only browser API lists durable proposal history and records an explicit accept-or-reject
decision through the existing atomic authority. Its first-party `upgrade_session` descriptor is always callable in
a personal conversation, but its call records only a proposed change in this same journal; it never
means the request is already user-approved or applied.

## Public surface

- `__ProposePersonalConfigurationChange` validates and records one future-snapshot proposal.
- `PersonalConfigurationChangeRepository` is the persistence port that proves source ownership in
  its atomic insert.
- `ProposePersonalConfigurationChangeCommand` and `Result` describe the stable proposal boundary.
- `__DecidePersonalConfigurationChange` records the owner's `Accepted` or `Rejected` decision but
  never applies a patch itself.
- `__MaterializePersonalConfigurationChange` applies an accepted `model_alias` proposal by creating
  and activating the next immutable personal AgentRevision; persona refreshes remain on the
  interview-and-approval route.
- `__CreatePersonalConfigurationRouter` provides the owner-only configuration API.
  `PrismaPersonalConfigurationChangeRepository` owns the proposal journal, decisions, history, and
  upgrade-session bridge. The application materializer coordinates only repository ports; its
  Prisma unit of work owns Serializable isolation and bounded whole-operation retries, while
  transaction-scoped personal-configuration and agent-service repositories own their respective
  model reads and writes. Agent-services owns source-revision validation, canonical cloning,
  publication, and activation. `GET /api/v1/me/configuration/changes`
  lists at most fifty proposals,
  `POST /api/v1/me/configuration/changes/:changeId/decision` records consent, and
  `POST /api/v1/me/configuration/changes/:changeId/materialize` retry-safely applies an accepted
  model selection. Browser input cannot choose a user, silo, timestamp, revision,
  model-definition ID, or lifecycle state, and no endpoint mutates the current run snapshot.
- `_CreatePersonalConfigurationRouter` is the ready-to-mount Prisma composition. It maps the shared
  request principal to the configuration caller and composes the journal, application materializer,
  and Prisma unit of work without exposing an ORM client to the use case.
- `UPGRADE_SESSION_TOOL` / `__IsUpgradeSessionAvailable` describe the built-in, non-MCP tool the app
  adds only to personal conversation inputs.
- `PersonalConfigurationPatch` is a closed union: `persona_refresh` requests the normal interview
  and authored-persona workflow; `model_alias` requests a human-visible model alias. It cannot carry
  raw SOUL text, budgets, credentials, policy IDs, tools, skills, integrations, or revision IDs.
- `AgentConfigPatchKinds` is the shared durable patch vocabulary from `@opencrane/contracts`.
  `PersonalConfigurationProposalCodes`, `PersonalConfigurationDecisionCodes`,
  `PersonalConfigurationMaterializationCodes`, and `PersonalConfigurationChangeViewStates` are this
  package's documented result and lifecycle vocabularies. Their member values preserve the JSON and
  API spellings while keeping validators, persistence, routes, and schemas compiler-linked.

## Boundary

The package does not mutate `RunInputSnapshot`, perform persona synthesis, or invoke an MCP tool.
Its narrow self-only API records an owner's accept/reject decision. The persona authority alone can
apply a linked `persona_refresh` proposal while approving the resulting revision; this package
materialises only an accepted `model_alias` by copying the current personal revision. The app
composes its Prisma adapters and unit of work; repository adapters alone call model delegates, and
only the unit of work opens the cross-domain transaction. Runtime transport and UI remain separate
owners.

## Dependency direction

Tagged `scope:personal-configuration` at the backend layer, it depends on the shared agent models,
the agent-service model-selection materialization operation, and the narrow `scope:auth`
request-principal seam. Dependency direction remains `personal configuration → agent services →
agent models`; it cannot import another personal specialization or an app.

## Data & persistence

Owns the `PersonalConfigurationChange` target-database model. It stores immutable request evidence
and later decision/application coordinates; it is not a replacement persona or agent-revision store.

## See also

- Parent index: [personal](../../README.md)
- Related state: [personas](../../personas/main/README.md) · [conversation replay](../../../../server/agents/conversation-replay/main/README.md)
