import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RadioButtonModule } from "primeng/radiobutton";

import { ChoiceCardLayouts, ChoiceCardOption, ChoiceCardPromptEmphases } from "./choice-card-group.types";

/** Accessible single-choice control rendered as tactile paper cards. */
@Component({
	selector: "wo-choice-card-group",
	standalone: true,
	imports: [FormsModule, RadioButtonModule],
	templateUrl: "./choice-card-group.component.html",
	styleUrl: "./choice-card-group.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChoiceCardGroupComponent
{
	/** Layout enum exposed to the template for typed class selection. */
	public readonly layouts = ChoiceCardLayouts;

	/** Prompt-emphasis enum exposed to the template for typed class selection. */
	public readonly promptEmphases = ChoiceCardPromptEmphases;

	/** Stable DOM prefix used to associate the legend, options, and error. */
	public readonly controlId = input.required<string>();

	/** Accessible question or instruction for the option collection. */
	public readonly legend = input.required<string>();

	/** Finite options rendered in source order. */
	public readonly options = input.required<readonly ChoiceCardOption[]>();

	/** Selected option identifier, or null before a choice is made. */
	public readonly selectedId = input<string | null>(null);

	/** Whether the complete choice group is unavailable. */
	public readonly disabled = input<boolean>(false);

	/** Validation message associated with the fieldset. */
	public readonly validationMessage = input<string | undefined>(undefined);

	/** Responsive arrangement for the cards. */
	public readonly layout = input<ChoiceCardLayouts>(ChoiceCardLayouts.Stack);

	/** Visual priority of this prompt in its surrounding page. */
	public readonly promptEmphasis = input<ChoiceCardPromptEmphases>(ChoiceCardPromptEmphases.Standard);

	/** Emits the stable identifier selected by the user. */
	public readonly selectedIdChange = output<string>();

	/** Emit an allowed option selection without owning feature state. */
	public select(optionId: string): void
	{
		if (!this.disabled())
		{
			this.selectedIdChange.emit(optionId);
		}
	}
}
