import { Injectable, inject } from "@angular/core";

import { ControlPlaneApiService } from "@opencrane/core";
import { ___ParsePersonaFirstChatSnapshot, type PersonaFirstChatSnapshot } from "@opencrane/models/user-onboarding";

import { PersonaFirstChatConflictError, type PersonaFirstChatAnswerCommand, type PersonaFirstChatGateway, type UserOnboardingRouteSnapshot } from "./persona-first-chat.types.js";
import { _ParsePersonaFirstChatConflictSnapshot, _ParseUserOnboardingRouteSnapshot } from "./persona-first-chat.validator.js";

/** Live first-chat gateway backed exclusively by the generated signed-in-owner API client. */
@Injectable()
export class OpenCranePersonaFirstChatGateway implements PersonaFirstChatGateway
{
	/** Shared cookie-session client generated from the OpenCrane API contract. */
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

/** Require one successful generated response and validate its complete durable projection. */
function _RequireSnapshot(data: unknown, error: unknown, message: string): PersonaFirstChatSnapshot
{
	if (error || !data) throw new Error(message);
	return ___ParsePersonaFirstChatSnapshot(data);
}
