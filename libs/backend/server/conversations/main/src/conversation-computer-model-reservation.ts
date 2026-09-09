import { createHash } from "node:crypto";
import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { ConversationComputerModelReservation } from "./conversation-computer-model.types";
import type { FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/** Identifies the persisted v1 reservation format; changing its shape requires a new event version. */
export const _CONVERSATION_MODEL_RESERVED_EVENT = "opencrane.conversation-computer-turn-model-reserved.v1";

/** Build only non-secret reservation evidence under the turn's complete lease coordinates. */
export function _ConversationModelReservationEvent(turn: FrozenConversationComputerTurn, reservation: ConversationComputerModelReservation)
{
	const hex = createHash("sha256").update(`model-reservation:${reservation.invocationFence}`).digest("hex").slice(0, 32).split("");
	hex[12] = "4";
	hex[16] = "8";
	const id = `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
	return { id, type: _CONVERSATION_MODEL_RESERVED_EVENT, data: { bootstrapId: turn.bootstrapId, reservation: { ...reservation } }, metadata: { siloId: turn.siloId, computerId: turn.computerId, leaseId: turn.lease.leaseId, generation: String(turn.lease.leaseGeneration), bootstrapId: turn.bootstrapId } };
}

/** Bind the immutable compiled input, model, ordinal and absolute limits into one request identity. */
export function _ConversationModelRequestDigest(turn: Pick<FrozenConversationComputerTurn, "bootstrapId" | "compile" | "modelAlias">, reservation: Omit<ConversationComputerModelReservation, "invocationFence" | "requestDigest">): string
{
	return ___DigestCanonicalJson({ bootstrapId: turn.bootstrapId, runId: turn.compile.runId, attempt: turn.compile.attempt, compiledInputDigest: turn.compile.digest, modelAlias: turn.modelAlias, ordinal: reservation.ordinal, maxCompletionTokens: reservation.maxCompletionTokens, authorityExpiresAtEpochMs: reservation.authorityExpiresAtEpochMs, dispatchDeadlineEpochMs: reservation.dispatchDeadlineEpochMs });
}

/**
 * Checks the saved fields, request digest and complete revision-1 event against the frozen turn.
 * Reading a valid fence proves what was recorded, not that this caller may dispatch.
 * @throws Error when fields, stream coordinates, event identity or digests differ.
 * Called by: KurrentConversationComputerTurnStore.load and KurrentConversationComputerTurnStore.reserveModel.
 */
export function _ReadConversationModelReservation(event: HistoryRecordedEvent, turn: FrozenConversationComputerTurn): ConversationComputerModelReservation
{
	const value = event.data["reservation"] as ConversationComputerModelReservation | undefined;
	if (value === undefined || value === null || typeof value !== "object"
		|| typeof value.invocationFence !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.invocationFence)
		|| value.ordinal !== 1 || value.compiledInputDigest !== turn.compile.digest
		|| typeof value.requestDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value.requestDigest)
		|| !Number.isSafeInteger(value.maxCompletionTokens) || value.maxCompletionTokens < 1
		|| !Number.isSafeInteger(value.authorityExpiresAtEpochMs) || value.authorityExpiresAtEpochMs < 1
		|| !Number.isSafeInteger(value.dispatchDeadlineEpochMs) || value.dispatchDeadlineEpochMs < 1 || value.dispatchDeadlineEpochMs > value.authorityExpiresAtEpochMs)
		throw new Error("Conversation computer model reservation is invalid");
	const reservation: ConversationComputerModelReservation = { invocationFence: value.invocationFence, ordinal: 1, compiledInputDigest: value.compiledInputDigest, requestDigest: value.requestDigest, maxCompletionTokens: value.maxCompletionTokens, authorityExpiresAtEpochMs: value.authorityExpiresAtEpochMs, dispatchDeadlineEpochMs: value.dispatchDeadlineEpochMs };
	if (reservation.requestDigest !== _ConversationModelRequestDigest(turn, reservation))
		throw new Error("Conversation computer model reservation has a different request digest");
	const expected = _ConversationModelReservationEvent(turn, reservation);
	if (event.revision !== 1n || event.streamName !== `conversation-computer-turn-${turn.bootstrapId}` || event.id !== expected.id || event.type !== expected.type
		|| ___DigestCanonicalJson(event.data as JsonValue) !== ___DigestCanonicalJson(expected.data)
		|| ___DigestCanonicalJson(event.metadata as JsonValue) !== ___DigestCanonicalJson(expected.metadata))
		throw new Error("Conversation computer model reservation crossed its exact event fence");
	return reservation;
}
