import type { ConversationProjectionReadResult, ReadConversationProjectionCommand } from "@opencrane/backend/conversations/projection";

/** Holds the immutable bounds an authorized participant may read from one conversation history. */
export interface ConversationHistoryReplayAccess
{
	/** Opens the participant-visible range at this stream position. */
	readonly visibleFromPosition: bigint;
	/** Closes the participant-visible range at this stream position, or leaves it open. */
	readonly accessEndedPosition: bigint | null;
}

/** Rechecks current membership and participant visibility before immutable history is read or emitted. */
export interface ConversationHistoryReplayAuthorizationRepository
{
	/** Returns the current participant-visible bounds, or `null` when the caller has no access. */
	readAccess(command: ReadConversationProjectionCommand): Promise<ConversationHistoryReplayAccess | null>;
}

/** Read-only transaction boundary exposed to replay transport and projection orchestration. */
export interface ConversationReplayUnitOfWork
{
	/** Rechecks current authority and distinguishes revocation from an empty authorized page. */
	readAuthorized(command: ReadConversationProjectionCommand): Promise<ConversationProjectionReadResult>;
}

/** Transaction-scoped canonical replay persistence capability. */
export interface ConversationReplayRepository
{
	/** Returns rows and the current participant authority result from one transaction. */
	readAuthorized(command: ReadConversationProjectionCommand): Promise<ConversationProjectionReadResult>;
}
