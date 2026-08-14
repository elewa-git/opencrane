import { type ResourceStatus, Injectable, inject, linkedSignal, resource, signal } from "@angular/core";
import { toObservable } from "@angular/core/rxjs-interop";
import { filter, firstValueFrom } from "rxjs";
import { UserOnboardingRouteStates, type PersonaFirstChatSnapshot } from "@opencrane/models/user-onboarding";

import { PersonaFirstChatService } from "./persona-first-chat.service";
import { PersonaFirstChatCommandPhases, type PersonaFirstChatPendingAnswer } from "./persona-first-chat.store.types";
import { PersonaFirstChatConflictError } from "./persona-first-chat.types";

/**
 * Holds the first-chat state for one visit to the first-chat route.
 *
 * Provided by PersonaFirstChatPageComponent in its own `providers`, so each visit gets a fresh
 * instance and nothing leaks between visits. Call {@link enter} once when the route activates;
 * everything else is driven by the user.
 *
 * Reading and writing are deliberately split. `chat` is a read-only Angular `resource` — its loader
 * only ever reads, so route entry can never hide a write inside a load. Commands ({@link answer},
 * {@link retry}, {@link enter}) call the service and then push the server's snapshot into that
 * resource with `set`. One command runs at a time: while {@link phase} is not Idle, further
 * commands return immediately instead of queueing.
 *
 * The store never advances the conversation itself. `currentQuestion`, `answerCount` and
 * `canConclude` always come from the server.
 *
 * @see PersonaFirstChatCommandPhases
 * @see PersonaFirstChatSnapshot
 */
@Injectable()
export class PersonaFirstChatStore
{
	/** Service that makes the first-chat calls to the server. */
	private readonly _firstChat = inject(PersonaFirstChatService);

	/** Whether `enter` has already succeeded for this route visit, so it is not re-run. */
	private _entered = false;

	/** Which command is running, if any. Anything but Idle blocks new commands. */
	private readonly _phase = signal<PersonaFirstChatCommandPhases>(PersonaFirstChatCommandPhases.Idle);

	/** An answer that failed to send, kept so Retry resends it unchanged. Cleared once accepted or on a conflict. */
	private readonly _pendingAnswer = signal<PersonaFirstChatPendingAnswer | null>(null);

	/** The chat, as a read-only `resource`. Its loader only reads; commands push their result in with `set`. */
	public readonly chat = resource({ loader: this._firstChat.load.bind(this._firstChat) });

	/** The resource's status as an observable, so a command can await the read finishing. */
	private readonly _chatStatus = toObservable(this.chat.status);

	/** The user's in-progress text, cleared automatically when the server moves to another question. */
	public readonly draftAnswer = linkedSignal<string, string>({ source: this._draftCoordinate.bind(this), computation: function _ResetDraft() { return ""; } });

	/** Message from the last failed command; the chat itself is untouched and still shown. */
	public readonly actionError = signal<string | null>(null);

	/** Read-only view of {@link phase} for the feature layer to render from. */
	public readonly phase = this._phase.asReadonly();

	/**
	 * Prepares the route: read the chat, then start it or conclude it if the server's state says so.
	 *
	 * Call this once when the route activates. It is safe to call again — after the first success it
	 * returns immediately, and it also returns immediately while another command is running.
	 *
	 * Order matters. The read happens first and is read-only; only then does it issue a start (when
	 * the route state is BootstrapChatPending) or a conclude (when the read says `canConclude`). That
	 * is what makes an interrupted conclude recoverable by simply re-entering the route.
	 *
	 * Called by: PersonaFirstChatPageComponent, after registering its navigation effect.
	 *
	 * @returns Resolves when entry finishes. Failures are not thrown: they are put in
	 *   {@link actionError} and {@link retry} re-runs entry.
	 */
	public async enter(): Promise<void>
	{
		if (this._entered || this._commandIsActive()) return;
		this._phase.set(PersonaFirstChatCommandPhases.Entering);
		this.actionError.set(null);
		try
		{
			// 1. Wait for the read-only resource, so route entry never hides a write inside a load.
			let snapshot = await this._readProjection();

			// 2. Start the chat only when the server says it is pending, and only as its own call.
			if (snapshot.state === UserOnboardingRouteStates.BootstrapChatPending) snapshot = await this._firstChat.start(snapshot);

			// 3. Only re-conclude when the chat we just read says it can be concluded.
			if (snapshot.canConclude)
			{
				this._phase.set(PersonaFirstChatCommandPhases.Concluding);
				snapshot = await this._firstChat.conclude(snapshot);
			}

			this.chat.set(snapshot);
			this._entered = true;
		}
		catch (error)
		{
			this.actionError.set(_FirstChatCommandError(error));
		}
		finally
		{
			this._phase.set(PersonaFirstChatCommandPhases.Idle);
		}
	}

	/**
	 * Stores the user's in-progress text. Nothing is sent.
	 *
	 * The draft clears itself when the server moves to a different conversation or question, so the
	 * caller does not need to reset it.
	 *
	 * @param value - Current composer text.
	 */
	public updateDraft(value: string): void
	{
		this.draftAnswer.set(value);
	}

	/**
	 * Sends one answer for the question the user can currently see.
	 *
	 * Does nothing at all — no error — when another command is running, when the chat has not loaded,
	 * when `expectedQuestionOrdinal` no longer matches the server's current question, or when the
	 * text is empty after trimming. Passing the ordinal the user actually saw is what stops an answer
	 * landing on the wrong question after the chat moved on.
	 *
	 * On failure the answer is kept, with its retry key, so {@link retry} resends the identical
	 * answer. On a conflict the server's chat is adopted instead and the pending answer is dropped.
	 * Concludes automatically when the server says the answer completed the set.
	 *
	 * Called by: PersonaFirstChatPageComponent.submitAnswer, from the composer's submit output.
	 *
	 * @param expectedQuestionOrdinal - The question number the user was answering.
	 * @param answer - Raw text from the composer; trimmed here.
	 * @returns Resolves when the attempt finishes. Check {@link actionError} for the outcome.
	 */
	public async answer(expectedQuestionOrdinal: number, answer: string): Promise<void>
	{
		if (this._commandIsActive() || !this.chat.hasValue()) return;
		const snapshot = this.chat.value();
		const text = answer.trim();
		if (snapshot.conversationId === null || snapshot.currentQuestion?.ordinal !== expectedQuestionOrdinal || text.length === 0) return;

		const pending = this._answerIntent(snapshot.conversationId, expectedQuestionOrdinal, text);
		this._pendingAnswer.set(pending);
		await this._submit(pending);
	}

	/**
	 * Retries whatever failed, picking the right thing automatically.
	 *
	 * In order: if an answer is still pending it resends that same answer with the same retry key; if
	 * the chat is ready to conclude it retries the conclude; otherwise it reloads the chat and re-runs
	 * {@link enter}. So one Retry button is enough — the caller does not need to know what failed.
	 * Returns immediately if a command is already running.
	 *
	 * Called by: PersonaFirstChatPageComponent.retry, from the retry output on the chat component.
	 *
	 * @returns Resolves when the retry finishes. Check {@link actionError} for the outcome.
	 */
	public async retry(): Promise<void>
	{
		if (this._commandIsActive()) return;
		const pending = this._pendingAnswer();
		if (pending !== null)
		{
			await this._submit(pending);
			return;
		}
		if (this.chat.hasValue() && this.chat.value().canConclude)
		{
			await this._conclude(this.chat.value());
			return;
		}
		this.actionError.set(null);
		this._entered = false;
		this.chat.reload();
		await this.enter();
	}

	/** Send a prepared answer, store whatever the server returns, and conclude if it says the set is complete. */
	private async _submit(pending: PersonaFirstChatPendingAnswer): Promise<void>
	{
		this._phase.set(PersonaFirstChatCommandPhases.Answering);
		this.actionError.set(null);
		try
		{
			// 1. Send the answer we kept, so a retry cannot create a second answer.
			let snapshot = await this._firstChat.answer(pending);
			this.chat.set(snapshot);
			this._pendingAnswer.set(null);

			// 2. Conclude only when the answer's own response says every answer is in.
			if (snapshot.canConclude)
			{
				this._phase.set(PersonaFirstChatCommandPhases.Concluding);
				snapshot = await this._firstChat.conclude(snapshot);
				this.chat.set(snapshot);
			}
		}
		catch (error)
		{
			if (error instanceof PersonaFirstChatConflictError)
			{
				this.chat.set(error.chat);
				this._pendingAnswer.set(null);
			}
			this.actionError.set(_FirstChatCommandError(error));
		}
		finally
		{
			this._phase.set(PersonaFirstChatCommandPhases.Idle);
		}
	}

	/** Retry just the conclude call, for a chat whose answers the server has already accepted. */
	private async _conclude(snapshot: PersonaFirstChatSnapshot): Promise<void>
	{
		this._phase.set(PersonaFirstChatCommandPhases.Concluding);
		this.actionError.set(null);
		try
		{
			this.chat.set(await this._firstChat.conclude(snapshot));
		}
		catch (error)
		{
			this.actionError.set(_FirstChatCommandError(error));
		}
		finally
		{
			this._phase.set(PersonaFirstChatCommandPhases.Idle);
		}
	}

	/** Whether a command is already running. */
	private _commandIsActive(): boolean
	{
		return this._phase() !== PersonaFirstChatCommandPhases.Idle;
	}

	/** Reuse the pending answer when the text and question are identical; otherwise make a new retry key. */
	private _answerIntent(expectedConversationId: string, expectedQuestionOrdinal: number, text: string): PersonaFirstChatPendingAnswer
	{
		const pending = this._pendingAnswer();
		if (pending?.expectedConversationId === expectedConversationId && pending.expectedQuestionOrdinal === expectedQuestionOrdinal && pending.text === text) return pending;
		return { expectedConversationId, expectedQuestionOrdinal, text, idempotencyKey: crypto.randomUUID() };
	}

	/** Wait for the resource to finish loading and return its value, or throw its error. */
	private async _readProjection(): Promise<PersonaFirstChatSnapshot>
	{
		if (this.chat.isLoading()) await firstValueFrom(this._chatStatus.pipe(filter(_ResourceSettled)));
		if (this.chat.hasValue()) return this.chat.value();
		throw this.chat.error() ?? new Error("The saved first conversation could not be loaded.");
	}

	/** Build the draft's reset key from the conversation id and current question number. */
	private _draftCoordinate(): string
	{
		if (!this.chat.hasValue()) return "unavailable";
		const snapshot = this.chat.value();
		return `${snapshot.conversationId ?? "pending"}:${snapshot.currentQuestion?.ordinal ?? "complete"}`;
	}
}

/** Whether the resource has finished loading, either with a value or with an error. */
function _ResourceSettled(status: ResourceStatus): boolean
{
	return status !== "loading" && status !== "reloading";
}

/** Turn any thrown value into a message safe to show, falling back to a generic one. */
function _FirstChatCommandError(error: unknown): string
{
	return error instanceof Error && error.message ? error.message : "OpenCrane could not continue the saved first conversation.";
}
