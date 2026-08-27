import { randomUUID } from "node:crypto";

import { ActionExecutionState, ActionReplayMode as PrismaActionReplayMode, Prisma, WorkloadKind, type PrismaClient } from "@prisma/client";

import type { JsonValue } from "@opencrane/util";

import { __AppendAuditDecision } from "@opencrane/backend/server/iam/audit";
import { __DigestCanonicalJson } from "./canonical-json-digest";
import type { CapabilityActionFailureResult, CapabilityActionIntent, CapabilityActionReceipt, CapabilityActionReceiptRepository, CapabilityActionReservationResult, CapabilityActionSuccessResult, RuntimeBootstrapClaim, RuntimeBootstrapConsumptionResult, RuntimeBootstrapRepository } from "./runtime-proof.types";

/** Maps a completed Prisma receipt onto the receipt contract, which carries no Prisma types. */
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

/**
 * Stores runtime proof keys and action receipts inside an existing database transaction.
 *
 * Implements two ports at once because both hinge on the same rows: a bootstrap is spent and its
 * public key registered in one transaction, and every action receipt is looked up against a
 * registered key.
 *
 * Bootstrap consumption uses an exact conditional write, and action reservation uses the receipt's
 * unique JTI, so concurrent runtimes cannot take the same authority twice.
 * Reserving an action also appends its audit entry in the same transaction, so an action can never
 * run without a recorded decision.
 *
 * Used by: ./prisma-runtime-bootstrap-exchange.ts, which delegates its consume step here.
 */
export class PrismaRuntimeAuthorityRepository implements RuntimeBootstrapRepository, CapabilityActionReceiptRepository
{
	/** Transaction that owns the runtime authority change. */
	private readonly prisma: Prisma.TransactionClient;

	/** Creates the runtime authority repository inside the caller's transaction. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** Atomically consumes one bootstrap and binds its runtime-generated proof key. */
	async consumeAndBindProofKeyAtomically(claim: RuntimeBootstrapClaim): Promise<RuntimeBootstrapConsumptionResult>
	{
		// 1. Read the one-use bootstrap before claiming its exact unconsumed state.
		const bootstrap = await this.prisma.workloadBootstrap.findUnique({ where: { id: claim.bootstrapId } });
				if (bootstrap === null)
					return { status: "conflict" } as const;
				if (bootstrap.consumedAt !== null)
					return { status: "already_consumed" } as const;

		// 2. Consume exact bootstrap coordinates; database triggers revalidate live assignment authority.
		const receiptId = randomUUID();
		const consumed = await this.prisma.workloadBootstrap.updateMany({
						where: { id: claim.bootstrapId, runId: claim.runId, attempt: claim.attempt, consumedAt: null },
						data: { consumedAt: new Date(), consumedByPodUid: claim.podUid, receiptId },
		});
		if (consumed.count !== 1)
			return { status: "conflict" } as const;

		// 3. Persist only the public proof key bound to this run attempt; no reusable runtime secret exists.
		await this.prisma.runProofKey.create({
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
	}

	/**
	 * Claims the right to run one verified action, and records the decision, before any external call.
	 *
	 * Committing this first is what makes the action at-most-once: a crash afterwards leaves a
	 * `Reserved` row that blocks every retry.
	 * @throws When the verified proof key is not registered to any run, or when a uniqueness conflict
	 *   cannot be resolved by re-reading the existing row.
	 */
	async reserve<TResult>(intent: CapabilityActionIntent): Promise<CapabilityActionReservationResult<TResult>>
	{
		// 1. Return an existing JTI deterministically; its unique key prevents a second reservation.
		const existing = await this.prisma.actionExecutionReceipt.findUnique({ where: { jti: intent.jti } });
				if (existing !== null) return _existing<TResult>(existing);

		// 2. Look up the registered public proof key; a database trigger revalidates the rest.
		const proofKey = await this.prisma.runProofKey.findUnique({ where: { keyThumbprint: intent.proofKeyThumbprint } });
				if (proofKey === null) throw new Error("verified proof key is absent from current authority");
		const receipt = await this.prisma.actionExecutionReceipt.create({
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
		await __AppendAuditDecision(this.prisma, {
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
	}

	/** Loads the stable result for a JTI that won a concurrent reservation race. */
	async findExisting<TResult>(jti: string): Promise<CapabilityActionReservationResult<TResult> | null>
	{
		const existing = await this.prisma.actionExecutionReceipt.findUnique({ where: { jti } });
		return existing === null ? null : _existing<TResult>(existing);
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

/** Opens serializable transactions around runtime proof and receipt changes. */
export class PrismaRuntimeAuthorityUnitOfWork implements RuntimeBootstrapRepository, CapabilityActionReceiptRepository
{
	/** OpenCrane product-authority database client. */
	private readonly prisma: PrismaClient;

	/** Creates the runtime authority unit of work. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** Atomically consumes one bootstrap and binds its runtime-generated proof key. */
	async consumeAndBindProofKeyAtomically(claim: RuntimeBootstrapClaim): Promise<RuntimeBootstrapConsumptionResult>
	{
		try
		{
			return await this._Run(async function _Consume(repository)
			{
				return repository.consumeAndBindProofKeyAtomically(claim);
			});
		}
		catch (error)
		{
			if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034"))
				return { status: "conflict" };
			throw error;
		}
	}

	/** Reserves one proof-bound action and appends its audit evidence atomically. */
	async reserve<TResult>(intent: CapabilityActionIntent): Promise<CapabilityActionReservationResult<TResult>>
	{
		try
		{
			return await this._Run(async function _Reserve(repository)
			{
				return repository.reserve<TResult>(intent);
			});
		}
		catch (error)
		{
			if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002")
				throw error;
			const existing = await this._Run(async function _LoadWinner(repository)
			{
				return repository.findExisting<TResult>(intent.jti);
			});
			if (existing === null)
				throw error;
			return existing;
		}
	}

	/** Completes one reserved action with its canonical result. */
	async markSucceeded<TResult>(reservationId: string, result: TResult): Promise<CapabilityActionSuccessResult<TResult>>
	{
		return this._Run(async function _Succeed(repository)
		{
			return repository.markSucceeded(reservationId, result);
		});
	}

	/** Completes one reserved action with a stable failure code. */
	async markFailed(reservationId: string, failureCode: string): Promise<CapabilityActionFailureResult>
	{
		return this._Run(async function _Fail(repository)
		{
			return repository.markFailed(reservationId, failureCode);
		});
	}

	/** Runs one runtime-authority operation in a serializable transaction. */
	private _Run<TResult>(operation: (repository: PrismaRuntimeAuthorityRepository) => Promise<TResult>): Promise<TResult>
	{
		return this.prisma.$transaction(async function _Run(transaction: Prisma.TransactionClient)
		{
			const repository = new PrismaRuntimeAuthorityRepository(transaction);
			return operation(repository);
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}
