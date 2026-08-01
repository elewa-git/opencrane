import type { EnsurePersonaOnboardingCommand, EnsurePersonaOnboardingResult, PersonaOnboardingRepository } from "./persona-onboarding-authority.types.js";

/** Provision the authenticated owner's persona profile and the server-owned reviewed interview source. */
export async function __EnsurePersonaOnboarding(repository: PersonaOnboardingRepository, command: EnsurePersonaOnboardingCommand): Promise<EnsurePersonaOnboardingResult>
{
	if (!command.siloId.trim() || !command.userId.trim() || Number.isNaN(Date.parse(command.provisionedAt)))
	{
		return { outcome: "denied", reason: "invalid_command" };
	}
	return repository.ensureAtomically(command);
}
