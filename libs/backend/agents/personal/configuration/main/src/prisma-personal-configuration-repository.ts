import { AgentServiceKind, Prisma, type PrismaClient } from "@prisma/client";
import { ___CreateLogger, ___DoWithTrace, type Logger } from "@opencrane/observability";

import type { PersonalConfigurationChangeRepository, ProposePersonalConfigurationChangeCommand } from "./personal-configuration.types.js";

/** Prisma adapter that proves a proposal's user, thread, run, profile, and service bindings atomically. */
export class PrismaPersonalConfigurationChangeRepository implements PersonalConfigurationChangeRepository
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

	/** Insert one request only after every mutable provenance coordinate agrees in one transaction. */
	async proposeAtomically(command: ProposePersonalConfigurationChangeCommand): Promise<{ readonly status: "proposed"; readonly changeId: string } | { readonly status: "provenance_conflict" } | { readonly status: "persistence_unavailable" }>
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
				if (profile === null) return { status: "provenance_conflict" } as const;

				// 2. Verify the conversation, run, and personal service bind the same user and silo.
				const thread = await transaction.conversationThread.findFirst({ where: { id: command.sourceThreadId, siloId: command.siloId, participants: { some: { userId: command.userId } } }, select: { agentServiceId: true } });
				const run = await transaction.agentRun.findFirst({ where: { id: command.sourceRunId, siloId: command.siloId, threadId: command.sourceThreadId, agentServiceId: command.agentServiceId, delegatedUserId: command.userId }, select: { id: true } });
				const service = await transaction.agentService.findFirst({ where: { id: command.agentServiceId, siloId: command.siloId, kind: AgentServiceKind.Personal }, select: { activeRevisionId: true } });
				if (thread === null || thread.agentServiceId !== command.agentServiceId || run === null || service === null || profile.activeRevisionId !== command.expectedPersonaRevisionId || service.activeRevisionId !== command.expectedAgentRevisionId) return { status: "provenance_conflict" } as const;

				// 3. Persist only immutable request evidence; later approval owns the sole state transition.
				const change = await transaction.personalConfigurationChange.create({ data: { siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId, agentServiceId: command.agentServiceId, sourceThreadId: command.sourceThreadId, sourceRunId: command.sourceRunId, sourceMessageId: command.sourceMessageId, requestedPatch: command.requestedPatch as Prisma.InputJsonValue, requestedPatchDigest: command.requestedPatchDigest, expectedPersonaRevisionId: command.expectedPersonaRevisionId, expectedAgentRevisionId: command.expectedAgentRevisionId, proposedAt: new Date(command.proposedAt) }, select: { id: true } });
				return { status: "proposed", changeId: change.id } as const;
				});
			});
		}
		catch (err)
		{
			this.logger.error({ err, operation: "personal_configuration.propose", siloId: command.siloId, sourceRunId: command.sourceRunId }, "Personal configuration proposal persistence failed");
			return _isProvenanceConflict(err) ? { status: "provenance_conflict" } : { status: "persistence_unavailable" };
		}
	}
}

/** Recognise the database's explicit business-fence rejection without exposing database details. */
function _isProvenanceConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P0001";
}
