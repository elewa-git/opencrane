import { z } from "zod";

import { ConversationLifecycles, ConversationModes, MessageRoles, MessageSources, MessageStates } from "@opencrane/models/conversations";

import { ConversationPersonalAgentStatuses, ConversationRunStates, type ConversationCreationDirectory, type ConversationMessage, type ConversationRun, type ConversationSummary, type ConversationWorkspaceDetail } from "./conversation-workspace.types.js";

const _RequiredString = z.string().trim().min(1);
const _Position = z.string().regex(/^(0|[1-9][0-9]*)$/u);
const _NullableRequiredString = _RequiredString.nullable();

const _Directory = z.object({
	participants: z.array(z.object({ participantRef: _RequiredString, isSelf: z.boolean() }).strict()),
	personalAgentStatus: z.nativeEnum(ConversationPersonalAgentStatuses),
	personalAgent: z.object({ personalAgentRef: _RequiredString, displayName: _RequiredString }).strict().nullable()
}).strict();

const _Summary = z.object({
	id: _RequiredString,
	mode: z.nativeEnum(ConversationModes),
	lifecycle: z.nativeEnum(ConversationLifecycles),
	agentServiceId: _NullableRequiredString,
	participantRefs: z.array(_RequiredString),
	archivedAt: z.string().datetime().nullable(),
	updatedAt: z.string().datetime()
}).strict();

const _Message = z.object({
	id: _RequiredString,
	position: _Position,
	role: z.nativeEnum(MessageRoles),
	state: z.nativeEnum(MessageStates),
	source: z.nativeEnum(MessageSources),
	blocks: z.array(z.object({ id: _RequiredString, kind: _RequiredString, value: z.string() }).strict()),
	runId: _NullableRequiredString,
	participantRef: _NullableRequiredString,
	createdAt: z.string().datetime(),
	agentThread: z.object({ childConversationId: _RequiredString, parentMessageId: _RequiredString }).strict().nullable()
}).strict();

const _Detail = _Summary.extend({ visibleFromPosition: _Position, accessEndedPosition: _Position.nullable(), messages: z.array(_Message) }).strict();
const _Run = z.object({ runId: _RequiredString, attempt: z.number().int().safe().positive(), state: z.nativeEnum(ConversationRunStates), conversationId: _NullableRequiredString }).strict();

/** Parse the self-scoped creation directory and add only generic participant labels. */
export function _ParseConversationWorkspaceDirectory(value: unknown): ConversationCreationDirectory
{
	const parsed = _Directory.parse(value);
	let participantNumber = 0;
	const participants = parsed.participants.map(function _Participant(participant)
	{
		if (participant.isSelf) return { ...participant, label: "You" };
		participantNumber += 1;
		return { ...participant, label: `Participant ${participantNumber}` };
	});
	return { ...parsed, participants };
}

/** Parse one browser-safe conversation summary. */
export function _ParseConversationSummary(value: unknown): ConversationSummary { return _Summary.parse(value); }

/** Parse one bounded conversation and sort its decimal timeline without losing precision. */
export function _ParseConversationDetail(value: unknown): ConversationWorkspaceDetail
{
	const parsed = _Detail.parse(value);
	const messages = [...parsed.messages].sort(_CompareMessagePosition);
	return { ...parsed, messages };
}

/** Parse one participant-visible run status. */
export function _ParseConversationRun(value: unknown): ConversationRun { return _Run.parse(value); }

/** Compare decimal positions without converting them to unsafe JavaScript numbers. */
function _CompareMessagePosition(left: ConversationMessage, right: ConversationMessage): number
{
	if (BigInt(left.position) < BigInt(right.position)) return -1;
	if (BigInt(left.position) > BigInt(right.position)) return 1;
	return 0;
}
