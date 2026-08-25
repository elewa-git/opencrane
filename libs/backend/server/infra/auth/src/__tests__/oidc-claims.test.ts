import * as client from "openid-client";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import { ___ResolveOidcClaims } from "../oidc-claims";

vi.mock("openid-client", async function _MockOpenIdClient(importOriginal)
{
	const original = await importOriginal<typeof import("openid-client")>();
	return { ...original, fetchUserInfo: vi.fn() };
});

describe("___ResolveOidcClaims", function _DescribeResolveOidcClaims()
{
	it("keeps the verified token subject and expiry when UserInfo returns conflicting values", async function _KeepsVerifiedSecurityClaims()
	{
		vi.mocked(client.fetchUserInfo).mockResolvedValue({ sub: "foreign-subject", exp: 9_999_999_999, name: "Updated profile" });
		const claims = { sub: "verified-subject", exp: 1_800_000_000, email: "before@example.test" };

		await expect(___ResolveOidcClaims({} as client.Configuration, "access-token", claims, pino({ enabled: false }))).resolves.toEqual({
			sub: "verified-subject",
			exp: 1_800_000_000,
			email: "before@example.test",
			name: "Updated profile",
		});
	});
});
