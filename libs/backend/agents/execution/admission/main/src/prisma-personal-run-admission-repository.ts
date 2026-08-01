import { AgentServiceKind, ConversationThreadState, type PrismaClient } from "@prisma/client";

import { PersonalRunIdempotencyOutcomes } from "./personal-run-admission.types.js";
import type { PersonalRunAdmissionCommand, PersonalRunAdmissionRepository, PersonalRunIdempotencyResult, PersonalRunThreadAuthority } from "./personal-run-admission.types.js";

/** Prisma repository for durable personal admission duplicate and participant-thread authority. */
export class PrismaPersonalRunAdmissionRepository implements PersonalRunAdmissionRepository
{
	/** OpenCrane product database client. */
	private readonly prisma: PrismaClient;

	/** Creates the repository over the server's app-owned Prisma client. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Returns a durable duplicate outcome before any current mutable thread eligibility is read. */
	async resolve(command: PersonalRunAdmissionCommand): Promise<PersonalRunIdempotencyResult>
	{
		const existing = await this.prisma.agentRun.findUnique({
			where: { siloId_requestIdempotencyKey: { siloId: command.siloId, requestIdempotencyKey: command.requestIdempotencyKey } },
			select: { id: true, threadId: true, delegatedUserId: true, trigger: true, inputSnapshot: { select: { id: true } } },
		});
		if (existing === null) return { outcome: PersonalRunIdempotencyOutcomes.NotFound };
		if (existing.threadId !== command.threadId || existing.delegatedUserId !== command.executionSubjectId || existing.trigger !== "Interactive" || existing.inputSnapshot === null)
		{
			return { outcome: PersonalRunIdempotencyOutcomes.Conflict };
		}
		return { outcome: PersonalRunIdempotencyOutcomes.Idempotent, runId: existing.id };
	}

	/** Resolves only an active conversation whose participant and personal service match the caller's silo. */
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
