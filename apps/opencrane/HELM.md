# Server Helm ownership

The OpenCrane server application owns its Deployment, identity and RBAC, Services, edge ingress and certificate, and ingress NetworkPolicy as named Helm templates under `helm/`. The edge ingress sends exact `/healthz` requests to the public server listener before its SPA catch-all, so deployment verification observes readiness plus the public-safe availability of user-visible service boundaries. The silo umbrella composes these resources with its parent release context.

## Memory-gateway caller wiring

The Deployment projects an `opencrane-memory-gateway` audience ServiceAccount token (0440, TTL from
`clustertenantManager.memoryGateway.projectedTokenTtlSeconds`) at `/var/run/opencrane/memory-gateway/token`
and sets `MEMORY_GATEWAY_URL` (via the `opencrane.memoryGatewayUrl` helper), `MEMORY_GATEWAY_TOKEN_PATH`,
and `MEMORY_GATEWAY_TIMEOUT_SECONDS` (from `clustertenantManager.memoryGateway.httpTimeoutSeconds`).
All three are required by the server process — a render that omits them fails boot. The server
NetworkPolicy grants egress only to the release-local `memory-gateway` component on its service
port; the gateway remains the sole Cognee caller. Contract coverage lives in
`apps/_infra/deploy-k8s/platform/tests/server-key-permissions-contract.sh` and
`server-network-policy-contract.sh`.

## Optional outbound CA trust

`clustertenantManager.additionalCaCertificates` lets an operator add CA certificates that the server
trusts for its own outbound TLS, for example a private registry or MCP server CA. It is off by
default. Set `existingSecret` to a pre-created Secret holding one PEM bundle under `secretKey`
(default `ca.crt`), and set `revision` to a label for that bundle. The chart never creates the
Secret.

When enabled, only the server container mounts the bundle, read-only at
`/var/run/opencrane/outbound-ca/ca.crt` with mode 0440, and sets `NODE_EXTRA_CA_CERTS` to it. Node
adds these certificates to its built-in roots; it does not replace them. Node reads the file only
when the process starts, so the Pod carries the `revision` in an annotation: change the label when
the bundle changes, and the server restarts with it. A bundle without its `revision` or `secretKey`
fails to render.

This widens whom the server believes for every outbound TLS connection it makes, not one
destination. Add only CAs you control. Contract coverage lives in
`apps/_infra/deploy-k8s/platform/tests/server-outbound-ca-contract.sh`.

## Fleet membership caller wiring

Fleet mode projects a rotating ServiceAccount token at
`/var/run/opencrane/membership-billing/token`. Its audience and TTL come from
`clustertenantManager.membership.fleet.billingGatewayProjectedTokenAudience` and
`billingGatewayProjectedTokenTtlSeconds`. The server accepts only a credential-free HTTPS receiver
origin, refuses redirects, and re-reads the projected token for every exchange. Fleet must
TokenReview that audience and bind the reviewed server ServiceAccount to the configured silo before
trusting forwarded OIDC caller fields. No static Fleet billing credential Secret is mounted.

