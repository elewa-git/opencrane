import { describe, expect, it, vi } from "vitest";

import { PersonaFirstChatArchetypes } from "@opencrane/models/user-onboarding";

import { __ResolveLocalDevelopmentArchetype, LOCAL_DEVELOPMENT_ARCHETYPE_PREFERENCE_KEY } from "../local-development-archetype";

/** Build one controllable preference-store double. */
function _Preferences(saved: string | null = null)
{
	return {
		read: vi.fn(function _Read(): string | null { return saved; }),
		write: vi.fn(function _Write(): boolean { return true; }),
		remove: vi.fn(function _Remove(): void { return; })
	};
}

describe("local-development archetype selection", function _Suite()
{
	it("persists and returns an explicit command selection", function _ExplicitSelection()
	{
		const preferences = _Preferences(PersonaFirstChatArchetypes.Commander);

		expect(__ResolveLocalDevelopmentArchetype(preferences, PersonaFirstChatArchetypes.Analyst)).toBe(PersonaFirstChatArchetypes.Analyst);
		expect(preferences.write).toHaveBeenCalledWith(LOCAL_DEVELOPMENT_ARCHETYPE_PREFERENCE_KEY, PersonaFirstChatArchetypes.Analyst);
		expect(preferences.read).not.toHaveBeenCalled();
	});

	it("reuses a valid saved selection for a plain serve", function _SavedSelection()
	{
		const preferences = _Preferences(PersonaFirstChatArchetypes.Anchor);

		expect(__ResolveLocalDevelopmentArchetype(preferences)).toBe(PersonaFirstChatArchetypes.Anchor);
		expect(preferences.write).not.toHaveBeenCalled();
	});

	it("defaults to Commander when no selection exists", function _DefaultSelection()
	{
		const preferences = _Preferences();

		expect(__ResolveLocalDevelopmentArchetype(preferences)).toBe(PersonaFirstChatArchetypes.Commander);
		expect(preferences.remove).not.toHaveBeenCalled();
	});

	it("removes an invalid saved selection before using Commander", function _InvalidSelection()
	{
		const preferences = _Preferences("nova");

		expect(__ResolveLocalDevelopmentArchetype(preferences)).toBe(PersonaFirstChatArchetypes.Commander);
		expect(preferences.remove).toHaveBeenCalledWith(LOCAL_DEVELOPMENT_ARCHETYPE_PREFERENCE_KEY);
	});
});
