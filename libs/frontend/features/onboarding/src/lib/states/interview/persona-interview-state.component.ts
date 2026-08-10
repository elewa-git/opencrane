import { ChangeDetectionStrategy, Component, Signal, computed, input, linkedSignal, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";

import { ChoiceCardGroupComponent, ChoiceCardLayouts, ChoiceCardOption, CollapsibleSectionComponent, JourneyProgressComponent, JourneyShellComponent, JourneyShellLayouts } from "@opencrane/elements/ui";
import { PersonaOnboardingStates, PersonaQuestion } from "@opencrane/state/onboarding";

import { _FindCurrentQuestion, _ProgressLabel, _QuestionOptions } from "../../onboarding-view.util";
import type { PersonaAnswerIntent, PersonaOnboardingStateSnapshot } from "../../persona-onboarding-state.types";
import { PersonaAnswerListComponent } from "../answers/persona-answer-list.component";

/** Presentational owner for the interview lifecycle state. */
@Component({
	selector: "wo-persona-interview-state",
	standalone: true,
	imports: [ButtonModule, ChoiceCardGroupComponent, CollapsibleSectionComponent, JourneyProgressComponent, JourneyShellComponent, MessageModule, PersonaAnswerListComponent],
	templateUrl: "./persona-interview-state.component.html",
	styleUrl: "../../onboarding-page.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonaInterviewStateComponent
{
	/** Authoritative interview projection selected by the parent state switch. */
	public readonly snapshot = input.required<PersonaOnboardingStateSnapshot<PersonaOnboardingStates.Interview>>();

	/** Whether the parent shell has admitted an authority command. */
	public readonly busy = input.required<boolean>();

	/** Bounded command failure retained by the parent shell. */
	public readonly actionError = input.required<string | null>();

	/** Intent to start or resume the reviewed interview. */
	public readonly startRequested = output<void>();

	/** Exact reviewed answer intent for the authority-owning shell. */
	public readonly answerSubmitted = output<PersonaAnswerIntent>();

	/** Shared journey layout enum exposed to the template. */
	public readonly layouts = JourneyShellLayouts;

	/** Shared choice layout enum exposed to the template. */
	public readonly choiceLayouts = ChoiceCardLayouts;

	/** Next unanswered question from the server-returned frozen question set. */
	public readonly currentQuestion: Signal<PersonaQuestion | null> = computed(this._currentQuestion.bind(this));

	/** Selection reset whenever the authoritative question coordinate changes. */
	public readonly selectedId = linkedSignal<string | null, string | null>({ source: this._selectionCoordinate.bind(this), computation: function _ResetSelection() { return null; } });

	/** Validation reset whenever the authoritative question coordinate changes. */
	public readonly validationMessage = linkedSignal<string | null, string | undefined>({ source: this._selectionCoordinate.bind(this), computation: function _ResetValidation() { return undefined; } });

	/** Shared choice-card inputs for the current reviewed question. */
	public readonly questionOptions: Signal<readonly ChoiceCardOption[]> = computed(this._questionOptions.bind(this));

	/** Visible progress text sourced only from server-confirmed counts. */
	public readonly progressLabel: Signal<string> = computed(this._progressLabel.bind(this));

	/** Update the transient controlled choice without treating it as saved evidence. */
	public select(choiceId: string): void
	{
		this.selectedId.set(choiceId);
		this.validationMessage.set(undefined);
	}

	/** Emit one exact answer intent while keeping lifecycle advancement in the parent authority shell. */
	public submitAnswer(): void
	{
		const snapshot = this.snapshot();
		const question = this.currentQuestion();
		const choiceId = this.selectedId();
		if (snapshot.interviewId === null || question === null || choiceId === null)
		{
			this.validationMessage.set("Choose one answer before continuing.");
			return;
		}
		this.answerSubmitted.emit({ interviewId: snapshot.interviewId, questionId: question.id, choiceId });
	}

	/** Resolve the next unanswered reviewed question from the current authority input. */
	private _currentQuestion(): PersonaQuestion | null
	{
		return _FindCurrentQuestion(this.snapshot());
	}

	/** Reset controlled state only when the server advances to another reviewed question. */
	private _selectionCoordinate(): string | null
	{
		return this.currentQuestion()?.id ?? null;
	}

	/** Map the current reviewed question onto shared choice cards. */
	private _questionOptions(): readonly ChoiceCardOption[]
	{
		return _QuestionOptions(this.currentQuestion());
	}

	/** Render server-confirmed position and durable answer count. */
	private _progressLabel(): string
	{
		return _ProgressLabel(this.snapshot());
	}
}
