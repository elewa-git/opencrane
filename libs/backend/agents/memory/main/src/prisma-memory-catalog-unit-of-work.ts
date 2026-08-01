import { Prisma, type PrismaClient } from "@prisma/client";

import { __MemoryCatalogCorrectionConflictError } from "./memory-catalog-errors.js";
import type { AtomicRecordMemoryFactResult, MemoryCatalogCollisionRepository, MemoryCatalogTransaction, MemoryCatalogUnitOfWork, MemoryCatalogWork, RecordMemoryFactCommand } from "./memory-catalog.types.js";
import { PrismaMemoryCatalogCollisionRepository } from "./prisma-memory-catalog-collision-repository.js";
import { PrismaMemoryCatalogRepository } from "./prisma-memory-catalog-repository.js";

/** Maximum complete catalog-delivery attempts after a transaction conflict rolls back. */
const _CATALOG_ATTEMPT_LIMIT = 3;

/** Prisma conflict codes that prove the complete catalog transaction rolled back before retry. */
const _RETRYABLE_CATALOG_CONFLICT_CODES = new Set(["P2034"]);

/** Prisma unit of work that commits one generic fact catalog row and its outbox intent together. */
export class PrismaMemoryCatalogUnitOfWork implements MemoryCatalogUnitOfWork
{
	/** Canonical product database client from the server composition boundary. */
	private readonly prisma: PrismaClient;
	/** Committed-state repository used only after a uniqueness collision rolls back. */
	private readonly collisions: MemoryCatalogCollisionRepository;

	/** Creates the unit of work over the canonical product database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
		this.collisions = new PrismaMemoryCatalogCollisionRepository(prisma);
	}

	/** Runs work at serializable isolation and retries only complete known conflict rollbacks. */
	async run(command: RecordMemoryFactCommand, work: MemoryCatalogWork): Promise<AtomicRecordMemoryFactResult>
	{
		for (let attempt = 1; attempt <= _CATALOG_ATTEMPT_LIMIT; attempt += 1)
		{
			try
			{
				// 1. Bind catalog writes to one transaction so metadata cannot commit without its outbox intent.
				return await this.prisma.$transaction(async function _RunCatalogTransaction(transaction): Promise<AtomicRecordMemoryFactResult>
				{
					const repositories: MemoryCatalogTransaction = { catalog: new PrismaMemoryCatalogRepository(transaction) };
					return work(repositories);
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			}
			catch (error)
			{
				// 2. Translate the correction trigger only after Prisma confirms the whole transaction rolled back.
				if (_IsCorrectionConflict(error)) throw new __MemoryCatalogCorrectionConflictError(error);

				// 3. Resolve a rolled-back unique collision against committed idempotency evidence without retrying the write.
				if (_IsUniqueCatalogConflict(error)) return this._ResolveUniqueCollision(command);

				// 4. Retry only a rolled-back serialization conflict while a fresh complete attempt remains.
				if (_IsRetryableCatalogConflict(error) && attempt < _CATALOG_ATTEMPT_LIMIT) continue;

				// 5. Preserve unexpected failures and exhausted conflicts for the caller's fail-closed boundary.
				throw error;
			}
		}
		throw new Error("memory catalog unit of work exhausted without a result");
	}

	/** Re-reads committed evidence after rollback and accepts only an exact idempotent delivery. */
	private async _ResolveUniqueCollision(command: RecordMemoryFactCommand): Promise<AtomicRecordMemoryFactResult>
	{
		return this.collisions.resolveUniqueCollision(command);
	}
}

/** Returns whether a complete transaction rolled back on any catalog uniqueness constraint. */
function _IsUniqueCatalogConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Returns whether Prisma confirms no partial catalog metadata or outbox intent committed. */
function _IsRetryableCatalogConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && _RETRYABLE_CATALOG_CONFLICT_CODES.has(error.code);
}

/** Returns whether PostgreSQL rejected a correction whose predecessor is no longer active. */
function _IsCorrectionConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError
		&& error.code === "P0001"
		&& error.message.includes("memory correction must supersede an active fact");
}
