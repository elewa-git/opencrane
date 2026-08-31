import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { ___IsRolledBackConflict, ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import { PrismaSteeringRequestRepository } from "./prisma-steering-request-repository";
import type { SteeringRequestRepository, SteeringRequestTransactionRepository, SubmitSteeringRequestCommand, SubmitSteeringRequestResult } from "./steering-request.types";

/**
 * Owns the Serializable transaction and conflict recovery for owner-authored steering.
 *
 * Each request receives a primary key derived from the authenticated owner, run, and hashed browser
 * key. The shared unit-of-work envelope runs up to three attempts, and only after Prisma reports a
 * proven full rollback. If all three lose, a fresh read verifies the committed row: the same digest
 * is a successful replay and a different digest is a reused-key conflict. An absent winner leaves
 * the final Prisma error intact.
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
	 * any non-rollback error immediately.
	 */
	async submitAtomically(command: SubmitSteeringRequestCommand): Promise<SubmitSteeringRequestResult>
	{
		const steeringRequestId = _SteeringRequestId(command);
		try
		{
			return await this._Run(3, function _Submit(repository) { return repository.submit(command, steeringRequestId); });
		}
		catch (error)
		{
			if (!___IsRolledBackConflict(error)) throw error;
			const winner = await this._Run(1, function _Read(repository) { return repository.readWinner(command, steeringRequestId); });
			if (winner !== null) return winner;
			throw error;
		}
	}

	/** Runs one steering operation with a repository bound to a fresh Serializable transaction. */
	private async _Run<Result>(attemptLimit: number, work: (repository: SteeringRequestTransactionRepository) => Promise<Result>): Promise<Result>
	{
		return ___RunInPrismaUnitOfWork(this._prisma, async function _Bind(transaction): Promise<Result>
		{
			return work(new PrismaSteeringRequestRepository(transaction, new PrismaAuthorizationAuthority(transaction)));
		}, { isolationLevel: "Serializable", operation: "steering request", attemptLimit });
	}
}

/** Derives the database primary key without storing the browser's idempotency key. */
function _SteeringRequestId(command: SubmitSteeringRequestCommand): string
{
	const digest = createHash("sha256").update(JSON.stringify(["opencrane-steering-request-v1", command.runId, command.siloId, command.subjectId, command.idempotencyDigest])).digest("hex");
	return `steering-${digest}`;
}
