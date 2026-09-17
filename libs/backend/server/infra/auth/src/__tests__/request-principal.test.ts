import type { Request } from "express";
import { describe, expect, it } from "vitest";

import { _BindRequestPrincipalSilo, _ResolveRequestPrincipal } from "../request-principal";
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
  it("resolves the Principal and silo from trusted request facts", function _test()
  {
	const authenticatedAt = "2026-08-11T10:00:00.000Z";
    expect(_ResolveRequestPrincipal(_request({ sub: " user-1 ", email: "fallback@example.test", authenticatedAt }))).toEqual({
	  principalId: "principal-1",
	  externalIssuer: "https://issuer.example",
	  externalSubject: "user-1",
      siloId: "acme",
	  verifiedAuthenticationAt: new Date(authenticatedAt),
    });
  });

  it("uses only the durable Principal attached by authenticated admission", function _test()
  {
    expect(_ResolveRequestPrincipal(_request({ sub: "", email: " User@Example.Test " }))).toEqual({
	  principalId: "principal-1",
	  externalIssuer: "https://issuer.example",
	  externalSubject: "user-1",
      siloId: "acme",
	  verifiedAuthenticationAt: null,
    });
  });

  it("uses a matching silo bound by a non-host authentication boundary", function _test()
  {
	const incoming = _request({
		sub: "user-1",
		siloId: "acme",
	}, "careful-crane-123-4200.app.github.dev");
	_BindRequestPrincipalSilo(incoming, "acme");

	expect(_ResolveRequestPrincipal(incoming)?.siloId).toBe("acme");
	expect(incoming.get("host")).toBe("careful-crane-123-4200.app.github.dev");
  });

  it("refuses to bind a silo that does not match the session and admitted Principal", function _test()
  {
	const incoming = _request({
		sub: "user-1",
		siloId: "acme",
	}, "careful-crane-123-4200.app.github.dev");

	expect(function _BindMismatch(): void
	{
		_BindRequestPrincipalSilo(incoming, "other");
	}).toThrow("request silo binding requires matching session and admitted Principal silos");
  });

  it("fails closed without an authenticated user, stable identity, or silo", function _test()
  {
    expect(_ResolveRequestPrincipal(_request(undefined))).toBeNull();
	expect(_ResolveRequestPrincipal(_request({ sub: "", email: "" }, "acme.opencrane.test", ""))).toBeNull();
    expect(_ResolveRequestPrincipal(_request({ sub: "user-1" }, ""))).toBeNull();
  });
});
