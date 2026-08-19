import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

import type { OidcAuthService } from "./oidc.service";

/**
 * Builds the public session and OIDC router mounted before product authentication.
 *
 * Ordinary login omits the provider prompt. Account creation admits ZITADEL's `create` extension;
 * every other prompt is rejected before the browser is redirected to the provider. Handlers that
 * require an existing session, such as reauthentication, enforce it themselves.
 *
 * Called by: `_CreatePublicApp` when it mounts `/api/v1/auth` before `___AuthMiddleware`.
 * @param authService - OIDC discovery, browser-flow, and session service.
 * @param _prisma - Product database client accepted by the existing composition; no handler currently reads it.
 * @returns The Express router for session introspection, login, callback, reauthentication, and logout.
 * @see https://zitadel.com/docs/apis/openidoauth/endpoints for ZITADEL's `prompt=create` extension.
 */
export function ___AuthRouter(authService: OidcAuthService, _prisma: PrismaClient): Router
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

  // --------------------------------------------------------------------------
  // OIDC browser flow
  // --------------------------------------------------------------------------

  /** Starts ordinary login or provider registration after validating the requested prompt. */
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
      // Expose the registration mode OpenCrane renders without forwarding arbitrary provider prompts.
      if (req.query.prompt !== undefined && req.query.prompt !== "create")
      {
        res.status(400).json({ error: "Unsupported login prompt.", code: "UNSUPPORTED_LOGIN_PROMPT" });
        return;
      }
      const options: { prompt: string } | undefined = req.query.prompt === "create" ? { prompt: "create" } : undefined;

      // 1. Discover the provider and store the PKCE replay-protection values.
      const loginUrl = await authService.buildLoginUrl(req, returnTo, options);

      // 2. Redirect the browser to the external identity provider.
      res.redirect(302, loginUrl);
    }
    catch (err)
    {
      next(err);
    }
  });

  /** Force a fresh provider authentication before returning to one sensitive action. */
  router.get("/reauthenticate", async function _reauthenticate(req, res, next)
  {
    try
    {
      if (!authService.isEnabled())
      {
        res.status(503).json({ error: "OIDC is not configured for this opencrane-ui instance" });
        return;
      }
      if (!req.session.authUser)
      {
        res.status(401).json({ error: "authentication_required" });
        return;
      }
      const returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : "/";
      const loginUrl = await authService.buildLoginUrl(req, returnTo, { prompt: "login" });
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
