import { ConversationModes } from "@opencrane/models/conversations";
import type { JsonValue } from "@opencrane/util";

import type { ReserveConversationCreationCommand } from "./conversation-creation-reservation.types";
import type { ConversationCaller } from "./types/conversation-caller.types";

/** Rejects non-replayable commands before their authorization evidence and reservation can commit. */
export function __ValidateConversationCreationReservation(command: ReserveConversationCreationCommand, caller: ConversationCaller): void
{
	if (command.siloId !== caller.siloId || command.principalId !== caller.principalId)
		throw new Error("Conversation creation reservation caller coordinates must be session-derived");
	if (!_Uuid(command.requestId) || !_Uuid(command.conversationId) || !_Uuid(command.historyEventId))
		throw new Error("Conversation creation reservation requires UUID retry and history coordinates");
	if (!/^sha256:[0-9a-f]{64}$/u.test(command.requestDigest))
		throw new Error("Conversation creation reservation requires a SHA-256 request digest");
	if (command.participants.length === 0 || command.participants.some(function _InvalidParticipant(participant, index) { return participant.userId.trim().length === 0 || participant.visibleFromPosition !== (index + 1).toString() || Number.isNaN(Date.parse(participant.joinedAt)); }))
		throw new Error("Conversation creation reservation requires sequential participant coordinates");
	if (new Set(command.participants.map(function _UserId(participant) { return participant.userId; })).size !== command.participants.length)
		throw new Error("Conversation creation reservation requires distinct participants");
	if (command.mode === ConversationModes.Direct && command.participants.length !== 2)
		throw new Error("Direct conversation reservation requires two participants");
	if (command.mode === ConversationModes.Group && command.participants.length < 2)
		throw new Error("Group conversation reservation requires at least two participants");
	if (command.mode === ConversationModes.AgentSession && (command.participants.length !== 1 || command.agent === null))
		throw new Error("Agent conversation reservation requires one participant and server agent coordinates");
	if (command.mode !== ConversationModes.AgentSession && command.agent !== null)
		throw new Error("Direct and group conversation reservation must not carry agent coordinates");
	if (command.agent !== null && (!_Identifier(command.agent.agentServiceId) || !_Identifier(command.agent.agentRevisionId) || !_Uuid(command.agent.computerId) || !_Uuid(command.agent.computerHistoryEventId)))
		throw new Error("Agent conversation reservation requires complete server agent coordinates");
}

/** Builds the canonical authorization arguments that bind a decision to this exact durable command. */
export function __ConversationCreationReservationAuthorizationArguments(command: ReserveConversationCreationCommand): JsonValue
{
	return { requestId: command.requestId, requestDigest: command.requestDigest, conversationId: command.conversationId, historyEventId: command.historyEventId, mode: command.mode, participants: command.participants, agent: command.agent } as unknown as JsonValue;
}

/** Checks an opaque server identifier without changing the durable coordinate. */
function _Identifier(value: string): boolean
{
	return value.trim().length > 0 && value === value.trim();
}

/** Recognizes the UUID form accepted for server-generated history and retry identifiers. */
function _Uuid(value: string): boolean
{
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
