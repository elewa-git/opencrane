import { describe, expect, it, vi } from "vitest";

import { PrismaIntegrationAuthorityRepository } from "./prisma-integration-authority.js";

describe("Prisma integration authority", function _suite()
{
	it("returns only an active same-silo assignment's opaque Obot reference and explicit tools", async function _resolved()
	{
		const findUnique = vi.fn().mockResolvedValue({
			siloId: "silo-1",
			integrationId: "integration-1",
			allowedTools: ["calendar.read"],
			integration: { state: "Active", obotCatalogEntryId: "obot-calendar" },
			custodyReference: { state: "Ready", revokedAt: null, expiresAt: new Date("2026-07-19T12:00:00.000Z"), obotCustodyReference: "obot:opaque:calendar" },
		});
		const repository = new PrismaIntegrationAuthorityRepository({ agentRevisionIntegrationAssignment: { findUnique } } as never, { now: vi.fn().mockReturnValue(new Date("2026-07-19T11:00:00.000Z")) });
		const result = await repository.resolveAssignment({ siloId: "silo-1", agentRevisionId: "revision-1", integrationId: "integration-1" });
		expect(result).toEqual({ outcome: "resolved", assignment: { integrationId: "integration-1", obotCatalogEntryId: "obot-calendar", obotCustodyReference: "obot:opaque:calendar", allowedTools: ["calendar.read"] } });
		expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ include: { integration: true, custodyReference: true } }));
	});

	it("does not resolve revoked or expired custody references", async function _unavailable()
	{
		const findUnique = vi.fn().mockResolvedValue({
			siloId: "silo-1",
			integrationId: "integration-1",
			allowedTools: ["calendar.read"],
			integration: { state: "Active", obotCatalogEntryId: "obot-calendar" },
			custodyReference: { state: "Revoked", revokedAt: new Date("2026-07-19T10:00:00.000Z"), expiresAt: new Date("2026-07-19T12:00:00.000Z"), obotCustodyReference: "obot:opaque:calendar" },
		});
		const repository = new PrismaIntegrationAuthorityRepository({ agentRevisionIntegrationAssignment: { findUnique } } as never, { now: vi.fn().mockReturnValue(new Date("2026-07-19T11:00:00.000Z")) });
		await expect(repository.resolveAssignment({ siloId: "silo-1", agentRevisionId: "revision-1", integrationId: "integration-1" })).resolves.toEqual({ outcome: "unavailable", reason: "revoked" });
	});
});
