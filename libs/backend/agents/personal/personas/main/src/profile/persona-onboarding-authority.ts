import { PersonaOnboardingDenialReasons, type EnsurePersonaOnboardingCommand, type EnsurePersonaOnboardingResult, type PersonaOnboardingRepository } from "./persona-onboarding-authority.types.js";
import { PersonaLifecycleOutcomes } from "./persona-lifecycle.types.js";

/** Creates the owner's persona profile if it does not exist, and returns the question set and derivation sources the server chose. */
export async function __EnsurePersonaOnboarding(repository: PersonaOnboardingRepository, command: EnsurePersonaOnboardingCommand): Promise<EnsurePersonaOnboardingResult>
{
	if (!command.siloId.trim() || !command.userId.trim() || Number.isNaN(Date.parse(command.provisionedAt)))
	{
		return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaOnboardingDenialReasons.InvalidCommand };
	}
	return repository.ensureAtomically(command);
}
