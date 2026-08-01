import type { PrismaClient } from "@prisma/client";

import { MemoryCatalogAtomicStatuses, type AtomicRecordMemoryFactResult, type MemoryCatalogCollisionRepository, type RecordMemoryFactCommand } from "./memory-catalog.types.js";
import { __MatchesExistingMemoryDelivery } from "./prisma-memory-catalog-repository.js";

/** Prisma repository that classifies a uniqueness collision only after its write transaction rolled back. */
export class PrismaMemoryCatalogCollisionRepository implements MemoryCatalogCollisionRepository
{
	/** Canonical product database used only after the failed transaction is no longer active. */
	private readonly prisma: PrismaClient;

	/** Creates the post-rollback collision repository over committed catalog state. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Returns idempotent only when the committed key contains the exact immutable delivery. */
	async resolveUniqueCollision(command: RecordMemoryFactCommand): Promise<AtomicRecordMemoryFactResult>
	{
		const existing = await this.prisma.memoryOutboxEvent.findUnique({ where: { idempotencyKey: command.idempotencyKey }, include: { fact: true } });
		return existing !== null && __MatchesExistingMemoryDelivery(existing, command)
			? { status: MemoryCatalogAtomicStatuses.Idempotent }
			: { status: MemoryCatalogAtomicStatuses.Conflict };
	}
}
