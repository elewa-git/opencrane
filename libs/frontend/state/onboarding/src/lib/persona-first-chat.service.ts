import { Injectable, inject } from "@angular/core";
import { UserOnboardingRouteStates, type PersonaFirstChatSnapshot } from "@opencrane/models/user-onboarding";

import { PERSONA_FIRST_CHAT_GATEWAY, type PersonaFirstChatAnswerCommand, type PersonaFirstChatGateway, type UserOnboardingRouteSnapshot } from "./persona-first-chat.types";

/**
 * The one seam between onboarding stores and the first-chat API, with the checks that must hold
 * before a write is even attempted.
 *
 * The gateway is a thin transport: this class is where a command is refused for being wrong for the
 * chat the caller just read. {@link start} and {@link conclude} both take the snapshot the caller is
 * acting on and check it, so a stale screen cannot start a second conversation or claim onboarding is
 * finished. The server checks again — these throws exist to fail early and locally, not to be the
 * only guard.
 *
 * Nothing is cached here and no state is held, which is why it is a root singleton while the stores
 * that use it are per-visit.
 *
 * Called by: {@link PersonaFirstChatStore} for the whole first-chat flow, and
 * PersonaOnboardingStore.resolveReadyRoute for {@link loadRouteState} alone, once a persona is
 * approved.
 *
 * @see PersonaFirstChatGateway for what each call does on the server.
 */
@Injectable({ providedIn: "root" })
export class PersonaFirstChatService
{
	/** The first-chat port; the app binds it to the generated-client adapter. */
	private readonly _gateway = inject<PersonaFirstChatGateway>(PERSONA_FIRST_CHAT_GATEWAY);

	/**
	 * Reads which onboarding step the user is on.
	 *
	 * Safe anywhere, including before a chat exists: it starts nothing, creates nothing, and carries
	 * no transcript, which is what makes it cheap enough to decide navigation with.
	 *
	 * @returns The user's current onboarding route state.
	 * @throws Error when the route cannot be read; the caller decides whether that is retryable.
	 */
	public loadRouteState(): Promise<UserOnboardingRouteSnapshot>
	{
		return this._gateway.loadRouteState();
	}

	/**
	 * Starts the one onboarding conversation for this user.
	 *
	 * Refuses unless the snapshot the caller just read says the chat is still waiting to start and has
	 * no conversation yet, so a stale screen cannot ask for a second onboarding conversation.
	 *
	 * @param snapshot - The chat as the caller last read it; only checked, never sent.
	 * @returns The chat with its conversation, persona and question source filled in.
	 * @throws Error when that snapshot is not waiting to start, or already has a conversation.
	 */
	public start(snapshot: PersonaFirstChatSnapshot): Promise<PersonaFirstChatSnapshot>
	{
		if (snapshot.state !== UserOnboardingRouteStates.BootstrapChatPending || snapshot.conversationId !== null)
		{
			throw new Error("The first conversation is not ready to start.");
		}
		return this._gateway.start();
	}

	/**
	 * Reads the current chat.
	 *
	 * Read-only, so it is the safe thing to call again after any failure: it neither starts the chat
	 * nor moves it on to the next question.
	 *
	 * @returns The chat as it stands, including its transcript so far.
	 * @throws Error when the chat cannot be read.
	 */
	public load(): Promise<PersonaFirstChatSnapshot>
	{
		return this._gateway.load();
	}

	/**
	 * Sends one answer exactly as the caller prepared it.
	 *
	 * Passed through unchanged on purpose. The command carries the question it was written for and a
	 * retry key, and the caller owns both: keeping the same key across retries is what stops one answer
	 * being recorded twice, so this method must not rebuild or re-key it.
	 *
	 * @param command - The conversation and question the answer is for, the text, and the retry key.
	 * @returns The chat after the answer, with the next question selected by the server.
	 * @throws PersonaFirstChatConflictError when the chat has already moved past that question; the
	 *   error carries the current chat, which the caller should adopt instead of retrying.
	 * @throws Error when the answer could not be saved.
	 */
	public answer(command: PersonaFirstChatAnswerCommand): Promise<PersonaFirstChatSnapshot>
	{
		return this._gateway.answer(command);
	}

	/**
	 * Asks the server to finish onboarding.
	 *
	 * Refuses unless the snapshot the caller just read both allows concluding and is a chat still in
	 * progress, so an old screen cannot finish onboarding on stale information. The server checks the
	 * answers again itself.
	 *
	 * @param snapshot - The chat as the caller last read it; only checked, never sent.
	 * @returns The finished chat, with its completion time set by the server.
	 * @throws Error when that snapshot does not allow concluding, or when the call fails.
	 */
	public async conclude(snapshot: PersonaFirstChatSnapshot): Promise<PersonaFirstChatSnapshot>
	{
		if (!snapshot.canConclude || snapshot.state !== UserOnboardingRouteStates.BootstrapChatInProgress)
		{
			throw new Error("The first conversation is not ready for server-validated completion.");
		}
		return this._gateway.conclude();
	}
}
