import { type Signal, ChangeDetectionStrategy, Component, computed, effect, inject } from "@angular/core";
import { Router } from "@angular/router";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";
import { ProgressSpinnerModule } from "primeng/progressspinner";

import { JourneyShellComponent, JourneyShellLayouts } from "@opencrane/elements/ui";
import { UserOnboardingRouteStates } from "@opencrane/state/onboarding/projection";
import { PersonaFirstChatCommandPhases, PersonaFirstChatStore } from "@opencrane/state/onboarding";

import { PersonaFirstChatComponent } from "./persona-first-chat.component.js";
import { type PersonaFirstChatAnswerIntent, PersonaFirstChatStates, type PersonaFirstChatView } from "./persona-first-chat.types.js";
import { _PersonaFirstChatView } from "./persona-first-chat.view.js";

/**
 * The `/onboarding/chat` page. Wires {@link PersonaFirstChatStore} to the presentational chat.
 *
 * Provides its own store, so leaving the page discards the state. It holds nothing itself: it turns
 * the store's snapshot into a view model, picks a visual state from the resource and command phase,
 * and passes the user's answers straight back to the store.
 *
 * Order matters on entry. The navigation `effect` is registered first, then `enter()` is called —
 * so if the server says the user does not belong on this page, the redirect fires rather than the
 * page trying to start a chat. While the view model cannot be built yet (no persona or content
 * source) the page shows its preparing state rather than an error, because that is what an initial
 * load or a pending redirect looks like.
 *
 * Rendered by: the `chat` route in onboarding.routes.ts.
 *
 * @see PersonaFirstChatStore
 * @see PersonaFirstChatView
 */
@Component({
	selector: "wo-persona-first-chat-page",
	standalone: true,
	imports: [ButtonModule, JourneyShellComponent, MessageModule, PersonaFirstChatComponent, ProgressSpinnerModule],
	providers: [PersonaFirstChatStore],
	templateUrl: "./persona-first-chat-page.component.html",
	styleUrl: "../onboarding-page.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonaFirstChatPageComponent
{
	/** This page's own store instance; discarded when the page is destroyed. */
	private readonly _store = inject(PersonaFirstChatStore);

	/** Router, used only by the navigation effect below. */
	private readonly _router = inject(Router);

	/** Shared compact journey layout exposed for loading and blocking states. */
	public readonly layouts = JourneyShellLayouts;

	/** The store's chat resource; read-only from here. */
	public readonly chat = this._store.chat;

	/** The composer's text, which the store clears whenever the server moves to another question. */
	public readonly draftAnswer = this._store.draftAnswer;

	/** The store's error message, read straight through rather than copied. */
	public readonly actionError = this._store.actionError;

	/** The view model built from the store's latest snapshot, or null when it cannot be built yet. */
	public readonly view: Signal<PersonaFirstChatView | null> = computed(this._view.bind(this));

	/** Whether entry is still loading the data needed to draw the conversation. */
	public readonly preparing: Signal<boolean> = computed(this._preparing.bind(this));

	/** Which screen to show, worked out from the resource's load state and the store's command phase. */
	public readonly presentationState: Signal<PersonaFirstChatStates> = computed(this._presentationState.bind(this));

	/** Register navigation as the sole reactive external side effect, then enter explicitly. */
	constructor()
	{
		effect(this._routeFromAuthority.bind(this));
		void this._store.enter();
	}

	/** Store the composer's text in the store. Nothing is sent. */
	public updateDraft(value: string): void
	{
		this._store.updateDraft(value);
	}

	/** Pass the user's answer to the store, tagged with the question number they were looking at. */
	public async submitAnswer(intent: PersonaFirstChatAnswerIntent): Promise<void>
	{
		const current = this.view()?.currentQuestion;
		if (current === null || current === undefined || current.id !== intent.questionId) return;
		await this._store.answer(current.ordinal, intent.answer);
	}

	/** Ask the store to retry; it works out whether that means the answer, the conclude, or a reload. */
	public async retry(): Promise<void>
	{
		await this._store.retry();
	}

	/** Build the view model only when both the persona and the content source are present; otherwise null. */
	private _view(): PersonaFirstChatView | null
	{
		return this.chat.hasValue() ? _PersonaFirstChatView(this.chat.value()) : null;
	}

	/** Work out the screen to show, reading the store directly rather than copying its state into local signals. */
	private _presentationState(): PersonaFirstChatStates
	{
		if (this.actionError() !== null) return PersonaFirstChatStates.Error;
		if (this.chat.isLoading() && this.chat.hasValue()) return PersonaFirstChatStates.Reconnecting;
		switch (this._store.phase())
		{
			case PersonaFirstChatCommandPhases.Answering: return PersonaFirstChatStates.Submitting;
			case PersonaFirstChatCommandPhases.Concluding: return PersonaFirstChatStates.Finishing;
			case PersonaFirstChatCommandPhases.Entering: return PersonaFirstChatStates.Reconnecting;
			case PersonaFirstChatCommandPhases.Idle: break;
		}
		if (this.chat.hasValue() && this.chat.value().state === UserOnboardingRouteStates.Completed) return PersonaFirstChatStates.Completed;
		return PersonaFirstChatStates.AwaitingCalibration;
	}

	/** While there is nothing renderable yet, show the preparing state: either the first load or a server-driven redirect is still in progress. */
	private _preparing(): boolean
	{
		if (this.chat.isLoading() && !this.chat.hasValue()) return true;
		return this._store.phase() === PersonaFirstChatCommandPhases.Entering && this.view() === null;
	}

	/** Navigate only from state the server has confirmed. Never write product state from inside this effect. */
	private _routeFromAuthority(): void
	{
		if (!this.chat.hasValue()) return;
		switch (this.chat.value().state)
		{
			case UserOnboardingRouteStates.SurveyPending:
			case UserOnboardingRouteStates.SurveyInProgress:
				void this._router.navigateByUrl("/onboarding");
				return;
			case UserOnboardingRouteStates.Completed:
				void this._router.navigateByUrl("/chats");
				return;
			case UserOnboardingRouteStates.BootstrapChatPending:
			case UserOnboardingRouteStates.BootstrapChatInProgress:
				return;
		}
	}
}
