import { type Meta, moduleMetadata, type StoryObj } from "@storybook/angular";
import { expect, waitFor, within } from "storybook/test";

import { ConversationLifecycles, ConversationModes, MessageRoles, MessageSources, MessageStates } from "@opencrane/models/conversations";
import { __CreateAgUiStreamState, type AgUiStreamState } from "@opencrane/state/conversation/ag-ui";
import { CONVERSATION_ASSETS_GATEWAY } from "@opencrane/state/conversation/assets";
import { ELICITATION_GATEWAY } from "@opencrane/state/conversation/elicitation";
import { ConversationEventStreamStatuses, type ConversationEventStream, type StreamConversationEventsCommand } from "@opencrane/state/conversation/stream";
import { CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY, ConversationOnboardingHistoryStatuses, ConversationPersonalAgentStatuses, ConversationRunStates, type ConversationCreationDirectory, type ConversationOnboardingHistoryProjection, type ConversationRun, type ConversationWorkspaceDetail, type ConversationWorkspaceGateway } from "@opencrane/state/conversation/workspace";

import { ConversationWorkspacePageComponent } from "../components/conversation-workspace-page/conversation-workspace-page.component";

/** Privacy-safe directory used by the full workspace stories. */
const _DIRECTORY: ConversationCreationDirectory = { participants: [{ participantRef: "self", isSelf: true, label: "You" }, { participantRef: "participant-1", isSelf: false, label: "Participant 1" }], personalAgentStatus: ConversationPersonalAgentStatuses.Ready, personalAgent: { personalAgentRef: "agent-1", displayName: "Nova" } };

/** Directory where direct and group chat remain available without a personal Agent. */
const _UNAVAILABLE_AGENT_DIRECTORY: ConversationCreationDirectory = { participants: _DIRECTORY.participants, personalAgentStatus: ConversationPersonalAgentStatuses.Unavailable, personalAgent: null };

/** Directory where the server refused to choose between multiple personal Agents. */
const _AMBIGUOUS_AGENT_DIRECTORY: ConversationCreationDirectory = { participants: _DIRECTORY.participants, personalAgentStatus: ConversationPersonalAgentStatuses.Ambiguous, personalAgent: null };

/** Directory projection that cannot admit a new chat because it has no self membership. */
const _NO_MEMBERSHIP_DIRECTORY: ConversationCreationDirectory = { participants: [], personalAgentStatus: ConversationPersonalAgentStatuses.Unavailable, personalAgent: null };

/** Build one authorized conversation with optional hostile source text. */
function _Detail(body = "I reviewed the proposal and kept the important constraints."): ConversationWorkspaceDetail
{
	return { id: "conversation-1", mode: ConversationModes.AgentSession, lifecycle: ConversationLifecycles.Open, agentServiceId: "agent-1", participantRefs: ["self"], archivedAt: null, updatedAt: "2026-08-12T19:30:00.000Z", visibleFromPosition: "1", accessEndedPosition: null, messages: [{ id: "message-1", position: "1", role: MessageRoles.Assistant, state: MessageStates.Completed, source: MessageSources.ModelOutput, blocks: [{ id: "block-1", kind: "text", value: body }], runId: "run-1", participantRef: null, createdAt: "2026-08-12T19:30:00.000Z", agentThread: null }] };
}

/** Build one completed onboarding projection with no conversation mode or run. */
function _OnboardingHistory(): ConversationOnboardingHistoryProjection
{
	return { status: ConversationOnboardingHistoryStatuses.Ready, history: { id: "onboarding-1", personaDisplayName: "Nova", startedAt: "2026-08-12T18:00:00.000Z", completedAt: "2026-08-12T18:05:00.000Z", transcript: [{ ordinal: 1, role: MessageRoles.Assistant, text: "Welcome. I would like to learn how we should work together." }, { ordinal: 2, role: MessageRoles.User, text: "Keep decisions clear and show me when something needs approval." }] } };
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
	public async list() { return [_Detail()]; }
	/** Return the configured separate onboarding history projection. */
	public async onboardingHistory() { return this._onboardingHistory; }
	/** Return or reject the configured authorized snapshot. */
	public async open(): Promise<ConversationWorkspaceDetail> { if (this._detail instanceof Error) throw this._detail; return this._detail; }
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

/** Test-only live stream that emits one exact browser phase and state. */
class _StoryStream implements ConversationEventStream
{
	/** Browser connection state displayed by this story. */
	private readonly _status: ConversationEventStreamStatuses;
	/** Display-safe folded projection used by this story. */
	private readonly _state: AgUiStreamState;

	/** Capture one deterministic connection state. */
	public constructor(status: ConversationEventStreamStatuses, state: AgUiStreamState)
	{
		this._status = status;
		this._state = state;
	}

	/** Emit one update and leave the real feature to render it. */
	public async stream(command: StreamConversationEventsCommand): Promise<AgUiStreamState>
	{
		command.onUpdate?.({ status: this._status, state: this._state, reconnectAttempt: this._status === ConversationEventStreamStatuses.Reconnecting ? 1 : 0, lastHeartbeatAt: Date.now() });
		return this._state;
	}
}

/** Test-only asset API that returns no files. */
const _ASSETS = { list: async function _List() { return []; }, read: async function _Read() { throw new Error("No asset selected."); }, reserve: async function _Reserve() { throw new Error("Story command unavailable."); }, upload: async function _Upload() { throw new Error("Story command unavailable."); }, remove: async function _Remove() { throw new Error("Story command unavailable."); } };
/** Test-only elicitation API; these shell states contain no open question. */
const _ELICITATION = { read: async function _Read() { throw new Error("No question selected."); }, respond: async function _Respond() { throw new Error("Story command unavailable."); }, listActivity: async function _List() { return []; } };

/** Supply explicit test-only ports around the real production shell. */
function _Providers(gateway: ConversationWorkspaceGateway, stream: ConversationEventStream)
{
	return moduleMetadata({ providers: [{ provide: CONVERSATION_WORKSPACE_GATEWAY, useValue: gateway }, { provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useValue: stream }, { provide: CONVERSATION_ASSETS_GATEWAY, useValue: _ASSETS }, { provide: ELICITATION_GATEWAY, useValue: _ELICITATION }] });
}

/** Shared full-shell catalogue metadata. */
const meta: Meta<ConversationWorkspacePageComponent> = { title: "Conversations/Workspace shell", component: ConversationWorkspacePageComponent, tags: ["autodocs"], parameters: { layout: "fullscreen" } };

export default meta;
type Story = StoryObj<ConversationWorkspacePageComponent>;

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

/** Compact shell retains transcript, Activity, and Files in document order. */
export const Compact: Story = { tags: ["visual-test", "visual-test-narrow"], decorators: [_Providers(new _StoryGateway(_Detail()), new _StoryStream(ConversationEventStreamStatuses.Live, __CreateAgUiStreamState()))], parameters: { viewport: { defaultViewport: "mobile1" } } };
/** Reconnect keeps the last snapshot while explaining that the draft remains local. */
export const Reconnecting: Story = { tags: ["visual-test"], decorators: [_Providers(new _StoryGateway(_Detail()), new _StoryStream(ConversationEventStreamStatuses.Reconnecting, __CreateAgUiStreamState()))] };
/** Access loss purges a previously visible conversation through its live projection. */
export const AccessChanged: Story = { tags: ["visual-test"], decorators: [_Providers(new _StoryGateway(_Detail()), new _StoryStream(ConversationEventStreamStatuses.Live, { ...__CreateAgUiStreamState(), accessRevoked: true }))] };
/** Failed run remains visible with an explicit retry affordance. */
export const FailedRun: Story = { tags: ["visual-test"], decorators: [_Providers(new _StoryGateway(_Detail(), ConversationRunStates.Failed), new _StoryStream(ConversationEventStreamStatuses.Live, { ...__CreateAgUiStreamState(), runId: "run-1" }))] };
/** Cancelled run is truthful and offers no unsafe retry. */
export const CancelledRun: Story = { tags: ["visual-test"], decorators: [_Providers(new _StoryGateway(_Detail(), ConversationRunStates.Cancelled), new _StoryStream(ConversationEventStreamStatuses.Live, { ...__CreateAgUiStreamState(), runId: "run-1" }))] };
/** Hostile and oversized-looking text passes through the real shared sanitizer and bounded shell. */
export const HostileLongContent: Story = { tags: ["visual-test"], decorators: [_Providers(new _StoryGateway(_Detail(`# Review\n\n<script>window.secret = true</script>\n\n${"A very long governed answer. ".repeat(80)}`)), new _StoryStream(ConversationEventStreamStatuses.Live, __CreateAgUiStreamState()))] };
/** Completed onboarding opens selected and read-only inside the normal workspace shell. */
export const OnboardingHistory: Story = {
	tags: ["visual-test"],
	decorators: [_Providers(new _StoryGateway(_Detail(), ConversationRunStates.Completed, _DIRECTORY, _OnboardingHistory()), new _StoryStream(ConversationEventStreamStatuses.Live, __CreateAgUiStreamState()))],
	play: async function play({ canvasElement })
	{
		const button = await within(canvasElement).findByRole("button", { name: "Start a new chat" });
		await expect(button).toBeEnabled();
	}
};
/** Completed history keeps direct and group continuation visible when no personal Agent is assigned. */
export const OnboardingHistoryWithoutAgent: Story = { tags: ["visual-test"], decorators: [_Providers(new _StoryGateway(_Detail(), ConversationRunStates.Completed, _UNAVAILABLE_AGENT_DIRECTORY, _OnboardingHistory()), new _StoryStream(ConversationEventStreamStatuses.Live, __CreateAgUiStreamState()))] };
/** Completed history explains an ambiguous assignment without inventing an Agent choice. */
export const OnboardingHistoryWithAmbiguousAgent: Story = { tags: ["visual-test"], decorators: [_Providers(new _StoryGateway(_Detail(), ConversationRunStates.Completed, _AMBIGUOUS_AGENT_DIRECTORY, _OnboardingHistory()), new _StoryStream(ConversationEventStreamStatuses.Live, __CreateAgUiStreamState()))] };
/** Completed history keeps its transcript readable when workspace membership blocks continuation. */
export const OnboardingHistoryWithoutMembership: Story = {
	decorators: [_Providers(new _StoryGateway(_Detail(), ConversationRunStates.Completed, _NO_MEMBERSHIP_DIRECTORY, _OnboardingHistory()), new _StoryStream(ConversationEventStreamStatuses.Live, __CreateAgUiStreamState()))],
	play: async function play({ canvasElement })
	{
		const button = await within(canvasElement).findByRole("button", { name: "Start a new chat" });
		await expect(button).toBeDisabled();
	}
};
/** Compact completed history retains one read-only tray and one continuation action. */
export const OnboardingHistoryCompact: Story = { tags: ["visual-test", "visual-test-narrow"], decorators: [_Providers(new _StoryGateway(_Detail(), ConversationRunStates.Completed, _UNAVAILABLE_AGENT_DIRECTORY, _OnboardingHistory()), new _StoryStream(ConversationEventStreamStatuses.Live, __CreateAgUiStreamState()))], parameters: { viewport: { defaultViewport: "mobile1" } } };
