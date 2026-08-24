import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService } from "@opencrane/core";
import { ___ParsePersonaOnboardingSnapshot, type PersonaOnboardingSnapshot, type PersonaResolutionKinds } from "@opencrane/models/user-onboarding";
import { type PersonaGateway } from "@opencrane/state/onboarding";

/**
 * Implements the signed-in owner's persona port with the generated Control Plane client. Every read
 * passes through the model-owned parser before reaching state, while command failures become fixed
 * feature copy rather than exposing response bodies.
 *
 * Called by: {@link provideOpenCraneUiLiveGateways}, which binds this class to `PERSONA_GATEWAY`.
 * @implements PersonaGateway
 */
@Injectable()
export class OpenCranePersonaGateway implements PersonaGateway
{
	/** Shared cookie-session client generated from the OpenCrane API contract. */
	private readonly _api = inject(ControlPlaneApiService);

	/** @inheritdoc */
	public async load(): Promise<PersonaOnboardingSnapshot>
	{
		const { data, error } = await this._api.client.GET("/me/persona");
		if (error || !data)
		{
			throw new Error("The persona authority could not load your saved onboarding position.");
		}

		return ___ParsePersonaOnboardingSnapshot(data);
	}

	/** @inheritdoc */
	public async startInterview(): Promise<void>
	{
		const { error } = await this._api.client.POST("/me/persona/interview", { body: {} });
		_ThrowOnError(error, "The persona interview could not be started.");
	}

	/** @inheritdoc */
	public async recordAnswer(interviewId: string, questionId: string, choiceId: string): Promise<void>
	{
		const { error } = await this._api.client.POST("/me/persona/interviews/{interviewId}/answers/{questionId}", {
			params: { path: { interviewId, questionId } },
			body: { choiceId }
		});
		_ThrowOnError(error, "The selected answer could not be saved.");
	}

	/** @inheritdoc */
	public async completeInterview(interviewId: string): Promise<void>
	{
		const { error } = await this._api.client.POST("/me/persona/interviews/{interviewId}/complete", { params: { path: { interviewId } }, body: {} });
		_ThrowOnError(error, "The completed interview could not be frozen.");
	}

	/** @inheritdoc */
	public async resolve(interviewId: string, kind: PersonaResolutionKinds, selectedValue: string): Promise<void>
	{
		const { error } = await this._api.client.POST("/me/persona/interviews/{interviewId}/resolutions/{kind}", {
			params: { path: { interviewId, kind } },
			body: { selectedValue }
		});
		_ThrowOnError(error, "The tie choice could not be saved.");
	}

	/** @inheritdoc */
	public async createDraft(interviewId: string): Promise<void>
	{
		const { error } = await this._api.client.POST("/me/persona/interviews/{interviewId}/draft", { params: { path: { interviewId } }, body: {} });
		_ThrowOnError(error, "The persona draft could not be prepared for review.");
	}

	/** @inheritdoc */
	public async approve(personaRevisionId: string): Promise<void>
	{
		const { error } = await this._api.client.POST("/me/persona/drafts/{personaRevisionId}/approve", { params: { path: { personaRevisionId } }, body: {} });
		_ThrowOnError(error, "The reviewed persona could not be approved.");
	}
}

/** Convert a generated non-success response into fixed feature copy that exposes no response body. */
function _ThrowOnError(error: unknown, message: string): void
{
	if (error)
	{
		throw new Error(message);
	}
}
