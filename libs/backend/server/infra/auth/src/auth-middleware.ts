import type { NextFunction, Request, RequestHandler, Response } from "express";

import { ___LoadOidcAuthConfig } from "./oidc-config";
import type { OidcAuthConfig } from "./oidc-config.types";

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
export function ___AuthMiddleware(): RequestHandler
{
  const oidcConfig = ___LoadOidcAuthConfig();

  return function _authHandler(req, res, next)
  {
    _resolveAuth(req, res, next, oidcConfig);
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
function _resolveAuth(
  req: Request,
  res: Response,
  next: NextFunction,
  oidcConfig: OidcAuthConfig,
): void
{
  // 1. Public paths bypass all auth checks — /healthz and the auth router
  //    itself are always reachable without credentials.
  if (req.path === "/healthz" || req.path.startsWith("/api/v1/auth"))
  {
    next();
    return;
  }

  // 2. Accept an established OIDC browser session (human operator flow).
  if (oidcConfig.enabled && req.session?.authUser)
  {
    next();
    return;
  }

  // 3. Missing or disabled identity configuration never opens a tokenless API.
  res.status(401).json({ error: "OIDC session required" });
}
