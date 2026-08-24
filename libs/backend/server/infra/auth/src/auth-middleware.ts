import type { NextFunction, Request, RequestHandler, Response } from "express";

import type { AuthenticatedPrincipalAdmission, AuthenticatedPrincipalAdmissionInput, AuthenticatedRequestPrincipal } from "./authenticated-principal-admission.types";
import { ___LoadOidcAuthConfig } from "./oidc-config";
import type { OidcAuthConfig } from "./oidc-config.types";
import { _RequestHost } from "./request-host";
import { _ClusterTenantFromHost } from "./request-silo";

/**
 * Build the middleware that decides whether a request may proceed at all.
 *
 * Checked in this order:
 *   1. Public paths — `/healthz` and everything under `/api/v1/auth` always pass, since
 *      the login routes themselves cannot require a login.
 *   2. An established OIDC session — a valid session cookie from the browser login flow.
 *   3. Anything else gets 401. In particular, a server with OIDC switched off rejects the
 *      whole API rather than serving it without authentication.
 *
 * Configuration is read once, when this factory is called — at startup in production, and
 * per test in tests, so a test only has to set the environment before calling the factory.
 *
 * This is authentication only. Roles are enforced separately by {@link _RequireOrgAdmin}
 * and {@link _RequirePlatformOperator}.
 *
 * Called by: apps/opencrane/src/app/public-app.ts.
 *
 * @returns Middleware that calls `next()` for public paths and session callers, and sends
 *          401 otherwise.
 */
export function ___AuthMiddleware(admission: AuthenticatedPrincipalAdmission): RequestHandler
{
  const oidcConfig = ___LoadOidcAuthConfig();

  return async function _authHandler(req, res, next)
  {
    await _resolveAuth(req, res, next, oidcConfig, admission);
  };
}

/**
 * Resolve authentication for a single request.
 *
 * @param req        - Incoming Express request.
 * @param res        - Express response (used only to send 401/403).
 * @param next       - Express next function (called with no args on success).
 * @param oidcConfig - The OIDC config snapshot taken at factory time.
 */
async function _resolveAuth(
  req: Request,
  res: Response,
  next: NextFunction,
  oidcConfig: OidcAuthConfig,
  admission: AuthenticatedPrincipalAdmission,
): Promise<void>
{
  // 1. Public paths bypass all auth checks — /healthz and the auth router
  //    itself are always reachable without credentials.
  if (req.path === "/healthz" || req.path.startsWith("/api/v1/auth"))
  {
    next();
    return;
  }

  // 2. Accept an established OIDC browser session (human operator flow).
  const authUser = req.session?.authUser;
  const siloId = _ClusterTenantFromHost(_RequestHost(req))?.trim() ?? "";
  const issuer = authUser?.issuer?.trim() ?? "";
  const subject = authUser?.sub?.trim() ?? "";
  const authorizationExpiresAt = new Date(authUser?.authorizationExpiresAt ?? "");
  const authorizationCurrent = Number.isFinite(authorizationExpiresAt.getTime()) && authorizationExpiresAt.getTime() > Date.now();
  if (oidcConfig.enabled && authUser && siloId && authUser.siloId === siloId && issuer === oidcConfig.issuerUrl && subject && authorizationCurrent)
  {
    const input: AuthenticatedPrincipalAdmissionInput = {
		siloId,
		issuer,
		subject,
	};
	let principal: AuthenticatedRequestPrincipal | null;
	try
	{
		principal = await admission.admit(input);
	}
	catch
	{
		res.status(503).json({ error: "identity_projection_unavailable" });
		return;
	}
	if (principal === null || principal.siloId !== siloId || principal.issuer !== issuer || principal.subject !== subject || !principal.principalId.trim())
	{
		res.status(401).json({ error: "authenticated_principal_required" });
		return;
	}
	req.authenticatedPrincipal = principal;
	next();
    return;
  }

  // 3. Missing or disabled identity configuration never opens a tokenless API.
  res.status(401).json({ error: "OIDC session required" });
}
