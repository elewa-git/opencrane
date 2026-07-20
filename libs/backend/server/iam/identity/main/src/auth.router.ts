import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

import { _ConnectionsAuthRouter } from "@opencrane/backend/server/connections";

import type { OidcAuthService } from "./oidc.service.js";

/**
 * Build the auth router covering:
 *  - Session introspection (GET /me)
 *  - OpenClaw connection broker (POST /pod-token)
 *  - OIDC browser flow (GET /login, GET /callback, POST /logout)
 *
 * All routes in this router are mounted before `___AuthMiddleware` and are
 * therefore public — authentication is enforced per-handler where required.
 *
 * @param authService  - OIDC auth service instance.
 * @param prisma       - Prisma client injected into the connection sub-router.
 */
export function ___AuthRouter(authService: OidcAuthService, prisma: PrismaClient): Router
{
  const router = Router();

  // --------------------------------------------------------------------------
  // Session introspection
  // --------------------------------------------------------------------------

  /** Report the current auth mode and authenticated user session, if any. */
  router.get("/me", async function _me(req, res, next)
  {
    try
    {
      res.json(await authService.getStatus(req));
    }
    catch (err)
    {
      next(err);
    }
  });

  // Connection routes own their session checks because this router is mounted before auth middleware.
  router.use(_ConnectionsAuthRouter(prisma));

  // --------------------------------------------------------------------------
  // OIDC browser flow
  // --------------------------------------------------------------------------

  /** Start the browser-based OIDC login flow. */
  router.get("/login", async function _login(req, res, next)
  {
    try
    {
      if (!authService.isEnabled())
      {
        res.status(503).json({ error: "OIDC is not configured for this opencrane-ui instance" });
        return;
      }

      const returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : "/";

      // 1. Discover the provider and store the PKCE replay-protection values.
      const loginUrl = await authService.buildLoginUrl(req, returnTo);

      // 2. Redirect the browser to the external identity provider.
      res.redirect(302, loginUrl);
    }
    catch (err)
    {
      next(err);
    }
  });

  /** Complete the OIDC callback and redirect back into the SPA. */
  router.get("/callback", async function _callback(req, res, next)
  {
    try
    {
      if (!authService.isEnabled())
      {
        res.status(503).json({ error: "OIDC is not configured for this opencrane-ui instance" });
        return;
      }

      // 1. Validate the authorization response and establish the local session.
      const returnTo = await authService.completeLogin(req);

      // 2. Redirect the user back into the opencrane-ui UI.
      res.redirect(302, returnTo);
    }
    catch (err)
    {
      next(err);
    }
  });

  /**
   * Destroy the local session and, when the IdP supports it, return its
   * RP-Initiated Logout URL so the browser can finish the upstream sign-out
   * (`single sign-out`). The local session is always destroyed; `endSessionUrl`
   * is null when OIDC is off, the IdP has no `end_session_endpoint`, or the
   * session captured no id_token. Non-browser API callers may ignore the URL.
   */
  router.post("/logout", async function _logout(req, res, next)
  {
    try
    {
      const endSessionUrl = await authService.logout(req);
      res.status(200).json({ endSessionUrl });
    }
    catch (err)
    {
      next(err);
    }
  });

  return router;
}
