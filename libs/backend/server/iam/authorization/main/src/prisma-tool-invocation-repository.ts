import { ActionExecutionState, Prisma, type PrismaClient } from "@prisma/client";

import type { ToolInvocationCoordinates, ToolInvocationFailureResult, ToolInvocationIntent, ToolInvocationReceipt, ToolInvocationRepository, ToolInvocationReservationResult, ToolInvocationSuccessResult } from "./tool-invocation.types.js";

/** Maps a completed Prisma row to the dependency-light canonical tool-invocation receipt. */
function _receipt<TResult>(row: { toolInvocationId: string; requestFingerprint: string; result: Prisma.JsonValue | null }): ToolInvocationReceipt<TResult>
{
	return {
		toolInvocationId: row.toolInvocationId,
		requestFingerprint: row.requestFingerprint,
		result: row.result as unknown as TResult,
	};
}

/** Maps an existing durable invocation row to the stable replay decision. */
function _existing<TResult>(row: { state: string; toolInvocationId: string; requestFingerprint: string; result: Prisma.JsonValue | null }): ToolInvocationReservationResult<TResult>
{
	if (row.state === "Reserved") return { status: "existing_reserved" };
	if (row.state === "Failed") return { status: "existing_failed" };
	return { status: "existing_succeeded", receipt: _receipt<TResult>(row) };
}

/**
 * Prisma-backed durable receipt authority for external tool invocations.
 *
 * It mirrors {@link PrismaRuntimeAuthorityRepository}'s reserve/execute/complete protocol so the
 * runtime external-action authority never invents a second reservation table: the row is created
 * (Reserved) before any tool I/O, then compare-and-set to Succeeded or Failed. A duplicate
 * `toolInvocationId` for the same run attempt, or a reused `requestFingerprint`, resolves to the
 * existing durable state rather than a second dispatch.
 */
export class PrismaToolInvocationRepository implements ToolInvocationRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;

	/** Creates the tool-invocation receipt adapter over canonical Postgres. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Atomically reserves a validated tool invocation before external I/O, or returns durable state. */
	async reserve<TResult>(intent: ToolInvocationIntent): Promise<ToolInvocationReservationResult<TResult>>
	{
		try
		{
			return await this.prisma.$transaction(async function _reserve(transaction: Prisma.TransactionClient)
			{
				// 1. Return a locked existing invocation deterministically; a reserved/failed row is never re-run.
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "tool_invocations" WHERE "request_fingerprint" = ${intent.requestFingerprint} FOR UPDATE`);
				const existing = await transaction.toolInvocation.findUnique({ where: { requestFingerprint: intent.requestFingerprint } });
				if (existing !== null) return _existing<TResult>(existing);

				// 2. Create the Reserved receipt keyed by the caller idempotency key and request fingerprint.
				const created = await transaction.toolInvocation.create({
					data: {
						siloId: intent.siloId,
						runId: intent.runId,
						attempt: intent.attempt,
						agentServiceId: intent.agentServiceId,
						agentRevisionId: intent.agentRevisionId,
						subjectId: intent.subjectId,
						toolRevisionId: intent.toolRevisionId,
						toolInvocationId: intent.toolInvocationId,
						argumentsDigest: intent.argumentsDigest,
						requestFingerprint: intent.requestFingerprint,
						approvalRequired: intent.approvalRequired,
					},
				});
				return { status: "reserved", reservationId: created.id } as const;
			});
		}
		catch (error)
		{
			if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
			const existing = await this.prisma.toolInvocation.findUnique({ where: { requestFingerprint: intent.requestFingerprint } });
			if (existing === null) throw error;
			return _existing<TResult>(existing);
		}
	}

	/** Completes only an exact Reserved invocation with its canonical JSON result. */
	async markSucceeded<TResult>(reservationId: string, result: TResult): Promise<ToolInvocationSuccessResult<TResult>>
	{
		const updated = await this.prisma.toolInvocation.updateMany({ where: { id: reservationId, state: ActionExecutionState.Reserved }, data: { state: ActionExecutionState.Succeeded, result: result as unknown as Prisma.InputJsonValue, completedAt: new Date() } });
		if (updated.count !== 1) return { status: "conflict" };
		const receipt = await this.prisma.toolInvocation.findUnique({ where: { id: reservationId } });
		if (receipt === null) return { status: "conflict" };
		return { status: "succeeded", receipt: _receipt<TResult>(receipt) };
	}

	/** Completes only an exact Reserved invocation with a stable failure code. */
	async markFailed(reservationId: string, failureCode: string): Promise<ToolInvocationFailureResult>
	{
		const updated = await this.prisma.toolInvocation.updateMany({ where: { id: reservationId, state: ActionExecutionState.Reserved }, data: { state: ActionExecutionState.Failed, failureCode, completedAt: new Date() } });
		return { status: updated.count === 1 ? "failed" : "conflict" };
	}

	/** Completes the unique Reserved invocation named by its run/attempt/idempotency coordinates. */
	async markSucceededByCoordinates<TResult>(coordinates: ToolInvocationCoordinates, result: TResult): Promise<ToolInvocationSuccessResult<TResult>>
	{
		return __MarkToolInvocationSucceededByCoordinatesInTransaction(this.prisma, coordinates, result);
	}
}

/**
 * Compare-and-set the unique Reserved invocation for `(runId, attempt, toolInvocationId)` inside a
 * caller-owned transaction (or over the root client).
 *
 * The unique `(runId, attempt, toolInvocationId)` key guarantees at most one matching row, so the
 * update touches exactly the invocation the runtime named or nothing. A count of zero — unknown
 * coordinates, an already-completed row, or a non-Reserved state — is a conflict, never a retry.
 *
 * @param client - Prisma transaction client (preferred, so completion commits with the caller's
 *   fence) or the root client.
 * @param coordinates - Attempt-scoped invocation coordinates supplied by the runtime.
 * @param result - Canonical durable result; for direct-invocation receipts this is a digest only.
 * @returns The durable receipt on success, or a conflict the caller must refuse.
 */
export async function __MarkToolInvocationSucceededByCoordinatesInTransaction<TResult>(client: Prisma.TransactionClient | PrismaClient, coordinates: ToolInvocationCoordinates, result: TResult): Promise<ToolInvocationSuccessResult<TResult>>
{
	// 1. CAS on Reserved by the unique coordinate key so a duplicate completion cannot rewrite state.
	const updated = await client.toolInvocation.updateMany({ where: { runId: coordinates.runId, attempt: coordinates.attempt, toolInvocationId: coordinates.toolInvocationId, state: ActionExecutionState.Reserved }, data: { state: ActionExecutionState.Succeeded, result: result as unknown as Prisma.InputJsonValue, completedAt: new Date() } });
	if (updated.count !== 1) return { status: "conflict" };

	// 2. Reload the completed row so the caller receives the exact durable receipt.
	const receipt = await client.toolInvocation.findUnique({ where: { runId_attempt_toolInvocationId: { runId: coordinates.runId, attempt: coordinates.attempt, toolInvocationId: coordinates.toolInvocationId } } });
	if (receipt === null) return { status: "conflict" };
	return { status: "succeeded", receipt: _receipt<TResult>(receipt) };
}
