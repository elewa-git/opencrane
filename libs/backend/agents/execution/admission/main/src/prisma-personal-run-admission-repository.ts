import { AgentRunState, AgentServiceKind, ConversationLifecycle, ConversationMode, OrgMemberStatus, type Prisma } from "@prisma/client";

import { PersonalRunIdempotencyOutcomes } from "./personal-run-admission.types";
import type { PersonalRunAdmissionCommand, PersonalRunAdmissionReadRepository, PersonalRunIdempotencyResult, PersonalRunConversationAuthority } from "./personal-run-admission.types";

/**
 * Reads the idempotency key and the caller's conversation with Prisma, inside one transaction.
 *
 * Takes a transaction client, not a Prisma client, so all three of its reads see the same snapshot
 * of the database. None of them grants access: the assembler re-checks the conversation inside its
 * own transaction, so a stale answer here can only cost a queue slot.
 *
 * Constructed per call by {@link PrismaPersonalRunAdmissionUnitOfWork}.
 *
 * @implements PersonalRunAdmissionReadRepository
 */
export class PrismaPersonalRunAdmissionRepository implements PersonalRunAdmissionReadRepository
{
	/** The serializable transaction the caller opened. */
	private readonly prisma: Prisma.TransactionClient;

	/** Binds every read to the transaction the Unit of Work opened. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Looks up this idempotency key in the caller's transaction. */
	async resolve(command: PersonalRunAdmissionCommand): Promise<PersonalRunIdempotencyResult>
	{
		const existing = await this.prisma.agentRun.findUnique({
			where: { siloId_requestIdempotencyKey: { siloId: command.siloId, requestIdempotencyKey: command.requestIdempotencyKey } },
			select: { id: true, conversationId: true, delegatedUserId: true, trigger: true, inputSnapshot: { select: { id: true } } },
		});
		if (existing === null) return { outcome: PersonalRunIdempotencyOutcomes.NotFound };
		if (existing.conversationId !== command.conversationId || existing.delegatedUserId !== command.executionSubjectId || existing.trigger !== "Interactive" || existing.inputSnapshot === null) return { outcome: PersonalRunIdempotencyOutcomes.Conflict };
		return { outcome: PersonalRunIdempotencyOutcomes.Idempotent, runId: existing.id };
	}

	/** Finds the open personal agent session the caller takes part in, reading in the caller's transaction. */
	async resolveConversation(command: PersonalRunAdmissionCommand): Promise<PersonalRunConversationAuthority | null>
	{
		const conversation = await this.prisma.conversation.findFirst({
			where: { id: command.conversationId, siloId: command.siloId, mode: ConversationMode.AgentSession, lifecycle: ConversationLifecycle.Open, participants: { some: { userId: command.executionSubjectId, accessEndedPosition: null } } },
			select: { agentServiceId: true },
		});
		if (conversation === null || conversation.agentServiceId === null) return null;
		const service = await this.prisma.agentService.findFirst({ where: { id: conversation.agentServiceId, siloId: command.siloId, kind: AgentServiceKind.Personal }, select: { id: true } });
		return service === null ? null : { agentServiceId: service.id };
	}

	/**
	 * Returns whether the caller's conversation, still open to them, already has a run in progress.
	 *
	 * Re-checks org membership and participation first, so a user who has lost access does not learn
	 * whether a run exists.
	 *
	 * @param command - The admission command.
	 * @returns True when an unfinished run already owns the conversation. The caller uses this to turn
	 * an unclassified commit failure into an `active_run` refusal; false leaves the original failure.
	 */
	async hasActiveConversationRun(command: PersonalRunAdmissionCommand): Promise<boolean>
	{
		const membership = await this.prisma.orgMembership.findFirst({ where: { clusterTenant: command.siloId, subject: command.executionSubjectId, status: OrgMemberStatus.Active }, select: { clusterTenant: true } });
		if (membership === null) return false;
		const conversation = await this.prisma.conversation.findFirst({
			where: {
				id: command.conversationId,
				siloId: command.siloId,
				mode: ConversationMode.AgentSession,
				lifecycle: ConversationLifecycle.Open,
				participants: { some: { userId: command.executionSubjectId, accessEndedPosition: null } },
				runs: { some: { state: { notIn: [AgentRunState.Completed, AgentRunState.Failed, AgentRunState.Cancelled] } } },
			},
			select: { id: true },
		});
		return conversation !== null;
	}
}
