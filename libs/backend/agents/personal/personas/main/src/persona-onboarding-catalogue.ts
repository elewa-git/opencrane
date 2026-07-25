import { createHash } from "node:crypto";

import type { PersonaOnboardingQuestion, PersonaOnboardingSoulTemplate } from "./persona-onboarding-catalogue.types.js";

/** Stable identifier for the product-owned first persona interview. */
export const PERSONA_ONBOARDING_QUESTION_SET_ID = "personal-onboarding";

/** Immutable initial revision for the product-owned first persona interview. */
export const PERSONA_ONBOARDING_QUESTION_SET_VERSION = 1;

/** Eight behavioural questions covering every required persona interview category. */
export const PERSONA_ONBOARDING_QUESTIONS: readonly PersonaOnboardingQuestion[] = [
	{ id: "relationship-role", category: "RelationshipRole", prompt: "Which role should your agent take? Answer exactly: collaborator, coach, or challenger.", ordinal: 1 },
	{ id: "tone-language", category: "ToneLanguage", prompt: "What tone and language should it use with you?", ordinal: 2 },
	{ id: "answer-structure", category: "AnswerStructure", prompt: "How should it structure answers when the work is complex?", ordinal: 3 },
	{ id: "challenge-support", category: "ChallengeSupport", prompt: "When should it challenge an assumption, and how directly?", ordinal: 4 },
	{ id: "initiative", category: "Initiative", prompt: "When should it take initiative instead of waiting for a request?", ordinal: 5 },
	{ id: "approval-risk", category: "ApprovalRisk", prompt: "Which actions should always wait for your approval?", ordinal: 6 },
	{ id: "working-habits", category: "WorkingHabits", prompt: "Which working habits should it adapt to?", ordinal: 7 },
	{ id: "memory-boundaries", category: "MemoryBoundaries", prompt: "What should it remember, and what should it avoid retaining?", ordinal: 8 },
];

/** Reviewed templates selected by the owner's declared relationship role. */
export const PERSONA_ONBOARDING_SOUL_TEMPLATES: readonly PersonaOnboardingSoulTemplate[] = _templates();

/** Builds reviewed immutable sources while deriving their checked SHA-256 fingerprints from their exact markdown. */
function _templates(): readonly PersonaOnboardingSoulTemplate[]
{
	return [
		_template("collaborator", "collaborative-partner", "You are a collaborative partner. Work alongside the owner, make progress visible, and keep decisions with them."),
		_template("coach", "reflective-coach", "You are a reflective coach. Help the owner clarify their goal, offer options, and support a considered decision without taking control."),
		_template("challenger", "constructive-challenger", "You are a constructive challenger. Test assumptions respectfully, explain risks plainly, and help the owner make the final call."),
	];
}

/** Builds one template whose rule is constrained to a single, owner-selected relationship role. */
function _template(role: string, id: string, body: string): PersonaOnboardingSoulTemplate
{
	const content = `# SOUL.md\n\n${body}\n`;
	return { id, version: 1, digest: `sha256:${createHash("sha256").update(content).digest("hex")}`, content, selectionRules: [{ id: `${role}-role`, priority: 100, answers: { "relationship-role": role } }] };
}
