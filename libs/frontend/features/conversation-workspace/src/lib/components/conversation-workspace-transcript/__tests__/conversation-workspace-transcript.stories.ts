import type { Meta, StoryObj } from "@storybook/angular";
import { expect, within } from "storybook/test";
import { ConversationMessageTones, ConversationStatusTones } from "@opencrane/elements/conversation";
import { AvatarTones } from "@opencrane/elements/ui";
import { ConversationWorkspaceTranscriptEntryKinds, type ConversationWorkspaceTranscriptEntry } from "../../../presentation/conversation-workspace-presentation.types";
import { ConversationWorkspaceTranscriptComponent } from "../conversation-workspace-transcript.component";

/** Long public name proves text escaping and wrapping without exposing execution coordinates. */
const _LONG_TOOL_NAME = `${"Customer records archive ".repeat(6)}<review>`;
const _LONG_TOOL_DETAIL = `${_LONG_TOOL_NAME}: result received. The assistant may still be preparing its answer.`;

/** Typical message followed by durable tool evidence and the assistant's final answer. */
const _RESULT_ENTRIES: readonly ConversationWorkspaceTranscriptEntry[] = [
	{ kind: ConversationWorkspaceTranscriptEntryKinds.Message, id: "question", message: { id: "question", authorName: "You", authorInitials: "Y", avatarTone: AvatarTones.Blue, timestampLabel: "09:30", body: "", tone: ConversationMessageTones.Participant }, richText: { messageId: "question", html: "<p>Find the current customer status.</p>", label: "Your message" }, requestSource: null, shareSource: null, children: [] },
	{ kind: ConversationWorkspaceTranscriptEntryKinds.ToolActivity, id: "tool-status", status: { label: "Tool result received", detail: "Customer records: result received. The assistant may still be preparing its answer.", tone: ConversationStatusTones.Neutral } },
	{ kind: ConversationWorkspaceTranscriptEntryKinds.Message, id: "answer", message: { id: "answer", authorName: "Company assistant", authorInitials: "CA", avatarTone: AvatarTones.Brand, timestampLabel: "09:31", body: "", tone: ConversationMessageTones.Agent }, richText: { messageId: "answer", html: "<p>The customer account is active.</p>", label: "Company assistant message" }, requestSource: null, shareSource: null, children: [] }
];

/** Uncertain tool evidence offers no execution or retry control. */
const _RECOVERY_ENTRIES: readonly ConversationWorkspaceTranscriptEntry[] = [{ kind: ConversationWorkspaceTranscriptEntryKinds.ToolActivity, id: "tool-recovery", status: { label: "Tool needs attention", detail: "Customer records: the outcome is uncertain. OpenCrane will not repeat it automatically.", tone: ConversationStatusTones.Attention } }];

/** Transcript's empty state; routed workspace stories retain long-content and group action coverage. */
const meta: Meta<ConversationWorkspaceTranscriptComponent> = { title: "Conversations/Workspace transcript", component: ConversationWorkspaceTranscriptComponent, tags: ["autodocs"] };
export default meta;
type Story = StoryObj<ConversationWorkspaceTranscriptComponent>;
/** A selected conversation without messages invites the first contribution. */
export const Empty: Story = { tags: ["visual-test"], args: { entries: [] } };

/** Preserves tool-result evidence separately from the final assistant answer. */
export const ToolResultAndAnswer: Story = { tags: ["visual-test"], args: { entries: _RESULT_ENTRIES }, play: async function _Evidence({ canvasElement })
{
	const canvas = within(canvasElement);
	expect(canvas.getByText("Tool result received", { exact: true })).toBeVisible();
	expect(canvas.getByText("The customer account is active.", { exact: true })).toBeVisible();
	expect(canvas.queryByRole("button")).not.toBeInTheDocument();
} };

/** Escapes and wraps a long public tool name inside the shared status-line contract. */
export const LongEscapedToolName: Story = { tags: ["visual-test", "visual-test-narrow"], args: { entries: [{ kind: ConversationWorkspaceTranscriptEntryKinds.ToolActivity, id: "long-tool-status", status: { label: "Tool result received", detail: _LONG_TOOL_DETAIL, tone: ConversationStatusTones.Neutral } }] }, play: async function _SafeName({ canvasElement })
{
	const canvas = within(canvasElement);
	const detail = canvas.getByText(_LONG_TOOL_DETAIL, { exact: true });
	expect(detail).toBeVisible();
	expect(canvasElement.querySelector("review")).toBeNull();
	expect(globalThis.getComputedStyle(detail).overflowWrap).toBe("anywhere");
} };

/** Keeps recovery evidence readable without inventing a retry action. */
export const ToolRecoveryNarrow: Story = { tags: ["visual-test", "visual-test-narrow"], args: { entries: _RECOVERY_ENTRIES }, play: async function _NoRetry({ canvasElement })
{
	const canvas = within(canvasElement);
	expect(canvas.getByText("Tool needs attention", { exact: true })).toBeVisible();
	expect(canvas.getByText(/will not repeat it automatically/u)).toBeVisible();
	expect(canvas.queryByRole("button")).not.toBeInTheDocument();
} };
