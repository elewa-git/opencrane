import { ChangeDetectionStrategy, Component, Signal, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { ButtonModule } from "primeng/button";
import { CardModule } from "primeng/card";
import { InputTextModule } from "primeng/inputtext";
import { MessageModule } from "primeng/message";
import { StepperModule } from "primeng/stepper";

import { SessionStore } from "@opencrane/state/core";
import { WelcomeOnboardingService } from "@opencrane/state/onboarding";

import { WelcomePersonalization, WelcomeStep, WelcomeTourCard } from "../welcome.types";
import { _EMPTY_PERSONALIZATION, _IsFirstStep, _IsLastStep, _NextStep, _PreviousStep, _WELCOME_TOUR_CARDS } from "../welcome.util";

/**
 * First-run onboarding for the operator app (end users / customer admins).
 *
 * A single page drives a PrimeNG Stepper through Welcome → Workspace →
 * Personalize → Tour → Finish, with enum-first step state ({@link WelcomeStep})
 * and pure step logic in `welcome.util.ts`. It reads identity and the authoritative
 * ClusterTenant claim from {@link SessionStore} (never mutating it), keeps personalisation
 * local, and on Finish marks onboarding complete via
 * {@link WelcomeOnboardingService} and navigates to the workspace (`"/"`).
 *
 * Distinct from `features/onboarding` (the opencrane-ui signup funnel): this
 * holds no HTTP, no URL beyond the final hand-off, and writes nothing to the
 * control plane.
 */
@Component({
	selector: "wo-welcome",
	standalone: true,
	imports: [FormsModule, ButtonModule, CardModule, InputTextModule, MessageModule, StepperModule],
	templateUrl: "./welcome-page.component.html",
	styleUrl: "./welcome-page.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class WelcomePageComponent
{
	/** App-wide identity/capability state (read-only here). */
	private readonly _session = inject(SessionStore);

	/** First-run gate; written once on Finish. */
	private readonly _onboarding = inject(WelcomeOnboardingService);

	/** Router used for the final hand-off to the workspace. */
	private readonly _router = inject(Router);

	/** Step enum exposed for the template's `@switch`/`@case` and Stepper. */
	public readonly steps = WelcomeStep;

	/** Display name of the signed-in user, falling back to a friendly default. */
	public readonly displayName: Signal<string> = computed((): string =>
	{
		return this._session.displayName() ?? "there";
	});

	/** Authoritative ClusterTenant bound to the caller's signed-in identity. */
	public readonly clusterTenant = computed((): string | null => this._session.user()?.clusterTenant ?? null);

	/** Whether a workspace has resolved (drives the ready vs provisioning panel). */
	public readonly hasWorkspace: Signal<boolean> = computed((): boolean =>
	{
		return this.clusterTenant() !== null;
	});

	/** The current onboarding step (writable; advanced/retreated via the machine). */
	public readonly step = signal<WelcomeStep>(WelcomeStep.Welcome);

	/**
	 * Local-only personalisation captured on the Personalize step.
	 *
	 * Kept in a signal and never persisted today; this is the seam where user
	 * preferences will be written (e.g. to a future `/preferences` endpoint via a
	 * `core/api` service) once the backend supports them.
	 */
	public readonly personalization = signal<WelcomePersonalization>({ ..._EMPTY_PERSONALIZATION });

	/** The fixed Quick tour cards rendered on the Tour step. */
	public readonly tourCards: readonly WelcomeTourCard[] = _WELCOME_TOUR_CARDS;

	/** Whether the current step is the first one (disables Back). */
	public readonly isFirstStep: Signal<boolean> = computed((): boolean =>
	{
		return _IsFirstStep(this.step());
	});

	/** Whether the current step is the final one (swaps Continue for Finish). */
	public readonly isLastStep: Signal<boolean> = computed((): boolean =>
	{
		return _IsLastStep(this.step());
	});

	/** Patch one field of the local personalisation (bound from the form input). */
	public patchPersonalization(patch: Partial<WelcomePersonalization>): void
	{
		this.personalization.update(function applyPatch(current: WelcomePersonalization): WelcomePersonalization
		{
			return { ...current, ...patch };
		});
	}

	/** Advance to the next step (every step is informational or local-only). */
	public next(): void
	{
		this.step.update(function forward(current: WelcomeStep): WelcomeStep
		{
			return _NextStep(current);
		});
	}

	/** Return to the previous step. */
	public back(): void
	{
		this.step.update(function backward(current: WelcomeStep): WelcomeStep
		{
			return _PreviousStep(current);
		});
	}

	/** Mark onboarding complete and hand off to the workspace (`"/"`). */
	public finish(): void
	{
		this._onboarding.markComplete();
		void this._router.navigateByUrl("/");
	}
}
