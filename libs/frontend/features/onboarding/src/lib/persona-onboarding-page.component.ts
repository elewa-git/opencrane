import { ChangeDetectionStrategy, Component, effect, inject, untracked } from "@angular/core";
import { Router } from "@angular/router";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";
import { ProgressSpinnerModule } from "primeng/progressspinner";

import { JourneyShellComponent, JourneyShellLayouts } from "@opencrane/elements/ui";
import { PersonaOnboardingSnapshot, PersonaOnboardingStates, PersonaOnboardingStore, UserOnboardingRouteStates } from "@opencrane/state/onboarding";

import { PersonaInterviewStateComponent } from "./states/interview/persona-interview-state.component";
import { PersonaReadyStateComponent } from "./states/ready/persona-ready-state.component";
import { PersonaResolutionStateComponent } from "./states/resolution/persona-resolution-state.component";
import { PersonaReviewStateComponent } from "./states/review/persona-review-state.component";
import type { PersonaAnswerIntent, PersonaApprovalIntent, PersonaOnboardingStateSnapshot, PersonaResolutionIntent } from "./persona-onboarding-state.types";

/** Routed shell that renders exactly one component for the server-authoritative persona state. */
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
	/** Component-scoped browser state owner for authoritative reads and commands. */
	private readonly _store = inject(PersonaOnboardingStore);

	/** Router used only for transitions selected from durable onboarding state. */
	private readonly _router = inject(Router);

	/** Shared journey layout enum exposed for loading and failure envelopes. */
	public readonly layouts = JourneyShellLayouts;

	/** Durable lifecycle enum used by the shell's sole state switch. */
	public readonly states = PersonaOnboardingStates;

	/** Read-only loader owned by the component-scoped onboarding store. */
	public readonly onboarding = this._store.onboarding;

	/** Whether the store has admitted one authority command. */
	public readonly saving = this._store.busy;

	/** Bounded command or ready-route failure that leaves authoritative state unchanged. */
	public readonly actionError = this._store.actionError;

	/** Observe only the durable ready transition and route from its separate authority projection. */
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

	/** Narrow one authoritative snapshot only after the template's matching lifecycle case. */
	public stateSnapshot<State extends PersonaOnboardingStates>(snapshot: PersonaOnboardingSnapshot, state: State): PersonaOnboardingStateSnapshot<State>
	{
		if (snapshot.state !== state) throw new Error("persona onboarding state switch mismatch");
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

	/** Start a new governed interview without mutating the current review locally. */
	public async restart(): Promise<void>
	{
		await this._store.restart();
	}

	/** Trigger route resolution exactly when the persona authority enters its ready state. */
	private _resolveRouteWhenReady(): void
	{
		if (!this.onboarding.hasValue() || this.onboarding.value().state !== PersonaOnboardingStates.Ready) return;
		void untracked(this._store.resolveReadyRoute.bind(this._store));
	}

	/** Navigate only as an external effect of the route projection owned by the store. */
	private _navigateFromReadyRoute(): void
	{
		const onboarding = this._store.readyRoute();
		if (onboarding === null) return;
		switch (onboarding.state)
		{
			case UserOnboardingRouteStates.BootstrapChatPending:
			case UserOnboardingRouteStates.BootstrapChatInProgress:
				void this._router.navigateByUrl("/onboarding/chat");
				return;
			case UserOnboardingRouteStates.Completed:
				void this._router.navigateByUrl("/admin");
				return;
			case UserOnboardingRouteStates.SurveyPending:
			case UserOnboardingRouteStates.SurveyInProgress:
				return;
		}
	}
}
