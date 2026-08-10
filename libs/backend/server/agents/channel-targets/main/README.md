# @opencrane/backend/server/agents/channel-targets — resolve a browser channel target

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › channel-targets

## What it owns

When someone uses an agent from their browser, the request does not reach the agent runtime
directly. It arrives through the **channel-proxy** — a workload that forwards browser traffic — and
must be turned into one specific, authorized runtime destination. A *channel target* is that
resolved destination: an internal endpoint plus a single-use *invocation context* (an opaque token
the runtime later exchanges to prove the call was authorized).

This package is the gate that produces it for authorised event reads from an open `agent_session`.
Direct and group conversations do not have runtime routes. Message and run admission use the
participant-owned conversation API; this package exposes no parallel command path.

```
 browser event read via channel-proxy   (events.read)
        │
        ▼
 ┌────────────────────────────────────────────┐
 │  channel-targets  ◄── HERE                  │  proxy workload identity trusted?
 │                                             │  browser user identity trusted (cookie, no bearer fallback)?
 │                                             │  host → silo · live membership · open conversation · read allowed?
 └────────────────────────────────────────────┘
        │  authorized endpoint + single-use invocation context (only its digest is stored)
        ▼
 agent runtime performs the read
```

**In this flow:** channel-proxy [(app)](../../../../../../apps/channel-proxy/README.md) · [authorization](../../../iam/authorization/main/README.md) *(the allow/deny decision)*

The resolver runs an ordered set of independent checks. It confirms the proxy's own workload token
(via a Kubernetes identity review, requiring the exact audience, service account, and namespace);
resolves the browser user from a cookie first and refuses to fall back to a bearer token if a cookie
is present but invalid; binds the already-origin-checked host to exactly one registered *silo* (a
customer's isolated tenancy) and a current signed membership; requires an active conversation bound to the
same silo and a participant whose access has not ended; and only then authorises
`conversation.read`. The optional replay cursor is forwarded as a resume hint but grants no access.

Invariant: it stores only the *digest* of the invocation context, never the token itself, and the
context expires at the sooner of its configured lifetime or the membership's own expiry. The issued
endpoint must be a credential-free HTTP(S) address inside a configured internal DNS suffix. Every
check is fail-closed: a missing, altered, or expired fact yields a `denied` outcome with a stable
reason, and a mistake here can only ever refuse a legitimate request — never over-grant.

## Public surface

- `__ResolveChannelTarget` — the resolver use case that returns an authorized target or a denial.
- `__CreateChannelTargetsRouter` — the HTTP router mounting the resolver.
- `__SystemChannelTargetClock`, `__RandomChannelOpaqueContextSource` — the production clock and
  cryptographically-random context source injected into the resolver.
- `PrismaChannelTargetAuthorityUnitOfWork` — the Postgres-backed atomic authority.
- Types: `ResolveChannelTargetCommand`/`Result`, `ChannelTargetResolutionDependencies` (the injected
  ports: workload identity, delegated browser identity, host→silo, membership, authorization,
  repository, clock), and the per-check decision and config types.

## Boundary

The application layer supplies the concrete identity, membership, and authorisation ports and
mounts the router. This package makes no policy of its own beyond the trust checks above, issues no
long-lived credentials, creates no message or run, and cannot target a direct, group, closed, or
access-ended conversation. It has an alias
(`@opencrane/backend/server/agents/channel-targets`), so it is titled by that alias.

## Dependency direction

Its `project.json` tags it `scope:channel-targets`, but no dedicated `depConstraint` names that
scope in `eslint.config.mjs`; it is therefore governed only by the shared backend rules — a
`type:lib` under `layer:backend` may not depend on any app or on frontend/entrypoint layers.

## Data & persistence

Owns `ChannelRuntimeRoute` and `ChannelInvocationContext` in
`apps/opencrane/prisma/schema/channel-targets.prisma`. A companion SQL authority test lives in
`tests/channel-targets-authority.sql`.

## See also

- Parent index: [agents](../../README.md)
- Siblings: [agent-services](../../agent-services/main/README.md) · [skills](../../skills/main/README.md) · [artifacts](../../artifacts/main/README.md)
