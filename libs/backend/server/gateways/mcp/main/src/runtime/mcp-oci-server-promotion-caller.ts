import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import type { McpOciServerPromotionRouterDependencies } from "./mcp-runtime.types";

/** Resolve image promotion authority only from the verified browser Principal and its silo. */
export const _ResolveMcpOciServerPromotionCaller: McpOciServerPromotionRouterDependencies["resolveCaller"] = async function _ResolveCaller(request)
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null ? null : { siloId: principal.siloId, principalId: principal.principalId };
};
