import type { NextFunction, Request, RequestHandler, Response } from "express";

import { ___LoadOidcAuthConfig } from "./oidc-config.js";
import type { OidcAuthConfig } from "./oidc-config.types.js";

/**
 * OpenCrane server authentication middleware.
 *
 * Authentication is resolved in priority order:
 *   1. Public path bypass  — /healthz and /api/v1/auth/* never require a token.
 *   2. OIDC session        — a valid session cookie from the browser login flow.
 *   3. Dev-mode bypass     — when OIDC is not configured.
 *
 * The OIDC config is snapshotted when the factory is called —
 * once at startup in production; per-test in tests, so setting the env before
 * calling the factory is enough (no module re-import needed).
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

  // 3. Development mode is intentionally the only tokenless public posture.
  if (!oidcConfig.enabled)
  {
    next();
    return;
  }

  // 4. A real deployment requires a verified OIDC browser session.
  res.status(401).json({ error: "OIDC session required", code: "authentication_required" });
}
