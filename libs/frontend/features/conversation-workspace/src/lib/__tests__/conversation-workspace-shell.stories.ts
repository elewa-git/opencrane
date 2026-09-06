import { Router } from "@angular/router";
import { type Decorator, type Meta, moduleMetadata, type StoryObj } from "@storybook/angular";

import type { MessageEntry } from "@opencrane/contracts";
import { ConversationModes, ConversationLifecycles } from "@opencrane/models/conversations";
import { PLATFORM_BRIDGE } from "@opencrane/platform";
import { CONVERSATION_ASSETS_GATEWAY } from "@opencrane/state/conversation/assets";
import { __CreateConversationHistoryProjection, ConversationEventStreamStatuses, type ConversationEventStream, type ConversationHistoryProjection, type StreamConversationEventsCommand } from "@opencrane/state/conversation/stream";
import { CONVERSATION_COMPUTER_REVIEW_GATEWAY, CONVERSATION_WORKSPACE_EVENT_STREAM, CONVERSATION_WORKSPACE_GATEWAY, ConversationOnboardingHistoryStatuses, ConversationPersonalAgentStatuses, type ConversationCreationDirectory, type ConversationWorkspaceDetail, type ConversationWorkspaceGateway } from "@opencrane/state/conversation/workspace";

import { ConversationWorkspaceRouteComponent } from "../conversation-workspace-route/conversation-workspace-route.component";

/** Privacy-safe directory used by the routed workspace contracts. */
const _DIRECTORY: ConversationCreationDirectory = { participants: [{ participantRef: "self", isSelf: true, label: "You" }], personalAgentStatus: ConversationPersonalAgentStatuses.Ready, personalAgent: { personalAgentRef: "agent-1", displayName: "The Commander" } };

/** Product-realistic text that must overflow only the transcript region. */
const _LONG_CONTENT = `# Project review\n\n${"The proposal keeps the agreed constraints and records the next decision clearly. ".repeat(32)}`;

/** Extra-long copy used by the structural scroll-owner assertion at both desktop widths. */
const _OVERFLOW_CONTENT = `${_LONG_CONTENT}\n\n${"The transcript owns overflow while the routed shell stays fixed to the viewport. ".repeat(32)}`;

/** Authorized conversation selected by the routed shell story. */
const _DETAIL: ConversationWorkspaceDetail = { id: "conversation-1", mode: ConversationModes.AgentSession, lifecycle: ConversationLifecycles.Open, agentServiceId: "agent-1", participantRefs: ["self"], archivedAt: null, readThroughPosition: "0", updatedAt: "2026-09-05T19:30:00.000Z", visibleFromPosition: "0", accessEndedPosition: null };

/** Immutable assistant entry whose private payload supplies the long transcript. */
const _ENTRY: MessageEntry = { schemaVersion: 1, id: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292", conversationId: _DETAIL.id, position: "1", author: { kind: "agent", agentIdentityId: "agent-identity-1", agentServiceId: "agent-1", name: "The Commander", avatarArtifactRevisionId: null }, provenance: "agent-authored", visibility: { audience: "conversation" }, runId: "run-1", causationId: "run-1", correlationId: "conversation-1", idempotencyKey: "57de859d-1fb6-4782-aa0b-2b3d4dfd2292", occurredAt: "2026-09-05T19:30:00.000Z", attestation: null, kind: "message", state: "completed", blocks: [{ id: "block-1", kind: "text", payloadRef: "payload-1", ciphertextDigest: "sha256:story" }], replyToEntryId: null, addressedAgentIdentityId: null, activation: "none" };

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

/** Supplies explicit test-only ports around the real routed workspace shell. */
function _Providers(history: ConversationHistoryProjection): Decorator
{
	return moduleMetadata({ providers: [{ provide: CONVERSATION_WORKSPACE_GATEWAY, useValue: _WORKSPACE_GATEWAY }, { provide: CONVERSATION_WORKSPACE_EVENT_STREAM, useValue: _Stream(history) }, { provide: CONVERSATION_ASSETS_GATEWAY, useValue: _ASSETS }, { provide: CONVERSATION_COMPUTER_REVIEW_GATEWAY, useValue: _REVIEW }, { provide: Router, useValue: _ROUTER }, { provide: PLATFORM_BRIDGE, useValue: _PLATFORM }] });
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
