import type { Prisma } from "@prisma/client";

import { MemoryCatalogAtomicStatuses, type AtomicRecordMemoryFactResult, type MemoryCatalogCollisionRepository, type RecordMemoryFactCommand } from "./memory-catalog.types";
import { __MatchesExistingMemoryDelivery } from "./prisma-memory-catalog-repository";

/**
 * Reads already-committed rows to explain why a unique index rejected an insert.
 *
 * Only ever used after the failed write transaction has ended. Reading inside that transaction
 * would be pointless: it can no longer see anything, and it is about to be discarded.
 *
 * Constructed by: {@link PrismaMemoryCatalogUnitOfWork} in its post-rollback recovery path.
 *
 * @implements MemoryCatalogCollisionRepository
 */
export class PrismaMemoryCatalogCollisionRepository implements MemoryCatalogCollisionRepository
{
	/** Database client, used only once the failed transaction has ended. */
	private readonly prisma: Prisma.TransactionClient;

	/** Creates the post-rollback collision repository over committed catalog state. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/**
	 * Decides what a unique-constraint collision actually was, from committed state.
	 *
	 * @param command - The command whose insert was rejected.
	 * @returns `Idempotent` when a row committed under this `idempotencyKey` holds the identical
	 * fact, so a concurrent attempt already did the work and the caller may report success;
	 * `Conflict` otherwise — including when no row exists for the key at all, which means the
	 * collision came from the dataset/Cognee coordinate index rather than the key.
	 */
	async resolveUniqueCollision(command: RecordMemoryFactCommand): Promise<AtomicRecordMemoryFactResult>
	{
		const existing = await this.prisma.memoryOutboxEvent.findUnique({ where: { idempotencyKey: command.idempotencyKey }, include: { fact: true } });
		return existing !== null && __MatchesExistingMemoryDelivery(existing, command)
			? { status: MemoryCatalogAtomicStatuses.Idempotent }
			: { status: MemoryCatalogAtomicStatuses.Conflict };
	}
}
