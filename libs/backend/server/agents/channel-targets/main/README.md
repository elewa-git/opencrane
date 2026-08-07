# @opencrane/backend/server/agents/channel-targets — resolve a browser channel target

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › channel-targets

## What it owns

When someone uses an agent from their browser, the request does not reach the agent runtime
directly. It arrives through the **channel-proxy** — a workload that forwards browser traffic — and
must be turned into one specific, authorized runtime destination. A *channel target* is that
resolved destination: an internal endpoint plus a single-use *invocation context* (an opaque token
the runtime later exchanges to prove the call was authorized).

This package is the gate that produces it. For each browser operation (read a thread's events, or
forward a command to the agent) it independently re-checks every trust fact before handing back a
target — it never assumes an earlier layer already did.

```
 browser operation via channel-proxy   (events.read · command.forward)
        │
        ▼
 ┌────────────────────────────────────────────┐
 │  channel-targets  ◄── HERE                  │  proxy workload identity trusted?
 │                                             │  browser user identity trusted (cookie, no bearer fallback)?
 │                                             │  host → silo · live membership · active thread · actions allowed?
 └────────────────────────────────────────────┘
        │  authorized endpoint + single-use invocation context (only its digest is stored)
        ▼
 agent runtime performs the read, or starts the run
```

**In this flow:** channel-proxy [(app)](../../../../../../apps/channel-proxy/README.md) · [authorization](../../../iam/authorization/main/README.md) *(the allow/deny decision)*

The resolver runs an ordered set of independent checks. It confirms the proxy's own workload token
(via a Kubernetes identity review, requiring the exact audience, service account, and namespace);
resolves the browser user from a cookie first and refuses to fall back to a bearer token if a cookie
is present but invalid; binds the already-origin-checked host to exactly one registered *silo* (a
customer's isolated tenancy) and a current signed membership; requires an active thread bound to the
same silo and participant; and only then authorizes the full action set. A forwarded command also
requires a real, ready run before a target is issued.

For commands, the proxy also supplies a canonical thread id and an opaque transport idempotency key.
The run-start authority must bind that key to the durable command before creating or reusing a run; the
resolver never accepts a command route that lacks either coordinate.

Invariant: it stores only the *digest* of the invocation context, never the token itself, and the
context expires at the sooner of its configured lifetime or the membership's own expiry. The issued
endpoint must be a credential-free HTTP(S) address inside a configured internal DNS suffix. Every
check is fail-closed: a missing, altered, or expired fact yields a `denied` outcome with a stable
reason, and a mistake here can only ever refuse a legitimate request — never over-grant.
Once a run enters `cancelling`, both new command contexts and previously issued, unconsumed command
contexts are refused immediately; physical Job cleanup does not keep browser command authority open.

## Public surface

- `__ResolveChannelTarget` — the resolver use case that returns an authorized target or a denial.
- `__CreateChannelTargetsRouter` — the HTTP router mounting the resolver.
- `__SystemChannelTargetClock`, `__RandomChannelOpaqueContextSource` — the production clock and
  cryptographically-random context source injected into the resolver.
- `PrismaChannelTargetAuthorityRepository` — the Postgres-backed persistence adapter.
- Types: `ResolveChannelTargetCommand`/`Result`, `ChannelTargetResolutionDependencies` (the injected
  ports: workload identity, delegated browser identity, host→silo, membership, authorization, run
  start, repository, clock), and the per-check decision and config types.

## Boundary

The application layer supplies the concrete identity, membership, authorization, and run-start ports
and mounts the router. This package makes no policy of its own beyond the trust checks above and
issues no long-lived credentials. It has an alias (`@opencrane/backend/server/agents/channel-targets`),
so it is titled by that alias.

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
