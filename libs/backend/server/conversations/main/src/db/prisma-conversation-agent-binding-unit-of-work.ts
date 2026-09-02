import { Prisma, type PrismaClient } from "@prisma/client";

import { ConversationAgentBindingAuthority } from "../conversation-agent-binding-authority";
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
		return this.prisma.$transaction(async transaction => new ConversationAgentBindingAuthority(new PrismaConversationAgentBindingRepository(transaction), this.dependencies).bind(command), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}
