import { Prisma, type PrismaClient } from "@prisma/client";

import { ConversationAgentBindingResolver } from "../conversation-agent-binding-authority";
import type { ConversationAgentBindingAuthority as ConversationAgentBindingAuthorityPort, ConversationAgentBindingAuthorityDependencies, ConversationAgentBindingCommand, ConversationAgentBindingResult } from "../conversation-agent-binding.types";
import { PrismaConversationAgentBindingRepository } from "./prisma-conversation-agent-binding-repository";

/**
 * Runs binding resolution in the serializable transaction that owns its service snapshot.
 *
 * A later creation composition can use this public authority port without constructing the
 * repository against the root Prisma client. The transaction contains the service, revision, and
 * Principal read; profile and identity selectors remain injected policy ports because this
 * checkpoint does not own their data.
 * @implements ConversationAgentBindingAuthority
 */
export class PrismaConversationAgentBindingUnitOfWork implements ConversationAgentBindingAuthorityPort
{
	/** Holds the product database client and the non-database authorities used by the resolver. */
	public constructor(private readonly prisma: PrismaClient, private readonly dependencies: ConversationAgentBindingAuthorityDependencies) {}

/**
 * Resolves a binding against one serializable database snapshot.
 *
 * The unit of work builds its repository inside the transaction so the service and active revision
 * cannot be read separately. A returned denial leaves no creation history to persist.
 * @returns A complete binding or the reason the later creation flow must not continue.
 */
	public async bind(command: ConversationAgentBindingCommand): Promise<ConversationAgentBindingResult>
	{
		const dependencies = this.dependencies;
		return this.prisma.$transaction(async function _BindConversationAgent(transaction)
		{
			const repository = new PrismaConversationAgentBindingRepository(transaction);
			const authority = new ConversationAgentBindingResolver(repository, dependencies);
			return authority.bind(command);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}
