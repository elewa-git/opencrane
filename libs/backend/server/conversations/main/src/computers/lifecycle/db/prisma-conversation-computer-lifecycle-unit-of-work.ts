import type { PrismaClient } from "@prisma/client";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { ConversationComputerActiveLeaseProjectionCommand } from "../../activation/conversation-computer-activation.types";
import type { ConversationComputerAttemptActivity, ConversationComputerLeaseProjectionCommand } from "../conversation-computer-lifecycle.types";
import { PrismaConversationComputerLifecycleProjectionRepository } from "./prisma-conversation-computer-lifecycle-projection-repository";

/** Owns serialisable active-lease renewal and clearing across lifecycle operations. */
export class PrismaConversationComputerLifecycleUnitOfWork implements ConversationComputerAttemptActivity
{
	/** Keeps transaction creation outside the projection repository. */
	public constructor(private readonly prisma: PrismaClient) {}

	/** Clears the lease only while its exact generation has no protected activity. */
	public clearActiveLease(command: ConversationComputerLeaseProjectionCommand): Promise<boolean>
	{
		return this._transaction(repository => repository.clearActiveLease(command), "conversation computer active lease clear");
	}

	/** Extends only the currently admitted active lease generation. */
	public extendActiveLease(command: ConversationComputerActiveLeaseProjectionCommand): Promise<boolean>
	{
		return this._transaction(repository => repository.extendActiveLease(command), "conversation computer active lease renewal");
	}

	/** Constructs the lease repository inside the serialisable transaction shared by both writes. */
	private _transaction(work: (repository: ConversationComputerAttemptActivity) => Promise<boolean>, operation: string): Promise<boolean>
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Transaction(transaction)
		{
			return work(new PrismaConversationComputerLifecycleProjectionRepository(transaction));
		}, { isolationLevel: "Serializable", operation });
	}
}
