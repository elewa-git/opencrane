import { z } from "zod";
import { ConversationModelToolModes } from "@opencrane/contracts";
import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _ConversationComputerEventId } from "../conversation-computer-event-id";
import type { ConversationComputerTurnModelReservation } from "./conversation-computer-turn-protocol.types";
import type { FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/** Identifies the fresh-install ordered model-reservation event. */
export const _CONVERSATION_MODEL_RESERVED_EVENT = "opencrane.conversation-computer-turn-model-reserved.v2";

const _Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const _Fence = z.string().uuid();
const _Count = z.number().int().positive().safe();
const _ReservationSchema: z.ZodType<ConversationComputerTurnModelReservation> = z.object({
	ordinal: _Count,
	invocationFence: _Fence,
	tools: z.nativeEnum(ConversationModelToolModes),
	compiledInputDigest: _Digest,
	historyDigest: _Digest,
	requestDigest: _Digest,
	maxCompletionTokens: _Count,
	authorityExpiresAtEpochMs: _Count,
	dispatchDeadlineEpochMs: _Count,
}).strict();

/** Builds non-secret reservation evidence under the turn's complete lease coordinates. */
export function _ConversationModelReservationEvent(turn: FrozenConversationComputerTurn, reservation: ConversationComputerTurnModelReservation)
{
	return {
		id: _ConversationComputerEventId(`model-reservation-${reservation.ordinal}`, reservation.invocationFence),
		type: _CONVERSATION_MODEL_RESERVED_EVENT,
		data: { bootstrapId: turn.bootstrapId, reservation: { ...reservation } },
		metadata: _Metadata(turn),
	};
}

/** Binds the immutable turn, aggregate allowance and ordered private history into one request identity. */
export function _ConversationModelRequestDigest(turn: Pick<FrozenConversationComputerTurn, "bootstrapId" | "compile" | "modelAlias" | "budget">, reservation: Omit<ConversationComputerTurnModelReservation, "invocationFence" | "requestDigest">): string
{
	return ___DigestCanonicalJson({ bootstrapId: turn.bootstrapId, runId: turn.compile.runId, attempt: turn.compile.attempt, modelAlias: turn.modelAlias, budget: turn.budget, ...reservation } as unknown as JsonValue);
}

/**
 * Checks one ordered model reservation without granting permission to dispatch it.
 *
 * Called by: KurrentConversationComputerTurnStore during replay and before append.
 *
 * @param event Recorded event or locally prepared candidate at its proposed revision.
 * @param turn Frozen turn and projection immediately before this event.
 * @returns The exact validated reservation.
 * @throws Error when its shape, request digest, stream revision, identity or metadata differs.
 */
export function _ReadConversationModelReservation(event: HistoryRecordedEvent, turn: FrozenConversationComputerTurn): ConversationComputerTurnModelReservation
{
	const parsed = _ReservationSchema.safeParse(event.data["reservation"]);
	if (!parsed.success)
		throw new Error("Conversation computer model reservation is invalid");
	const reservation = parsed.data;
	if (reservation.compiledInputDigest !== turn.compile.digest || reservation.dispatchDeadlineEpochMs > reservation.authorityExpiresAtEpochMs
		|| reservation.requestDigest !== _ConversationModelRequestDigest(turn, _WithoutIdentity(reservation)))
		throw new Error("Conversation computer model reservation crossed its frozen limits");
	const expected = _ConversationModelReservationEvent(turn, reservation);
	if (event.revision !== turn.protocol.revision + 1n || event.streamName !== _Stream(turn.bootstrapId) || event.id !== expected.id || event.type !== expected.type
		|| ___DigestCanonicalJson(event.data as JsonValue) !== ___DigestCanonicalJson(expected.data as unknown as JsonValue)
		|| ___DigestCanonicalJson(event.metadata as JsonValue) !== ___DigestCanonicalJson(expected.metadata as unknown as JsonValue))
		throw new Error("Conversation computer model reservation crossed its exact event fence");
	return reservation;
}

function _WithoutIdentity(reservation: ConversationComputerTurnModelReservation): Omit<ConversationComputerTurnModelReservation, "invocationFence" | "requestDigest">
{
	const { invocationFence: _fence, requestDigest: _digest, ...facts } = reservation;
	return facts;
}

function _Metadata(turn: FrozenConversationComputerTurn): Record<string, unknown>
{
	return { siloId: turn.siloId, computerId: turn.computerId, leaseId: turn.lease.leaseId, generation: String(turn.lease.leaseGeneration), bootstrapId: turn.bootstrapId };
}

function _Stream(bootstrapId: string): string
{
	return `conversation-computer-turn-${bootstrapId}`;
}
