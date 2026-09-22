import { signal } from "@angular/core";
import type { Meta, StoryObj } from "@storybook/angular";
import { expect, fn, userEvent, within } from "storybook/test";

import { CONVERSATION_ELICITATION_VERSION, ElicitationBodyKinds, ElicitationConnectionOwnerKinds, ElicitationPurposes, ElicitationRequestStates, McpCredentialRequirement, type ConversationElicitation, type ElicitationApprovalBody, type ElicitationExecutionConnection, type ElicitationResponseValue } from "@opencrane/state/conversation/elicitation";

import { ConversationElicitationCardComponent } from "../conversation-elicitation-card.component";

/** Build one canonical requested card story. */
function _Request(body: ConversationElicitation["body"], requiresStepUp = false): ConversationElicitation
{
	const disclosedBody = body.kind === ElicitationBodyKinds.Approval ? { ...body, executionConnection: body.executionConnection ?? _PERSONAL_CONNECTION } : body;
	return { version: CONVERSATION_ELICITATION_VERSION, requestId: `request-${body.kind}`, conversationId: "conversation-1", runId: "run-1", attempt: 1, assignedParticipantId: "user-1", purpose: body.kind === ElicitationBodyKinds.Approval ? ElicitationPurposes.ToolApproval : ElicitationPurposes.RuntimeInput, state: ElicitationRequestStates.Requested, body: disclosedBody, requiresStepUp, requestedAt: "2026-08-11T08:00:00.000Z", expiresAt: "2026-08-11T09:00:00.000Z" };
}

/** Show the execution owner separately from the human choosing whether to proceed. */
const _PERSONAL_CONNECTION: ElicitationExecutionConnection = { ownerKind: ElicitationConnectionOwnerKinds.Personal, ownerLabel: "Amina", credentialRequirement: McpCredentialRequirement.PrincipalCredential };

/** Supply complete reviewable arguments for the enabled approval fixtures. */
const _APPROVAL_BODY: ElicitationApprovalBody = { kind: ElicitationBodyKinds.Approval, prompt: "Create this inventory review meeting?", action: "Create calendar event", target: "Nairobi operations calendar", dataUse: "The meeting title, time, and invited colleagues", proposedArguments: { title: "Inventory review", startsAt: "2026-09-24T09:00:00+03:00", invitees: ["Amina", "Kamau"] }, externalSystem: "Company calendar", consequence: "The invited colleagues will receive a calendar invitation.", executionConnection: _PERSONAL_CONNECTION };

/** Storybook metadata for the recoverable conversation request card. */
const meta: Meta<ConversationElicitationCardComponent> = { title: "Conversation/Elicitation card", component: ConversationElicitationCardComponent, tags: ["autodocs", "visual-test"], argTypes: { draftSelected: { action: "draftSelected" }, submitRequested: { action: "submitRequested" } }, parameters: { docs: { description: { component: "Server-projected participant input with controlled drafts, separate submission, terminal outcomes, and recoverable verified sign-in." } } } };
export default meta;

/** Local story type. */
type Story = StoryObj<ConversationElicitationCardComponent>;

/** Mirror the parent store's draft feedback while separately observing the card's emitted intents. */
function _RenderApprovalWithOutputSpies(args: NonNullable<Story["args"]>)
{
	const controlledDraft = signal<ElicitationResponseValue | null>(args.draft ?? null);
	return {
		props: { ...args, controlledDraft, onDraftSelected: function _DraftSelected(value: ElicitationResponseValue) { args.draftSelected?.(value); controlledDraft.set(value); }, onSubmitRequested: args.submitRequested },
		template: '<wo-conversation-elicitation-card [elicitation]="elicitation" [draft]="controlledDraft()" (draftSelected)="onDraftSelected($event)" (submitRequested)="onSubmitRequested()" />'
	};
}

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

/** A personal connection admits a draft but still requires a separate confirmation. */
export const ApprovalPersonalConnection: Story = { args: { elicitation: _Request(_APPROVAL_BODY), draft: null, draftSelected: fn(), submitRequested: fn() }, render: _RenderApprovalWithOutputSpies, play: async function _PersonalChoice({ canvasElement, args })
{
	const canvas = within(canvasElement);
	expect(await canvas.findByText("Personal connection: Amina")).toBeVisible();
	expect(canvas.getByText("Credential bound to this connection owner.")).toBeVisible();
	const approve = canvas.getByRole("radio", { name: /Approve/u });
	expect(approve).toBeEnabled();
	await userEvent.click(approve);
	expect(args.draftSelected).toHaveBeenCalledWith({ kind: ElicitationBodyKinds.Approval, approved: true });
	expect(args.submitRequested).not.toHaveBeenCalled();
	expect(approve).toBeChecked();
	expect(canvas.getByRole("button", { name: "Confirm approval" })).toBeEnabled();
} };

/** Company execution credentials remain distinct from the requester confirming the action. */
export const ApprovalCompanyConnection: Story = { args: { elicitation: _Request({ ..._APPROVAL_BODY, executionConnection: { ownerKind: ElicitationConnectionOwnerKinds.CompanyAssistant, ownerLabel: "Finance assistant", credentialRequirement: McpCredentialRequirement.PrincipalCredential } }), draft: { kind: ElicitationBodyKinds.Approval, approved: true }, draftSelected: fn(), submitRequested: fn() }, render: _RenderApprovalWithOutputSpies, play: async function _CompanyConfirmation({ canvasElement, args })
{
	const canvas = within(canvasElement);
	expect(await canvas.findByText("Company assistant: Finance assistant")).toBeVisible();
	expect(canvas.getByText("Credential bound to this connection owner.")).toBeVisible();
	expect(canvas.getByRole("radio", { name: /Approve/u })).toBeEnabled();
	expect(args.submitRequested).not.toHaveBeenCalled();
	await userEvent.click(canvas.getByRole("button", { name: "Confirm approval" }));
	expect(args.submitRequested).toHaveBeenCalledOnce();
} };

/** Credentialless execution must not imply that a person's or assistant's secret is used. */
export const ApprovalCredentialless: Story = { args: { elicitation: _Request({ ..._APPROVAL_BODY, executionConnection: { ownerKind: ElicitationConnectionOwnerKinds.CompanyAssistant, ownerLabel: "Operations assistant", credentialRequirement: McpCredentialRequirement.Credentialless } }), draft: { kind: ElicitationBodyKinds.Approval, approved: false } }, play: async function _Credentialless({ canvasElement })
{
	const canvas = within(canvasElement);
	expect(await canvas.findByText("No credentials required.")).toBeVisible();
	expect(canvas.getByRole("button", { name: "Confirm denial" })).toBeEnabled();
} };

/** Shared-credential disclosure names the policy without naming an external user account. */
export const ApprovalSharedCredential: Story = { args: { elicitation: _Request({ ..._APPROVAL_BODY, executionConnection: { ownerKind: ElicitationConnectionOwnerKinds.Personal, ownerLabel: "Amina", credentialRequirement: McpCredentialRequirement.SharedCredential } }), draft: { kind: ElicitationBodyKinds.Approval, approved: true } }, play: async function _SharedCredential({ canvasElement })
{
	const canvas = within(canvasElement);
	expect(await canvas.findByText("Organisation-shared credential.")).toBeVisible();
	expect(canvas.getByRole("button", { name: "Confirm approval" })).toBeEnabled();
} };

/** Long international owner names remain readable in the 390-pixel visual fixture. */
export const ApprovalLongConnectionNarrow: Story = { tags: ["visual-test-narrow"], parameters: { viewport: { defaultViewport: "mobile1" } }, args: { elicitation: _Request({ ..._APPROVAL_BODY, executionConnection: { ownerKind: ElicitationConnectionOwnerKinds.CompanyAssistant, ownerLabel: "Équipe financière — Nairobi / 你好 — " + "warehouse-operations-".repeat(7), credentialRequirement: McpCredentialRequirement.SharedCredential } }), draft: { kind: ElicitationBodyKinds.Approval, approved: true } }, play: async function _LongConnection({ canvasElement })
{
	const canvas = within(canvasElement);
	expect(await canvas.findByText(/Company assistant: Équipe financière/u)).toBeVisible();
	expect(canvas.getByRole("button", { name: "Confirm approval" })).toBeEnabled();
} };

/** Pending requests without connection evidence retain denial and refuse affirmative drafts. */
export const ApprovalConnectionMissing: Story = { args: { elicitation: { ..._Request(_APPROVAL_BODY), body: { ..._APPROVAL_BODY, executionConnection: undefined } }, draft: { kind: ElicitationBodyKinds.Approval, approved: true } }, play: async function _MissingConnection({ canvasElement })
{
	const canvas = within(canvasElement);
	expect(await canvas.findByRole("radio", { name: /Approve/u })).toBeDisabled();
	expect(canvas.getByRole("radio", { name: /Deny/u })).toBeEnabled();
	expect(canvas.getByRole("button", { name: "Confirm approval" })).toBeDisabled();
} };

/** An in-flight response retains the disclosure while disabling both decisions. */
export const ApprovalBusy: Story = { args: { elicitation: _Request(_APPROVAL_BODY), draft: { kind: ElicitationBodyKinds.Approval, approved: true }, busy: true }, play: async function _BusyApproval({ canvasElement })
{
	const canvas = within(canvasElement);
	expect(await canvas.findByText("Personal connection: Amina")).toBeVisible();
	expect(canvas.getByRole("radio", { name: /Approve/u })).toBeDisabled();
	expect(canvas.getByRole("radio", { name: /Deny/u })).toBeDisabled();
	expect(canvas.getByRole("button", { name: "Confirm approval" })).toBeDisabled();
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
