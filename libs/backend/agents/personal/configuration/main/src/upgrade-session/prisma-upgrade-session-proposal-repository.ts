import type { Prisma, PrismaClient } from "@prisma/client";

import type { RunInputSnapshot } from "@opencrane/contracts";

import { _IsPersonalConfigurationPatch } from "../proposal/personal-configuration-patch.js";
import { __ProposePersonalConfigurationChange } from "../proposal/personal-configuration-proposal.js";
import { PersonalConfigurationProposalCodes } from "../proposal/personal-configuration-proposal.types.js";
import { PrismaPersonalConfigurationProposalRepository } from "../proposal/prisma-personal-configuration-proposal-repository.js";
import type { UpgradeSessionInvocation, UpgradeSessionProposalReceipt, UpgradeSessionProposalRepository, UpgradeSessionProposalUnitOfWork } from "./upgrade-session.types.js";

/** Prisma adapter from one trusted runtime tool candidate to the configuration proposal authority. */
export class PrismaUpgradeSessionProposalRepository implements UpgradeSessionProposalRepository
{
	/** Transaction-scoped product-authority client. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the runtime bridge over the canonical product database. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Map one validated built-in tool candidate to the durable proposal authority. */
	async proposeUpgradeSession(candidate: UpgradeSessionInvocation, snapshot: RunInputSnapshot, now: string): Promise<UpgradeSessionProposalReceipt>
	{
		// 1. Reject non-personal or non-conversation snapshots before resolving mutable profile state.
		if (snapshot.personaRevisionId === null || snapshot.conversationId === null || !_IsPersonalConfigurationPatch(candidate.arguments)) throw new Error("upgrade_session requires a personal conversation snapshot and supported configuration patch");

		// 2. Resolve the only profile owned by the immutable execution subject in this silo.
		const profile = await this.transaction.personaProfile.findUnique({ where: { siloId_userId: { siloId: snapshot.siloId, userId: snapshot.identitySnapshot.executionSubjectId } }, select: { id: true } });
		if (profile === null) throw new Error("upgrade_session personal profile is unavailable");

		// 3. Reuse the proposal UoW so all current-revision provenance is rebound before insertion.
		const proposals = new PrismaPersonalConfigurationProposalRepository(this.transaction);
		const result = await __ProposePersonalConfigurationChange({ proposeAtomically: function _propose(command) { return proposals.propose(command); } }, { siloId: snapshot.siloId, userId: snapshot.identitySnapshot.executionSubjectId, personaProfileId: profile.id, agentServiceId: snapshot.agentServiceId, sourceConversationId: snapshot.conversationId, sourceRunId: snapshot.runId, sourceMessageId: null, requestedPatch: candidate.arguments, requestedPatchDigest: candidate.argumentsDigest, expectedPersonaRevisionId: snapshot.personaRevisionId, expectedAgentRevisionId: snapshot.agentRevisionId, proposedAt: now });
		if (result.outcome !== PersonalConfigurationProposalCodes.Proposed) throw new Error(`upgrade_session proposal denied: ${result.reason}`);
		return { changeId: result.changeId };
	}
}

/** Prisma unit of work that binds profile resolution and proposal insertion to one transaction. */
export class PrismaUpgradeSessionProposalUnitOfWork implements UpgradeSessionProposalUnitOfWork
{
	/** Canonical product-authority database client. */
	private readonly prisma: PrismaClient;

	/** Create the unit of work over process-owned persistence. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Propose one future-session change inside one transaction snapshot. */
	async proposeUpgradeSession(candidate: UpgradeSessionInvocation, snapshot: RunInputSnapshot, now: string): Promise<UpgradeSessionProposalReceipt>
	{
		return this.prisma.$transaction(async function _propose(transaction)
		{
			return new PrismaUpgradeSessionProposalRepository(transaction).proposeUpgradeSession(candidate, snapshot, now);
		});
	}
}
