# @opencrane/server/_infra/channel-proxy — blue gateway WebSocket proxy

The identity-routing gateway proxy for the frozen blue OpenClaw platform, folded into the
server process as `GatewayProxyServer`: its own HTTP listener with `/healthz`/`/readyz`
probes plus a WebSocket upgrade handler that authorises and routes each gateway socket to
the caller's owner-pinned OpenClaw pod (stripping the external `/gateway` prefix).

Every upgrade passes four checks in order, cheapest and strictest first: a CSWSH origin
allowlist (exact origins or one-label hosts under a platform base domain — with neither list
configured, all upgrades are refused), delegated auth by replaying the request cookie to the
control plane's `/api/v1/auth/gateway-resolve` (the proxy holds no session state and makes no
auth decision; anything but a clean 200 fails closed), a per-identity fixed-window rate
limit, and forwarding with the client's `X-Forwarded-User` stripped and re-set from the
resolved identity.

Do not confuse it with `libs/backend/channel-proxy/main` + `apps/channel-proxy`: that is the
current standalone channel trust boundary — a stateless per-silo Deployment that forwards
commands and relays SSE over plain HTTP (`/v1/commands`, `/v1/events`) and speaks no
WebSocket. This package serves only the blue OpenClaw gateway WS transport; its sole consumer
is the frozen `libs/backend/feat-openclaw-tenant/main` reconciler, and it is deleted with
that boundary.

Tagged `type:lib`, `layer:infra`, `scope:channel-proxy`: it may depend only on
`scope:channel-proxy` and `scope:shared`.
