import { Router } from "@angular/router";
import { type Decorator, type Meta, moduleMetadata, type StoryObj } from "@storybook/angular";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { CONVERSATION_ELICITATION_VERSION, ConversationEntryKinds, ElicitationBodyKinds, ElicitationPurposes, ElicitationRequestStates, type ApprovalLogEntry, type ConversationElicitation, type MessageEntry } from "@opencrane/contracts";
import { ConversationModes, ConversationLifecycles } from "@opencrane/models/conversations";
import { PLATFORM_BRIDGE } from "@opencrane/platform";
import { CONVERSATION_ASSETS_GATEWAY } from "@opencrane/state/conversation/assets";
import { ELICITATION_GATEWAY, type ConversationElicitationGateway } from "@opencrane/state/conversation/elicitation";
import { __CreateConversationHistoryProjection, ConversationEventStreamStatuses, type ConversationEventStream, type ConversationHistoryProjection, type StreamConversationEventsCommand } from "@opencrane/state/conversation/stream";
import { CONVERSATION_CURRENT_SUBJECT, CONVERSATION_PERSONAL_RUNS_GATEWAY, CONVERSATION_GROUP_CHILD_GATEWAY, CONVERSATION_COMPUTER_REVIEW_GATEWAY, CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY, ConversationOnboardingHistoryStatuses, ConversationPersonalAgentStatuses, ConversationWorkspaceGatewayError, ConversationWorkspaceGatewayErrorKinds, type ConversationCreationDirectory, type ConversationWorkspaceDetail, type ConversationWorkspaceGateway } from "@opencrane/state/conversation/workspace";

import { ConversationWorkspaceRouteComponent } from "../conversation-workspace-route/conversation-workspace-route.component";

/** Privacy-safe directory used by the routed workspace contracts. */
const _DIRECTORY: ConversationCreationDirectory = { companyAssistants: [], participants: [{ participantRef: "self", isSelf: true, label: "You" }], personalAgentStatus: ConversationPersonalAgentStatuses.Ready, personalAgent: { personalAgentRef: "agent-1", displayName: "The Commander" } };

/** Product-realistic text that must overflow only the transcript region. */
const _LONG_CONTENT = `# Project review\n\n${"The proposal keeps the agreed constraints and records the next decision clearly. ".repeat(32)}`;

/** Extra-long copy used by the structural scroll-owner assertion at both desktop widths. */
const _OVERFLOW_CONTENT = `${_LONG_CONTENT}\n\n${"The conversation body owns overflow while the routed shell stays fixed to the viewport. ".repeat(32)}`;

/** Authorized conversation selected by the routed shell story. */
const _DETAIL: ConversationWorkspaceDetail = { id: "conversation-1", mode: ConversationModes.AgentSession, lifecycle: ConversationLifecycles.Open, agentServiceId: "agent-1", participantRefs: ["self"], archivedAt: null, readThroughPosition: "0", updatedAt: "2026-09-05T19:30:00.000Z", visibleFromPosition: "0", parent: null, accessEndedPosition: null };

/** Immutable assistant entry whose private payload supplies the long transcript. */
const _ENTRY: MessageEntry = { schemaVersion: 1, id: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292", conversationId: _DETAIL.id, position: "1", author: { kind: "agent", agentIdentityId: "agent-identity-1", agentServiceId: "agent-1", name: "The Commander", avatarArtifactRevisionId: null }, provenance: "agent-authored", visibility: { audience: "conversation" }, runId: "run-1", causationId: "run-1", correlationId: "conversation-1", idempotencyKey: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292", occurredAt: "2026-09-05T19:30:00.000Z", attestation: null, kind: "message", state: "completed", blocks: [{ id: "block-1", kind: "text", payloadRef: "payload-1", ciphertextDigest: "sha256:story" }], replyToEntryId: null, addressedAgentIdentityId: null, activation: "none" };

/** Approval history changes only invalidate the current authority read. */
const _APPROVAL_LOG: ApprovalLogEntry = { schemaVersion: 1, id: "approval-log-1", conversationId: _DETAIL.id, position: "2", author: { kind: "service", serviceId: "approval-authority", name: "Approval authority" }, provenance: "service-attested", visibility: { audience: "conversation" }, runId: "run-1", causationId: "tool-call-1", correlationId: "conversation-1", idempotencyKey: "approval-log-1", occurredAt: "2026-09-05T19:30:02.000Z", attestation: null, kind: ConversationEntryKinds.Log, summary: "Approval requested", detailsRef: null, logKind: "approval", approvalId: "approval-history-1", action: "Create calendar event", phase: "requested" };

/** Current authority-owned tool approval returned independently from approval history. */
const _ELICITATION: ConversationElicitation = { version: CONVERSATION_ELICITATION_VERSION, requestId: "elicitation-request-1", conversationId: _DETAIL.id, runId: "run-1", attempt: 1, assignedParticipantId: "self", purpose: ElicitationPurposes.ToolApproval, state: ElicitationRequestStates.Requested, body: { kind: ElicitationBodyKinds.Approval, prompt: "Create this calendar event?", action: "Create calendar event", target: "Team planning calendar", dataUse: "The meeting title, time, and invited colleagues", proposedArguments: { title: "Quarterly planning", startsAt: "2026-09-15T09:00:00+03:00", invitees: ["Amina", "Kamau"] }, externalSystem: "Company calendar", consequence: "The invited colleagues will receive a calendar invitation." }, requiresStepUp: true, requestedAt: "2026-09-05T19:30:02.000Z", expiresAt: "2099-09-05T20:00:00.000Z" };

/** Current immutable-history projection rendered by every responsive shell contract. */
const _HISTORY: ConversationHistoryProjection = { ...__CreateConversationHistoryProjection(), entries: [_ENTRY], payloads: { "payload-1": _LONG_CONTENT }, nextPosition: "2" };

/** Projection long enough to require transcript scrolling at every asserted desktop width. */
const _OVERFLOW_HISTORY: ConversationHistoryProjection = { ..._HISTORY, payloads: { "payload-1": _OVERFLOW_CONTENT } };

/** Test-only participant API that keeps the story on one authorized conversation. */
const _WORKSPACE_GATEWAY: ConversationWorkspaceGateway =
{
	directory: async function _Directory() { return _DIRECTORY; },
	list: async function _List() { return [_DETAIL]; },
	onboardingHistory: async function _OnboardingHistory() { return { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null }; },
	open: async function _Open() { return _DETAIL; },
	create: async function _Create() { return _DETAIL; },
	send: async function _Send() { return; },
	archive: async function _Archive() { return _DETAIL; },
	close: async function _Close() { return { ..._DETAIL, lifecycle: ConversationLifecycles.Closed }; }
};

/** Test-only history stream that stays live until the routed component is destroyed. */
function _Stream(history: ConversationHistoryProjection): ConversationEventStream
{
	return { stream: async function _StreamHistory(command: StreamConversationEventsCommand): Promise<ConversationHistoryProjection>
	{
		command.onUpdate?.({ status: ConversationEventStreamStatuses.Live, state: history, reconnectAttempt: 0, lastHeartbeatAt: Date.now() });
		await new Promise<void>(function _WaitForAbort(resolve)
		{
			if (command.signal.aborted)
				resolve();
			else
				command.signal.addEventListener("abort", function _Resolve() { resolve(); }, { once: true });
		});
		return history;
	} };
}

/** Test-only ports that keep unrelated file and computer controls inert. */
const _ASSETS = { list: async function _List() { return []; }, read: async function _Read() { throw new Error("No asset selected."); }, reserve: async function _Reserve() { throw new Error("Story command unavailable."); }, upload: async function _Upload() { throw new Error("Story command unavailable."); }, remove: async function _Remove() { throw new Error("Story command unavailable."); } };
/** Rejects computer review because the visual contract has no active computer. */
const _REVIEW = { readComputerFile: async function _ReadFile() { throw new Error("Story command unavailable."); }, readComputerDiff: async function _ReadDiff() { throw new Error("Story command unavailable."); }, runComputerCommand: async function _Run() { throw new Error("Story command unavailable."); }, listComputerBrowserTargets: async function _Targets() { return []; }, openComputerBrowserPage: async function _OpenPage() { return; }, captureComputerScreenshot: async function _Screenshot() { throw new Error("Story command unavailable."); }, readComputerPreview: async function _Preview() { throw new Error("Story command unavailable."); } };
/** Accepts route changes without giving the isolated story a browser URL. */
const _ROUTER = { navigate: async function _Navigate() { return true; } };
/** Keeps desktop and sign-in capabilities unavailable in the browser story. */
const _PLATFORM = { isDesktop: false, bindFolder: async function _BindFolder() { throw new Error("Story command unavailable."); }, openAuthenticationWindow: function _OpenAuthenticationWindow() { return null; } };
/** Supplies a completed personal status that links to the rendered history fixture. */
const _PERSONAL_RUNS = { listPersonalRuns: async function _List() { return [{ runId: "run-1", conversationId: _DETAIL.id, state: "completed", attempt: 1, agentRevisionId: "revision-1", acceptedAt: "2026-09-05T19:29:50.000Z", latestTool: null, finishedAt: _ENTRY.occurredAt }]; } };
/** Supplies the current request independently from the log's unrelated approval identifier. */
const _ELICITATIONS = { listOpen: async function _List() { return [_ELICITATION]; }, read: async function _Read() { return _ELICITATION; }, respond: async function _Respond() { throw new Error("Story command unavailable."); }, listActivity: async function _Activity() { return []; } };
/** Leaves ordinary workspace stories without a participant request. */
const _NO_ELICITATIONS = { listOpen: async function _List() { return []; }, read: async function _Read() { throw new Error("No elicitation selected."); }, respond: async function _Respond() { throw new Error("Story command unavailable."); }, listActivity: async function _Activity() { return []; } };

/** Supplies explicit test-only ports around the real routed workspace shell. */
function _Providers(history: ConversationHistoryProjection, workspace: ConversationWorkspaceGateway = _WORKSPACE_GATEWAY, elicitations: ConversationElicitationGateway = _NO_ELICITATIONS): Decorator
{
	return moduleMetadata({ providers: [{ provide: CONVERSATION_CURRENT_SUBJECT, useValue: function _Subject() { return "self"; } }, { provide: CONVERSATION_PERSONAL_RUNS_GATEWAY, useValue: _PERSONAL_RUNS }, { provide: CONVERSATION_GROUP_CHILD_GATEWAY, useValue: {} }, { provide: CONVERSATION_WORKSPACE_GATEWAY, useValue: workspace }, { provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useValue: _Stream(history) }, { provide: CONVERSATION_ASSETS_GATEWAY, useValue: _ASSETS }, { provide: ELICITATION_GATEWAY, useValue: elicitations }, { provide: CONVERSATION_COMPUTER_REVIEW_GATEWAY, useValue: _REVIEW }, { provide: Router, useValue: _ROUTER }, { provide: PLATFORM_BRIDGE, useValue: _PLATFORM }] });
}

/** Defines the routed workspace viewport contracts without replacing its production stores. */
const meta: Meta<ConversationWorkspaceRouteComponent> = { title: "Conversations/Workspace shell", component: ConversationWorkspaceRouteComponent, tags: ["autodocs", "visual-test-full-viewport"], parameters: { layout: "fullscreen", docs: { description: { component: "The real routed workspace shell with deterministic participant-scoped gateway fixtures; stories verify composition and viewport ownership, not network or persistence authority." } } } };

export default meta;
type Story = StoryObj<ConversationWorkspaceRouteComponent>;

/** Default desktop long-content shell used by the structural viewport assertion. */
export const LongContent: Story = { decorators: [_Providers(_OVERFLOW_HISTORY)] };

/** Intermediate desktop width keeps the context panel overlay inside the routed viewport. */
export const IntermediateLongContent: Story = { tags: ["visual-test"], decorators: [_Providers(_HISTORY)] };

/** Wide desktop width keeps rail, transcript, composer, and context panel in one viewport. */
export const WideLongContent: Story = { tags: ["visual-test"], decorators: [_Providers(_HISTORY)] };

/** Shows the complete informed approval inside the selected conversation without exposing coordinates. */
export const PersonalToolApproval: Story = { tags: ["visual-test"], decorators: [_Providers({ ..._HISTORY, entries: [_ENTRY, _APPROVAL_LOG], nextPosition: "3" }, _WORKSPACE_GATEWAY, _ELICITATIONS)], play: async function _ApprovalVisible({ canvasElement })
{
	const canvas = within(canvasElement);
	const heading = await canvas.findByRole("heading", { name: "Create this calendar event?" });
	await canvasElement.ownerDocument.fonts.ready;
	const scrollOwner = canvasElement.querySelector<HTMLElement>(".conversation-workspace__body");
	const transcript = canvasElement.querySelector<HTMLElement>("wo-conversation-workspace-transcript");
	const approval = canvasElement.querySelector<HTMLElement>("wo-conversation-elicitation-card");
	if (scrollOwner === null || transcript === null || approval === null)
		throw new Error("The conversation body content is unavailable.");
	const transcriptBounds = transcript.getBoundingClientRect();
	const approvalBounds = approval.getBoundingClientRect();
	expect(transcriptBounds.height).toBeGreaterThan(0);
	expect(approvalBounds.top).toBeGreaterThanOrEqual(transcriptBounds.bottom);
	expect(globalThis.getComputedStyle(scrollOwner).overflowY).toBe("auto");
	expect(scrollOwner.clientHeight).toBeGreaterThan(0);
	expect(scrollOwner.scrollHeight).toBeGreaterThan(scrollOwner.clientHeight);
	if (globalThis.matchMedia("(max-width: 70rem)").matches)
	{
		await userEvent.click(await canvas.findByRole("button", { name: "Close activity pane" }));
		await waitFor(function _ContextClosed() { expect(canvas.queryByRole("button", { name: "Close activity pane" })).not.toBeInTheDocument(); });
		expect(canvas.getByRole("button", { name: "Activity and files" })).toHaveAttribute("aria-expanded", "false");
		await userEvent.click(canvas.getByRole("radio", { name: /Approve/u }));
		const confirmation = canvas.getByRole("button", { name: "Confirm approval" });
		scrollOwner.scrollTo({ top: scrollOwner.scrollHeight });
		await waitFor(function _ConfirmationInViewport()
		{
			const bounds = confirmation.getBoundingClientRect();
			const composer = canvasElement.querySelector<HTMLElement>(".conversation-workspace__composer");
			if (composer === null)
				throw new Error("The conversation composer is unavailable.");
			const composerBounds = composer.getBoundingClientRect();
			expect(bounds.top).toBeGreaterThanOrEqual(0);
			expect(bounds.bottom).toBeLessThanOrEqual(globalThis.innerHeight);
			expect(composerBounds.bottom).toBeLessThanOrEqual(globalThis.innerHeight);
		});
	}
	else
	{
		approval.scrollIntoView({ block: "start" });
		await waitFor(function _ApprovalInViewport()
		{
			const bodyBounds = scrollOwner.getBoundingClientRect();
			const bounds = approval.getBoundingClientRect();
			expect(bounds.top).toBeGreaterThanOrEqual(bodyBounds.top);
			expect(bounds.top).toBeLessThan(bodyBounds.bottom);
		});
	}
	expect(heading).toBeVisible();
	expect(canvas.getByText(/Quarterly planning/u)).toBeVisible();
	expect(canvas.queryByText(_ELICITATION.requestId)).not.toBeInTheDocument();
	expect(canvas.queryByText(_APPROVAL_LOG.approvalId)).not.toBeInTheDocument();
} };

/** Keeps the informed approval reachable after the compact context overlay closes. */
export const PersonalToolApprovalNarrow: Story = { ...PersonalToolApproval, tags: ["visual-test", "visual-test-narrow"] };

/** Verifies that recent activity opens the answer already rendered by the real workspace page. */
export const PersonalActivityAnswer: Story = { decorators: [_Providers(_HISTORY)], play: async function _OpenAnswer({ canvasElement })
{
	const canvas = within(canvasElement);
	(await canvas.findByRole("button", { name: "Open answer" })).focus();
	await userEvent.keyboard("{Enter}");
	await expect(canvasElement.querySelector(`[id="${_ENTRY.id}"]`)).toHaveFocus();
	expect(await canvas.findByText("Opened the selected activity in the conversation.")).toBeInTheDocument();
	if (globalThis.matchMedia("(max-width: 70rem)").matches)
		expect(canvas.queryByRole("button", { name: "Close activity pane" })).not.toBeInTheDocument();
} };

/** Covers keyboard answer navigation after the narrow workspace overlay closes. */
export const PersonalActivityAnswerNarrow: Story = { ...PersonalActivityAnswer, tags: ["visual-test", "visual-test-narrow"] };

/** Makes the already-shared child audience visible independently of the human's later result share. */
export const SharedCompanyChild: Story = { decorators: [_Providers({ ..._HISTORY, entries: [{ ..._ENTRY, author: { kind: "agent", agentIdentityId: "managed-company", agentServiceId: "company", name: "Company assistant", avatarArtifactRevisionId: null } }], payloads: { "payload-1": "Proposal A costs less. Proposal B gives us an earlier delivery date. Confirm both dates before choosing." } }, {
	..._WORKSPACE_GATEWAY,
	directory: async function _Directory() { return { ..._DIRECTORY, companyAssistants: [{ agentServiceId: "company", displayName: "Company assistant" }], participants: [..._DIRECTORY.participants, { participantRef: "peer-1", isSelf: false, label: "Amina" }, { participantRef: "peer-2", isSelf: false, label: "Kamau" }] }; },
	list: async function _List() { return [{ ..._DETAIL, agentServiceId: "company", participantRefs: ["self", "peer-1", "peer-2"] }]; },
	open: async function _Open() { return { ..._DETAIL, agentServiceId: "company", participantRefs: ["self", "peer-1", "peer-2"], parent: { requestId: "31c1f1dc-0010-4f13-9c2f-d3841ffd6651", parentConversationId: "group-1", parentMessageId: "41c1f1dc-0010-4f13-9c2f-d3841ffd6651", parentMessagePosition: "2" } }; }
})], parameters: { docs: { description: { story: "The child header states that three people share this assistant chat. Back to group is navigation; result sharing later posts selected text. The fixture owns no membership or history authority." } } }, play: async function _SharedAudience({ canvasElement })
{
	const canvas = within(canvasElement);
	expect(await canvas.findByText("Shared assistant chat · 3 participants")).toBeVisible();
	expect(canvas.getByRole("button", { name: "Back to group" })).toBeVisible();
} };

/** Proves that access loss closes creation and releases focus to the real workspace explanation. */
export const AccessLostDuringCreation: Story = { decorators: [_Providers(_HISTORY, {
	..._WORKSPACE_GATEWAY,
	create: async function _Denied() { throw new ConversationWorkspaceGatewayError(ConversationWorkspaceGatewayErrorKinds.AccessChanged, "This conversation is no longer available."); }
})], play: async function _CreationAccessLoss({ canvasElement })
{
	const canvas = within(canvasElement);
	const body = within(canvasElement.ownerDocument.body);
	await userEvent.click(await canvas.findByRole("button", { name: "New session" }));
	const dialog = await body.findByRole("dialog", { name: "New conversation" });
	await userEvent.click(within(dialog).getByRole("button", { name: "Create conversation" }));
	const heading = await canvas.findByRole("heading", { name: "Access changed" });
	await waitFor(function _Closed()
	{
		expect(body.queryByRole("dialog", { name: "New conversation" })).not.toBeInTheDocument();
		expect(body.queryByText("No personal Agent is assigned. Ask an administrator to finish Agent setup before starting this mode.")).not.toBeInTheDocument();
		expect(heading).toHaveFocus();
	});
	await userEvent.click(canvas.getByRole("button", { name: "Back to chats" }));
	await canvas.findByRole("button", { name: "New session" });
	expect(body.queryByRole("dialog", { name: "New conversation" })).not.toBeInTheDocument();
} };
