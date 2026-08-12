import type { ConversationProjectionReadResult, ReadConversationProjectionCommand } from "@opencrane/backend/conversations/projection";

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
