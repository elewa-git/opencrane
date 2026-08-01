import { PersonaOnboardingDenialReasons, type EnsurePersonaOnboardingCommand, type EnsurePersonaOnboardingResult, type PersonaOnboardingRepository } from "./persona-onboarding-authority.types.js";
import { PersonaLifecycleOutcomes } from "./persona-lifecycle.types.js";

/** Provision the authenticated owner's persona profile and the server-owned reviewed interview source. */
export async function __EnsurePersonaOnboarding(repository: PersonaOnboardingRepository, command: EnsurePersonaOnboardingCommand): Promise<EnsurePersonaOnboardingResult>
{
	if (!command.siloId.trim() || !command.userId.trim() || Number.isNaN(Date.parse(command.provisionedAt)))
	{
		return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaOnboardingDenialReasons.InvalidCommand };
	}
	return repository.ensureAtomically(command);
}
