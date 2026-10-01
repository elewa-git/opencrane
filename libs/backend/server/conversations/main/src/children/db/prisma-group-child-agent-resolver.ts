import type { Prisma } from "@prisma/client";
import { PrismaManagedAgentConversationResolver, type ManagedAgentConversationDependencies } from "@opencrane/backend/server/agents/agent-services";

import type { ConversationCaller } from "../../authorization/conversation-caller.types";
import type { GroupChildAgentCandidate, GroupChildAgentResolver } from "../group-child.types";

/** Resolves a company assistant inside the transaction that admits the child request. */
export class PrismaGroupChildAgentResolver implements GroupChildAgentResolver<Prisma.TransactionClient>
{
	/** Binds managed identity history and the release-selected profile map. */
	public constructor(private readonly dependencies: ManagedAgentConversationDependencies) {}

	/** Rechecks the selected company's invocation evidence in the caller's transaction. */
	public resolve(transaction: Prisma.TransactionClient, caller: ConversationCaller, agentServiceId: string): Promise<GroupChildAgentCandidate | null>
	{
		return new PrismaManagedAgentConversationResolver(transaction, this.dependencies).resolve(caller, agentServiceId);
	}
}
