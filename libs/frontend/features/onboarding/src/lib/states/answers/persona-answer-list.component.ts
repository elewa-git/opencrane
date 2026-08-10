import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import { PersonaQuestion } from "@opencrane/state/onboarding";

import { _SelectedChoiceLabel } from "../../onboarding-view.util";

/** Reusable list of immutable persona answers recorded by the authority. */
@Component({
	selector: "wo-persona-answer-list",
	standalone: true,
	templateUrl: "./persona-answer-list.component.html",
	styleUrl: "./persona-answer-list.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonaAnswerListComponent
{
	/** Frozen reviewed questions whose selected choices should be displayed. */
	public readonly questions = input.required<readonly PersonaQuestion[]>();

	/** Return the reviewed label for one server-recorded interview choice. */
	public selectedChoiceLabel(question: PersonaQuestion): string
	{
		return _SelectedChoiceLabel(question);
	}
}
