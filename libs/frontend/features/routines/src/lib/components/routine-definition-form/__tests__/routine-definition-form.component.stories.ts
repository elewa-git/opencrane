import { signal } from "@angular/core";
import type { Meta, StoryObj } from "@storybook/angular";
import { expect, userEvent, within } from "storybook/test";

import { RoutineCommandStates, RoutineEditorModes, RoutineScheduleModes } from "../../../routine-presentation.types";
import { RoutineDefinitionFormComponent } from "../routine-definition-form.component";

const meta: Meta<RoutineDefinitionFormComponent> = { title: "Routines/Definition form", component: RoutineDefinitionFormComponent, tags: ["autodocs", "routine-test"], parameters: { docs: { description: { component: "Controlled routine definition form. The server remains the source of participant choices and schedule previews." } } } };
export default meta;
type Story = StoryObj<RoutineDefinitionFormComponent>;

const DRAFT = { scheduleMode: RoutineScheduleModes.Daily, localTime: "09:00", weekday: 1, expression: "0 9 * * *", timezone: "Europe/Brussels", instruction: "Summarize open decisions and next actions.", selectedManagedServiceId: "service-1", audienceParticipantRefs: ["self", "member-2"] };

/** Reviewed creation draft with requester locked into the audience and a matching preview. */
export const CreateReady: Story = { tags: ["visual-test"], args: { mode: RoutineEditorModes.Create, draft: DRAFT, audienceChoices: [{ participantRef: "self", label: "You", isSelf: true }, { participantRef: "member-2", label: "Amina", isSelf: false }], serviceChoices: [{ id: "service-1", label: "Research assistant" }], timezoneChoices: ["Europe/Brussels", "Africa/Nairobi"], preview: { calculatedAtLabel: "Sep 27, 2026, 17:00 GMT+2", scheduleLabel: "0 9 * * * · Europe/Brussels", occurrences: ["Sep 28, 2026, 09:00 GMT+2", "Sep 29, 2026, 09:00 GMT+2", "Sep 30, 2026, 09:00 GMT+2", "Oct 1, 2026, 09:00 GMT+2", "Oct 2, 2026, 09:00 GMT+2"] }, canSubmit: true }, play: async function _Create({ canvasElement }) { const canvas = within(canvasElement); await expect(canvas.getByText("Always included")).toBeVisible(); await expect(canvas.getByRole("button", { name: "Create routine" })).toBeEnabled(); } };

/** Narrow candidate state; it is not an approved screenshot baseline. */
export const CreateReadyNarrow: Story = { ...CreateReady, tags: ["visual-test", "visual-test-narrow"], parameters: { viewport: { defaultViewport: "mobile1" } } };

/** Revision preserves an arbitrary advanced expression and does not reselect audience or service. */
export const RevisionAdvanced: Story = { tags: ["visual-test"], args: { ...CreateReady.args, mode: RoutineEditorModes.Revise, draft: { ...DRAFT, scheduleMode: RoutineScheduleModes.Advanced, expression: "15 10 * * 1-5" }, previewStale: true, canSubmit: false }, play: async function _Revision({ canvasElement }) { const canvas = within(canvasElement); await expect(canvas.queryByText("Audience")).not.toBeInTheDocument(); await expect(canvas.getByDisplayValue("15 10 * * 1-5")).toBeVisible(); } };

/** Switching from an incomplete advanced expression to a derived daily schedule changes preview availability. */
export const PreviewAvailabilityModeSwitch: Story = { tags: ["visual-test"], args: { ...CreateReady.args, draft: { ...DRAFT, scheduleMode: RoutineScheduleModes.Advanced, expression: "" }, commandState: RoutineCommandStates.Idle, canSubmit: false }, render: function _Render(args)
{
	const controlledDraft = signal({ ...args.draft });

	return {
		props: { ...args, controlledDraft, setScheduleMode: (mode: RoutineScheduleModes): void => { controlledDraft.set({ ...controlledDraft(), scheduleMode: mode }); } },
		template: `<wo-routine-definition-form [mode]="mode" [draft]="controlledDraft()" [audienceChoices]="audienceChoices" [serviceChoices]="serviceChoices" [timezoneChoices]="timezoneChoices" [preview]="preview" [previewStale]="previewStale" [previewLoading]="previewLoading" [previewError]="previewError" [commandState]="commandState" [commandError]="commandError" [canSubmit]="canSubmit" (scheduleModeChanged)="setScheduleMode($event)" />`
	};
}, play: async function _PreviewAvailability({ canvasElement })
{
	const canvas = within(canvasElement);
	const preview = canvas.getByRole("button", { name: "Preview schedule" });
	await expect(preview).toBeDisabled();
	await userEvent.click(canvas.getByRole("radio", { name: "Daily" }));
	await expect(preview).toBeEnabled();
	await userEvent.click(canvas.getByRole("radio", { name: "Advanced" }));
	await expect(preview).toBeDisabled();
} };

/** Uncertain command freezes edits and offers only an explicit same-command retry. */
export const Uncertain: Story = { tags: ["visual-test"], args: { ...CreateReady.args, commandState: RoutineCommandStates.Uncertain, commandError: "OpenCrane could not confirm the result. Retry this unchanged form to reuse the same request." }, play: async function _Uncertain({ canvasElement }) { const canvas = within(canvasElement); await expect(canvas.getByLabelText("What should the assistant do?")).toBeDisabled(); await expect(canvas.getByText(/result is not known/u)).toBeInTheDocument(); } };

/** Conflict freezes the reviewed draft until fresh revision coordinates arrive. */
export const Conflict: Story = { tags: ["visual-test"], args: { ...CreateReady.args, commandState: RoutineCommandStates.Conflict, commandError: "The routine changed elsewhere. Refresh its details before trying again.", canSubmit: false } };
