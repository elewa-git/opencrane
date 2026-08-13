import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { PrismaSteeringRequestRepository } from "./prisma-steering-request-repository.js";
import type { SteeringRequestRepository, SteeringRequestTransactionRepository, SubmitSteeringRequestCommand, SubmitSteeringRequestResult } from "./steering-request.types.js";

/** Maximum number of complete steering transactions after PostgreSQL reports a safe rollback. */
const _STEERING_ATTEMPT_LIMIT = 3;

/** Prisma codes that prove the complete transaction rolled back before another attempt begins. */
const _RETRYABLE_STEERING_CODES = new Set(["P2002", "P2034"]);

/**
 * Owns the Serializable transaction and conflict recovery for owner-authored steering.
 *
 * Each request receives a primary key derived from the authenticated owner, run, and hashed browser
 * key. Up to three transactions may run, and only after Prisma reports P2002 or P2034. If all three
 * lose, a fresh read verifies the committed row: the same digest is a successful replay and a
 * different digest is a reused-key conflict. An absent winner leaves the final Prisma error intact.
 *
 * Called by: `_CreateSteeringIngestRouter` in prisma-steering-ingest.router.ts.
 * @implements SteeringRequestRepository
 */
export class PrismaSteeringRequestUnitOfWork implements SteeringRequestRepository
{
	/** Product database client that opens each complete transaction attempt. */
	private readonly _prisma: PrismaClient;

	/** Creates the transaction boundary over the app-owned Prisma client. */
	constructor(prisma: PrismaClient)
	{
		this._prisma = prisma;
	}

	/**
	 * Queues or replays one steering request without retrying an unknown database outcome.
	 * @param command - Owner-bound request assembled by the steering HTTP authority.
	 * @returns The queue, replay, conflict, ownership, or lifecycle result.
	 * @throws The last Prisma conflict when three rolled-back attempts have no committed winner, or
	 * any non-P2002/P2034 error immediately.
	 */
	async submitAtomically(command: SubmitSteeringRequestCommand): Promise<SubmitSteeringRequestResult>
	{
		const steeringRequestId = _SteeringRequestId(command);
		let lastConflict: unknown = null;
		for (let attempt = 1; attempt <= _STEERING_ATTEMPT_LIMIT; attempt += 1)
		{
			try
			{
				return await this._Run(function _Submit(repository) { return repository.submit(command, steeringRequestId); });
			}
			catch (error)
			{
				if (!_IsRetryableSteeringConflict(error)) throw error;
				lastConflict = error;
			}
		}
		const winner = await this._ReadWinner(command, steeringRequestId);
		if (winner !== null) return winner;
		if (lastConflict !== null) throw lastConflict;
		throw new Error("steering retry loop exhausted without a recorded database conflict");
	}

	/** Reads the committed row after all rolled-back submission attempts are exhausted. */
	private async _ReadWinner(command: SubmitSteeringRequestCommand, steeringRequestId: string): Promise<SubmitSteeringRequestResult | null>
	{
		return this._Run(function _Read(repository): Promise<SubmitSteeringRequestResult | null>
		{
			return repository.readWinner(command, steeringRequestId);
		});
	}

	/** Runs one steering operation with a repository bound to a fresh Serializable transaction. */
	private async _Run<Result>(work: (repository: SteeringRequestTransactionRepository) => Promise<Result>): Promise<Result>
	{
		return this._prisma.$transaction(async function _Run(transaction): Promise<Result>
		{
			return work(new PrismaSteeringRequestRepository(transaction));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}

/** Derives the database primary key without storing the browser's idempotency key. */
function _SteeringRequestId(command: SubmitSteeringRequestCommand): string
{
	const digest = createHash("sha256").update(JSON.stringify(["opencrane-steering-request-v1", command.runId, command.siloId, command.subjectId, command.idempotencyDigest])).digest("hex");
	return `steering-${digest}`;
}

/** Returns whether Prisma confirms the whole transaction was rolled back by a known race. */
function _IsRetryableSteeringConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && _RETRYABLE_STEERING_CODES.has(error.code);
}
