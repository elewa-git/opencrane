import type { Request } from "express";

import { _RequestHost } from "./request-host";
import type { RequestPrincipal } from "./request-principal.types";
import { _ClusterTenantFromHost } from "./request-silo";

/**
 * Read the logged-in caller out of an Express request: who they are, which silo they are
 * on, and whether the session says they are an org admin.
 *
 * Both facts must be present. The durable Principal comes from the authenticated admission
 * context, while the silo is independently re-derived from the trusted request host. Either one
 * missing or mismatched returns null, so a route can never fall back to the raw OIDC subject.
 *
 * It deliberately returns a plain identity shape rather than any domain caller type: each
 * router converts it into whatever caller type it owns, so this file needs no dependency
 * on those domains.
 *
 * Called by: prisma-personal-configuration.router.ts, prisma-persona-onboarding.router.ts,
 * prisma-steering-ingest.router.ts, and prisma-self-run-cancellation.router.ts (all under
 * libs/backend/agents), each in its own local `_resolveCaller`.
 *
 * @param request - The request, after session authentication has run.
 * @returns The caller, or null when there is no session or no silo can be derived from
 *          the host — treat null as 401/403, never as an anonymous caller.
 */
export function _ResolveRequestPrincipal(request: Request): RequestPrincipal | null
{
  const authUser = request.session?.authUser;
  const admittedPrincipal = request.authenticatedPrincipal;
  const siloId = _ClusterTenantFromHost(_RequestHost(request)) ?? "";
	if (!authUser || !admittedPrincipal || !siloId || admittedPrincipal.siloId !== siloId || !admittedPrincipal.principalId.trim()) return null;
	const authenticatedAt = new Date(authUser.authenticatedAt);
	const verifiedAuthenticationAt = Number.isFinite(authenticatedAt.getTime()) ? authenticatedAt : null;

  return { principalId: admittedPrincipal.principalId, externalSubject: admittedPrincipal.subject, externalIssuer: admittedPrincipal.issuer, siloId, isOrgAdmin: authUser.isOrgAdmin === true, verifiedAuthenticationAt };
}
