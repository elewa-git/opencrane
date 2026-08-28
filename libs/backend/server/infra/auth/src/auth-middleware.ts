import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Logger } from "pino";

import type { AuthenticatedPrincipalAdmission, AuthenticatedPrincipalAdmissionInput } from "./authenticated-principal-admission.types";
import { _AdmitBrowserSession } from "./browser-session-admission";
import { ___LoadOidcAuthConfig } from "./oidc-config";
import type { OidcAuthConfig } from "./oidc-config.types";
import { _RequestHost } from "./request-host";
import { _ClusterTenantFromHost } from "./request-silo";

/**
 * Builds the middleware that decides whether a request may proceed at all.
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
 * @param admission - Durable Principal resolver shared by authenticated product requests.
 * @param log - Structured logger used when durable Principal admission is unavailable.
 * @returns Middleware that calls `next()` for public paths and session callers, and sends
 *          401 otherwise.
 */
export function ___AuthMiddleware(admission: AuthenticatedPrincipalAdmission, log: Logger): RequestHandler
{
  const oidcConfig = ___LoadOidcAuthConfig();

  return async function _authHandler(req, res, next)
  {
    await _resolveAuth(req, res, next, oidcConfig, admission, log);
  };
}

/**
 * Resolves authentication for a single request.
 *
 * @param req        - Incoming Express request.
 * @param res        - Express response used to send the shared 401 or 503 envelope.
 * @param next       - Express next function (called with no args on success).
 * @param oidcConfig - The OIDC config snapshot taken at factory time.
 * @param admission  - Resolves the session tuple to a durable local Principal.
 * @param log        - Records a structured warning when Principal admission is unavailable.
 */
async function _resolveAuth(
  req: Request,
  res: Response,
  next: NextFunction,
  oidcConfig: OidcAuthConfig,
  admission: AuthenticatedPrincipalAdmission,
  log: Logger,
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
	let input: AuthenticatedPrincipalAdmissionInput | null = null;
	if (oidcConfig.enabled && authUser && siloId && issuer === oidcConfig.issuerUrl && subject)
	{
		input = {
		siloId,
		issuer,
		subject,
	};
	}
	await _AdmitBrowserSession(req, res, next, admission, input, "OIDC session required", function _LogUnavailable(err)
	{
		log.warn({ err, siloId }, "OIDC Principal admission is unavailable");
	});
}
