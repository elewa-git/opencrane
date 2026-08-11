import type { Request } from "express";

import { _RequestHost } from "./request-host.js";
import type { RequestPrincipal } from "./request-principal.types.js";
import { _ClusterTenantFromHost } from "./request-silo.js";

/**
 * Resolves the authenticated human principal from the server session and trusted request host.
 *
 * The resolver is intentionally backend-type-free: capability routers translate this common
 * identity shape into their own caller contracts. Missing identity or silo facts fail closed.
 *
 * @param request - Incoming Express request after session authentication.
 * @returns The authenticated request principal, or null when required facts are absent.
 */
export function _ResolveRequestPrincipal(request: Request): RequestPrincipal | null
{
  const authUser = request.session?.authUser;
  if (!authUser) return null;

  const subject = typeof authUser.sub === "string" ? authUser.sub.trim() : "";
  const email = typeof authUser.email === "string" ? authUser.email.trim().toLowerCase() : "";
  const subjectId = subject || email;
  const siloId = _ClusterTenantFromHost(_RequestHost(request)) ?? "";
  if (!subjectId || !siloId) return null;
	const authenticatedAt = new Date(authUser.authenticatedAt);
	const verifiedAuthenticationAt = Number.isFinite(authenticatedAt.getTime()) ? authenticatedAt : null;

  return { subjectId, siloId, isOrgAdmin: authUser.isOrgAdmin === true, verifiedAuthenticationAt };
}
