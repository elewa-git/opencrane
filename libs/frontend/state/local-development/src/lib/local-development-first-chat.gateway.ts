import { Injectable, inject } from "@angular/core";

import { PersonaFirstChatTranscriptKinds, PersonaFirstChatTranscriptRoles, PersonaOnboardingStates, UserOnboardingRouteStates, type PersonaFirstChatSnapshot } from "@opencrane/models/user-onboarding";
import { PersonaFirstChatConflictError, type PersonaFirstChatAnswerCommand, type PersonaFirstChatGateway, type UserOnboardingRouteSnapshot } from "@opencrane/state/onboarding";

import { LOCAL_COMMANDER_FIRST_CHAT_OPENING, LOCAL_COMMANDER_FIRST_CHAT_QUESTIONS } from "./local-development-first-chat.fixtures";
import { LocalDevelopmentState } from "./local-development-state";

/**
 * Implements the one-time bootstrap conversation against the same state as persona onboarding.
 * Persona approval unlocks this flow, and completing it makes the transcript available through the
 * workspace's onboarding-history projection.
 */
@Injectable()
export class LocalDevelopmentPersonaFirstChatGateway implements PersonaFirstChatGateway
{
	/** Shared lifecycle state that links persona approval with first-chat progress. */
	private readonly _state = inject(LocalDevelopmentState);

	/** Derive the onboarding route state from persona and first-chat progress. */
	public async loadRouteState(): Promise<UserOnboardingRouteSnapshot>
	{
		await this._state.delay();
		const firstChat = this._state.firstChat;
		const state = this._state.persona.state === PersonaOnboardingStates.Ready ? firstChat.state : UserOnboardingRouteStates.SurveyInProgress;
		return {
			workflowVersion: 1,
			state,
			personaInterviewId: this._state.persona.interviewId,
			personaRevisionId: this._state.persona.personaRevisionId,
			bootstrapConversationId: firstChat.conversationId,
			startedAt: "2026-08-21T08:00:00.000Z",
			updatedAt: firstChat.completedAt ?? firstChat.startedAt ?? "2026-08-21T08:00:00.000Z",
			completedAt: firstChat.completedAt
		};
	}

	/** Return the current first-chat projection. */
	public async load(): Promise<PersonaFirstChatSnapshot>
	{
		await this._state.delay();
		return this._state.firstChat;
	}

	/** Start or resume the one-time local bootstrap conversation. */
	public async start(): Promise<PersonaFirstChatSnapshot>
	{
		await this._state.delay();
		this._state.failOnce("first-chat-start");

		if (this._state.firstChat.conversationId)
		{
			return this._state.firstChat;
		}

		this._state.firstChat = {
			...this._state.firstChat,
			state: UserOnboardingRouteStates.BootstrapChatInProgress,
			conversationId: "onboarding-conversation-local-1",
			transcript: [
				{
					ordinal: 1,
					role: PersonaFirstChatTranscriptRoles.Assistant,
					kind: PersonaFirstChatTranscriptKinds.Opening,
					text: LOCAL_COMMANDER_FIRST_CHAT_OPENING,
					questionOrdinal: null
				},
				{
					ordinal: 2,
					role: PersonaFirstChatTranscriptRoles.Assistant,
					kind: PersonaFirstChatTranscriptKinds.Question,
					text: LOCAL_COMMANDER_FIRST_CHAT_QUESTIONS[0]!,
					questionOrdinal: 1
				}
			],
			currentQuestion: {
				ordinal: 1,
				text: LOCAL_COMMANDER_FIRST_CHAT_QUESTIONS[0]!
			},
			startedAt: "2026-08-21T09:30:00.000Z"
		};
		return this._state.firstChat;
	}

	/** Record an answer only when its conversation and question still match the displayed state. */
	public async answer(command: PersonaFirstChatAnswerCommand): Promise<PersonaFirstChatSnapshot>
	{
		await this._state.delay();
		this._state.failOnce(`first-chat-answer-${command.expectedQuestionOrdinal}`);
		const current = this._state.firstChat;

		if (current.conversationId !== command.expectedConversationId || current.currentQuestion?.ordinal !== command.expectedQuestionOrdinal)
		{
			throw new PersonaFirstChatConflictError(current);
		}

		const answered = current.currentQuestion;

		if (!answered)
		{
			throw new PersonaFirstChatConflictError(current);
		}

		const nextOrdinal = answered.ordinal + 1;
		const nextText = LOCAL_COMMANDER_FIRST_CHAT_QUESTIONS[nextOrdinal - 1] ?? null;
		const transcript = [
			...current.transcript,
			{
				ordinal: current.transcript.length + 1,
				role: PersonaFirstChatTranscriptRoles.User,
				kind: PersonaFirstChatTranscriptKinds.Answer,
				text: command.text.trim(),
				questionOrdinal: answered.ordinal
			},
			...(!nextText
				? []
				: [
					{
						ordinal: current.transcript.length + 2,
						role: PersonaFirstChatTranscriptRoles.Assistant,
						kind: PersonaFirstChatTranscriptKinds.Question,
						text: nextText,
						questionOrdinal: nextOrdinal
					}
				])
		];
		this._state.firstChat = {
			...current,
			transcript,
			currentQuestion: !nextText
				? null
				: {
					ordinal: nextOrdinal,
					text: nextText
				},
			answerCount: answered.ordinal,
			canConclude: !nextText
		};
		return this._state.firstChat;
	}

	/** Mark the fully answered local bootstrap exchange complete. */
	public async conclude(): Promise<PersonaFirstChatSnapshot>
	{
		await this._state.delay();
		this._state.failOnce("first-chat-conclude");

		if (!this._state.firstChat.canConclude)
		{
			throw new Error("Answer every local first-chat question before finishing.");
		}

		this._state.firstChat = {
			...this._state.firstChat,
			state: UserOnboardingRouteStates.Completed,
			canConclude: false,
			completedAt: "2026-08-21T09:40:00.000Z"
		};
		return this._state.firstChat;
	}
}
