import type { RequestHandler } from "express";

/**
 * Express guard that lets only organisation admins reach a route — the role allowed to
 * curate the MCP catalogue and approve servers.
 *
 * The decision comes only from `session.authUser.isOrgAdmin`, which was set at login from
 * the caller's verified group claims (`OPENCRANE_ORG_ADMIN_GROUPS`); nothing in the
 * request body, query, or headers can influence it. Platform operators pass too, because
 * the login rules already mark them as org admins.
 *
 * Two cases, both fail-closed:
 *   1. No session — 403.
 *   2. Session present but `isOrgAdmin` is false — 403.
 *
 * The 403 body is byte-for-byte the same in both cases, and identical for every route
 * using this guard. That is a security property, not tidiness: a caller must not be able
 * to tell "you are not logged in" from "you are logged in but not an admin", or probe
 * which check failed. Do not add a reason field, a route name, or a differing message.
 *
 * NOTE: this reads the value stored at login. A user who became an org admin by creating
 * an organisation after logging in is reported as an admin by `/auth/me` but still
 * rejected here until their session is refreshed.
 *
 * Called by: the organization-admin routes in MCP operator, MCP OCI promotion, provider BYOK, and
 * group management.
 *
 * @returns Middleware that calls `next()` for org admins and sends 403 to everyone else.
 */
export function _RequireOrgAdmin(): RequestHandler
{
  /** Express handler: allow verified org admins, else 403. */
  return function _orgAdminHandler(req, res, next)
  {
    const authUser = req.session?.authUser;

    // 1. No session is never an authority grant.
    if (!authUser)
    {
      _deny(res);
      return;
    }

    // 2. Established session — allow only callers the IdP marked as org admins.
    if (authUser.isOrgAdmin)
    {
      next();
      return;
    }

    _deny(res);
  };
}

/** Send the one fixed 403 body used for every rejection here, so a caller cannot tell which check failed. */
function _deny(res: Parameters<RequestHandler>[1]): void
{
  res.status(403).json({ error: "Organisation admin role required.", code: "FORBIDDEN_NOT_ORG_ADMIN" });
}
