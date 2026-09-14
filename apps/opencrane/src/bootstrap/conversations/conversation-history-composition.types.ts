import type { Router } from "express";

/** Public capability routers that share the process's participant history authority. */
export interface ConversationHistoryComposition
{
	/** Conversation directory, messages, child work and current participant reads. */
	readonly conversations: Router;
	/** Existing-dataset memory commands and authorized saved-operation reads. */
	readonly memory: Router;
}
