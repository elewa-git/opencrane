import { ConversationLifecycles, ConversationModes, MessageRoles } from "@opencrane/models/conversations";
import { PersonaFirstChatTranscriptRoles, type PersonaFirstChatSnapshot } from "@opencrane/models/user-onboarding";
import { ConversationOnboardingHistoryStatuses, ConversationPersonalAgentStatuses, type ConversationWorkspaceDetail, type CreateConversationCommand, type SubmitConversationMessageCommand } from "@opencrane/state/conversation/workspace";
import { PersonaOnboardingStates } from "@opencrane/state/onboarding";

import { _CreateLocalDevelopmentAssets } from "./local-development.assets";
import { _LocalDevelopmentAccessChanged, _LocalDevelopmentConflict } from "./local-development.failures";
import { __LOCAL_DEVELOPMENT_BOOTSTRAPS } from "./local-development.fixtures";
import { _AppendLocalDevelopmentParticipantMessage, _CreateLocalDevelopmentHistory } from "./local-development.history";
import type { _LocalDevelopmentState, _LocalDevelopmentWorkspacePorts } from "./local-development.owner.types";
import { _CreateLocalDevelopmentStream } from "./local-development.stream";
import { _CreateLocalDevelopmentComputerReview, _CreateLocalDevelopmentGroupChildren, _CreateLocalDevelopmentPersonalRuns } from "./local-development.workspace-support";

/** Stable browser subject used by each disposable workspace projection. */
export const _LOCAL_DEVELOPMENT_SUBJECT = "local-developer";

/** Stable personal-Agent conversation used by direct archetype commands. */
export const _LOCAL_DEVELOPMENT_AGENT_CONVERSATION_ID = "conversation-agent";

/** Stable timestamp that keeps local tests and screenshots deterministic. */
const _NOW = "2026-09-10T09:00:00.000Z";

/** Creates the stable personal-Agent metadata row. */
export function _CreateLocalDevelopmentAgentConversation(state: Pick<_LocalDevelopmentState, "archetype">): ConversationWorkspaceDetail
{
	return { id: _LOCAL_DEVELOPMENT_AGENT_CONVERSATION_ID, mode: ConversationModes.AgentSession, lifecycle: ConversationLifecycles.Open, agentServiceId: `local-agent-${state.archetype}`, participantRefs: [_LOCAL_DEVELOPMENT_SUBJECT], archivedAt: null, readThroughPosition: "0", updatedAt: _NOW, visibleFromPosition: "0", accessEndedPosition: null, parent: null };
}

/** Creates a direct or group metadata row beside the personal-Agent session. */
export function _CreateLocalDevelopmentOrdinaryConversation(id: string, mode: ConversationModes.Direct | ConversationModes.Group, participants: readonly string[]): ConversationWorkspaceDetail
{
	return { id, mode, lifecycle: ConversationLifecycles.Open, agentServiceId: null, participantRefs: participants, archivedAt: null, readThroughPosition: "0", updatedAt: _NOW, visibleFromPosition: "0", accessEndedPosition: null, parent: null };
}

/** Maps first-chat speakers into the read-only workspace transcript vocabulary. */
function _WorkspaceHistoryRole(role: PersonaFirstChatTranscriptRoles): MessageRoles.Assistant | MessageRoles.User
{
	if (role === PersonaFirstChatTranscriptRoles.Assistant)
	{
		return MessageRoles.Assistant;
	}

	return MessageRoles.User;
}

/** Reads one current metadata row or reports a fixed local error. */
function _OpenConversation(state: _LocalDevelopmentState, conversationId: string): ConversationWorkspaceDetail
{
	const found = state.conversations.find(item => item.id === conversationId);
	if (found === undefined)
	{
		return _LocalDevelopmentAccessChanged();
	}

	return found;
}

/** Compares the immutable creation intent while treating member order as non-semantic. */
function _SameCreation(left: CreateConversationCommand, right: CreateConversationCommand): boolean
{
	if (left.mode !== right.mode)
	{
		return false;
	}
	if (left.mode === ConversationModes.AgentSession && right.mode === ConversationModes.AgentSession)
	{
		return left.personalAgentRef === right.personalAgentRef;
	}
	if (left.mode === ConversationModes.AgentSession || right.mode === ConversationModes.AgentSession)
	{
		return false;
	}
	return [...left.participantRefs].sort().join("\u0000") === [...right.participantRefs].sort().join("\u0000");
}

/** Compares every immutable message coordinate and payload field. */
function _SameMessage(left: SubmitConversationMessageCommand, right: SubmitConversationMessageCommand): boolean
{
	return left.conversationId === right.conversationId && left.text === right.text && left.activation === right.activation;
}

/** Names the conversation-scoped retry slot used by participant messages. */
function _MessageReceiptKey(command: SubmitConversationMessageCommand): string
{
	return `${command.conversationId}\u0000${command.idempotencyKey}`;
}

/** Creates every workspace-owned port over the shared disposable state. */
export function _CreateLocalDevelopmentWorkspacePorts(state: _LocalDevelopmentState, firstChatSnapshot: () => PersonaFirstChatSnapshot): _LocalDevelopmentWorkspacePorts
{
	const workspace = {
		directory: async function _Directory()
		{
			const ready = state.persona.state === PersonaOnboardingStates.Ready;
			const directory = { companyAssistants: [{ agentServiceId: "local-company-agent", displayName: "Local company assistant" }], participants: [{ participantRef: _LOCAL_DEVELOPMENT_SUBJECT, isSelf: true, label: "You" }, { participantRef: "local-peer", isSelf: false, label: "Amina" }, { participantRef: "local-peer-two", isSelf: false, label: "Kamau" }] };
			if (!ready)
			{
				return { ...directory, personalAgentStatus: ConversationPersonalAgentStatuses.Unavailable, personalAgent: null };
			}
			return { ...directory, personalAgentStatus: ConversationPersonalAgentStatuses.Ready, personalAgent: { personalAgentRef: `local-agent-${state.archetype}`, displayName: __LOCAL_DEVELOPMENT_BOOTSTRAPS[state.archetype].displayName } };
		},
		list: async function _List() { return state.conversations; },
		onboardingHistory: async function _OnboardingHistory()
		{
			if (!state.firstChatCompleted)
			{
				return { status: ConversationOnboardingHistoryStatuses.NotCompleted, history: null };
			}

			const snapshot = firstChatSnapshot();
			return { status: ConversationOnboardingHistoryStatuses.Ready, history: { id: "local-onboarding-conversation", personaDisplayName: __LOCAL_DEVELOPMENT_BOOTSTRAPS[state.archetype].displayName, startedAt: _NOW, completedAt: _NOW, transcript: snapshot.transcript.map(item => ({ ordinal: item.ordinal, role: _WorkspaceHistoryRole(item.role), text: item.text })) } };
		},
		open: async function _Open(conversationId: string) { return _OpenConversation(state, conversationId); },
		create: async function _Create(command: CreateConversationCommand)
		{
			if (command.mode === ConversationModes.AgentSession && state.persona.state !== PersonaOnboardingStates.Ready)
			{
				return _LocalDevelopmentAccessChanged();
			}
			const id = `local-created-${command.idempotencyKey}`;
			const receipt = state.conversationReceipts.get(command.idempotencyKey);
			if (receipt !== undefined)
			{
				if (!_SameCreation(receipt.command, command))
				{
					return _LocalDevelopmentConflict();
				}
				return _OpenConversation(state, receipt.conversationId);
			}
			let detail: ConversationWorkspaceDetail;
			if (command.mode === ConversationModes.AgentSession)
			{
				detail = { ..._CreateLocalDevelopmentAgentConversation(state), id };
			}
			else
			{
				detail = _CreateLocalDevelopmentOrdinaryConversation(id, command.mode, [_LOCAL_DEVELOPMENT_SUBJECT, ...command.participantRefs]);
			}

			state.conversations = [detail, ...state.conversations];
			state.histories.set(id, _CreateLocalDevelopmentHistory(state, id));
			state.conversationReceipts.set(command.idempotencyKey, { command, conversationId: id });
			return detail;
		},
		send: async function _Send(command: SubmitConversationMessageCommand)
		{
			_OpenConversation(state, command.conversationId);
			if (state.retryAvailable)
			{
				state.retryAvailable = false;
				throw new Error("The deterministic local command failed once. Retry it unchanged.");
			}

			const receiptKey = _MessageReceiptKey(command);
			const receipt = state.messageReceipts.get(receiptKey);
			if (receipt !== undefined)
			{
				if (!_SameMessage(receipt.command, command))
				{
					return _LocalDevelopmentConflict();
				}
				return;
			}
			_AppendLocalDevelopmentParticipantMessage(state, command);
			state.messageReceipts.set(receiptKey, { command });
		},
		archive: async function _Archive(conversationId: string, archived: boolean)
		{
			const changed = _OpenConversation(state, conversationId);
			const next = { ...changed, archivedAt: archived ? _NOW : null };
			state.conversations = state.conversations.map(item => item.id === conversationId ? next : item);
			return next;
		},
		close: async function _Close(conversationId: string)
		{
			const changed = _OpenConversation(state, conversationId);
			const next = { ...changed, lifecycle: ConversationLifecycles.Closed };
			state.conversations = state.conversations.map(item => item.id === conversationId ? next : item);
			return next;
		}
	};

	const stream = _CreateLocalDevelopmentStream(state);
	const assets = _CreateLocalDevelopmentAssets(state);
	const personalRuns = _CreateLocalDevelopmentPersonalRuns(state);
	const groupChildren = _CreateLocalDevelopmentGroupChildren(state);
	const computerReview = _CreateLocalDevelopmentComputerReview();

	return { workspace, stream, assets, personalRuns, groupChildren, computerReview };
}
