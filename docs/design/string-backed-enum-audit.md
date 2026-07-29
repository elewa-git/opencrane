# String-backed enum audit

Date: 29 July 2026

## Question

Where does OpenCrane own a closed string vocabulary but still repeat its serialized values in type
unions, comparisons, switch cases, validators, schemas, or persistence filters?

The concern is not that strings are inherently wrong. The risk appears when the same category drives
behaviour in more than one place: a spelling change or newly added variant can then leave validation,
authorization, persistence, and API projections disagreeing without a compiler error.

## Method

The audit scanned production TypeScript across the repository. Tests, generated clients,
distribution output, SQL, and Prisma schema files were excluded from the initial scan. Each
remaining comparison, switch case, and categorical union candidate was checked for:

1. whether OpenCrane owns the vocabulary;
2. whether it selects control flow or defines a durable/shared discriminant;
3. whether the value is repeated across a package, persistence, or API boundary; and
4. whether an existing enum already owns the same meaning.

The confirmed vocabularies are grouped into the work packages below. The groups are the useful unit
of follow-up work: several repeated spellings share one correct lower-level owner and should move
together rather than becoming independent enums.

## Completed in the personal configuration change

The personal configuration package now uses documented string-backed enums for its patch kinds,
proposal/decision/materialization control codes, and owner-visible lifecycle projection.

`AgentConfigPatchKinds` lives in `@opencrane/contracts` because configuration, personas, and the API
specification all consume the same persisted JSON discriminant but the personal packages may not
depend on one another. Its serialized values remain exactly `persona_refresh` and `model_alias`;
PostgreSQL constraints, stored JSON, and generated API values therefore remain compatible.

The package-local proposal, decision, materialization, view-state, and HTTP-error enums retain their
current serialized strings while making service, repository, router, and test branches
compiler-linked.

## Priority 0: authority and durable-contract risk

### Authorization scope kinds

- Owner: `libs/models/authorization/main/src/authorization-scope.types.ts`
- Control flow: `libs/models/authorization/main/src/scope-matching.ts`
- Security digest consumer:
  `libs/backend/server/iam/membership/main/src/fleet-membership-payload-digest.ts`
- Proposed enum: `AuthorizationScopeKind`, re-exported through `@opencrane/contracts`

Six scope variants currently participate in authorization matching and signed membership payload
digests. They require one model-owned enum; Prisma's similarly named persistence enum is not the
domain owner.

### Runtime execution identity kind

- Duplicates: `libs/contracts/src/runtime-assignment.types.ts`,
  `libs/contracts/src/run-input-snapshot.types.ts`,
  `libs/backend/agents/execution/runs/main/src/run-admission.types.ts`
- Authority consumers: execution input assembly, run admission, and runtime dispatch
- Proposed enum: `RuntimeExecutionIdentityKind` in `@opencrane/contracts`

The `user`/`service` distinction is an authority boundary and must not be confused with the
personal/managed `AgentServiceKind` product distinction.

### Agent lifecycle vocabularies

- Owner: `libs/models/agents/main/src/agent-service.types.ts`,
  `agent-run.types.ts`, `agent-revision.types.ts`, and `agent-revision-diff.types.ts`
- Transition owner: `libs/models/agents/main/src/state-transitions.ts`
- Proposed enums: retain the existing public names, including `AgentServiceKind`,
  `AgentServiceState`, `AgentRunTrigger`, `AgentRunState`, `AgentRunTerminalReason`,
  `AgentRevisionState`, and `RevisionWideningKind`

These are public model contracts used by transition tables and backend lifecycle control flow.
Generated Prisma enums should remain adapter-side and map explicitly to the model enums.

### Runtime protocol kinds

- Owner: `libs/contracts/src/agent-runtime-protocol.types.ts`
- Authority consumers: runtime protocol and Prisma runtime dispatch authorities
- Proposed enums: `RuntimeCommandKind`, `RuntimeCandidateKind`, and
  `RuntimeCancellationReason`
- Reuse: convert and reuse the model-owned `RunEventType` for event dispatch

Command, candidate, cancellation, and terminal-event values are authenticated workload protocol
discriminants. Their validators and dispatch branches must compile against the same vocabulary.

### Grant scope, subject, and access

`GrantAccess`, `GrantScope`, and `GrantSubjectType` already exist in
`libs/contracts/src/grant.types.ts`, but model and route packages duplicate their strings. Establish
one dependency-neutral owner, re-export it through contracts, and replace aliases in scope
attachments plus MCP, group, share, and authorization routes. Prisma values remain persistence
mappings.

## Priority 1: repeated cross-package vocabulary

- `SkillWorkloadKind`: shared by controller contracts, execution claims, the controller, and the
  Kubernetes launcher. The Prisma `tool_runner` spelling requires an explicit adapter mapping.
- `ChannelResolutionAction` and `ChannelAuthorizedAction`: duplicated between channel proxy and
  server channel-target resolution.
- `ArtifactKind`, `PersonalArtifactState`, and `ArtifactIndexState`: duplicated between artifact
  models, backend finalization, and frontend projections.
- Persona lifecycle/category enums: `PersonaInterviewCategory`, `PersonaInterviewState`,
  `PersonaRevisionState`, and `PersonaOnboardingState` in `@opencrane/models/agents`.
- Transcript enums: `ThreadState`, `MessageRole`, `MessageState`,
  `MessageProvenanceSource`, and `MessageContentBlockType` in `@opencrane/models/agents`.
- `AgentScheduleOverlapPolicy`: duplicated between schedule ticks and agent-service revision
  authoring.

## Priority 2: cohesive local policy vocabularies

The following are locally owned but durable or repeatedly branched:

- `AgentServiceLifecycleAction`
- `DeferredToolDecision`
- `SteeringDisposition`
- `ActionReplayMode`
- `RuntimeWorkspaceClearEvent`
- `AuditDecisionActorKind` and `AuditDecisionOutcome`

These can be converted package by package without creating a new shared dependency.

## Deliberate exclusions

Do not create OpenCrane enums for:

- local one-operation result tags or failure reasons that do not cross a durable/shared boundary;
- generated Prisma values, SQL casts, or SQL data literals;
- HTTP methods, headers, paths, status handling, MIME values, OpenAPI keywords, and JSON-Schema
  keywords;
- Kubernetes API kinds, pull policies, and label conventions;
- external OpenAI, MCP, or other provider protocol spellings;
- deliberate invalid-input fixtures;
- ephemeral presentation-only UI labels and states; or
- one-off static identifiers and configuration data that do not select categorical control flow.

When an excluded external value must be mapped into an OpenCrane-owned vocabulary, keep the raw
value at the adapter edge and convert it explicitly. Do not spread the external spelling through the
domain.

## Review rule

The TypeScript guidance and both review-agent definitions now require documented string-backed enums
for OpenCrane-owned categorical control flow. The mechanical style check emits a
`CATEGORICAL-LITERAL` warning for direct raw-string comparisons on common discriminant properties;
the reviewer must verify ownership and the exclusions above before turning that warning into a
finding.
