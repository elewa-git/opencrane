import { type Signal, ChangeDetectionStrategy, Component, computed, effect, inject } from "@angular/core";
import { Router } from "@angular/router";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";
import { ProgressSpinnerModule } from "primeng/progressspinner";

import { JourneyShellComponent, JourneyShellLayouts } from "@opencrane/elements/ui";
import { PersonaFirstChatCommandPhases, PersonaFirstChatStore, UserOnboardingRouteStates } from "@opencrane/state/onboarding";

import { PersonaFirstChatComponent } from "./persona-first-chat.component.js";
import { type PersonaFirstChatAnswerIntent, PersonaFirstChatStates, type PersonaFirstChatView } from "./persona-first-chat.types.js";
import { _PersonaFirstChatView } from "./persona-first-chat.view.js";

/** Thin routed composition for the server-authoritative first conversation. */
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
	/** Component-scoped owner of reads, commands, retries, conflicts, and draft state. */
	private readonly _store = inject(PersonaFirstChatStore);

	/** Router used only by the authority-derived navigation effect. */
	private readonly _router = inject(Router);

	/** Shared compact journey layout exposed for loading and blocking states. */
	public readonly layouts = JourneyShellLayouts;

	/** Pure resource-backed authoritative projection owned by the state store. */
	public readonly chat = this._store.chat;

	/** Controlled draft keyed to the authoritative conversation/question coordinate. */
	public readonly draftAnswer = this._store.draftAnswer;

	/** Bounded command failure exposed without duplicating store state. */
	public readonly actionError = this._store.actionError;

	/** Pure presentational contract derived from the latest authoritative projection. */
	public readonly view: Signal<PersonaFirstChatView | null> = computed(this._view.bind(this));

	/** Whether route entry is still resolving evidence required to render the conversation. */
	public readonly preparing: Signal<boolean> = computed(this._preparing.bind(this));

	/** Finite visual lifecycle derived from resource and explicit command state. */
	public readonly presentationState: Signal<PersonaFirstChatStates> = computed(this._presentationState.bind(this));

	/** Register navigation as the sole reactive external side effect, then enter explicitly. */
	constructor()
	{
		effect(this._routeFromAuthority.bind(this));
		void this._store.enter();
	}

	/** Update only the current question-keyed controlled draft. */
	public updateDraft(value: string): void
	{
		this._store.updateDraft(value);
	}

	/** Delegate one exact visible-question intent to the component-scoped command owner. */
	public async submitAnswer(intent: PersonaFirstChatAnswerIntent): Promise<void>
	{
		const current = this.view()?.currentQuestion;
		if (current === null || current === undefined || current.id !== intent.questionId) return;
		await this._store.answer(current.ordinal, intent.answer);
	}

	/** Retry the exact failed command or authoritative read through the store. */
	public async retry(): Promise<void>
	{
		await this._store.retry();
	}

	/** Derive a complete presentation only when persona and source evidence are present. */
	private _view(): PersonaFirstChatView | null
	{
		return this.chat.hasValue() ? _PersonaFirstChatView(this.chat.value()) : null;
	}

	/** Derive visual lifecycle without copying resource or command state into page signals. */
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

	/** Treat entry without renderable evidence as preparation while initial loading or an authority redirect resolves. */
	private _preparing(): boolean
	{
		if (this.chat.isLoading() && !this.chat.hasValue()) return true;
		return this._store.phase() === PersonaFirstChatCommandPhases.Entering && this.view() === null;
	}

	/** Navigate only from an adopted durable server state; never mutate product state in the effect. */
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
				void this._router.navigateByUrl("/admin");
				return;
			case UserOnboardingRouteStates.BootstrapChatPending:
			case UserOnboardingRouteStates.BootstrapChatInProgress:
				return;
		}
	}
}
