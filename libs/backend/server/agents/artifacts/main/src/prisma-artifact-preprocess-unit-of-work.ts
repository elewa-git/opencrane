import { Prisma, type PrismaClient } from "@prisma/client";

import { PrismaArtifactPreprocessRepository } from "./prisma-artifact-preprocessing.js";
import type { ArtifactPreprocessUnitOfWork, ArtifactPreprocessWork } from "./artifact-unit-of-work.types.js";

/** Maximum complete retries after a PostgreSQL serialization or uniqueness race rolls back. */
const _PREPROCESS_ATTEMPT_LIMIT = 3;

/** Prisma codes that confirm no partial preprocessing transition committed. */
const _RETRYABLE_PREPROCESS_CODES = new Set(["P2002", "P2034"]);

/** Prisma transaction boundary for one independent fenced preprocessing operation. */
export class PrismaArtifactPreprocessUnitOfWork implements ArtifactPreprocessUnitOfWork
{
	/** Canonical product database client isolated from router and broker dependencies. */
	private readonly prisma: PrismaClient;

	/** Creates the preprocessing transaction boundary. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Runs repository work atomically, rebuilding the repository after a safe rolled-back race. */
	async run<Result>(work: ArtifactPreprocessWork<Result>): Promise<Result>
	{
		for (let attempt = 1; attempt <= _PREPROCESS_ATTEMPT_LIMIT; attempt += 1)
		{
			try
			{
				return await this.prisma.$transaction(async function _Run(transaction): Promise<Result>
				{
					return work(new PrismaArtifactPreprocessRepository(transaction));
				}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			}
			catch (error)
			{
				if (_IsRetryablePreprocessConflict(error) && attempt < _PREPROCESS_ATTEMPT_LIMIT) continue;
				throw error;
			}
		}
		throw new Error("artifact preprocessing exhausted without a result");
	}
}

/** Returns whether Prisma confirms the entire failed preprocessing operation rolled back. */
function _IsRetryablePreprocessConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && _RETRYABLE_PREPROCESS_CODES.has(error.code);
}
