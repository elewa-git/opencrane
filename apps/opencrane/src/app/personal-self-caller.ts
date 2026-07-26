import type { Request } from "express";

import { _ClusterTenantFromHost, _RequestHost } from "@opencrane/server/_infra/auth";
// Side-effect import: loads the express-session SessionData.authUser augmentation.
import "@opencrane/server/_infra/auth";

/** Resolve the authenticated subject and tenant-host silo shared by self-only personal APIs. */
export function _ResolvePersonalSelfCaller(request: Request): { readonly siloId: string; readonly userId: string } | null
{
	const authUser = request.session?.authUser;
	if (!authUser) return null;
	const userId = (typeof authUser.sub === "string" ? authUser.sub.trim() : "") || (typeof authUser.email === "string" ? authUser.email.trim().toLowerCase() : "");
	const siloId = _ClusterTenantFromHost(_RequestHost(request)) ?? "";
	return userId && siloId ? { userId, siloId } : null;
}
