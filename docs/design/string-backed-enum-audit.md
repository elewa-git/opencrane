# String-backed enum audit

Date: 29 July 2026

## Question

Where does OpenCrane own a closed string vocabulary but still repeat its serialized values in type
unions, comparisons, switch cases, validators, schemas, or persistence filters?

The concern is not that strings are inherently wrong. The risk appears when the same category drives
behaviour in more than one place: a spelling change or newly added variant can leave validation,
authorization, persistence, and API projections disagreeing without a compiler error.

## Method

The audit scans production TypeScript and excludes tests, generated clients, distribution output, SQL,
and Prisma schema files. Each comparison, switch case, and categorical union candidate is checked for
OpenCrane ownership, control-flow or durable/shared use, boundary crossing, and an existing enum owner.
The `CATEGORICAL-LITERAL` style warning is deliberately reviewed rather than treated as a mechanical
error because it cannot infer those ownership exclusions.

## Completed in the personal configuration change

The personal configuration package uses documented string-backed enums for patch kinds,
proposal/decision/materialization control codes, and owner-visible lifecycle projection.

`AgentConfigPatchKinds` lives in `@opencrane/contracts` because configuration, personas, and the API
specification consume the same persisted JSON discriminant while the personal packages may not depend
on one another. Its serialized values remain `persona_refresh` and `model_alias`; stored JSON and API
values therefore remain compatible. Package-local enums retain existing serialized result values while
linking the service, repository, router, and materialization branches at compile time.

## Priority 0: authority and durable-contract risk

### Authorization scope kinds

- Owner: `libs/models/authorization/main/src/authorization-scope.types.ts`
- Control flow: `libs/models/authorization/main/src/scope-matching.ts`
- Security digest consumer: `libs/backend/server/iam/membership/main/src/fleet-membership-payload-digest.ts`
- Proposed enum: `AuthorizationScopeKind`, re-exported through `@opencrane/contracts`

Six scope variants participate in authorization matching and signed membership payload digests. They
need one model-owned enum; Prisma's similarly named persistence enum is not the domain owner.

### Runtime execution identity kind

- Duplicates: `libs/contracts/src/runtime-assignment.types.ts`,
  `libs/contracts/src/run-input-snapshot.types.ts`, and
  `libs/backend/agents/execution/runs/main/src/run-admission.types.ts`
- Authority consumers: execution input assembly, run admission, and runtime dispatch
- Proposed enum: `RuntimeExecutionIdentityKind` in `@opencrane/contracts`

The `user`/`service` distinction is an authority boundary and must not be confused with the
personal/managed `AgentServiceKind` product distinction.

### Agent lifecycle vocabularies

- Owner: `libs/models/agents/main/src/agent-service.types.ts`, `agent-run.types.ts`,
  `agent-revision.types.ts`, and `agent-revision-diff.types.ts`
- Transition owner: `libs/models/agents/main/src/state-transitions.ts`
- Proposed enums: retain the existing public names, including `AgentServiceKind`,
  `AgentServiceState`, `AgentRunTrigger`, `AgentRunState`, `AgentRunTerminalReason`,
  `AgentRevisionState`, and `RevisionWideningKind`

These public model contracts drive transition tables and backend lifecycle control flow. Generated
Prisma enums remain adapter-side and map explicitly to model enums.

### Runtime protocol kinds

- Owner: `libs/contracts/src/agent-runtime-protocol.types.ts`
- Authority consumers: runtime protocol and Prisma runtime dispatch authorities
- Proposed enums: `RuntimeCommandKind`, `RuntimeCandidateKind`, and
  `RuntimeCancellationReason`; reuse model-owned `RunEventType` for event dispatch

These are authenticated workload-protocol discriminants. Validators and dispatch branches must use
the same vocabulary.

### Grant scope, subject, and access

`GrantAccess`, `GrantScope`, and `GrantSubjectType` already exist in
`libs/contracts/src/grant.types.ts`, but model and route packages duplicate their strings. Establish
one dependency-neutral owner and map Prisma values at the persistence edge.

## Priority 1: repeated cross-package vocabulary

- `SkillWorkloadKind`, shared by controller contracts, execution claims, the controller, and the
  Kubernetes launcher; the Prisma `tool_runner` spelling needs an explicit adapter mapping.
- `ChannelResolutionAction` and `ChannelAuthorizedAction`, duplicated between channel proxy and
  server channel-target resolution.
- `ArtifactKind`, `PersonalArtifactState`, and `ArtifactIndexState`, duplicated between artifact
  models, backend finalization, and frontend projections.
- Persona lifecycle/category enums (`PersonaInterviewCategory`, `PersonaInterviewState`,
  `PersonaRevisionState`, and `PersonaOnboardingState`) and transcript enums (`ThreadState`,
  `MessageRole`, `MessageState`, `MessageProvenanceSource`, and `MessageContentBlockType`) in
  `@opencrane/models/agents`.
- `AgentScheduleOverlapPolicy`, duplicated between schedule ticks and agent-service revision
  authoring.

## Priority 2: cohesive local policy vocabularies

- `AgentServiceLifecycleAction`, `DeferredToolDecision`, `SteeringDisposition`, `ActionReplayMode`,
  `RuntimeWorkspaceClearEvent`, `AuditDecisionActorKind`, and `AuditDecisionOutcome`.

## Deliberate exclusions

Do not create OpenCrane enums for local one-operation result tags that do not cross a durable/shared
boundary; generated Prisma values, SQL casts, or SQL data literals; HTTP methods, headers, paths,
status handling, MIME values, OpenAPI/JSON-Schema keywords; Kubernetes API kinds and labels; external
provider protocol spellings; deliberate invalid-input fixtures; ephemeral presentation labels; or
one-off configuration data. Map external values explicitly at adapter edges when they enter an
OpenCrane-owned vocabulary.

## Review rule

The TypeScript guidance and both review-agent definitions require documented string-backed enums for
OpenCrane-owned categorical control flow. Reviewers must confirm ownership and the exclusions above
before turning a `CATEGORICAL-LITERAL` warning into a finding.
