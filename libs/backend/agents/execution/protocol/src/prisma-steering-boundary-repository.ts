import { Prisma, RuntimeSteeringDisposition, type PrismaClient } from "@prisma/client";

import type { SteeringBoundaryClaim, SteeringBoundaryClaimResult, SteeringBoundaryRepository, SteeringDisposition } from "./steering-authority.types";

/** Map the Prisma disposition enum to this package's string literal. */
function _disposition(value: RuntimeSteeringDisposition): SteeringDisposition
{
	return value === RuntimeSteeringDisposition.Absorbed ? "absorbed" : "deferred";
}

/**
 * Writes each steering boundary to Postgres exactly once.
 *
 * The `(runId, attempt, boundaryId)` primary key is what makes recording idempotent across process
 * death: a second claim for the same boundary raises a unique-constraint violation, which is
 * answered by returning the decision already recorded rather than writing a second absorb or defer.
 * When steering was absorbed it also raises the attempt's input generation in the same transaction,
 * so the command stream's generation and the boundary ledger can never disagree.
 *
 * Called by: no callers found - nothing constructs it yet, and index.ts does not re-export it.
 *
 * @implements SteeringBoundaryRepository
 */
export class PrismaSteeringBoundaryRepository implements SteeringBoundaryRepository
{
	/** Client for the main OpenCrane database. */
	private readonly prisma: PrismaClient;

	/** Creates the recorder over Postgres. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/**
	 * Record a new boundary, or return the decision already recorded for it.
	 *
	 * @param claim - The boundary to record, with the generation it moves from and to.
	 * @returns `claimed` when this call wrote the row. `existing`, with the recorded disposition and
	 * generation, when a unique-constraint violation showed an earlier process had already claimed it;
	 * the caller must adopt those values rather than its own.
	 * @throws {Error} When an absorbing boundary's generation update did not move exactly one row.
	 * @throws {Prisma.PrismaClientKnownRequestError} Rethrown for any database error that is not the
	 * duplicate-boundary case, and when the duplicate row cannot then be read back.
	 */
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
				// Raise the attempt's input generation only when this boundary absorbed steering. The
				// update matches on the generation that was read, and it must change exactly one row;
				// otherwise the boundary just written and the stream's generation would quietly disagree.
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
