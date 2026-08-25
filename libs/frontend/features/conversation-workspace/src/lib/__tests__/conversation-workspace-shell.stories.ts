import { type Meta, moduleMetadata, type StoryObj } from "@storybook/angular";
import { Router } from "@angular/router";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { ConversationLifecycles, ConversationModes, MessageRoles, MessageSources, MessageStates } from "@opencrane/models/conversations";
import { AgUiMessageStatuses, __CreateAgUiStreamState, type AgUiStreamState } from "@opencrane/state/conversation/ag-ui";
import { CONVERSATION_ASSETS_GATEWAY } from "@opencrane/state/conversation/assets";
import { ELICITATION_GATEWAY } from "@opencrane/state/conversation/elicitation";
import { ConversationEventStreamStatuses, type ConversationEventStream, type StreamConversationEventsCommand } from "@opencrane/state/conversation/stream";
import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY, ConversationOnboardingHistoryStatuses, ConversationPersonalAgentStatuses, ConversationRunStates, type ConversationCreationDirectory, type ConversationOnboardingHistoryProjection, type ConversationRun, type ConversationWorkspaceDetail, type ConversationWorkspaceGateway } from "@opencrane/state/conversation/workspace";
import { PLATFORM_BRIDGE } from "@opencrane/platform";

import { ConversationWorkspaceRouteComponent } from "../conversation-workspace-route/conversation-workspace-route.component";

/** Privacy-safe directory used by the full workspace stories. */
const _DIRECTORY: ConversationCreationDirectory = {
	participants: [
		{
			participantRef: "self",
			isSelf: true,
			label: "You"
		},
		{
			participantRef: "participant-1",
			isSelf: false,
			label: "Participant 1"
		}
	],
	personalAgentStatus: ConversationPersonalAgentStatuses.Ready,
	personalAgent: {
		personalAgentRef: "agent-1",
		displayName: "The Commander (Guardian)"
	}
};

/** Directory where direct and group chat remain available without a personal Agent. */
const _UNAVAILABLE_AGENT_DIRECTORY: ConversationCreationDirectory = { participants: _DIRECTORY.participants, personalAgentStatus: ConversationPersonalAgentStatuses.Unavailable, personalAgent: null };

/** Directory where the server refused to choose between multiple personal Agents. */
const _AMBIGUOUS_AGENT_DIRECTORY: ConversationCreationDirectory = { participants: _DIRECTORY.participants, personalAgentStatus: ConversationPersonalAgentStatuses.Ambiguous, personalAgent: null };

/** Directory projection that cannot admit a new chat because it has no self membership. */
const _NO_MEMBERSHIP_DIRECTORY: ConversationCreationDirectory = { participants: [], personalAgentStatus: ConversationPersonalAgentStatuses.Unavailable, personalAgent: null };

/** Exact reviewed Commander opening that precedes the first calibration question. */
const _COMMANDER_OPENING = `I'm your personal assistant. Based on your onboarding answers, I'm set up to be direct,
concise, and results-focused. I'll give you straight answers, challenge you when I see a better
path, and skip the filler.

Before we start working: three quick things I need from you to be effective.`;

/** Product-realistic text that must exercise transcript scrolling inside the viewport shell. */
const _LONG_CONTENT = `# Project review\n\n${"The proposal keeps the agreed constraints and records the next decision clearly. ".repeat(32)}`;

/** Build one authorized conversation with optional hostile source text. */
function _Detail(body = "I reviewed the proposal and kept the important constraints."): ConversationWorkspaceDetail
{
	return { id: "conversation-1", mode: ConversationModes.AgentSession, lifecycle: ConversationLifecycles.Open, agentServiceId: "agent-1", participantRefs: ["self"], archivedAt: null, readThroughPosition: "0", updatedAt: "2026-08-12T19:30:00.000Z", visibleFromPosition: "1", accessEndedPosition: null, messages: [{ id: "message-1", position: "1", role: MessageRoles.Assistant, state: MessageStates.Completed, source: MessageSources.ModelOutput, blocks: [{ id: "block-1", kind: "text", value: body }], runId: "run-1", participantRef: null, createdAt: "2026-08-12T19:30:00.000Z", completedAt: "2026-08-12T19:30:01.000Z", agentThread: null }] };
}

/** Build one direct conversation carrying a stale run coordinate only in the stream fixture. */
function _DirectDetail(): ConversationWorkspaceDetail
{
	const detail = _Detail("Can we review the handoff together?");
	return { ...detail, mode: ConversationModes.Direct, agentServiceId: null, participantRefs: ["self", "participant-1"], messages: [{ ...detail.messages[0]!, role: MessageRoles.User, source: MessageSources.UserInput, runId: null, participantRef: "participant-1" }] };
}

/** Supplies the long transcript through the live projection that the workspace renders after its snapshot. */
function _LongContentStream(): AgUiStreamState
{
	return { ...__CreateAgUiStreamState(), messages: { "message-1": { id: "message-1", role: MessageRoles.Assistant, text: _LONG_CONTENT, status: AgUiMessageStatuses.Completed } } };
}

/** Build one second direct conversation used to hold a stale route while the participant selects it. */
function _SecondDirectDetail(): ConversationWorkspaceDetail
{
	return { ..._DirectDetail(), id: "conversation-2", updatedAt: "2026-08-12T19:31:00.000Z" };
}

/** Build one completed onboarding projection with no conversation mode or run. */
function _OnboardingHistory(): ConversationOnboardingHistoryProjection
{
	return {
		status: ConversationOnboardingHistoryStatuses.Ready,
		history: {
			id: "onboarding-1",
			personaDisplayName: "The Commander (Guardian)",
			startedAt: "2026-08-12T18:00:00.000Z",
			completedAt: "2026-08-12T18:05:00.000Z",
			transcript: [
				{
					ordinal: 1,
					role: MessageRoles.Assistant,
					text: _COMMANDER_OPENING
				},
				{
					ordinal: 2,
					role: MessageRoles.Assistant,
					text: "What are you working on right now?"
				},
				{
					ordinal: 3,
					role: MessageRoles.User,
					text: "Preparing the Q3 launch plan for the customer portal."
				},
				{
					ordinal: 4,
					role: MessageRoles.Assistant,
					text: "What is the one thing that wastes your time most?"
				},
				{
					ordinal: 5,
					role: MessageRoles.User,
					text: "Reconciling project updates across too many separate tools."
				},
				{
					ordinal: 6,
					role: MessageRoles.Assistant,
					text: "When I push back on your ideas, how hard should I push?"
				},
				{
					ordinal: 7,
					role: MessageRoles.User,
					text: "Push back directly when you see a concrete risk, then show me the safer alternative."
				}
			]
		}
	};
}

/** Test-only participant API used by one deterministic shell story. */
class _StoryGateway implements ConversationWorkspaceGateway
{
	/** Privacy-safe directory returned to the create dialog. */
	private readonly _directory: ConversationCreationDirectory;
	/** Authorized detail, or the deliberate access failure for this story. */
	private readonly _detail: ConversationWorkspaceDetail | Error;
	/** Run lifecycle rendered by this story. */
	private readonly _run: ConversationRun;
	/** Separate onboarding-history result rendered by this story. */
	private readonly _onboardingHistory: ConversationOnboardingHistoryProjection;

	/** Capture one deterministic story scenario. */
	public constructor(detail: ConversationWorkspaceDetail | Error, runState: ConversationRunStates = ConversationRunStates.Completed, directory: ConversationCreationDirectory = _DIRECTORY, onboardingHistory: ConversationOnboardingHistoryProjection = { status: ConversationOnboardingHistoryStatuses.NotRecorded, history: null })
	{
		this._detail = detail;
		this._directory = directory;
		this._run = { runId: "run-1", attempt: 1, state: runState, conversationId: "conversation-1" };
		this._onboardingHistory = onboardingHistory;
	}

	/** Return the story directory. */
	public async directory() { return this._directory; }
	/** Return one row so the real page follows its snapshot-first flow. */
	public async list() { if (this._onboardingHistory.history !== null) return []; return this._detail instanceof Error ? [_Detail()] : [this._detail]; }
	/** Return the configured separate onboarding history projection. */
	public async onboardingHistory() { return this._onboardingHistory; }
	/** Return or reject the configured authorized snapshot. */
	public async open(_conversationId: string): Promise<ConversationWorkspaceDetail> { if (this._detail instanceof Error) throw this._detail; return this._detail; }
	/** Return the configured snapshot for unused create interactions. */
	public async create(): Promise<ConversationWorkspaceDetail> { return _Detail(); }
	/** Accept no story message command. */
	public async send(): Promise<void> { return; }
	/** Return the configured snapshot for unused archive interactions. */
	public async archive(): Promise<ConversationWorkspaceDetail> { return _Detail(); }
	/** Return a closed story snapshot. */
	public async close(): Promise<ConversationWorkspaceDetail> { return { ..._Detail(), lifecycle: ConversationLifecycles.Closed }; }
	/** Return the configured run lifecycle. */
	public async run(): Promise<ConversationRun> { return this._run; }
	/** Accept no story steering command. */
	public async steer(): Promise<void> { return; }
	/** Return a cancelled story run. */
	public async cancel(): Promise<ConversationRun> { return { ...this._run, state: ConversationRunStates.Cancelled }; }
	/** Return a fresh story retry. */
	public async retry(): Promise<ConversationRun> { return { ...this._run, attempt: this._run.attempt + 1, state: ConversationRunStates.Accepted }; }
}

/** Participant API that exposes two rows so the routed story can exercise selection handoff. */
class _StoryNavigationGateway extends _StoryGateway
{
	/** Stores two authorized snapshots selected by their canonical route coordinate. */
	private readonly _details = [_Detail(), _SecondDirectDetail()];

	/** Return both rows in stable order. */
	public override async list() { return this._details; }
	/** Return the snapshot named by the requested route coordinate. */
	public override async open(conversationId: string): Promise<ConversationWorkspaceDetail>
	{
		const detail = this._details.find(candidate => candidate.id === conversationId);
		if (detail === undefined) throw new Error("Conversation not found.");
		return detail;
	}
}

/** Test-only live stream that emits one exact browser phase and state. */
class _StoryStream implements ConversationEventStream
{
	/** Browser connection state displayed by this story. */
	private readonly _status: ConversationEventStreamStatuses;
	/** Display-safe folded projection used by this story. */
	private readonly _state: AgUiStreamState;
	/** Reconnect attempt displayed while this story shows a paused socket. */
	private readonly _reconnectAttempt: number;
	/** State emitted after a participant activates the reconnect button in an interaction story. */
	private readonly _replacementStatus: ConversationEventStreamStatuses;
	/** Number of stream commands opened by the story store. */
	private starts = 0;

	/** Capture one deterministic connection state. */
	public constructor(status: ConversationEventStreamStatuses, state: AgUiStreamState, reconnectAttempt = 0, replacementStatus = status)
	{
		this._status = status;
		this._state = state;
		this._reconnectAttempt = reconnectAttempt;
		this._replacementStatus = replacementStatus;
	}

	/** Emit one update and leave the real feature to render it. */
	public async stream(command: StreamConversationEventsCommand): Promise<AgUiStreamState>
	{
		const status = this.starts === 0 ? this._status : this._replacementStatus;
		this.starts += 1;
		command.onUpdate?.({ status, state: this._state, reconnectAttempt: status === ConversationEventStreamStatuses.Reconnecting ? this._reconnectAttempt : 0, lastHeartbeatAt: Date.now() });
		return this._state;
	}

	/** Reject participant commands because a visual story exposes no socket transport. */
	public async submit(): Promise<never> { throw new Error("Story stream does not submit messages."); }
}

/** Test-only asset API that returns no files. */
const _ASSETS = { list: async function _List() { return []; }, read: async function _Read() { throw new Error("No asset selected."); }, reserve: async function _Reserve() { throw new Error("Story command unavailable."); }, upload: async function _Upload() { throw new Error("Story command unavailable."); }, remove: async function _Remove() { throw new Error("Story command unavailable."); } };
/** Test-only elicitation API; these shell states contain no open question. */
const _ELICITATION = { read: async function _Read() { throw new Error("No question selected."); }, respond: async function _Respond() { throw new Error("Story command unavailable."); }, listActivity: async function _List() { return []; } };
/** Test-only router that keeps the old input in place while the page finishes a rail selection. */
const _ROUTER = { navigate: async function _Navigate() { return true; } };
/** Supplies the test runtime API; routed workspace stories never open native capabilities. */
const _PLATFORM = { isDesktop: false, bindFolder: async function _BindFolder() { throw new Error("Story command unavailable."); }, openAuthenticationWindow: function _OpenAuthenticationWindow() { return null; } };

/** Supply explicit test-only ports around the real production shell. */
function _Providers(gateway: ConversationWorkspaceGateway, stream: ConversationEventStream)
{
	return moduleMetadata({ providers: [{ provide: CONVERSATION_WORKSPACE_GATEWAY, useValue: gateway }, { provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useValue: stream }, { provide: CONVERSATION_ASSETS_GATEWAY, useValue: _ASSETS }, { provide: ELICITATION_GATEWAY, useValue: _ELICITATION }, { provide: Router, useValue: _ROUTER }, { provide: PLATFORM_BRIDGE, useValue: _PLATFORM }] });
}

/** Shared full-shell catalogue metadata. */
const meta: Meta<ConversationWorkspaceRouteComponent> = { title: "Conversations/Workspace shell", component: ConversationWorkspaceRouteComponent, tags: ["autodocs", "visual-test-full-viewport"], parameters: { layout: "fullscreen" } };

export default meta;
type Story = StoryObj<ConversationWorkspaceRouteComponent>;

/** Complete desktop shell using the real page and component-scoped stores. */
export const Desktop: Story =
{
	tags: ["visual-test"],
	decorators: [_Providers(new _StoryGateway(_Detail()), new _StoryStream(ConversationEventStreamStatuses.Live, __CreateAgUiStreamState()))],
	play: async function play({ canvasElement })
	{
		const attachInput = await waitFor(function _FindAttachInput()
		{
			const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
			expect(input).not.toBeNull();
			if (input === null) throw new Error("Attach input is not rendered yet.");
			return input;
		}, { timeout: 5000 });
		attachInput.focus();
		await expect(attachInput).toHaveFocus();
	}
};

/** A stale route coordinate cannot reopen the old row while a new rail selection completes. */
export const NavigationSelection: Story =
{
	args: { conversationId: "conversation-1" },
	decorators: [_Providers(new _StoryNavigationGateway(_Detail()), new _StoryStream(ConversationEventStreamStatuses.Live, __CreateAgUiStreamState()))],
	play: async function play({ canvasElement })
	{
		const rows = await waitFor(function _FindSessionRows()
		{
			const candidates = canvasElement.querySelectorAll<HTMLButtonElement>("wo-conversation-session-rail-row button");
			expect(candidates).toHaveLength(2);
			return candidates;
		});
		await userEvent.click(rows[1]!);
		await waitFor(function _WaitForSelection()
		{
			const selectedRows = canvasElement.querySelectorAll('[aria-current="page"]');
			expect(selectedRows).toHaveLength(1);
			expect(selectedRows[0]).toBe(rows[1]);
		});
	}
};

/** Compact shell retains transcript, Activity, and Files in document order. */
export const Compact: Story = { tags: ["visual-test", "visual-test-narrow"], decorators: [_Providers(new _StoryGateway(_Detail()), new _StoryStream(ConversationEventStreamStatuses.Live, __CreateAgUiStreamState()))], parameters: { viewport: { defaultViewport: "mobile1" } } };
/** Reconnect keeps the last snapshot, names its current attempt, and disables sending until it is live. */
export const Reconnecting: Story = {
	tags: ["visual-test"],
	decorators: [_Providers(new _StoryGateway(_Detail()), new _StoryStream(ConversationEventStreamStatuses.Reconnecting, __CreateAgUiStreamState(), 2))],
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Reconnecting — attempt 2")).toBeVisible();
		expect(canvas.getByRole("button", { name: "Reconnect now" })).toBeEnabled();
		expect(canvas.getByLabelText("Message conversation")).toBeDisabled();
	}
};
/** Failed recovery keeps the draft visible and offers the same in-chat reconnect action. */
export const ConnectionFailed: Story = { tags: ["visual-test"], decorators: [_Providers(new _StoryGateway(_Detail()), new _StoryStream(ConversationEventStreamStatuses.Failed, __CreateAgUiStreamState(), 4))] };
/** An explicit reconnect replaces the socket once and keeps its action visibly pending until it responds. */
export const ManualReconnectPending: Story = {
	tags: ["visual-test"],
	decorators: [_Providers(new _StoryGateway(_Detail()), new _StoryStream(ConversationEventStreamStatuses.Reconnecting, __CreateAgUiStreamState(), 1, ConversationEventStreamStatuses.Connecting))],
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByRole("button", { name: "Reconnect now" }));
		const reconnect = await canvas.findByRole("button", { name: "Reconnecting…" });
		expect(reconnect).toBeDisabled();
		expect(canvas.getByLabelText("Message conversation")).toBeDisabled();
	}
};
/** Access loss purges a previously visible conversation through its live projection. */
export const AccessChanged: Story = { tags: ["visual-test"], decorators: [_Providers(new _StoryGateway(_Detail()), new _StoryStream(ConversationEventStreamStatuses.Live, { ...__CreateAgUiStreamState(), accessRevoked: true }))] };
/** Failed run remains visible with an explicit retry affordance. */
export const FailedRun: Story = { tags: ["visual-test"], decorators: [_Providers(new _StoryGateway(_Detail(), ConversationRunStates.Failed), new _StoryStream(ConversationEventStreamStatuses.Live, { ...__CreateAgUiStreamState(), runId: "run-1" }))] };
/** Cancelled run is truthful and offers no unsafe retry. */
export const CancelledRun: Story = { tags: ["visual-test"], decorators: [_Providers(new _StoryGateway(_Detail(), ConversationRunStates.Cancelled), new _StoryStream(ConversationEventStreamStatuses.Live, { ...__CreateAgUiStreamState(), runId: "run-1" }))] };
/**
 * Uses product-realistic long text to prove the transcript owns overflow while the workspace and rail stay at viewport height.
 * This keeps deliberately awkward test text out of design review.
 */
export const LongContent: Story = {
	tags: ["visual-test"],
	decorators: [_Providers(new _StoryGateway(_Detail(_LONG_CONTENT)), new _StoryStream(ConversationEventStreamStatuses.Live, _LongContentStream()))],
	play: async function play({ canvasElement })
	{
		await waitFor(function _AssertScrollOwnership()
		{
			// 1. Find the frame, rail, and transcript after the routed workspace finishes loading.
			const workspace = canvasElement.querySelector<HTMLElement>(".conversation-workspace");
			const rail = canvasElement.querySelector<HTMLElement>("wo-conversation-list");
			const transcript = canvasElement.querySelector<HTMLElement>(".conversation-workspace__transcript");
			expect(workspace).not.toBeNull();
			expect(rail).not.toBeNull();
			expect(transcript).not.toBeNull();
			if (workspace === null || rail === null || transcript === null) throw new Error("The workspace frame is not ready.");

			// 2. Verify that the frame and rail both retain the browser viewport's height.
			expect(Math.round(workspace.getBoundingClientRect().height)).toBe(window.innerHeight);
			expect(Math.round(rail.getBoundingClientRect().height)).toBe(window.innerHeight);

			// 3. Verify that the transcript owns long-content scrolling instead of the document.
			expect(transcript.scrollHeight).toBeGreaterThan(transcript.clientHeight);
			expect(canvasElement.ownerDocument.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight);
		});
	}
};
/** Long content at the observed intermediate width keeps the full shell inside the viewport. */
export const IntermediateLongContent: Story = { ...LongContent, tags: ["visual-test"] };
/** Long content at the observed wide width keeps the full shell inside the viewport. */
export const WideLongContent: Story = { ...LongContent, tags: ["visual-test"] };
/** Direct conversations display a participant's live message without adopting stale Agent-run state. */
export const DirectConversation: Story = {
	tags: ["visual-test"],
	decorators: [_Providers(new _StoryGateway(_DirectDetail(), ConversationRunStates.Failed), new _StoryStream(ConversationEventStreamStatuses.Live, { ...__CreateAgUiStreamState(), runId: "stale-run", messages: { "message-live": { id: "message-live", role: "user", text: "I can see this without reloading.", status: AgUiMessageStatuses.Completed } } }))],
	play: async function play({ canvasElement }) { await expect(await within(canvasElement).findByText("I can see this without reloading.")).toBeVisible(); }
};
/** Direct-session Files pane closes and restores focus without exposing Agent Activity. */
export const FilesClosed: Story = {
	tags: ["visual-test"],
	decorators: [_Providers(new _StoryGateway(_DirectDetail(), ConversationRunStates.Failed), new _StoryStream(ConversationEventStreamStatuses.Live, { ...__CreateAgUiStreamState(), runId: "stale-run" }))],
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByRole("button", { name: "Close files pane" }));
		await expect(canvas.queryByLabelText("Conversation context")).not.toBeInTheDocument();
		const trigger = canvas.getByRole("button", { name: "Files" });
		await expect(trigger).toHaveAttribute("aria-expanded", "false");
		await waitFor(async function _WaitForRestoredFocus() { await expect(trigger).toHaveFocus(); });
	}
};
/** The selected Agent session remains usable after the participant closes its Activity pane. */
export const ActivityClosed: Story = {
	tags: ["visual-test"],
	decorators: [_Providers(new _StoryGateway(_Detail()), new _StoryStream(ConversationEventStreamStatuses.Live, __CreateAgUiStreamState()))],
	play: async function play({ canvasElement })
	{
		const canvas = within(canvasElement);
		await userEvent.click(await canvas.findByRole("button", { name: "Close activity pane" }));
		await expect(canvas.queryByLabelText("Conversation context")).not.toBeInTheDocument();
		await expect(canvas.getByRole("button", { name: "Activity" })).toHaveAttribute("aria-expanded", "false");
	}
};
/** Completed onboarding opens selected and read-only inside the normal workspace shell. */
export const WelcomeSession: Story = {
	tags: ["visual-test"],
	decorators: [_Providers(new _StoryGateway(_Detail(), ConversationRunStates.Completed, _DIRECTORY, _OnboardingHistory()), new _StoryStream(ConversationEventStreamStatuses.Live, __CreateAgUiStreamState()))],
	play: async function play({ canvasElement })
	{
		const button = await within(canvasElement).findByRole("button", { name: "Start a new chat" });
		await expect(button).toBeEnabled();
	}
};
/** The Welcome session keeps direct and group continuation visible without a personal Agent. */
export const WelcomeSessionWithoutAgent: Story = { tags: ["visual-test"], decorators: [_Providers(new _StoryGateway(_Detail(), ConversationRunStates.Completed, _UNAVAILABLE_AGENT_DIRECTORY, _OnboardingHistory()), new _StoryStream(ConversationEventStreamStatuses.Live, __CreateAgUiStreamState()))] };
/** The Welcome session explains an ambiguous assignment without inventing an Agent choice. */
export const WelcomeSessionWithAmbiguousAgent: Story = { tags: ["visual-test"], decorators: [_Providers(new _StoryGateway(_Detail(), ConversationRunStates.Completed, _AMBIGUOUS_AGENT_DIRECTORY, _OnboardingHistory()), new _StoryStream(ConversationEventStreamStatuses.Live, __CreateAgUiStreamState()))] };
/** The Welcome session keeps its transcript readable when workspace membership blocks continuation. */
export const WelcomeSessionWithoutMembership: Story = {
	decorators: [_Providers(new _StoryGateway(_Detail(), ConversationRunStates.Completed, _NO_MEMBERSHIP_DIRECTORY, _OnboardingHistory()), new _StoryStream(ConversationEventStreamStatuses.Live, __CreateAgUiStreamState()))],
	play: async function play({ canvasElement })
	{
		const button = await within(canvasElement).findByRole("button", { name: "Start a new chat" });
		await expect(button).toBeDisabled();
	}
};
/** Compact completed history retains one read-only tray and one continuation action. */
export const WelcomeSessionCompact: Story = { tags: ["visual-test", "visual-test-narrow"], decorators: [_Providers(new _StoryGateway(_Detail(), ConversationRunStates.Completed, _UNAVAILABLE_AGENT_DIRECTORY, _OnboardingHistory()), new _StoryStream(ConversationEventStreamStatuses.Live, __CreateAgUiStreamState()))], parameters: { viewport: { defaultViewport: "mobile1" } } };
