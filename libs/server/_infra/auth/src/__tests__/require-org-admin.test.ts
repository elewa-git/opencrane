import type { NextFunction, Request, Response } from "express";
import { describe, expect, it } from "vitest";

import { _RequireOrgAdmin } from "../index.js";

/** Build a mock (req, res, next) trio capturing the status/body and whether next ran. */
function _mock(session?: { isOrgAdmin: boolean }): { req: Request; res: Response; next: NextFunction; out: { status?: number; body?: unknown; nexted: boolean } }
{
  const out: { status?: number; body?: unknown; nexted: boolean } = { nexted: false };
  const req = { session: session ? { authUser: { isOrgAdmin: session.isOrgAdmin } } : undefined } as unknown as Request;
  const res = {
    status(code: number) { out.status = code; return this; },
    json(body: unknown) { out.body = body; return this; },
  } as unknown as Response;
  const next: NextFunction = () => { out.nexted = true; };
  return { req, res, next, out };
}

describe("_RequireOrgAdmin (P0.5)", function _suite()
{
  it("allows a verified org admin", function _allowAdmin()
  {
    const { req, res, next, out } = _mock({ isOrgAdmin: true });
    _RequireOrgAdmin()(req, res, next);
    expect(out.nexted).toBe(true);
    expect(out.status).toBeUndefined();
  });

  it("rejects a session that is not an org admin with 403", function _denyNonAdmin()
  {
    const { req, res, next, out } = _mock({ isOrgAdmin: false });
    _RequireOrgAdmin()(req, res, next);
    expect(out.nexted).toBe(false);
    expect(out.status).toBe(403);
    expect(out.body).toMatchObject({ code: "FORBIDDEN_NOT_ORG_ADMIN" });
  });

  it("fails closed for an unauthenticated request", function _failClosed()
  {
    const { req, res, next, out } = _mock();
    _RequireOrgAdmin()(req, res, next);
    expect(out.nexted).toBe(false);
    expect(out.status).toBe(403);
  });
});
