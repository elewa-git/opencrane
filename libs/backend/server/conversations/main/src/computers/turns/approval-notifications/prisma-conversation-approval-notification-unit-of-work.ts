import { ApprovalRequestState, Prisma, type PrismaClient } from "@prisma/client";

import { PrismaElicitationRepository } from "@opencrane/backend/agents/execution/elicitation";
import { ElicitationPurposes, ElicitationRequestStates, type ConversationElicitation } from "@opencrane/contracts";

import type { ConversationApprovalNotificationCommand, ConversationApprovalNotificationRequestReader } from "./conversation-approval-notification.types";

/** Resolves a requested approval through the existing participant and product-read authority. */
export class PrismaConversationApprovalNotificationUnitOfWork implements ConversationApprovalNotificationRequestReader
{
	/** Bind notification reads to the application Prisma transaction owner. */
	public constructor(private readonly _prisma: PrismaClient) {}

	/** Return only the exact current request and linked pending approval for this frozen turn. */
	public async readCurrent(command: ConversationApprovalNotificationCommand, now: Date): Promise<ConversationElicitation | null>
	{
		return this._prisma.$transaction(async function _Read(transaction)
		{
			const repository = new PrismaConversationApprovalNotificationRepository(transaction);
			return repository.readCurrent(command, now);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
	}
}

/** Transaction-bound current approval reader used only by the notification unit of work. */
class PrismaConversationApprovalNotificationRepository implements ConversationApprovalNotificationRequestReader
{
	public constructor(private readonly _transaction: Prisma.TransactionClient) {}

	/** Apply existing owned-read authority and exact approval linkage in one snapshot. */
	public async readCurrent(command: ConversationApprovalNotificationCommand, now: Date): Promise<ConversationElicitation | null>
	{
		const coordinate = await this._transaction.elicitationRequest.findUnique({ where: { id: command.approvalId }, select: { assignedParticipantId: true } });
		if (coordinate === null)
			return null;
		const elicitations = new PrismaElicitationRepository(this._transaction);
		const request = await elicitations.readOwned(command.siloId, command.conversationId, command.approvalId, coordinate.assignedParticipantId, now);
		if (request === null || request.requestId !== command.approvalId || request.runId !== command.runId || request.attempt !== command.attempt
			|| request.purpose !== ElicitationPurposes.ToolApproval || request.state !== ElicitationRequestStates.Requested)
			return null;
		const approval = await this._transaction.approvalRequest.findUnique({ where: { id: command.approvalId }, select: { runId: true, attempt: true, elicitationRequestId: true, toolInvocation: { select: { toolInvocationId: true } }, state: true } });
		if (approval === null || approval.runId !== command.runId || approval.attempt !== command.attempt || approval.elicitationRequestId !== request.requestId
			|| approval.toolInvocation.toolInvocationId !== command.approvalId || approval.state !== ApprovalRequestState.Pending)
			return null;
		return request;
	}
}
