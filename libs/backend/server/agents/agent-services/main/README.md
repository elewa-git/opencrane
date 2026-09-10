# @opencrane/backend/server/agents/agent-services — immutable agent definitions

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › agent-services

## What it owns

This package owns immutable `AgentService` revisions, personal-assistant configuration, and explicit
setup and tool selection for one company assistant per silo, the organisation's isolated data boundary.
The company assistant can be selected for a group child
conversation once its published revision, identity, model permission and the caller's access are ready.

```
 administrator or approved personal configuration
                      │ selected model and capabilities
                      ▼
 ┌──────────────────────────────────────────┐
 │ agent-services ◄── HERE                  │
 │ publish an immutable revision and grants │
 └──────────────────────────────────────────┘
                      │ exact revision and current permission evidence
                      ▼
 conversations → admit work through the workflow contract
```

**In this flow:** [personal configuration](../../../../agents/personal/configuration/main/README.md) ·
[conversations](../../../conversations/main/README.md) · [workflow contract](../../../infra/workflows/contract/README.md).

The source tree separates `company-assistants/`, `personal-agents/`, `revisions/` and
`execution-evidence/`. Each owner keeps persistence adapters under `db/` and tests under `__tests__/`.

A personal service is created during onboarding with one published revision. Later persona or model
selection changes append and publish another immutable revision rather than editing history. The
repositories re-read the exact source revision, enforce silo and ownership coordinates, record
central authorization decisions, and update the active revision in their caller's transaction.

The app supplies the deployment's conversation-computer profile when composing personal-agent
bootstrap. Initial publication stores that name, and readiness requires an existing service to
match it. An absent profile prevents startup; a mismatched stored profile is refused without
rewriting the service. The product's initial revision policy supplies budgets and prompt policy,
while the deployment selects which computer can run it.

The package also owns personal execution evidence. Admission proves that the personal service is
active, its requested revision is still published and active, current deployment-selected human membership proves the
requester, and the central authority permits invocation and every frozen revision boundary. The
result is immutable decision evidence for one run; it is not a reusable grant.

A company assistant acts through its own stable Internal Principal, a saved identity for the service.
Its evidence binds the current service, published revision, exact tool selection and model-use decision.
The requesting human has separate Fleet or Standalone
membership evidence and must currently be allowed to invoke the service. Internal Principals do not
need a fabricated fleet membership assertion: PostgreSQL service authority and checked identity
history supply their current binding. Neither evidence form grants access by itself. Both service repositories delegate human membership
to the common IAM reader. Standalone evidence binds the active local membership row/version and
external identity; its digest enters admission arguments and capability evidence. Audit records carry
a membership revision for Fleet alone.

Company model-use admissions record `agent-service` with the company's Principal ID, both when
creating a child conversation and when admitting a run. Human Invoke decisions record `user` with
the requesting Principal ID. Runtime Pod identity belongs to later workload decisions.

The first company revision has no persona, skills, tools, memory or knowledge-boundary assignments.
An administrator can then assign exact MCP (Model Context Protocol) tool revisions. New company
assistants permit at most two model requests under one saved 32,000-token, two-minute turn budget.
Tool edits preserve the saved budget. Admission still rejects persona, skill and boundary
assignments until those capabilities have a supported company policy.

## Public surface

- `_CreateCompanyAssistantComposition` supplies the initial managed-agent policy and authenticated
  administrator router from the deployment profile and injected logger.

- `PrismaPersonalAgentBootstrapRepository` creates or repairs the personal service during onboarding.
- `PrismaAgentRevisionModelSelectionRepository` materializes an accepted model choice as a new revision.
- `PrismaAgentRevisionPersonaSelectionRepository` materializes an approved persona as a new revision.
- `PrismaPersonalAgentProductEffectsAuthority` records onboarding product-resource decisions.
- `PrismaPersonalExecutionEvidenceRepository` and `PersonalExecutionEvidenceAuthority` prove current
  personal execution eligibility inside run admission.
- `PrismaRuntimeAgentEffectEligibilityAuthority` rechecks the active service and revision before an
  external runtime effect.
- `__ExecutionCapabilityEvidence` canonicalizes the immutable personal execution evidence digest.
- `PrismaManagedExecutionEvidenceRepository` and `ManagedExecutionEvidenceAuthority` independently
  admit the human's invocation and the company Principal's model use.
- `PrismaManagedAgentConversationResolver` resolves a ready company assistant and filters the
  discovery list through current human Discover, Read and Invoke permissions plus the company's
  own Model Use permission. Listing checks eligibility without recording mutation or effect
  admissions. Child creation separately records human Invoke and company Model Use decisions after
  the same current service, identity, profile and membership checks.
- `PrismaCompanyAssistantProvisioningUnitOfWork` and `_CreateCompanyAssistantProvisioningRouter`
  provide administrator setup and exact tool selection, including checked identity establishment
  after the setup commit.

The app supplies transaction-scoped dependencies for admission and revision changes. Company setup
owns its Serializable transaction and retries up to three unique-create or serialization conflicts.
It establishes identity history only after PostgreSQL commits; no Prisma delegates reach callers.

## Boundary

Only the owning authority may publish an agent revision or record product-access evidence.
Callers supply the current transaction and deployment profile; they cannot replace these checks
with request fields.

### Company assistant setup

An authenticated operator calls `POST /api/v1/organization/company-assistant` with `name`,
`modelDefinitionId`, and explicit `invokerPrincipalIds`. These are current local human Principal IDs,
not email addresses or membership-directory references. This is an operator API; there is no company
assistant management screen in this slice. The caller needs Organization Administer and selected
Model Use. Every selected invoker must be a current active member of the same silo.

The first committed setup grants selected humans Discover, Read and Invoke on that exact assistant;
the assistant's own Principal receives Use on the selected model. It creates no silo-wide grant.
The response returns `created: true` and the public assistant reference after identity establishment.
An existing assistant returns `created: false`: changed choices are not applied, revoked grants are
not restored, and paused or retired services are not revived. A failed identity append can be retried
from the committed service and first revision; suspended or revoked identities remain unavailable.

### Company assistant tools

Read `GET /api/v1/organization/company-assistant/tools`, then replace the selection with `PUT` to
the same path. Supply `expectedActiveRevisionId` from the read and up to 32 unique `toolRevisionIds`;
`[]` removes all assignments. Both responses contain `agentServiceId`, `activeRevisionId` and sorted
`toolRevisionIds`. This remains an administrator API without a management screen.

GET checks current Organization Administer. PUT records that decision and Assign for every selected
tool, even when the selection is unchanged. Each tool must belong to this silo and a Ready revision
of an Active, Published server. An unchanged selection creates no revision and restores no grants.
A changed selection publishes an immutable successor while preserving the model, budget, prompt
policy and other revision content.

Publication and the assistant's exact tool Use/Invoke grants commit together. Reconciliation changes
only grants owned by this company-assistant configuration; it leaves other managers, human grants
and model grants alone. Removing an assignment prevents later dispatch through the superseded
revision. It cannot undo an external effect that has already started.

A stale expected revision returns `409`, even when the submitted selection matches the saved one.
After an uncertain response, GET the current selection before editing again. The transaction helper
retries only proven rollbacks, up to three attempts; it does not replay an unknown commit outcome.
Tool edits never rewrite the assistant's identity history or replenish its model budget.

Assignment does not install an integration or activate company credentials, and it does not borrow
the requesting employee's private permissions or credentials. Run admission freezes the selected
tool definitions and checks current Use; dispatch rechecks Invoke, revision assignment and human
membership. Participant-visible tool results remain unfinished, and live retrieval is unqualified.

## Dependency direction

Tagged `scope:agent-services`, this package may depend on shared agent models, audit, authentication,
authorization, membership, checked IAM identity history, the history-store append contract, and
shared utilities. IAM identity and history-store do not depend back on this package. It does not
depend on an app, scheduling worker, or the execution-runs package.

## Data and persistence

The package uses `AgentService`, `AgentRevision`, revision boundary attachments, skill assignments,
and MCP tool assignments from `apps/opencrane/prisma/schema/agent-services.prisma`. Company setup
also creates one Internal Principal and exact managed authorization grants. Its stable managed
identity is stored through `AgentIdentityHistory`, rather than a parallel relational identity record.
The Principal uses the database's reserved `urn:opencrane:agent-service` issuer, the service ID as
its subject, and no email. The baseline rejects any other issuer for an Internal Principal.

## See also

- Parent index: [agents](../../README.md)
- Siblings: [skills](../../skills/main/README.md) · [artifacts](../../artifacts/main/README.md) · [model routing](../../../gateways/model-routing/main/README.md)
