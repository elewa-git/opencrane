import { PersonaFirstChatTranscriptKinds, PersonaFirstChatTranscriptRoles, UserOnboardingRouteStates, type PersonaFirstChatArchetypes, type PersonaFirstChatSnapshot } from "@opencrane/models/user-onboarding";
import { PersonaFirstChatConflictError, PersonaOnboardingStates } from "@opencrane/state/onboarding";

import { __LOCAL_DEVELOPMENT_BOOTSTRAPS } from "./local-development.fixtures";
import type { _LocalDevelopmentFirstChatAnswerCommand, _LocalDevelopmentFirstChatGateway, _LocalDevelopmentState } from "./local-development.owner.types";

/** Stable conversation coordinate used by the disposable first chat. */
const _CONVERSATION_ID = "local-onboarding-conversation";

/** Stable timestamp that keeps local first-chat snapshots deterministic. */
const _NOW = "2026-09-10T09:00:00.000Z";

/** Reads the approved archetype only after the persona reaches Ready. */
function _ReadyArchetype(state: _LocalDevelopmentState): PersonaFirstChatArchetypes | undefined
{
	if (state.persona.state === PersonaOnboardingStates.Ready)
	{
		return state.archetype;
	}
	return undefined;
}

/** Builds the reviewed persona and source pinned to a first chat. */
function _PinnedEvidence(archetype: PersonaFirstChatArchetypes)
{
	const fixture = __LOCAL_DEVELOPMENT_BOOTSTRAPS[archetype];
	return {
		persona: { revisionId: `local-persona-${archetype}`, displayName: fixture.displayName, archetype, primaryColour: fixture.firstChatColour },
		contentRevision: { id: fixture.revisionId, digest: fixture.digest, sourceLabel: fixture.sourceLabel }
	};
}

/** Creates an empty survey-stage first-chat projection. */
function _SurveySnapshot(interviewStarted: boolean): PersonaFirstChatSnapshot
{
	const state = interviewStarted ? UserOnboardingRouteStates.SurveyInProgress : UserOnboardingRouteStates.SurveyPending;
	return { workflowVersion: 1, state, conversationId: null, persona: null, contentRevision: null, transcript: [], currentQuestion: null, answerCount: 0, questionCount: 0, canConclude: false, startedAt: null, completedAt: null };
}

/** Creates the valid pending projection after persona approval. */
function _PendingSnapshot(archetype: PersonaFirstChatArchetypes): PersonaFirstChatSnapshot
{
	const fixture = __LOCAL_DEVELOPMENT_BOOTSTRAPS[archetype];
	return { workflowVersion: 1, state: UserOnboardingRouteStates.BootstrapChatPending, conversationId: null, ..._PinnedEvidence(archetype), transcript: [], currentQuestion: null, answerCount: 0, questionCount: fixture.questions.length, canConclude: false, startedAt: null, completedAt: null };
}

/** Creates the active or completed reviewed first-chat projection. */
export function _CreateLocalDevelopmentFirstChatSnapshot(state: _LocalDevelopmentState): PersonaFirstChatSnapshot
{
	const archetype = _ReadyArchetype(state);
	if (archetype === undefined)
	{
		return _SurveySnapshot(state.persona.interviewId !== null);
	}
	if (!state.firstChatStarted)
	{
		return _PendingSnapshot(archetype);
	}
	const fixture = __LOCAL_DEVELOPMENT_BOOTSTRAPS[archetype];
	const transcript: PersonaFirstChatSnapshot["transcript"][number][] = [{ ordinal: 1, role: PersonaFirstChatTranscriptRoles.Assistant, kind: PersonaFirstChatTranscriptKinds.Opening, text: fixture.opening, questionOrdinal: null }];
	for (let index = 0; index < fixture.questions.length; index += 1)
	{
		transcript.push({ ordinal: transcript.length + 1, role: PersonaFirstChatTranscriptRoles.Assistant, kind: PersonaFirstChatTranscriptKinds.Question, text: fixture.questions[index]!, questionOrdinal: index + 1 });
		const answer = state.firstChatAnswers[index];
		if (answer === undefined)
		{
			break;
		}
		transcript.push({ ordinal: transcript.length + 1, role: PersonaFirstChatTranscriptRoles.User, kind: PersonaFirstChatTranscriptKinds.Answer, text: answer, questionOrdinal: index + 1 });
	}
	const nextQuestionText = fixture.questions[state.firstChatAnswers.length];
	const currentQuestion = nextQuestionText === undefined ? null : { ordinal: state.firstChatAnswers.length + 1, text: nextQuestionText };
	const routeState = state.firstChatCompleted ? UserOnboardingRouteStates.Completed : UserOnboardingRouteStates.BootstrapChatInProgress;
	const canConclude = !state.firstChatCompleted && state.firstChatAnswers.length === fixture.questions.length;
	const completedAt = state.firstChatCompleted ? _NOW : null;
	return { workflowVersion: 1, state: routeState, conversationId: _CONVERSATION_ID, ..._PinnedEvidence(archetype), transcript, currentQuestion, answerCount: state.firstChatAnswers.length, questionCount: fixture.questions.length, canConclude, startedAt: _NOW, completedAt };
}

/** Creates the route projection without changing first-chat state. */
function _RouteSnapshot(state: _LocalDevelopmentState)
{
	const archetype = _ReadyArchetype(state);
	let routeState = state.persona.interviewId === null ? UserOnboardingRouteStates.SurveyPending : UserOnboardingRouteStates.SurveyInProgress;
	if (archetype !== undefined)
	{
		routeState = state.firstChatStarted ? UserOnboardingRouteStates.BootstrapChatInProgress : UserOnboardingRouteStates.BootstrapChatPending;
	}
	if (state.firstChatCompleted)
	{
		routeState = UserOnboardingRouteStates.Completed;
	}
	const personaRevisionId = archetype === undefined ? null : `local-persona-${archetype}`;
	const bootstrapConversationId = state.firstChatStarted ? _CONVERSATION_ID : null;
	const completedAt = state.firstChatCompleted ? _NOW : null;
	return { workflowVersion: 1, state: routeState, personaInterviewId: state.persona.interviewId, personaRevisionId, bootstrapConversationId, startedAt: _NOW, updatedAt: _NOW, completedAt };
}

/** Returns whether a retry exactly matches the command already applied under its key. */
function _SameAnswer(left: _LocalDevelopmentFirstChatAnswerCommand, right: _LocalDevelopmentFirstChatAnswerCommand): boolean
{
	return left.expectedConversationId === right.expectedConversationId && left.expectedQuestionOrdinal === right.expectedQuestionOrdinal && left.text === right.text;
}

/** Throws the current valid projection as a recoverable first-chat conflict. */
function _Conflict(state: _LocalDevelopmentState): never
{
	throw new PersonaFirstChatConflictError(_CreateLocalDevelopmentFirstChatSnapshot(state));
}

/** Creates the current first-chat gateway over the shared local state owner. */
export function _CreateLocalDevelopmentFirstChatGateway(state: _LocalDevelopmentState): _LocalDevelopmentFirstChatGateway
{
	return {
		loadRouteState: async function _LoadRouteState() { return _RouteSnapshot(state); },
		load: async function _Load() { return _CreateLocalDevelopmentFirstChatSnapshot(state); },
		start: async function _Start()
		{
			state.firstChatStarted = true;
			return _CreateLocalDevelopmentFirstChatSnapshot(state);
		},
		answer: async function _Answer(command: _LocalDevelopmentFirstChatAnswerCommand)
		{
			const receipt = state.firstChatReceipts.get(command.idempotencyKey);
			if (receipt !== undefined)
			{
				if (_SameAnswer(receipt.command, command))
				{
					return _CreateLocalDevelopmentFirstChatSnapshot(state);
				}
				return _Conflict(state);
			}
			const expectedOrdinal = state.firstChatAnswers.length + 1;
			if (command.expectedConversationId !== _CONVERSATION_ID || command.expectedQuestionOrdinal !== expectedOrdinal || state.firstChatCompleted)
			{
				return _Conflict(state);
			}
			state.firstChatAnswers.push(command.text);
			const snapshot = _CreateLocalDevelopmentFirstChatSnapshot(state);
			state.firstChatReceipts.set(command.idempotencyKey, { command });
			return snapshot;
		},
		conclude: async function _Conclude()
		{
			if (state.firstChatCompleted)
			{
				return _CreateLocalDevelopmentFirstChatSnapshot(state);
			}
			if (state.firstChatAnswers.length !== __LOCAL_DEVELOPMENT_BOOTSTRAPS[state.archetype].questions.length)
			{
				throw new Error("Answer every local first-chat question first.");
			}
			state.firstChatCompleted = true;
			return _CreateLocalDevelopmentFirstChatSnapshot(state);
		}
	};
}
