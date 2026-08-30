/**
 * Identifies a fixed-name upstream mutation whose outcome remains unknown.
 *
 * Called by: provider-effect persistence and execution while retaining the exact command barrier.
 */
export const _PROVIDER_EFFECT_OUTCOME_UNCERTAIN_FAILURE_CODE = "provider_effect_outcome_uncertain";

/**
 * Identifies an applied external effect whose protected projection could not yet be finalized.
 *
 * The command keeps its claimed resource barrier and secret-free result until current authority
 * and lifecycle state permit the exact result to finalize without repeating external I/O.
 *
 * Called by: provider-effect persistence and recovery.
 */
export const _PROVIDER_EFFECT_FINALIZATION_BLOCKED_FAILURE_CODE = "provider_effect_finalization_blocked";

/**
 * Signals that an upstream request ended without proving whether its mutation applied.
 *
 * Called by: the provider-effect handler after a LiteLLM transport failure.
 */
export class ProviderEffectOutcomeUncertainError extends Error
{
	constructor()
	{
		super("provider effect upstream outcome is uncertain");
		this.name = "ProviderEffectOutcomeUncertainError";
	}
}

/**
 * Identifies the fixed domain error without inspecting third-party error text.
 *
 * Called by: the provider-effect executor before it chooses a terminal or retained claim.
 */
export function _IsProviderEffectOutcomeUncertain(error: unknown): boolean
{
	return error instanceof ProviderEffectOutcomeUncertainError;
}
