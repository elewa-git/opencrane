import { type ResourceStatus, Injectable, inject, linkedSignal, resource, signal } from "@angular/core";
import { toObservable } from "@angular/core/rxjs-interop";
import { filter, firstValueFrom } from "rxjs";

import { PersonaFirstChatService } from "./persona-first-chat.service.js";
import { PersonaFirstChatCommandPhases, type PersonaFirstChatPendingAnswer } from "./persona-first-chat.store.types.js";
import { PersonaFirstChatConflictError, type PersonaFirstChatSnapshot, UserOnboardingRouteStates } from "./persona-first-chat.types.js";

/** Component-scoped state owner for one resumable first-chat route instance. */
@Injectable()
export class PersonaFirstChatStore
{
	/** Application service that performs explicit first-chat authority commands. */
	private readonly _firstChat = inject(PersonaFirstChatService);

	/** Whether this route instance has completed its one-shot entry reconciliation. */
	private _entered = false;

	/** Exact command phase currently owning route-instance transport admission. */
	private readonly _phase = signal<PersonaFirstChatCommandPhases>(PersonaFirstChatCommandPhases.Idle);

	/** Exact failed answer coordinates retained until admission or authoritative conflict. */
	private readonly _pendingAnswer = signal<PersonaFirstChatPendingAnswer | null>(null);

	/** Pure authoritative read used for initial load and explicit refresh. */
	public readonly chat = resource({ loader: this._firstChat.load.bind(this._firstChat) });

	/** Observable status bridge used only to await the pure resource read from an explicit command. */
	private readonly _chatStatus = toObservable(this.chat.status);

	/** Controlled draft reset only when the authoritative conversation/question coordinate changes. */
	public readonly draftAnswer = linkedSignal<string, string>({ source: this._draftCoordinate.bind(this), computation: function _ResetDraft() { return ""; } });

	/** Bounded command failure that leaves the latest authoritative projection available. */
	public readonly actionError = signal<string | null>(null);

	/** Read-only command phase used to select accurate presentation without duplicating state. */
	public readonly phase = this._phase.asReadonly();

	/** Enter once by awaiting the read projection, then explicitly starting or concluding if required. */
	public async enter(): Promise<void>
	{
		if (this._entered || this._commandIsActive()) return;
		this._phase.set(PersonaFirstChatCommandPhases.Entering);
		this.actionError.set(null);
		try
		{
			// 1. Await the read-only resource so route entry never hides a mutation in its loader.
			let snapshot = await this._readProjection();

			// 2. Start only the exact durable pending exchange through an explicit command.
			if (snapshot.state === UserOnboardingRouteStates.BootstrapChatPending) snapshot = await this._firstChat.start(snapshot);

			// 3. Resume an interrupted conclusion only from the latest server-confirmed evidence.
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

	/** Update only the controlled unsaved draft for the current authoritative question. */
	public updateDraft(value: string): void
	{
		this.draftAnswer.set(value);
	}

	/** Admit one answer while preserving its exact idempotency coordinates across failure. */
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

	/** Retry the exact failed command or refresh the current authoritative projection. */
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

	/** Submit one already-bound answer and adopt only the returned authoritative projection. */
	private async _submit(pending: PersonaFirstChatPendingAnswer): Promise<void>
	{
		this._phase.set(PersonaFirstChatCommandPhases.Answering);
		this.actionError.set(null);
		try
		{
			// 1. Submit the retained exact intent so retries cannot mint a second logical answer.
			let snapshot = await this._firstChat.answer(pending);
			this.chat.set(snapshot);
			this._pendingAnswer.set(null);

			// 2. Conclude only after the answer response itself proves all evidence is present.
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

	/** Retry only the server conclusion for an already-admitted three-answer projection. */
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

	/** Whether one explicit command currently owns route-instance admission. */
	private _commandIsActive(): boolean
	{
		return this._phase() !== PersonaFirstChatCommandPhases.Idle;
	}

	/** Return the existing retry intent or mint a key for a genuinely new answer. */
	private _answerIntent(expectedConversationId: string, expectedQuestionOrdinal: number, text: string): PersonaFirstChatPendingAnswer
	{
		const pending = this._pendingAnswer();
		if (pending?.expectedConversationId === expectedConversationId && pending.expectedQuestionOrdinal === expectedQuestionOrdinal && pending.text === text) return pending;
		return { expectedConversationId, expectedQuestionOrdinal, text, idempotencyKey: crypto.randomUUID() };
	}

	/** Await the current pure resource read and surface its bounded failure to the command owner. */
	private async _readProjection(): Promise<PersonaFirstChatSnapshot>
	{
		if (this.chat.isLoading()) await firstValueFrom(this._chatStatus.pipe(filter(_ResourceSettled)));
		if (this.chat.hasValue()) return this.chat.value();
		throw this.chat.error() ?? new Error("The saved first conversation could not be loaded.");
	}

	/** Derive the controlled-draft reset key from authoritative conversation and question evidence. */
	private _draftCoordinate(): string
	{
		if (!this.chat.hasValue()) return "unavailable";
		const snapshot = this.chat.value();
		return `${snapshot.conversationId ?? "pending"}:${snapshot.currentQuestion?.ordinal ?? "complete"}`;
	}
}

/** Whether a resource status contains either a value or a terminal read failure. */
function _ResourceSettled(status: ResourceStatus): boolean
{
	return status !== "loading" && status !== "reloading";
}

/** Return a bounded first-chat command error without exposing an unknown transport payload. */
function _FirstChatCommandError(error: unknown): string
{
	return error instanceof Error && error.message ? error.message : "OpenCrane could not continue the saved first conversation.";
}
