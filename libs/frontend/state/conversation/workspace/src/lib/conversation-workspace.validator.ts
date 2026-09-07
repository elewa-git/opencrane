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

import { ConversationLifecycles, ConversationModes } from "@opencrane/models/conversations";

import { ConversationPersonalAgentStatuses, type ConversationCreationDirectory, type ConversationSummary, type ConversationWorkspaceDetail } from "./conversation-workspace.types";

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
 * Accepts the member names selected by the server for conversation creation.
 * Extra identity fields such as login subjects and email addresses remain rejected.
 */
const _Directory = z.object({
	participants: z.array(z.object({ participantRef: _RequiredString, displayName: _RequiredString, isSelf: z.boolean() }).strict()),
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
	readThroughPosition: _Position,
	updatedAt: z.string().datetime()
}).strict();

/**
 * Shape of the snapshot for the one open conversation: a summary plus the two access positions and the
 * messages.
 *
 * `visibleFromPosition` is the first position this participant may see, and `accessEndedPosition` is
 * the last one — non-null only after the participant was removed, which is how the store knows to stop
 * accepting new messages while still showing the history.
 */
const _Detail = _Summary.extend({ visibleFromPosition: _Position, accessEndedPosition: _Position.nullable() }).strict();

/**
 * Validates the directory and prepares member names for the conversation picker and chat titles.
 * The self marker supplies `You`; other labels come from the explicit displayName field.
 * Opaque references remain command coordinates and never become display text.
 * @throws ZodError when required fields are missing or unexpected identity fields are present.
 */
export function _ParseConversationWorkspaceDirectory(value: unknown): ConversationCreationDirectory
{
	const parsed = _Directory.parse(value);
	const participants = parsed.participants.map(function _Participant(participant)
	{
		return { participantRef: participant.participantRef, isSelf: participant.isSelf, label: participant.isSelf ? "You" : participant.displayName };
	});
	return { ...parsed, participants };
}

/**
 * Checks one conversation row for the left rail.
 *
 * Admits the conversation's id, its fixed mode, its open or closed lifecycle, the opaque participant
 * and Agent references, the participant's read-through position, and the archive and update timestamps.
 * Rejects an unknown mode or lifecycle, an invalid position or timestamp, and any extra field.
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
	return _Detail.parse(value);
}
