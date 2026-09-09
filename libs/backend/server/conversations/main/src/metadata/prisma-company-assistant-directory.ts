import type { PrismaClient } from "@prisma/client";
import { PrismaManagedAgentConversationResolver, type ManagedAgentConversationCandidate, type ManagedAgentConversationDependencies } from "@opencrane/backend/server/agents/agent-services";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { ConversationCaller } from "../authorization/conversation-caller.types";

/** Resolves the available company assistants inside their current database snapshot. */
export class PrismaCompanyAssistantDirectory
{
	/** Shares the release profile and managed identity evidence with child admission. */
	public constructor(private readonly prisma: PrismaClient, private readonly dependencies: ManagedAgentConversationDependencies) {}

	/** Returns the assistants the caller may currently invoke. */
	public list(caller: ConversationCaller): Promise<readonly ManagedAgentConversationCandidate[]>
	{
		const dependencies = this.dependencies;
		return ___RunInPrismaUnitOfWork(this.prisma, function _ReadDirectory(transaction)
		{
			return new PrismaManagedAgentConversationResolver(transaction, dependencies).list(caller);
		}, { isolationLevel: "ReadCommitted", operation: "company assistant directory" });
	}
}
