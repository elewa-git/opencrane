import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import { ScopeChipComponent } from "../scope-chip/scope-chip.component";
import { ScopeChipAppearances, ScopeChipTones } from "../scope-chip/scope-chip.types";
import { PersonaArchetypeScore, PersonaArchetypeTones } from "./persona-summary.types";

/** Reviewed persona identity and score-vector presentation. */
@Component({
	selector: "wo-persona-summary",
	standalone: true,
	imports: [ScopeChipComponent],
	templateUrl: "./persona-summary.component.html",
	styleUrl: "./persona-summary.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonaSummaryComponent
{
	/** Archetype tones exposed to the template for finite class selection. */
	public readonly tones = PersonaArchetypeTones;

	/** Shared chip tones exposed to the template. */
	public readonly chipTones = ScopeChipTones;

	/** Shared chip appearances exposed to the template. */
	public readonly chipAppearances = ScopeChipAppearances;

	/** Stable DOM prefix for the labelled summary region. */
	public readonly componentId = input.required<string>();

	/** Display name of the reviewed primary archetype. */
	public readonly archetype = input.required<string>();

	/** Approved colour treatment of the primary archetype. */
	public readonly tone = input.required<PersonaArchetypeTones>();

	/** Short explanation of the inferred collaboration style. */
	public readonly description = input.required<string>();

	/** Display name of the reviewed secondary influence. */
	public readonly secondaryInfluence = input.required<string>();

	/** Display name of the reviewed openness modifier. */
	public readonly modifier = input.required<string>();

	/** Complete rounded archetype-score vector in display order. */
	public readonly scores = input.required<readonly PersonaArchetypeScore[]>();
}
