import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService } from "@opencrane/core";
import { ___ParsePersonaFirstChatSnapshot, type PersonaFirstChatSnapshot } from "@opencrane/models/user-onboarding";

import { PersonaFirstChatConflictError, type PersonaFirstChatAnswerCommand, type PersonaFirstChatGateway, type UserOnboardingRouteSnapshot } from "./persona-first-chat.types";
import { _ParsePersonaFirstChatConflictSnapshot, _ParseUserOnboardingRouteSnapshot } from "./persona-first-chat.validator";

/**
 * The real {@link PersonaFirstChatGateway}: it calls the signed-in user's onboarding endpoints and
 * validates every response before anyone else sees it.
 *
 * This is the only place in the frontend that knows the onboarding URLs. Nothing is trusted as it
 * arrives: each response goes through the model package's parser, so a store never has to guard
 * against a half-formed snapshot, and a response that does not validate fails the call instead of
 * reaching the screen. Transport details are never shown either — every failure becomes a sentence a
 * user can read.
 *
 * Bound to the PERSONA_FIRST_CHAT_GATEWAY token in apps/opencrane-ui/src/app/app.config.ts; tests
 * replace it at that token rather than stubbing HTTP.
 *
 * @see PersonaFirstChatGateway for what each method promises its callers.
 */
@Injectable()
export class OpenCranePersonaFirstChatGateway implements PersonaFirstChatGateway
{
	/** The generated API client, already carrying the user's session cookie. */
	private readonly _api = inject(ControlPlaneApiService);

	/** @inheritdoc */
	public async loadRouteState(): Promise<UserOnboardingRouteSnapshot>
	{
		const { data, error } = await this._api.client.GET("/me/onboarding");
		if (error || !data) throw new Error("The onboarding authority could not load your saved route.");
		return _ParseUserOnboardingRouteSnapshot(data);
	}

	/** @inheritdoc */
	public async load(): Promise<PersonaFirstChatSnapshot>
	{
		const { data, error } = await this._api.client.GET("/me/onboarding/chat");
		return _RequireSnapshot(data, error, "The first conversation could not be resumed.");
	}

	/** @inheritdoc */
	public async start(): Promise<PersonaFirstChatSnapshot>
	{
		const { data, error } = await this._api.client.POST("/me/onboarding/chat/start");
		return _RequireSnapshot(data, error, "The first conversation could not be started.");
	}

	/** @inheritdoc */
	public async answer(command: PersonaFirstChatAnswerCommand): Promise<PersonaFirstChatSnapshot>
	{
		const { data, error } = await this._api.client.POST("/me/onboarding/chat/answers", { body: command });

		// A rejected answer can still carry the chat as the server sees it now. When it does, raise the
		// conflict error so the store can adopt that chat instead of retrying the same answer.
		const conflict = _ParsePersonaFirstChatConflictSnapshot(error);
		if (conflict !== null) throw new PersonaFirstChatConflictError(conflict);
		return _RequireSnapshot(data, error, "Your answer could not be saved.");
	}

	/** @inheritdoc */
	public async conclude(): Promise<PersonaFirstChatSnapshot>
	{
		const { data, error } = await this._api.client.POST("/me/onboarding/chat/conclude");
		return _RequireSnapshot(data, error, "OpenCrane could not validate onboarding completion.");
	}
}

/**
 * Turn one API result into a validated snapshot, or fail with copy the user can read.
 *
 * Every first-chat call shares this: a failed request or an empty body becomes the caller's own
 * message, and anything else is parsed by the model package, which throws if the snapshot is
 * incomplete. That keeps stores free of response-shape checks.
 *
 * @param data - Body from the generated client, still unvalidated.
 * @param error - Whatever the generated client reported, if anything.
 * @param message - What to tell the user when this call did not come back.
 * @returns The validated snapshot.
 * @throws Error with `message` when the request failed or returned nothing, and whatever the model
 *   validator throws when the body is not a complete snapshot.
 */
function _RequireSnapshot(data: unknown, error: unknown, message: string): PersonaFirstChatSnapshot
{
	if (error || !data) throw new Error(message);
	return ___ParsePersonaFirstChatSnapshot(data);
}
