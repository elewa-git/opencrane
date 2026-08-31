# @opencrane/state/mcp/adapter — live MCP gateway

> [frontend](../../../README.md) › [state](../../README.md) › mcp › adapter

## What it owns

Part of the OpenCrane **frontend state layer** (the code between the browser UI and the backend). MCP
is the **Model Context Protocol** — the standard for connecting external tools to an AI agent. This
package owns both halves of the frontend seam for it: the **`McpGateway`** port (a TypeScript interface
the Tools UI injects, so it never knows about HTTP) and the live **adapter** class that fulfils that
port by calling the backend.

The adapter, `OpenCraneMcpGateway`, issues requests to `/api/v1/mcp/*` through the shared Control Plane
API client and maps the responses onto UI read models. It covers the user flow (list entitled
catalogue and install/uninstall) and the admin governance flow (list all servers,
approve/publish/reject, and enable/disable). Generic central grant administration owns sharing; the
MCP adapter has no separate access-policy or subject-directory methods.

```
 features/tools (UI)
        │ injects MCP_GATEWAY (the port)
        ▼
 OpenCraneMcpGateway  ◄── HERE
        │ HTTP: /api/v1/mcp/catalog · /mcp/installed · /mcp/servers
        ▼
 OpenCrane Control Plane API  ──►  (no store; results returned to the feature)
```

**In this flow:** [core](../../core/README.md) · [gateways](../../gateways/README.md) · [features/tools](../../../features/tools/README.md)

Invariant: credential and OAuth activation are absent until a verified custody boundary is composed.
No method accepts or returns credential material, provider URLs, or tokens.

## Public surface

- `McpGateway`, `MCP_GATEWAY` — the MCP catalogue and install port + DI token.
- `OpenCraneMcpGateway` — the live implementation over `/api/v1/mcp/*`, bound in `state/gateways`.
- `mcp-mapper.util` — pure wire-shape → read-model mappers.

## Boundary

Bound to `MCP_GATEWAY` by [`state/gateways`](../../gateways/README.md) and consumed only through that
port by `features/tools`. Admin authorisation is enforced by the control plane, not here — the UI flags
only gate what is shown.

## Dependency direction

Tagged `scope:web` (`type:state`): it may depend only on other `scope:web` and `scope:shared`
packages — here `@opencrane/core` and Angular — never on apps or server domains.

## See also

- Parent index: [state](../../README.md)
- Siblings: [provider-key/adapter](../../provider-key/adapter/README.md) · [organisation members](../../organization/members/README.md) · [gateways](../../gateways/README.md)
