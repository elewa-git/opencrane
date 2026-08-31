import { Prisma, type PrismaClient } from "@prisma/client";

import type { PrismaUnitOfWorkPolicy, PrismaUnitOfWorkRunner, PrismaUnitOfWorkWork } from "./prisma-unit-of-work.types";

/**
 * Prisma codes that prove PostgreSQL rolled the complete transaction back with nothing written.
 *
 * P2002 is a unique-constraint conflict and P2034 a serialization failure; both leave the database
 * exactly as it was, so repeating the complete idempotent operation is safe.
 */
export const ___ROLLED_BACK_CONFLICT_CODES: ReadonlySet<string> = new Set(["P2002", "P2034"]);

/**
 * Returns whether Prisma confirms the entire transaction rolled back, so a retry is safe.
 *
 * Called by: the shared unit-of-work runner, and domain adapters that resolve a committed winner
 * after their final attempt.
 *
 * @param error - The failure raised by one transaction attempt.
 * @param codes - Codes accepted as proven rollbacks; defaults to {@link ___ROLLED_BACK_CONFLICT_CODES}.
 * @returns Whether the failure is a proven full rollback.
 */
export function ___IsRolledBackConflict(error: unknown, codes: ReadonlySet<string> = ___ROLLED_BACK_CONFLICT_CODES): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && codes.has(error.code);
}

/**
 * Runs one complete idempotent operation in a fresh Prisma transaction, retrying only proven
 * full rollbacks up to the policy's attempt limit.
 *
 * This is the one shared envelope behind every declared unit of work: it owns transaction opening,
 * the explicit isolation level, and the bounded conflict retry that ~30 adapters used to hand-roll
 * with drifting code sets and helper names. Everything semantic stays with the caller — outcome
 * vocabularies, post-exhaustion winner reads, and error translation. The last conflict is rethrown
 * unchanged after the final attempt so the owning adapter decides what it means. Callers must never
 * place an effect that can survive database rollback inside `work`.
 *
 * Called by: declared Prisma unit-of-work adapters across the product domains.
 *
 * @param prisma - Root product client used only to open fresh transaction attempts.
 * @param work - The complete idempotent operation; receives each attempt's transaction client.
 * @param policy - Isolation level, attempt budget, retry triggers, and boundary name.
 * @returns The operation result from the first attempt that commits.
 * @throws The last failure once the policy refuses further attempts.
 * @see ___IsRolledBackConflict for the proven-rollback predicate.
 */
export function ___RunInPrismaUnitOfWork<Result>(prisma: PrismaClient, work: PrismaUnitOfWorkWork<Prisma.TransactionClient, Result>, policy: PrismaUnitOfWorkPolicy): Promise<Result>
{
	return new PrismaSharedUnitOfWork(prisma).run(work, policy);
}

/** Owns the direct Prisma transaction behind the shared bounded-retry policy. */
class PrismaSharedUnitOfWork implements PrismaUnitOfWorkRunner<Prisma.TransactionClient>
{
	/** Root product client used only to open fresh transaction attempts. */
	private readonly prisma: PrismaClient;

	/** Stores the root product client that opens each attempt. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** @inheritdoc */
	async run<Result>(work: PrismaUnitOfWorkWork<Prisma.TransactionClient, Result>, policy: PrismaUnitOfWorkPolicy): Promise<Result>
	{
		const attemptLimit = policy.attemptLimit ?? 1;
		if (!Number.isSafeInteger(attemptLimit) || attemptLimit < 1 || attemptLimit > 10)
		{
			throw new Error(`${policy.operation} unit of work requires an attempt limit between 1 and 10`);
		}
		for (let attempt = 1; attempt <= attemptLimit; attempt += 1)
		{
			try
			{
				return await this.prisma.$transaction(async function _Run(transaction): Promise<Result>
				{
					return work(transaction);
				}, { isolationLevel: policy.isolationLevel, timeout: policy.timeout, maxWait: policy.maxWait });
			}
			catch (error)
			{
				const retryable = ___IsRolledBackConflict(error, policy.retryableCodes) || policy.isRetryable?.(error) === true;
				if (!retryable || attempt === attemptLimit)
				{
					throw error;
				}
			}
		}
		throw new Error(`${policy.operation} unit of work exhausted without a result`);
	}
}
