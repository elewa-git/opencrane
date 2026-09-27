import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";

import { ResourceFeedbackComponent } from "@opencrane/elements/ui";

import type { RoutinePreviewView } from "../../routine-presentation.types";

/** Presents server-calculated schedule occurrences and never calculates a firing in the browser. */
@Component({ selector: "wo-routine-schedule-preview", standalone: true, imports: [ButtonModule, ResourceFeedbackComponent], templateUrl: "./routine-schedule-preview.component.html", styleUrl: "./routine-schedule-preview.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class RoutineSchedulePreviewComponent
{
	/** Matching server preview, or null before a successful request. */
	public readonly preview = input<RoutinePreviewView | null>(null);
	/** Whether this preview no longer matches the current schedule draft. */
	public readonly stale = input(false);
	/** Whether the preview request is pending. */
	public readonly loading = input(false);
	/** Safe preview failure copy. */
	public readonly error = input<string | null>(null);
	/** Whether the current schedule has enough input to ask the server. */
	public readonly previewAvailable = input(false);
	/** Requests a server preview for the current schedule. */
	public readonly previewRequested = output<void>();
}
