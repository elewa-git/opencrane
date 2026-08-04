# Server Helm ownership

The OpenCrane server application owns its Deployment, identity and RBAC, Services, edge ingress and certificate, and ingress NetworkPolicy as named Helm templates under `helm/`. The edge ingress sends exact `/healthz` requests to the public server listener before its SPA catch-all, so deployment verification observes server and database health. The silo umbrella composes these resources with its parent release context.

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

## Obot management transport

The Deployment renders the server→Obot management coordinates only when
`mcpGateway.serviceTokenExistingSecret` names a pre-provisioned Secret (key `token`) carrying the
Obot service credential:

- `OBOT_GATEWAY_URL` from the `opencrane.mcpGatewayUrl` helper (the fully-qualified release-local
  `*-mcp-gateway` Service origin in instance mode).
- `OBOT_SERVICE_TOKEN_PATH=/var/run/opencrane/obot/token`, mounted read-only (`0440`) from that
  Secret and re-read per call.
- `OBOT_TIMEOUT_SECONDS` from `mcpGateway.serverTimeoutSeconds` (default 30, bounded 1–300).

When the value is empty (the default) nothing renders and the application composes fail-closed
unavailable Obot adapters: custody provisioning refuses and no run attempt carries an Obot key. The
server NetworkPolicy adds matching `mcp-gateway` egress for the management API only; tool payloads
flow runtime→Obot and never transit this Deployment.
