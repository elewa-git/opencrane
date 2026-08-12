import type { Prisma, PrismaClient } from "@prisma/client";

import type { RunInputSnapshot } from "@opencrane/contracts";

import { _IsPersonalConfigurationPatch } from "../proposal/personal-configuration-patch.js";
import { __ProposePersonalConfigurationChange } from "../proposal/personal-configuration-proposal.js";
import { PersonalConfigurationProposalCodes } from "../proposal/personal-configuration-proposal.types.js";
import { PrismaPersonalConfigurationProposalRepository } from "../proposal/prisma-personal-configuration-proposal-repository.js";
import type { UpgradeSessionInvocation, UpgradeSessionProposalReceipt, UpgradeSessionProposalRepository, UpgradeSessionProposalUnitOfWork } from "./upgrade-session.types.js";

/**
 * Turns one `upgrade_session` tool call into a configuration proposal, inside the caller's
 * transaction.
 *
 * Reads the user's persona profile, then goes through
 * {@link __ProposePersonalConfigurationChange} rather than inserting directly, so the ownership
 * and active-revision checks cannot be skipped on this path.
 *
 * Constructed by: {@link PrismaUpgradeSessionProposalUnitOfWork.proposeUpgradeSession}.
 *
 * @implements UpgradeSessionProposalRepository
 */
export class PrismaUpgradeSessionProposalRepository implements UpgradeSessionProposalRepository
{
	/** Transaction-scoped product-authority client. */
	private readonly transaction: Prisma.TransactionClient;

	/** Creates the adapter over one open transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Records the tool call's requested change as a proposal and returns its id. */
	async proposeUpgradeSession(candidate: UpgradeSessionInvocation, snapshot: RunInputSnapshot, now: string): Promise<UpgradeSessionProposalReceipt>
	{
		// 1. Reject a snapshot with no persona revision or no conversation, and an unsupported patch, before reading any profile.
		if (snapshot.personaRevisionId === null || snapshot.conversationId === null || !_IsPersonalConfigurationPatch(candidate.arguments)) throw new Error("upgrade_session requires a personal conversation snapshot and supported configuration patch");

		// 2. Find the persona profile of the run's execution subject in this silo.
		const profile = await this.transaction.personaProfile.findUnique({ where: { siloId_userId: { siloId: snapshot.siloId, userId: snapshot.identitySnapshot.executionSubjectId } }, select: { id: true } });
		if (profile === null) throw new Error("upgrade_session personal profile is unavailable");

		// 3. Go through the proposal authority so it re-checks the owner and the active revisions before inserting.
		const proposals = new PrismaPersonalConfigurationProposalRepository(this.transaction);
		const result = await __ProposePersonalConfigurationChange({ proposeAtomically: function _propose(command) { return proposals.propose(command); } }, { siloId: snapshot.siloId, userId: snapshot.identitySnapshot.executionSubjectId, personaProfileId: profile.id, agentServiceId: snapshot.agentServiceId, sourceConversationId: snapshot.conversationId, sourceRunId: snapshot.runId, sourceMessageId: null, requestedPatch: candidate.arguments, requestedPatchDigest: candidate.argumentsDigest, expectedPersonaRevisionId: snapshot.personaRevisionId, expectedAgentRevisionId: snapshot.agentRevisionId, proposedAt: now });
		if (result.outcome !== PersonalConfigurationProposalCodes.Proposed) throw new Error(`upgrade_session proposal denied: ${result.reason}`);
		return { changeId: result.changeId };
	}
}

/**
 * Runs the profile lookup and the proposal insert in one transaction.
 *
 * Both must share it: the profile could otherwise be replaced between the lookup and the insert,
 * and the proposal would be recorded against a profile that no longer exists.
 *
 * Constructed by: `external-action-composition.ts` in apps/opencrane/src/app, as the runtime's
 * `personalConfiguration` dependency.
 *
 * @implements UpgradeSessionProposalUnitOfWork
 */
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
