# @opencrane/backend/server/agents/agent-services — immutable agent definitions

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › agent-services

## What it owns

This package owns immutable `AgentService` revisions, personal-assistant configuration, and explicit
setup of one company assistant per silo. The company assistant can be selected for a group child
conversation once its published revision, identity, model permission and the caller's access are ready.

A personal service is created during onboarding with one published revision. Later persona or model
selection changes append and publish another immutable revision rather than editing history. The
repositories re-read the exact source revision, enforce silo and ownership coordinates, record
central authorization decisions, and update the active revision in their caller's transaction.

The package also owns personal execution evidence. Admission proves that the personal service is
active, its requested revision is still published and active, current signed membership realizes the
requester, and the central authority permits invocation and every frozen revision boundary. The
result is immutable decision evidence for one run; it is not a reusable grant.

A company assistant acts through its own stable Internal Principal. Its evidence binds the current
service, published revision and model-use decision. The requesting human has separate signed fleet
membership evidence and must currently be allowed to invoke the service. Internal Principals do not
need a fabricated fleet membership assertion: PostgreSQL service authority and checked identity
history supply their current binding. Neither evidence form grants access by itself.

The first company revision has no persona, skills, tools, memory or knowledge-boundary assignments.
Its deployment-owned profile and budget use a selected model. Admission rejects extended revisions
until those capabilities have a supported company policy.

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
  provide explicit administrator setup, including checked identity establishment after commit.

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

## See also

- Parent index: [agents](../../README.md)
- Siblings: [skills](../../skills/main/README.md) · [artifacts](../../artifacts/main/README.md) · [model routing](../../../gateways/model-routing/main/README.md)
