import type { ConversationHistoryReader } from "../conversation-history-reader";
import type { ConversationComputerRuntimeCommandAuthority } from "./conversation-computer-runtime-command-authority";

/** Identifies the creation-bound computer whose retained participant inputs may become runtime work. */
export interface ConversationComputerParticipantInputDispatchCommand
{
	/** Names the silo that owns the target conversation and computer. */
	readonly siloId: string;
	/** Names the conversation stream that contains pending participant input entries. */
	readonly conversationId: string;
	/** Names the computer that owns this agent conversation's active execution. */
	readonly computerId: string;
}

/** Connects input dispatch to validated conversation history and execution-fenced command issue. */
export interface ConversationComputerParticipantInputDispatchAuthorityDependencies
{
	/** Replays participant history before the dispatcher selects input entries. */
	readonly conversations: Pick<ConversationHistoryReader, "readCurrent">;
	/** Issues idempotent start-turn commands after it has rechecked the active execution. */
	readonly commands: Pick<ConversationComputerRuntimeCommandAuthority, "issueStartTurn">;
}

/** Reports how many retained input entries the dispatcher offered to the current execution. */
export interface ConversationComputerParticipantInputDispatchResult
{
	/** Counts entries whose idempotency key the command authority accepted or replayed. */
	readonly dispatchedInputCount: number;
}
