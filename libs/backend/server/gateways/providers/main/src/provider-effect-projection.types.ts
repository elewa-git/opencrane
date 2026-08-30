import type { ProviderEffectCommandRecord, ProviderEffectHandlerResult } from "./provider-effect-command.types";
import type { ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";

/**
 * Checks and writes provider product state through the command's finalization transaction.
 *
 * The command repository checks eligibility before delivery and persists a validated result only
 * after it has fenced that command's saved result, so a concurrent provider or model change cannot
 * be mistaken for the admitted product state.
 */
export interface ProviderEffectProjectionRepository
{
	/** Confirms the command's product resource still exactly matches its admitted intent. */
	isEligible(command: ProviderEffectCommandRecord): Promise<boolean>;
	/**
	 * Persists the validated result and returns resources that need creator grants.
	 *
	 * @returns The provider and catalogue model coordinates written by Set-BYOK; deletion and model
	 * registration return an empty list because they do not create creator-owned resources here.
	 */
	persist(command: ProviderEffectCommandRecord, result: ProviderEffectHandlerResult): Promise<readonly ProductAuthorizationResourceLocator[]>;
}
