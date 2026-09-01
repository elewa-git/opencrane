import { ChangeDetectionStrategy, Component, effect, inject, untracked } from "@angular/core";
import { Router } from "@angular/router";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";
import { ProgressSpinnerModule } from "primeng/progressspinner";

import { JourneyShellComponent, JourneyShellLayouts } from "@opencrane/elements/ui";
import { UserOnboardingRouteStates } from "@opencrane/state/onboarding/projection";
import { PersonaOnboardingStates, type PersonaOnboardingSnapshot } from "@opencrane/state/onboarding/projection";
import { PersonaOnboardingStore } from "@opencrane/state/onboarding";

import { PersonaInterviewStateComponent } from "./states/interview/persona-interview-state.component";
import { PersonaReadyStateComponent } from "./states/ready/persona-ready-state.component";
import { PersonaResolutionStateComponent } from "./states/resolution/persona-resolution-state.component";
import { PersonaReviewStateComponent } from "./states/review/persona-review-state.component";
import type { PersonaAnswerIntent, PersonaApprovalIntent, PersonaOnboardingStateSnapshot, PersonaResolutionIntent } from "./persona-onboarding-state.types";

/**
 * The `/onboarding` page. Shows one screen for whichever persona stage the server reports.
 *
 * Provides its own {@link PersonaOnboardingStore}, so the state is thrown away when the user leaves.
 * All it does is pick a child component from the store's state — `Interview`, `Resolution`, `Review`
 * or `Ready` — and forward the child's outputs to the store. It holds no state of its own and never
 * advances the workflow.
 *
 * Once the persona is approved it asks the store for the next route and navigates there, which is
 * how the user reaches `/onboarding/chat`. The navigation happens in an `effect` that only reads
 * store state and calls the router — nothing is written to product state from inside it.
 *
 * Rendered by: the `""` route in onboarding.routes.ts.
 *
 * @see PersonaOnboardingStates
 */
@Component({
	selector: "wo-persona-onboarding-page",
	standalone: true,
	imports: [ButtonModule, JourneyShellComponent, MessageModule, PersonaInterviewStateComponent, PersonaReadyStateComponent, PersonaResolutionStateComponent, PersonaReviewStateComponent, ProgressSpinnerModule],
	providers: [PersonaOnboardingStore],
	templateUrl: "./persona-onboarding-page.component.html",
	styleUrl: "./onboarding-page.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonaOnboardingPageComponent
{
	/** This page's own store instance; discarded when the page is destroyed. */
	private readonly _store = inject(PersonaOnboardingStore);

	/** Router. Only ever used to follow the route the store loaded, never to guess a destination. */
	private readonly _router = inject(Router);

	/** JourneyShellLayouts, exposed so the template can pick a layout for the loading and error screens. */
	public readonly layouts = JourneyShellLayouts;

	/** Durable lifecycle enum used by the shell's sole state switch. */
	public readonly states = PersonaOnboardingStates;

	/** Read-only loader owned by the component-scoped onboarding store. */
	public readonly onboarding = this._store.onboarding;

	/** Whether a command is running in the store; used to disable the controls. */
	public readonly saving = this._store.busy;

	/** Message from the last failed command or route load; the onboarding state itself is unchanged. */
	public readonly actionError = this._store.actionError;

	/** Watch for the persona reaching Ready, then navigate using the route the store loaded. */
	constructor()
	{
		effect(this._resolveRouteWhenReady.bind(this));
		effect(this._navigateFromReadyRoute.bind(this));
	}

	/** Retry the authoritative projection read after a blocking load failure. */
	public retry(): void
	{
		if (this.onboarding.hasValue() && this.onboarding.value().state === PersonaOnboardingStates.Ready)
		{
			void this._store.retryReadyRoute();
			return;
		}
		this._store.retry();
	}

	/** Narrow the snapshot for one state's child component. Only call it from the matching @switch branch — it assumes that branch already matched. */
	public stateSnapshot<State extends PersonaOnboardingStates>(snapshot: PersonaOnboardingSnapshot, state: State): PersonaOnboardingStateSnapshot<State>
	{
		if (snapshot.state !== state)
		{
			throw new Error("persona onboarding state switch mismatch");
		}
		return snapshot as PersonaOnboardingStateSnapshot<State>;
	}

	/** Start or resume the reviewed persona interview. */
	public async start(): Promise<void>
	{
		await this._store.start();
	}

	/** Record one exact answer and complete the interview when the authority confirms the final answer. */
	public async answer(intent: PersonaAnswerIntent): Promise<void>
	{
		await this._store.answer(intent.interviewId, intent.questionId, intent.choiceId);
	}

	/** Persist one exact tie choice through the persona authority. */
	public async resolve(intent: PersonaResolutionIntent): Promise<void>
	{
		await this._store.resolve(intent.interviewId, intent.kind, intent.selectedValue);
	}

	/** Finish an interrupted draft transition through an explicit review-state intent. */
	public async prepareDraft(): Promise<void>
	{
		await this._store.prepareDraft();
	}

	/** Approve only when the live state still matches the immutable material the owner confirmed. */
	public async approve(intent: PersonaApprovalIntent): Promise<void>
	{
		await this._store.approve(intent.personaRevisionId, intent.instructionPreview);
	}

	/** Ask the store to start a fresh interview; the current review stays until the server answers. */
	public async restart(): Promise<void>
	{
		await this._store.restart();
	}

	/** Ask the store to load the next route, as soon as the persona reaches Ready. */
	private _resolveRouteWhenReady(): void
	{
		if (!this.onboarding.hasValue() || this.onboarding.value().state !== PersonaOnboardingStates.Ready)
		{
			return;
		}
		void untracked(this._store.resolveReadyRoute.bind(this._store));
	}

	/**
	 * Navigate when the store has loaded the next route. Reads store state only; writes nothing.
	 *
	 * A user who has already finished the whole flow can still land here, and they go to `/chats` rather
	 * than `/admin`: the workspace there reads their finished onboarding exchange back as read-only
	 * history, so they arrive at the conversation they already had instead of an empty admin screen.
	 * Asserted by "routes an already completed onboarding authority directly to chats" in
	 * __tests__/persona-onboarding-shell.spec.ts.
	 *
	 * @see ConversationOnboardingHistoryStore
	 */
	private _navigateFromReadyRoute(): void
	{
		const onboarding = this._store.readyRoute();
		if (onboarding === null)
		{
			return;
		}
		switch (onboarding.state)
		{
			case UserOnboardingRouteStates.BootstrapChatPending:
			case UserOnboardingRouteStates.BootstrapChatInProgress:
				void this._router.navigateByUrl("/onboarding/chat");
				return;
			case UserOnboardingRouteStates.Completed:
				void this._router.navigateByUrl("/chats");
				return;
			// The persona survey is still owned by this page, so neither state redirects away from it.
			case UserOnboardingRouteStates.SurveyPending:
			case UserOnboardingRouteStates.SurveyInProgress:
				return;
		}
	}
}
