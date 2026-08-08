import { Injectable, inject } from "@angular/core";

import { PERSONA_GATEWAY, PersonaGateway, PersonaOnboardingSnapshot, PersonaOnboardingStates, PersonaResolutionKinds } from "./persona-gateway.types";

/** Server-backed orchestration for the resumable persona onboarding lifecycle. */
@Injectable({ providedIn: "root" })
export class PersonaOnboardingService
{
	/** Narrow persona API port supplied by the app composition root. */
	private readonly _persona = inject<PersonaGateway>(PERSONA_GATEWAY);

	/** Load the durable projection and resume draft creation after an interrupted transition. */
	public async load(): Promise<PersonaOnboardingSnapshot>
	{
		return this._prepareDraft(await this._persona.load());
	}

	/** Start or resume the reviewed survey, then reload its authoritative position. */
	public async start(): Promise<PersonaOnboardingSnapshot>
	{
		await this._persona.startInterview();
		return this._persona.load();
	}

	/** Save one exact reviewed choice, then reload the server-confirmed progress. */
	public async answer(interviewId: string, questionId: string, choiceId: string): Promise<PersonaOnboardingSnapshot>
	{
		await this._persona.recordAnswer(interviewId, questionId, choiceId);
		return this._persona.load();
	}

	/** Freeze a fully answered interview and create its draft when no resolution is pending. */
	public async complete(interviewId: string): Promise<PersonaOnboardingSnapshot>
	{
		await this._persona.completeInterview(interviewId);
		return this._prepareDraft(await this._persona.load());
	}

	/** Save one exact tie choice and create the draft after every tie has been resolved. */
	public async resolve(interviewId: string, kind: PersonaResolutionKinds, selectedValue: string): Promise<PersonaOnboardingSnapshot>
	{
		await this._persona.resolve(interviewId, kind, selectedValue);
		return this._prepareDraft(await this._persona.load());
	}

	/** Approve the exact immutable revision, then reload the resulting ready state. */
	public async approve(personaRevisionId: string): Promise<PersonaOnboardingSnapshot>
	{
		await this._persona.approve(personaRevisionId);
		return this._persona.load();
	}

	/** Create a new or resumed survey from the review screen. */
	public async restart(): Promise<PersonaOnboardingSnapshot>
	{
		await this._persona.startInterview();
		return this._persona.load();
	}

	/** Create a draft only when completion produced review evidence but no revision yet. */
	private async _prepareDraft(snapshot: PersonaOnboardingSnapshot): Promise<PersonaOnboardingSnapshot>
	{
		if (snapshot.state !== PersonaOnboardingStates.Review || snapshot.personaRevisionId !== null || snapshot.interviewId === null)
		{
			return snapshot;
		}

		await this._persona.createDraft(snapshot.interviewId);
		return this._persona.load();
	}
}
