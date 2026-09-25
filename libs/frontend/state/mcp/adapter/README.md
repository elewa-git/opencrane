# @opencrane/state/mcp/adapter — live MCP gateway

> [frontend](../../../README.md) › [state](../../README.md) › mcp › adapter

## What it owns

Part of the OpenCrane **frontend state layer** (the code between the browser UI and the backend). MCP
is the **Model Context Protocol** — the standard for connecting external tools to an AI agent. This
package owns both halves of the frontend seam for it: the **`McpGateway`** port (a TypeScript interface
the Tools UI injects, so it never knows about HTTP) and the live **adapter** class that fulfils that
port by calling the backend.

The adapter, `OpenCraneMcpGateway`, issues typed `/api/v1/mcp/*` requests through the shared Control
Plane client and maps generated response types onto UI read models. It covers the user flow (list entitled
catalogue, install/uninstall, and personal connect/revoke) and the admin governance flow (list all servers,
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

Personal connection writes accept an explicit credentialless command or an ephemeral bearer token
through the generated API. The adapter never caches the command or returns credentials, provider
URLs, Secret coordinates, or raw provider errors. Connection responses pass the model-owned strict
projection parser before reaching a store. OAuth remains outside this port.

`McpConnectionCommandError` tells the command store whether to discard a rejected draft or retain
the exact key and material after an uncertain write. Network failures, server errors, and malformed
success responses cannot establish whether admission committed. Authentication or authorization
failure requires clearing private command state. A retry must reuse the caller's original command,
including the generation observed before it was sent. Connect sends that value in its body;
Disconnect sends the generation to revoke alongside its command key in the query.
Catalogue mapping requires the server's credential requirement and rejects missing or unknown
values. Installation status remains server-owned; neither the adapter nor the UI infers readiness
from single-user, multi-user, or OAuth presentation. Installed responses also preserve the safe
generation, custody time, and failure category supplied by the generated API contract.
The installation lifecycle is also required: a missing or unknown value rejects the projection.
Uninstall may be accepted with HTTP 202 while cleanup continues; the caller refreshes the installed
list to read its durable `Removing` state instead of assuming that the row has already disappeared.

## Public surface

- `McpGateway`, `MCP_GATEWAY` — the MCP catalogue and install port + DI token.
- `OpenCraneMcpGateway` — the live implementation over `/api/v1/mcp/*`, bound in `state/gateways`.
- `McpConnectionCommand` — the generated personal connection body with its exact retry key.
- `McpConnectionCommandFailureKinds`, `McpConnectionCommandError` — safe outcomes that tell the
  command store when to clear a draft or preserve an identical retry.
- `mcp-mapper.util` — pure generated-response → read-model mappers with fail-closed credential-requirement
  validation.

## Boundary

Bound to `MCP_GATEWAY` by [`state/gateways`](../../gateways/README.md) and consumed only through that
port by `features/tools`. Admin authorisation is enforced by the control plane, not here — the UI flags
only gate what is shown.

## Dependency direction

Tagged `scope:web` (`type:state`): it may depend only on other `scope:web` and `scope:shared`
packages — here `@opencrane/core`, `@opencrane/contracts`, and Angular — never on apps or server
domains.

## See also

- Parent index: [state](../../README.md)
- Siblings: [provider-key/adapter](../../provider-key/adapter/README.md) · [organisation members](../../organization/members/README.md) · [gateways](../../gateways/README.md)
