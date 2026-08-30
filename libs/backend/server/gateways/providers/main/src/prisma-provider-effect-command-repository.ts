import { randomUUID } from "node:crypto";

import { ProviderEffectCommandState, type Prisma } from "@prisma/client";

import { ProviderEffectCommandKinds, ProviderEffectCommandStates, ProviderEffectExecutionStatuses, ProviderEffectMaterialRequirements, type AdmitProviderEffectCommand, type ProviderEffectClaimResult, type ProviderEffectCommandRecord, type ProviderEffectCommandRepository, type ProviderEffectExecutionContext, type ProviderEffectHandlerResult } from "./provider-effect-command.types";
import { _ParseProviderEffectCommandPayload, _ValidateProviderEffectCommandResourceBinding } from "./provider-effect-command.validator";

/** Maximum number of external deliveries before a command needs a fresh administrator request. */
const _MAX_DELIVERIES = 3;
/** Claim duration long enough for the bounded Kubernetes and LiteLLM requests in one delivery. */
const _CLAIM_DURATION_MS = 120_000;

/**
 * Stores and fences provider commands inside a transaction supplied by the owning unit of work.
 *
 * Admission callers use this repository in the same Serializable transaction as central
 * authorization evidence. Delivery callers commit a short claim before external I/O, then open a
 * new transaction to save the result. The repository never calls Kubernetes or LiteLLM.
 *
 * Called by: provider routes during admission and {@link PrismaProviderEffectCommandUnitOfWork}
 * during delivery.
 */
export class PrismaProviderEffectCommandRepository implements ProviderEffectCommandRepository
{
	/** Transaction that owns every provider-command read and write in this repository instance. */
	private readonly transaction: Prisma.TransactionClient;

	/**
	 * Binds command persistence to a transaction already held by the caller.
	 *
	 * @param transaction - Prisma transaction that also owns protected state or delivery fencing.
	 */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** @inheritdoc */
	async admit(command: AdmitProviderEffectCommand): Promise<ProviderEffectCommandRecord>
	{
		_ValidateProviderEffectCommandResourceBinding(command.payload, command.resourceKind, command.resourceId);
		const row = await this.transaction.providerEffectCommand.create({ data: { id: command.id, siloId: command.siloId, principalId: command.principalId, kind: command.payload.kind, resourceKind: command.resourceKind, resourceId: command.resourceId, resourceRevision: command.resourceRevision, argumentsDigest: command.argumentsDigest, materialVerifier: command.materialVerifier, authorizationDecisionDigest: command.authorization.decisionDigest, authorizationPolicyRevisionHash: command.authorization.policyRevisionHash, effectiveAuthorizationDigest: command.authorization.effectiveAuthorizationDigest, approvalId: command.approvalId, executorProfile: command.executorProfile, materialRequirement: command.materialRequirement, payload: command.payload.value as unknown as Prisma.InputJsonValue } });
		return _toRecord(row);
	}

	/** @inheritdoc */
	async nextRecoverable(now: Date): Promise<ProviderEffectCommandRecord | null>
	{
		const row = await this.transaction.providerEffectCommand.findFirst({
			where: {
				materialRequirement: ProviderEffectMaterialRequirements.None,
				deliveryCount: { lt: _MAX_DELIVERIES },
				OR: [
					{ state: ProviderEffectCommandState.Pending },
					{ state: ProviderEffectCommandState.Claimed, claimExpiresAt: { lte: now } },
				],
			},
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
		});
		return row === null ? null : _toRecord(row);
	}

	/** @inheritdoc */
	async claim(commandId: string, materialVerifier: `sha256:${string}` | null, context: ProviderEffectExecutionContext, now: Date): Promise<ProviderEffectClaimResult>
	{
		// 1. Read the saved state so terminal commands and unexpired claims cannot run again.
		const current = await this.transaction.providerEffectCommand.findUnique({ where: { id: commandId } });
		if (current === null)
			return { status: ProviderEffectExecutionStatuses.Failed, command: null };
		if (current.siloId !== context.siloId || current.principalId !== context.principalId || current.resourceKind !== context.resourceKind || current.resourceId !== context.resourceId || current.executorProfile !== context.executorProfile)
			return { status: ProviderEffectExecutionStatuses.Failed, command: null };
		if (current.state === ProviderEffectCommandState.Succeeded)
			return { status: ProviderEffectExecutionStatuses.AlreadySucceeded, command: null };
		if (current.state === ProviderEffectCommandState.Failed)
			return { status: ProviderEffectExecutionStatuses.Failed, command: null };
		if (current.state === ProviderEffectCommandState.Claimed && current.claimExpiresAt !== null && current.claimExpiresAt > now)
			return { status: ProviderEffectExecutionStatuses.Busy, command: null };

		// 2. A raw-key command stays visible but inert until the caller supplies the same command-bound material.
		if (current.materialRequirement === "EphemeralProviderKey" && (materialVerifier === null || current.materialVerifier !== materialVerifier))
		{
			if (current.state !== ProviderEffectCommandState.AwaitingMaterial)
				await this.transaction.providerEffectCommand.updateMany({ where: { id: current.id, state: current.state, updatedAt: current.updatedAt }, data: { state: ProviderEffectCommandState.AwaitingMaterial, claimFence: null, claimExpiresAt: null } });
			return { status: ProviderEffectExecutionStatuses.AwaitingMaterial, command: null };
		}

		// 3. Replace a pending or expired claim with a new fence so external I/O starts after commit.
		if (current.deliveryCount >= _MAX_DELIVERIES)
		{
			await this.transaction.providerEffectCommand.updateMany({ where: { id: current.id, state: current.state, updatedAt: current.updatedAt }, data: { state: ProviderEffectCommandState.Failed, failureCode: "delivery_budget_exhausted", claimFence: null, claimExpiresAt: null, completedAt: now } });
			return { status: ProviderEffectExecutionStatuses.Failed, command: null };
		}
		const claimFence = randomUUID();
		const claimExpiresAt = new Date(now.getTime() + _CLAIM_DURATION_MS);
		const updated = await this.transaction.providerEffectCommand.updateMany({ where: { id: current.id, state: current.state, deliveryCount: current.deliveryCount, updatedAt: current.updatedAt }, data: { state: ProviderEffectCommandState.Claimed, deliveryCount: { increment: 1 }, claimFence, claimExpiresAt, failureCode: null } });
		if (updated.count !== 1)
			return { status: ProviderEffectExecutionStatuses.Busy, command: null };
		const claimed = await this.transaction.providerEffectCommand.findUnique({ where: { id: current.id } });
		if (claimed === null)
			throw new Error("claimed provider effect command disappeared before commit");
		return { status: ProviderEffectExecutionStatuses.Claimed, command: _toRecord(claimed) };
	}

	/** @inheritdoc */
	async complete(command: ProviderEffectCommandRecord, result: ProviderEffectHandlerResult, completedAt: Date): Promise<boolean>
	{
		if (command.payload.kind !== result.kind)
			throw new Error("provider effect result kind does not match its claimed command");
		const updated = await this.transaction.providerEffectCommand.updateMany({ where: { id: command.id, state: ProviderEffectCommandState.Claimed, claimFence: command.claimFence, deliveryCount: command.deliveryCount }, data: { state: ProviderEffectCommandState.Succeeded, result: result as unknown as Prisma.InputJsonValue, claimFence: null, claimExpiresAt: null, completedAt } });
		if (updated.count !== 1)
			return false;
		if (result.kind === ProviderEffectCommandKinds.RegisterModel)
		{
			if (command.payload.kind !== ProviderEffectCommandKinds.RegisterModel)
				throw new Error("model registration result belongs to a different provider command");
			await this.transaction.modelDefinition.update({ where: { id: command.payload.value.modelDefinitionId }, data: { litellmModelId: result.litellmModelId } });
		}
		return true;
	}

	/** @inheritdoc */
	async fail(command: ProviderEffectCommandRecord, failureCode: string): Promise<ProviderEffectExecutionStatuses>
	{
		const terminal = command.deliveryCount >= _MAX_DELIVERIES;
		let state: ProviderEffectCommandState = ProviderEffectCommandState.Pending;
		let status = ProviderEffectExecutionStatuses.Retryable;
		if (terminal)
		{
			state = ProviderEffectCommandState.Failed;
			status = ProviderEffectExecutionStatuses.Failed;
		}
		else if (command.materialRequirement === ProviderEffectMaterialRequirements.EphemeralProviderKey)
		{
			state = ProviderEffectCommandState.AwaitingMaterial;
			status = ProviderEffectExecutionStatuses.AwaitingMaterial;
		}
		const updated = await this.transaction.providerEffectCommand.updateMany({ where: { id: command.id, state: ProviderEffectCommandState.Claimed, claimFence: command.claimFence, deliveryCount: command.deliveryCount }, data: { state, failureCode, claimFence: null, claimExpiresAt: null, completedAt: terminal ? new Date() : null } });
		return updated.count === 1 ? status : ProviderEffectExecutionStatuses.Busy;
	}
}

/** Convert one Prisma row into the closed provider-command model. */
function _toRecord(row: Prisma.ProviderEffectCommandGetPayload<Record<string, never>>): ProviderEffectCommandRecord
{
	const kind = row.kind as ProviderEffectCommandKinds;
	const payload = _ParseProviderEffectCommandPayload(kind, row.payload);
	_ValidateProviderEffectCommandResourceBinding(payload, row.resourceKind, row.resourceId);
	return {
		id: row.id,
		siloId: row.siloId,
		principalId: row.principalId,
		payload,
		resourceKind: row.resourceKind,
		resourceId: row.resourceId,
		resourceRevision: row.resourceRevision,
		argumentsDigest: row.argumentsDigest as `sha256:${string}`,
		materialVerifier: row.materialVerifier as `sha256:${string}` | null,
		authorization: { decisionDigest: row.authorizationDecisionDigest as `sha256:${string}`, policyRevisionHash: row.authorizationPolicyRevisionHash as `sha256:${string}`, effectiveAuthorizationDigest: row.effectiveAuthorizationDigest as `sha256:${string}` },
		approvalId: row.approvalId,
		executorProfile: row.executorProfile,
		materialRequirement: row.materialRequirement as ProviderEffectMaterialRequirements,
		state: row.state as ProviderEffectCommandStates,
		deliveryCount: row.deliveryCount,
		claimFence: row.claimFence,
		claimExpiresAt: row.claimExpiresAt,
	};
}
