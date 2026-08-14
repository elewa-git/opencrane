import { Prisma } from "@prisma/client";
import { AgentConfigPatchKinds } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import type { ProposePersonalConfigurationChangeCommand } from "../proposal/personal-configuration-proposal.types";
import { PrismaPersonalConfigurationProposalRepository } from "../proposal/prisma-personal-configuration-proposal-repository";

/** Build one transaction double for the single database-owned proposal insert. */
function _transaction(error: Error | null = null)
{
	const create = vi.fn(async function _CreateProposal()
	{
		if (error !== null) throw error;
		return { id: "change-1" };
	});
	const transaction = { personalConfigurationChange: { create } };
	return { transaction, create };
}

/** Build the exact validated command admitted to the transaction repository. */
function _command(): ProposePersonalConfigurationChangeCommand
{
	const command: ProposePersonalConfigurationChangeCommand = {
		siloId: "silo-1",
		userId: "user-1",
		personaProfileId: "profile-1",
		agentServiceId: "service-1",
		sourceConversationId: "conversation-1",
		sourceRunId: "run-1",
		sourceMessageId: "message-1",
		requestedPatch: { kind: AgentConfigPatchKinds.ModelAlias, modelAlias: "careful-model" },
		requestedPatchDigest: `sha256:${"a".repeat(64)}`,
		expectedPersonaRevisionId: "persona-1",
		expectedAgentRevisionId: "agent-1",
		proposedAt: "2026-07-23T00:00:00.000Z",
	};
	return command;
}

/** Build the exact Prisma insert guarded by the database provenance trigger. */
function _expectedInsert(): Prisma.PersonalConfigurationChangeCreateArgs
{
	const insert: Prisma.PersonalConfigurationChangeCreateArgs = {
		data: {
			siloId: "silo-1",
			userId: "user-1",
			personaProfileId: "profile-1",
			agentServiceId: "service-1",
			sourceConversationId: "conversation-1",
			sourceRunId: "run-1",
			sourceMessageId: "message-1",
			requestedPatch: { kind: AgentConfigPatchKinds.ModelAlias, modelAlias: "careful-model" },
			requestedPatchDigest: `sha256:${"a".repeat(64)}`,
			expectedPersonaRevisionId: "persona-1",
			expectedAgentRevisionId: "agent-1",
			proposedAt: new Date("2026-07-23T00:00:00.000Z"),
		},
		select: { id: true },
	};
	return insert;
}

describe("PrismaPersonalConfigurationProposalRepository", function _PrismaPersonalConfigurationProposalRepositorySuite()
{
	it("inserts exact immutable evidence through the database provenance authority", async function _PersistsBoundProposal()
	{
		const database = _transaction();
		const repository = new PrismaPersonalConfigurationProposalRepository(database.transaction as never);

		await expect(repository.propose(_command())).resolves.toEqual({ changeId: "change-1" });
		expect(database.create).toHaveBeenCalledOnce();
		expect(database.create).toHaveBeenCalledWith(_expectedInsert());
	});

	it("propagates a database provenance denial to the owning unit of work", async function _PropagatesDenial()
	{
		const conflict = new Error("database provenance conflict");
		const database = _transaction(conflict);
		const repository = new PrismaPersonalConfigurationProposalRepository(database.transaction as never);

		await expect(repository.propose(_command())).rejects.toBe(conflict);
		expect(database.create).toHaveBeenCalledOnce();
	});
});
