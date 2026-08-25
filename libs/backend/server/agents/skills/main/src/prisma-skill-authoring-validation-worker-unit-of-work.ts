import { Prisma, type PrismaClient } from "@prisma/client";

import type { SkillAuthoringValidationCompletionEvent, SkillAuthoringValidationInput, SkillAuthoringValidationWorkerAuthority, SkillAuthoringValidationWorkerCompletion, SkillAuthoringValidationWorkerIdentity } from "./skill-authoring-validation-worker.types";
import { PrismaSkillAuthoringValidationWorkerRepository } from "./prisma-skill-authoring-validation-worker-authority";

/**
 * Opens serializable transactions for authoring-worker validation exchanges.
 *
 * The internal worker router uses this boundary for bootstrap, input, completion, and publication;
 * the background publisher also reloads unpublished events through it. It retries PostgreSQL
 * serialization collisions, while other database failures reach the caller for its 503 or retry
 * handling. Called by: OpenCrane runtime composition and background workers.
 */
export class PrismaSkillAuthoringValidationWorkerUnitOfWork implements SkillAuthoringValidationWorkerAuthority
{
	/** Owns the application database client and never exposes it outside this unit of work. */
	private readonly prisma: PrismaClient;

	/** Stores the application database client. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	async consumeBootstrap(referenceHash: string, identity: SkillAuthoringValidationWorkerIdentity): Promise<string | null>
	{
		return await this._Run(async function _Consume(repository) { return await repository.consumeBootstrap(referenceHash, identity); });
	}

	async loadInput(validationId: string, identity: SkillAuthoringValidationWorkerIdentity): Promise<SkillAuthoringValidationInput | null>
	{
		return await this._Run(async function _Load(repository) { return await repository.loadInput(validationId, identity); });
	}

	async complete(command: SkillAuthoringValidationWorkerCompletion, identity: SkillAuthoringValidationWorkerIdentity): Promise<SkillAuthoringValidationCompletionEvent | null>
	{
		return await this._Run(async function _Complete(repository) { return await repository.complete(command, identity); });
	}

	async markEventPublished(event: SkillAuthoringValidationCompletionEvent): Promise<void>
	{
		await this._Run(async function _Mark(repository): Promise<void> { await repository.markEventPublished(event); });
	}

	/** Loads one saved-but-unpublished event for the process-owned recovery publisher. */
	async nextUnpublished(): Promise<SkillAuthoringValidationCompletionEvent | null>
	{
		return await this._Run(async function _Next(repository) { return await repository.nextUnpublished(); });
	}

	/** Retries only PostgreSQL serialization collisions; every other error belongs to the caller. */
	private async _Run<TResult>(operation: (repository: PrismaSkillAuthoringValidationWorkerRepository) => Promise<TResult>): Promise<TResult>
	{
		let last: Prisma.PrismaClientKnownRequestError | null = null;
		for (let attempt = 1; attempt <= 3; attempt += 1)
		{
			try
			{
				return await this.prisma.$transaction(async function _Transaction(transaction): Promise<TResult> { return await operation(new PrismaSkillAuthoringValidationWorkerRepository(transaction)); }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
			}
			catch (error)
			{
				if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034")
				{
					throw error;
				}
				last = error;
			}
		}
		throw new Error("skill authoring validation worker transaction conflicted after bounded retries", { cause: last ?? undefined });
	}
}
