import { ChangeDetectionStrategy, Component, input, output, signal } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { DialogModule } from "primeng/dialog";
import { MessageModule } from "primeng/message";

import { JourneyShellComponent, JourneyShellLayouts } from "@opencrane/elements/ui";
import { PersonaOnboardingStates } from "@opencrane/state/onboarding/projection";

import type { PersonaApprovalIntent, PersonaOnboardingStateSnapshot } from "../../persona-onboarding-state.types";
import { PersonaResultEvidenceComponent } from "../result/persona-result-evidence.component";

/**
 * Renders persona scoring evidence in both pre-draft and approval-ready `Review` states. Missing
 * revision data emits an explicit draft request; complete immutable evidence opens deliberate
 * approval confirmation without activating anything inside this component.
 */
@Component({
	selector: "wo-persona-review-state",
	standalone: true,
	imports: [ButtonModule, DialogModule, JourneyShellComponent, MessageModule, PersonaResultEvidenceComponent],
	templateUrl: "./persona-review-state.component.html",
	styleUrl: "../../onboarding-page.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonaReviewStateComponent
{
	/** Authoritative review projection selected by the parent state switch. */
	public readonly snapshot = input.required<PersonaOnboardingStateSnapshot<PersonaOnboardingStates.Review>>();

	/** Whether the parent shell has admitted an authority command. */
	public readonly busy = input.required<boolean>();

	/** Bounded command failure retained by the parent shell. */
	public readonly actionError = input.required<string | null>();

	/** Intent to reload incomplete review evidence. */
	public readonly retryRequested = output<void>();

	/** Intent to finish an interrupted immutable-draft transition. */
	public readonly draftRequested = output<void>();

	/** Intent to start a new governed survey. */
	public readonly restartRequested = output<void>();

	/** Exact immutable approval intent confirmed by the owner. */
	public readonly approvalRequested = output<PersonaApprovalIntent>();

	/** Shared journey layout enum exposed to the template. */
	public readonly layouts = JourneyShellLayouts;

	/** Immutable approval evidence retained only while its confirmation dialog is open. */
	protected readonly approvalIntent = signal<PersonaApprovalIntent | null>(null);

	/** Ask for deliberate confirmation before emitting an immutable activation intent. */
	public requestApproval(): void
	{
		const snapshot = this.snapshot();
		if (!snapshot.personaRevisionId || snapshot.result === null || snapshot.result.instructionPreview === null) return;
		this.approvalIntent.set({ personaRevisionId: snapshot.personaRevisionId, instructionPreview: snapshot.result.instructionPreview });
	}

	/** Close the local confirmation boundary without emitting an activation intent. */
	protected closeApproval(): void
	{
		this.approvalIntent.set(null);
	}

	/** Keep local dialog state aligned when PrimeNG closes it through Escape or its close affordance. */
	protected approvalVisibilityChanged(visible: boolean): void
	{
		if (!visible) this.closeApproval();
	}

	/** Emit the immutable material captured by the owner's confirmation. */
	protected confirmApproval(): void
	{
		const intent = this.approvalIntent();
		if (intent === null) return;
		this.closeApproval();
		this.approvalRequested.emit(intent);
	}
}
