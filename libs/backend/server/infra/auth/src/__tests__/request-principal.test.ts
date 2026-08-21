import type { Request } from "express";
import { describe, expect, it } from "vitest";

import { _ResolveRequestPrincipal } from "../request-principal";
import type { AuthUser } from "../session.types";

/** Builds the minimum request surface consumed by the principal resolver. */
function _request(authUser: Partial<AuthUser> | undefined, host = "acme.opencrane.test", principalId = "principal-1"): Request
{
  return {
    get(name: string): string | undefined
    {
      return name.toLowerCase() === "host" ? host : undefined;
    },
    headers: {},
    session: authUser ? { authUser } : {},
	authenticatedPrincipal: authUser ? { principalId, siloId: "acme", issuer: "https://issuer.example", subject: "user-1" } : undefined,
  } as unknown as Request;
}

describe("_ResolveRequestPrincipal", function _suite()
{
  it("resolves the Principal, silo, and administrator authority from trusted request facts", function _test()
  {
	const authenticatedAt = "2026-08-11T10:00:00.000Z";
    expect(_ResolveRequestPrincipal(_request({ sub: " user-1 ", email: "fallback@example.test", isOrgAdmin: true, authenticatedAt }))).toEqual({
	  principalId: "principal-1",
	  externalIssuer: "https://issuer.example",
	  externalSubject: "user-1",
      siloId: "acme",
      isOrgAdmin: true,
	  verifiedAuthenticationAt: new Date(authenticatedAt),
    });
  });

  it("uses only the durable Principal attached by authenticated admission", function _test()
  {
    expect(_ResolveRequestPrincipal(_request({ sub: "", email: " User@Example.Test ", isOrgAdmin: false }))).toEqual({
	  principalId: "principal-1",
	  externalIssuer: "https://issuer.example",
	  externalSubject: "user-1",
      siloId: "acme",
      isOrgAdmin: false,
	  verifiedAuthenticationAt: null,
    });
  });

  it("fails closed without an authenticated user, stable identity, or silo", function _test()
  {
    expect(_ResolveRequestPrincipal(_request(undefined))).toBeNull();
	expect(_ResolveRequestPrincipal(_request({ sub: "", email: "" }, "acme.opencrane.test", ""))).toBeNull();
    expect(_ResolveRequestPrincipal(_request({ sub: "user-1" }, ""))).toBeNull();
  });
});
