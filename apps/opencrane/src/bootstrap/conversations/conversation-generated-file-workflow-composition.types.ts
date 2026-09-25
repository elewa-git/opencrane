import type { Prisma } from "@prisma/client";

import type { ConversationGeneratedFileResultRepositoryFactory, ConversationGeneratedFileOutputLinker } from "@opencrane/backend/server/conversations";
import type { ConversationAssetScanLifecycleRepository } from "@opencrane/backend/server/agents/artifacts";

/** Shares generated-file progression with the scanner and the conversation output owners. */
export interface ConversationGeneratedFileWorkflowComposition
{
	/** Builds the file outcome reader on the transaction that reads the original tool result. */
	readonly resultReader: ConversationGeneratedFileResultRepositoryFactory;

	/** Links the saved generated attachment before the original turn completes. */
	readonly outputLinker: ConversationGeneratedFileOutputLinker;

	/** Builds the asset and generated-file repositories on the scanner's transaction. */
	scanAssets(transaction: Prisma.TransactionClient): ConversationAssetScanLifecycleRepository;
}
