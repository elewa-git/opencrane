/**
 * `@opencrane/backend/server/infra/obot-custody` — everything OpenCrane needs to keep integration
 * credentials OUT of its own storage by holding them in Obot instead.
 *
 * Two ports live here. `ObotCustodyPort` creates and destroys the remote Obot MCP server that holds
 * a credential, returning only an opaque reference. `ObotMcpInvocationPort` calls a tool through one
 * of those references, and every implementation checks the agent revision's tool allow-list before
 * it opens a transport. Both are backed either by the HTTP adapters over a shared `ObotSession`, or
 * by fail-closed stubs that refuse every call when no Obot is configured — a deployment without Obot
 * fails visibly rather than faking custody or inventing a tool result.
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18 - the MCP revision the invocation
 *   adapter pins; it refuses any other revision rather than adapting to it.
 */
export { __UnavailableObotCustodyAdapter, ObotCustodyUnavailableError } from "./unavailable-obot-custody";
export type { ObotCustodyCredential, ObotCustodyPort, ProvisionObotCustodyCommand, ProvisionedObotCustody } from "./obot-custody.types";
export { __AssertToolAllowed, ObotMcpAuthenticationError, ObotMcpAuthorizationError, ObotMcpInvocationUnavailableError, ObotMcpToolNotAllowedError } from "./obot-mcp-invocation";
export type { ObotMcpInvocationPort, ObotMcpToolInvocationCommand, ObotMcpToolResult } from "./obot-mcp-invocation.types";
export { __UnavailableObotMcpInvocationAdapter } from "./unavailable-obot-mcp-invocation";
export { __CreateObotSession, ObotProtocolError, ObotTransportError } from "./obot-http";
export type { ObotFetch, ObotHttpOptions, ObotMcpExchangeResponse, ObotRequestMethod, ObotSession, ObotTransportFailureCode } from "./obot-http.types";
export { __CreateHttpObotCustodyAdapter } from "./http-obot-custody";
export { __CreateHttpObotMcpInvocationAdapter } from "./http-obot-mcp-invocation";
