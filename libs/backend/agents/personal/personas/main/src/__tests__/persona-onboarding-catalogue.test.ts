import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { PERSONA_ONBOARDING_QUESTIONS, PERSONA_ONBOARDING_SOUL_TEMPLATES } from "../persona-onboarding-catalogue.js";

describe("persona onboarding catalogue", function _describe()
{
	it("covers every required interview category exactly once", function _coversCategories()
	{
		expect(PERSONA_ONBOARDING_QUESTIONS.map(function _category(question) { return question.category; })).toEqual(["RelationshipRole", "ToneLanguage", "AnswerStructure", "ChallengeSupport", "Initiative", "ApprovalRisk", "WorkingHabits", "MemoryBoundaries"]);
	});

	it("uses a complete exact-answer rule for each supported relationship role", function _usesRules()
	{
		expect(PERSONA_ONBOARDING_SOUL_TEMPLATES.map(function _rule(template) { return template.selectionRules[0]?.answers["relationship-role"]; })).toEqual(["collaborator", "coach", "challenger"]);
	});

	it("pins every reviewed markdown source to its exact SHA-256 fingerprint", function _pinsContent()
	{
		for (const template of PERSONA_ONBOARDING_SOUL_TEMPLATES)
		{
			expect(template.digest).toBe(`sha256:${createHash("sha256").update(template.content).digest("hex")}`);
		}
	});
});
