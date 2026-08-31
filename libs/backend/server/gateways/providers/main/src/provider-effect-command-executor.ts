import { createHash } from "node:crypto";

import { ___DoWithTrace, ___MarkActiveSpanFailed, type Logger } from "@opencrane/backend/observability";

import { _IsProviderEffectFinalizationBlocked, _IsProviderEffectOutcomeUncertain, _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE } from "./provider-effect-command-errors";
import { ProviderEffectCommandKinds, ProviderEffectExecutionStatuses, type ProviderEffectCommandExecutor, type ProviderEffectCommandHandler, type ProviderEffectCommandRecord, type ProviderEffectCommandUnitOfWork, type ProviderEffectEphemeralMaterial, type ProviderEffectExecutionContext, type ProviderEffectExecutionResult } from "./provider-effect-command.types";

/**
 * Delivers admitted provider commands without holding a database transaction during external I/O.
 *
 * A claim transaction selects one command and commits its fence. The handler then calls Kubernetes
 * or LiteLLM. A second transaction accepts the result only for that fence. An upstream mutation
 * with an unknown outcome retains its claim and resource barrier until the same command converges.
 *
 * Called by: provider BYOK and model-registry HTTP routes after their admission transaction commits.
 */
export class DefaultProviderEffectCommandExecutor implements ProviderEffectCommandExecutor
{
	/** Opens the short claim and finalization transactions. */
	private readonly unitOfWork: ProviderEffectCommandUnitOfWork;
	/** Performs typed Kubernetes and LiteLLM operations after a claim commits. */
	private readonly handler: ProviderEffectCommandHandler;
	/** Trusted process profile supplied by composition rather than persisted command data. */
	private readonly trustedExecutorProfile: string;
	/** Process-wide logger supplied by the hosting application. */
	private readonly log: Logger;

	/**
	 * Composes provider-command persistence with its external adapter.
	 *
	 * @param unitOfWork - Transaction owner for claims and finalization.
	 * @param handler - External adapter that consumes a committed claim.
	 * @param trustedExecutorProfile - Fixed process identity allowed to claim provider commands.
	 * @param log - Hosting process logger that receives correlated provider outcomes.
	 */
	constructor(unitOfWork: ProviderEffectCommandUnitOfWork, handler: ProviderEffectCommandHandler, trustedExecutorProfile: string, log: Logger)
	{
		this.unitOfWork = unitOfWork;
		this.handler = handler;
		this.trustedExecutorProfile = trustedExecutorProfile;
		this.log = log;
	}

	/** @inheritdoc */
	async execute(commandId: string, material: ProviderEffectEphemeralMaterial = {}, context: ProviderEffectExecutionContext): Promise<ProviderEffectExecutionResult>
	{
		return this._execute(commandId, material, context, "request");
	}

	/** Delivers one request or reconciler attempt with correlated, secret-free telemetry. */
	private async _execute(commandId: string, material: ProviderEffectEphemeralMaterial, context: ProviderEffectExecutionContext, deliverySource: "request" | "reconciler"): Promise<ProviderEffectExecutionResult>
	{
		const self = this;
		return ___DoWithTrace("provider.effect.execute", { commandId, siloId: context.siloId, resourceKind: context.resourceKind, resourceId: context.resourceId, executorProfile: context.executorProfile, deliverySource }, async function _Execute(): Promise<ProviderEffectExecutionResult>
		{
		// 1. Derive a command-bound verifier in memory, so the database can match a retry without storing or correlating raw keys.
		const verifier = _materialVerifier(commandId, material);
		const claim = await ___DoWithTrace("provider.effect.claim", { commandId, deliverySource }, function _Claim() { return self.unitOfWork.run(function _PersistClaim(repository, authorization) { return repository.claim(commandId, verifier, context, authorization, new Date()); }); });
		if (claim.status === ProviderEffectExecutionStatuses.AlreadySucceeded && claim.command !== null)
		{
			const followed = await self._resumeFollowUp(claim.command, context, deliverySource);
			return followed ?? { status: claim.status, result: null };
		}
		if (claim.status !== ProviderEffectExecutionStatuses.Claimed || claim.command === null)
		{
			if (claim.status !== ProviderEffectExecutionStatuses.Succeeded && claim.status !== ProviderEffectExecutionStatuses.AlreadySucceeded)
				___MarkActiveSpanFailed();
			self.log.debug({ commandId, deliverySource, status: claim.status }, "provider effect delivery did not claim command");
			return { status: claim.status, result: null };
		}
		const command = claim.command;
		const fields = { commandId, siloId: command.siloId, resourceKind: command.resourceKind, resourceId: command.resourceId, executorProfile: command.executorProfile, kind: command.payload.kind, desiredGeneration: command.desiredGeneration, deliveryCount: command.deliveryCount, deliverySource };
		let result = command.result;
		if (result === null)
		{
			const preflight = await ___DoWithTrace("provider.effect.preflight", fields, function _Preflight() { return self.unitOfWork.run(function _Verify(repository, authorization) { return repository.preflight(command, context, authorization, new Date()); }); });
			if (!preflight)
			{
				___MarkActiveSpanFailed();
				self.log.warn(fields, "provider effect delivery became stale or unauthorized before external I/O");
				return { status: ProviderEffectExecutionStatuses.Failed, result: null };
			}

			// 2. Perform the typed external operation only when no durable outcome was already saved.
			const delivery = await ___DoWithTrace("provider.effect.deliver", fields, async function _Deliver()
			{
				try
				{
					return { failed: false, result: await self.handler.execute(command, material) } as const;
				}
				catch (error)
				{
					___MarkActiveSpanFailed();
					return { failed: true, error } as const;
				}
			});
			if (delivery.failed)
			{
				___MarkActiveSpanFailed();
				const uncertain = _IsProviderEffectOutcomeUncertain(delivery.error) || command.failureCode === _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE;
				const failureCode = uncertain ? _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE : "provider_effect_failed";
				const status = await ___DoWithTrace("provider.effect.fail", { ...fields, failureCode }, function _Fail()
				{
					return self.unitOfWork.run(function _PersistFailure(repository)
					{
						return uncertain ? repository.retainClaim(command, failureCode) : repository.fail(command, failureCode);
					});
				});
				const logFields = { err: _redactedError(delivery.error), ...fields, failureCode, status };
				if (uncertain)
					self.log.warn(logFields, "provider effect outcome is uncertain; exact command retains the resource barrier");
				else if (status === ProviderEffectExecutionStatuses.Failed)
					self.log.error(logFields, "provider effect delivery failed terminally");
				else
					self.log.warn(logFields, "provider effect delivery failed and remains recoverable");
				return { status, result: null };
			}
			result = delivery.result;
		}
		else
			self.log.info(fields, "provider effect delivery is finalizing saved external evidence");

		// 3. Save or recover the result only for the current fence, authority, and resource generation.
		let completion;
		try
		{
			completion = await ___DoWithTrace("provider.effect.complete", fields, function _Complete() { return self.unitOfWork.run(function _PersistResult(repository, authorization) { return repository.complete(command, result, context, authorization, new Date()); }); });
		}
		catch (error)
		{
			if (!_IsProviderEffectFinalizationBlocked(error))
				throw error;
			const status = await ___DoWithTrace("provider.effect.finalization.block", fields, function _BlockFinalization()
			{
				return self.unitOfWork.run(function _Block(repository) { return repository.blockFinalization(command, result); });
			});
			___MarkActiveSpanFailed();
			self.log.warn({ ...fields, status }, "provider effect result remains blocked after protected finalization rolled back");
			return { status, result: null };
		}
		if (completion.status === ProviderEffectExecutionStatuses.Succeeded)
			self.log.info(fields, "provider effect delivery completed");
		else
		{
			___MarkActiveSpanFailed();
			self.log.warn({ ...fields, status: completion.status }, "provider effect result was fenced from current state");
		}
		if (completion.status !== ProviderEffectExecutionStatuses.Succeeded)
			return { status: completion.status, result: null };
		if (completion.followUpCommand !== null)
		{
			const followed = await self._executeFollowUp(completion.followUpCommand, context, deliverySource);
			if (followed.status !== ProviderEffectExecutionStatuses.Succeeded && followed.status !== ProviderEffectExecutionStatuses.AlreadySucceeded)
				return followed;
		}
		return { status: completion.status, result };
		});
	}

	/** Loads and delivers the exact child saved by a previously succeeded parent command. */
	private async _resumeFollowUp(parent: ProviderEffectCommandRecord, context: ProviderEffectExecutionContext, deliverySource: "request" | "reconciler"): Promise<ProviderEffectExecutionResult | null>
	{
		if (parent.followUpCommandId === null)
			return null;
		const self = this;
		const child = await ___DoWithTrace("provider.effect.follow-up.read", { commandId: parent.id, followUpCommandId: parent.followUpCommandId, siloId: parent.siloId, resourceKind: parent.resourceKind, resourceId: parent.resourceId, deliverySource }, function _ReadFollowUp()
		{
			return self.unitOfWork.run(function _Find(repository) { return repository.findFollowUp(parent); });
		});
		if (child === null)
			throw new Error("provider effect parent references a missing follow-up command");
		return this._executeFollowUp(child, context, deliverySource);
	}

	/** Delivers one validated RegisterModel child through its own current-authority claim. */
	private _executeFollowUp(child: ProviderEffectCommandRecord, context: ProviderEffectExecutionContext, deliverySource: "request" | "reconciler"): Promise<ProviderEffectExecutionResult>
	{
		if (child.siloId !== context.siloId || child.principalId !== context.principalId || child.executorProfile !== context.executorProfile || child.payload.kind !== ProviderEffectCommandKinds.RegisterModel || child.resourceId !== child.payload.value.modelDefinitionId)
			throw new Error("provider effect follow-up command does not match its parent execution context");
		const childContext: ProviderEffectExecutionContext = { ...context, resourceKind: child.resourceKind, resourceId: child.resourceId };
		return this._execute(child.id, {}, childContext, deliverySource);
	}

	/** @inheritdoc */
	async reconcileNext(): Promise<boolean>
	{
		const self = this;
		const command = await ___DoWithTrace("provider.effect.reconcile.discover", {}, function _Discover() { return self.unitOfWork.run(function _Next(repository) { return repository.nextRecoverable(new Date()); }); });
		if (command === null)
			return false;
		const context: ProviderEffectExecutionContext = { siloId: command.siloId, principalId: command.principalId, actorKind: "system", actorId: this.trustedExecutorProfile, resourceKind: command.resourceKind, resourceId: command.resourceId, executorProfile: this.trustedExecutorProfile };
		await this._execute(command.id, {}, context, "reconciler");
		return true;
	}
}

/** Keep only fixed error classification and an optional numeric protocol code. */
function _redactedError(error: unknown): { readonly type: string; readonly code?: number }
{
	if (typeof error !== "object" || error === null)
		return { type: "unknown" };
	const candidate = error as { readonly code?: unknown };
	if (typeof candidate.code === "number")
		return { type: error instanceof Error ? "Error" : "unknown", code: candidate.code };
	return { type: error instanceof Error ? "Error" : "unknown" };
}

/**
 * Builds the salted verifier persisted with a Set-BYOK command.
 *
 * The command id is random and unique, so two commands carrying the same provider key have
 * different verifiers. The verifier must not be logged or returned by an API.
 *
 * Called by: BYOK admission and {@link DefaultProviderEffectCommandExecutor}.
 *
 * @param commandId - Random command identifier used as the salt.
 * @param provider - Canonical provider catalogue key.
 * @param providerKey - Raw provider key held only in process memory.
 * @returns Command-bound SHA-256 verifier.
 */
export function _ProviderKeyMaterialVerifier(commandId: string, provider: string, providerKey: string): `sha256:${string}`
{
	const digest = createHash("sha256").update(commandId).update("\0").update(provider).update("\0").update(providerKey).digest("hex");
	return `sha256:${digest}`;
}

/** Return the verifier supplied by ephemeral material, or null for a command with no material. */
function _materialVerifier(commandId: string, material: ProviderEffectEphemeralMaterial): `sha256:${string}` | null
{
	if (material.provider === undefined || material.providerKey === undefined)
		return null;
	return _ProviderKeyMaterialVerifier(commandId, material.provider, material.providerKey);
}
