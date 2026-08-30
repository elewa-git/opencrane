import { createHash } from "node:crypto";

import { ___DoWithTrace, ___MarkActiveSpanFailed } from "@opencrane/backend/observability";

import { _log } from "./log";
import { ProviderEffectExecutionStatuses, type ProviderEffectCommandExecutor, type ProviderEffectCommandHandler, type ProviderEffectCommandUnitOfWork, type ProviderEffectEphemeralMaterial, type ProviderEffectExecutionContext, type ProviderEffectExecutionResult } from "./provider-effect-command.types";

/**
 * Delivers admitted provider commands without holding a database transaction during external I/O.
 *
 * A claim transaction selects one command and commits its fence. The handler then calls Kubernetes
 * or LiteLLM. A second transaction accepts the result only for that fence. Failed raw-key commands
 * return to `AwaitingMaterial`; database-complete commands may be retried by a reconciler.
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

	/**
	 * Composes provider-command persistence with its external adapter.
	 *
	 * @param unitOfWork - Transaction owner for claims and finalization.
	 * @param handler - External adapter that consumes a committed claim.
	 * @param trustedExecutorProfile - Fixed process identity allowed to claim provider commands.
	 */
	constructor(unitOfWork: ProviderEffectCommandUnitOfWork, handler: ProviderEffectCommandHandler, trustedExecutorProfile: string)
	{
		this.unitOfWork = unitOfWork;
		this.handler = handler;
		this.trustedExecutorProfile = trustedExecutorProfile;
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
		if (claim.status !== ProviderEffectExecutionStatuses.Claimed || claim.command === null)
		{
			_log.debug({ commandId, deliverySource, status: claim.status }, "provider effect delivery did not claim command");
			return { status: claim.status, result: null };
		}
		const command = claim.command;
		const fields = { commandId, siloId: command.siloId, resourceKind: command.resourceKind, resourceId: command.resourceId, executorProfile: command.executorProfile, kind: command.payload.kind, desiredGeneration: command.desiredGeneration, deliveryCount: command.deliveryCount, deliverySource };
		const preflight = await ___DoWithTrace("provider.effect.preflight", fields, function _Preflight() { return self.unitOfWork.run(function _Verify(repository, authorization) { return repository.preflight(command, context, authorization, new Date()); }); });
		if (!preflight)
		{
			_log.warn(fields, "provider effect delivery became stale or unauthorized before external I/O");
			return { status: ProviderEffectExecutionStatuses.Failed, result: null };
		}

		// 2. Perform the typed external operation after the claim transaction commits.
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
			const failureCode = "provider_effect_failed";
			const status = await ___DoWithTrace("provider.effect.fail", { ...fields, failureCode }, function _Fail() { return self.unitOfWork.run(function _PersistFailure(repository) { return repository.fail(command, failureCode); }); });
			const logFields = { err: _redactedError(delivery.error), ...fields, failureCode, status };
			if (status === ProviderEffectExecutionStatuses.Failed)
				_log.error(logFields, "provider effect delivery failed terminally");
			else
				_log.warn(logFields, "provider effect delivery failed and remains recoverable");
			return { status, result: null };
		}
		const result = delivery.result;

		// 3. Save the result only for the fence that performed the effect, so a stale worker cannot overwrite a retry.
		const completed = await ___DoWithTrace("provider.effect.complete", fields, function _Complete() { return self.unitOfWork.run(function _PersistResult(repository, authorization) { return repository.complete(command, result, context, authorization, new Date()); }); });
		if (completed === ProviderEffectExecutionStatuses.Succeeded)
			_log.info(fields, "provider effect delivery completed");
		else
			_log.warn({ ...fields, status: completed }, "provider effect result was fenced from current state");
		return completed === ProviderEffectExecutionStatuses.Succeeded ? { status: completed, result } : { status: completed, result: null };
		});
	}

	/** @inheritdoc */
	async reconcileNext(): Promise<boolean>
	{
		const command = await this.unitOfWork.run(function _Next(repository) { return repository.nextRecoverable(new Date()); });
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
