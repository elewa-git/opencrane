import type { RequestHandler } from "express";

/**
 * Reusable authorization guard restricting a route to organisation admins — the role
 * allowed to curate the MCP catalogue and approve servers (P0.5).
 *
 * IAM-first: the decision is derived purely from the caller's IdP-verified identity
 * (`session.authUser.isOrgAdmin`, set from `OPENCRANE_ORG_ADMIN_GROUPS`), never from
 * request input.
 *
 * Posture:
 *   1. No established session — fail closed (403).
 *   2. Session present — allow iff `isOrgAdmin` (platform operators are org admins by
 *      derivation, being the broader role).
 *
 * @returns An Express middleware that continues for org admins and rejects others with 403.
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

/** Emit the canonical 403 envelope; never leak which specific check failed. */
function _deny(res: Parameters<RequestHandler>[1]): void
{
  res.status(403).json({ error: "Organisation admin role required.", code: "FORBIDDEN_NOT_ORG_ADMIN" });
}
