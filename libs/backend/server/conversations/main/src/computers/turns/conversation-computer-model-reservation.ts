import { ConversationModelToolModes } from "@opencrane/contracts";
import type { ConversationComputerContinuationReservation } from "./conversation-computer-continuation.types";
import { _ConversationContinuationReservationSchema, _ConversationModelReservationSchema } from "./conversation-computer-continuation.validator";
import { createHash } from "node:crypto";
import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { ConversationComputerModelReservation } from "./conversation-computer-model.types";
import type { FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/** Identifies the persisted v1 reservation format; changing its shape requires a new event version. */
export const _CONVERSATION_MODEL_RESERVED_EVENT = "opencrane.conversation-computer-turn-model-reserved.v1";

/** Build only non-secret reservation evidence under the turn's complete lease coordinates. */
export function _ConversationModelReservationEvent(turn: FrozenConversationComputerTurn, reservation: ConversationComputerModelReservation | ConversationComputerContinuationReservation)
{
	const hex = createHash("sha256").update(`model-reservation:${reservation.invocationFence}`).digest("hex").slice(0, 32).split("");
	hex[12] = "4";
	hex[16] = "8";
	const id = `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
	return { id, type: _CONVERSATION_MODEL_RESERVED_EVENT, data: { bootstrapId: turn.bootstrapId, reservation: { ...reservation } }, metadata: { siloId: turn.siloId, computerId: turn.computerId, leaseId: turn.lease.leaseId, generation: String(turn.lease.leaseGeneration), bootstrapId: turn.bootstrapId } };
}

/** Bind the immutable compiled input, model, ordinal and absolute limits into one request identity. */
export function _ConversationModelRequestDigest(turn: Pick<FrozenConversationComputerTurn, "bootstrapId" | "compile" | "modelAlias">, reservation: Omit<ConversationComputerModelReservation, "invocationFence" | "requestDigest"> | Omit<ConversationComputerContinuationReservation, "invocationFence" | "requestDigest">): string
{
	const continuationEvidence = reservation.ordinal === 2
		? { continuation: reservation.continuation, proposalId: reservation.proposalId, resultDigest: reservation.resultDigest }
		: { continuation: null, proposalId: null, resultDigest: null };
	return ___DigestCanonicalJson({ bootstrapId: turn.bootstrapId, runId: turn.compile.runId, attempt: turn.compile.attempt, compiledInputDigest: turn.compile.digest, modelAlias: turn.modelAlias, ordinal: reservation.ordinal, tools: reservation.tools, ...continuationEvidence, maxCompletionTokens: reservation.maxCompletionTokens, authorityExpiresAtEpochMs: reservation.authorityExpiresAtEpochMs, dispatchDeadlineEpochMs: reservation.dispatchDeadlineEpochMs } as unknown as JsonValue);
}

/**
 * Checks the saved fields, request digest and complete revision-1 event against the frozen turn.
 * Reading a valid fence proves what was recorded, not that this caller may dispatch.
 * @throws Error when fields, stream coordinates, event identity or digests differ.
 * Called by: KurrentConversationComputerTurnStore.load and KurrentConversationComputerTurnStore.reserveModel.
 */
export function _ReadConversationModelReservation(event: HistoryRecordedEvent, turn: FrozenConversationComputerTurn): ConversationComputerModelReservation
{
	const parsed = _ConversationModelReservationSchema.safeParse(event.data["reservation"]);
	if (!parsed.success)
		throw new Error("Conversation computer model reservation is invalid");
	const reservation = parsed.data;
	return _ReadReservation(event, turn, reservation, 1n);
}

/**
 * Checks revision 3 against the original request and selected tool, without granting dispatch.
 * The final request needs a different fence and cannot extend the first request's authority window.
 * @throws Error when the saved event or its original decision coordinates differ.
 */
export function _ReadConversationContinuationReservation(event: HistoryRecordedEvent, turn: FrozenConversationComputerTurn): ConversationComputerContinuationReservation
{
	const parsed = _ConversationContinuationReservationSchema.safeParse(event.data["reservation"]);
	if (!parsed.success)
		throw new Error("Conversation computer continuation reservation is invalid");
	const reservation = parsed.data;
	if (turn.modelReservation === null || turn.modelReservation.tools !== ConversationModelToolModes.Select || reservation.invocationFence === turn.modelReservation.invocationFence || turn.toolSelection === null || reservation.proposalId !== turn.toolSelection.proposalId || reservation.authorityExpiresAtEpochMs > turn.modelReservation.authorityExpiresAtEpochMs)
		throw new Error("Conversation computer continuation crossed its original model or tool decision");
	return _ReadReservation(event, turn, reservation, 3n);
}

/** Validates complete event identity and frozen request limits after typed shape validation. */
function _ReadReservation<T extends ConversationComputerModelReservation | ConversationComputerContinuationReservation>(event: HistoryRecordedEvent, turn: FrozenConversationComputerTurn, reservation: T, revision: bigint): T
{
	if (reservation.compiledInputDigest !== turn.compile.digest || reservation.dispatchDeadlineEpochMs > reservation.authorityExpiresAtEpochMs)
		throw new Error("Conversation computer model reservation crossed its frozen limits");
	if (reservation.requestDigest !== _ConversationModelRequestDigest(turn, reservation))
		throw new Error("Conversation computer model reservation has a different request digest");
	const expected = _ConversationModelReservationEvent(turn, reservation);
	if (event.revision !== revision || event.streamName !== `conversation-computer-turn-${turn.bootstrapId}` || event.id !== expected.id || event.type !== expected.type
		|| ___DigestCanonicalJson(event.data as JsonValue) !== ___DigestCanonicalJson(expected.data as unknown as JsonValue)
		|| ___DigestCanonicalJson(event.metadata as JsonValue) !== ___DigestCanonicalJson(expected.metadata))
		throw new Error("Conversation computer model reservation crossed its exact event fence");
	return reservation;
}
