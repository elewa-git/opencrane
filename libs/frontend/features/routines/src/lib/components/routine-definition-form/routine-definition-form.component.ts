import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ButtonModule } from "primeng/button";
import { CheckboxModule } from "primeng/checkbox";
import { InputTextModule } from "primeng/inputtext";
import { MessageModule } from "primeng/message";
import { SelectModule } from "primeng/select";
import { TextareaModule } from "primeng/textarea";

import { ChoiceCardGroupComponent, SectionHeadingComponent, SectionHeadingLevels } from "@opencrane/elements/ui";

import { RoutineCommandStates, RoutineEditorModes, RoutineScheduleModes, type RoutineAudienceChoiceView, type RoutineDefinitionDraft, type RoutinePreviewView, type RoutineServiceChoiceView } from "../../routine-presentation.types";
import { _RoutineScheduleFromDraft } from "../../routine-schedule";
import { RoutineSchedulePreviewComponent } from "../routine-schedule-preview/routine-schedule-preview.component";

/** Presents the controlled create or revise form while its route-scoped store owns every command. */
@Component({ selector: "wo-routine-definition-form", standalone: true, imports: [ButtonModule, CheckboxModule, ChoiceCardGroupComponent, FormsModule, InputTextModule, MessageModule, RoutineSchedulePreviewComponent, SectionHeadingComponent, SelectModule, TextareaModule], templateUrl: "./routine-definition-form.component.html", styleUrl: "./routine-definition-form.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class RoutineDefinitionFormComponent
{
	/** Whether this form creates a routine or replaces its current revision. */
	public readonly mode = input(RoutineEditorModes.Create);
	/** Current controlled form values. */
	public readonly draft = input.required<RoutineDefinitionDraft>();
	/** Authorized audience choices returned for the destination conversation. */
	public readonly audienceChoices = input<readonly RoutineAudienceChoiceView[]>([]);
	/** Authorized managed services returned for the destination conversation. */
	public readonly serviceChoices = input<readonly RoutineServiceChoiceView[]>([]);
	/** Named timezone choices supplied by the route store. */
	public readonly timezoneChoices = input<readonly string[]>([]);
	/** Server preview matching an earlier schedule draft. */
	public readonly preview = input<RoutinePreviewView | null>(null);
	/** Whether the retained preview no longer matches this draft. */
	public readonly previewStale = input(false);
	/** Whether schedule preview is pending. */
	public readonly previewLoading = input(false);
	/** Safe schedule-preview error. */
	public readonly previewError = input<string | null>(null);
	/** Current mutation state. */
	public readonly commandState = input(RoutineCommandStates.Idle);
	/** Safe mutation error. */
	public readonly commandError = input<string | null>(null);
	/** Whether the store accepts submission of the current reviewed draft. */
	public readonly canSubmit = input(false);
	/** Emits a schedule-mode choice. */
	public readonly scheduleModeChanged = output<RoutineScheduleModes>();
	/** Emits the controlled local time. */
	public readonly localTimeChanged = output<string>();
	/** Emits the controlled weekday. */
	public readonly weekdayChanged = output<number>();
	/** Emits the controlled advanced expression. */
	public readonly expressionChanged = output<string>();
	/** Emits the controlled timezone. */
	public readonly timezoneChanged = output<string>();
	/** Emits the controlled instruction. */
	public readonly instructionChanged = output<string>();
	/** Emits one managed service selection. */
	public readonly managedServiceChanged = output<string>();
	/** Emits one audience reference to toggle. */
	public readonly audienceToggled = output<string>();
	/** Requests an authoritative schedule preview. */
	public readonly previewRequested = output<void>();
	/** Requests create or revise using the store's saved retry command. */
	public readonly submitted = output<void>();
	/** Requests returning without a mutation. */
	public readonly cancelled = output<void>();
	/** Gives the template its finite form modes. */
	protected readonly modes = RoutineEditorModes;
	/** Gives the template its finite schedule modes. */
	protected readonly scheduleModes = RoutineScheduleModes;
	/** Gives the template its finite command states. */
	protected readonly commandStates = RoutineCommandStates;
	/** Gives the page heading its semantic level. */
	protected readonly headingLevel = SectionHeadingLevels.Page;
	/** Daily, weekly and advanced choices use the existing single-choice element. */
	protected readonly scheduleModeChoices = [{ id: RoutineScheduleModes.Daily, label: "Daily", detail: "Run at one local time every day." }, { id: RoutineScheduleModes.Weekly, label: "Weekly", detail: "Run on one weekday at one local time." }, { id: RoutineScheduleModes.Advanced, label: "Advanced", detail: "Use a numeric five-field cron expression." }];
	/** Numeric weekdays used to build a weekly cron expression. */
	protected readonly weekdays = [{ value: 1, label: "Monday" }, { value: 2, label: "Tuesday" }, { value: 3, label: "Wednesday" }, { value: 4, label: "Thursday" }, { value: 5, label: "Friday" }, { value: 6, label: "Saturday" }, { value: 0, label: "Sunday" }];
	/** Maps server services into the shared single-choice contract. */
	protected readonly serviceOptions = computed(() => this.serviceChoices().map(choice => ({ id: choice.id, label: choice.label })));
	/** Prevents edits while a command is in flight, uncertain, or awaiting conflict refresh. */
	protected readonly editingLocked = computed(() => this.commandState() === RoutineCommandStates.Submitting || this.commandState() === RoutineCommandStates.Uncertain || this.commandState() === RoutineCommandStates.Conflict);
	/** Enables preview only when the current mode and values produce a valid normalized schedule. */
	protected readonly previewAvailable = computed(() => this.commandState() === RoutineCommandStates.Idle && _RoutineScheduleFromDraft(this.draft()) !== null);
	/** Reports only the state that should render the button spinner. */
	protected readonly submitting = computed(() => this.commandState() === RoutineCommandStates.Submitting);
	/** Labels the primary action from the form's durable intent. */
	protected readonly submitLabel = computed(() => this.mode() === RoutineEditorModes.Create ? "Create routine" : "Save revision");

	/** Emits a known schedule-mode enum member instead of casting an arbitrary component value. */
	protected chooseScheduleMode(value: string): void
	{
		for (const mode of Object.values(RoutineScheduleModes))
		{
			if (mode === value)
			{
				this.scheduleModeChanged.emit(mode);
				return;
			}
		}
	}

	/** Keeps the requester selected and rejects references outside the server choices. */
	protected toggleAudience(participantRef: string): void
	{
		const choice = this.audienceChoices().find(candidate => candidate.participantRef === participantRef);
		if (choice === undefined || choice.isSelf || this.editingLocked())
			return;
		this.audienceToggled.emit(participantRef);
	}
}
