import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { ExecutionSubject } from "@opencrane/models/agents";

import type { SessionAssemblyCommand, SessionAssemblyLoad, ConversationContextInput, ConversationContextRepositoryFactory, ConversationContextSource } from "./session-assembly.types";

/**
 * Runs the conversation read inside the admission transaction session assembly passes in.
 *
 * Holds a factory rather than a database client, so it can be constructed once at startup while
 * every read still happens inside the transaction admission opened. That is the only reason this
 * class exists — {@link PrismaConversationContextRepository} does the actual reading.
 *
 * @implements ConversationContextSource
 */
export class TransactionBoundConversationContextSource implements ConversationContextSource
{
	/** Makes a conversation reader bound to one transaction. */
	private readonly createRepository: ConversationContextRepositoryFactory;

	/** Creates the source. It holds no top-level database client. */
	constructor(createRepository: ConversationContextRepositoryFactory)
	{
		this.createRepository = createRepository;
	}

	/** Returns no messages for non-conversational work; otherwise only completed messages the caller may see. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, executionSubject: ExecutionSubject, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ConversationContextInput>>
	{
		return this.createRepository(transaction).load(command, run, executionSubject);
	}
}
