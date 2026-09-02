import { Prisma, type PrismaClient } from "@prisma/client";

import { ConversationAgentBindingResolver } from "../conversation-agent-binding-authority";
import type { ConversationAgentBindingAuthority as ConversationAgentBindingAuthorityPort, ConversationAgentBindingAuthorityDependencies, ConversationAgentBindingCommand, ConversationAgentBindingResult } from "../conversation-agent-binding.types";
import { PrismaConversationAgentBindingRepository } from "./prisma-conversation-agent-binding-repository";

/** Opens the serializable snapshot that binds one active service, revision, and managed Principal. */
export class PrismaConversationAgentBindingUnitOfWork implements ConversationAgentBindingAuthorityPort
{
	/** Opens the authority transaction over the OpenCrane product database. */
	public constructor(private readonly prisma: PrismaClient, private readonly dependencies: ConversationAgentBindingAuthorityDependencies) {}

	/** Resolves the binding inside one serializable snapshot before later creation persists its history anchors. */
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
