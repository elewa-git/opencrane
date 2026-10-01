import { ConversationLifecycles, ConversationModes, GroupChildStates, type GroupChildCreateCommand, type GroupChildShareCommand } from "@opencrane/models/conversations";
import { type ConversationGroupChildGateway, type ConversationWorkspaceDetail } from "@opencrane/state/conversation/workspace";

import { _LocalDevelopmentAccessChanged, _LocalDevelopmentConflict } from "./local-development.failures";
import { _LOCAL_DEVELOPMENT_NOW } from "./local-development.fixture-coordinates";
import { _AppendLocalDevelopmentReviewedShare, _CreateLocalDevelopmentHistory, _HasLocalDevelopmentHistoryEntry } from "./local-development.history";
import type { _LocalDevelopmentState } from "./local-development.owner.types";

/** Requires a current group before a child request can use its authority boundary. */
function _RequireGroup(state: _LocalDevelopmentState, conversationId: string): ConversationWorkspaceDetail
{
	const parent = state.conversations.find(item => item.id === conversationId);

	if (!parent || parent.mode !== ConversationModes.Group)
	{
		_LocalDevelopmentAccessChanged();
	}

	return parent;
}

/** Compares every immutable group-child creation coordinate. */
function _SameChild(leftParent: string, left: GroupChildCreateCommand, rightParent: string, right: GroupChildCreateCommand): boolean
{
	return leftParent === rightParent
		&& left.parentMessageId === right.parentMessageId
		&& left.parentMessagePosition === right.parentMessagePosition
		&& left.agentServiceId === right.agentServiceId;
}

/** Compares every immutable reviewed-share coordinate and payload field. */
function _SameShare(leftChild: string, left: GroupChildShareCommand, rightChild: string, right: GroupChildShareCommand): boolean
{
	return leftChild === rightChild
		&& left.sourceEntryId === right.sourceEntryId
		&& left.sourcePosition === right.sourcePosition
		&& left.text === right.text;
}

/** Names the parent-scoped retry slot used by reviewed result shares. */
function _ShareReceiptKey(parentConversationId: string, idempotencyKey: string): string
{
	return `${parentConversationId}\u0000${idempotencyKey}`;
}

/** Creates a navigable company-assistant child with its immutable parent origin and history. */
function _CreateChildConversation(state: _LocalDevelopmentState, parent: ConversationWorkspaceDetail, command: GroupChildCreateCommand, conversationId: string, requestId: string): ConversationWorkspaceDetail
{
	const detail: ConversationWorkspaceDetail = {
		id: conversationId,
		mode: ConversationModes.AgentSession,
		lifecycle: ConversationLifecycles.Open,
		agentServiceId: command.agentServiceId,
		participantRefs: [...parent.participantRefs],
		archivedAt: null,
		readThroughPosition: "0",
		updatedAt: _LOCAL_DEVELOPMENT_NOW,
		visibleFromPosition: "0",
		accessEndedPosition: null,
		parent: {
			requestId,
			parentConversationId: parent.id,
			parentMessageId: command.parentMessageId,
			parentMessagePosition: command.parentMessagePosition
		}
	};
	state.conversations = [detail, ...state.conversations];
	state.histories.set(conversationId, _CreateLocalDevelopmentHistory(state, conversationId, {
		agentServiceId: command.agentServiceId,
		displayName: "Local company assistant"
	}));

	return detail;
}

/**
 * Provides Tier 1 group-child creation and reviewed-result sharing over the shared fixture state.
 * It binds each retry key to its first command so a changed retry fails instead of creating or sharing twice.
 */
export function _CreateLocalDevelopmentGroupChildren(state: _LocalDevelopmentState): ConversationGroupChildGateway
{
	/** Lists the reviewed child conversations created from one group. */
	async function _ListChildren(parentConversationId: string)
	{
		_RequireGroup(state, parentConversationId);

		return state.children.filter(child => child.parentConversationId === parentConversationId);
	}

	/** Creates one reviewed child while preserving idempotent retry behavior. */
	async function _CreateChild(parentConversationId: string, command: GroupChildCreateCommand)
	{
		const parent = _RequireGroup(state, parentConversationId);

		if (!_HasLocalDevelopmentHistoryEntry(state, parentConversationId, command.parentMessageId, command.parentMessagePosition))
		{
			return _LocalDevelopmentConflict();
		}

		const receipt = state.groupChildReceipts.get(command.idempotencyKey);

		if (receipt)
		{
			if (!_SameChild(receipt.parentConversationId, receipt.command, parentConversationId, command))
			{
				return _LocalDevelopmentConflict();
			}

			return receipt.child;
		}

		const requestId = `local-child-request-${command.idempotencyKey}`;
		const child = {
			conversationId: `local-child-${command.idempotencyKey}`,
			parentConversationId,
			parentMessageId: command.parentMessageId,
			parentMessagePosition: command.parentMessagePosition,
			state: GroupChildStates.Ready,
			agentName: "Local company assistant"
		};
		_CreateChildConversation(state, parent, command, child.conversationId, requestId);
		state.children = [child, ...state.children];
		state.groupChildReceipts.set(command.idempotencyKey, {
			parentConversationId,
			command,
			child
		});

		return child;
	}

	/** Shares one reviewed child result into its parent conversation. */
	async function _ShareChild(childConversationId: string, command: GroupChildShareCommand)
	{
		const child = state.children.find(item => item.conversationId === childConversationId);

		if (!child)
		{
			return _LocalDevelopmentAccessChanged();
		}

		const receiptKey = _ShareReceiptKey(child.parentConversationId, command.idempotencyKey);
		const receipt = state.groupShareReceipts.get(receiptKey);

		if (receipt)
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

		const origin = state.conversations.find(item => item.id === childConversationId)?.parent;

		if (!origin)
		{
			return _LocalDevelopmentConflict();
		}

		_AppendLocalDevelopmentReviewedShare(state, origin, command);
		state.groupShareReceipts.set(receiptKey, {
			childConversationId,
			parentConversationId: child.parentConversationId,
			command
		});
	}

	return {
		listChildren: _ListChildren,
		createChild: _CreateChild,
		shareChild: _ShareChild
	};
}
