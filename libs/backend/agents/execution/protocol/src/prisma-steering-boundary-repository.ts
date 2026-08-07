import { Prisma, RuntimeSteeringDisposition, type PrismaClient } from "@prisma/client";

import type { SteeringBoundaryClaim, SteeringBoundaryClaimResult, SteeringBoundaryRepository, SteeringDisposition } from "./steering-authority.types.js";

/** Map the Prisma disposition enum to the dependency-light steering disposition literal. */
function _disposition(value: RuntimeSteeringDisposition): SteeringDisposition
{
	return value === RuntimeSteeringDisposition.Absorbed ? "absorbed" : "deferred";
}

/**
 * Prisma-backed exactly-once recorder for ordered steering boundaries.
 *
 * The `(runId, attempt, boundaryId)` primary key makes recording idempotent across process death: a
 * second claim for the same boundary raises a unique-constraint violation, which is resolved by
 * returning the disposition already recorded rather than emitting a second absorb/defer. It advances
 * the attempt's input generation in the same transaction only when steering is absorbed, so the
 * command stream's generation and the boundary ledger never disagree.
 */
export class PrismaSteeringBoundaryRepository implements SteeringBoundaryRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;

	/** Creates the steering-boundary recorder over canonical Postgres. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Atomically records a new boundary claim, or returns the disposition already recorded for it. */
	async claim(claim: SteeringBoundaryClaim): Promise<SteeringBoundaryClaimResult>
	{
		try
		{
			return await this.prisma.$transaction(async function _record(transaction: Prisma.TransactionClient): Promise<SteeringBoundaryClaimResult>
			{
				await transaction.runtimeSteeringBoundary.create({
					data: {
						runId: claim.runId,
						attempt: claim.attempt,
						boundaryId: claim.boundaryId,
						fromInputGeneration: claim.fromInputGeneration,
						toInputGeneration: claim.toInputGeneration,
						disposition: claim.disposition === "absorbed" ? RuntimeSteeringDisposition.Absorbed : RuntimeSteeringDisposition.Deferred,
						steeringDigest: claim.steeringDigest,
						ackedAt: new Date(),
					},
				});
				// Advance the per-attempt input generation only when this boundary absorbed steering.
				// The compare-and-set on the source generation must move exactly one row, or the
				// recorded boundary and the stream generation would silently disagree.
				if (claim.disposition === "absorbed")
				{
					const advanced = await transaction.runtimeCommandStream.updateMany({ where: { runId: claim.runId, attempt: claim.attempt, inputGeneration: claim.fromInputGeneration }, data: { inputGeneration: claim.toInputGeneration } });
					if (advanced.count !== 1) throw new Error("runtime steering boundary lost its input-generation fence");
				}
				return { status: "claimed" };
			});
		}
		catch (error)
		{
			if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
			const existing = await this.prisma.runtimeSteeringBoundary.findUnique({ where: { runId_attempt_boundaryId: { runId: claim.runId, attempt: claim.attempt, boundaryId: claim.boundaryId } } });
			if (existing === null) throw error;
			return { status: "existing", disposition: _disposition(existing.disposition), toInputGeneration: existing.toInputGeneration, steeringDigest: existing.steeringDigest };
		}
	}
}
