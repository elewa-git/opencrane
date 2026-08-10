import { ChangeDetectionStrategy, Component, Signal, computed, input, linkedSignal, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

import { ChoiceCardGroupComponent, ChoiceCardLayouts, ChoiceCardOption, JourneyShellComponent, JourneyShellLayouts } from "@opencrane/elements/ui";
import { PersonaOnboardingStates } from "@opencrane/state/onboarding";

import { _ResolutionOptions } from "../../onboarding-view.util";
import type { PersonaOnboardingStateSnapshot, PersonaResolutionIntent } from "../../persona-onboarding-state.types";

/** Presentational owner for the explicit tie-resolution lifecycle state. */
@Component({
	selector: "wo-persona-resolution-state",
	standalone: true,
	imports: [ButtonModule, ChoiceCardGroupComponent, JourneyShellComponent, MessageModule],
	templateUrl: "./persona-resolution-state.component.html",
	styleUrl: "../../onboarding-page.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonaResolutionStateComponent
{
	/** Authoritative resolution projection selected by the parent state switch. */
	public readonly snapshot = input.required<PersonaOnboardingStateSnapshot<PersonaOnboardingStates.Resolution>>();

	/** Whether the parent shell has admitted an authority command. */
	public readonly busy = input.required<boolean>();

	/** Bounded command failure retained by the parent shell. */
	public readonly actionError = input.required<string | null>();

	/** Intent to reload missing or stale tie evidence. */
	public readonly retryRequested = output<void>();

	/** Exact tie-resolution intent for the authority-owning shell. */
	public readonly resolutionSubmitted = output<PersonaResolutionIntent>();

	/** Shared journey layout enum exposed to the template. */
	public readonly layouts = JourneyShellLayouts;

	/** Shared choice layout enum exposed to the template. */
	public readonly choiceLayouts = ChoiceCardLayouts;

	/** Selection reset whenever the authoritative tie coordinate changes. */
	public readonly selectedId = linkedSignal<string, string | null>({ source: this._resolutionCoordinate.bind(this), computation: function _ResetSelection() { return null; } });

	/** Validation reset whenever the authoritative tie coordinate changes. */
	public readonly validationMessage = linkedSignal<string, string | undefined>({ source: this._resolutionCoordinate.bind(this), computation: function _ResetValidation() { return undefined; } });

	/** Shared choice-card inputs limited to the current server-returned tie candidates. */
	public readonly resolutionOptions: Signal<readonly ChoiceCardOption[]> = computed(this._resolutionOptions.bind(this));

	/** Update the transient controlled choice without treating it as resolved evidence. */
	public select(selectedValue: string): void
	{
		this.selectedId.set(selectedValue);
		this.validationMessage.set(undefined);
	}

	/** Emit one exact resolution intent while keeping lifecycle advancement in the parent shell. */
	public submitResolution(): void
	{
		const snapshot = this.snapshot();
		const resolution = snapshot.resolution;
		const selectedValue = this.selectedId();
		if (snapshot.interviewId === null || resolution === null || selectedValue === null)
		{
			this.validationMessage.set("Choose one of the tied working styles before continuing.");
			return;
		}
		this.resolutionSubmitted.emit({ interviewId: snapshot.interviewId, kind: resolution.kind, selectedValue });
	}

	/** Reset controlled state only when the server changes the exact tie evidence. */
	private _resolutionCoordinate(): string
	{
		const resolution = this.snapshot().resolution;
		return resolution === null ? "missing" : `${resolution.kind}:${resolution.candidates.join(",")}`;
	}

	/** Map only the server-returned candidates onto shared choice cards. */
	private _resolutionOptions(): readonly ChoiceCardOption[]
	{
		return _ResolutionOptions(this.snapshot().resolution);
	}
}
