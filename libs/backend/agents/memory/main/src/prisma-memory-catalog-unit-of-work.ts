import { Prisma, type PrismaClient } from "@prisma/client";

import { __MemoryCatalogCorrectionConflictError } from "./memory-catalog-errors";
import type { AtomicRecordMemoryFactResult, MemoryCatalogTransaction, MemoryCatalogUnitOfWork, MemoryCatalogWork, RecordMemoryFactCommand } from "./memory-catalog.types";
import { PrismaMemoryCatalogCollisionRepository } from "./prisma-memory-catalog-collision-repository";
import { PrismaMemoryCatalogRepository } from "./prisma-memory-catalog-repository";

/** How many times the whole catalog write may be attempted after a conflict rolls it back. */
const _CATALOG_ATTEMPT_LIMIT = 3;

/** Prisma conflict codes that prove the complete catalog transaction rolled back before retry. */
const _RETRYABLE_CATALOG_CONFLICT_CODES = new Set(["P2034"]);

/**
 * Runs catalog work in one Serializable transaction, so a fact row and its outbox event commit
 * together or not at all.
 *
 * Owns everything about failure that the work function must not attempt itself: a bounded
 * retry after a conflict rolls the transaction back, translating the database's correction
 * rejection into an owned error, and reading committed state after a unique-constraint failure
 * to tell a harmless repeat from a reused key.
 *
 * Constructed by: nothing outside this package yet — no file imports
 * `@opencrane/backend/agents/memory`.
 *
 * @implements MemoryCatalogUnitOfWork
 */
export class PrismaMemoryCatalogUnitOfWork implements MemoryCatalogUnitOfWork
{
	/** Canonical product database client from the server composition boundary. */
	private readonly prisma: PrismaClient;
	/** Creates the unit of work over the canonical product database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/**
	 * Runs the work at Serializable isolation, retrying only failures that rolled the whole
	 * transaction back.
	 *
	 * A retry builds a fresh repository against the new transaction, so no state from the failed
	 * attempt leaks into the next one. A unique-constraint failure is never retried — the write
	 * would fail the same way — and is resolved against committed state instead.
	 *
	 * @param command - The fact being recorded, needed to resolve a post-rollback collision.
	 * @param work - Runs once per attempt, so it must be safe to repeat.
	 * @returns The work's own result, or `Idempotent`/`Conflict` decided from committed state
	 * after a unique-constraint rollback.
	 * @throws __MemoryCatalogCorrectionConflictError when the database rejected a correction
	 * whose predecessor is no longer active; the transaction has already rolled back.
	 * @throws Error for any unexpected failure, and for a serialization conflict still present
	 * after the last of three attempts, so the caller never treats a lost write as a success.
	 */
	async run(command: RecordMemoryFactCommand, work: MemoryCatalogWork): Promise<AtomicRecordMemoryFactResult>
	{
		for (let attempt = 1; attempt <= _CATALOG_ATTEMPT_LIMIT; attempt += 1)
		{
			try
			{
				// 1. Run every catalog write in one transaction, so the metadata row cannot commit without its outbox event.
				return await this.prisma.$transaction(async function _RunCatalogTransaction(transaction): Promise<AtomicRecordMemoryFactResult>
				{
					const repositories: MemoryCatalogTransaction = { catalog: new PrismaMemoryCatalogRepository(transaction) };
					return work(repositories);
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			}
			catch (error)
			{
				// 2. Turn the database's correction rejection into the domain error, only once Prisma confirms the whole transaction rolled back.
				if (_IsCorrectionConflict(error)) throw new __MemoryCatalogCorrectionConflictError(error);

				// 3. After a unique-constraint rollback, compare against the committed row instead of retrying the write.
				if (_IsUniqueCatalogConflict(error)) return this._ResolveUniqueCollision(command);

				// 4. Retry a serialization conflict only while attempts remain, and only because the transaction rolled back.
				if (_IsRetryableCatalogConflict(error) && attempt < _CATALOG_ATTEMPT_LIMIT) continue;

				// 5. Rethrow anything else, and any conflict left after the last attempt, so the caller fails closed.
				throw error;
			}
		}
		throw new Error("memory catalog unit of work exhausted without a result");
	}

	/** Re-reads the committed row after rollback and accepts it only when it holds the identical fact. */
	private async _ResolveUniqueCollision(command: RecordMemoryFactCommand): Promise<AtomicRecordMemoryFactResult>
	{
		return this.prisma.$transaction(async function _ResolveCommittedCollision(transaction)
		{
			const repository = new PrismaMemoryCatalogCollisionRepository(transaction);
			return repository.resolveUniqueCollision(command);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}

/** Returns whether a complete transaction rolled back on any catalog uniqueness constraint. */
function _IsUniqueCatalogConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Returns whether the error is a conflict Prisma rolled the whole transaction back on, so a retry is safe. */
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
