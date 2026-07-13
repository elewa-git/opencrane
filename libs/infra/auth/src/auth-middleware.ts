import { createHash } from "node:crypto";

import type { NextFunction, Request, RequestHandler, Response } from "express";

import { ___LoadOidcAuthConfig } from "./oidc-config.js";
import type { OidcAuthConfig } from "./oidc-config.types.js";

/**
 * Minimal `AccessToken` read surface for per-user DB token validation. A manager that
 * issues `oc auth login` tokens (the clustertenant-manager) passes its client; one that
 * does not (the fleet-manager has no `AccessToken` model) omits it, skipping step 5.
 */
export interface AccessTokenReader
{
  accessToken: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    update(args: unknown): Promise<unknown>;
  };
}

/**
 * Express authentication middleware shared by both managers.
 *
 * Authentication is resolved in priority order:
 *   1. Public path bypass  — /healthz and /api/v1/auth/* never require a token.
 *   2. OIDC session        — a valid session cookie from the browser login flow.
 *   3. Env-var token       — OPENCRANE_API_TOKEN, for CI automation without a DB.
 *   4. DB access token      — per-user token created via `oc auth login` (when a reader is given).
 *   5. Dev-mode bypass     — when neither OIDC nor OPENCRANE_API_TOKEN is configured.
 *
 * The env-var token and OIDC config are snapshotted when the factory is called —
 * once at startup in production; per-test in tests, so setting the env before
 * calling the factory is enough (no module re-import needed).
 *
 * @param reader - Optional access-token reader. When provided, bearer tokens are also
 *                 validated against the `access_tokens` table (step 4). Omit when the
 *                 manager issues no DB tokens.
 */
export function ___AuthMiddleware(reader?: AccessTokenReader): RequestHandler
{
  const envToken = process.env.OPENCRANE_API_TOKEN?.trim() ?? "";
  const oidcConfig = ___LoadOidcAuthConfig();

  return function _authHandler(req, res, next)
  {
    // Delegate to an async helper so we can await the DB lookup while still
    // presenting the synchronous `RequestHandler` signature Express expects.
    _resolveAuth(req, res, next, reader, envToken, oidcConfig).catch(next);
  };
}

/**
 * Resolve authentication for a single request.
 *
 * @param req        - Incoming Express request.
 * @param res        - Express response (used only to send 401/403).
 * @param next       - Express next function (called with no args on success).
 * @param reader     - Optional access-token reader for per-user DB token lookup.
 * @param envToken   - The OPENCRANE_API_TOKEN snapshot taken at factory time.
 * @param oidcConfig - The OIDC config snapshot taken at factory time.
 */
async function _resolveAuth(
  req: Request,
  res: Response,
  next: NextFunction,
  reader: AccessTokenReader | undefined,
  envToken: string,
  oidcConfig: OidcAuthConfig,
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
  if (oidcConfig.enabled && req.session?.authUser)
  {
    next();
    return;
  }

  // 3. Extract the bearer token from the Authorization header.
  const authHeader = req.headers.authorization;
  const providedToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  // 4. Accept the static env-var token (CI / service-account automation).
  if (envToken && providedToken === envToken)
  {
    next();
    return;
  }

  // 5. Validate the presented token against per-user DB records when a reader is available.
  if (reader && providedToken)
  {
    const tokenHash = createHash("sha256").update(providedToken).digest("hex");
    const dbToken = await reader.accessToken.findFirst({
      where: {
        tokenHash,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });

    if (dbToken)
    {
      // Fire-and-forget usage timestamp — failure is non-fatal.
      reader.accessToken.update({
        where: { id: dbToken.id },
        data: { lastUsedAt: new Date() },
      }).catch(() => undefined);

      next();
      return;
    }
  }

  // 6. Dev-mode bypass — allow unauthenticated access when OIDC is disabled
  //    and no env-var token is set.
  if (!envToken && !oidcConfig.enabled)
  {
    next();
    return;
  }

  // 7. All checks exhausted — reject the request.
  if (!authHeader)
  {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }

  res.status(403).json({ error: "Invalid token" });
}
