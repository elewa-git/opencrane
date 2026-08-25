import { Injectable, inject } from "@angular/core";

import { PersonaOnboardingStates, type PersonaOnboardingSnapshot, type PersonaResolutionKinds } from "@opencrane/models/user-onboarding";
import { type PersonaGateway } from "@opencrane/state/onboarding";

import { __LocalDevelopmentChoiceId } from "./local-development-archetype.fixtures";
import { __CreateLocalPendingFirstChat } from "./local-development-first-chat.fixtures";
import { __CreateLocalPersonaInterview } from "./local-development-persona-interview.fixtures";
import { __CreateLocalPersonaPreDraftReview, __CreateLocalPersonaReview } from "./local-development-persona-result.fixtures";
import { LocalDevelopmentState } from "./local-development-state";

/**
 * Implements persona survey commands against shared Tier 1 state. Selected answers survive each
 * transition into review, and approval resets the shared first-chat projection for the next route.
 */
@Injectable()
export class LocalDevelopmentPersonaGateway implements PersonaGateway
{
	/** Shared lifecycle state used by the first-chat gateway after approval. */
	private readonly _state = inject(LocalDevelopmentState);

	/** Return the current persona projection. */
	public async load(): Promise<PersonaOnboardingSnapshot>
	{
		await this._state.delay();
		return this._state.persona;
	}

	/** Start a new local interview or retain the already active one. */
	public async startInterview(): Promise<void>
	{
		await this._state.delay();
		this._state.failOnce("persona-start");

		if (this._state.persona.state !== PersonaOnboardingStates.Interview)
		{
			this._state.persona = __CreateLocalPersonaInterview();
		}
	}

	/** Record an offered choice only while the matching interview is active. */
	public async recordAnswer(interviewId: string, questionId: string, choiceId: string): Promise<void>
	{
		await this._state.delay();
		this._state.failOnce(`persona-answer-${questionId}`);
		const current = this._state.persona;

		if (current.interviewId !== interviewId || current.state !== PersonaOnboardingStates.Interview)
		{
			throw new Error("The local interview changed. Reload it before answering.");
		}

		const question = current.questions.find(candidate => candidate.id === questionId);

		if (!question || !question.choices.some(choice => choice.id === choiceId))
		{
			throw new Error("The local interview does not offer that answer.");
		}

		const expectedChoiceId = __LocalDevelopmentChoiceId(this._state.fixture, questionId);

		if (!expectedChoiceId || choiceId !== expectedChoiceId)
		{
			const expectedChoice = question.choices.find(choice => choice.id === expectedChoiceId);
			throw new Error(`Tier 1 follows the reviewed ${this._state.fixture.displayName} path. Choose “${expectedChoice?.label ?? expectedChoiceId}” to continue.`);
		}

		const questions = current.questions.map(candidate => candidate.id === questionId
			? {
				...candidate,
				selectedChoiceId: choiceId
			}
			: candidate);
		this._state.persona = {
			...current,
			questions,
			answeredQuestionCount: questions.filter(candidate => Boolean(candidate.selectedChoiceId)).length
		};
	}

	/** Move a fully answered interview to review without losing its selected choices. */
	public async completeInterview(interviewId: string): Promise<void>
	{
		await this._state.delay();
		const current = this._state.persona;

		if (current.interviewId !== interviewId || current.answeredQuestionCount !== current.questionCount)
		{
			throw new Error("Answer every local interview question before continuing.");
		}

		this._state.persona = __CreateLocalPersonaPreDraftReview(current.questions, this._state.fixture);
	}

	/** Reject tie commands because the local interview fixture never produces a tie. */
	public async resolve(_interviewId: string, _kind: PersonaResolutionKinds, _selectedValue: string): Promise<void>
	{
		throw new Error("The selected local scenario has no unresolved persona tie.");
	}

	/** Create the persona review only after the matching interview reaches review. */
	public async createDraft(interviewId: string): Promise<void>
	{
		await this._state.delay();
		const current = this._state.persona;

		if (current.interviewId !== interviewId || current.state !== PersonaOnboardingStates.Review)
		{
			throw new Error("The local persona draft is not ready.");
		}

		this._state.persona = __CreateLocalPersonaReview(current.questions, this._state.fixture);
	}

	/** Approve the displayed revision and install the pending first-chat state. */
	public async approve(personaRevisionId: string): Promise<void>
	{
		await this._state.delay();
		this._state.failOnce("persona-approve");

		if (this._state.persona.personaRevisionId !== personaRevisionId)
		{
			throw new Error("The local persona review changed before approval.");
		}

		this._state.persona = {
			...this._state.persona,
			state: PersonaOnboardingStates.Ready
		};
		this._state.firstChat = __CreateLocalPendingFirstChat(this._state.fixture);
	}
}
