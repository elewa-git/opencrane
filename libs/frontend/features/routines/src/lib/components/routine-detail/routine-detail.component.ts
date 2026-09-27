import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { RouterLink } from "@angular/router";
import { ButtonModule } from "primeng/button";

import { ResourceFeedbackComponent, ScopeChipComponent, SectionHeadingComponent, SectionHeadingLevels } from "@opencrane/elements/ui";

import { RoutineCommandStates, RoutineControlActions, RoutineReadStates, type RoutineCapabilitiesView, type RoutineDetailsView } from "../../routine-presentation.types";
import { RoutineControlsComponent } from "../routine-controls/routine-controls.component";

/** Presents one authorized routine definition and delegates every command to its route store. */
@Component({ selector: "wo-routine-detail", standalone: true, imports: [ButtonModule, ResourceFeedbackComponent, RouterLink, RoutineControlsComponent, ScopeChipComponent, SectionHeadingComponent], templateUrl: "./routine-detail.component.html", styleUrl: "./routine-detail.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class RoutineDetailComponent
{
	/** Current protected read state. */
	public readonly state = input(RoutineReadStates.Idle);
	/** Authorized routine details, or null after access loss. */
	public readonly detail = input<RoutineDetailsView | null>(null);
	/** Current command hints returned by the server. */
	public readonly capabilities = input<RoutineCapabilitiesView | null>(null);
	/** Current browser command state. */
	public readonly commandState = input(RoutineCommandStates.Idle);
	/** Saved control action that may be retried after an uncertain result. */
	public readonly retryAction = input<RoutineControlActions | null>(null);
	/** Safe detail or refresh failure copy. */
	public readonly error = input<string | null>(null);
	/** Safe command failure copy. */
	public readonly commandError = input<string | null>(null);
	/** Requests reloading the routine. */
	public readonly refreshRequested = output<void>();
	/** Requests opening revision editing. */
	public readonly reviseRequested = output<void>();
	/** Requests pausing automatic firing. */
	public readonly pauseRequested = output<void>();
	/** Requests resuming automatic firing. */
	public readonly resumeRequested = output<void>();
	/** Requests permanent retirement. */
	public readonly retireRequested = output<void>();
	/** Requests a manual firing. */
	public readonly runNowRequested = output<void>();
	/** Requests retrying the exact saved control command. */
	public readonly retryRequested = output<RoutineControlActions>();
	/** Gives the template finite read states. */
	protected readonly states = RoutineReadStates;
	/** Gives the heading its page hierarchy. */
	protected readonly headingLevel = SectionHeadingLevels.Page;
}
