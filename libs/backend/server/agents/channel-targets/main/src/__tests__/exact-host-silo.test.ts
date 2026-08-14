import { describe, expect, it } from "vitest";

import { __ExactHostSiloResolver } from "../exact-host-silo";

describe("exact host silo resolution", function _DescribeExactHostSiloResolution()
{
	it("returns the deployment silo and its exact organization scope", async function _ReturnsFixedBinding()
	{
		const resolver = new __ExactHostSiloResolver({ trustedHost: "acme.example.com", siloId: "silo-1" });

		await expect(resolver.resolveExactHost("acme.example.com")).resolves.toEqual({ siloId: "silo-1", authorizationScope: { kind: "organization", organizationId: "silo-1" } });
		await expect(resolver.resolveExactHost("other.example.com")).resolves.toBeNull();
		await expect(resolver.resolveExactHost("Acme.example.com")).resolves.toBeNull();
	});

	it("rejects incomplete or non-canonical deployment coordinates", function _RejectsInvalidConfig()
	{
		expect(function _UppercaseHost() { return new __ExactHostSiloResolver({ trustedHost: "Acme.example.com", siloId: "silo-1" }); }).toThrow();
		expect(function _MissingSilo() { return new __ExactHostSiloResolver({ trustedHost: "acme.example.com", siloId: "" }); }).toThrow();
	});
});
