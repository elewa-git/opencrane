# channel-proxy — inbound channel trust boundary

> [apps](../README.md) › channel-proxy

<!-- This package has no `@opencrane/*` import alias: it is a deployable app, not a
     library, so it is titled by its `project.json` name (`channel-proxy`). -->

A **deployable app** in OpenCrane is a thin process that composes backend libraries and ships as one
container image. This one is the **channel proxy**: the single front door for untrusted traffic
arriving from outside chat/messaging channels (a Slack webhook, a Teams callback, a browser event
stream) before it is allowed anywhere near the control plane.

## What it owns

OpenCrane runs one isolated slice per customer — a **silo** (one customer's own namespace, control
plane, and runtime pods, sharing nothing with other customers). The channel proxy sits at that
silo's edge. Everything reaching it is untrusted; everything behind it is the trusted OpenCrane
server. The proxy's whole job is to be the **trust boundary**: enforce hard limits on what may enter,
then hand the request on. It adds no product logic and makes no allow/deny decision about *who* the
caller is — it only checks the request is shaped safely and forwards it.

It is one step in the inbound flow, and it composes the domain library
[`@opencrane/backend/channel-proxy`](../../libs/backend/channel-proxy/main/README.md) — the
process here is just wiring (config, logging, HTTP server, shutdown) around that library's logic.

```
 outside channel  (Slack · Teams · browser SSE)   ← untrusted
        │  POST /v1/commands   ·   GET /v1/events
        ▼
 ┌────────────────────────────┐
 │   channel-proxy  ◄── HERE   │  origin allowlist · byte + time bounds · rate limit
 └────────────────────────────┘
        │  forward over in-cluster HTTP (…svc.cluster.local only)
        ▼
   opencrane server ........... resolves the owner's runtime, applies product authority
```

**In this flow:** [@opencrane/backend/channel-proxy](../../libs/backend/channel-proxy/main/README.md)
· [opencrane server](../opencrane/README.md)

The proxy fails closed at every bound: the exact HTTPS origins it accepts, the internal DNS suffix a
target must end in, a per-window request-rate cap, and hard caps on command body size, response size,
stream duration and idle time. Invalid configuration (a non-HTTPS origin, a target host that is not
in-cluster) aborts startup rather than running with a weakened boundary. It never invents trusted
identity headers, so a downstream cannot be tricked into believing the caller is already
authenticated. If it is wrong, the worst case is a refused or truncated request — never an
unbounded or spoofed one reaching the server.

## Public surface

`Entrypoint: src/index.ts` (`_Main`) — reads and validates config, opens the HTTP listener, and binds
bounded `SIGTERM`/`SIGINT` shutdown that drains in-flight requests and flushes telemetry.

HTTP endpoints served: `POST /v1/commands` (bounded command forwarding), `GET /v1/events`
(server-sent-event relay), and `/livez` · `/readyz` health probes. Any other path is `404`.

Commands are JSON envelopes that include an opaque `threadId` and use the standard `Idempotency-Key`
request header. The proxy validates those routing coordinates before asking OpenCrane to authorize a
target; it otherwise leaves the command payload uninterpreted.

The composed library also contains a pure, versioned AG-UI event encoder for a future
server-authorized replay reader. This app does not expose it yet: `GET /v1/events` remains an opaque
bounded relay, and the proxy still has no database, replay reader, approval-decision route, or
approval-resume authority.

## Boundary

Stateless and product-logic-free: it holds no database and no session, and consumers behind it (the
OpenCrane server) own all identity and authorization. It deliberately does **not** authenticate
callers, resolve tenants, or read product data — it only bounds and forwards. All routing and origin
logic lives in the composed library, not here.

## Dependency direction

Tagged `type:app`, `layer:entrypoint`, `scope:app`. As an entrypoint it may compose backend
libraries (here `@opencrane/backend/channel-proxy` and `@opencrane/observability`); no other package
may import it.

## Runtime & config

Read at startup by `src/config.ts`; each is validated and the process refuses to start if a value is
out of bounds.

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Listener port | `8080` |
| `OPENCRANE_INTERNAL_URL` | In-cluster OpenCrane server URL — HTTP, `*.svc.cluster.local`, no credentials | *(required)* |
| `CHANNEL_PROXY_ALLOWED_ORIGINS` | Comma-separated exact default-port HTTPS origins | *(required, ≥1)* |
| `CHANNEL_PROXY_TARGET_HOST_SUFFIXES` | Allowed internal DNS suffixes (each begins with `.`) | `.svc.cluster.local` |
| `CHANNEL_PROXY_RATE_LIMIT` / `CHANNEL_PROXY_RATE_WINDOW_MS` | Fixed-window request cap and window | `120` / `60000` |
| `CHANNEL_PROXY_MAX_COMMAND_BYTES` / `CHANNEL_PROXY_MAX_COMMAND_RESPONSE_BYTES` | Command body / response byte caps | `1048576` each |
| `CHANNEL_PROXY_COMMAND_TIMEOUT_MS` | Command forward timeout | `30000` |
| `CHANNEL_PROXY_STREAM_CONNECT_TIMEOUT_MS` / `_STREAM_DURATION_MS` / `_STREAM_IDLE_TIMEOUT_MS` | SSE relay connect / total / idle bounds | `5000` / `300000` / `45000` |
| `CHANNEL_PROXY_MAX_EVENT_BYTES` | Per-event byte cap on the SSE relay | `262144` |

Built into `dist/apps/channel-proxy` by esbuild and imaged from `deploy/Dockerfile`
(`ghcr.io/elewa-git/opencrane-channel-proxy`). Its Helm chart under `helm/` is a named-template
library composed by the silo umbrella chart
([`apps/_infra/deploy-k8s`](../_infra/deploy-k8s/README.md)).
The final image pins the upstream Node user's numeric UID and GID (`1000:1000`) so Kubernetes can
enforce the chart's `runAsNonRoot` policy before the container starts.
elewa-git
## See also

- Parent index: [apps](../README.md)
- Composed library: [@opencrane/backend/channel-proxy](../../libs/backend/channel-proxy/main/README.md)
- Sibling apps: [artifact-service](../artifact-service/README.md) · [opencrane server](../opencrane/README.md)
