import { describe, expect, it, vi } from "vitest";

import { PrismaPreferenceFactSource } from "../prisma-preference-fact-source.js";

/** Verify that admission selects only facts which the owner already accepted. */
describe("PrismaPreferenceFactSource", function _describePrismaPreferenceFactSource()
{
	it("loads ordered accepted facts for the published personal profile", async function _loadsAcceptedPersonalFacts()
	{
		const findMany = vi.fn().mockResolvedValue([{ id: "fact-1" }, { id: "fact-2" }]);
		const transaction = { prisma: { agentRevision: { findFirst: vi.fn().mockResolvedValue({ personaRevisionId: "persona-revision-1" }) }, personaRevision: { findUnique: vi.fn().mockResolvedValue({ personaProfileId: "profile-1", profile: { siloId: "silo-1", userId: "user-1" } }) }, preferenceFact: { findMany } } };

		const result = await new PrismaPreferenceFactSource().load({ siloId: "silo-1", executionSubjectId: "user-1" } as never, { agentKind: "personal", agentRevisionId: "agent-revision-1", agentServiceId: "service-1" } as never, transaction as never);

		expect(result).toEqual({ outcome: "loaded", value: [{ id: "fact-1" }, { id: "fact-2" }] });
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", state: "Accepted", consentState: { in: ["Explicit", "Confirmed"] } }) }));
	});

	it("does not query personal facts for a managed run", async function _skipsManagedFacts()
	{
		const findFirst = vi.fn();
		const transaction = { prisma: { agentRevision: { findFirst } } };

		expect(await new PrismaPreferenceFactSource().load({} as never, { agentKind: "managed" } as never, transaction as never)).toEqual({ outcome: "loaded", value: [] });
		expect(findFirst).not.toHaveBeenCalled();
	});
});
