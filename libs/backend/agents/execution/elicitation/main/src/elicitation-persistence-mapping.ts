import { CONVERSATION_ELICITATION_VERSION, type ConversationElicitation, type ElicitationBody } from "@opencrane/contracts";

import type { OpenElicitationCommand } from "./elicitation.types.js";
import type { ElicitationProjectionRow, ElicitationReplayRow } from "./elicitation-persistence-mapping.types.js";

/** Project a persistence row into the browser-safe contract without protected payloads. */
export function _ProjectElicitation(row: ElicitationProjectionRow): ConversationElicitation
{
	let projection: ConversationElicitation = { version: CONVERSATION_ELICITATION_VERSION, requestId: row.id, conversationId: row.conversationId, runId: row.runId, attempt: row.attempt, assignedParticipantId: row.assignedParticipantId, purpose: row.purpose, state: row.state, body: row.body as unknown as ElicitationBody, requiresStepUp: row.requiresStepUp, requestedAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString() };
	if (row.resolvedAt !== null) projection = { ...projection, resolvedAt: row.resolvedAt.toISOString() };
	if (row.safeReason !== null) projection = { ...projection, safeReason: row.safeReason };
	return projection;
}

/** Compare caller-controlled fields with their values at the Prisma boundary. */
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
