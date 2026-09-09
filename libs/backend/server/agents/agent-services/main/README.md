# @opencrane/backend/server/agents/agent-services — immutable agent definitions

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › agent-services

## What it owns

This package owns immutable `AgentService` revisions, personal-assistant configuration, and explicit
setup and exact tool assignment for one company assistant per silo. The company assistant can be selected for a group child
conversation once its published revision, identity, model permission and the caller's access are ready.

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

A company assistant acts through its own stable Internal Principal. Its evidence binds the current
service, published revision, exact sorted tool assignments and model-use decision. The requesting human has separate Fleet or Standalone
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
An administrator can then assign exact published MCP tool revisions through the API below. Its
deployment-owned profile and budget use a selected model. Admission still rejects company persona,
skill and boundary assignments until those capabilities have a supported company policy.

## Public surface

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
  provide explicit administrator setup and tool assignment, including checked identity establishment
  after the first setup commit.

The app supplies transaction-scoped dependencies for admission and revision changes. Company setup
owns its Serializable transaction and retries up to three unique-create or serialization conflicts.
It establishes identity history only after PostgreSQL commits; no Prisma delegates reach callers.

## Company assistant setup

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

## Company assistant tools

An administrator reads `GET /api/v1/organization/company-assistant/tools`, then sends
`PUT` to the same path with `expectedActiveRevisionId` and the complete `toolRevisionIds` selection.
The read and write return `agentServiceId`, `activeRevisionId`, and sorted `toolRevisionIds`. Select
up to 32 unique exact tool revision IDs from the authorized tool catalogue; `[]` removes all tools.

GET checks current Organization Administer without recording an effect. PUT records current
Organization Administer and Assign on every selected tool, including for an unchanged selection.
Each tool must belong to this silo, have a ready immutable server revision, and have an active,
published server. The write preserves the active revision's model, budget, prompt policy and other
content, publishes an immutable successor, and compares the active pointer before committing. It
reconciles Use and Invoke for the assistant's own Principal on removed and selected tools only,
under the existing company-assistant grant manager. Other managers, human grants and model grants
are untouched. An unchanged current selection creates no revision or grant changes.

A stale expected revision returns `409` before checking whether the sets are equal. If a response
is lost after commit, retrying the old expected revision therefore conflicts: GET the authoritative
current selection before another edit. Proven database rollbacks may be retried up to three times;
unknown commit outcomes are not replayed automatically. Tool edits do not rewrite identity history.

Assignment creates no external credential binding or installation. A company assistant never
borrows a human's private credentials. Tools that need company credentials remain unusable until
that separate custody contract exists. The existing run admission freezes exact tool definitions
and schemas and checks the assistant's own current Use; dispatch checks current Invoke, revision
assignment and requesting-human membership again. Assignment success alone does not qualify a
live tool run or complete the T1 product journey.

## Data and persistence

The package uses `AgentService`, `AgentRevision`, revision boundary attachments, skill assignments,
and MCP tool assignments from `apps/opencrane/prisma/schema/agent-services.prisma`. Company setup
also creates one Internal Principal and exact managed authorization grants. Its stable managed
identity is stored through `AgentIdentityHistory`, rather than a parallel relational identity record.
The Principal uses the database's reserved `urn:opencrane:agent-service` issuer, the service ID as
its subject, and no email. The baseline rejects any other issuer for an Internal Principal.

## Dependency direction

Tagged `scope:agent-services`, this package may depend on shared agent models, audit, authentication,
authorization, membership, checked IAM identity history, the history-store append contract, and
shared utilities. IAM identity and history-store do not depend back on this package. It does not
depend on an app, scheduling worker, or the execution-runs package.

## Validation

`backend-server-agent-services:test` runs the unit and HTTP contracts; `lint` also typechecks the SQL
proof. `backend-server-agent-services:test:sql` uses the disposable fresh PostgreSQL baseline in
Actions. Its five cases cover immutable replacement and grant isolation, concurrent edits, rollback
after a lost active-pointer comparison, current permissions and revoked membership, and foreign or
unpublished tools. These database cases are CI qualification; they do not contact a tool provider.

## See also

- Parent index: [agents](../../README.md)
- Siblings: [skills](../../skills/main/README.md) · [artifacts](../../artifacts/main/README.md) · [model routing](../../../gateways/model-routing/main/README.md)
