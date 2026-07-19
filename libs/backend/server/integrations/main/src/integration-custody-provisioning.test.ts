import { describe, expect, it, vi } from "vitest";

import { __ProvisionIntegrationCustody } from "./integration-custody-provisioning.js";

describe("integration custody provisioning", function _suite()
{
	it("fails closed when Obot is unavailable", async function _remoteUnavailable()
	{
		const result = await __ProvisionIntegrationCustody({ provision: vi.fn().mockRejectedValue(new Error("timeout")), revoke: vi.fn() }, { persistReady: vi.fn() }, { siloId: "silo-1", integrationId: "integration-1", obotCatalogEntryId: "catalog-1", credential: [{ name: "Authorization", value: "write-only" }] });
		expect(result).toEqual({ outcome: "unavailable", reason: "remote_unavailable" });
	});

	it("revokes remote custody when persistence fails", async function _compensation()
	{
		const revoke = vi.fn().mockResolvedValue(undefined);
		const custody = { provision: vi.fn().mockResolvedValue({ obotCatalogEntryId: "catalog-1", obotCustodyReference: "obot:issued:one", expiresAt: new Date("2026-07-20T00:00:00.000Z") }), revoke };
		const result = await __ProvisionIntegrationCustody(custody, { persistReady: vi.fn().mockRejectedValue(new Error("database unavailable")) }, { siloId: "silo-1", integrationId: "integration-1", obotCatalogEntryId: "catalog-1", credential: [{ name: "Authorization", value: "write-only" }] });
		expect(result).toEqual({ outcome: "unavailable", reason: "persistence_failed" });
		expect(revoke).toHaveBeenCalledWith("obot:issued:one");
	});

	it("reports compensation failure without exposing remote custody", async function _compensationFailure()
	{
		const custody = { provision: vi.fn().mockResolvedValue({ obotCatalogEntryId: "catalog-1", obotCustodyReference: "obot:issued:one", expiresAt: new Date("2026-07-20T00:00:00.000Z") }), revoke: vi.fn().mockRejectedValue(new Error("remote unavailable")) };
		await expect(__ProvisionIntegrationCustody(custody, { persistReady: vi.fn().mockRejectedValue(new Error("database unavailable")) }, { siloId: "silo-1", integrationId: "integration-1", obotCatalogEntryId: "catalog-1", credential: [{ name: "Authorization", value: "write-only" }] })).resolves.toEqual({ outcome: "unavailable", reason: "compensation_failed" });
	});
});
