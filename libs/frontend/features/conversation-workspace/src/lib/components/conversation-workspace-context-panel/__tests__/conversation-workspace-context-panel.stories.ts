import type { Meta, StoryObj } from "@storybook/angular";
import { expect, userEvent, within } from "storybook/test";

import { ConversationActivityKinds, ElicitationRequestStates, type ConversationActivityRow, type ConversationActivityTarget } from "@opencrane/state/conversation/elicitation";

import { ConversationWorkspaceContextPanelComponent } from "../conversation-workspace-context-panel.component";

/** Pending request shown through the production Activity component. */
const _QUESTION: ConversationActivityRow = { kind: ConversationActivityKinds.Elicitation, id: "request-1", label: "Which supplier report should I use?", occurredAt: "2026-09-25T08:00:00.000Z", status: ElicitationRequestStates.Requested, target: { conversationId: "conversation-2", runId: "run-2", requestId: "request-1" } };

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

/** Bind the nested Activity output explicitly so the interaction observes the exact target. */
function _RenderActivityWithTargetSpy(args: NonNullable<Story["args"]>)
{
	return { props: { ...args, capturedTarget: null as ConversationActivityTarget | null }, template: '<wo-conversation-workspace-context-panel [activityVisible]="activityVisible" [activityRows]="activityRows" [filesVisible]="filesVisible" [computerReviewVisible]="computerReviewVisible" (activityTargetRequested)="capturedTarget = $event" /><output data-testid="captured-target" [attr.data-conversation-id]="capturedTarget?.conversationId" [attr.data-run-id]="capturedTarget?.runId" [attr.data-request-id]="capturedTarget?.requestId"></output>' };
}

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

/** Global Activity remains usable without inventing Files for the workspace index. */
export const ActivityOnly: Story = {
	tags: ["visual-test"],
	args: { activityVisible: true, activityRows: [_QUESTION], filesVisible: false, computerReviewVisible: false },
	render: _RenderActivityWithTargetSpy,
	play: async function _ActivityOnly({ canvasElement })
	{
		const canvas = within(canvasElement);
		expect(canvas.queryByText("Files", { exact: true })).not.toBeInTheDocument();
		expect(canvas.queryByRole("tablist")).not.toBeInTheDocument();
		await userEvent.click(canvas.getByRole("button", { name: "Answer" }));
		expect(canvas.getByTestId("captured-target")).toHaveAttribute("data-request-id", "request-1");
	}
};

/** Global Activity remains reachable as the only compact context region. */
export const ActivityOnlyNarrow: Story = { ...ActivityOnly, tags: ["visual-test", "visual-test-narrow"] };

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
