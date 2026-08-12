import { ConversationLifecycles, ConversationModes, MessageRoles, MessageSources, MessageStates } from "@opencrane/models/conversations";
import { ConversationPersonalAgentStatuses, ConversationRunStates, type ConversationCreationDirectory, type ConversationMessage, type ConversationRun, type ConversationSummary, type ConversationWorkspaceDetail } from "@opencrane/state/conversation/workspace";

import type { ConversationDetailDto, ConversationDirectoryDto, ConversationMessageDto, ConversationRunDto, ConversationSummaryDto } from "./conversation-workspace.dto.types.js";

/** Map the self-scoped directory to generic labels without interpreting opaque references. */
export function _ConversationWorkspaceDirectory(dto: ConversationDirectoryDto): ConversationCreationDirectory
{
	let participantNumber = 0;
	const participants = dto.participants.map(function _Participant(participant)
	{
		if (participant.isSelf) return { ...participant, label: "You" };
		participantNumber += 1;
		return { ...participant, label: `Participant ${participantNumber}` };
	});
	return { participants, personalAgentStatus: _PersonalAgentStatus(dto.personalAgentStatus), personalAgent: dto.personalAgent };
}

/** Map one generated summary into the dependency-neutral browser model. */
export function _ConversationSummary(dto: ConversationSummaryDto): ConversationSummary
{
	return { id: _Required(dto.id, "conversation id"), mode: _Mode(dto.mode), lifecycle: _Lifecycle(dto.lifecycle), agentServiceId: dto.agentServiceId, participantRefs: dto.participantRefs.map(function _Reference(value) { return _Required(value, "participant reference"); }), archivedAt: dto.archivedAt, updatedAt: _Required(dto.updatedAt, "updated time") };
}

/** Map one generated detail and sort messages by their decimal timeline position. */
export function _ConversationDetail(dto: ConversationDetailDto): ConversationWorkspaceDetail
{
	const summary = _ConversationSummary(dto);
	const messages = dto.messages.map(_ConversationMessage).sort(_CompareMessagePosition);
	return { ...summary, visibleFromPosition: _Position(dto.visibleFromPosition), accessEndedPosition: dto.accessEndedPosition === null ? null : _Position(dto.accessEndedPosition), messages };
}

/** Map one generated message without retaining login identity or hidden origin fields. */
function _ConversationMessage(dto: ConversationMessageDto): ConversationMessage
{
	return { id: _Required(dto.id, "message id"), position: _Position(dto.position), role: _Role(dto.role), state: _MessageState(dto.state), source: _Source(dto.source), blocks: dto.blocks.map(function _Block(block) { return { id: _Required(block.id, "block id"), kind: _Required(block.kind, "block kind"), value: block.value }; }), runId: dto.runId, participantRef: dto.participantRef, createdAt: _Required(dto.createdAt, "message time"), agentThread: dto.agentThread === null ? null : { childConversationId: _Required(dto.agentThread.childConversationId, "child conversation id"), parentMessageId: _Required(dto.agentThread.parentMessageId, "parent message id") } };
}

/** Map one generated run status into the selected conversation's command state. */
export function _ConversationRun(dto: ConversationRunDto): ConversationRun
{
	return { runId: _Required(dto.runId, "run id"), attempt: _Attempt(dto.attempt), state: _RunState(dto.state), conversationId: dto.conversationId };
}

/** Require a non-empty display-safe coordinate. */
function _Required(value: string, label: string): string
{
	if (value.trim().length === 0) throw new Error(`Conversation response has no ${label}.`);
	return value;
}

/** Require a positive decimal timeline position. */
function _Position(value: string): string
{
	if (!/^(0|[1-9][0-9]*)$/u.test(value)) throw new Error("Conversation response has an invalid position.");
	return value;
}

/** Require one positive integer attempt. */
function _Attempt(value: number): number
{
	if (!Number.isSafeInteger(value) || value < 1) throw new Error("Conversation response has an invalid run attempt.");
	return value;
}

/** Compare decimal positions without losing precision in a JavaScript number. */
function _CompareMessagePosition(left: ConversationMessage, right: ConversationMessage): number
{
	if (BigInt(left.position) < BigInt(right.position)) return -1;
	if (BigInt(left.position) > BigInt(right.position)) return 1;
	return 0;
}

/** Convert one serialized immutable mode. */
function _Mode(value: string): ConversationModes
{
	switch (value)
	{
		case ConversationModes.AgentSession: return ConversationModes.AgentSession;
		case ConversationModes.Direct: return ConversationModes.Direct;
		case ConversationModes.Group: return ConversationModes.Group;
	}
	throw new Error("Conversation response has an invalid mode.");
}

/** Convert one serialized conversation lifecycle. */
function _Lifecycle(value: string): ConversationLifecycles
{
	switch (value)
	{
		case ConversationLifecycles.Open: return ConversationLifecycles.Open;
		case ConversationLifecycles.Closed: return ConversationLifecycles.Closed;
	}
	throw new Error("Conversation response has an invalid lifecycle.");
}

/** Convert one serialized message role. */
function _Role(value: string): MessageRoles
{
	for (const role of Object.values(MessageRoles)) if (role === value) return role;
	throw new Error("Conversation response has an invalid message role.");
}

/** Convert one serialized message lifecycle. */
function _MessageState(value: string): MessageStates
{
	for (const state of Object.values(MessageStates)) if (state === value) return state;
	throw new Error("Conversation response has an invalid message state.");
}

/** Convert one serialized message source. */
function _Source(value: string): MessageSources
{
	for (const source of Object.values(MessageSources)) if (source === value) return source;
	throw new Error("Conversation response has an invalid message source.");
}

/** Convert the personal Agent directory status. */
function _PersonalAgentStatus(value: string): ConversationPersonalAgentStatuses
{
	for (const status of Object.values(ConversationPersonalAgentStatuses)) if (status === value) return status;
	throw new Error("Conversation directory has an invalid personal Agent status.");
}

/** Convert one serialized run lifecycle. */
function _RunState(value: string): ConversationRunStates
{
	for (const state of Object.values(ConversationRunStates)) if (state === value) return state;
	throw new Error("Conversation response has an invalid run state.");
}
