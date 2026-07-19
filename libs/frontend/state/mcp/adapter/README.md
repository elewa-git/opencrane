# @opencrane/state/mcp/adapter — MCP catalogue gateway adapter

Owns the `McpGateway` port and its live implementation, `OpenCraneMcpGateway`, over the
Control Plane's `/api/v1/mcp/...` surface (catalogue, installed servers, access policy)
through the shared `ControlPlaneApiService` (same cookie session and 401→login handling), with
wire→read-model mapping in `mcp-mapper.util`.

Security invariant: `setCredential` is the only secret-bearing call and is write-only — values
are POSTed and never read back; no read method returns credential material, and the agent only
ever receives a connection URL. The MCP paths are not yet in the pinned OpenAPI contract, so
calls use `ControlPlaneApiService.request` with locally projected wire types until the
endpoints land in the generated client.

Consumed by `@opencrane/features/tools`; bound to `MCP_GATEWAY` in live mode by
`@opencrane/state/gateways`. Tagged `scope:web`/`type:state`: may depend only on `scope:web`
and `scope:shared` libs — never on backend packages or apps.
