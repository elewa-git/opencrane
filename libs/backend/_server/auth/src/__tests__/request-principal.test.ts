import type { Request } from "express";
import { describe, expect, it } from "vitest";

import { _ResolveRequestPrincipal } from "../request-principal.js";
import type { AuthUser } from "../session.types.js";

/** Builds the minimum request surface consumed by the principal resolver. */
function _request(authUser: Partial<AuthUser> | undefined, host = "acme.opencrane.test"): Request
{
  return {
    get(name: string): string | undefined
    {
      return name.toLowerCase() === "host" ? host : undefined;
    },
    headers: {},
    session: authUser ? { authUser } : {},
  } as unknown as Request;
}

describe("_ResolveRequestPrincipal", function _suite()
{
  it("resolves subject, silo, and administrator authority from trusted request facts", function _test()
  {
    expect(_ResolveRequestPrincipal(_request({ sub: " user-1 ", email: "fallback@example.test", isOrgAdmin: true }))).toEqual({
      subjectId: "user-1",
      siloId: "acme",
      isOrgAdmin: true,
    });
  });

  it("uses a normalised email when the session has no subject", function _test()
  {
    expect(_ResolveRequestPrincipal(_request({ sub: "", email: " User@Example.Test ", isOrgAdmin: false }))).toEqual({
      subjectId: "user@example.test",
      siloId: "acme",
      isOrgAdmin: false,
    });
  });

  it("fails closed without an authenticated user, stable identity, or silo", function _test()
  {
    expect(_ResolveRequestPrincipal(_request(undefined))).toBeNull();
    expect(_ResolveRequestPrincipal(_request({ sub: "", email: "" }))).toBeNull();
    expect(_ResolveRequestPrincipal(_request({ sub: "user-1" }, ""))).toBeNull();
  });
});
