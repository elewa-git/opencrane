import { Injectable, inject } from "@angular/core";

import { PERSONA_FIRST_CHAT_GATEWAY, PersonaFirstChatAnswerCommand, PersonaFirstChatGateway, PersonaFirstChatSnapshot, UserOnboardingRouteSnapshot, UserOnboardingRouteStates } from "./persona-first-chat.types.js";

/** Server-backed orchestration for the resumable, deterministic first-chat workflow. */
@Injectable({ providedIn: "root" })
export class PersonaFirstChatService
{
	/** Narrow generated-client gateway supplied by the app composition root. */
	private readonly _gateway = inject<PersonaFirstChatGateway>(PERSONA_FIRST_CHAT_GATEWAY);

	/** Load the public route state without creating first-chat evidence. */
	public loadRouteState(): Promise<UserOnboardingRouteSnapshot>
	{
		return this._gateway.loadRouteState();
	}

	/** Resume the exact durable conversation, starting only from the explicit pending state. */
	public async loadOrStart(): Promise<PersonaFirstChatSnapshot>
	{
		const snapshot = await this._gateway.load();
		if (snapshot.state === UserOnboardingRouteStates.BootstrapChatPending) return this._gateway.start();
		return snapshot;
	}

	/** Retry a failed authoritative read without creating or advancing evidence. */
	public load(): Promise<PersonaFirstChatSnapshot>
	{
		return this._gateway.load();
	}

	/** Admit one answer under the caller's retry-stable key, preserving that key on failure. */
	public answer(command: PersonaFirstChatAnswerCommand): Promise<PersonaFirstChatSnapshot>
	{
		return this._gateway.answer(command);
	}

	/** Request conclusion only when the latest server projection says all evidence is ready. */
	public async conclude(snapshot: PersonaFirstChatSnapshot): Promise<PersonaFirstChatSnapshot>
	{
		if (!snapshot.canConclude || snapshot.state !== UserOnboardingRouteStates.BootstrapChatInProgress)
		{
			throw new Error("The first conversation is not ready for server-validated completion.");
		}
		return this._gateway.conclude();
	}
}
