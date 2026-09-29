import { provideRouter, withDisabledInitialNavigation } from "@angular/router";
import { applicationConfig, type Meta, type StoryObj } from "@storybook/angular";
import { expect, within } from "storybook/test";

import { ScopeChipTones } from "@opencrane/elements/ui";

import { RoutineReadStates } from "../../../routine-presentation.types";
import { RoutineHistoryComponent } from "../routine-history.component";

const meta: Meta<RoutineHistoryComponent> = { title: "Routines/Run history", component: RoutineHistoryComponent, decorators: [applicationConfig({ providers: [provideRouter([], withDisabledInitialNavigation())] })], tags: ["autodocs", "routine-test"], parameters: { docs: { description: { component: "Authorized firing history with settled cost and only currently readable result links." } } } };
export default meta;
type Story = StoryObj<RoutineHistoryComponent>;

/** Completed and refused firings keep result-link and cost absence explicit. */
export const Ready: Story = { tags: ["visual-test"], args: { state: RoutineReadStates.Ready, rows: [{ firingId: "firing-1", triggerLabel: "Scheduled", disposition: { label: "Completed", tone: ScopeChipTones.Success }, scheduledLabel: "Sep 27, 2026, 09:00 GMT+2", finishedLabel: "Sep 27, 2026, 09:02 GMT+2", reasonLabel: "Completed successfully.", costLabel: "0.04 EUR", resultConversationId: "conversation-result" }, { firingId: "firing-2", triggerLabel: "Run now", disposition: { label: "Refused", tone: ScopeChipTones.Danger }, scheduledLabel: "Manual request", finishedLabel: "Sep 26, 2026, 14:20 GMT+2", reasonLabel: "Current access or execution checks refused this run.", costLabel: "Not recorded", resultConversationId: null }] }, play: async function _Ready({ canvasElement }) { const canvas = within(canvasElement); await expect(canvas.getByRole("link", { name: "Open result" })).toBeVisible(); await expect(canvas.getByText("Unavailable")).toBeVisible(); } };

/** Empty authorized history does not imply a count outside the returned page. */
export const Empty: Story = { tags: ["visual-test"], args: { state: RoutineReadStates.Ready, rows: [] }, play: async function _Empty({ canvasElement }) { const canvas = within(canvasElement); await expect(canvas.getByText("No firing history is visible yet.")).toBeVisible(); } };

/** Access loss removes retained firing rows rather than leaving a blank history region. */
export const AccessChanged: Story = { tags: ["visual-test"], args: { state: RoutineReadStates.AccessChanged, rows: [] }, play: async function _AccessChanged({ canvasElement }) { const canvas = within(canvasElement); await expect(canvas.getByText("Run history was removed from this screen because the current routine access changed.")).toBeVisible(); await expect(canvas.queryByRole("table")).not.toBeInTheDocument(); } };
