import type { RequestHandler } from "express";

/**
 * Express guard that lets only the platform operator reach a route — the fleet-wide
 * superadmin, granted by `OPENCRANE_PLATFORM_OPERATOR_GROUPS` or by the per-cluster seed
 * email.
 *
 * This is the strongest gate in the server and the only correct one for anything touching
 * platform-wide credentials: an organisation owner or admin must never be able to rotate
 * the platform's Zitadel service-account key. Prefer {@link _RequireOrgAdmin} for
 * anything scoped to a single organisation.
 *
 * The decision comes only from `session.authUser.isPlatformOperator`, computed at login
 * from verified claims and the verified email; nothing in the request can influence it.
 *
 * Two cases, both fail-closed:
 *   1. No session — 403.
 *   2. Session present but not a platform operator — 403.
 *
 * The 403 body is identical in both cases, so a caller cannot tell "not logged in" from
 * "logged in but not an operator". Keep it that way.
 *
 * Called by: no caller in this repo yet — it is exported from the package barrel ready for
 * the credential-rotation route.
 *
 * TODO (S5): `isPlatformOperator` is a configuration-driven stopgap until OpenCrane has a
 * role model; this must tighten to a real super-admin role once that lands.
 *
 * @returns Middleware that calls `next()` for the platform operator and sends 403 to
 *          everyone else.
 */
export function _RequirePlatformOperator(): RequestHandler
{
  /** Express handler: allow the verified platform operator, else 403. */
  return function _platformOperatorHandler(req, res, next)
  {
    const authUser = req.session?.authUser;

    // 1. No session is never an authority grant.
    if (!authUser)
    {
      _deny(res);
      return;
    }

    // 2. Established session — allow only the platform operator (the fleet superadmin).
    if (authUser.isPlatformOperator === true)
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
  res.status(403).json({ error: "Platform operator role required.", code: "FORBIDDEN_NOT_PLATFORM_OPERATOR" });
}
