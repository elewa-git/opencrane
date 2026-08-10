import { AgentRunState, AgentServiceKind, ConversationLifecycle, ConversationMode, OrgMemberStatus, type Prisma } from "@prisma/client";

import { PersonalRunIdempotencyOutcomes } from "./personal-run-admission.types.js";
import type { PersonalRunAdmissionCommand, PersonalRunAdmissionReadRepository, PersonalRunIdempotencyResult, PersonalRunConversationAuthority } from "./personal-run-admission.types.js";

/** Transaction-scoped Prisma reader for durable duplicate and participant-conversation authority. */
export class PrismaPersonalRunAdmissionRepository implements PersonalRunAdmissionReadRepository
{
	/** Caller-owned serializable admission transaction. */
	private readonly prisma: Prisma.TransactionClient;

	/** Bind every read to the Unit of Work's exact transaction snapshot. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Resolve one durable duplicate from the caller-owned transaction. */
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

	/** Resolve one open participant-bound personal agent session from the caller-owned transaction. */
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

	/** Reclassifies only an active-run conflict on the exact still-authorized personal conversation. */
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
