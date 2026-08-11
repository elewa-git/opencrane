import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";

import type { ElicitationMultipleChoicePresentation } from "./elicitation-control.types.js";

/** Present a bounded subset selection without owning submission state. */
@Component({ selector: "wo-elicitation-multiple-choice", standalone: true, templateUrl: "./elicitation-multiple-choice.component.html", styleUrl: "./elicitation-control.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ElicitationMultipleChoiceComponent
{
	/** Exact server-authored question body and selection bounds. */
	public readonly body = input.required<ElicitationMultipleChoicePresentation>();
	/** Current controlled unique selections. */
	public readonly value = input<readonly string[]>([]);
	/** Whether the controls are unavailable. */
	public readonly disabled = input(false);
	/** Emits a bounded draft without submitting it. */
	public readonly valueChange = output<readonly string[]>();

	/** Whether the option is selected. */
	public selected(value: string): boolean { return this.value().includes(value); }

	/** Whether an unselected option is unavailable at the maximum. */
	public optionDisabled(value: string): boolean { return this.disabled() || (!this.selected(value) && this.value().length >= this.body().maximumSelections); }

	/** Toggle one known option while enforcing the maximum locally. */
	public toggle(value: string): void
	{
		if (this.optionDisabled(value)) return;
		const current = this.value();
		const selections = this.selected(value) ? current.filter(function _Keep(candidate) { return candidate !== value; }) : [...current, value];
		this.valueChange.emit(selections);
	}
}
