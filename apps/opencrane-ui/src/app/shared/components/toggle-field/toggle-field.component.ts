import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ToggleSwitchModule } from "primeng/toggleswitch";

/** Accessible PrimeNG toggle wrapper with pending, disabled, and validation states. */
@Component({
	selector: "oc-toggle-field",
	imports: [FormsModule, ToggleSwitchModule],
	templateUrl: "./toggle-field.component.html",
	styleUrl: "./toggle-field.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class ToggleFieldComponent
{
	/** Stable input identifier used by the visible label. */
	public readonly fieldId = input.required<string>();

	/** Toggle label. */
	public readonly label = input.required<string>();

	/** Optional supporting description. */
	public readonly description = input<string>();

	/** Current checked state. */
	public readonly checked = input<boolean>(false);

	/** Whether the toggle is disabled. */
	public readonly disabled = input<boolean>(false);

	/** Whether a provider mutation is pending. */
	public readonly pending = input<boolean>(false);

	/** Optional validation message. */
	public readonly error = input<string>();

	/** Stable identifier attached to the visible label. */
	public readonly labelId = computed(function _LabelId(this: ToggleFieldComponent): string
	{
		return `${this.fieldId()}-label`;
	}.bind(this));

	/** Stable identifier attached to the validation message. */
	public readonly errorId = computed(function _ErrorId(this: ToggleFieldComponent): string
	{
		return `${this.fieldId()}-error`;
	}.bind(this));

	/** PrimeNG pass-through attributes applied to the native switch input. */
	public readonly inputAttributes = computed(function _InputAttributes(this: ToggleFieldComponent)
	{
		return {
			input:
			{
				"aria-describedby": this.error() ? this.errorId() : undefined,
				"aria-invalid": this.error() ? "true" : undefined
			}
		};
	}.bind(this));

	/** Emits the requested checked state. */
	public readonly checkedChange = output<boolean>();
}
