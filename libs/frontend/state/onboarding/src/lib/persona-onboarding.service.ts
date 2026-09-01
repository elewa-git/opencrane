import { Injectable, inject } from "@angular/core";

import { PersonaOnboardingStates, type PersonaOnboardingSnapshot, type PersonaResolutionKinds } from "@opencrane/models/user-onboarding";

import { PERSONA_GATEWAY, type PersonaGateway } from "./persona-gateway.types";

/**
 * Orchestrates the resumable persona lifecycle through {@link PersonaGateway}. Every command reloads
 * the authority-owned projection, and draft preparation waits until scoring has no unresolved tie,
 * so callers never advance the browser from an assumed write result.
 *
 * Called by: {@link PersonaOnboardingStore}, which serializes UI commands and adopts each result.
 */
@Injectable({ providedIn: "root" })
export class PersonaOnboardingService
{
	/** Narrow persona API port supplied by the app composition root. */
	private readonly _persona = inject<PersonaGateway>(PERSONA_GATEWAY);

	/** Read the durable persona projection without creating or advancing lifecycle evidence. */
	public read(): Promise<PersonaOnboardingSnapshot>
	{
		return this._persona.load();
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

	/** Finish an interrupted review transition only when its durable snapshot still needs a draft. */
	public async ensureDraft(snapshot: PersonaOnboardingSnapshot): Promise<PersonaOnboardingSnapshot>
	{
		return this._prepareDraft(snapshot);
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

	/** Create a new or resumed survey from the review state. */
	public async restart(): Promise<PersonaOnboardingSnapshot>
	{
		await this._persona.startInterview();
		return this._persona.load();
	}

	/** Create a draft only when a completed command proves review evidence has no unresolved tie. */
	private async _prepareDraft(snapshot: PersonaOnboardingSnapshot): Promise<PersonaOnboardingSnapshot>
	{
		if (snapshot.state !== PersonaOnboardingStates.Review || snapshot.personaRevisionId || !snapshot.interviewId)
		{
			return snapshot;
		}

		await this._persona.createDraft(snapshot.interviewId);
		return this.read();
	}
}
