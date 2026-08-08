import { ChangeDetectionStrategy, Component, Signal, computed, inject, resource, signal } from "@angular/core";
import { Router } from "@angular/router";
import { ButtonModule } from "primeng/button";
import { MessageModule } from "primeng/message";
import { ProgressSpinnerModule } from "primeng/progressspinner";

import { ChoiceCardGroupComponent, ChoiceCardLayouts, ChoiceCardOption, CollapsibleSectionComponent, JourneyProgressComponent, JourneyShellComponent, JourneyShellLayouts } from "@opencrane/elements/ui";
import { PersonaOnboardingService, PersonaOnboardingSnapshot, PersonaOnboardingStates, PersonaQuestion } from "@opencrane/state/onboarding";

import { _FindCurrentQuestion, _OnboardingErrorMessage, _ProgressLabel, _QuestionOptions, _ResolutionOptions, _SelectedChoiceLabel } from "../onboarding-view.util";

/** Routed preference survey backed exclusively by the durable persona authority. */
@Component({
	selector: "wo-persona-survey-page",
	standalone: true,
	imports: [ButtonModule, ChoiceCardGroupComponent, CollapsibleSectionComponent, JourneyProgressComponent, JourneyShellComponent, MessageModule, ProgressSpinnerModule],
	templateUrl: "./persona-survey-page.component.html",
	styleUrl: "../onboarding-page.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonaSurveyPageComponent
{
	/** Server-backed persona lifecycle orchestration. */
	private readonly _persona = inject(PersonaOnboardingService);

	/** Router used only to move between authority-derived onboarding pages. */
	private readonly _router = inject(Router);

	/** Shared journey layout enum exposed to the template. */
	public readonly layouts = JourneyShellLayouts;

	/** Shared choice layout enum exposed to the template. */
	public readonly choiceLayouts = ChoiceCardLayouts;

	/** Persona lifecycle enum exposed for exhaustive template states. */
	public readonly states = PersonaOnboardingStates;

	/** Durable persona snapshot loaded through Angular's async resource primitive. */
	public readonly onboarding = resource({ loader: this._load.bind(this) });

	/** Unsaved controlled selection for the one visible question or tie boundary. */
	public readonly selectedId = signal<string | null>(null);

	/** Validation text for the controlled choice group. */
	public readonly validationMessage = signal<string | undefined>(undefined);

	/** Whether a server mutation is in progress. */
	public readonly saving = signal<boolean>(false);

	/** Safe mutation failure displayed without advancing durable progress. */
	public readonly actionError = signal<string | null>(null);

	/** Next unanswered question from the server-returned frozen question set. */
	public readonly currentQuestion: Signal<PersonaQuestion | null> = computed(this._currentQuestion.bind(this));

	/** Shared choice-card inputs for the current reviewed question. */
	public readonly questionOptions: Signal<readonly ChoiceCardOption[]> = computed(this._questionOptions.bind(this));

	/** Shared choice-card inputs limited to the current server-returned tie candidates. */
	public readonly resolutionOptions: Signal<readonly ChoiceCardOption[]> = computed(this._resolutionOptions.bind(this));

	/** Visible progress text sourced only from server-confirmed counts. */
	public readonly progressLabel: Signal<string> = computed(this._progressLabel.bind(this));

	/** Retry the authoritative status read after a blocking failure. */
	public retry(): void
	{
		this.onboarding.reload();
	}

	/** Update the transient controlled choice without treating it as saved evidence. */
	public select(choiceId: string): void
	{
		this.selectedId.set(choiceId);
		this.validationMessage.set(undefined);
	}

	/** Start or resume the one active reviewed interview. */
	public async start(): Promise<void>
	{
		await this._run(async function _Start(this: PersonaSurveyPageComponent)
		{
			this._accept(await this._persona.start());
		}.bind(this));
	}

	/** Save the visible answer once and finish the survey when all ten are durable. */
	public async saveAnswer(): Promise<void>
	{
		const snapshot = this.onboarding.hasValue() ? this.onboarding.value() : null;
		const question = this.currentQuestion();
		const selectedId = this.selectedId();
		if (snapshot === null || snapshot.interviewId === null || question === null || selectedId === null)
		{
			this.validationMessage.set("Choose one answer before continuing.");
			return;
		}
		const interviewId: string = snapshot.interviewId;
		const choiceId: string = selectedId;

		await this._run(async function _Save(this: PersonaSurveyPageComponent)
		{
			let next = await this._persona.answer(interviewId, question.id, choiceId);
			if (next.questionCount > 0 && next.answeredQuestionCount >= next.questionCount)
			{
				next = await this._persona.complete(next.interviewId ?? interviewId);
			}
			this._accept(next);
		}.bind(this));
	}

	/** Persist one exact tie choice before allowing draft creation. */
	public async saveResolution(): Promise<void>
	{
		const snapshot = this.onboarding.hasValue() ? this.onboarding.value() : null;
		const resolution = snapshot?.resolution ?? null;
		const selectedId = this.selectedId();
		if (snapshot === null || snapshot.interviewId === null || resolution === null || selectedId === null)
		{
			this.validationMessage.set("Choose one of the tied working styles before continuing.");
			return;
		}
		const interviewId: string = snapshot.interviewId;
		const selectedValue: string = selectedId;

		await this._run(async function _Resolve(this: PersonaSurveyPageComponent)
		{
			this._accept(await this._persona.resolve(interviewId, resolution.kind, selectedValue));
		}.bind(this));
	}

	/** Return the reviewed label for an already-recorded immutable choice. */
	public selectedChoiceLabel(question: PersonaQuestion): string
	{
		return _SelectedChoiceLabel(question);
	}

	/** Load the exact durable survey position and route completed evidence to review. */
	private async _load(): Promise<PersonaOnboardingSnapshot>
	{
		const snapshot = await this._persona.load();
		this._route(snapshot);
		return snapshot;
	}

	/** Resolve the next unanswered reviewed question from the current resource value. */
	private _currentQuestion(): PersonaQuestion | null
	{
		return this.onboarding.hasValue() ? _FindCurrentQuestion(this.onboarding.value()) : null;
	}

	/** Map the current reviewed question onto shared choice cards. */
	private _questionOptions(): readonly ChoiceCardOption[]
	{
		return _QuestionOptions(this.currentQuestion());
	}

	/** Map only the current authority-returned candidates onto shared choice cards. */
	private _resolutionOptions(): readonly ChoiceCardOption[]
	{
		return this.onboarding.hasValue() ? _ResolutionOptions(this.onboarding.value().resolution) : [];
	}

	/** Render server-confirmed position and durable answer count. */
	private _progressLabel(): string
	{
		return this.onboarding.hasValue() ? _ProgressLabel(this.onboarding.value()) : "Loading saved progress";
	}

	/** Replace the resource with a confirmed server snapshot and apply its route. */
	private _accept(snapshot: PersonaOnboardingSnapshot): void
	{
		this.onboarding.set(snapshot);
		this.selectedId.set(null);
		this.validationMessage.set(undefined);
		this._route(snapshot);
	}

	/** Route only from the durable persona state; failures never grant a later page. */
	private _route(snapshot: PersonaOnboardingSnapshot): void
	{
		if (snapshot.state === PersonaOnboardingStates.Review || snapshot.state === PersonaOnboardingStates.Ready)
		{
			void this._router.navigateByUrl("/onboarding/review");
		}
	}

	/** Run one mutation while preserving the current durable screen on failure. */
	private async _run(operation: () => Promise<void>): Promise<void>
	{
		this.saving.set(true);
		this.actionError.set(null);
		try
		{
			await operation();
		}
		catch (error)
		{
			this.actionError.set(_OnboardingErrorMessage(error, "OpenCrane could not save this onboarding step."));
		}
		finally
		{
			this.saving.set(false);
		}
	}
}
