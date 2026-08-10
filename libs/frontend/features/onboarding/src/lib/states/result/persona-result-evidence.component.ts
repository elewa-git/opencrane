import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import { CollapsibleSectionComponent, PersonaArchetypeScore, PersonaArchetypeTones, PersonaSummaryComponent } from "@opencrane/elements/ui";
import { PersonaColours, PersonaQuestion, PersonaResult } from "@opencrane/state/onboarding";

import { _PersonaDescription, _PersonaScores, _PersonaTone, _PersonaValueLabel } from "../../onboarding-view.util";
import { PersonaAnswerListComponent } from "../answers/persona-answer-list.component";

/** Shared evidence presentation used by the distinct review and ready state components. */
@Component({
	selector: "wo-persona-result-evidence",
	standalone: true,
	imports: [CollapsibleSectionComponent, PersonaAnswerListComponent, PersonaSummaryComponent],
	templateUrl: "./persona-result-evidence.component.html",
	styleUrl: "../../onboarding-page.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonaResultEvidenceComponent
{
	/** Server-derived review result displayed without local mutation. */
	public readonly result = input.required<PersonaResult>();

	/** Frozen reviewed questions carrying immutable selected choices. */
	public readonly questions = input.required<readonly PersonaQuestion[]>();

	/** Map the primary colour to the shared semantic persona tone. */
	public tone(colour: PersonaColours): PersonaArchetypeTones
	{
		return _PersonaTone(colour);
	}

	/** Explain the selected primary collaboration style without diagnosing the owner. */
	public description(colour: PersonaColours): string
	{
		return _PersonaDescription(colour);
	}

	/** Render a server-owned colour or modifier as a human-readable label. */
	public label(value: string): string
	{
		return _PersonaValueLabel(value);
	}

	/** Derive display-only rounded bars from the lossless server score vector. */
	public scores(result: PersonaResult): readonly PersonaArchetypeScore[]
	{
		return _PersonaScores(result);
	}

}
