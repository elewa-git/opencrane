import { randomUUID } from "node:crypto";

import { ActionExecutionState, ActionReplayMode as PrismaActionReplayMode, Prisma, WorkloadKind, type PrismaClient } from "@prisma/client";

import type { JsonValue } from "@opencrane/util";

import { __AppendAuditDecision } from "@opencrane/backend/server/iam/audit";
import { __DigestCanonicalJson } from "./canonical-json-digest.js";
import type { CapabilityActionFailureResult, CapabilityActionIntent, CapabilityActionReceipt, CapabilityActionReceiptRepository, CapabilityActionReservationResult, CapabilityActionSuccessResult, RuntimeBootstrapClaim, RuntimeBootstrapConsumptionResult, RuntimeBootstrapRepository } from "./runtime-proof.types.js";

/** Maps a completed Prisma receipt to the dependency-light canonical receipt contract. */
function _receipt<TResult>(row: { jti: string; requestFingerprint: string; replayMode: string; result: Prisma.JsonValue | null }): CapabilityActionReceipt<TResult>
{
	return {
		jti: row.jti,
		requestFingerprint: row.requestFingerprint,
		replayMode: row.replayMode === "OneShot" ? "one_shot" : "idempotent",
		result: row.result as unknown as TResult,
	};
}

/** Maps an existing durable JTI row to the stable replay decision. */
function _existing<TResult>(row: { state: string; jti: string; requestFingerprint: string; replayMode: string; result: Prisma.JsonValue | null }): CapabilityActionReservationResult<TResult>
{
	if (row.state === "Reserved") return { status: "existing_reserved" };
	if (row.state === "Failed") return { status: "existing_failed" };
	return { status: "existing_succeeded", receipt: _receipt<TResult>(row) };
}

/** Prisma-backed runtime bootstrap and proof-bound action receipt authority. */
export class PrismaRuntimeAuthorityRepository implements RuntimeBootstrapRepository, CapabilityActionReceiptRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;

	/** Creates the runtime authority adapter over canonical Postgres. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Atomically consumes one bootstrap and binds its runtime-generated proof key. */
	async consumeAndBindProofKeyAtomically(claim: RuntimeBootstrapClaim): Promise<RuntimeBootstrapConsumptionResult>
	{
		try
		{
			return await this.prisma.$transaction(async function _consume(transaction: Prisma.TransactionClient)
			{
				// 1. Lock run, assignment, and bootstrap in authority order before checking one-time state.
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "agent_runs" WHERE "id" = ${claim.runId} FOR UPDATE`);
				await transaction.$queryRaw(Prisma.sql`SELECT "run_id" FROM "workload_assignments" WHERE "run_id" = ${claim.runId} AND "attempt" = ${claim.attempt} FOR UPDATE`);
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "workload_bootstraps" WHERE "id" = ${claim.bootstrapId} FOR UPDATE`);
				const bootstrap = await transaction.workloadBootstrap.findUnique({ where: { id: claim.bootstrapId } });
				if (bootstrap === null) return { status: "conflict" } as const;
				if (bootstrap.consumedAt !== null) return { status: "already_consumed" } as const;

				// 2. Consume exact bootstrap coordinates; database triggers revalidate live assignment authority.
				const receiptId = randomUUID();
				await transaction.workloadBootstrap.update({
					where: { id: claim.bootstrapId },
					data: { consumedAt: new Date(), consumedByPodUid: claim.podUid, receiptId },
				});

				// 3. Persist only the public proof key bound to this run attempt; no reusable runtime secret exists.
				await transaction.runProofKey.create({
					data: {
						id: randomUUID(),
						bootstrapId: claim.bootstrapId,
						runId: claim.runId,
						attempt: claim.attempt,
						workloadKind: claim.workloadKind === "job" ? WorkloadKind.Job : WorkloadKind.Deployment,
						workloadUid: claim.workloadUid,
						podUid: claim.podUid,
						publicKeyJwk: claim.proofPublicJwk as unknown as Prisma.InputJsonValue,
						keyThumbprint: claim.proofKeyThumbprint,
						expiresAt: new Date(claim.expiresAtEpochMs),
					},
				});
				return { status: "consumed", receiptId } as const;
			});
		}
		catch (error)
		{
			if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) return { status: "conflict" };
			throw error;
		}
	}

	/** Atomically reserves a verified JTI and appends its allow decision before external I/O. */
	async reserve<TResult>(intent: CapabilityActionIntent): Promise<CapabilityActionReservationResult<TResult>>
	{
		try
		{
			return await this.prisma.$transaction(async function _reserve(transaction: Prisma.TransactionClient)
			{
				// 1. Return a locked existing JTI deterministically; a reserved/failed row is never re-executed.
				await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "action_execution_receipts" WHERE "jti" = ${intent.jti} FOR UPDATE`);
				const existing = await transaction.actionExecutionReceipt.findUnique({ where: { jti: intent.jti } });
				if (existing !== null) return _existing<TResult>(existing);

				// 2. Resolve the exact registered public proof key; the receipt trigger locks all live authority.
				const proofKey = await transaction.runProofKey.findUnique({ where: { keyThumbprint: intent.proofKeyThumbprint } });
				if (proofKey === null) throw new Error("verified proof key is absent from current authority");
				const receipt = await transaction.actionExecutionReceipt.create({
					data: {
						siloId: intent.siloId,
						subjectId: intent.subjectId,
						audience: intent.audience,
						serviceAccountName: intent.serviceAccountName,
						namespace: intent.namespace,
						workloadKind: intent.workloadKind === "job" ? WorkloadKind.Job : WorkloadKind.Deployment,
						workloadUid: intent.workloadUid,
						podUid: intent.podUid,
						runId: intent.runId,
						attempt: intent.attempt,
						agentServiceId: intent.agentServiceId,
						agentRevisionId: intent.agentRevisionId,
						proofKeyId: proofKey.id,
						proofKeyThumbprint: intent.proofKeyThumbprint,
						catalogId: intent.catalogId,
						catalogRevision: intent.catalogRevision,
						catalogDigest: intent.catalogDigest,
						capabilityId: intent.capabilityId,
						effectivePolicyDigest: intent.effectivePolicyDigest,
						resourceKind: intent.resourceKind,
						resourceId: intent.resourceId,
						action: intent.action,
						argumentsDigest: intent.argumentsDigest,
						jti: intent.jti,
						replayMode: intent.replayMode === "one_shot" ? PrismaActionReplayMode.OneShot : PrismaActionReplayMode.Idempotent,
						requestFingerprint: intent.requestFingerprint,
					},
				});

				// 3. Append the exact allow evidence in the same transaction; audit failure prevents I/O.
				const decisionDigest = __DigestCanonicalJson({ receiptId: receipt.id, jti: intent.jti, requestFingerprint: intent.requestFingerprint, effectivePolicyDigest: intent.effectivePolicyDigest } as JsonValue);
				await __AppendAuditDecision(transaction, {
					decisionDigest,
					siloId: intent.siloId,
					actorKind: "workload",
					actorId: intent.podUid,
					audience: intent.audience,
					namespace: intent.namespace,
					serviceAccountName: intent.serviceAccountName,
					workloadKind: intent.workloadKind,
					workloadUid: intent.workloadUid,
					podUid: intent.podUid,
					runId: intent.runId,
					attempt: intent.attempt,
					agentServiceId: intent.agentServiceId,
					agentRevisionId: intent.agentRevisionId,
					proofKeyId: proofKey.id,
					proofKeyThumbprint: intent.proofKeyThumbprint,
					resourceKind: intent.resourceKind,
					resourceId: intent.resourceId,
					action: intent.action,
					catalogId: intent.catalogId,
					catalogRevision: intent.catalogRevision,
					catalogDigest: intent.catalogDigest,
					argumentsDigest: intent.argumentsDigest,
					policyRevisionHash: intent.effectivePolicyDigest,
					effectiveAuthorizationDigest: intent.effectivePolicyDigest,
					outcome: "allow",
					reasonCode: "proof_bound_capability_authorized",
				});
				return { status: "reserved", reservationId: receipt.id } as const;
			});
		}
		catch (error)
		{
			if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
			const existing = await this.prisma.actionExecutionReceipt.findUnique({ where: { jti: intent.jti } });
			if (existing === null) throw error;
			return _existing<TResult>(existing);
		}
	}

	/** Completes only an exact Reserved receipt with its canonical JSON result. */
	async markSucceeded<TResult>(reservationId: string, result: TResult): Promise<CapabilityActionSuccessResult<TResult>>
	{
		const updated = await this.prisma.actionExecutionReceipt.updateMany({ where: { id: reservationId, state: ActionExecutionState.Reserved }, data: { state: ActionExecutionState.Succeeded, result: result as unknown as Prisma.InputJsonValue, completedAt: new Date() } });
		if (updated.count !== 1) return { status: "conflict" };
		const receipt = await this.prisma.actionExecutionReceipt.findUnique({ where: { id: reservationId } });
		if (receipt === null) return { status: "conflict" };
		return { status: "succeeded", receipt: _receipt<TResult>(receipt) };
	}

	/** Completes only an exact Reserved receipt with a stable failure code. */
	async markFailed(reservationId: string, failureCode: string): Promise<CapabilityActionFailureResult>
	{
		const updated = await this.prisma.actionExecutionReceipt.updateMany({ where: { id: reservationId, state: ActionExecutionState.Reserved }, data: { state: ActionExecutionState.Failed, failureCode, completedAt: new Date() } });
		return { status: updated.count === 1 ? "failed" : "conflict" };
	}
}
