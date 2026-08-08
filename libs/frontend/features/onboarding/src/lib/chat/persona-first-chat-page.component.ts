import { ChangeDetectionStrategy, Component, Signal, computed, inject, resource, signal } from "@angular/core";
import { Router } from "@angular/router";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";
import { ProgressSpinnerModule } from "primeng/progressspinner";

import { JourneyShellComponent, JourneyShellLayouts, PersonaArchetypeTones } from "@opencrane/elements/ui";
import { PersonaFirstChatArchetypes, PersonaFirstChatConflictError, PersonaFirstChatCurrentQuestion, PersonaFirstChatService, PersonaFirstChatSnapshot, PersonaFirstChatTranscriptEntry, PersonaFirstChatTranscriptRoles, UserOnboardingRouteStates } from "@opencrane/state/onboarding";

import { _OnboardingErrorMessage } from "../onboarding-view.util.js";
import { PersonaFirstChatComponent } from "./persona-first-chat.component.js";
import { PersonaFirstChatAnswerIntent, PersonaFirstChatIdentity, PersonaFirstChatMessageRoles, PersonaFirstChatProvenance, PersonaFirstChatQuestion, PersonaFirstChatQuestionOrdinal, PersonaFirstChatStates, PersonaFirstChatTranscriptMessage } from "./persona-first-chat.types.js";

/** Routed orchestration owner for the deterministic, server-authoritative first conversation. */
@Component({
	selector: "wo-persona-first-chat-page",
	standalone: true,
	imports: [ButtonModule, JourneyShellComponent, MessageModule, PersonaFirstChatComponent, ProgressSpinnerModule],
	templateUrl: "./persona-first-chat-page.component.html",
	styleUrl: "../onboarding-page.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonaFirstChatPageComponent
{
	/** Server-backed first-chat orchestration. */
	private readonly _firstChat = inject(PersonaFirstChatService);

	/** Router used only for authority-derived workflow redirects. */
	private readonly _router = inject(Router);

	/** Shared compact journey layout exposed for loading and blocking states. */
	public readonly layouts = JourneyShellLayouts;

	/** Durable conversation loaded and, only when pending, started by the server. */
	public readonly chat = resource({ loader: this._load.bind(this) });

	/** Controlled unsaved answer retained across a failed request. */
	public readonly draftAnswer = signal<string>("");

	/** Retry-stable key retained until the exact answer is admitted. */
	private readonly _pendingIdempotencyKey = signal<string | null>(null);

	/** Exact question coordinate bound to the retained retry key. */
	private readonly _pendingQuestionId = signal<string | null>(null);

	/** Exact normalised answer bound to the retained retry key. */
	private readonly _pendingAnswer = signal<string | null>(null);

	/** Whether an answer or conclusion request is currently in flight. */
	public readonly saving = signal<boolean>(false);

	/** Recoverable bounded failure that never advances local workflow state. */
	public readonly actionError = signal<string | null>(null);

	/** Presentational state derived from authoritative data and request status. */
	public readonly presentationState: Signal<PersonaFirstChatStates> = computed(this._presentationState.bind(this));

	/** Approved personal-agent identity mapped to the presentational component contract. */
	public readonly identity: Signal<PersonaFirstChatIdentity | null> = computed(this._identity.bind(this));

	/** Exact immutable persona and script provenance mapped for display. */
	public readonly provenance: Signal<PersonaFirstChatProvenance | null> = computed(this._provenance.bind(this));

	/** Canonical transcript mapped without changing server order. */
	public readonly transcript: Signal<readonly PersonaFirstChatTranscriptMessage[]> = computed(this._transcript.bind(this));

	/** Current server-selected calibration question, or null after all answers. */
	public readonly currentQuestion: Signal<PersonaFirstChatQuestion | null> = computed(this._currentQuestion.bind(this));

	/** Update only the controlled unsaved draft. */
	public updateDraft(value: string): void
	{
		this.draftAnswer.set(value);
	}

	/** Admit one answer with a key that remains stable across retries of the exact intent. */
	public async submitAnswer(intent: PersonaFirstChatAnswerIntent): Promise<void>
	{
		const snapshot = this.chat.hasValue() ? this.chat.value() : null;
		const current = this.currentQuestion();
		const text = intent.answer.trim();
		if (snapshot === null || snapshot.conversationId === null || current === null || current.id !== intent.questionId || text.length === 0) return;
		const conversationId = snapshot.conversationId;

		const idempotencyKey = this._idempotencyKey(intent.questionId, text);
		await this._run(async function _Submit(this: PersonaFirstChatPageComponent)
		{
			const answered = await this._firstChat.answer({ expectedConversationId: conversationId, expectedQuestionOrdinal: current.ordinal, text, idempotencyKey });
			this.chat.set(answered);
			this.draftAnswer.set("");
			this._clearPendingAnswer();
			if (answered.canConclude)
			{
				await this._conclude(answered);
			}
		}.bind(this));
	}

	/** Retry the exact failed answer or reload the same durable conversation when no answer is pending. */
	public async retry(): Promise<void>
	{
		const questionId = this._pendingQuestionId();
		const answer = this._pendingAnswer();
		if (questionId !== null && answer !== null)
		{
			await this.submitAnswer({ questionId, answer });
			return;
		}
		if (this.chat.hasValue() && this.chat.value().canConclude)
		{
			await this._run(this._conclude.bind(this, this.chat.value()));
			return;
		}
		this.actionError.set(null);
		this.chat.reload();
	}

	/** Load or start from server state, resume any admitted conclusion, then route. */
	private async _load(): Promise<PersonaFirstChatSnapshot>
	{
		let snapshot = await this._firstChat.loadOrStart();
		if (snapshot.canConclude) snapshot = await this._firstChat.conclude(snapshot);
		this._route(snapshot);
		return snapshot;
	}

	/** Retry only the server conclusion for an already-admitted three-answer projection. */
	private async _conclude(snapshot: PersonaFirstChatSnapshot): Promise<void>
	{
		const completed = await this._firstChat.conclude(snapshot);
		this.chat.set(completed);
		this._route(completed);
	}

	/** Return a stable key for the exact pending intent and mint a new key only for a new answer. */
	private _idempotencyKey(questionId: string, text: string): string
	{
		const retainedKey = this._pendingIdempotencyKey();
		if (this._pendingQuestionId() === questionId && this._pendingAnswer() === text && retainedKey !== null)
		{
			return retainedKey;
		}
		const key = crypto.randomUUID();
		this._pendingQuestionId.set(questionId);
		this._pendingAnswer.set(text);
		this._pendingIdempotencyKey.set(key);
		return key;
	}

	/** Clear retry coordinates only after the server admits the exact answer. */
	private _clearPendingAnswer(): void
	{
		this._pendingQuestionId.set(null);
		this._pendingAnswer.set(null);
		this._pendingIdempotencyKey.set(null);
	}

	/** Derive a finite presentational state without treating client state as workflow authority. */
	private _presentationState(): PersonaFirstChatStates
	{
		if (this.saving()) return PersonaFirstChatStates.Submitting;
		if (this.actionError() !== null) return PersonaFirstChatStates.Error;
		if (this.chat.isLoading() && this.chat.hasValue()) return PersonaFirstChatStates.Reconnecting;
		if (this.chat.hasValue() && this.chat.value().state === UserOnboardingRouteStates.Completed) return PersonaFirstChatStates.Completed;
		return PersonaFirstChatStates.AwaitingCalibration;
	}

	/** Map exact approved persona evidence into presentational identity. */
	private _identity(): PersonaFirstChatIdentity | null
	{
		const persona = this.chat.hasValue() ? this.chat.value().persona : null;
		if (persona === null) return null;
		return { name: persona.displayName, initials: _Initials(persona.displayName), archetype: _ArchetypeTone(persona.archetype) };
	}

	/** Map exact persona and source coordinates without inventing friendlier revisions. */
	private _provenance(): PersonaFirstChatProvenance | null
	{
		if (!this.chat.hasValue()) return null;
		const snapshot = this.chat.value();
		if (snapshot.persona === null || snapshot.contentRevision === null) return null;
		return { personaRevision: snapshot.persona.revisionId, scriptLabel: snapshot.contentRevision.sourceLabel, scriptRevision: snapshot.contentRevision.id };
	}

	/** Preserve canonical order while adapting only role and field names for presentation. */
	private _transcript(): readonly PersonaFirstChatTranscriptMessage[]
	{
		if (!this.chat.hasValue()) return [];
		const conversationId = this.chat.value().conversationId ?? "pending";
		return this.chat.value().transcript.map(function _Message(entry)
		{
			return _TranscriptMessage(conversationId, entry);
		});
	}

	/** Map the exact current question into the component's bounded one-of-three contract. */
	private _currentQuestion(): PersonaFirstChatQuestion | null
	{
		if (!this.chat.hasValue()) return null;
		const question = this.chat.value().currentQuestion;
		return question === null ? null : _Question(question);
	}

	/** Route only from a durable server state; completed onboarding enters the current main surface. */
	private _route(snapshot: PersonaFirstChatSnapshot): void
	{
		if (snapshot.state === UserOnboardingRouteStates.SurveyPending || snapshot.state === UserOnboardingRouteStates.SurveyInProgress)
		{
			void this._router.navigateByUrl("/onboarding/survey");
		}
		else if (snapshot.state === UserOnboardingRouteStates.Completed)
		{
			void this._router.navigateByUrl("/admin");
		}
	}

	/** Run one request while retaining the draft and idempotency coordinates on failure. */
	private async _run(operation: () => Promise<void>): Promise<void>
	{
		this.saving.set(true);
		this.actionError.set(null);
		try
		{
			await operation();
		}
		catch (error)
		{
			if (error instanceof PersonaFirstChatConflictError)
			{
				this.chat.set(error.chat);
				this._clearPendingAnswer();
			}
			this.actionError.set(_OnboardingErrorMessage(error, "OpenCrane could not continue the saved first conversation."));
		}
		finally
		{
			this.saving.set(false);
		}
	}
}

/** Adapt one server transcript role without weakening the finite vocabulary. */
function _TranscriptMessage(conversationId: string, entry: PersonaFirstChatTranscriptEntry): PersonaFirstChatTranscriptMessage
{
	const role = entry.role === PersonaFirstChatTranscriptRoles.Assistant ? PersonaFirstChatMessageRoles.Agent : PersonaFirstChatMessageRoles.Owner;
	return { id: `${conversationId}-${entry.ordinal}`, role, body: entry.text };
}

/** Map the server's one-based integer into the component's exact three-question coordinate. */
function _Question(question: PersonaFirstChatCurrentQuestion): PersonaFirstChatQuestion
{
	return { id: `question-${question.ordinal}`, ordinal: _QuestionOrdinal(question.ordinal), prompt: question.text };
}

/** Reject any ordinal outside the reviewed three-question bootstrap contract. */
function _QuestionOrdinal(ordinal: number): PersonaFirstChatQuestionOrdinal
{
	switch (ordinal)
	{
		case 1: return 1;
		case 2: return 2;
		case 3: return 3;
		default: throw new Error("The onboarding authority returned an invalid first-chat question ordinal.");
	}
}

/** Map the exact reviewed bootstrap archetype onto the shared semantic visual treatment. */
function _ArchetypeTone(archetype: PersonaFirstChatArchetypes): PersonaArchetypeTones
{
	switch (archetype)
	{
		case PersonaFirstChatArchetypes.Commander: return PersonaArchetypeTones.Commander;
		case PersonaFirstChatArchetypes.Catalyst: return PersonaArchetypeTones.Catalyst;
		case PersonaFirstChatArchetypes.Anchor: return PersonaArchetypeTones.Anchor;
		case PersonaFirstChatArchetypes.Analyst: return PersonaArchetypeTones.Analyst;
	}
}

/** Derive bounded display initials from the reviewed persona name. */
function _Initials(name: string): string
{
	return name.split(/\s+/u).filter(function _NonBlank(part) { return part.length > 0; }).slice(0, 2).map(function _First(part) { return part.charAt(0).toUpperCase(); }).join("") || "AI";
}
