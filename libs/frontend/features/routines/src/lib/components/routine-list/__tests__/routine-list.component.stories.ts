import { provideRouter, withDisabledInitialNavigation } from "@angular/router";
import { applicationConfig, type Meta, type StoryObj } from "@storybook/angular";
import { expect, within } from "storybook/test";

import { ScopeChipTones } from "@opencrane/elements/ui";

import { RoutineReadStates } from "../../../routine-presentation.types";
import { RoutineListComponent } from "../routine-list.component";

const meta: Meta<RoutineListComponent> = { title: "Routines/List", component: RoutineListComponent, decorators: [applicationConfig({ providers: [provideRouter([], withDisabledInitialNavigation())] })], tags: ["autodocs", "routine-test"], parameters: { docs: { description: { component: "Authorized sparse routine pages. These fixtures are component states, not approved screenshot baselines." } } } };
export default meta;
type Story = StoryObj<RoutineListComponent>;

/** Ready list with active, paused, owned, and shared labels. */
export const Ready: Story = { tags: ["visual-test"], args: { state: RoutineReadStates.Ready, rows: [{ routineId: "routine-1", status: { label: "Active", tone: ScopeChipTones.Success }, ownershipLabel: "Created by you", serviceLabel: "Research assistant", scheduleLabel: "0 9 * * * · Europe/Brussels", nextOccurrenceLabel: "Sep 28, 2026, 09:00 GMT+2", lastFiringLabel: "Completed · Sep 27, 2026" }, { routineId: "routine-2", status: { label: "Paused", tone: ScopeChipTones.Warning }, ownershipLabel: "Shared with you", serviceLabel: "Operations assistant", scheduleLabel: "30 8 * * 1 · Africa/Nairobi", nextOccurrenceLabel: "Not scheduled", lastFiringLabel: "No runs yet" }], hasMore: true }, play: async function _Ready({ canvasElement }) { const canvas = within(canvasElement); await expect(canvas.getByRole("table")).toBeVisible(); await expect(canvas.getAllByRole("link", { name: "Open routine details" })).toHaveLength(2); } };

/** Narrow candidate state; it is not an approved screenshot baseline. */
export const ReadyNarrow: Story = { ...Ready, tags: ["visual-test", "visual-test-narrow"], parameters: { viewport: { defaultViewport: "mobile1" } } };

/** Access loss removes all protected rows and offers a fresh authorized read. */
export const AccessChanged: Story = { tags: ["visual-test"], args: { state: RoutineReadStates.AccessChanged, rows: [] }, play: async function _AccessChanged({ canvasElement }) { const canvas = within(canvasElement); await expect(canvas.queryByRole("table")).not.toBeInTheDocument(); await expect(canvas.getByText("Your saved routine data was removed from this screen.")).toBeVisible(); } };
