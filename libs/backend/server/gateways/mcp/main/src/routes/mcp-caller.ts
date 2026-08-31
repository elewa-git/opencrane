import type { Request, Response } from "express";

import type { AuthenticatedPrincipalDirectory } from "@opencrane/backend/server/iam/identity";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import type { McpTaskCaller } from "../mcp-tasks/mcp-task.types";
import type { McpCallerResolver } from "./mcp-caller.types";

/** Build the authenticated caller resolver shared by public MCP task routes. */
export function _CreateMcpCallerResolver(directory: AuthenticatedPrincipalDirectory): McpCallerResolver
{
	return async function _ResolveCaller(request: Request): Promise<McpTaskCaller | null>
	{
		const principal = _ResolveRequestPrincipal(request);
		const authUser = request.session?.authUser;
		if (principal === null || !authUser?.issuer || !authUser.sub)
			return null;
		return directory.resolveAuthenticatedPrincipal(principal.siloId, authUser.issuer, authUser.sub);
	};
}

/** Send the non-disclosing authentication response shared by public task operations. */
export function _RequireMcpCaller(response: Response, caller: McpTaskCaller | null): caller is McpTaskCaller
{
	if (caller !== null)
		return true;
	response.status(401).json({ error: "Authentication required", code: "UNAUTHORIZED" });
	return false;
}
