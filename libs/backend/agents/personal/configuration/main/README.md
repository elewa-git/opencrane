# @opencrane/backend/agents/personal/configuration — reviewed future-session changes

> [backend](../../../../README.md) › [agents](../../../README.md) › [personal](../../README.md) › configuration

## What it owns

This package records and applies changes that a person asks their agent to use in a **future**
session. It never mutates the immutable input snapshot of work that is already running.

The package owns five separate steps:

1. the runtime proposes a closed change through the built-in `upgrade_session` tool;
2. the owner inspects that immutable proposal through the API;
3. the owner explicitly accepts or rejects it;
4. an accepted persona refresh continues through the persona interview; and
5. an accepted model change becomes a new immutable agent revision.

Each persistence capability has its own repository, and a Unit of Work (UoW) owns each transaction
that must coordinate more than one repository.

```
 running personal session
          │  proposes a closed future change
          ▼
 upgrade_session ─► proposal journal ─► owner decision
                                           │
                         ┌─────────────────┴─────────────────┐
                         ▼                                   ▼
                  persona interview                 model materialisation
                         │                                   │
                         └────────► next frozen run input ◄──┘
```

**In this flow:** [personas](../../personas/main/README.md) ·
[execution inputs](../../../execution/inputs/main/README.md) ·
[agent services](../../../../server/agents/agent-services/main/README.md)

Invariant: a proposal is immutable provenance, not mutable session state. Before a proposal is
recorded or applied, the authority rebinds its user, conversation, run, persona, service, and active
revision evidence. Missing, stale, or cross-owner evidence fails closed.
The stored `sourceConversationId` is provenance only: it names the participant-bound conversation
that produced the proposal and never grants access to that conversation or changes its lifecycle.

Internally, the source is grouped by responsibility:

- `proposal/` validates patches, proves source provenance, and inserts the journal record;
- `decision/` owns the owner's accept-or-reject transition;
- `query/` maps bounded owner-visible proposal history;
- `materialization/` uses lifecycle state and patch-kind strategies to coordinate personal configuration and agent-service repositories in one UoW;
- `persona-refresh/` provides the narrow transaction-scoped bridge that a persona authority uses to
  claim and apply an accepted refresh;
- `upgrade-session/` adapts a durably admitted tool invocation into a proposal; and
- `http/` translates authenticated API requests and domain results.

## Public surface

- `_CreatePersonalConfigurationRouter` composes the production owner-only API over Prisma.
- `_PersonalConfigurationOpenapiPaths` contributes the configuration endpoints to the server API.
- `UPGRADE_SESSION_TOOL` and `UPGRADE_SESSION_TOOL_REVISION` describe the built-in future-change tool.
- `__IsUpgradeSessionAvailable` checks whether a frozen run can receive that tool descriptor.
- `UpgradeSessionInvocation` and `UpgradeSessionProposalRepository` form the narrow server-worker
  contract for proposing that future change after runtime admission.
- `PrismaUpgradeSessionProposalUnitOfWork` validates the durable admitted invocation, resolves its
  owner profile, and records the future-session proposal under one transaction.
- `PrismaPersonalConfigurationPersonaRefreshRepository` is the transaction-scoped bridge that a
  persona unit of work uses to claim and apply an accepted refresh without taking over the
  configuration delegate.

All use cases, transaction-scoped repository details, result vocabularies, and HTTP handler
factories remain internal. The public persistence surface is limited to the runtime upgrade-session
contract and unit of work, plus the narrow persona-refresh bridge.

## Boundary

The package does not synthesise persona content, execute the agent, change an active run, or accept
raw instructions, credentials, budgets, policy identifiers, skills, tools, or revision identifiers
from the browser. Persona approval owns persona-refresh application; agent services owns revision
cloning and activation for an accepted model alias.

## Dependency direction

Tagged `scope:personal-configuration` at the backend layer. It may depend on shared contracts, the
request-principal authentication seam, and the narrow agent-service materialisation repository. It
does not import a deployable app or another personal specialisation.

## Data & persistence

Owns `PersonalConfigurationChange`. Proposal insertion and model materialisation use separate UoWs;
the latter binds personal-configuration and agent-service repositories to one serialisable Prisma
transaction. Persona refresh uses a configuration-owned repository bound to the persona aggregate's
transaction. Queries and owner decisions use capability-specific repositories with no shared
multi-purpose Prisma adapter.

## See also

- Parent index: [personal](../../README.md)
- Related domains: [personas](../../personas/main/README.md) · [execution](../../../execution/README.md)
