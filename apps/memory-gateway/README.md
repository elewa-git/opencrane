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
validated fields is forwarded. The app composes this admission server with one authenticated Cognee
session; Cognee then enforces the service user's dataset access-control list (ACL).

```
 OpenCrane server  ─ projected caller token ──────────┐
                                                      ▼
                                         ┌───────────────────────┐
                                         │ memory-gateway ◄ HERE │
                                         │ TokenReview + allowlist│
                                         └───────────┬───────────┘
                                                     │ authenticated private HTTP
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
client, mounted-credential reader and Cognee session, opens the private listener, and drains it on
shutdown. The request server and provider protocol live in
[`@opencrane/backend/memory-gateway`](../../libs/backend/memory-gateway/main/README.md).

The private HTTP surface mirrors only Cognee search. It is not a public API and must not be routed
through ingress.

## Boundary

This app owns workload authentication, process bootstrap, lifecycle and the read-only credential
mount. It does not decide human permissions, select a memory dataset, or persist credentials. The
OpenCrane server remains the product policy authority, and Cognee enforces the exact dataset named
in the admitted request.

## Dependency direction

Tagged `type:app`, `layer:entrypoint`, `scope:memory-gateway`. It composes Kubernetes and observability clients;
no package may import this app.

## Runtime & config

The Helm template projects one API-server token into the gateway so it can TokenReview callers, and
the server chart projects an `opencrane-memory-gateway` audience token into the OpenCrane server so
admission-time fact selection and compile-time statement loading can present it. Required gateway
process settings are `COGNEE_URL`, `COGNEE_CREDENTIAL_EMAIL_PATH`,
`COGNEE_CREDENTIAL_PASSWORD_PATH`, `POD_NAMESPACE`, `SERVER_SERVICE_ACCOUNT_NAME`, and
`SERVER_TOKEN_AUDIENCE`; Helm sets them all. `COGNEE_ALLOW_FIRST_INSTALL_REGISTRATION` defaults to
`false`. An approved fresh installation may set it to `true` for the first login attempt, then must
return it to `false` so a rejected credential keeps readiness closed.

The gateway runs as the image's non-root UID/GID `1000`, with that group applied to the projected
TokenReview token. Its NetworkPolicy permits only Cognee, cluster DNS, the exact Kubernetes API
Service and backing endpoints supplied through `memoryGateway.kubernetesApiServer*`, and the optional
local telemetry collector. The app-owned deploy script discovers and supplies both address lists; the
chart refuses any render that omits them or disables NetworkPolicy.

`memoryGateway.providerCredential.existingSecret` names the pre-created, immutable Secret whose
`email` and `password` keys are mounted as files. The silo deploy wrapper requires this name and does
not create or read the Secret.

`clustertenantManager.cognee.install` must remain `true`. **TODO:** support an authenticated BYO or
non-private Cognee transport before allowing that mode; the chart currently fails closed instead.

## See also

- Parent index: [apps](../README.md)
- Call-site client: [memory gateway client](../../libs/backend/server/infra/memory-gateway-client/README.md)
- Private vendor deployment: [Cognee](../_infra/cognee/README.md)
