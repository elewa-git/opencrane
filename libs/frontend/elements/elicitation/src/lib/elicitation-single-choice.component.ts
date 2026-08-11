import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";

import type { ElicitationSingleChoicePresentation } from "./elicitation-control.types.js";

/** Present exactly one selection from a bounded server-authored list. */
@Component({ selector: "wo-elicitation-single-choice", standalone: true, templateUrl: "./elicitation-single-choice.component.html", styleUrl: "./elicitation-control.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class ElicitationSingleChoiceComponent
{
	/** Exact server-authored question body. */
	public readonly body = input.required<ElicitationSingleChoicePresentation>();
	/** Current controlled selection. */
	public readonly value = input<string | null>(null);
	/** Whether the controls are unavailable. */
	public readonly disabled = input(false);
	/** Emits a draft without submitting it. */
	public readonly valueChange = output<string>();

	/** Emit a known option as the selected draft. */
	public select(selection: string): void
	{
		if (!this.disabled() && this.body().choices.some(function _Matches(choice) { return choice.value === selection; })) this.valueChange.emit(selection);
	}
}
