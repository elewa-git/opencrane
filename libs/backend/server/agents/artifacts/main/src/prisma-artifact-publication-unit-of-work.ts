import { Prisma, type PrismaClient } from "@prisma/client";

import { PrismaArtifactAuthorityRepository } from "./prisma-artifact-authority.js";
import { _ArtifactPublicationConflictError } from "./artifact-unit-of-work.types.js";
import type { ArtifactPublicationTransaction, ArtifactPublicationUnitOfWork, ArtifactPublicationWork } from "./artifact-unit-of-work.types.js";

/** Maximum complete transaction attempts for a catalogue race that PostgreSQL rolled back. */
const _PUBLICATION_ATTEMPT_LIMIT = 3;

/** Prisma conflict codes that prove the database rolled an attempt back before any durable effect. */
const _RETRYABLE_PUBLICATION_CODES = new Set(["P2002", "P2034"]);

/** Prisma implementation that solely owns artifact-publication transaction creation and retry. */
export class PrismaArtifactPublicationUnitOfWork implements ArtifactPublicationUnitOfWork
{
	/** Canonical product database client; it never leaves this composition seam. */
	private readonly prisma: PrismaClient;

	/** Creates the transaction boundary for artifact publication. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Runs one complete operation with fresh transaction-scoped repositories on every safe retry. */
	async run<Result>(work: ArtifactPublicationWork<Result>): Promise<Result>
	{
		for (let attempt = 1; attempt <= _PUBLICATION_ATTEMPT_LIMIT; attempt += 1)
		{
			try
			{
				return await this.prisma.$transaction(async function _Run(transaction): Promise<Result>
				{
					const authority = new PrismaArtifactAuthorityRepository(transaction);
					const repositories: ArtifactPublicationTransaction = { revisions: authority, uploadLeases: authority };
					return work(repositories);
				});
			}
			catch (error)
			{
				if (_IsRetryablePublicationConflict(error) && attempt < _PUBLICATION_ATTEMPT_LIMIT) continue;
				if (_IsRetryablePublicationConflict(error)) throw new _ArtifactPublicationConflictError();
				throw error;
			}
		}
		throw new Error("artifact publication exhausted without a result");
	}
}

/** Returns whether Prisma confirms that the whole attempted publication transaction rolled back. */
function _IsRetryablePublicationConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && _RETRYABLE_PUBLICATION_CODES.has(error.code);
}
