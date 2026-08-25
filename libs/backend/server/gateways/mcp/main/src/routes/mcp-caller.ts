import type { Request, Response } from "express";

import type { AuthenticatedPrincipalDirectory } from "@opencrane/backend/server/iam/identity";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import type { McpOperatorCaller } from "../core/mcp-operator.logic.types";
import type { McpCallerResolver } from "./mcp-caller.types";

export type { McpCallerResolver } from "./mcp-caller.types";

/** Creates the request-bound resolver shared by MCP user-facing HTTP routers. */
export function _CreateMcpCallerResolver(principalDirectory: AuthenticatedPrincipalDirectory): McpCallerResolver
{
  return async function _ResolveMcpCaller(req: Request): Promise<McpOperatorCaller | null>
  {
    const requestPrincipal = _ResolveRequestPrincipal(req);
    const authUser = req.session?.authUser;
    if (!requestPrincipal || !authUser?.issuer || !authUser.sub)
      return null;
    return principalDirectory.resolveAuthenticatedPrincipal(requestPrincipal.siloId, authUser.issuer, authUser.sub);
  };
}

/** Sends 401 when a caller-owned MCP route has no authenticated local Principal. */
export function _RequireMcpCaller(res: Response, caller: McpOperatorCaller | null): caller is McpOperatorCaller
{
  if (caller)
    return true;
  res.status(401).json({ error: "Authentication required.", code: "UNAUTHORIZED" });
  return false;
}
