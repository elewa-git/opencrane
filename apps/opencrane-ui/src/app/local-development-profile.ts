import { PersonaFirstChatArchetypes } from "@opencrane/models/user-onboarding";
import { LocalDevelopmentScenarios } from "@opencrane/state/local-development";

/** Lists the finite scenarios accepted from the local URL. */
const _LOCAL_DEVELOPMENT_SCENARIOS = new Set<string>(Object.values(LocalDevelopmentScenarios));

/** Lists the only reviewed archetypes that a local build may embed. */
const _LOCAL_DEVELOPMENT_ARCHETYPES = new Set<string>(Object.values(PersonaFirstChatArchetypes));

/**
 * Validates one build-time archetype before it can select local state or routing.
 *
 * @param value - Build-time value after Angular has replaced the constant.
 * @returns The exact reviewed archetype, or undefined for the plain onboarding build.
 * @throws When a named build embeds a value outside the current reviewed vocabulary.
 */
export function _ParseLocalDevelopmentArchetype(value: unknown): PersonaFirstChatArchetypes | undefined
{
	if (value === undefined)
	{
		return undefined;
	}

	if (typeof value === "string" && _LOCAL_DEVELOPMENT_ARCHETYPES.has(value))
	{
		return value as PersonaFirstChatArchetypes;
	}

	throw new Error("Tier 1 local development requires Commander, Catalyst, Anchor, or Analyst");
}

/**
 * Reads the archetype embedded by a named local build.
 *
 * The plain build leaves the constant undefined so routing still starts at onboarding.
 *
 * @returns The named build's archetype, or undefined for the plain local build.
 */
export function _ConfiguredLocalDevelopmentArchetype(): PersonaFirstChatArchetypes | undefined
{
	if (typeof OPENCRANE_LOCAL_DEVELOPMENT_ARCHETYPE === "undefined")
	{
		return undefined;
	}

	return _ParseLocalDevelopmentArchetype(OPENCRANE_LOCAL_DEVELOPMENT_ARCHETYPE);
}

/**
 * Selects the deterministic archetype for this one local build.
 *
 * The plain build starts onboarding from Commander as its initial fixture. The reviewed survey
 * answer becomes authoritative before first chat, while named builds use their exact embedded value.
 *
 * Called by: the local gateway-provider composition.
 *
 * @param explicitArchetype - Archetype embedded by a named build, when one was selected.
 * @returns The reviewed archetype used to seed the disposable local profile.
 */
export function _ResolveLocalDevelopmentArchetype(explicitArchetype: PersonaFirstChatArchetypes | undefined): PersonaFirstChatArchetypes
{
	const parsedArchetype = _ParseLocalDevelopmentArchetype(explicitArchetype);
	if (parsedArchetype !== undefined)
	{
		return parsedArchetype;
	}

	return PersonaFirstChatArchetypes.Commander;
}

/**
 * Selects one finite scenario from a browser query string.
 *
 * Unknown values use the documented happy path so a stale bookmark cannot create a new state.
 *
 * @param search - Browser query string, including its optional leading question mark.
 * @returns The selected finite scenario.
 */
export function _LocalDevelopmentScenario(search: string): LocalDevelopmentScenarios
{
	const value = new URLSearchParams(search).get("mockScenario");
	if (value !== null && _LOCAL_DEVELOPMENT_SCENARIOS.has(value))
	{
		return value as LocalDevelopmentScenarios;
	}

	return LocalDevelopmentScenarios.HappyPath;
}

/** Reads the current browser scenario without making an unavailable location fatal. */
export function _BrowserLocalDevelopmentScenario(): LocalDevelopmentScenarios
{
	try
	{
		return _LocalDevelopmentScenario(globalThis.location.search);
	}
	catch
	{
		return LocalDevelopmentScenarios.HappyPath;
	}
}
