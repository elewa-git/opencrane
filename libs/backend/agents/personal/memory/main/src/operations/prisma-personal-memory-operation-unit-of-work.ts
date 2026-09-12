import type { PrismaClient } from "@prisma/client";

import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import { PrismaPersonalMemoryOperationRepository } from "./prisma-personal-memory-operation-repository";
import type { AdmitPersonalMemoryOperationCommand, PersonalMemoryOperationAdmissionResult, PersonalMemoryOperationPersistenceResult, PersonalMemoryOperationUnitOfWork } from "./personal-memory-operation-persistence.types";
import type { PersonalMemoryOperationEvent } from "./personal-memory-operation.types";

/**
 * Opens personal-memory operation transactions and creates the repository inside each attempt.
 *
 * Proven full rollbacks may retry the complete idempotent database operation. No provider or
 * workflow call belongs inside this persistence-only envelope. The reserved task identity saved in
 * the operation is therefore evidence for later composition, rather than proof that Absurd admitted
 * a task atomically with this row.
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
	async admit(command: AdmitPersonalMemoryOperationCommand): Promise<PersonalMemoryOperationAdmissionResult>
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Admit(transaction)
		{
			const repository = new PrismaPersonalMemoryOperationRepository(transaction);
			return repository.admit(command);
		}, { isolationLevel: "Serializable", attemptLimit: 3, operation: "personal-memory operation admission" });
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
