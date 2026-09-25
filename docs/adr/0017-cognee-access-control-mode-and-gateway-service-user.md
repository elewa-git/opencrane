# ADR 0017 — Cognee access-control mode and gateway service user

- **Status:** Accepted
- **Date:** 2026-09-13
- **Task:** [#889](https://github.com/elewa-git/opencrane/issues/889)
- **Supersedes:** no ADR clause. It corrects the deployment posture previously described in the
  Cognee and memory-gateway READMEs and on the website, which presented Cognee's disabled login as
  safe because the gateway is its only network caller.
- **Evidence:** the memory-provider contract in [#863](https://github.com/elewa-git/opencrane/pull/863)
  and the gateway provider session in [#873](https://github.com/elewa-git/opencrane/pull/873).

## Context

Every silo runs one private Cognee. A NetworkPolicy admits ingress only from the memory gateway and
limits Cognee's egress to release-local LiteLLM, cluster DNS and optional telemetry. The chart set
`ENABLE_BACKEND_ACCESS_CONTROL=false` and `REQUIRE_AUTHENTICATION=false`, on the reasoning that the
authenticated gateway was the only caller, so Cognee's own login added nothing.

The provider contract ran the pinned Cognee 1.2.1 image in both modes against synthetic datasets and
showed that the reasoning misses where the risk sits:

- With access control off, a `CHUNKS` search scoped to one dataset returned chunks from another
  dataset. Cognee's search module says that searching by dataset is only available in
  `ENABLE_BACKEND_ACCESS_CONTROL` mode. Without it, one search runs over a single shared vector and
  graph store with no dataset database context, and the dataset argument does not confine it. Every
  employee's memories share that store.
- With access control on, Cognee runs each search inside a per-dataset database context. That is
  the mechanism that keeps one person's memories out of another person's recall.
- Cognee's start-up check treats access control on with authentication off as a misconfiguration. It
  logs that multi-tenant mode requires authentication and forces `REQUIRE_AUTHENTICATION=true`. Per-
  dataset storage is therefore only available to a logged-in user.

Network isolation answers who may connect to Cognee. It cannot answer what one search may see inside
Cognee. The single admitted caller, the gateway, is the process asking on behalf of different people,
so restricting callers further changes nothing.

## Decision

1. Cognee runs with `ENABLE_BACKEND_ACCESS_CONTROL=true` and `REQUIRE_AUTHENTICATION=true` in every
   silo. The switch change lands together with the authenticated isolation, recall, identity and
   restart proofs from the provider contract in CI, not before.
2. The memory gateway is Cognee's only login. It uses one service user per silo. The email and
   password are mounted from a pre-created Secret into the gateway only. The gateway logs in with
   them and registers the user only when an explicit first-install override allows it. The
   bearer token lives in gateway memory, is never logged, persisted or returned to a caller, and
   is replayed at most once after an HTTP 401.
3. Every dataset belongs to that one service user. Cognee's permission system therefore does not
   separate employees and is not presented as doing so. Separation comes from OpenCrane: the server
   selects the exact dataset UUID from admitted authority ([ADR 0015](0015-central-durable-authorization-authority.md)),
   the gateway forwards exactly one dataset UUID per request and may not choose or widen it, and
   Cognee's access-control mode makes that scope hold at retrieval time.
4. NetworkPolicy remains the transport perimeter. Only the gateway may connect to Cognee, and Cognee
   may reach only release-local LiteLLM, DNS and optional telemetry. The Cognee login is a condition
   Cognee imposes to unlock per-dataset storage. It is not a second authorisation layer.

## Alternatives considered

- **Keep access control off and rely on NetworkPolicy.** Rejected. The leak is between datasets inside
  one Cognee process, which no network rule can see.
- **Access control on, authentication off.** Rejected. Cognee refuses this combination and forces
  authentication on.
- **One Cognee user per employee.** Rejected for now. It adds a credential per person to custody and
  rotate and a Cognee-side user lifecycle to mirror membership, while the gateway is already the sole
  caller and the server already selects the dataset. Revisit only if a shared or external Cognee is
  ever supported.
- **Search the shared store and filter results afterwards.** Rejected. The top-k window is consumed by
  other people's chunks, and graph-completion search types blend content before OpenCrane sees it.
- **One Cognee deployment per employee.** Rejected on cost.

## Consequences

- Each silo needs one pre-created, immutable Secret for the Cognee service user; the silo chart
  only references it by name. First-install registration is off by default and needs an explicit,
  reviewed override.
- Gateway readiness depends on a successful Cognee login. Failure categories are secret-free and
  stable so health checks and logs can name them.
- Access-control mode returns a dataset envelope. The gateway requires the requested dataset in that
  envelope and rejects any other shape.
- Dataset names are opaque and belong to the service user. Dataset UUIDs are the only coordinates
  OpenCrane stores or forwards.
- The deployment comment beside the switches, the Cognee and memory-gateway READMEs, the operators'
  networking page, the long-term-memory page and the knowledge guide are corrected to this posture.
- Forget is unaffected by this decision and remains gated by its own erasure proof. Cognee 1.2.1
  fails final source-byte deletion; the patched 1.5.4 candidate is a separate decision.
