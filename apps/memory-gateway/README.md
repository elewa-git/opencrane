# memory-gateway — private Cognee trust boundary

> [apps](../README.md) › memory-gateway

A **deployable app** is an independently running OpenCrane process. This one is the private memory
gateway: the only process allowed to make network calls to the silo's Cognee memory service.

## What it owns

OpenCrane keeps product authority in its server. The server first checks the authenticated person,
their grants, the selected memory scope, and the frozen dataset recorded with the run. This gateway
does not repeat those product decisions. Instead, it turns that authorised server request into a
private Cognee request only after Kubernetes verifies the server's short-lived workload identity.
The gateway and client are currently a sealed foundation: production runtime composition does not
yet mount or present that caller token.

```
 OpenCrane server  ─ future projected caller token ───┐
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

This app owns workload authentication and private transport, not human permissions, memory dataset
selection, persistence, or Cognee credentials. The OpenCrane server remains the policy enforcement
point. Cognee is intentionally unauthenticated in this one private deployment design because the
gateway's authenticated identity and network isolation form its wall.

## Dependency direction

Tagged `type:app`, `layer:entrypoint`, `scope:memory-gateway`. It composes Kubernetes and observability clients;
no package may import this app.

## Runtime & config

The Helm template projects one API-server token into the gateway so it can TokenReview future
callers. It deliberately does not yet project an `opencrane-memory-gateway` token into the OpenCrane
server; that credential lands only with safe runtime result delivery. Required gateway process
settings are `COGNEE_URL`, `POD_NAMESPACE`, `SERVER_SERVICE_ACCOUNT_NAME`, and
`SERVER_TOKEN_AUDIENCE`; Helm sets them all.

The gateway runs as the image's non-root UID/GID `1000`, with that group applied to the projected
TokenReview token. Its NetworkPolicy permits only Cognee, cluster DNS, the exact Kubernetes API
Service and backing endpoints supplied through `memoryGateway.kubernetesApiServer*`, and the optional
local telemetry collector. The app-owned deploy script discovers and supplies both address lists; the
chart refuses any render that omits them or disables NetworkPolicy.

`clustertenantManager.cognee.install` must remain `true`. **TODO:** support an authenticated BYO or
non-private Cognee transport before allowing that mode; the chart currently fails closed instead.

## See also

- Parent index: [apps](../README.md)
- Call-site client: [memory gateway client](../../libs/backend/_server/memory-gateway-client/README.md)
- Private vendor deployment: [Cognee](../_infra/cognee/README.md)
