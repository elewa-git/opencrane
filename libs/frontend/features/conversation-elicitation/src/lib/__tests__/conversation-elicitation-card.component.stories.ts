import type { Meta, StoryObj } from "@storybook/angular";
import { expect, within } from "storybook/test";

import { CONVERSATION_ELICITATION_VERSION, ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates, type ConversationElicitation } from "@opencrane/state/conversation/elicitation";

import { ConversationElicitationCardComponent } from "../conversation-elicitation-card.component";

/** Build one canonical requested card story. */
function _Request(body: ConversationElicitation["body"], requiresStepUp = false): ConversationElicitation
{
	return { version: CONVERSATION_ELICITATION_VERSION, requestId: `request-${body.kind}`, conversationId: "conversation-1", runId: "run-1", attempt: 1, assignedParticipantId: "user-1", purpose: body.kind === ElicitationBodyKinds.Approval ? ElicitationPurposes.ToolApproval : ElicitationPurposes.RuntimeInput, state: ElicitationRequestStates.Requested, body, requiresStepUp, requestedAt: "2026-08-11T08:00:00.000Z", expiresAt: "2026-08-11T09:00:00.000Z" };
}

/** Storybook metadata for the recoverable conversation request card. */
const meta: Meta<ConversationElicitationCardComponent> = { title: "Conversation/Elicitation card", component: ConversationElicitationCardComponent, tags: ["autodocs", "visual-test"], parameters: { docs: { description: { component: "Server-projected participant input with controlled drafts, separate submission, terminal outcomes, and recoverable verified sign-in." } } } };
export default meta;

/** Local story type. */
type Story = StoryObj<ConversationElicitationCardComponent>;

/** Exact consequential approval disclosure before an explicit decision. */
export const Approval: Story = { args: { elicitation: _Request({ kind: ElicitationBodyKinds.Approval, prompt: "Create this calendar event?", action: "Create calendar event", target: "Team planning calendar", dataUse: "The meeting title, time, and invited colleagues", proposedArguments: { title: "Quarterly planning", startsAt: "2026-09-15T09:00:00+03:00", invitees: ["Amina", "Kamau"] }, externalSystem: "Company calendar", consequence: "The invited colleagues will receive a calendar invitation." }, true), draft: { kind: ElicitationBodyKinds.Approval, approved: true }, error: "Please sign in again to confirm this action.", stepUpPath: "/api/v1/auth/reauthenticate" }, play: async function _StepUpFence({ canvasElement })
{
	const canvas = within(canvasElement);
	expect(await canvas.findByRole("button", { name: "Sign in again" })).toBeEnabled();
	expect(canvas.getByRole("button", { name: "Confirm approval" })).toBeDisabled();
	expect(canvas.getByRole("radio", { name: /Approve/u })).toBeDisabled();
} };

/** Hidden proposal fields keep denial available while affirmative approval is disabled. */
export const ApprovalDetailsHidden: Story = { args: { elicitation: _Request({ kind: ElicitationBodyKinds.Approval, prompt: "Create this calendar event?", action: "Create calendar event", target: "Team planning calendar", dataUse: "The meeting details", proposedArguments: null, externalSystem: "Company calendar", consequence: "The invited colleagues may receive a calendar invitation." }), draft: null }, play: async function _DenialRemainsAvailable({ canvasElement })
{
	const canvas = within(canvasElement);
	expect(await canvas.findByRole("radio", { name: /Approve/u })).toBeDisabled();
	expect(canvas.getByRole("radio", { name: /Deny/u })).toBeEnabled();
} };

/** Authority confirms that the participant denied the action. */
export const Declined: Story = { args: { elicitation: { ..._Request({ kind: ElicitationBodyKinds.Approval, prompt: "Create this calendar event?", action: "Create calendar event", target: "Team planning calendar", dataUse: "The meeting details", proposedArguments: { title: "Quarterly planning" }, consequence: "The invited colleagues will receive a calendar invitation." }), state: ElicitationRequestStates.Declined, resolvedAt: "2026-08-11T08:05:00.000Z" } } };

/** Authority closes an approval whose response window elapsed. */
export const Expired: Story = { args: { elicitation: { ..._Request({ kind: ElicitationBodyKinds.Approval, prompt: "Create this calendar event?", action: "Create calendar event", target: "Team planning calendar", dataUse: "The meeting details", proposedArguments: { title: "Quarterly planning" }, consequence: "The invited colleagues will receive a calendar invitation." }), state: ElicitationRequestStates.Expired, resolvedAt: "2026-08-11T09:00:00.000Z" } } };

/** One typed server-authored option. */
export const SingleChoice: Story = { args: { elicitation: _Request({ kind: ElicitationBodyKinds.SingleChoice, prompt: "Which report should I continue with?", choices: [{ value: "quarterly", label: "Quarterly report", description: "Use the reviewed Q2 evidence." }, { value: "annual", label: "Annual report", description: "Wait for the remaining evidence." }] }), draft: { kind: ElicitationBodyKinds.SingleChoice, selection: "quarterly" } } };

/** Bounded multi-selection at the exact maximum. */
export const MultipleChoice: Story = { args: { elicitation: _Request({ kind: ElicitationBodyKinds.MultipleChoice, prompt: "Which evidence should be included?", choices: [{ value: "sales", label: "Sales" }, { value: "support", label: "Support" }, { value: "research", label: "Research" }], minimumSelections: 1, maximumSelections: 2 }), draft: { kind: ElicitationBodyKinds.MultipleChoice, selections: ["sales", "support"] } } };

/** Bounded participant-authored input. */
export const FreeText: Story = { args: { elicitation: _Request({ kind: ElicitationBodyKinds.FreeText, prompt: "What should I clarify before continuing?", maximumLength: 500, allowEmpty: false }), draft: { kind: ElicitationBodyKinds.FreeText, text: "Explain why the authentication failed." } } };

/** Terminal authority replaces all editable controls. */
export const Answered: Story = { args: { elicitation: { ..._Request({ kind: ElicitationBodyKinds.FreeText, prompt: "What should I clarify?", maximumLength: 500, allowEmpty: false }), state: ElicitationRequestStates.Answered, resolvedAt: "2026-08-11T08:05:00.000Z", safeReason: "Your response was saved." } } };
