import { describe, expect, it } from "vitest";

import { PersonaOnboardingApiStates } from "../persona-lifecycle.types";
import { _ProjectPersonaOnboardingStatus } from "../persona-onboarding-status-projection";
import { PersonaOnboardingStatusInterviewStates, PersonaOnboardingStatusRevisionStates } from "../persona-onboarding-status-projection.types";
import { PersonaColourValues, PersonaModifierValues, PersonaTieKinds, type PersonaScoreResult } from "../../scoring/persona-scorer.types";
import type { PersonaOnboardingStatusFacts } from "../persona-onboarding-status-projection.types";

/** Build baseline owner facts that a status state may project without Prisma access. */
function _Facts(overrides: Partial<PersonaOnboardingStatusFacts> = {}): PersonaOnboardingStatusFacts
{
	return { hasProfile: true, activeRevisionId: null, interview: { id: "interview-1", state: PersonaOnboardingStatusInterviewStates.Completed, answeredQuestionCount: 1, questions: [{ id: "question-1", category: "pace", prompt: "Prompt", ordinal: 1, choices: [], selectedChoiceId: "choice-1" }] }, revision: null, score: null, ...overrides };
}

/** Build a fully resolved owner-bound score projection. */
function _Score(overrides: Partial<PersonaScoreResult> = {}): PersonaScoreResult
{
	return { orderedAnswerIds: ["answer-1"], orderedChoiceIds: ["question-1:choice-1"], colours: { red: 2, yellow: 0, green: 0, blue: 1, total: 3 }, openness: { explorer: 1, guardian: 0, total: 1 }, tieResolutions: [], primary: PersonaColourValues.Red, secondary: PersonaColourValues.Blue, modifier: PersonaModifierValues.Explorer, resolutionRequired: null, ...overrides };
}

describe("_ProjectPersonaOnboardingStatus", function _PersonaOnboardingStatusProjectionSuite()
{
	it("projects missing profiles and active personas without fabricating interview evidence", function _ProjectsAbsentInterviewStates()
	{
		expect(_ProjectPersonaOnboardingStatus(_Facts({ hasProfile: false, interview: null }))).toMatchObject({ state: PersonaOnboardingApiStates.Interview, interviewId: null, personaRevisionId: null });
		expect(_ProjectPersonaOnboardingStatus(_Facts({ interview: null, activeRevisionId: "revision-active" }))).toMatchObject({ state: PersonaOnboardingApiStates.Ready, interviewId: null, personaRevisionId: "revision-active" });
	});

	it("projects draft and approved revisions through distinct durable states", function _ProjectsRevisionStates()
	{
		const result = { displayName: "Commander", primaryColour: PersonaColourValues.Red, secondaryColour: PersonaColourValues.Blue, modifier: PersonaModifierValues.Explorer, colourScores: _Score().colours, opennessScores: _Score().openness, insights: ["Insight"], instructionPreview: "Instructions" };
		expect(_ProjectPersonaOnboardingStatus(_Facts({ revision: { id: "revision-draft", state: PersonaOnboardingStatusRevisionStates.Draft, result } }))).toMatchObject({ state: PersonaOnboardingApiStates.Review, personaRevisionId: "revision-draft" });
		expect(_ProjectPersonaOnboardingStatus(_Facts({ revision: { id: "revision-approved", state: PersonaOnboardingStatusRevisionStates.Approved, result } }))).toMatchObject({ state: PersonaOnboardingApiStates.Ready, personaRevisionId: "revision-approved" });
	});

	it("keeps interview, resolution, and review projections as separate score lifecycle states", function _ProjectsInterviewAndScoreStates()
	{
		expect(_ProjectPersonaOnboardingStatus(_Facts({ interview: { ..._Facts().interview!, state: PersonaOnboardingStatusInterviewStates.InProgress } }))).toMatchObject({ state: PersonaOnboardingApiStates.Interview, result: null });
		expect(_ProjectPersonaOnboardingStatus(_Facts())).toMatchObject({ state: PersonaOnboardingApiStates.Interview, result: null });
		const resolution = { kind: PersonaTieKinds.Primary, candidates: [PersonaColourValues.Red, PersonaColourValues.Blue] };
		expect(_ProjectPersonaOnboardingStatus(_Facts({ score: _Score({ primary: null, secondary: null, modifier: null, resolutionRequired: resolution }) }))).toMatchObject({ state: PersonaOnboardingApiStates.Resolution, resolution });
		expect(_ProjectPersonaOnboardingStatus(_Facts({ score: _Score() }))).toMatchObject({ state: PersonaOnboardingApiStates.Review, resolution: null, result: { primaryColour: PersonaColourValues.Red } });
	});
});
