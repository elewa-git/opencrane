import { PersonaFirstChatArchetypes } from "@opencrane/models/user-onboarding";
import { LocalDevelopmentScenarios } from "@opencrane/state/local-development";
import { describe, expect, it } from "vitest";

import { _LocalDevelopmentScenario, _ParseLocalDevelopmentArchetype, _ResolveLocalDevelopmentArchetype } from "../local-development-profile";

describe("Tier 1 local archetype selection", function _LocalDevelopmentArchetypeSelection()
{
	it("defaults a plain build to Commander and keeps named selections exact", function _ArchetypeBuildSelection()
	{
		expect(_ResolveLocalDevelopmentArchetype(undefined)).toBe(PersonaFirstChatArchetypes.Commander);
		expect(_ResolveLocalDevelopmentArchetype(PersonaFirstChatArchetypes.Analyst)).toBe(PersonaFirstChatArchetypes.Analyst);
		expect(_ParseLocalDevelopmentArchetype(PersonaFirstChatArchetypes.Catalyst)).toBe(PersonaFirstChatArchetypes.Catalyst);
		expect(function _ParseInventedArchetype() { return _ParseLocalDevelopmentArchetype("invented"); }).toThrow("Commander, Catalyst, Anchor, or Analyst");
	});

	it("accepts only finite URL scenarios and falls back to the happy path", function _FiniteScenario()
	{
		expect(_LocalDevelopmentScenario("?mockScenario=reconnecting")).toBe(LocalDevelopmentScenarios.Reconnecting);
		expect(_LocalDevelopmentScenario("?mockScenario=invented")).toBe(LocalDevelopmentScenarios.HappyPath);
		expect(_LocalDevelopmentScenario("")).toBe(LocalDevelopmentScenarios.HappyPath);
	});
});
