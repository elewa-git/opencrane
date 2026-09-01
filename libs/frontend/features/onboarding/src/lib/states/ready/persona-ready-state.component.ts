import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

import { JourneyShellComponent, JourneyShellLayouts } from "@opencrane/elements/ui";
import { PersonaOnboardingStates } from "@opencrane/state/onboarding/projection";

import type { PersonaOnboardingStateSnapshot } from "../../persona-onboarding-state.types";
import { PersonaResultEvidenceComponent } from "../result/persona-result-evidence.component";

/** Presentational owner for the terminal ready persona state. */
@Component({
	selector: "wo-persona-ready-state",
	standalone: true,
	imports: [ButtonModule, JourneyShellComponent, MessageModule, PersonaResultEvidenceComponent],
	templateUrl: "./persona-ready-state.component.html",
	styleUrl: "../../onboarding-page.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonaReadyStateComponent
{
	/** Authoritative approved projection selected by the parent state switch. */
	public readonly snapshot = input.required<PersonaOnboardingStateSnapshot<PersonaOnboardingStates.Ready>>();

	/** Bounded failure while resolving the next durable onboarding route. */
	public readonly actionError = input.required<string | null>();

	/** Intent to reload incomplete approved-persona evidence. */
	public readonly retryRequested = output<void>();

	/** Shared journey layout enum exposed to the template. */
	public readonly layouts = JourneyShellLayouts;
}
