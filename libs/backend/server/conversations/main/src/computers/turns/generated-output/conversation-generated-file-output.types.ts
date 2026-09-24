import type { FrozenConversationComputerTurn } from "../conversation-computer-turn.types";

/**
 * Links a published file to the exact answer already saved by the turn's atomic history commit.
 * The file owner reloads the saved turn and derives every message and Artifact coordinate from it.
 * A failed or uncertain link must retry that answer before run completion, never request a new one.
 */
export interface ConversationGeneratedFileOutputLinker
{
	/** Recheck a new link's authority, or recognize the exact link already committed on a prior try. */
	link(turn: FrozenConversationComputerTurn): Promise<void>;
}
