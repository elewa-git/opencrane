// This module is the trust boundary between the Control Plane conversation API and the workspace
// models. Everything it receives is an already-decoded HTTP response body read by the generated
// OpenAPI client in `workspace/adapter`. Those generated types exist at compile time only: at
// runtime the value is whatever actually arrived over the wire, from a server that may be a
// different version than the browser bundle, so nothing here may be assumed about it.
//
// Acceptance happens here rather than in the adapter because transport code is allowed to
// authenticate, decode JSON and read the status, but not to restate which fields a conversation
// has — a second copy of the accepted shape in the HTTP layer is what lets the adapter and the
// models drift apart. That is the rule in docs/agents/typescript.md, "Runtime Validators Stay
// Beside Their Models", and it is why the validator sits in the model package and is exported to
// the adapter instead of the other way round.
//
// It also cannot happen any later. The adapter wraps each of these calls in a try/catch and turns a
// rejection into a `ConversationWorkspaceGatewayError` of kind `Recoverable`, which is the last
// point where a bad payload can still become safe display copy. Once a store has the value it
// assigns it straight into a signal and the feature renders it.
//
// The model and this file change together: each parser returns its result through a declared type
// from conversation-workspace.types.ts, so adding a field to a model fails compilation here until
// the matching schema admits it.
import { z } from "zod";

import { ConversationLifecycles, ConversationModes, MessageRoles, MessageSources, MessageStates } from "@opencrane/models/conversations";

import { ConversationPersonalAgentStatuses, ConversationRunStates, type ConversationCreationDirectory, type ConversationMessage, type ConversationRun, type ConversationSummary, type ConversationWorkspaceDetail } from "./conversation-workspace.types";

/**
 * Accepts a non-empty string and returns it trimmed.
 *
 * `.trim()` is applied before `.min(1)`, so a value made only of spaces is rejected instead of
 * becoming an empty identifier that later comparisons would treat as a real coordinate.
 */
const _RequiredString = z.string().trim().min(1);

/**
 * Accepts one timeline position: `0`, or digits with no leading zero.
 *
 * Positions are a 64-bit database counter (`position BigInt` in
 * apps/opencrane/prisma/schema/conversations.prisma), which is why they cross the wire as decimal
 * strings — a 64-bit value can exceed `Number.MAX_SAFE_INTEGER` (9007199254740991) and converting it
 * would silently change the number. `0` is admitted because `visibleFromPosition` defaults to zero
 * and means the participant has been shown nothing yet.
 *
 * @see _CompareMessagePosition for how two of these are ordered.
 */
const _Position = z.string().regex(/^(0|[1-9][0-9]*)$/u);

/** Accepts a non-empty trimmed string or an explicit null, for coordinates the server nulls out — a message no run produced, or a run not attached to a conversation. */
const _NullableRequiredString = _RequiredString.nullable();

/**
 * Shape of the creation directory: opaque participant coordinates, a self marker, and whether a
 * personal Agent can be picked.
 *
 * The server sends references and a flag, never names or login subjects, and this schema is `.strict()`
 * so a payload that carried an extra identifying field would be rejected rather than quietly passed on
 * to the browser. `personalAgentStatus` goes through `z.nativeEnum`, so a status this bundle does not
 * know is refused instead of being guessed at — see the `rejects unknown categorical values instead of
 * guessing` case in the adapter's conversation-workspace.dto.spec.ts.
 */
const _Directory = z.object({
	participants: z.array(z.object({ participantRef: _RequiredString, isSelf: z.boolean() }).strict()),
	personalAgentStatus: z.nativeEnum(ConversationPersonalAgentStatuses),
	personalAgent: z.object({ personalAgentRef: _RequiredString, displayName: _RequiredString }).strict().nullable()
}).strict();

/**
 * Shape of one conversation row in the left rail.
 *
 * `mode` and `lifecycle` are the two values the feature branches on, so both are read through the
 * shared enums in `@opencrane/models/conversations` rather than as free strings: an unrecognised mode
 * would otherwise reach a screen that has no layout for it. `_Detail` extends this schema, so a field
 * added here is admitted for the open conversation as well.
 */
const _Summary = z.object({
	id: _RequiredString,
	mode: z.nativeEnum(ConversationModes),
	lifecycle: z.nativeEnum(ConversationLifecycles),
	agentServiceId: _NullableRequiredString,
	participantRefs: z.array(_RequiredString),
	archivedAt: z.string().datetime().nullable(),
	updatedAt: z.string().datetime()
}).strict();

/**
 * Shape of one message in an open conversation.
 *
 * The nested blocks are held to the same standard as the message around them, so one bad block fails
 * the whole snapshot instead of reaching the renderer as a half-built message. The
 * `rejects malformed nested message values at the model boundary` case in the adapter's
 * conversation-workspace.dto.spec.ts pins that with a block whose `id` is an empty string.
 *
 * `agentThread` is present when an `@agent` mention in this message started a child Agent session; it
 * is null on every other message.
 */
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

/**
 * Shape of the snapshot for the one open conversation: a summary plus the two access positions and the
 * messages.
 *
 * `visibleFromPosition` is the first position this participant may see, and `accessEndedPosition` is
 * the last one — non-null only after the participant was removed, which is how the store knows to stop
 * accepting new messages while still showing the history.
 */
const _Detail = _Summary.extend({ visibleFromPosition: _Position, accessEndedPosition: _Position.nullable(), messages: z.array(_Message) }).strict();

/**
 * Shape of one run's status for the signed-in participant.
 *
 * `attempt` must be a positive safe integer because both run commands send it back as
 * `expectedAttempt`: the server only acts if that number still matches, so a cancel or retry cannot
 * hit a newer attempt the participant never saw. A wrong `attempt` here would send the participant's
 * cancel to the wrong attempt, which is why it is not simply `z.number()`.
 */
const _Run = z.object({ runId: _RequiredString, attempt: z.number().int().safe().positive(), state: z.nativeEnum(ConversationRunStates), conversationId: _NullableRequiredString }).strict();

/**
 * Checks the creation directory and gives every entry a label the new-conversation form can display.
 *
 * Admits a list of opaque participant references each carrying a self marker, a personal Agent status
 * from {@link ConversationPersonalAgentStatuses}, and either one personal Agent or null. Rejects an
 * empty or blank reference, an unknown status, and any extra field, since the directory is the one
 * payload where a stray field would be identifying information about another participant.
 *
 * The labels are invented here rather than read from the server. A reference is a command coordinate,
 * not a name, and must never be shown as identity, so the signed-in participant becomes `You` and
 * everyone else becomes `Participant 1`, `Participant 2` and so on, numbered in the order the server
 * sent them. That order is stable between reads, so a given person keeps the same number.
 *
 * Called by: the `workspace/adapter` gateway's `directory()` method, through the
 * `_ConversationWorkspaceDirectory` alias in conversation-workspace.dto.ts.
 *
 * @param value - A decoded response body; assume nothing about it.
 * @returns A directory whose entries are safe to render as-is; the references stay in it because
 *   `create` has to send one back.
 * @throws ZodError when the payload does not match. Do not let it escape to a store: the adapter turns
 *   it into a `ConversationWorkspaceGatewayError` of kind `Recoverable`, which tells the participant to
 *   reconnect and keeps the rest of the screen intact.
 * @see ConversationCreationDirectory
 */
export function _ParseConversationWorkspaceDirectory(value: unknown): ConversationCreationDirectory
{
	// 1. Reject the payload outright before anything reads a field from it, so no partly-checked
	//    directory can be labelled and returned.
	const parsed = _Directory.parse(value);

	// 2. Number and label the entries. Only other participants take a number, so the counter is
	//    incremented after the self check rather than per element — self is `You` and never `Participant 0`.
	let participantNumber = 0;
	const participants = parsed.participants.map(function _Participant(participant)
	{
		if (participant.isSelf) return { ...participant, label: "You" };
		participantNumber += 1;
		return { ...participant, label: `Participant ${participantNumber}` };
	});

	// 3. Return the checked directory with the labelled list swapped in, keeping the Agent status and
	//    personal Agent the server decided; this package never chooses whether an Agent session is allowed.
	return { ...parsed, participants };
}

/**
 * Checks one conversation row for the left rail.
 *
 * Admits the conversation's id, its fixed mode, its open or closed lifecycle, the opaque participant
 * references, and the archive and update timestamps. Rejects an unknown mode or lifecycle, a timestamp
 * that is not ISO-8601, and any extra field.
 *
 * A rejection fails the whole list, not one row: the adapter maps this over every entry the API
 * returned, so one bad row means the participant sees the recoverable error instead of a list that is
 * silently missing a conversation.
 *
 * Called by: the `workspace/adapter` gateway's `list()` method, through the `_ConversationSummary`
 * alias in conversation-workspace.dto.ts.
 *
 * @param value - A decoded response body; assume nothing about it.
 * @returns A row safe to render; the labels shown for it are built by the feature, not here.
 * @throws ZodError when the payload does not match; the adapter converts it to a `Recoverable`
 *   `ConversationWorkspaceGatewayError`.
 * @see ConversationSummary
 */
export function _ParseConversationSummary(value: unknown): ConversationSummary { return _Summary.parse(value); }

/**
 * Checks the snapshot of the open conversation and puts its messages in timeline order.
 *
 * Admits everything a summary has, plus the participant's first and last visible positions and the
 * messages the server chose to send. Rejects an unknown role, state or source on any message, a
 * malformed block inside a message, a position that is not a plain decimal counter, and any extra
 * field.
 *
 * Messages are re-sorted here so display order never depends on the order the array arrived in, and
 * the sort key is `position`, not `createdAt`: the two disagree, and the adapter's
 * `sorts canonical messages by decimal position rather than timestamp` test is built from a pair whose
 * timestamps would put them the wrong way round.
 *
 * Called by: the `workspace/adapter` gateway's `open()`, `create()`, `archive()` and `close()` methods,
 * through the `_ConversationDetail` alias in conversation-workspace.dto.ts. All four return the
 * snapshot the store then treats as the current conversation.
 *
 * @param value - A decoded response body; assume nothing about it.
 * @returns A snapshot whose `messages` are ordered oldest first, ready for the store to adopt.
 * @throws ZodError when the payload does not match; the adapter converts it to a `Recoverable`
 *   `ConversationWorkspaceGatewayError`, so the participant keeps the previous conversation on screen.
 * @see ConversationWorkspaceDetail
 */
export function _ParseConversationDetail(value: unknown): ConversationWorkspaceDetail
{
	// 1. Reject the whole snapshot first. Sorting a list that has not been checked would read
	//    `position` off values that may not be positions at all.
	const parsed = _Detail.parse(value);

	// 2. Sort a copy, because `Array.prototype.sort` reorders in place and the parsed object is
	//    spread into the result below.
	const messages = [...parsed.messages].sort(_CompareMessagePosition);

	// 3. Return the snapshot with the ordered messages, leaving the access positions untouched — the
	//    store reads those to decide whether this participant may still send.
	return { ...parsed, messages };
}

/**
 * Checks one run's status for the signed-in participant.
 *
 * Admits the run id, a positive attempt number, a lifecycle from {@link ConversationRunStates}, and the
 * owning conversation id or null. Rejects an unknown lifecycle, a zero or fractional attempt, and any
 * extra field.
 *
 * Refusing an unknown lifecycle is the point of this parser rather than a formality. `ConversationRunStore`
 * decides from `state` alone whether to offer steer, cancel and retry, and retry is offered only for
 * `Failed` — never for `RecoveryRequired`, where an external action's outcome is unknown and a second
 * attempt is unsafe. A state the bundle does not recognise must therefore fail rather than fall through
 * to a default that could put the retry control on screen.
 *
 * Called by: the `workspace/adapter` gateway's `run()` method, through the `_ConversationRun` alias in
 * conversation-workspace.dto.ts. `cancel()` and `retry()` build their result from the response fields
 * instead of calling this.
 *
 * @param value - A decoded response body; assume nothing about it.
 * @returns The run status the store branches on for the steer, cancel and retry controls.
 * @throws ZodError when the payload does not match; the adapter converts it to a `Recoverable`
 *   `ConversationWorkspaceGatewayError` and the store shows the run-status error without touching the
 *   conversation.
 * @see ConversationRun
 */
export function _ParseConversationRun(value: unknown): ConversationRun { return _Run.parse(value); }

/**
 * Orders two messages by their timeline position, oldest first.
 *
 * `BigInt` rather than `Number` because a position is a 64-bit database counter: values past
 * 9007199254740991 round when converted, and two neighbouring positions can round to the same number,
 * which would make the sort order arbitrary. Comparing the strings directly would be wrong too, since
 * `"10" < "2"` as text. Both operands are already known to be plain digit strings, so `BigInt()` cannot
 * throw here.
 *
 * @param left - One message from the parsed snapshot.
 * @param right - The message it is being ordered against.
 * @returns A negative number, zero, or a positive number, as `Array.prototype.sort` expects.
 */
function _CompareMessagePosition(left: ConversationMessage, right: ConversationMessage): number
{
	if (BigInt(left.position) < BigInt(right.position)) return -1;
	if (BigInt(left.position) > BigInt(right.position)) return 1;
	return 0;
}
