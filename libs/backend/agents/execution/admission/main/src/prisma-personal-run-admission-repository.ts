import { AgentServiceKind, ConversationThreadState, type Prisma } from "@prisma/client";

import { PersonalRunIdempotencyOutcomes } from "./personal-run-admission.types.js";
import type { PersonalRunAdmissionCommand, PersonalRunAdmissionReadRepository, PersonalRunIdempotencyResult, PersonalRunThreadAuthority } from "./personal-run-admission.types.js";

/** Transaction-scoped Prisma reader for durable duplicate and participant-thread authority. */
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
			select: { id: true, threadId: true, delegatedUserId: true, trigger: true, inputSnapshot: { select: { id: true } } },
		});
		if (existing === null) return { outcome: PersonalRunIdempotencyOutcomes.NotFound };
		if (existing.threadId !== command.threadId || existing.delegatedUserId !== command.executionSubjectId || existing.trigger !== "Interactive" || existing.inputSnapshot === null) return { outcome: PersonalRunIdempotencyOutcomes.Conflict };
		return { outcome: PersonalRunIdempotencyOutcomes.Idempotent, runId: existing.id };
	}

	/** Resolve one active participant-bound personal service from the caller-owned transaction. */
	async resolveThread(command: PersonalRunAdmissionCommand): Promise<PersonalRunThreadAuthority | null>
	{
		const thread = await this.prisma.conversationThread.findFirst({
			where: { id: command.threadId, siloId: command.siloId, state: ConversationThreadState.Active, participants: { some: { userId: command.executionSubjectId } } },
			select: { agentServiceId: true },
		});
		if (thread === null) return null;
		const service = await this.prisma.agentService.findFirst({ where: { id: thread.agentServiceId, siloId: command.siloId, kind: AgentServiceKind.Personal }, select: { id: true } });
		return service === null ? null : { agentServiceId: service.id };
	}
}
