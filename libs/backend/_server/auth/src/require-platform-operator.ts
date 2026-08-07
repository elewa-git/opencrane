import type { RequestHandler } from "express";

/**
 * Authorization guard restricting a route to the PLATFORM OPERATOR — the fleet-wide
 * superadmin (env-seeded via `OPENCRANE_PLATFORM_OPERATOR_GROUPS` / seed email). This is
 * the strongest gate and the only acceptable one for the master IdP-credential rotation
 * route: a per-org owner/admin must NEVER be able to rotate the platform's Zitadel
 * service-account key.
 *
 * IAM-first: the decision is derived purely from the caller's IdP-verified session
 * (`session.authUser.isPlatformOperator`), never from request input.
 *
 * Posture:
 *   1. No established session — fail closed (403).
 *   2. Session present — allow iff `isPlatformOperator`; else 403.
 *
 * TODO (S5): `isPlatformOperator` is the config-driven stopgap until OpenCrane has a role
 * model. This MUST tighten to a first-class super-admin role once that model lands.
 *
 * @returns Express middleware that continues for platform operators and rejects others (403).
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

/** Emit the canonical 403 envelope; never leak which specific check failed. */
function _deny(res: Parameters<RequestHandler>[1]): void
{
  res.status(403).json({ error: "Platform operator role required.", code: "FORBIDDEN_NOT_PLATFORM_OPERATOR" });
}
