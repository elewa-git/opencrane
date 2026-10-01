import type { FrozenConversationComputerTurn } from "@opencrane/backend/server/conversations";

/** Transaction-bound owner of one generated asset's exact saved-message link. */
export interface GeneratedFileOutputLinkRepository
{
	/** Recover the exact link or create it once while current execution authority remains. */
	link(turn: FrozenConversationComputerTurn): Promise<void>;
}
