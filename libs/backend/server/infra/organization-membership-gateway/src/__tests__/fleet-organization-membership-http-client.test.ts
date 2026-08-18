import { describe, expect, it, vi } from "vitest";

import { FleetOrganizationMembershipHttpClient } from "../fleet-organization-membership-http-client";
import type { FleetOrganizationMembershipFetch } from "../fleet-organization-membership-http-client.types";

/** Verified server-derived caller fixture. */
const _IDENTITY = { siloId: "acme", subjectId: "admin-1", verifiedEmail: "admin@acme.test", displayName: "Admin" };

/** Build one client with injectable transport evidence. */
function _Client(fetch: FleetOrganizationMembershipFetch, overrides: Partial<ConstructorParameters<typeof FleetOrganizationMembershipHttpClient>[0]> = {})
{
	return new FleetOrganizationMembershipHttpClient({
		baseUrl: "https://fleet.example",
		credentialSiloId: "acme",
		projectedTokenPath: "/var/run/opencrane/membership-billing/token",
		timeoutMilliseconds: 1_000,
		readProjectedToken: async function _ReadToken() { return "projected-token"; },
		fetch,
		...overrides,
	});
}

describe("FleetOrganizationMembershipHttpClient", function _Suite()
{
	it("attaches a fresh projected token and refuses redirects", async function _ProjectedIdentity()
	{
		const tokenReader = vi.fn().mockResolvedValueOnce("token-one").mockResolvedValueOnce("token-two");
		const fetchMock = vi.fn().mockImplementation(async function _Response() { return new Response(JSON.stringify({ members: [] }), { status: 200 }); });
		const client = _Client(fetchMock, { readProjectedToken: tokenReader });
		await client.request({ path: "/v1/organization/members", method: "GET", identity: _IDENTITY });
		await client.request({ path: "/v1/organization/members", method: "GET", identity: _IDENTITY });
		expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer token-one");
		expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("authorization")).toBe("Bearer token-two");
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
	});

	it("rejects plaintext, credentialed, and path-bearing receiver origins", function _HttpsOrigin()
	{
		const fetchMock = vi.fn();
		expect(function _Plaintext() { _Client(fetchMock, { baseUrl: "http://fleet.example" }); }).toThrow(/HTTPS origin/);
		expect(function _Credentialed() { _Client(fetchMock, { baseUrl: "https://user:pass@fleet.example" }); }).toThrow(/HTTPS origin/);
		expect(function _PathBearing() { _Client(fetchMock, { baseUrl: "https://fleet.example/api" }); }).toThrow(/HTTPS origin/);
	});

	it("refuses a foreign silo before reading the token or sending", async function _SiloFence()
	{
		const fetchMock = vi.fn();
		const tokenReader = vi.fn().mockResolvedValue("projected-token");
		const client = _Client(fetchMock, { readProjectedToken: tokenReader });
		await expect(client.request({ path: "/v1/organization/members", method: "GET", identity: { ..._IDENTITY, siloId: "other" } })).rejects.toThrow(/does not belong/);
		expect(tokenReader).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects malformed and oversized receiver bodies", async function _BoundedBody()
	{
		const malformed = _Client(vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
		await expect(malformed.request({ path: "/v1/organization/members", method: "GET", identity: _IDENTITY })).rejects.toThrow(/valid JSON/);
		const oversized = _Client(vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: { "content-length": "1048577" } })));
		await expect(oversized.request({ path: "/v1/organization/members", method: "GET", identity: _IDENTITY })).rejects.toThrow(/size limit/);
	});
});
