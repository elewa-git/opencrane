import type { Meta, StoryObj } from "@storybook/angular";
import { expect, userEvent, within } from "storybook/test";

import { RunToolProgressPhases, ConversationActivityKinds, ElicitationRequestStates, type ConversationActivityRow, type ConversationActivityRunState } from "@opencrane/state/conversation/elicitation";

import { ConversationActivityComponent } from "../conversation-activity.component";
import { ConversationActivityReadStates } from "../conversation-activity.types";

/** Canonical rows proving requests and visible retry failures together. */
const _ROWS: readonly ConversationActivityRow[] = [
	{ kind: ConversationActivityKinds.Elicitation, id: "request-1", label: "Which report should I continue with?", occurredAt: "2026-08-11T08:00:00.000Z", status: ElicitationRequestStates.Requested, target: { conversationId: "conversation-1", runId: "run-1", requestId: "request-1" } },
	{ kind: ConversationActivityKinds.ToolFailure, id: "tool-1:0", label: "Authentication failed.", occurredAt: "2026-08-11T08:01:00.000Z", retrying: true, technicalDetails: { externalSystem: "Customer portal", toolIdentifier: "publish-report", toolRevision: "r7", failureCategory: "authentication", providerCode: "invalid_token", httpStatus: 401, occurredAt: "2026-08-11T08:01:00.000Z", retryCount: 1, retryLimit: 3 }, target: { conversationId: "conversation-1", runId: "run-1", toolCallId: "tool-1" } }
];

/** Covers each state accepted by the current public run response. */
const _RUN_STATES: readonly ConversationActivityRunState[] = ["accepted", "queued", "assigned", "running", "waiting_for_input", "recovery_required", "completed", "failed"];

/** Storybook metadata for the safe derived Activity index. */
const meta: Meta<ConversationActivityComponent> = { title: "Conversation/Activity", component: ConversationActivityComponent, tags: ["autodocs", "visual-test"], parameters: { docs: { description: { component: "Derived canonical references. A failed attempt is visible while retrying; bounded technical fields remain behind native disclosure." } } } };
export default meta;

/** Local story type. */
type Story = StoryObj<ConversationActivityComponent>;

/** Mixed activity with a still-visible failed tool attempt during retry. */
export const RequestsAndRetryingFailure: Story = { args: { rows: _ROWS } };

/** Empty derived index. */
export const Empty: Story = { args: { rows: [] } };

/** Shows every public run state without internal identifiers or a fabricated answer link. */
export const RecentWork: Story = { args: { title: "Recent activity", refreshAvailable: true, rows: _RUN_STATES.map((status, index) => ({ kind: ConversationActivityKinds.Run, id: `run-${index}`, label: "Assistant work", occurredAt: "2026-09-08T12:00:00.000Z", status, latestTool: null, target: status === "completed" ? { conversationId: "chat", runId: `run-${index}`, entryId: "answer" } : null })) } };

/** Keeps recent activity readable in the narrow context overlay. */
export const RecentWorkNarrow: Story = { ...RecentWork, tags: ["visual-test-narrow"] };

/** Announces the first status read before any rows are available. */
export const Loading: Story = { args: { title: "Recent activity", rows: [], readState: ConversationActivityReadStates.Loading, refreshAvailable: true } };

/** Marks the previous status while a current permission-checked read is pending. */
export const Refreshing: Story = { args: { ...RecentWork.args, readState: ConversationActivityReadStates.Refreshing } };

/** Offers a read retry without starting another assistant run. */
export const ReadFailure: Story = { args: { title: "Recent activity", rows: [], readState: ConversationActivityReadStates.Error, error: "Recent activity could not be loaded. Try again.", refreshAvailable: true }, render: function _Render(args) { return { props: { ...args, refreshCount: 0 }, template: `<wo-conversation-activity [rows]="rows" [title]="title" [readState]="readState" [error]="error" [refreshAvailable]="refreshAvailable" (refreshRequested)="refreshCount = refreshCount + 1" /><output data-testid="refresh-count" [attr.data-count]="refreshCount"></output>` }; }, play: async function _Refresh({ canvasElement })
{
	const canvas = within(canvasElement);
	await userEvent.click(canvas.getByRole("button", { name: "Refresh activity" }));
	expect(canvas.getByTestId("refresh-count")).toHaveAttribute("data-count", "1");
	expect(canvas.queryByRole("button", { name: "Open answer" })).not.toBeInTheDocument();
} };

/** Explains access loss after the store has cleared all private activity rows. */
export const AccessChanged: Story = { args: { title: "Recent activity", rows: [], readState: ConversationActivityReadStates.Error, error: "Recent activity is no longer available. Reopen the chat to check access.", refreshAvailable: false } };

/** Shows tool progress while the assistant's overall work and answer remain unfinished. */
export const ToolProgress: Story = { args: { title: "Recent activity", refreshAvailable: true, rows: Object.values(RunToolProgressPhases).map(phase => ({ kind: ConversationActivityKinds.Run, id: `run-${phase}`, label: "Assistant work", occurredAt: "2026-09-08T12:00:00.000Z", status: "running", latestTool: { phase }, target: null })) }, play: async function _ToolPhases({ canvasElement })
{
	const canvas = within(canvasElement);
	for (const label of ["Tool queued", "Tool running", "Tool result received", "Tool needs attention"])
		expect(canvas.getByText(label, { exact: true })).toBeVisible();
	expect(canvas.getAllByText("Working", { exact: true })).toHaveLength(4);
	expect(canvas.queryByText("Completed", { exact: true })).not.toBeInTheDocument();
	expect(canvas.queryByRole("button", { name: "Open answer" })).not.toBeInTheDocument();
	expect(canvas.getAllByRole("button")).toHaveLength(1);
	expect(canvas.getByRole("button", { name: "Refresh activity" })).toBeVisible();
} };

/** Keeps every tool phase readable in a narrow context panel without introducing execution controls. */
export const ToolProgressNarrow: Story = { ...ToolProgress, tags: ["visual-test-narrow"] };
