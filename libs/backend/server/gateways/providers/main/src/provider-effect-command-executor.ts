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

	/**
	 * Composes provider-command persistence with its external adapter.
	 *
	 * @param unitOfWork - Transaction owner for claims and finalization.
	 * @param handler - External adapter that consumes a committed claim.
	 */
	constructor(unitOfWork: ProviderEffectCommandUnitOfWork, handler: ProviderEffectCommandHandler)
	{
		this.unitOfWork = unitOfWork;
		this.handler = handler;
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
		const claim = await ___DoWithTrace("provider.effect.claim", { commandId, deliverySource }, function _Claim() { return self.unitOfWork.run(function _PersistClaim(repository) { return repository.claim(commandId, verifier, context, new Date()); }); });
		if (claim.status !== ProviderEffectExecutionStatuses.Claimed || claim.command === null)
		{
			_log.debug({ commandId, deliverySource, status: claim.status }, "provider effect delivery did not claim command");
			return { status: claim.status, result: null };
		}
		const command = claim.command;
		const fields = { commandId, siloId: command.siloId, resourceKind: command.resourceKind, resourceId: command.resourceId, executorProfile: command.executorProfile, kind: command.payload.kind, deliveryCount: command.deliveryCount, deliverySource };

		// 2. Perform the typed external operation after the claim transaction commits.
		let result;
		try
		{
			result = await ___DoWithTrace("provider.effect.deliver", fields, async function _Deliver()
			{
				try
				{
					return await self.handler.execute(command, material);
				}
				catch (error)
				{
					___MarkActiveSpanFailed();
					throw error;
				}
			});
		}
		catch (error)
		{
			const failureCode = "provider_effect_failed";
			const status = await ___DoWithTrace("provider.effect.fail", { ...fields, failureCode }, function _Fail() { return self.unitOfWork.run(function _PersistFailure(repository) { return repository.fail(command, failureCode); }); });
			const logFields = { err: _redactedError(error), ...fields, failureCode, status };
			if (status === ProviderEffectExecutionStatuses.Failed)
				_log.error(logFields, "provider effect delivery failed terminally");
			else
				_log.warn(logFields, "provider effect delivery failed and remains recoverable");
			return { status, result: null };
		}

		// 3. Save the result only for the fence that performed the effect, so a stale worker cannot overwrite a retry.
		const completed = await ___DoWithTrace("provider.effect.complete", fields, function _Complete() { return self.unitOfWork.run(function _PersistResult(repository) { return repository.complete(command, result, new Date()); }); });
		if (completed)
			_log.info(fields, "provider effect delivery completed");
		else
			_log.warn(fields, "provider effect result lost its claim fence");
		return completed ? { status: ProviderEffectExecutionStatuses.Succeeded, result } : { status: ProviderEffectExecutionStatuses.Busy, result: null };
		});
	}

	/** @inheritdoc */
	async reconcileNext(): Promise<boolean>
	{
		const command = await this.unitOfWork.run(function _Next(repository) { return repository.nextRecoverable(new Date()); });
		if (command === null)
			return false;
		const context: ProviderEffectExecutionContext = { siloId: command.siloId, principalId: command.principalId, resourceKind: command.resourceKind, resourceId: command.resourceId, executorProfile: command.executorProfile };
		await this._execute(command.id, {}, context, "reconciler");
		return true;
	}
}

/** Keep error class and protocol code while dropping messages and stacks that may contain provider material. */
function _redactedError(error: unknown): { readonly type: string; readonly code?: string | number }
{
	if (typeof error !== "object" || error === null)
		return { type: "unknown" };
	const candidate = error as { readonly name?: unknown; readonly code?: unknown };
	const type = typeof candidate.name === "string" ? candidate.name : "Error";
	if (typeof candidate.code === "string" || typeof candidate.code === "number")
		return { type, code: candidate.code };
	return { type };
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
