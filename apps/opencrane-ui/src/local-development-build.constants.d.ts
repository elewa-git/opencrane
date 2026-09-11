import type { PersonaFirstChatArchetypes } from "@opencrane/models/user-onboarding";

declare global
{
	/** Archetype embedded by a named Tier 1 development build; absent for the plain onboarding build. */
	const OPENCRANE_LOCAL_DEVELOPMENT_ARCHETYPE: PersonaFirstChatArchetypes | undefined;
}

export {};
