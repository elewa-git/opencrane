import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import { ScopeChipAppearances, ScopeChipTones } from "./scope-chip.types";

/** Small mono bordered chip tinted with a scope/status colour. */
@Component({
	selector: "wo-scope-chip",
	standalone: true,
	templateUrl: "./scope-chip.component.html",
	styleUrl: "./scope-chip.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class ScopeChipComponent
{
	/** Tone enum exposed to the template for typed class selection. */
	public readonly tones = ScopeChipTones;

	/** Appearance enum exposed to the template for typed class selection. */
	public readonly appearances = ScopeChipAppearances;

	/** Chip text. */
	public readonly label = input.required<string>();

	/** Semantic colour treatment; raw colour values are deliberately rejected. */
	public readonly tone = input<ScopeChipTones>(ScopeChipTones.Neutral);

	/** Typed boundary/fill treatment. */
	public readonly appearance = input<ScopeChipAppearances>(ScopeChipAppearances.Outlined);
}
