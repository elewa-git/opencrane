import type { Response } from "express";

import { ProviderEffectAdmissionStatuses, type ProviderEffectAdmissionResult, type ProviderEffectCommandRecord, type ProviderEffectResourceBlocker } from "./provider-effect-command.types";

/**
 * Returns the existing durable resource barrier through the provider API.
 *
 * Called by: BYOK admission and model lifecycle routes when conflicting provider work is active.
 *
 * @param response - Express response owned by the current provider request.
 * @param blocker - Existing command that must settle before a conflicting mutation may proceed.
 * @param error - Product-specific explanation of the conflict.
 */
export function _SendProviderEffectBusy(response: Response, blocker: ProviderEffectResourceBlocker, error: string): void
{
	response.status(409).json({ error, code: "PROVIDER_EFFECT_BUSY", commandId: blocker.commandId });
}

/**
 * Returns the admitted command for a newly allocated resource that cannot legitimately conflict.
 *
 * Called by: model creation after it allocates a fresh model-definition id in the same transaction.
 *
 * @param result - Closed admission result returned by the transaction-owned repository.
 * @returns Durable command saved beside the new resource.
 * @throws When a supposedly new resource resolves to an existing claimed barrier.
 * @see ProviderEffectAdmissionResult
 */
export function _RequireProviderEffectAdmission(result: ProviderEffectAdmissionResult): ProviderEffectCommandRecord
{
	if (result.status !== ProviderEffectAdmissionStatuses.Admitted)
		throw new Error("new resource unexpectedly conflicts with an existing provider effect");
	return result.command;
}
