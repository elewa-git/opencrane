import { AgentServiceKind, PersonalConfigurationChangeState, Prisma, type PrismaClient } from "@prisma/client";
import type { RunInputSnapshot, RuntimeExternalActionCandidate } from "@opencrane/contracts";
import { ___CreateLogger, ___DoWithTrace, type Logger } from "@opencrane/observability";

import { __ProposePersonalConfigurationChange } from "./personal-configuration.js";
import { _IsPersonalConfigurationPatch } from "./configuration-patch.js";
import { PersonalConfigurationChangeViewStates, PersonalConfigurationDecisionCodes, PersonalConfigurationProposalCodes, type DecidePersonalConfigurationChangeCommand, type PersonalConfigurationChangeDecisionRepository, type PersonalConfigurationChangeRepository, type PersonalConfigurationChangeView, type PersonalConfigurationChangeViewRepository, type ProposePersonalConfigurationChangeCommand } from "./personal-configuration.types.js";
import type { UpgradeSessionProposalReceipt, UpgradeSessionProposalRepository } from "./upgrade-session.types.js";

/** Prisma adapter that proves a proposal's user, thread, run, profile, and service bindings atomically. */
export class PrismaPersonalConfigurationChangeRepository implements PersonalConfigurationChangeDecisionRepository, PersonalConfigurationChangeRepository, PersonalConfigurationChangeViewRepository, UpgradeSessionProposalRepository
{
	/** Canonical per-silo product database. */
	private readonly prisma: PrismaClient;
	/** Redacted structured failure logger for this persistence seam. */
	private readonly logger: Logger;

	/** Create the proposal adapter over the canonical product database. */
	constructor(prisma: PrismaClient, logger: Logger = ___CreateLogger("personal-configuration"))
	{
		this.prisma = prisma;
		this.logger = logger;
	}

	/** List the latest fifty personal configuration proposals owned by one user in one silo. */
	async listOwned(siloId: string, userId: string): Promise<readonly PersonalConfigurationChangeView[]>
	{
		const changes = await this.prisma.personalConfigurationChange.findMany({ where: { siloId, userId }, orderBy: [{ proposedAt: "desc" }, { id: "desc" }], take: 50, select: { id: true, requestedPatch: true, state: true, sourceThreadId: true, sourceRunId: true, proposedAt: true, decidedAt: true, rejectionReason: true } });
		return changes.map(_toChangeView);
	}

	/** Insert one request only after every mutable provenance coordinate agrees in one transaction. */
	async proposeAtomically(command: ProposePersonalConfigurationChangeCommand): Promise<{ readonly status: PersonalConfigurationProposalCodes.Proposed; readonly changeId: string } | { readonly status: PersonalConfigurationProposalCodes.ProvenanceConflict } | { readonly status: PersonalConfigurationProposalCodes.PersistenceUnavailable }>
	{
		const prisma = this.prisma;
		try
		{
			return await ___DoWithTrace("personal_configuration.propose", { siloId: command.siloId, userId: command.userId, sourceRunId: command.sourceRunId }, async function _traceProposal()
			{
				return prisma.$transaction(async function _propose(transaction)
				{
				// 1. Verify the personal profile remains owned by the initiating user in this silo.
				const profile = await transaction.personaProfile.findFirst({ where: { id: command.personaProfileId, siloId: command.siloId, userId: command.userId }, select: { activeRevisionId: true } });
				if (profile === null) return { status: PersonalConfigurationProposalCodes.ProvenanceConflict } as const;

				// 2. Verify the conversation, run, and personal service bind the same user and silo.
				const thread = await transaction.conversationThread.findFirst({ where: { id: command.sourceThreadId, siloId: command.siloId, participants: { some: { userId: command.userId } } }, select: { agentServiceId: true } });
				const run = await transaction.agentRun.findFirst({ where: { id: command.sourceRunId, siloId: command.siloId, threadId: command.sourceThreadId, agentServiceId: command.agentServiceId, delegatedUserId: command.userId }, select: { id: true } });
				const service = await transaction.agentService.findFirst({ where: { id: command.agentServiceId, siloId: command.siloId, kind: AgentServiceKind.Personal }, select: { activeRevisionId: true } });
				if (thread === null || thread.agentServiceId !== command.agentServiceId || run === null || service === null || profile.activeRevisionId !== command.expectedPersonaRevisionId || service.activeRevisionId !== command.expectedAgentRevisionId) return { status: PersonalConfigurationProposalCodes.ProvenanceConflict } as const;

				// 3. Persist only immutable request evidence; later approval owns the sole state transition.
				const change = await transaction.personalConfigurationChange.create({ data: { siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId, agentServiceId: command.agentServiceId, sourceThreadId: command.sourceThreadId, sourceRunId: command.sourceRunId, sourceMessageId: command.sourceMessageId, requestedPatch: command.requestedPatch as Prisma.InputJsonValue, requestedPatchDigest: command.requestedPatchDigest, expectedPersonaRevisionId: command.expectedPersonaRevisionId, expectedAgentRevisionId: command.expectedAgentRevisionId, proposedAt: new Date(command.proposedAt) }, select: { id: true } });
				return { status: PersonalConfigurationProposalCodes.Proposed, changeId: change.id } as const;
				});
			});
		}
		catch (err)
		{
			this.logger.error({ err, operation: "personal_configuration.propose", siloId: command.siloId, sourceRunId: command.sourceRunId }, "Personal configuration proposal persistence failed");
			return _isProvenanceConflict(err) ? { status: PersonalConfigurationProposalCodes.ProvenanceConflict } : { status: PersonalConfigurationProposalCodes.PersistenceUnavailable };
		}
	}

	/** Compare-and-set an owner decision while retaining immutable proposal provenance. */
	async decideAtomically(command: DecidePersonalConfigurationChangeCommand): Promise<{ readonly status: PersonalConfigurationDecisionCodes.Accepted | PersonalConfigurationDecisionCodes.Rejected } | { readonly status: PersonalConfigurationDecisionCodes.NotFoundOrNotOwner | PersonalConfigurationDecisionCodes.AlreadyDecided | PersonalConfigurationDecisionCodes.PersistenceUnavailable }>
	{
		try
		{
			const state = command.decision === PersonalConfigurationDecisionCodes.Accepted ? PersonalConfigurationChangeState.Accepted : PersonalConfigurationChangeState.Rejected;
			const updated = await this.prisma.personalConfigurationChange.updateMany({ where: { id: command.changeId, siloId: command.siloId, userId: command.userId, state: PersonalConfigurationChangeState.Proposed }, data: { state, decidedAt: new Date(command.decidedAt), decidedBy: command.userId, rejectionReason: command.rejectionReason } });
			if (updated.count === 1) return { status: command.decision };
			const existing = await this.prisma.personalConfigurationChange.findFirst({ where: { id: command.changeId, siloId: command.siloId, userId: command.userId }, select: { state: true } });
			return existing === null ? { status: PersonalConfigurationDecisionCodes.NotFoundOrNotOwner } : { status: PersonalConfigurationDecisionCodes.AlreadyDecided };
		}
		catch (err)
		{
			this.logger.error({ err, operation: "personal_configuration.decide", siloId: command.siloId, changeId: command.changeId }, "Personal configuration decision persistence failed");
			return { status: PersonalConfigurationDecisionCodes.PersistenceUnavailable };
		}
	}

	/** Map one validated built-in tool candidate to the same durable proposal authority. */
	async proposeUpgradeSession(candidate: RuntimeExternalActionCandidate, snapshot: RunInputSnapshot, now: string): Promise<UpgradeSessionProposalReceipt>
	{
		// 1. Reject non-personal or non-conversation snapshots before deriving any mutable profile coordinate.
		if (snapshot.personaRevisionId === null || snapshot.threadId === null || !_IsPersonalConfigurationPatch(candidate.arguments)) throw new Error("upgrade_session requires a personal conversation snapshot and supported configuration patch");

		// 2. Resolve the only profile owned by the immutable execution subject in this silo.
		const profile = await this.prisma.personaProfile.findUnique({ where: { siloId_userId: { siloId: snapshot.siloId, userId: snapshot.identitySnapshot.executionSubjectId } }, select: { id: true } });
		if (profile === null) throw new Error("upgrade_session personal profile is unavailable");

		// 3. Reuse the proposal authority so current-revision provenance is checked atomically at insertion.
		const result = await __ProposePersonalConfigurationChange(this, { siloId: snapshot.siloId, userId: snapshot.identitySnapshot.executionSubjectId, personaProfileId: profile.id, agentServiceId: snapshot.agentServiceId, sourceThreadId: snapshot.threadId, sourceRunId: snapshot.runId, sourceMessageId: null, requestedPatch: candidate.arguments, requestedPatchDigest: candidate.argumentsDigest, expectedPersonaRevisionId: snapshot.personaRevisionId, expectedAgentRevisionId: snapshot.agentRevisionId, proposedAt: now });
		if (result.outcome !== PersonalConfigurationProposalCodes.Proposed) throw new Error(`upgrade_session proposal denied: ${result.reason}`);
		return { changeId: result.changeId };
	}
}

/** Map a selected canonical proposal row into the closed owner-visible product shape. */
function _toChangeView(change: { id: string; requestedPatch: Prisma.JsonValue; state: PersonalConfigurationChangeState; sourceThreadId: string; sourceRunId: string; proposedAt: Date; decidedAt: Date | null; rejectionReason: string | null }): PersonalConfigurationChangeView
{
	if (!_IsPersonalConfigurationPatch(change.requestedPatch)) throw new Error("personal configuration change has unsupported patch shape");
	return { changeId: change.id, requestedPatch: change.requestedPatch, state: _state(change.state), sourceThreadId: change.sourceThreadId, sourceRunId: change.sourceRunId, proposedAt: change.proposedAt.toISOString(), decidedAt: change.decidedAt?.toISOString() ?? null, rejectionReason: change.rejectionReason };
}

/** Convert the database lifecycle enum to its stable product spelling. */
function _state(state: PersonalConfigurationChangeState): PersonalConfigurationChangeView["state"]
{
	if (state === PersonalConfigurationChangeState.Proposed) return PersonalConfigurationChangeViewStates.Proposed;
	if (state === PersonalConfigurationChangeState.Accepted) return PersonalConfigurationChangeViewStates.Accepted;
	if (state === PersonalConfigurationChangeState.Applied) return PersonalConfigurationChangeViewStates.Applied;
	if (state === PersonalConfigurationChangeState.Rejected) return PersonalConfigurationChangeViewStates.Rejected;
	return PersonalConfigurationChangeViewStates.Superseded;
}

/** Recognise the database's explicit business-fence rejection without exposing database details. */
function _isProvenanceConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P0001";
}
