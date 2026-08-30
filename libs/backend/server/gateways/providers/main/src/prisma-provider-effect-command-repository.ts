import { randomUUID } from "node:crypto";

import { Prisma, ProviderEffectCommandState } from "@prisma/client";
import type { AutoRoutingConfig } from "@opencrane/contracts";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ProviderEffectAdmissionStatuses, ProviderEffectCommandKinds, ProviderEffectCommandStates, ProviderEffectExecutionStatuses, ProviderEffectMaterialRequirements, type AdmitProviderEffectCommand, type ProviderEffectAdmissionResult, type ProviderEffectClaimResult, type ProviderEffectCommandRecord, type ProviderEffectCommandRepository, type ProviderEffectCompletionResult, type ProviderEffectExecutionContext, type ProviderEffectHandlerResult, type ProviderEffectResourceBlocker } from "./provider-effect-command.types";
import { _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE, _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE } from "./provider-effect-command-errors";
import { _ParseProviderEffectCommandPayload, _ParseProviderEffectHandlerResult, _ValidateProviderEffectCommandResourceBinding } from "./provider-effect-command.validator";
import { PrismaGlobalModelAliasRepository } from "./prisma-global-model-alias-repository";
import { PrismaProviderEffectProjectionRepository } from "./prisma-provider-effect-projection-repository";

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
 * | Event | Accepted state | Committed state |
 * | --- | --- | --- |
 * | admit | none or inactive older generation | Pending or AwaitingMaterial |
 * | claim | Pending, AwaitingMaterial, or expired Claimed | Claimed with a fresh fence |
 * | complete | matching Claimed fence | Succeeded |
 * | retryable failure | matching Claimed fence | Pending, AwaitingMaterial, or sticky Claimed |
 * | terminal failure | stale or exhausted command | Failed |
 *
 * Called by: provider routes during admission and {@link PrismaProviderEffectCommandUnitOfWork}
 * during delivery.
 */
export class PrismaProviderEffectCommandRepository implements ProviderEffectCommandRepository
{
	/** Transaction that owns every provider-command read and write in this repository instance. */
	private readonly transaction: Prisma.TransactionClient;
	/** Product eligibility and projection bound to the same lifecycle transaction. */
	private readonly projections: PrismaProviderEffectProjectionRepository;

	/**
	 * Binds command persistence to a transaction already held by the caller.
	 *
	 * @param transaction - Prisma transaction that also owns protected state or delivery fencing.
	 */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
		this.projections = new PrismaProviderEffectProjectionRepository(transaction);
	}

	/** @inheritdoc */
	async admit(command: AdmitProviderEffectCommand): Promise<ProviderEffectAdmissionResult>
	{
		_ValidateProviderEffectCommandResourceBinding(command.payload, command.siloId, command.resourceKind, command.resourceId);
		const claimed = await this.transaction.providerEffectCommand.findFirst({ where: { siloId: command.siloId, resourceKind: command.resourceKind, resourceId: command.resourceId, OR: [{ state: ProviderEffectCommandState.Claimed }, { state: { in: [ProviderEffectCommandState.Pending, ProviderEffectCommandState.AwaitingMaterial] }, failureCode: _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE }] }, orderBy: { desiredGeneration: "desc" } });
		if (claimed !== null)
			return { status: ProviderEffectAdmissionStatuses.Busy, command: null, blocker: { commandId: claimed.id, state: claimed.state as ProviderEffectCommandStates } };
		const previous = await this.transaction.providerEffectCommand.findFirst({ where: { siloId: command.siloId, resourceKind: command.resourceKind, resourceId: command.resourceId }, orderBy: { desiredGeneration: "desc" } });
		const desiredGeneration = (previous?.desiredGeneration ?? 0) + 1;
		const now = new Date();
		const row = await this.transaction.providerEffectCommand.create({ data: { id: command.id, siloId: command.siloId, principalId: command.principalId, kind: command.payload.kind, resourceKind: command.resourceKind, resourceId: command.resourceId, resourceRevision: command.resourceRevision, desiredGeneration, argumentsDigest: command.argumentsDigest, materialVerifier: command.materialVerifier, authorizationDecisionDigest: command.authorization.decisionDigest, authorizationPolicyRevisionHash: command.authorization.policyRevisionHash, effectiveAuthorizationDigest: command.authorization.effectiveAuthorizationDigest, executorProfile: command.executorProfile, materialRequirement: command.materialRequirement, payload: command.payload.value as unknown as Prisma.InputJsonValue } });
		await this.transaction.providerEffectCommand.updateMany({ where: { siloId: command.siloId, resourceKind: command.resourceKind, resourceId: command.resourceId, desiredGeneration: { lt: desiredGeneration }, OR: [{ state: ProviderEffectCommandState.Pending }, { state: ProviderEffectCommandState.AwaitingMaterial }, { state: ProviderEffectCommandState.Claimed, claimExpiresAt: { lte: now } }] }, data: { state: ProviderEffectCommandState.Failed, failureCode: "superseded", claimFence: null, claimExpiresAt: null, completedAt: now } });
		return { status: ProviderEffectAdmissionStatuses.Admitted, command: _toRecord(row), blocker: null };
	}

	/** @inheritdoc */
	async findResourceBlocker(siloId: string, resourceKind: string, resourceId: string): Promise<ProviderEffectResourceBlocker | null>
	{
		const row = await this.transaction.providerEffectCommand.findFirst({ where: { siloId, resourceKind, resourceId, state: { in: [ProviderEffectCommandState.Pending, ProviderEffectCommandState.AwaitingMaterial, ProviderEffectCommandState.Claimed] } }, orderBy: { desiredGeneration: "desc" } });
		return row === null ? null : { commandId: row.id, state: row.state as ProviderEffectCommandStates };
	}

	/** @inheritdoc */
	async nextRecoverable(now: Date): Promise<ProviderEffectCommandRecord | null>
	{
		const row = await this.transaction.providerEffectCommand.findFirst({
			where: {
				OR: [
					{ failureCode: _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE, result: { not: Prisma.DbNull }, state: ProviderEffectCommandState.Claimed, claimExpiresAt: { lte: now } },
					{ materialRequirement: ProviderEffectMaterialRequirements.None, deliveryCount: { lt: _MAX_DELIVERIES }, OR: [{ state: ProviderEffectCommandState.Pending }, { state: ProviderEffectCommandState.Claimed, claimExpiresAt: { lte: now } }] },
				],
			},
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
		});
		return row === null ? null : _toRecord(row);
	}

	/** @inheritdoc */
	async findFollowUp(parent: ProviderEffectCommandRecord): Promise<ProviderEffectCommandRecord | null>
	{
		if (parent.payload.kind !== ProviderEffectCommandKinds.SetByokKey || parent.state !== ProviderEffectCommandStates.Succeeded || parent.followUpCommandId === null)
			return null;
		const currentParent = await this.transaction.providerEffectCommand.findUnique({ where: { id: parent.id } });
		if (currentParent === null || currentParent.state !== ProviderEffectCommandState.Succeeded || currentParent.kind !== ProviderEffectCommandKinds.SetByokKey || currentParent.followUpCommandId !== parent.followUpCommandId)
			return null;
		const child = await this._findFollowUpCandidate(parent, parent.followUpCommandId, true);
		if (child === null)
			throw new Error("provider effect parent references an invalid follow-up command");
		return child;
	}

	/** @inheritdoc */
	async findFollowUpCandidate(parent: Pick<ProviderEffectCommandRecord, "siloId" | "principalId" | "executorProfile">, commandId: string): Promise<ProviderEffectCommandRecord | null>
	{
		return this._findFollowUpCandidate(parent, commandId, false);
	}

	/** Loads one alias child while distinguishing shared blockers from persisted parent corruption. */
	private async _findFollowUpCandidate(parent: Pick<ProviderEffectCommandRecord, "siloId" | "principalId" | "executorProfile">, commandId: string, strictPrincipal: boolean): Promise<ProviderEffectCommandRecord | null>
	{
		const row = await this.transaction.providerEffectCommand.findUnique({ where: { id: commandId } });
		if (row === null)
			return null;
		if (row.principalId !== parent.principalId && !strictPrincipal)
			return null;
		if (row.siloId !== parent.siloId || row.principalId !== parent.principalId || row.executorProfile !== parent.executorProfile || row.kind !== ProviderEffectCommandKinds.RegisterModel || row.resourceKind !== ProductAuthorizationResourceKinds.ModelDefinition)
			throw new Error("provider effect parent references an invalid follow-up command");
		const child = _toRecord(row);
		if (child.payload.kind !== ProviderEffectCommandKinds.RegisterModel || child.payload.value.publicModelName !== "auto" || child.payload.value.routingDefaultId === null || child.payload.value.selectedModelDefinitionId === null || child.resourceId !== child.payload.value.modelDefinitionId)
			throw new Error("provider effect follow-up is not bound to the reserved global alias");
		return child;
	}

	/** @inheritdoc */
	async reconcileGlobalRoutingDefault(owner: Pick<ProviderEffectCommandRecord, "siloId" | "principalId" | "executorProfile">, defaultModel: string, autoConfig: AutoRoutingConfig | null, context: ProviderEffectExecutionContext, authorization: AuthorizationAuthority, now: Date)
	{
		return this._globalAlias().reconcileGlobalRoutingDefault(owner, defaultModel, autoConfig, context, authorization, now);
	}

	/** @inheritdoc */
	async claim(commandId: string, materialVerifier: `sha256:${string}` | null, context: ProviderEffectExecutionContext, authorization: AuthorizationAuthority, now: Date): Promise<ProviderEffectClaimResult>
	{
		// 1. Read the saved state so terminal commands and unexpired claims cannot run again.
		const current = await this.transaction.providerEffectCommand.findUnique({ where: { id: commandId } });
		if (current === null)
			return { status: ProviderEffectExecutionStatuses.Failed, command: null };
		if (current.executorProfile !== context.executorProfile)
		{
			await this._terminalize(current, "executor_profile_mismatch", now);
			return { status: ProviderEffectExecutionStatuses.Failed, command: null };
		}
		if (!_contextMatches(current, context))
			return { status: ProviderEffectExecutionStatuses.Failed, command: null };
		if (current.state === ProviderEffectCommandState.Succeeded)
			return { status: ProviderEffectExecutionStatuses.AlreadySucceeded, command: _toRecord(current) };
		if (current.state === ProviderEffectCommandState.Failed)
			return { status: ProviderEffectExecutionStatuses.Failed, command: null };
		if (current.state === ProviderEffectCommandState.Claimed && current.claimExpiresAt !== null && current.claimExpiresAt > now)
			return { status: ProviderEffectExecutionStatuses.Busy, command: null };
		if (current.failureCode === _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE && current.result === null)
			return { status: ProviderEffectExecutionStatuses.Busy, command: null };
		if (!await this._isCurrentAndEligible(current) || !await _isAuthorized(current, context, authorization, now))
		{
			if (_isStickyBarrier(current.failureCode))
				return { status: ProviderEffectExecutionStatuses.Busy, command: null };
			await this._terminalize(current, "authorization_or_resource_stale", now);
			return { status: ProviderEffectExecutionStatuses.Failed, command: null };
		}

		// 2. A raw-key command stays visible but inert until the caller supplies the same command-bound material.
		const hasSavedResult = current.failureCode === _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE && current.result !== null;
		if (!hasSavedResult && current.materialRequirement === "EphemeralProviderKey" && (materialVerifier === null || current.materialVerifier !== materialVerifier))
		{
			if (current.state !== ProviderEffectCommandState.AwaitingMaterial)
				await this.transaction.providerEffectCommand.updateMany({ where: { id: current.id, state: current.state, updatedAt: current.updatedAt }, data: { state: ProviderEffectCommandState.AwaitingMaterial, claimFence: null, claimExpiresAt: null } });
			return { status: ProviderEffectExecutionStatuses.AwaitingMaterial, command: null };
		}

		// 3. Replace a pending or expired claim with a new fence so external I/O starts after commit.
		if (current.deliveryCount >= _MAX_DELIVERIES && !_isStickyBarrier(current.failureCode))
		{
			await this.transaction.providerEffectCommand.updateMany({ where: { id: current.id, state: current.state, updatedAt: current.updatedAt }, data: { state: ProviderEffectCommandState.Failed, failureCode: "delivery_budget_exhausted", claimFence: null, claimExpiresAt: null, completedAt: now } });
			return { status: ProviderEffectExecutionStatuses.Failed, command: null };
		}
		const activeOlder = await this.transaction.providerEffectCommand.findFirst({ where: { siloId: current.siloId, resourceKind: current.resourceKind, resourceId: current.resourceId, id: { not: current.id }, state: ProviderEffectCommandState.Claimed } });
		if (activeOlder !== null)
			return { status: ProviderEffectExecutionStatuses.Busy, command: null };
		const claimFence = randomUUID();
		const claimExpiresAt = new Date(now.getTime() + _CLAIM_DURATION_MS);
		const failureCode = _isStickyBarrier(current.failureCode) ? current.failureCode : null;
		const deliveryCount = hasSavedResult ? current.deliveryCount : { increment: 1 } as const;
		const updated = await this.transaction.providerEffectCommand.updateMany({ where: { id: current.id, state: current.state, deliveryCount: current.deliveryCount, updatedAt: current.updatedAt }, data: { state: ProviderEffectCommandState.Claimed, deliveryCount, claimFence, claimExpiresAt, failureCode } });
		if (updated.count !== 1)
			return { status: ProviderEffectExecutionStatuses.Busy, command: null };
		const claimed = await this.transaction.providerEffectCommand.findUnique({ where: { id: current.id } });
		if (claimed === null)
			throw new Error("claimed provider effect command disappeared before commit");
		return { status: ProviderEffectExecutionStatuses.Claimed, command: _toRecord(claimed) };
	}

	/** @inheritdoc */
	async preflight(command: ProviderEffectCommandRecord, context: ProviderEffectExecutionContext, authorization: AuthorizationAuthority, now: Date): Promise<boolean>
	{
		const current = await this.transaction.providerEffectCommand.findUnique({ where: { id: command.id } });
		if (current === null || !_contextMatches(current, context) || current.state !== ProviderEffectCommandState.Claimed || current.claimFence !== command.claimFence || current.deliveryCount !== command.deliveryCount)
			return false;
		if (await this._isCurrentAndEligible(current) && await _isAuthorized(current, context, authorization, now))
			return true;
		if (_isStickyBarrier(current.failureCode))
			return false;
		await this._terminalize(current, "authorization_or_resource_stale", now);
		return false;
	}

	/** @inheritdoc */
	async complete(command: ProviderEffectCommandRecord, result: ProviderEffectHandlerResult, context: ProviderEffectExecutionContext, authorization: AuthorizationAuthority, completedAt: Date): Promise<ProviderEffectCompletionResult>
	{
		const validatedResult = _ParseProviderEffectHandlerResult(result);
		if (command.payload.kind !== validatedResult.kind)
			throw new Error("provider effect result kind does not match its claimed command");
		const current = await this.transaction.providerEffectCommand.findUnique({ where: { id: command.id } });
		if (current === null || !_contextMatches(current, context) || current.state !== ProviderEffectCommandState.Claimed || current.claimFence !== command.claimFence || current.deliveryCount !== command.deliveryCount)
			return { status: ProviderEffectExecutionStatuses.Busy, followUpCommand: null };
		if (current.result !== null && !_sameResult(current.result, validatedResult))
			return { status: ProviderEffectExecutionStatuses.Busy, followUpCommand: null };
		if (!await this._isCurrentAndEligible(current) || !await _isAuthorized(current, context, authorization, completedAt))
		{
			const persisted = await this.transaction.providerEffectCommand.updateMany({ where: { id: command.id, state: ProviderEffectCommandState.Claimed, claimFence: command.claimFence, deliveryCount: command.deliveryCount }, data: { result: validatedResult as unknown as Prisma.InputJsonValue, failureCode: _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE } });
			if (persisted.count !== 1)
				return { status: ProviderEffectExecutionStatuses.Busy, followUpCommand: null };
			return { status: ProviderEffectExecutionStatuses.Busy, followUpCommand: null };
		}
		const updated = await this.transaction.providerEffectCommand.updateMany({ where: { id: command.id, state: ProviderEffectCommandState.Claimed, claimFence: command.claimFence, deliveryCount: command.deliveryCount }, data: { state: ProviderEffectCommandState.Succeeded, result: validatedResult as unknown as Prisma.InputJsonValue, failureCode: null, claimFence: null, claimExpiresAt: null, completedAt } });
		if (updated.count !== 1)
			return { status: ProviderEffectExecutionStatuses.Busy, followUpCommand: null };
		await this.projections.persist(command, validatedResult);
		let followUpCommand: ProviderEffectCommandRecord | null = null;
		if (validatedResult.kind === ProviderEffectCommandKinds.SetByokKey)
		{
			const alias = this._globalAlias();
			followUpCommand = await alias.reconcileAfterSet(command, validatedResult, context, authorization, completedAt);
			if (followUpCommand !== null)
			{
				const linked = await this.transaction.providerEffectCommand.updateMany({ where: { id: command.id, state: ProviderEffectCommandState.Succeeded, followUpCommandId: null }, data: { followUpCommandId: followUpCommand.id } });
				if (linked.count !== 1)
					throw new Error("provider effect parent lost its durable follow-up link");
			}
		}
		return { status: ProviderEffectExecutionStatuses.Succeeded, followUpCommand };
	}

	/** Opens the transaction-scoped alias planner used by Set and explicit routing writes. */
	private _globalAlias(): PrismaGlobalModelAliasRepository
	{
		return new PrismaGlobalModelAliasRepository(this.transaction, this);
	}

	/** @inheritdoc */
	async blockFinalization(command: ProviderEffectCommandRecord, result: ProviderEffectHandlerResult): Promise<ProviderEffectExecutionStatuses>
	{
		const validatedResult = _ParseProviderEffectHandlerResult(result);
		if (validatedResult.kind !== command.payload.kind)
			throw new Error("blocked provider effect result kind does not match its command");
		const current = await this.transaction.providerEffectCommand.findUnique({ where: { id: command.id } });
		if (current === null || current.state !== ProviderEffectCommandState.Claimed || current.claimFence !== command.claimFence || current.deliveryCount !== command.deliveryCount)
			return ProviderEffectExecutionStatuses.Busy;
		if (current.result !== null && !_sameResult(current.result, validatedResult))
			return ProviderEffectExecutionStatuses.Busy;
		await this.transaction.providerEffectCommand.updateMany({ where: { id: command.id, state: ProviderEffectCommandState.Claimed, claimFence: command.claimFence, deliveryCount: command.deliveryCount }, data: { result: validatedResult as unknown as Prisma.InputJsonValue, failureCode: _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE } });
		return ProviderEffectExecutionStatuses.Busy;
	}

	/** @inheritdoc */
	async fail(command: ProviderEffectCommandRecord, failureCode: string): Promise<ProviderEffectExecutionStatuses>
	{
		const currentDesired = await this._current(command.siloId, command.resourceKind, command.resourceId);
		if (currentDesired === null || currentDesired.id !== command.id || currentDesired.desiredGeneration !== command.desiredGeneration)
		{
			await this._terminalizeRecord(command, "superseded", new Date());
			return ProviderEffectExecutionStatuses.Failed;
		}
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

	/** @inheritdoc */
	async retainClaim(command: ProviderEffectCommandRecord, failureCode: string): Promise<ProviderEffectExecutionStatuses>
	{
		const updated = await this.transaction.providerEffectCommand.updateMany({ where: { id: command.id, state: ProviderEffectCommandState.Claimed, claimFence: command.claimFence, deliveryCount: command.deliveryCount }, data: { failureCode } });
		return updated.count === 1 ? ProviderEffectExecutionStatuses.Retryable : ProviderEffectExecutionStatuses.Busy;
	}

	/** Loads the newest monotonic desired state for one governed resource. */
	private _current(siloId: string, resourceKind: string, resourceId: string): Promise<Prisma.ProviderEffectCommandGetPayload<Record<string, never>> | null>
	{
		return this.transaction.providerEffectCommand.findFirst({ where: { siloId, resourceKind, resourceId }, orderBy: { desiredGeneration: "desc" } });
	}

	/** Confirms this command is current and its owning product row still matches admitted intent. */
	private async _isCurrentAndEligible(command: Prisma.ProviderEffectCommandGetPayload<Record<string, never>>): Promise<boolean>
	{
		const current = await this._current(command.siloId, command.resourceKind, command.resourceId);
		if (current === null || current.id !== command.id || current.desiredGeneration !== command.desiredGeneration)
			return false;
		return this.projections.isEligible(_toRecord(command));
	}

	/** Marks a stale Prisma row terminal so it cannot be retried after authority or intent changes. */
	private async _terminalize(command: Prisma.ProviderEffectCommandGetPayload<Record<string, never>>, failureCode: string, now: Date): Promise<void>
	{
		await this.transaction.providerEffectCommand.updateMany({ where: { id: command.id, state: command.state, updatedAt: command.updatedAt }, data: { state: ProviderEffectCommandState.Failed, failureCode, claimFence: null, claimExpiresAt: null, completedAt: now } });
	}

	/** Marks one claimed typed record terminal after a newer resource generation wins. */
	private async _terminalizeRecord(command: ProviderEffectCommandRecord, failureCode: string, now: Date): Promise<void>
	{
		await this.transaction.providerEffectCommand.updateMany({ where: { id: command.id, state: ProviderEffectCommandState.Claimed, claimFence: command.claimFence, deliveryCount: command.deliveryCount }, data: { state: ProviderEffectCommandState.Failed, failureCode, claimFence: null, claimExpiresAt: null, completedAt: now } });
	}
}

/** Re-admit the saved subject through current grants using only the trusted delivery actor. */
async function _isAuthorized(command: Prisma.ProviderEffectCommandGetPayload<Record<string, never>>, context: ProviderEffectExecutionContext, authorization: AuthorizationAuthority, now: Date): Promise<boolean>
{
	const argumentsDigest = ___DigestCanonicalJson({ operation: "deliver-provider-effect", commandId: command.id, desiredGeneration: command.desiredGeneration, resourceKind: command.resourceKind, resourceId: command.resourceId, executorProfile: command.executorProfile } as JsonValue);
	const admission = await authorization.admitPrincipal({ siloId: command.siloId, principalId: command.principalId, actorKind: context.actorKind, actorId: context.actorId, resource: { kind: ProductAuthorizationResourceKinds.Organization, id: command.siloId }, action: ProductAuthorizationActions.Administer, argumentsDigest, nowEpochMs: now.getTime() });
	return admission.outcome === AuthorizationDecisionOutcomes.Allow && admission.evidence !== null;
}

/** Confirms request/system actor coordinates and the saved command name the same delivery. */
function _contextMatches(command: Prisma.ProviderEffectCommandGetPayload<Record<string, never>>, context: ProviderEffectExecutionContext): boolean
{
	const actorMatches = context.actorKind === "user" ? context.actorId === context.principalId : context.actorKind === "system" && context.actorId === context.executorProfile;
	return actorMatches && command.siloId === context.siloId && command.principalId === context.principalId && command.resourceKind === context.resourceKind && command.resourceId === context.resourceId && command.executorProfile === context.executorProfile;
}

/** Convert one Prisma row into the closed provider-command model. */
function _toRecord(row: Prisma.ProviderEffectCommandGetPayload<Record<string, never>>): ProviderEffectCommandRecord
{
	const kind = row.kind as ProviderEffectCommandKinds;
	const payload = _ParseProviderEffectCommandPayload(kind, row.payload);
	_ValidateProviderEffectCommandResourceBinding(payload, row.siloId, row.resourceKind, row.resourceId);
	const result = row.result === null ? null : _ParseProviderEffectHandlerResult(row.result);
	if (row.failureCode === _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE && result === null)
		throw new Error("blocked provider effect finalization lacks durable evidence");
	if (result !== null && result.kind !== payload.kind)
		throw new Error("provider effect result kind does not match its persisted command");
	return {
		id: row.id,
		siloId: row.siloId,
		principalId: row.principalId,
		payload,
		resourceKind: row.resourceKind,
		resourceId: row.resourceId,
		resourceRevision: row.resourceRevision,
		desiredGeneration: row.desiredGeneration,
		argumentsDigest: row.argumentsDigest as `sha256:${string}`,
		materialVerifier: row.materialVerifier as `sha256:${string}` | null,
		authorization: { decisionDigest: row.authorizationDecisionDigest as `sha256:${string}`, policyRevisionHash: row.authorizationPolicyRevisionHash as `sha256:${string}`, effectiveAuthorizationDigest: row.effectiveAuthorizationDigest as `sha256:${string}` },
		executorProfile: row.executorProfile,
		materialRequirement: row.materialRequirement as ProviderEffectMaterialRequirements,
		state: row.state as ProviderEffectCommandStates,
		deliveryCount: row.deliveryCount,
		claimFence: row.claimFence,
		claimExpiresAt: row.claimExpiresAt,
		failureCode: row.failureCode,
		followUpCommandId: row.followUpCommandId,
		result,
	};
}

/** Returns whether a failed delivery must retain its exact resource barrier without a normal budget. */
function _isStickyBarrier(failureCode: string | null): boolean
{
	return failureCode === _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE || failureCode === _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE;
}

/** Compares persisted evidence with a retry result without exposing either value to telemetry. */
function _sameResult(saved: Prisma.JsonValue, candidate: ProviderEffectHandlerResult): boolean
{
	return ___DigestCanonicalJson(saved as JsonValue) === ___DigestCanonicalJson(candidate as unknown as JsonValue);
}
