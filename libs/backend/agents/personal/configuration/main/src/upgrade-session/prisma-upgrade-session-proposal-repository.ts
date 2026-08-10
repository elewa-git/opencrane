import type { PrismaClient } from "@prisma/client";

import type { RunInputSnapshot, RuntimeExternalActionCandidate } from "@opencrane/contracts";

import { _IsPersonalConfigurationPatch } from "../proposal/personal-configuration-patch.js";
import { __ProposePersonalConfigurationChange } from "../proposal/personal-configuration-proposal.js";
import { PersonalConfigurationProposalCodes } from "../proposal/personal-configuration-proposal.types.js";
import { PrismaPersonalConfigurationProposalUnitOfWork } from "../proposal/prisma-personal-configuration-proposal-unit-of-work.js";
import type { UpgradeSessionProposalReceipt, UpgradeSessionProposalRepository } from "./upgrade-session.types.js";

/** Prisma adapter from one trusted runtime tool candidate to the configuration proposal authority. */
export class PrismaUpgradeSessionProposalRepository implements UpgradeSessionProposalRepository
{
	/** Canonical product-authority database client used for owner-profile resolution. */
	private readonly prisma: PrismaClient;
	/** Proposal transaction owner reused after the runtime coordinates are derived. */
	private readonly proposals: PrismaPersonalConfigurationProposalUnitOfWork;

	/** Creates the runtime bridge over the canonical product database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
		this.proposals = new PrismaPersonalConfigurationProposalUnitOfWork(prisma);
	}

	/** Map one validated built-in tool candidate to the durable proposal authority. */
	async proposeUpgradeSession(candidate: RuntimeExternalActionCandidate, snapshot: RunInputSnapshot, now: string): Promise<UpgradeSessionProposalReceipt>
	{
		// 1. Reject non-personal or non-conversation snapshots before resolving mutable profile state.
		if (snapshot.personaRevisionId === null || snapshot.conversationId === null || !_IsPersonalConfigurationPatch(candidate.arguments)) throw new Error("upgrade_session requires a personal conversation snapshot and supported configuration patch");

		// 2. Resolve the only profile owned by the immutable execution subject in this silo.
		const profile = await this.prisma.personaProfile.findUnique({ where: { siloId_userId: { siloId: snapshot.siloId, userId: snapshot.identitySnapshot.executionSubjectId } }, select: { id: true } });
		if (profile === null) throw new Error("upgrade_session personal profile is unavailable");

		// 3. Reuse the proposal UoW so all current-revision provenance is rebound before insertion.
		const result = await __ProposePersonalConfigurationChange(this.proposals, { siloId: snapshot.siloId, userId: snapshot.identitySnapshot.executionSubjectId, personaProfileId: profile.id, agentServiceId: snapshot.agentServiceId, sourceConversationId: snapshot.conversationId, sourceRunId: snapshot.runId, sourceMessageId: null, requestedPatch: candidate.arguments, requestedPatchDigest: candidate.argumentsDigest, expectedPersonaRevisionId: snapshot.personaRevisionId, expectedAgentRevisionId: snapshot.agentRevisionId, proposedAt: now });
		if (result.outcome !== PersonalConfigurationProposalCodes.Proposed) throw new Error(`upgrade_session proposal denied: ${result.reason}`);
		return { changeId: result.changeId };
	}
}
