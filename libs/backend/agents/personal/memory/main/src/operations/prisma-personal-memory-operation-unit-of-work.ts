import type { PrismaClient } from "@prisma/client";

import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import { PrismaPersonalMemoryOperationRepository } from "./prisma-personal-memory-operation-repository";
import type { PersonalMemoryOperationPersistenceResult, PersonalMemoryOperationUnitOfWork } from "./personal-memory-operation-persistence.types";
import type { PersonalMemoryOperationEvent } from "./personal-memory-operation.types";

/**
 * Opens personal-memory lifecycle transactions and creates the repository inside each attempt.
 *
 * Admission belongs to the composite conversation transaction that also admits its workflow task.
 * This wrapper remains only for lifecycle updates that do not require another transaction owner.
 */
export class PrismaPersonalMemoryOperationUnitOfWork implements PersonalMemoryOperationUnitOfWork
{
	/** Root Prisma client used only to open a fresh transaction attempt. */
	private readonly prisma: PrismaClient;

	/** Creates the operation transaction boundary. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** @inheritdoc */
	async apply(event: PersonalMemoryOperationEvent, recordedAt: Date): Promise<PersonalMemoryOperationPersistenceResult>
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Apply(transaction)
		{
			const repository = new PrismaPersonalMemoryOperationRepository(transaction);
			return repository.apply(event, recordedAt);
		}, { isolationLevel: "Serializable", attemptLimit: 3, operation: "personal-memory operation lifecycle" });
	}
}
