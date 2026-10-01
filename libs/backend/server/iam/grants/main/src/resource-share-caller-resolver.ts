import type { Request } from "express";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import type { AuthenticatedPrincipalDirectory } from "@opencrane/backend/server/iam/identity";
import type { ResourceShareCallerResolver } from "./resource-share.types";

/** Creates the HTTP adapter that resolves verified OIDC coordinates to a local Principal. */
export function _CreateResourceShareCallerResolver(directory: AuthenticatedPrincipalDirectory): ResourceShareCallerResolver
{
	return async function _ResolveResourceShareCaller(request: Request)
	{
		const requestPrincipal = _ResolveRequestPrincipal(request);
		const authUser = request.session?.authUser;
		if (requestPrincipal === null || !authUser?.issuer || !authUser.sub)
			return null;
		return directory.resolveAuthenticatedPrincipal(requestPrincipal.siloId, authUser.issuer, authUser.sub);
	};
}
