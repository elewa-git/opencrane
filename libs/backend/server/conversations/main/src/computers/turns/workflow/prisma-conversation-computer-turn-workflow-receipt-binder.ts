import type { PrismaClient } from "@prisma/client";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import type { ConversationComputerTurnWorkflowReceiptBinder } from "./conversation-computer-turn-workflow-receipt.types";
import { PrismaConversationComputerTurnWorkflowReceiptRepository } from "./prisma-conversation-computer-turn-workflow-receipt-repository";

/** Owns the serialisable transaction that establishes one AgentRun workflow owner. */
export class PrismaConversationComputerTurnWorkflowReceiptUnitOfWork implements ConversationComputerTurnWorkflowReceiptBinder
{
	/** Stores the product client used only to open the binding transaction. */
	public constructor(private readonly prisma: PrismaClient) {}

	/** Bind the exact receipt without replacing a task that already owns this attempt. */
	public bind(runId: string, attempt: number, receipt: IWorkflowTaskReceipt): Promise<boolean>
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Bind(transaction)
		{
			return new PrismaConversationComputerTurnWorkflowReceiptRepository(transaction).bind(runId, attempt, receipt);
		}, { isolationLevel: "Serializable", attemptLimit: 3, operation: "conversation turn workflow receipt binding" });
	}
}

/** Names the receipt-binding UnitOfWork by the narrow role server composition injects. */
export { PrismaConversationComputerTurnWorkflowReceiptUnitOfWork as PrismaConversationComputerTurnWorkflowReceiptBinder };
