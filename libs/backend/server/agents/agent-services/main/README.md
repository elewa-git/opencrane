# @opencrane/backend/server/agents/agent-services — immutable agent definitions

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › agent-services

## What it owns

This package owns immutable `AgentService` revisions and the narrow transaction-bound operations
used by personal-agent onboarding and configuration. It does not expose an HTTP management API,
schedule agents, or admit managed run-now requests in the 0.11.0 baseline.

A personal service is created during onboarding with one published revision. Later persona or model
selection changes append and publish another immutable revision rather than editing history. The
repositories re-read the exact source revision, enforce silo and ownership coordinates, record
central authorization decisions, and update the active revision in their caller's transaction.

The package also owns personal execution evidence. Admission proves that the personal service is
active, its requested revision is still published and active, current signed membership realizes the
requester, and the central authority permits invocation and every frozen revision boundary. The
result is immutable decision evidence for one run; it is not a reusable grant.

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

The app supplies transaction-scoped dependencies. This package never opens a second cross-domain
transaction and never exposes Prisma delegates to callers.

## Data and persistence

The package uses `AgentService`, `AgentRevision`, revision boundary attachments, skill assignments,
and MCP tool assignments from `apps/opencrane/prisma/schema/agent-services.prisma`. It owns no
scheduling table in the 0.11.0 baseline.

## Dependency direction

Tagged `scope:agent-services`, this package may depend on shared agent models, audit, authentication,
authorization, membership, and shared utilities. It does not depend on an app, scheduling worker, or
the execution-runs package.

## See also

- Parent index: [agents](../../README.md)
- Siblings: [skills](../../skills/main/README.md) · [artifacts](../../artifacts/main/README.md) · [model routing](../../../gateways/model-routing/main/README.md)
