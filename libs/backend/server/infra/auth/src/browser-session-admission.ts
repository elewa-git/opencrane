import type { NextFunction, Request, Response } from "express";

import type { AuthenticatedPrincipalAdmission, AuthenticatedPrincipalAdmissionInput, AuthenticatedRequestPrincipal } from "./authenticated-principal-admission.types";

/**
 * Admits a current server-owned session through the shared durable Principal boundary.
 *
 * Mode-specific middleware resolves the expected authority first. This helper then owns the common
 * expiry check, exact tuple comparison, persistence-outage mapping, Principal-result validation,
 * request attachment, and successful continuation.
 *
 * Called by: production OIDC, Tier 2, and Tier 3 development authentication middleware after public bypass.
 * @param request - Request carrying the server-owned browser session.
 * @param response - Response used for the common 401 and 503 envelopes.
 * @param next - Product-route continuation invoked only after exact Principal admission.
 * @param admission - Durable Principal resolver shared by production, Tier 2, and Tier 3 browser authentication.
 * @param authority - Startup and host-resolved authority, or null when the mode cannot admit it.
 * @param sessionRequiredError - Mode-specific anonymous-session error text.
 * @param onUnavailable - Optional structured logging hook invoked before the common 503 response.
 * @returns Resolves after the request continues or the helper sends its 401 or 503 response.
 */
export async function _AdmitBrowserSession(request: Request, response: Response, next: NextFunction, admission: AuthenticatedPrincipalAdmission, authority: AuthenticatedPrincipalAdmissionInput | null, sessionRequiredError: string, onUnavailable?: (error: unknown) => void): Promise<void>
{
	const user = request.session?.authUser;
	const expiresAt = new Date(user?.authorizationExpiresAt ?? "");
	if (authority === null || !user || user.siloId !== authority.siloId || user.issuer.trim() !== authority.issuer || user.sub.trim() !== authority.subject || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())
	{
		response.status(401).json({ error: sessionRequiredError });
		return;
	}
	let principal: AuthenticatedRequestPrincipal | null;
	try
	{
		principal = await admission.admit(authority);
	}
	catch (error)
	{
		onUnavailable?.(error);
		response.status(503).json({ error: "identity_projection_unavailable" });
		return;
	}
	if (principal === null || principal.siloId !== authority.siloId || principal.issuer !== authority.issuer || principal.subject !== authority.subject || !principal.principalId.trim())
	{
		response.status(401).json({ error: "authenticated_principal_required" });
		return;
	}
	request.authenticatedPrincipal = principal;
	next();
}
