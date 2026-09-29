import { Prisma, type PrismaClient } from "@prisma/client";

import type { RequestRoutineProposalSource } from "@opencrane/backend/server/agents/scheduling/contract";
import { ___ExecutionSubjectSchema } from "@opencrane/contracts";

import type { ConversationRequestRoutineSourceResolver } from "../computers/turns/request-routine/conversation-request-routine.types";
import type { FrozenConversationComputerTurn } from "../computers/turns/conversation-computer-turn.types";

/** Derives proposal source coordinates from the admitted run rather than model arguments. */
export class PrismaConversationRequestRoutineSourceResolver implements ConversationRequestRoutineSourceResolver
{
	public constructor(private readonly _prisma: PrismaClient) {}

	public async resolve(turn: FrozenConversationComputerTurn, ordinal: number): Promise<RequestRoutineProposalSource | null>
	{
		return this._prisma.$transaction(async transaction =>
		{
			const run = await transaction.agentRun.findFirst({ where: { id: turn.compile.runId, siloId: turn.siloId, conversationId: turn.binding.conversationId, attempt: turn.compile.attempt }, select: { executionSubject: true } });
			if (run === null)
				return null;
			const subject = ___ExecutionSubjectSchema.safeParse(run.executionSubject);
			if (!subject.success)
				return null;
			return { siloId: turn.siloId, sourceConversationId: turn.binding.conversationId, runId: turn.compile.runId, attempt: turn.compile.attempt, ordinal, requesterPrincipalId: subject.data.requester.requesterPrincipalId };
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}
