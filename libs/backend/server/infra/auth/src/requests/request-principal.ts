import type { Request } from "express";

import { _RequestHost } from "./request-host";
import type { RequestPrincipal } from "./request-principal.types";
import { _ClusterTenantFromHost } from "./request-silo";

/** Request-scoped silo established by an authentication boundary whose external host is not a silo host. */
const _BOUND_REQUEST_SILOS = new WeakMap<Request, string>();

/**
 * Bind a request to the silo already proven by its session and durable Principal admission.
 *
 * This is for application authentication boundaries whose verified external hostname does not
 * encode an OpenCrane silo. It cannot change either admitted identity fact, and a mismatch throws
 * before a product route runs. Ordinary product requests continue to derive their silo from the
 * trusted request host.
 */
export function _BindRequestPrincipalSilo(request: Request, siloId: string): void
{
	const normalizedSiloId = siloId.trim().toLowerCase();
	const authUser = request.session?.authUser;
	const admittedPrincipal = request.authenticatedPrincipal;

	if (
		!normalizedSiloId
		|| authUser?.siloId !== normalizedSiloId
		|| admittedPrincipal?.siloId !== normalizedSiloId
	)
	{
		throw new Error("request silo binding requires matching session and admitted Principal silos");
	}

	_BOUND_REQUEST_SILOS.set(request, normalizedSiloId);
}

/**
 * Read the logged-in caller out of an Express request: who they are and which silo they are on.
 *
 * Both facts must be present. The durable Principal comes from the authenticated admission
 * context, while the silo is independently re-derived from the trusted request host or supplied by
 * an authentication boundary that already matched a non-silo external host to the admitted session.
 * Either fact missing or mismatched returns null, so a route can never fall back to the raw OIDC subject.
 *
 * It deliberately returns a plain identity shape rather than any domain caller type: each
 * router converts it into whatever caller type it owns, so this file needs no dependency
 * on those domains.
 *
 * Called by: authenticated product routers, including personal configuration, persona onboarding,
 * elicitation, and self-run status, each through its own local caller mapping.
 *
 * @param request - The request, after session authentication has run.
 * @returns The caller, or null when there is no session or no silo can be derived from
 *          the host — treat null as 401/403, never as an anonymous caller.
 */
export function _ResolveRequestPrincipal(request: Request): RequestPrincipal | null
{
  const authUser = request.session?.authUser;
  const admittedPrincipal = request.authenticatedPrincipal;
	const siloId = _BOUND_REQUEST_SILOS.get(request) ?? _ClusterTenantFromHost(_RequestHost(request)) ?? "";
	if (!authUser || !admittedPrincipal || !siloId || admittedPrincipal.siloId !== siloId || !admittedPrincipal.principalId.trim())
		return null;
	const authenticatedAt = new Date(authUser.authenticatedAt);
	const verifiedAuthenticationAt = Number.isFinite(authenticatedAt.getTime()) ? authenticatedAt : null;

  return { principalId: admittedPrincipal.principalId, externalSubject: admittedPrincipal.subject, externalIssuer: admittedPrincipal.issuer, siloId, verifiedAuthenticationAt };
}
