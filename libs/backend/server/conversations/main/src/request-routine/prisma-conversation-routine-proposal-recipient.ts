import { Prisma, PrincipalProvenance, type PrismaClient } from "@prisma/client";

import type { ConversationRoutineProposalNotificationCommand, ConversationRoutineProposalRecipientReader } from "../computers/turns/request-routine/conversation-request-routine.types";
import { PrismaRequestRoutineProposalSourceAuthority } from "./prisma-request-routine-proposal-source-authority";

/** Resolves the requester to the participant subject after current access is re-authorized. */
export class PrismaConversationRoutineProposalRecipientReader implements ConversationRoutineProposalRecipientReader
{
	public constructor(private readonly _prisma: PrismaClient) {}

	public async readCurrent(command: ConversationRoutineProposalNotificationCommand): Promise<{ readonly participantId: string } | null>
	{
		return this._prisma.$transaction(async transaction =>
		{
			const source = { siloId: command.siloId, sourceConversationId: command.sourceConversationId, runId: command.runId, attempt: command.attempt, ordinal: command.ordinal, requesterPrincipalId: command.requesterPrincipalId };
			if (await new PrismaRequestRoutineProposalSourceAuthority(transaction).authorizeRequesterAccess(source) === null)
				return null;
			const principal = await transaction.principal.findFirst({ where: { id: command.requesterPrincipalId, siloId: command.siloId, provenance: PrincipalProvenance.External }, select: { subject: true } });
			return principal === null ? null : { participantId: principal.subject };
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}
