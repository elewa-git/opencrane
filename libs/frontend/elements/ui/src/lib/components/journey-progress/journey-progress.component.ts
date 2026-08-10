import { ChangeDetectionStrategy, Component, input } from "@angular/core";

/** Accessible progress summary for a finite, resumable journey. */
@Component({
	selector: "wo-journey-progress",
	standalone: true,
	templateUrl: "./journey-progress.component.html",
	styleUrl: "./journey-progress.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class JourneyProgressComponent
{
	/** Accessible name describing the journey whose progress is shown. */
	public readonly label = input.required<string>();

	/** Visible position or completion summary shown above the progress track. */
	public readonly statusLabel = input.required<string>();

	/** Number of journey items durably completed. */
	public readonly completed = input.required<number>();

	/** Total finite number of positions in the journey. */
	public readonly total = input.required<number>();

	/** Current position constrained to the valid progress range. */
	public valueNow(): number
	{
		return Math.min(Math.max(this.completed(), 0), Math.max(this.total(), 0));
	}

	/** Rounded completion percentage used by the visible progress track. */
	public percentage(): number
	{
		const total = this.total();
		if (total <= 0)
		{
			return 0;
		}

		return Math.round((this.valueNow() / total) * 100);
	}
}
