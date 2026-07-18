import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

import { _RequestHost } from "@opencrane/infra/auth";

import type { OidcAuthService } from "./oidc.service.js";
import { _ClusterTenantFromHost } from "./request-silo.js";
import { _IsMemberSuspended, _ResolveGatewayTarget } from "@opencrane/backend/connections";

/** Gateway WebSocket path on the same org host that serves the browser application. */
const _OPENCLAW_GATEWAY_WS_PATH = "/gateway";

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
 * @param prisma       - Prisma client used to persist device-issued access tokens.
 */
export function ___AuthRouter(authService: OidcAuthService, prisma: PrismaClient): Router
{
  const router = Router();
  const namespace = process.env.NAMESPACE ?? "default";

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


  /**
   * Routing-authority endpoint for the identity-routing gateway proxy (DOMAIN.T4).
   *
   * Every user in an org shares ONE host (`<org>.<base>`); this endpoint tells the
   * identity-routing proxy (now folded into the operator) **where** a session's gateway
   * socket should go: it returns the verified identity plus the authoritative
   * `{ tenant, podService }` the proxy forwards to (the proxy then injects that identity
   * into the trusted-proxy user header on the upstream). The proxy holds NO session
   * logic — the control plane stays the sole auth authority (delegate-auth), so the
   * express session store is never shared across services.
   *
   * **Cross-tenant safety (routing half):** the target is resolved solely from the
   * session's IdP-verified email via the fail-closed email→tenant rule — no
   * request-supplied tenant input — and a missing/ambiguous mapping fails closed with
   * **403**. Combined with per-pod owner pinning (CONN.10, the pod-level half) this is
   * defence in depth: neither the routing layer nor the pod will serve a foreign user.
   *
   * Public (mounted before `___AuthMiddleware`); enforces the session inline.
   */
  router.get("/gateway-resolve", async function _gatewayResolve(req, res, next)
  {
    try
    {
      const authUser = req.session?.authUser;
      if (!authUser)
      {
        res.status(401).json({ error: "Authentication required", code: "UNAUTHORIZED" });
        return;
      }

      const email = typeof authUser.email === "string" ? authUser.email : "";
      const sub = typeof authUser.sub === "string" ? authUser.sub : "";
      // Scope to the silo the WebSocket is connecting through so a multi-silo owner routes
      // to the pod for this host (mirrors /pod-token); foreign silo fails closed.
      const silo = _ClusterTenantFromHost(_RequestHost(req));
      const outcome = await _ResolveGatewayTarget(prisma, namespace, email, sub, silo);

      if (!outcome.ok)
      {
        // Every fail-closed reason is a 403: the proxy treats it as "refuse the upgrade".
        const message = outcome.code === "AMBIGUOUS_TENANT"
          ? "Multiple OpenClaw pods match this account; contact your administrator"
          : outcome.code === "NO_TENANT"
            ? "No OpenClaw is provisioned for this account"
            : outcome.code === "MEMBER_SUSPENDED"
              ? "Your membership in this organisation is suspended"
              : "Session has no email claim; cannot resolve a tenant";
        res.status(403).json({ error: message, code: outcome.code });
        return;
      }

      res.status(200).json(outcome.resolved);
    }
    catch (err)
    {
      next(err);
    }
  });

  // --------------------------------------------------------------------------
  // OpenClaw connection broker (single sign-on across control plane + pod)
  // --------------------------------------------------------------------------

  /**
   * Hand the caller the connection coordinates for **their own** OpenClaw pod's
   * Gateway, derived from their OIDC session — so they log in once and the pod
   * connection follows, never a second login (see `docs/auth.md`).
   *
   * Under trusted-proxy gateway auth (CONN.4) the browser holds **no credential**:
   * it opens the returned `wss://` gateway URL (the org host), and the identity-routing
   * proxy authorises that socket against the live session via `/auth/gateway-resolve`
   * (injecting the verified user on the upstream). So this route returns only the gateway
   * URL — no token. The earlier designs (a minted Kubernetes token, then a bootstrap
   * pairing token) are both retired.
   *
   * **Cross-tenant safety:** the target tenant is resolved solely from the
   * session's IdP-verified email — there is no request-supplied tenant input —
   * and an email matching more than one tenant fails closed. A caller therefore
   * cannot obtain another user's pod connection.
   *
   * **This route is mounted before `___AuthMiddleware`** (the whole auth router
   * is public), so it enforces the session check inline.
   */
  router.post("/pod-token", async function _podToken(req, res, next)
  {
    try
    {
      // 1. Require an established OIDC browser session.
      const authUser = req.session?.authUser;
      if (!authUser)
      {
        res.status(401).json({ error: "Authentication required", code: "UNAUTHORIZED" });
        return;
      }

      // 2. Resolve the caller's tenant by their verified email (one pod per user PER silo).
      //    Scope the lookup to the silo the caller is on — each org is served at
      //    `<clusterTenant>.<base>`, so a user who owns a workspace in more than one silo
      //    resolves to the pod for the host they are connecting through. Without a derivable
      //    silo the lookup stays global (and still fail-closes on ambiguity below).
      const email = typeof authUser.email === "string" ? authUser.email.toLowerCase() : "";
      if (!email)
      {
        res.status(403).json({ error: "Session has no email claim; cannot resolve a tenant", code: "FORBIDDEN" });
        return;
      }

      const silo = _ClusterTenantFromHost(_RequestHost(req));
      const matches = await prisma.tenant.findMany({
        where: { email: { equals: email, mode: "insensitive" }, ...(silo ? { clusterTenantRef: silo } : {}) },
        select: { name: true, ingressHost: true, clusterTenantRef: true },
      });

      if (matches.length === 0)
      {
        res.status(403).json({ error: "No OpenClaw is provisioned for this account", code: "NO_TENANT" });
        return;
      }

      // Fail closed: an ambiguous email→tenant mapping must never silently pick
      // one pod, which could hand the caller another tenant's connection.
      if (matches.length > 1)
      {
        res.status(409).json({ error: "Multiple OpenClaw pods match this account; contact your administrator", code: "AMBIGUOUS_TENANT" });
        return;
      }

      const tenant = matches[0];
      const subject = authUser.sub.length > 0 ? authUser.sub : email;

      // Fail closed on a suspended membership (#126): billing disabled this member's license, so
      // the connect path is refused even though a pod exists (mirrors `/gateway-resolve`). A tenant
      // with no org ref (legacy/standalone) has no membership row and is allowed through.
      if (await _IsMemberSuspended(prisma, tenant.clusterTenantRef, subject))
      {
        res.status(403).json({ error: "Your membership in this organisation is suspended", code: "MEMBER_SUSPENDED" });
        return;
      }

      // 3. Derive the gateway coordinate from the operator-owned ingress host.
      if (!tenant.ingressHost)
      {
        res.status(409).json({ error: "OpenClaw runtime ingress is not ready", code: "POD_NOT_READY" });
        return;
      }

      // 4. Return the connection coordinates for the gateway `connect` handshake;
      //    trusted-proxy auth happens at the ingress, so no token is handed back.
      res.status(200).json({
        gatewayUrl: `wss://${tenant.ingressHost}${_OPENCLAW_GATEWAY_WS_PATH}`,
        tenant: tenant.name,
        ingressHost: tenant.ingressHost,
      });
    }
    catch (err)
    {
      next(err);
    }
  });

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
