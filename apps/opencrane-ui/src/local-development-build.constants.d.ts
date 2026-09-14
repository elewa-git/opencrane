import type { PersonaFirstChatArchetypes } from "@opencrane/models/user-onboarding";

declare global
{
	/** Supplies the archetype embedded by a named Tier 1 build; the plain build leaves it absent to start onboarding. */
	const OPENCRANE_LOCAL_DEVELOPMENT_ARCHETYPE: PersonaFirstChatArchetypes | undefined;
}

export {};
