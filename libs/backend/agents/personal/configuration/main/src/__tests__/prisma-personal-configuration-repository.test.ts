import { describe, expect, it, vi } from "vitest";

import { PrismaPersonalConfigurationChangeRepository } from "../prisma-personal-configuration-repository.js";

/** Build one Prisma transaction that satisfies every provenance coordinate. */
function _Transaction(overrides: { readonly profile?: unknown; readonly thread?: unknown; readonly run?: unknown; readonly service?: unknown } = {})
{
	return {
		personaProfile: { findFirst: vi.fn(async function _profile() { return overrides.profile === undefined ? { activeRevisionId: "persona-1" } : overrides.profile; }) },
		conversationThread: { findFirst: vi.fn(async function _thread() { return overrides.thread === undefined ? { agentServiceId: "service-1" } : overrides.thread; }) },
		agentRun: { findFirst: vi.fn(async function _run() { return overrides.run === undefined ? { id: "run-1" } : overrides.run; }) },
		agentService: { findFirst: vi.fn(async function _service() { return overrides.service === undefined ? { activeRevisionId: "agent-1" } : overrides.service; }) },
		personalConfigurationChange: { create: vi.fn(async function _create() { return { id: "change-1" }; }) },
	};
}

/** Create one valid proposal command. */
function _Command()
{
	return { siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", agentServiceId: "service-1", sourceThreadId: "thread-1", sourceRunId: "run-1", sourceMessageId: "message-1", requestedPatch: { kind: "model_alias" as const, modelAlias: "careful-model" }, requestedPatchDigest: `sha256:${"a".repeat(64)}`, expectedPersonaRevisionId: "persona-1", expectedAgentRevisionId: "agent-1", proposedAt: "2026-07-23T00:00:00.000Z" };
}

describe("Prisma personal configuration repository", function _Suite()
{
	it("persists only after profile, thread, run, and personal-service fences agree", async function _PersistsBoundProposal()
	{
		const transaction = _Transaction();
		const repository = new PrismaPersonalConfigurationChangeRepository({ $transaction: async function _transaction(callback: (value: unknown) => Promise<unknown>) { return callback(transaction); } } as never);
		await expect(repository.proposeAtomically(_Command())).resolves.toEqual({ status: "proposed", changeId: "change-1" });
		expect(transaction.personalConfigurationChange.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sourceRunId: "run-1", expectedPersonaRevisionId: "persona-1", expectedAgentRevisionId: "agent-1" }) }));
	});

	it("fails closed when an active-revision fence no longer matches", async function _RejectsChangedRevision()
	{
		const transaction = _Transaction({ service: { activeRevisionId: "agent-2" } });
		const repository = new PrismaPersonalConfigurationChangeRepository({ $transaction: async function _transaction(callback: (value: unknown) => Promise<unknown>) { return callback(transaction); } } as never);
		await expect(repository.proposeAtomically(_Command())).resolves.toEqual({ status: "provenance_conflict" });
		expect(transaction.personalConfigurationChange.create).not.toHaveBeenCalled();
	});

	it("compare-and-sets only a still-proposed change owned by the deciding user", async function _DecidesOwnedProposal()
	{
		const updateMany = vi.fn(async function _update() { return { count: 1 }; });
		const repository = new PrismaPersonalConfigurationChangeRepository({ personalConfigurationChange: { updateMany, findFirst: vi.fn() } } as never);
		await expect(repository.decideAtomically({ siloId: "silo-1", userId: "user-1", changeId: "change-1", decision: "accepted", rejectionReason: null, decidedAt: "2026-07-23T00:00:00.000Z" })).resolves.toEqual({ status: "accepted" });
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "user-1", state: "Proposed" }), data: expect.objectContaining({ state: "Accepted", decidedBy: "user-1" }) }));
	});

	it("does not disclose a non-owned or terminal proposal after a lost compare-and-set", async function _HidesUnavailableDecision()
	{
		const repository = new PrismaPersonalConfigurationChangeRepository({ personalConfigurationChange: { updateMany: vi.fn(async function _update() { return { count: 0 }; }), findFirst: vi.fn(async function _find() { return null; }) } } as never);
		await expect(repository.decideAtomically({ siloId: "silo-1", userId: "user-1", changeId: "change-1", decision: "rejected", rejectionReason: "Keep current settings", decidedAt: "2026-07-23T00:00:00.000Z" })).resolves.toEqual({ status: "not_found_or_not_owner" });
	});
});
