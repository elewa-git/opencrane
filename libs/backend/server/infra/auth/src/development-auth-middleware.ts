import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Logger } from "pino";

import type { AuthenticatedPrincipalAdmission, AuthenticatedPrincipalAdmissionInput } from "./authenticated-principal-admission.types";
import { _AdmitBrowserSession } from "./browser-session-admission";
import { _RequestHost } from "./request-host";

/**
 * Authenticates a signed development session against its startup identity and durable Principal.
 *
 * Called by: the Tier 3 OpenCrane composition after the proxy-proof login creates a signed session.
 * @param admission - Durable Principal resolver used by production OIDC authentication too.
 * @param authority - Startup-selected issuer, silo, and subject that requests cannot replace.
 * @param expectedHost - Installation-selected host that binds the session to its silo ingress.
 * @param log - Records a structured warning when Principal admission is unavailable.
 * @returns Middleware that fails closed on expired, mismatched, missing, or unavailable identity state.
 */
export function ___DevelopmentAuthMiddleware(admission: AuthenticatedPrincipalAdmission, authority: AuthenticatedPrincipalAdmissionInput, expectedHost: string, log: Logger): RequestHandler
{
	return async function _Authenticate(request, response, next): Promise<void>
	{
		await _ResolveDevelopmentAuthentication(request, response, next, admission, authority, expectedHost, log);
	};
}

/** Resolves the installed development identity only for its trusted ingress host. */
async function _ResolveDevelopmentAuthentication(request: Request, response: Response, next: NextFunction, admission: AuthenticatedPrincipalAdmission, authority: AuthenticatedPrincipalAdmissionInput, expectedHost: string, log: Logger): Promise<void>
{
	if (request.path === "/healthz" || request.path.startsWith("/api/v1/auth"))
	{
		next();
		return;
	}

	const requestHost = _RequestHost(request)?.trim().toLowerCase();
	const admissionInput = requestHost === expectedHost.toLowerCase() ? authority : null;
	await _AdmitBrowserSession(request, response, next, admission, admissionInput, "development session required", function _LogUnavailable(err)
	{
		log.warn({ err, siloId: authority.siloId }, "Tier 3 Principal admission is unavailable");
	});
}
