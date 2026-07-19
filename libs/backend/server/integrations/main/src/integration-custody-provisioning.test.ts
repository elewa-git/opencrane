import { describe, expect, it, vi } from "vitest";

import { __ProvisionIntegrationCustody } from "./integration-custody-provisioning.js";

describe("integration custody provisioning", function _suite()
{
	it("fails closed when Obot is unavailable", async function _remoteUnavailable()
	{
		const log = _CreateLog();
		const result = await __ProvisionIntegrationCustody({ provision: vi.fn().mockRejectedValue(new Error("Bearer write-only")), revoke: vi.fn() }, { persistReady: vi.fn() }, log, _Command());
		expect(result).toEqual({ outcome: "unavailable", reason: "remote_unavailable" });
		expect(log.warn).toHaveBeenCalledWith({ siloId: "silo-1", integrationId: "integration-1", obotCatalogEntryId: "catalog-1", errorType: "Error" }, "Obot custody provisioning failed");
		expect(JSON.stringify(log.warn.mock.calls)).not.toContain("write-only");
	});

	it("keeps a remote failure closed when diagnostic logging itself fails", async function _throwingLogger()
	{
		const log = { warn: vi.fn().mockImplementation(function _throw() { throw new Error("logger unavailable"); }), error: vi.fn() };
		await expect(__ProvisionIntegrationCustody({ provision: vi.fn().mockRejectedValue(new Error("timeout")), revoke: vi.fn() }, { persistReady: vi.fn() }, log, _Command())).resolves.toEqual({ outcome: "unavailable", reason: "remote_unavailable" });
	});

	it("revokes remote custody when persistence fails", async function _compensation()
	{
		const revoke = vi.fn().mockResolvedValue(undefined);
		const custody = { provision: vi.fn().mockResolvedValue({ obotCatalogEntryId: "catalog-1", obotCustodyReference: "obot:issued:one", expiresAt: new Date("2026-07-20T00:00:00.000Z") }), revoke };
		const log = _CreateLog();
		const result = await __ProvisionIntegrationCustody(custody, { persistReady: vi.fn().mockRejectedValue(new Error("database unavailable")) }, log, _Command());
		expect(result).toEqual({ outcome: "unavailable", reason: "persistence_failed" });
		expect(revoke).toHaveBeenCalledWith("obot:issued:one");
		expect(log.warn).toHaveBeenCalledWith({ siloId: "silo-1", integrationId: "integration-1", obotCatalogEntryId: "catalog-1", errorType: "Error" }, "Integration custody persistence failed; starting compensation");
	});

	it("logs an invalid remote response compensation failure without the custody reference", async function _invalidResponseCompensationFailure()
	{
		const custody = { provision: vi.fn().mockResolvedValue({ obotCatalogEntryId: "different-catalog", obotCustodyReference: "obot:issued:invalid", expiresAt: new Date("2026-07-20T00:00:00.000Z") }), revoke: vi.fn().mockRejectedValue(new Error("remote unavailable")) };
		const log = _CreateLog();
		await expect(__ProvisionIntegrationCustody(custody, { persistReady: vi.fn() }, log, _Command())).resolves.toEqual({ outcome: "unavailable", reason: "compensation_failed" });
		expect(log.error).toHaveBeenCalledWith({ siloId: "silo-1", integrationId: "integration-1", obotCatalogEntryId: "catalog-1", errorType: "Error" }, "Obot custody compensation failed after an invalid response");
		expect(JSON.stringify(log.error.mock.calls)).not.toContain("obot:issued:invalid");
	});

	it("reports compensation failure without exposing remote custody", async function _compensationFailure()
	{
		const custody = { provision: vi.fn().mockResolvedValue({ obotCatalogEntryId: "catalog-1", obotCustodyReference: "obot:issued:one", expiresAt: new Date("2026-07-20T00:00:00.000Z") }), revoke: vi.fn().mockRejectedValue(new Error("remote unavailable")) };
		const log = _CreateLog();
		await expect(__ProvisionIntegrationCustody(custody, { persistReady: vi.fn().mockRejectedValue(new Error("database unavailable")) }, log, _Command())).resolves.toEqual({ outcome: "unavailable", reason: "compensation_failed" });
		expect(log.error).toHaveBeenCalledWith({ siloId: "silo-1", integrationId: "integration-1", obotCatalogEntryId: "catalog-1", errorType: "Error" }, "Obot custody compensation failed after a persistence failure");
		expect(JSON.stringify(log.error.mock.calls)).not.toContain("obot:issued:one");
	});

	/** Create a focused capture logger for custody failure assertions. */
	function _CreateLog()
	{
		return { warn: vi.fn(), error: vi.fn() };
	}

	/** Create a write-only custody command with deterministic non-secret identifiers. */
	function _Command()
	{
		return { siloId: "silo-1", integrationId: "integration-1", obotCatalogEntryId: "catalog-1", credential: [{ name: "Authorization", value: "write-only" }] };
	}
});
