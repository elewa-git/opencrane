import { PersonaFirstChatArchetypes } from "@opencrane/models/user-onboarding";
import { PersonaOnboardingStates, PersonaResolutionKinds, type PersonaColours, type PersonaGateway, type PersonaModifiers, type PersonaOnboardingSnapshot, type PersonaQuestion, type PersonaResult } from "@opencrane/state/onboarding";

import { __LOCAL_DEVELOPMENT_BOOTSTRAPS } from "./local-development.fixtures";
import { _CreateLocalDevelopmentNamedQuestions, _CreateLocalDevelopmentQuestions } from "./local-development.persona-fixtures";
import { _LocalDevelopmentArchetype, _ScoreLocalDevelopmentPersona } from "./local-development.scoring";
import type { _LocalDevelopmentState } from "./local-development.owner.types";
import type { _LocalDevelopmentScore, _LocalDevelopmentScoreSelection, _LocalDevelopmentTieChoice } from "./local-development.scoring.types";

/** Creates the current empty persona projection before an interview starts. */
function _EmptyPersona(): PersonaOnboardingSnapshot
{
	return { state: PersonaOnboardingStates.Interview, interviewId: null, answeredQuestionCount: 0, questionCount: 0, personaRevisionId: null, questions: [], resolution: null, result: null };
}

/** Reads retained tie choices in the scorer's fixed order. */
function _TieChoices(state: _LocalDevelopmentState): readonly _LocalDevelopmentTieChoice[]
{
	const order: readonly PersonaResolutionKinds[] = [PersonaResolutionKinds.Primary, PersonaResolutionKinds.Secondary, PersonaResolutionKinds.Modifier];
	return order.flatMap(function _Choice(kind)
	{
		const selectedValue = state.personaResolutions.get(kind);
		return selectedValue === undefined ? [] : [{ kind, selectedValue }];
	});
}

/** Builds the score projection shown before or after draft creation. */
function _PersonaResult(score: _LocalDevelopmentScore, archetype: PersonaFirstChatArchetypes, drafted: boolean): PersonaResult
{
	if (score.primary === null || score.secondary === null || score.modifier === null)
	{
		throw new Error("The local persona score still needs a tie resolution.");
	}
	const fixture = __LOCAL_DEVELOPMENT_BOOTSTRAPS[archetype];
	const displayName = drafted ? fixture.displayName : "Persona result";
	const insights = drafted ? [`Selected from the reviewed ${fixture.displayName} local-development fixture.`] : [];
	const instructionPreview = drafted ? `${fixture.displayName} uses its reviewed current-baseline instructions.` : null;
	return { displayName, primaryColour: score.primary, secondaryColour: score.secondary, modifier: score.modifier, colourScores: score.colours, opennessScores: score.openness, insights, instructionPreview };
}

/** Returns the reviewed archetype selected by a complete score. */
function _ArchetypeForScore(score: _LocalDevelopmentScore): PersonaFirstChatArchetypes
{
	if (score.primary === null)
	{
		throw new Error("The local persona score has no resolved primary colour.");
	}
	return _LocalDevelopmentArchetype(score.primary);
}

/** Returns a valid preconfigured persona for one named local command. */
export function _CreateLocalDevelopmentNamedPersona(archetype: PersonaFirstChatArchetypes): PersonaOnboardingSnapshot
{
	const questions = _CreateLocalDevelopmentNamedQuestions(archetype);
	const score = _ScoreLocalDevelopmentPersona(questions, []);
	if (_ArchetypeForScore(score) !== archetype)
	{
		throw new Error("The reviewed named local answers do not select their configured archetype.");
	}
	return { state: PersonaOnboardingStates.Ready, interviewId: "local-interview", answeredQuestionCount: questions.length, questionCount: questions.length, personaRevisionId: `local-persona-${archetype}`, questions, resolution: null, result: _PersonaResult(score, archetype, true) };
}

/** Creates the starting persona projection for a plain or named local build. */
export function _CreateLocalDevelopmentPersona(archetype: PersonaFirstChatArchetypes, startsWithOnboarding: boolean): PersonaOnboardingSnapshot
{
	return startsWithOnboarding ? _EmptyPersona() : _CreateLocalDevelopmentNamedPersona(archetype);
}

/** Recomputes the reviewed score and projects either its next tie or review state. */
function _AdoptScore(state: _LocalDevelopmentState, questions: readonly PersonaQuestion[], resetWorkspace: () => void): void
{
	const score = _ScoreLocalDevelopmentPersona(questions, _TieChoices(state));
	if (score.resolution !== null)
	{
		state.persona = { state: PersonaOnboardingStates.Resolution, interviewId: "local-interview", answeredQuestionCount: questions.length, questionCount: questions.length, personaRevisionId: null, questions, resolution: score.resolution, result: null };
		return;
	}
	const archetype = _ArchetypeForScore(score);
	state.archetype = archetype;
	resetWorkspace();
	state.persona = { state: PersonaOnboardingStates.Review, interviewId: "local-interview", answeredQuestionCount: questions.length, questionCount: questions.length, personaRevisionId: null, questions, resolution: null, result: _PersonaResult(score, archetype, false) };
}

/** Creates the current persona gateway over the shared local state owner. */
export function _CreateLocalDevelopmentPersonaGateway(state: _LocalDevelopmentState, resetWorkspace: () => void): PersonaGateway
{
	return {
		load: async function _Load() { return state.persona; },
		startInterview: async function _StartInterview()
		{
			if (state.persona.state === PersonaOnboardingStates.Interview && state.persona.interviewId !== null)
			{
				return;
			}
			state.personaResolutions.clear();
			const questions = _CreateLocalDevelopmentQuestions();
			state.persona = { state: PersonaOnboardingStates.Interview, interviewId: "local-interview", answeredQuestionCount: 0, questionCount: questions.length, personaRevisionId: null, questions, resolution: null, result: null };
		},
		recordAnswer: async function _RecordAnswer(interviewId: string, questionId: string, choiceId: string)
		{
			if (state.persona.state !== PersonaOnboardingStates.Interview || state.persona.interviewId !== interviewId)
			{
				throw new Error("The local interview changed.");
			}
			const question = state.persona.questions.find(function _Question(candidate) { return candidate.id === questionId; });
			if (question === undefined || !question.choices.some(function _Choice(candidate) { return candidate.id === choiceId; }))
			{
				throw new Error("Choose an answer from the reviewed local interview.");
			}
			const questions = state.persona.questions.map(candidate => candidate.id === questionId ? { ...candidate, selectedChoiceId: choiceId } : candidate);
			state.persona = { ...state.persona, questions, answeredQuestionCount: questions.filter(candidate => candidate.selectedChoiceId !== null).length };
		},
		completeInterview: async function _CompleteInterview(interviewId: string)
		{
			if (state.persona.state !== PersonaOnboardingStates.Interview || state.persona.interviewId !== interviewId || state.persona.answeredQuestionCount !== state.persona.questionCount)
			{
				throw new Error("Complete every local interview question first.");
			}
			_AdoptScore(state, state.persona.questions, resetWorkspace);
		},
		resolve: async function _Resolve(interviewId: string, kind: PersonaResolutionKinds, selectedValue: string)
		{
			const resolution = state.persona.resolution;
			if (state.persona.state !== PersonaOnboardingStates.Resolution || state.persona.interviewId !== interviewId || resolution === null || resolution.kind !== kind || !resolution.candidates.includes(selectedValue as _LocalDevelopmentScoreSelection))
			{
				throw new Error("Resolve the current local persona tie from its reviewed candidates.");
			}
			state.personaResolutions.set(kind, selectedValue as PersonaColours | PersonaModifiers);
			_AdoptScore(state, state.persona.questions, resetWorkspace);
		},
		createDraft: async function _CreateDraft(interviewId: string)
		{
			if (state.persona.state !== PersonaOnboardingStates.Review || state.persona.interviewId !== interviewId)
			{
				throw new Error("The local persona is not ready for a draft.");
			}
			const score = _ScoreLocalDevelopmentPersona(state.persona.questions, _TieChoices(state));
			state.persona = { ...state.persona, personaRevisionId: `local-persona-${state.archetype}`, result: _PersonaResult(score, state.archetype, true) };
		},
		approve: async function _Approve(personaRevisionId: string)
		{
			if (state.persona.state !== PersonaOnboardingStates.Review || state.persona.personaRevisionId !== personaRevisionId)
			{
				throw new Error("The local persona review changed.");
			}
			state.persona = { ...state.persona, state: PersonaOnboardingStates.Ready };
			resetWorkspace();
		}
	};
}
