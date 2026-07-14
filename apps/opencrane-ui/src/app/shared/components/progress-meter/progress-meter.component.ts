import { DecimalPipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";
import { ProgressBarModule } from "primeng/progressbar";

/** Accessible used-versus-limit progress presentation shared by budget screens. */
@Component({
	selector: "oc-progress-meter",
	imports: [DecimalPipe, ProgressBarModule],
	templateUrl: "./progress-meter.component.html",
	styleUrl: "./progress-meter.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProgressMeterComponent
{
	/** Current used value. */
	public readonly used = input.required<number>();

	/** Maximum value. */
	public readonly limit = input.required<number>();

	/** Accessible metric label. */
	public readonly label = input.required<string>();

	/** Percentage at which the meter switches to its warning treatment. */
	public readonly warningThreshold = input<number>(80);

	/** Progress bar height in pixels. */
	public readonly height = input<number>(7);

	/** Optional textual status appended after the usage summary. */
	public readonly status = input<string>();

	/** Clamped percentage passed to PrimeNG. */
	public readonly percentage = computed(function _percentage(this: ProgressMeterComponent): number
	{
		return this.limit() <= 0 ? 0 : Math.min(100, Math.max(0, this.used() / this.limit() * 100));
	}.bind(this));
}
