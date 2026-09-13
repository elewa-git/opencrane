# memory-gateway — private Cognee trust boundary

> [apps](../README.md) › memory-gateway

A **deployable app** is an independently running OpenCrane process. This one is the private memory
gateway: the only process allowed to make network calls to the silo's Cognee memory service.

## What it owns

OpenCrane keeps product authority in its server. The server first checks the authenticated person,
their grants, the selected memory scope, and the frozen dataset recorded with the run. This gateway
does not repeat those product decisions, but it does own **request-shape authorization** for the
private Cognee plane: identity (TokenReview of the server's audience-bound projected token), route
(only bounded search), and the payload contract (exactly one validated query, the `CHUNKS` search
type, exactly one UUID dataset, and a bounded `top_k`). Anything outside that shape is refused with
`422 invalid_search` before a byte reaches Cognee, and only a canonical re-serialization of the
validated fields is forwarded. The gateway is Cognee's only network caller and its only admission
decision. It is also Cognee's only login: Cognee runs in access-control mode because that is the only
mode in which a search stays inside the one dataset the gateway names, and Cognee requires a logged-in
user for that mode. The gateway signs in with one service user per silo and never shares that session
with callers. See
[ADR 0017](../../docs/adr/0017-cognee-access-control-mode-and-gateway-service-user.md).

```
 OpenCrane server  ─ projected caller token ──────────┐
                                                      ▼
                                         ┌───────────────────────┐
                                         │ memory-gateway ◄ HERE │
                                         │ TokenReview + allowlist│
                                         └───────────┬───────────┘
                                                     │ private HTTP
                                                     ▼
                                              Cognee (no public route)
```

**In this flow:** [opencrane server](../opencrane/README.md) · [Cognee deployment](../_infra/cognee/README.md)

It accepts only the server's exact ServiceAccount identity and the `opencrane-memory-gateway`
audience. The current transport forwards only bounded search requests. Add, cognify, and deletion
remain unavailable until OpenCrane owns a durable write lifecycle that can recover safely across
database, process, and Cognee failures. Anything else is refused, with no direct Cognee fallback.

## Public surface

`Entrypoint: src/index.ts` (`_Main`) — validates configuration, creates the Kubernetes TokenReview
client, opens the private listener, and drains it on shutdown.

The private HTTP surface mirrors only Cognee search. It is not a public API and must not be routed
through ingress.

## Boundary

This app owns workload authentication, private transport and the Cognee service-user session. It does
not own human permissions, memory dataset selection or persistence. The OpenCrane server remains the
policy enforcement point. The service-user credential is mounted from an application-owned Secret,
used only for Cognee login or first-install registration, and never logged, persisted or returned.
Every dataset belongs to that one user, so Cognee's permissions do not separate employees; the
server's dataset selection does, and Cognee's access-control mode makes that selection hold at
retrieval. Network isolation remains the transport wall around this exchange.

## Dependency direction

Tagged `type:app`, `layer:entrypoint`, `scope:memory-gateway`. It composes Kubernetes and observability clients;
no package may import this app.

## Runtime & config

The Helm template projects one API-server token into the gateway so it can TokenReview callers, and
the server chart projects an `opencrane-memory-gateway` audience token into the OpenCrane server so
admission-time fact selection and compile-time statement loading can present it. Required gateway
process settings are `COGNEE_URL`, `POD_NAMESPACE`, `SERVER_SERVICE_ACCOUNT_NAME`, and
`SERVER_TOKEN_AUDIENCE`; Helm sets them all.

The gateway runs as the image's non-root UID/GID `1000`, with that group applied to the projected
TokenReview token. Its NetworkPolicy permits only Cognee, cluster DNS, the exact Kubernetes API
Service and backing endpoints supplied through `memoryGateway.kubernetesApiServer*`, and the optional
local telemetry collector. The app-owned deploy script discovers and supplies both address lists; the
chart refuses any render that omits them or disables NetworkPolicy.

`clustertenantManager.cognee.install` must remain `true`. A shared or external Cognee is unsupported
because the per-silo service user and NetworkPolicy both assume a private instance; the chart fails
closed instead of allowing that mode.

## See also

- Parent index: [apps](../README.md)
- Call-site client: [memory gateway client](../../libs/backend/server/infra/memory-gateway-client/README.md)
- Private vendor deployment: [Cognee](../_infra/cognee/README.md)
