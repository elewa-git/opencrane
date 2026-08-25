import { InjectionToken } from "@angular/core";

import { PersonaFirstChatArchetypes } from "@opencrane/models/user-onboarding";

import type { LocalDevelopmentArchetypePreferenceStore } from "./local-development-archetype.types";

/** Browser preference key retained across local development server restarts for one origin. */
export const LOCAL_DEVELOPMENT_ARCHETYPE_PREFERENCE_KEY = "opencrane.local-development.archetype";

/** Supplies the resolved Tier 1 archetype to the shared local state lifecycle. */
export const LOCAL_DEVELOPMENT_ARCHETYPE = new InjectionToken<PersonaFirstChatArchetypes>("LOCAL_DEVELOPMENT_ARCHETYPE", {
	factory: function _DefaultArchetype(): PersonaFirstChatArchetypes { return PersonaFirstChatArchetypes.Commander; }
});

/**
 * Resolve an explicit command selection before a saved browser preference and the Commander default.
 *
 * An explicit valid value is persisted for future plain serves. A corrupt saved value is removed so
 * it cannot keep shadowing the default after the supported archetype set changes.
 */
export function __ResolveLocalDevelopmentArchetype(preferences: LocalDevelopmentArchetypePreferenceStore, explicitSelection?: string): PersonaFirstChatArchetypes
{
	const explicit = _Archetype(explicitSelection);

	if (explicit)
	{
		preferences.write(LOCAL_DEVELOPMENT_ARCHETYPE_PREFERENCE_KEY, explicit);
		return explicit;
	}

	const saved = preferences.read(LOCAL_DEVELOPMENT_ARCHETYPE_PREFERENCE_KEY);
	const selected = _Archetype(saved);

	if (selected)
	{
		return selected;
	}

	if (saved)
	{
		preferences.remove(LOCAL_DEVELOPMENT_ARCHETYPE_PREFERENCE_KEY);
	}

	return PersonaFirstChatArchetypes.Commander;
}

/** Return one supported archetype, or null for an absent or unknown value. */
function _Archetype(value?: string | null): PersonaFirstChatArchetypes | null
{
	if (!value)
	{
		return null;
	}

	return Object.values(PersonaFirstChatArchetypes).includes(value as PersonaFirstChatArchetypes)
		? value as PersonaFirstChatArchetypes
		: null;
}
