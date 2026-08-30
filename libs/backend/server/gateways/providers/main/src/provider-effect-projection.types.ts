import type { ProviderEffectCommandRecord, ProviderEffectHandlerResult } from "./provider-effect-command.types";

/** Transaction-scoped product eligibility and projection behind provider-command lifecycle. */
export interface ProviderEffectProjectionRepository
{
	/** Confirms the command's product resource still exactly matches its admitted intent. */
	isEligible(command: ProviderEffectCommandRecord): Promise<boolean>;
	/** Persists the protected product projection after lifecycle fencing has been won. */
	persist(command: ProviderEffectCommandRecord, result: ProviderEffectHandlerResult): Promise<void>;
}
