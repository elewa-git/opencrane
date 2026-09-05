import { ConversationAssetState, type Prisma } from "@prisma/client";

import { ConversationAssetScanLifecycleStates, type ConversationAssetScanLifecycleRepository } from "@opencrane/backend/server/agents/artifacts";

/** Applies scanner verdicts to participant-uploaded conversation assets. */
export class PrismaConversationAssetScanRepository implements ConversationAssetScanLifecycleRepository
{
	private readonly transaction: Prisma.TransactionClient;

	/** Binds scanner updates to the caller-owned artifact transaction. */
	constructor(transaction: Prisma.TransactionClient) { this.transaction = transaction; }

	/** Moves one quarantined conversation asset to the scanner-selected terminal state. */
	async report(command: { readonly revisionId: string; readonly state: ConversationAssetScanLifecycleStates; readonly failureCode: "unsafe_file" | "scan_failed" | null }): Promise<void>
	{
		const state = command.state === ConversationAssetScanLifecycleStates.Ready ? ConversationAssetState.Ready : ConversationAssetState.Failed;
		await this.transaction.conversationAsset.updateMany({
			where: { revisionId: command.revisionId, state: ConversationAssetState.Processing },
			data: { state, failureCode: command.failureCode },
		});
	}
}
