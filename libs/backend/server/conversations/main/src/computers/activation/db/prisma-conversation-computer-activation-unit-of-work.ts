import type { Prisma, PrismaClient } from "@prisma/client";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { ConversationComputerActivationCommand, ConversationComputerActivationProjection, ConversationComputerActivationProjectionRepository, ConversationComputerActiveLeaseProjectionCommand } from "../conversation-computer-activation.types";
import { PrismaConversationComputerActivationProjectionRepository } from "./prisma-conversation-computer-activation-repository";

/** Owns the transaction isolation used to resolve activation and publish its active lease. */
export class PrismaConversationComputerActivationUnitOfWork implements ConversationComputerActivationProjectionRepository
{
	/** Keeps transaction creation outside the projection repository. */
	public constructor(private readonly prisma: PrismaClient) {}

	/** Resolves immutable activation coordinates against the current committed projection. */
	public resolve(command: ConversationComputerActivationCommand): Promise<ConversationComputerActivationProjection | null>
	{
		return this._transaction(repository => repository.resolve(command), "ReadCommitted", "conversation computer activation projection");
	}

	/** Publishes the admitted lease while competing changes remain serialised. */
	public publishActiveLease(command: ConversationComputerActiveLeaseProjectionCommand): Promise<void>
	{
		return this._transaction(repository => repository.publishActiveLease(command), "Serializable", "conversation computer active lease projection");
	}

	/** Constructs the projection repository from the transaction selected for this operation. */
	private _transaction<Result>(work: (repository: ConversationComputerActivationProjectionRepository) => Promise<Result>, isolationLevel: Prisma.TransactionIsolationLevel, operation: string): Promise<Result>
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Transaction(transaction)
		{
			return work(new PrismaConversationComputerActivationProjectionRepository(transaction));
		}, { isolationLevel, operation });
	}
}
