import { ConversationLifecycles, ConversationModes, GroupChildStates, type GroupChildCreateCommand, type GroupChildShareCommand } from "@opencrane/models/conversations";
import { type ConversationComputerReviewGateway, type ConversationGroupChildGateway, type ConversationPersonalRun, type ConversationPersonalRunsGateway, type ConversationWorkspaceDetail } from "@opencrane/state/conversation/workspace";
import { PersonaOnboardingStates } from "@opencrane/state/onboarding";

import { _LocalDevelopmentAccessChanged, _LocalDevelopmentConflict } from "./local-development.failures";
import { _AppendLocalDevelopmentReviewedShare, _CreateLocalDevelopmentHistory, _HasLocalDevelopmentHistoryEntry } from "./local-development.history";
import type { _LocalDevelopmentState } from "./local-development.owner.types";
import { LocalDevelopmentScenarios } from "./local-development.types";

/** Stable personal-Agent conversation used by local activity rows. */
const _AGENT_CONVERSATION_ID = "conversation-agent";

/** Stable timestamp used by local activity rows. */
const _NOW = "2026-09-10T09:00:00.000Z";

/** Rejects computer review because Agent Sandbox belongs to Tier 3. */
function _ComputerUnavailable(): never
{
	throw new Error("Conversation Computer is available in Tier 3 local development.");
}

/** Requires a current group before a child request can use its authority boundary. */
function _RequireGroup(state: _LocalDevelopmentState, conversationId: string): ConversationWorkspaceDetail
{
	const parent = state.conversations.find(function _Conversation(item) { return item.id === conversationId; });
	if (parent === undefined || parent.mode !== ConversationModes.Group)
	{
		_LocalDevelopmentAccessChanged();
	}

	return parent;
}

/** Compares every immutable group-child creation coordinate. */
function _SameChild(leftParent: string, left: GroupChildCreateCommand, rightParent: string, right: GroupChildCreateCommand): boolean
{
	return leftParent === rightParent && left.parentMessageId === right.parentMessageId && left.parentMessagePosition === right.parentMessagePosition && left.agentServiceId === right.agentServiceId;
}

/** Compares every immutable reviewed-share coordinate and payload field. */
function _SameShare(leftChild: string, left: GroupChildShareCommand, rightChild: string, right: GroupChildShareCommand): boolean
{
	return leftChild === rightChild && left.sourceEntryId === right.sourceEntryId && left.sourcePosition === right.sourcePosition && left.text === right.text;
}

/** Names the parent-scoped retry slot used by reviewed result shares. */
function _ShareReceiptKey(parentConversationId: string, idempotencyKey: string): string
{
	return `${parentConversationId}\u0000${idempotencyKey}`;
}

/** Creates a navigable company-assistant child with its immutable parent origin and history. */
function _CreateChildConversation(state: _LocalDevelopmentState, parent: ConversationWorkspaceDetail, command: GroupChildCreateCommand, conversationId: string, requestId: string): ConversationWorkspaceDetail
{
	const detail: ConversationWorkspaceDetail = { id: conversationId, mode: ConversationModes.AgentSession, lifecycle: ConversationLifecycles.Open, agentServiceId: command.agentServiceId, participantRefs: [...parent.participantRefs], archivedAt: null, readThroughPosition: "0", updatedAt: _NOW, visibleFromPosition: "0", accessEndedPosition: null, parent: { requestId, parentConversationId: parent.id, parentMessageId: command.parentMessageId, parentMessagePosition: command.parentMessagePosition } };
	state.conversations = [detail, ...state.conversations];
	state.histories.set(conversationId, _CreateLocalDevelopmentHistory(state, conversationId, { agentServiceId: command.agentServiceId, displayName: "Local company assistant" }));
	return detail;
}

/** Creates personal-run projections for the normal and failed-run scenarios. */
export function _CreateLocalDevelopmentPersonalRuns(state: _LocalDevelopmentState): ConversationPersonalRunsGateway
{
	return { listPersonalRuns: async function _List(_signal: AbortSignal): Promise<readonly ConversationPersonalRun[]>
	{
		if (state.persona.state !== PersonaOnboardingStates.Ready)
		{
			return [];
		}
		const failed = state.scenario === LocalDevelopmentScenarios.FailedRun;
		return [{ runId: "local-run", conversationId: _AGENT_CONVERSATION_ID, state: failed ? "failed" : "completed", attempt: 1, agentRevisionId: `local-persona-${state.archetype}`, acceptedAt: _NOW, finishedAt: _NOW }];
	} };
}

/** Creates the in-memory group-child command adapter. */
export function _CreateLocalDevelopmentGroupChildren(state: _LocalDevelopmentState): ConversationGroupChildGateway
{
	return {
		listChildren: async function _List(parentConversationId: string)
		{
			_RequireGroup(state, parentConversationId);
			return state.children.filter(function _Child(child) { return child.parentConversationId === parentConversationId; });
		},
		createChild: async function _Create(parentConversationId: string, command: GroupChildCreateCommand)
		{
			const parent = _RequireGroup(state, parentConversationId);
			if (!_HasLocalDevelopmentHistoryEntry(state, parentConversationId, command.parentMessageId, command.parentMessagePosition))
			{
				return _LocalDevelopmentConflict();
			}
			const receipt = state.groupChildReceipts.get(command.idempotencyKey);
			if (receipt !== undefined)
			{
				if (!_SameChild(receipt.parentConversationId, receipt.command, parentConversationId, command))
				{
					return _LocalDevelopmentConflict();
				}
				return receipt.child;
			}
			const requestId = `local-child-request-${command.idempotencyKey}`;
			const child = { conversationId: `local-child-${command.idempotencyKey}`, parentConversationId, parentMessageId: command.parentMessageId, parentMessagePosition: command.parentMessagePosition, state: GroupChildStates.Ready, agentName: "Local company assistant" };
			_CreateChildConversation(state, parent, command, child.conversationId, requestId);
			state.children = [child, ...state.children];
			state.groupChildReceipts.set(command.idempotencyKey, { parentConversationId, command, child });
			return child;
		},
		shareChild: async function _Share(childConversationId: string, command: GroupChildShareCommand)
		{
			const child = state.children.find(function _Child(item) { return item.conversationId === childConversationId; });
			if (child === undefined)
			{
				return _LocalDevelopmentAccessChanged();
			}
			const receiptKey = _ShareReceiptKey(child.parentConversationId, command.idempotencyKey);
			const receipt = state.groupShareReceipts.get(receiptKey);
			if (receipt !== undefined)
			{
				if (!_SameShare(receipt.childConversationId, receipt.command, childConversationId, command))
				{
					return _LocalDevelopmentConflict();
				}
				return;
			}
			if (!_HasLocalDevelopmentHistoryEntry(state, childConversationId, command.sourceEntryId, command.sourcePosition))
			{
				return _LocalDevelopmentConflict();
			}
			const origin = state.conversations.find(function _Conversation(item) { return item.id === childConversationId; })?.parent;
			if (origin === null || origin === undefined)
			{
				return _LocalDevelopmentConflict();
			}
			_AppendLocalDevelopmentReviewedShare(state, origin, command);
			state.groupShareReceipts.set(receiptKey, { childConversationId, parentConversationId: child.parentConversationId, command });
		}
	};
}

/** Creates a fail-closed adapter for every active-computer review operation. */
export function _CreateLocalDevelopmentComputerReview(): ConversationComputerReviewGateway
{
	return {
		readComputerFile: async function _ReadFile() { return _ComputerUnavailable(); },
		readComputerDiff: async function _ReadDiff() { return _ComputerUnavailable(); },
		runComputerCommand: async function _RunCommand() { return _ComputerUnavailable(); },
		listComputerBrowserTargets: async function _ListTargets() { return _ComputerUnavailable(); },
		openComputerBrowserPage: async function _OpenPage() { return _ComputerUnavailable(); },
		captureComputerScreenshot: async function _CaptureScreenshot() { return _ComputerUnavailable(); },
		readComputerPreview: async function _ReadPreview() { return _ComputerUnavailable(); }
	};
}
