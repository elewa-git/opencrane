/**
 * Who is calling one of the user-facing MCP endpoints, and what they are allowed to see.
 *
 * Built by `_ResolveCaller` in ../routes/mcp-operator.ts, then read by `listEntitledCatalog` and
 * `_IsEntitled` in ./mcp-operator.logic.ts to decide which catalogue servers come back.
 *
 * `_ResolveCaller` sets `devOpen: false` on BOTH of its branches today — for an established
 * session and for an unauthenticated request alike — so entitlement filtering always runs and an
 * unauthenticated caller sees nothing. The field is still read: `_IsEntitled` returns true for
 * every published server when it is set, so anything that ever starts producing `devOpen: true`
 * opens the entire published catalogue to that caller.
 */
export interface McpOperatorCaller
{
  /** Stable caller id: the session's `sub`, else its `email`, else the literal `"unknown"`. */
  userId: string;
  /** IdP-verified group claims used for group-based entitlement. */
  groups: string[];
  /** When true, entitlement filtering is skipped and every published server is visible. Nothing in this repo sets it to true today. */
  devOpen: boolean;
}
