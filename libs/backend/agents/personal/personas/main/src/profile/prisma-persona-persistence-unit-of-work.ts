import { Prisma, type PrismaClient } from "@prisma/client";

import type { PersonaPersistenceUnitOfWork } from "./persona-persistence-unit-of-work.types.js";

/** Prisma implementation of the persona-owned transaction boundary for local aggregate changes. */
export class PrismaPersonaPersistenceUnitOfWork implements PersonaPersistenceUnitOfWork
{
	/** Canonical product-authority database client. */
	private readonly prisma: PrismaClient;

	/** Creates the transaction boundary over the canonical product database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Runs one all-or-nothing persona-only persistence operation. */
	async run<Result>(work: (transaction: unknown) => Promise<Result>): Promise<Result>
	{
		return this.prisma.$transaction(async function _run(transaction): Promise<Result>
		{
			return work(transaction);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}
