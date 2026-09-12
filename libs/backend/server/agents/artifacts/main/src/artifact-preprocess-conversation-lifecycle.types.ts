import type { Prisma } from "@prisma/client";

/** Conversation-owned file transitions committed beside the preprocessing job's terminal state. */
export interface ConversationAssetPreprocessLifecycleRepository
{
	/** Makes the source file Ready only after its exact completed text lineage is present. */
	complete(sourceRevisionId: string): Promise<void>;
	/** Makes the source file Failed after the job exhausts its permitted deliveries. */
	fail(sourceRevisionId: string): Promise<void>;
}

/** Binds conversation updates to the transaction already owned by artifact preprocessing. */
export type ConversationAssetPreprocessLifecycleFactory = (transaction: Prisma.TransactionClient) => ConversationAssetPreprocessLifecycleRepository;
