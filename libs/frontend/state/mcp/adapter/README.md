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
catalogue, install/uninstall, set/remove credential, connect/disconnect OAuth) and the admin
governance flow (list all servers, approve/publish/reject, enable/disable, read/update access policy,
list the directory).

```
 features/tools (UI)
        │ injects MCP_GATEWAY (the port)
        ▼
 OpenCraneMcpGateway  ◄── HERE
        │ HTTP: /api/v1/mcp/catalog · /mcp/installed · /mcp/servers · /mcp/.../access
        ▼
 OpenCrane Control Plane API  ──►  (no store; results returned to the feature)
```

**In this flow:** [core](../../core/README.md) · [gateways](../../gateways/README.md) · [features/tools](../../../features/tools/README.md)

Invariant: **credentials are write-only.** `setCredential` is the only path a secret enters, and no
read method ever returns credential material — the agent only receives a connection URL, never a
token. Uninstalling a server also clears its stored credential.

## Public surface

- `McpGateway`, `MCP_GATEWAY` — the MCP catalogue/credential/activation port + DI token.
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
- Siblings: [provider-key/adapter](../../provider-key/adapter/README.md) · [settings/adapter](../../settings/adapter/README.md) · [gateways](../../gateways/README.md)
