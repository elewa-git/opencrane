import { ConversationLifecycles, ConversationModes, MessageRoles } from "@opencrane/models/conversations";
import { PersonaFirstChatTranscriptRoles, type PersonaFirstChatSnapshot } from "@opencrane/models/user-onboarding";
import { ConversationOnboardingHistoryStatuses, ConversationPersonalAgentStatuses, type ConversationWorkspaceDetail, type CreateConversationCommand, type SubmitConversationMessageCommand } from "@opencrane/state/conversation/workspace";
import { PersonaOnboardingStates } from "@opencrane/state/onboarding";

import { _CreateLocalDevelopmentAssets } from "./local-development.assets";
import { _CreateLocalDevelopmentComputerReview } from "./local-development.computer-review";
import { _LocalDevelopmentAccessChanged, _LocalDevelopmentConflict } from "./local-development.failures";
import { _LOCAL_DEVELOPMENT_NOW, _LOCAL_DEVELOPMENT_PERSONAL_AGENT_CONVERSATION_ID } from "./local-development.fixture-coordinates";
import { __LOCAL_DEVELOPMENT_BOOTSTRAPS } from "./local-development.fixtures";
import { _CreateLocalDevelopmentGroupChildren } from "./local-development.group-children";
import { _AppendLocalDevelopmentParticipantMessage, _CreateLocalDevelopmentHistory } from "./local-development.history";
import type { _LocalDevelopmentState, _LocalDevelopmentWorkspacePorts } from "./local-development.owner.types";
import { _CreateLocalDevelopmentPersonalRuns } from "./local-development.personal-runs";
import { _CreateLocalDevelopmentStream } from "./local-development.stream";

/** Identifies the browser subject that each disposable workspace treats as signed in. */
export const _LOCAL_DEVELOPMENT_SUBJECT = "local-developer";

/** Creates the stable personal-Agent metadata row. */
export function _CreateLocalDevelopmentAgentConversation(state: Pick<_LocalDevelopmentState, "archetype">): ConversationWorkspaceDetail
{
	return {
		id: _LOCAL_DEVELOPMENT_PERSONAL_AGENT_CONVERSATION_ID,
		mode: ConversationModes.AgentSession,
		lifecycle: ConversationLifecycles.Open,
		agentServiceId: `local-agent-${state.archetype}`,
		participantRefs: [_LOCAL_DEVELOPMENT_SUBJECT],
		archivedAt: null,
		readThroughPosition: "0",
		updatedAt: _LOCAL_DEVELOPMENT_NOW,
		visibleFromPosition: "0",
		accessEndedPosition: null,
		parent: null
	};
}

/** Creates a direct or group metadata row beside the personal-Agent session. */
export function _CreateLocalDevelopmentOrdinaryConversation(id: string, mode: ConversationModes.Direct | ConversationModes.Group, participants: readonly string[]): ConversationWorkspaceDetail
{
	return {
		id,
		mode,
		lifecycle: ConversationLifecycles.Open,
		agentServiceId: null,
		participantRefs: participants,
		archivedAt: null,
		readThroughPosition: "0",
		updatedAt: _LOCAL_DEVELOPMENT_NOW,
		visibleFromPosition: "0",
		accessEndedPosition: null,
		parent: null
	};
}

/** Maps first-chat speaker roles to the roles accepted by the read-only workspace transcript. */
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

	if (!found)
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
	return left.conversationId === right.conversationId
		&& left.text === right.text
		&& left.activation === right.activation;
}

/** Names the conversation-scoped retry slot used by participant messages. */
function _MessageReceiptKey(command: SubmitConversationMessageCommand): string
{
	return `${command.conversationId}\u0000${command.idempotencyKey}`;
}

/** Creates every workspace-owned port over the shared disposable state. */
export function _CreateLocalDevelopmentWorkspacePorts(state: _LocalDevelopmentState, firstChatSnapshot: () => PersonaFirstChatSnapshot): _LocalDevelopmentWorkspacePorts
{
	/** Lists every assistant and participant visible to the local developer. */
	async function _Directory()
	{
		const ready = state.persona.state === PersonaOnboardingStates.Ready;
		const directory = {
			companyAssistants: [{
				agentServiceId: "local-company-agent",
				displayName: "Local company assistant"
			}],
			participants: [
				{
					participantRef: _LOCAL_DEVELOPMENT_SUBJECT,
					isSelf: true,
					label: "You"
				},
				{
					participantRef: "local-peer",
					isSelf: false,
					label: "Amina"
				},
				{
					participantRef: "local-peer-two",
					isSelf: false,
					label: "Kamau"
				}
			]
		};

		if (!ready)
		{
			return {
				...directory,
				personalAgentStatus: ConversationPersonalAgentStatuses.Unavailable,
				personalAgent: null
			};
		}

		return {
			...directory,
			personalAgentStatus: ConversationPersonalAgentStatuses.Ready,
			personalAgent: {
				personalAgentRef: `local-agent-${state.archetype}`,
				displayName: __LOCAL_DEVELOPMENT_BOOTSTRAPS[state.archetype].displayName
			}
		};
	}

	/** Lists the local developer's current conversations. */
	async function _List()
	{
		return state.conversations;
	}

	/** Returns the first-chat transcript after the local developer completes it. */
	async function _OnboardingHistory()
	{
		if (!state.firstChatCompleted)
		{
			return {
				status: ConversationOnboardingHistoryStatuses.NotCompleted,
				history: null
			};
		}

		const snapshot = firstChatSnapshot();

		return {
			status: ConversationOnboardingHistoryStatuses.Ready,
			history: {
				id: "local-onboarding-conversation",
				personaDisplayName: __LOCAL_DEVELOPMENT_BOOTSTRAPS[state.archetype].displayName,
				startedAt: _LOCAL_DEVELOPMENT_NOW,
				completedAt: _LOCAL_DEVELOPMENT_NOW,
				transcript: snapshot.transcript.map(item => ({
					ordinal: item.ordinal,
					role: _WorkspaceHistoryRole(item.role),
					text: item.text
				}))
			}
		};
	}

	/** Opens one local conversation by its stable identifier. */
	async function _Open(conversationId: string)
	{
		return _OpenConversation(state, conversationId);
	}

	/** Creates one conversation while preserving idempotent retry behavior. */
	async function _Create(command: CreateConversationCommand)
	{
		if (command.mode === ConversationModes.AgentSession && state.persona.state !== PersonaOnboardingStates.Ready)
		{
			return _LocalDevelopmentAccessChanged();
		}

		const id = `local-created-${command.idempotencyKey}`;
		const receipt = state.conversationReceipts.get(command.idempotencyKey);

		if (receipt)
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
			detail = {
				..._CreateLocalDevelopmentAgentConversation(state),
				id
			};
		}
		else
		{
			detail = _CreateLocalDevelopmentOrdinaryConversation(id, command.mode, [
				_LOCAL_DEVELOPMENT_SUBJECT,
				...command.participantRefs
			]);
		}

		state.conversations = [detail, ...state.conversations];
		state.histories.set(id, _CreateLocalDevelopmentHistory(state, id));
		state.conversationReceipts.set(command.idempotencyKey, {
			command,
			conversationId: id
		});

		return detail;
	}

	/** Sends one local message while preserving failure and retry scenarios. */
	async function _Send(command: SubmitConversationMessageCommand)
	{
		_OpenConversation(state, command.conversationId);

		if (state.retryAvailable)
		{
			state.retryAvailable = false;
			throw new Error("The deterministic local command failed once. Retry it unchanged.");
		}

		const receiptKey = _MessageReceiptKey(command);
		const receipt = state.messageReceipts.get(receiptKey);

		if (receipt)
		{
			if (!_SameMessage(receipt.command, command))
			{
				return _LocalDevelopmentConflict();
			}

			return;
		}

		_AppendLocalDevelopmentParticipantMessage(state, command);
		state.messageReceipts.set(receiptKey, { command });
	}

	/** Changes whether one local conversation appears in the archived list. */
	async function _Archive(conversationId: string, archived: boolean)
	{
		const changed = _OpenConversation(state, conversationId);
		const next = {
			...changed,
			archivedAt: archived ? _LOCAL_DEVELOPMENT_NOW : null
		};
		state.conversations = state.conversations.map(item => item.id === conversationId ? next : item);

		return next;
	}

	/** Closes one local conversation without removing its history. */
	async function _Close(conversationId: string)
	{
		const changed = _OpenConversation(state, conversationId);
		const next = {
			...changed,
			lifecycle: ConversationLifecycles.Closed
		};
		state.conversations = state.conversations.map(item => item.id === conversationId ? next : item);

		return next;
	}

	const workspace = {
		directory: _Directory,
		list: _List,
		onboardingHistory: _OnboardingHistory,
		open: _Open,
		create: _Create,
		send: _Send,
		archive: _Archive,
		close: _Close
	};

	const stream = _CreateLocalDevelopmentStream(state);
	const assets = _CreateLocalDevelopmentAssets(state);
	const personalRuns = _CreateLocalDevelopmentPersonalRuns(state);
	const groupChildren = _CreateLocalDevelopmentGroupChildren(state);
	const computerReview = _CreateLocalDevelopmentComputerReview();

	return {
		workspace,
		stream,
		assets,
		personalRuns,
		groupChildren,
		computerReview
	};
}
