# @opencrane/backend/server/agents/channel-targets — resolve a browser channel target

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › channel-targets

## What it owns

When someone follows an agent conversation from their browser, the request arrives through the
**channel-proxy** — a workload that forwards browser traffic — and must be turned into one specific,
authorized OpenCrane replay destination. A *channel target* is that resolved destination: the
internal OpenCrane conversation-replay endpoint plus a single-use *invocation context* (an opaque
token the replay receiver exchanges to prove the read was authorized).

This package is the gate that produces it for authorised event reads from an open `agent_session`.
Direct and group conversations do not have runtime routes. Message and run admission use the
participant-owned conversation API; this package exposes no parallel command path.

```
 browser event read via channel-proxy   (events.read)
        │
        ▼
 ┌────────────────────────────────────────────┐
 │  channel-targets  ◄── HERE                  │  proxy workload identity trusted?
 │                                             │  browser session identity trusted by OpenCrane?
 │                                             │  host → silo · live membership · open conversation · read allowed?
 └────────────────────────────────────────────┘
        │  authorized endpoint + single-use invocation context (only its digest is stored)
        ▼
 OpenCrane conversation-replay receiver streams the participant-authorized canonical timeline
```

**In this flow:** channel-proxy [(app)](../../../../../../apps/channel-proxy/README.md) · [membership](../../../iam/membership/main/README.md) *(signed participant admission)*

The resolver runs an ordered set of independent checks. It confirms the proxy's own workload token
(via a Kubernetes identity review, requiring the exact audience, service account, and namespace);
requires the browser user already verified by OpenCrane's shared signed-cookie session middleware;
binds the already-origin-checked host to exactly one registered *silo* (a customer's isolated
tenancy) and a current membership; requires an open agent-session conversation bound to the same
silo and a participant whose access has not ended; and only then applies this package's explicit
`conversation.read/v1` authorization policy. The accepted subject, silo, scope, conversation,
AgentService, action, and membership revision form the canonical authorization digest.
The optional replay cursor is forwarded as a resume hint but grants no access.

The package-owned reconciliation worker converges one route row per AgentService at startup and on
a bounded, non-overlapping interval. A failed pass is logged without credentials and retried on the
next interval; shutdown stops new passes and drains the active pass. Every row has its own route id
but may name the same stable replay `receiverId`; an invocation context binds both identities plus
the exact silo, service, and action. Consumption rechecks that complete tuple and the route's current
and revoked state, so a receiver id can never masquerade as per-service route evidence.

Invariant: it stores only the *digest* of the invocation context, never the token itself, and the
context expires at the sooner of its configured lifetime or the membership's own expiry. The issued
endpoint must be a credential-free HTTP(S) address inside a configured internal DNS suffix. Every
check is fail-closed: a missing, altered, or expired fact yields a `denied` outcome with a stable
reason, and a mistake here can only ever refuse a legitimate request — never over-grant.
An unexpected authority exception returns `authority_unavailable` and emits structured error
evidence with only the safe action and conversation coordinate. Workload tokens, browser cookies,
replay cursors, invocation contexts, and route endpoints never enter that record.

## Public surface

- `__ResolveChannelTarget` — the resolver use case that returns an authorized target or a denial.
- `__AuthorizeConversationRead` — the participant, scope, and conversation-bound read policy and
  canonical decision digest.
- `__DigestChannelInvocationContext` — the single digest authority used when an opaque bearer is
  issued and when it is presented for one-use consumption; the raw bearer is never stored.
- `__ExactHostSiloResolver` — exact deployment-host to silo and organization-scope binding.
- `__ReconcileChannelTargetRoutes`, `__StartChannelTargetRouteReconciler` — one-pass convergence and
  the bounded retry/drain worker.
- `__CreateChannelTargetsRouter` — the HTTP router mounting the resolver with the app-owned logger.
- `__SystemChannelTargetClock`, `__RandomChannelOpaqueContextSource` — the production clock and
  cryptographically-random context source injected into the resolver.
- `PrismaChannelTargetAuthorityUnitOfWork` — the Postgres-backed atomic authority.
- Types: `ResolveChannelTargetCommand`/`Result`, `ChannelTargetResolutionDependencies` (the injected
  ports: workload identity, host→silo, signed membership, repository, clock), and the
  per-check decision and config types.

## Boundary

The application layer only assembles named typed deployment configuration and concrete adapters:
the workload-identity package owns fixed TokenReview and the membership package owns signed
assertion selection and verification. This package owns the conversation-read policy, exact-host
binding, resolver, and reconciliation lifecycle. It issues no
long-lived credentials, creates no message or run, and cannot target a direct, group, closed, or
access-ended conversation. It has an alias
(`@opencrane/backend/server/agents/channel-targets`), so it is titled by that alias.

## Dependency direction

Its `project.json` tags it `scope:channel-targets`. The dedicated boundary permits only its own
scope plus the `auth`, `authorization`, and `membership` authorities used by target resolution and
shared utilities. It cannot depend on apps, frontend/entrypoint layers, execution domains, or other
server authorities.

## Data & persistence

Owns `ChannelRuntimeRoute` and `ChannelInvocationContext` in
`apps/opencrane/prisma/schema/channel-targets.prisma`. A companion SQL authority test lives in
`tests/channel-targets-authority.sql`.

## See also

- Parent index: [agents](../../README.md)
- Siblings: [agent-services](../../agent-services/main/README.md) · [skills](../../skills/main/README.md) · [artifacts](../../artifacts/main/README.md)
