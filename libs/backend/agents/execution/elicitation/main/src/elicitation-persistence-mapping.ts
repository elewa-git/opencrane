import { CONVERSATION_ELICITATION_VERSION, type ConversationElicitation, type ElicitationBody } from "@opencrane/contracts";

import type { OpenElicitationCommand } from "./elicitation.types.js";
import type { ElicitationProjectionRow, ElicitationReplayRow } from "./elicitation-persistence-mapping.types.js";

/*
 * This module sits between two separately owned sets of enum values and belongs to neither.
 *
 * The database side is owned by `apps/opencrane/prisma/schema/elicitation.prisma`, whose
 * `ElicitationRequestState`, `ElicitationPurpose`, and `ElicitationBodyKind` become real Postgres
 * enum types. The client side is owned by `@opencrane/contracts`, whose `ElicitationRequestStates`,
 * `ElicitationPurposes`, and `ElicitationBodyKinds` are the strings a browser reads.
 *
 * The member-by-member pairing tables (`_PrismaPurpose`, `_PublicPurpose`, `_PrismaBodyKind`,
 * `_PublicState`) stay in prisma-elicitation-unit-of-work.ts, next to the Prisma client. That is why
 * this file imports no `@prisma/client`: it receives values that are already on the right side, and
 * takes the stored purpose and body kind as plain strings.
 *
 * If the two sides drift, this file does not notice. Renaming a Prisma enum member, or its `@map`
 * value, changes the column values and needs a schema migration plus a reviewed target baseline;
 * renaming a contract value breaks every browser client instead. Adding a member on one side only
 * fails the build in the unit of work, because its lookup tables must list every member of the enum
 * they are keyed by.
 */

/**
 * Turns a stored elicitation request into the shape a browser is allowed to see.
 *
 * Every field of the reply is named here, one at a time, which is what makes the result safe: a
 * caller that spreads a whole Prisma row into {@link ElicitationProjectionRow} still cannot leak
 * `purposePayload`, `bodyDigest`, `requestKey`, `siloId`, or `resolvedBy`, because this function
 * never copies them. `purposePayload` in particular holds the protected consent coordinates for a
 * personal-memory permission and must never reach a client.
 *
 * `resolvedAt` and `safeReason` are added only when the row has them, because
 * {@link ConversationElicitation} declares both optional and a request that is still open has
 * neither. Writing them as `undefined` instead would put the keys in the JSON.
 *
 * Called by: `_Projection` in prisma-elicitation-unit-of-work.ts, which converts `purpose` and
 * `state` out of the database's own values first, and which `_ProjectionAt` also goes through.
 * Nothing outside this package imports it.
 *
 * @param row - The stored request, with `purpose` and `state` already converted to the contract
 * enums by the caller.
 * @returns The versioned reply sent to the participant's browser and used for reconnect replay.
 */
export function _ProjectElicitation(row: ElicitationProjectionRow): ConversationElicitation
{
	let projection: ConversationElicitation = { version: CONVERSATION_ELICITATION_VERSION, requestId: row.id, conversationId: row.conversationId, runId: row.runId, attempt: row.attempt, assignedParticipantId: row.assignedParticipantId, purpose: row.purpose, state: row.state, body: row.body as unknown as ElicitationBody, requiresStepUp: row.requiresStepUp, requestedAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString() };
	if (row.resolvedAt !== null) projection = { ...projection, resolvedAt: row.resolvedAt.toISOString() };
	if (row.safeReason !== null) projection = { ...projection, safeReason: row.safeReason };
	return projection;
}

/**
 * Checks that a request already stored under this run, attempt, and request key is the same request
 * the caller is asking to open again.
 *
 * The runtime may post the same proposal twice — a retried dispatch, a re-delivered command — and
 * `open` has to tell a harmless replay from a second, different ask reusing one key. Every field the
 * runtime or the browser controls is compared. The times are deliberately left out: `now` and
 * `expiresAt` are read from the server clock on each post, so two honest replays of one request will
 * legitimately differ there. Comparing them would refuse every retry.
 *
 * Called by: `PrismaElicitationRepository.open` in prisma-elicitation-unit-of-work.ts. True means
 * `open` returns the stored request unchanged; false makes it return null, which the caller treats as
 * a refusal rather than overwriting the first request.
 *
 * @param row - The stored request found by the `runId_attempt_requestKey` unique key.
 * @param command - The request the caller wants to open.
 * @param bodyDigest - Digest of `command.body`, computed once by the caller because it also stores it.
 * @param storedPurpose - `command.purpose` already converted to the value the database holds. Passed
 * in, rather than converted here, so this module does not have to import Prisma's generated enums.
 * @param storedBodyKind - `command.body.kind` already converted the same way.
 * @returns True when the stored row and the command describe one request, so the post is a replay.
 */
export function _ElicitationRequestMatchesOpenCommand(row: ElicitationReplayRow, command: OpenElicitationCommand, bodyDigest: string, storedPurpose: string, storedBodyKind: string): boolean
{
	return row.id === command.requestId
		&& row.siloId === command.siloId
		&& row.conversationId === command.conversationId
		&& row.runId === command.runId
		&& row.attempt === command.attempt
		&& row.assignedParticipantId === command.assignedParticipantId
		&& row.requestKey === command.requestKey
		&& row.purpose === storedPurpose
		&& row.bodyKind === storedBodyKind
		&& row.bodyDigest === bodyDigest
		&& row.purposePayloadDigest === command.purposePayloadDigest
		&& row.requiresStepUp === command.requiresStepUp;
}
