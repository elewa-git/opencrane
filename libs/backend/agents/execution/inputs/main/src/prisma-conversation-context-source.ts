import type { InitialRunAuthority, RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";

import type { SessionAssemblyCommand, SessionAssemblyLoad, ConversationContextInput, ConversationContextRepositoryFactory, ConversationContextSource } from "./session-assembly.types.js";

/** Binds the context read to the exact final-admission transaction supplied by session assembly. */
export class TransactionBoundConversationContextSource implements ConversationContextSource
{
	/** Creates transaction-scoped durable conversation readers. */
	private readonly createRepository: ConversationContextRepositoryFactory;

	/** Creates the source without retaining a root database client. */
	constructor(createRepository: ConversationContextRepositoryFactory)
	{
		this.createRepository = createRepository;
	}

	/** Returns no messages for non-conversational work, otherwise only completed authorized messages. */
	async load(command: SessionAssemblyCommand, run: InitialRunAuthority, transaction: RunAdmissionTransaction): Promise<SessionAssemblyLoad<ConversationContextInput>>
	{
		return this.createRepository(transaction).load(command, run);
	}
}
