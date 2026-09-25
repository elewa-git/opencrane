import type { Meta, StoryObj } from "@storybook/angular";
import { expect, userEvent, within } from "storybook/test";

import { ConversationWorkspaceContextPanelComponent } from "../conversation-workspace-context-panel.component";

/** Context-panel states using the production Activity, Files and Computer review composition. */
const meta: Meta<ConversationWorkspaceContextPanelComponent> = {
	title: "Conversations/Workspace context panel",
	component: ConversationWorkspaceContextPanelComponent,
	tags: ["autodocs"],
	args: {
		activityVisible: false,
		activityRows: [],
		assets: [],
		computerReviewVisible: true,
		computerFile: "export const ready = true;",
		computerCommand: { exitCode: 0, outcome: "completed", output: "2 tests passed", truncated: false },
		computerBrowserTargets: [{ id: "page-1", title: "Preview", url: "http://localhost:5173/" }]
	}
};

export default meta;
type Story = StoryObj<ConversationWorkspaceContextPanelComponent>;

/** Files is the default tab and keyboard activation selects Computer review. */
export const ReviewAvailable: Story = {
	tags: ["visual-test", "visual-test-narrow"],
	play: async function _SelectReview({ canvasElement })
	{
		const canvas = within(canvasElement);
		const files = canvas.getByRole("tab", { name: "Files" });
		const review = canvas.getByRole("tab", { name: "Computer review" });
		await expect(files).toHaveAttribute("aria-selected", "true");
		files.focus();
		await userEvent.keyboard("{ArrowRight}");
		await expect(review).toHaveFocus();
		await userEvent.keyboard("{Enter}");
		await expect(review).toHaveAttribute("aria-selected", "true");
		await expect(canvas.getByRole("region", { name: "Computer review" })).toBeVisible();
	}
};

/** Files remains the only section when no active computer can be reviewed. */
export const FilesOnly: Story = {
	tags: ["visual-test"],
	args: { computerReviewVisible: false },
	play: async function _FilesOnly({ canvasElement })
	{
		const canvas = within(canvasElement);
		await expect(canvas.queryByRole("tablist")).not.toBeInTheDocument();
		await expect(canvas.getByText("Files")).toBeVisible();
	}
};

/** Review failure and pending actions remain visible after tab selection. */
export const ReviewBusyWithError: Story = {
	args: { computerReviewBusy: true, computerReviewError: "The active computer could not be reached." },
	play: async function _ReviewFailure({ canvasElement })
	{
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("tab", { name: "Computer review" }));
		await expect(canvas.getByRole("alert")).toHaveTextContent("could not be reached");
		await expect(canvas.getByRole("button", { name: "Run" })).toBeDisabled();
	}
};
