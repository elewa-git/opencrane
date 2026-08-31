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

## Fleet membership caller wiring

Fleet mode projects a rotating ServiceAccount token at
`/var/run/opencrane/membership-billing/token`. Its audience and TTL come from
`clustertenantManager.membership.fleet.billingGatewayProjectedTokenAudience` and
`billingGatewayProjectedTokenTtlSeconds`. The server accepts only a credential-free HTTPS receiver
origin, refuses redirects, and re-reads the projected token for every exchange. Fleet must
TokenReview that audience and bind the reviewed server ServiceAccount to the configured silo before
trusting forwarded OIDC caller fields. No static Fleet billing credential Secret is mounted.

## Channel target and replay wiring

When `channelProxy.enabled=true`, the Deployment renders the complete resolver contract: the exact
channel-proxy ServiceAccount, the public control-plane host, the silo id, a stable replay receiver,
and the release-local internal replay endpoint. OpenCrane mounts the same signed-session middleware
on both listeners, TokenReviews the proxy's projected `opencrane` token, and accepts browser identity
only from that verified session. At startup it reconciles one `events.read` route row per existing
AgentService. Those rows share `channelProxy.replayReceiverId` but retain distinct route ids, so
revocation and consumption remain bound to exact per-service evidence.
