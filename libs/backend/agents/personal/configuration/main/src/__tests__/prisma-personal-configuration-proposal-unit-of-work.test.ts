import { AgentConfigPatchKinds } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { PersonalConfigurationProposalCodes } from "../proposal/personal-configuration-proposal.types.js";
import { PrismaPersonalConfigurationProposalUnitOfWork } from "../proposal/prisma-personal-configuration-proposal-unit-of-work.js";

/** Build one Prisma transaction that satisfies every proposal provenance coordinate. */
function _transaction(overrides: { readonly profile?: unknown; readonly thread?: unknown; readonly run?: unknown; readonly service?: unknown } = {})
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
function _command()
{
	return { siloId: "silo-1", userId: "user-1", personaProfileId: "profile-1", agentServiceId: "service-1", sourceThreadId: "thread-1", sourceRunId: "run-1", sourceMessageId: "message-1", requestedPatch: { kind: AgentConfigPatchKinds.ModelAlias, modelAlias: "careful-model" }, requestedPatchDigest: `sha256:${"a".repeat(64)}`, expectedPersonaRevisionId: "persona-1", expectedAgentRevisionId: "agent-1", proposedAt: "2026-07-23T00:00:00.000Z" };
}

describe("Prisma personal configuration proposal UoW", function _PrismaPersonalConfigurationProposalUnitOfWorkSuite()
{
	it("persists only after profile, thread, run, and personal-service fences agree", async function _PersistsBoundProposal()
	{
		const transaction = _transaction();
		const unitOfWork = new PrismaPersonalConfigurationProposalUnitOfWork({ $transaction: async function _RunTransaction(callback: (value: unknown) => Promise<unknown>) { return callback(transaction); } } as never);
		await expect(unitOfWork.proposeAtomically(_command())).resolves.toEqual({ status: PersonalConfigurationProposalCodes.Proposed, changeId: "change-1" });
		expect(transaction.personalConfigurationChange.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sourceRunId: "run-1", expectedPersonaRevisionId: "persona-1", expectedAgentRevisionId: "agent-1" }) }));
	});

	it("fails closed when an active-revision fence no longer matches", async function _RejectsChangedRevision()
	{
		const transaction = _transaction({ service: { activeRevisionId: "agent-2" } });
		const unitOfWork = new PrismaPersonalConfigurationProposalUnitOfWork({ $transaction: async function _RunTransaction(callback: (value: unknown) => Promise<unknown>) { return callback(transaction); } } as never);
		await expect(unitOfWork.proposeAtomically(_command())).resolves.toEqual({ status: PersonalConfigurationProposalCodes.ProvenanceConflict });
		expect(transaction.personalConfigurationChange.create).not.toHaveBeenCalled();
	});
});
