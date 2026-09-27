import { provideRouter, withDisabledInitialNavigation } from "@angular/router";
import { applicationConfig, type Meta, type StoryObj } from "@storybook/angular";
import { expect, within } from "storybook/test";

import { ScopeChipTones } from "@opencrane/elements/ui";

import { RoutineCommandStates, RoutineReadStates } from "../../../routine-presentation.types";
import { RoutineDetailComponent } from "../routine-detail.component";

const meta: Meta<RoutineDetailComponent> = { title: "Routines/Details", component: RoutineDetailComponent, decorators: [applicationConfig({ providers: [provideRouter([], withDisabledInitialNavigation())] })], tags: ["autodocs", "routine-test"], parameters: { docs: { description: { component: "Authorized detail presentation. Capability hints control visibility but every command remains server-authorized." } } } };
export default meta;
type Story = StoryObj<RoutineDetailComponent>;

const DETAIL = { routineId: "routine-1", status: { label: "Active", tone: ScopeChipTones.Success }, ownershipLabel: "Created by you", serviceLabel: "Research assistant", scheduleLabel: "0 9 * * * · Europe/Brussels", nextOccurrenceLabel: "Sep 28, 2026, 09:00 GMT+2", lastOccurrenceLabel: "Sep 27, 2026, 09:00 GMT+2", instruction: "Summarize open decisions and next actions.", audienceLabels: ["You · You", "Amina", "Amina"] };
const CAPABILITIES = { revise: true, pause: true, resume: false, retire: true, runNow: true };

/** Active owner view includes manual run while automatic scheduling remains active. */
export const ActiveOwner: Story = { tags: ["visual-test"], args: { state: RoutineReadStates.Ready, detail: DETAIL, capabilities: CAPABILITIES }, play: async function _Active({ canvasElement }) { const canvas = within(canvasElement); await expect(canvas.getByRole("button", { name: "Run now" })).toBeVisible(); await expect(canvas.getAllByText("Amina")).toHaveLength(2); await expect(canvas.getByText("Created by you")).toBeVisible(); } };

/** Known committed command remains visible when the follow-up read could not refresh. */
export const CommittedRefreshFailed: Story = { tags: ["visual-test"], args: { state: RoutineReadStates.CommittedRefreshFailed, detail: null, capabilities: null, commandState: RoutineCommandStates.CommittedRefreshFailed, error: "The revision completed, but current details could not be loaded. Refresh before another action." }, play: async function _CommittedRefreshFailed({ canvasElement }) { const canvas = within(canvasElement); await expect(canvas.getByText("Change accepted")).toBeVisible(); await expect(canvas.getByRole("button", { name: "Refresh details" })).toBeVisible(); await expect(canvas.queryByRole("button", { name: "Run now" })).not.toBeInTheDocument(); } };
