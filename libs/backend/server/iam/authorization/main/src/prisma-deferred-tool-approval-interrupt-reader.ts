import type { PrismaClient } from "@prisma/client";

import { RunEventTypes, type AgUiProjectionSourceEvent, type AgUiPublicEventPayload } from "@opencrane/contracts";

import { PrismaSelfDeferredToolApprovalReadUnitOfWork } from "./prisma-self-deferred-tool-approval-list-repository.js";
import type { DeferredToolApprovalInterruptReader } from "./deferred-tool-approval.types.js";

/** Compose a safe actor-only AG-UI interrupt projection over the approval authority. */
export function _CreateDeferredToolApprovalInterruptReader(prisma: PrismaClient): DeferredToolApprovalInterruptReader
{
	const approvals = new PrismaSelfDeferredToolApprovalReadUnitOfWork(prisma);
	return {
		async readOpen(command): Promise<readonly AgUiProjectionSourceEvent[]>
		{
			const pending = await approvals.listPendingOwnedForConversation(command.conversationId, command.siloId, command.subjectId, new Date());
			return pending.map(function _project(approval): AgUiProjectionSourceEvent
			{
				if (approval.responseSchema === null || typeof approval.responseSchema !== "object" || Array.isArray(approval.responseSchema)) throw new Error("deferred approval response schema is not an object");
				const responseSchema = approval.responseSchema as NonNullable<AgUiPublicEventPayload["interrupt"]>["responseSchema"];
				return {
					conversationId: command.conversationId,
					runId: approval.runId,
					position: "0",
					eventType: RunEventTypes.ToolApprovalRequired,
					occurredAt: approval.createdAt,
					payload: { interrupt: { id: approval.approvalRequestId, reason: "tool_approval", toolCallId: approval.toolInvocationId, responseSchema, expiresAt: approval.expiresAt } },
				};
			});
		},
	};
}
