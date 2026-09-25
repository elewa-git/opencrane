# memory-gateway — private Cognee trust boundary

> [apps](../README.md) › memory-gateway

A **deployable app** is an independently running OpenCrane process. This one is the private memory
gateway: the only process allowed to make network calls to the silo's Cognee memory service.

## What it owns

OpenCrane keeps product authority in its server. The server first checks the authenticated person,
their grants, the selected memory scope, and the frozen dataset recorded with the run. This gateway
does not repeat those product decisions. It authenticates each caller through Kubernetes TokenReview
and accepts only the shared, bounded memory routes. The provider adapter translates validated
requests into Cognee calls and returns receipts bound to the requested dataset, document and operation.
The app composes that adapter with one authenticated Cognee session; Cognee then enforces the
service user's dataset access-control list (ACL). The gateway is Cognee's only network caller and
its only login: Cognee keeps a search inside the one dataset the gateway names only in
access-control mode, and that mode requires a logged-in user. The gateway signs in with one service
user per silo and never shares that session with callers. See
[ADR 0017](../../docs/adr/0017-cognee-access-control-mode-and-gateway-service-user.md).

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
audience. It supports search, dataset ensure/list, document add/list/digest/delete and Cognify,
which processes saved documents for recall. Each call performs one provider operation or reconciles
its receipt. The server's durable memory workflow owns the sequence, retries and saved progress;
product Remember, Correct and Forget commands are not yet connected to these operations.

## Public surface

`Entrypoint: src/index.ts` (`_Main`) — validates configuration, creates the Kubernetes TokenReview
client, mounted-credential reader and Cognee session, opens the private listener, and drains it on
shutdown. The request server and provider protocol live in
[`@opencrane/backend/memory-gateway`](../../libs/backend/memory-gateway/main/README.md).

The private HTTP surface uses the shared `/api/v1/memory` contract. It is not a public API and must
not be routed through ingress. Cognee routes remain private to the provider adapter.

## Boundary

This app owns workload authentication, process bootstrap, lifecycle and the read-only credential
mount. It does not decide human permissions, select a memory dataset, or persist credentials. The
OpenCrane server remains the product policy authority, and Cognee enforces the exact dataset named
in the admitted request. Every dataset belongs to the one service user, so Cognee's permissions do
not separate employees; the server's dataset selection does, and Cognee's access-control mode makes
that selection hold at retrieval. Network isolation remains the transport wall around this exchange.

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

`clustertenantManager.cognee.install` must remain `true`. A shared or external Cognee is unsupported
because the per-silo service user and NetworkPolicy both assume a private instance; the chart fails
closed instead of allowing that mode.

The `memory-gateway:test` target runs app configuration tests and the connected client/gateway
contract in `tests/memory-gateway/__tests__`. The connected test imports both public adapters outside
the production package graph. Its file and the client sources are explicit test and type-check cache
inputs; production scope rules remain unchanged.

## See also

- Parent index: [apps](../README.md)
- Call-site client: [memory gateway client](../../libs/backend/server/infra/memory-gateway-client/README.md)
- Private vendor deployment: [Cognee](../_infra/cognee/README.md)
