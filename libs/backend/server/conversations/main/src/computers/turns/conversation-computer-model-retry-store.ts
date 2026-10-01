import { WrongExpectedVersionError } from "@kurrent/kurrentdb-client";
import { randomUUID } from "node:crypto";
import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _ConversationComputerEventId } from "../conversation-computer-event-id";
import { _ConversationModelReservationEvent, _ReadConversationModelReservation } from "./conversation-computer-model-reservation";
import type { ConversationComputerModelPersistence, ConversationComputerModelRejection, ConversationComputerModelRetryClaim } from "./conversation-computer-model-retry.types";
import { _ConversationComputerModelRejectionSchema, _ConversationComputerModelRetryClaimSchema } from "./conversation-computer-model-retry.validator";
import { _ReduceConversationComputerTurnProtocol } from "./conversation-computer-turn-protocol";
import { ConversationComputerTurnProtocolEvents, ConversationComputerTurnProtocolStates } from "./conversation-computer-turn-protocol.types";
import type { ConversationComputerTurnModelReservation, ConversationComputerTurnProtocolEvent } from "./conversation-computer-turn-protocol.types";
import type { FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/** Identifies saved authenticated no-forward evidence in the current turn stream. */
export const _CONVERSATION_MODEL_REJECTED_EVENT = "opencrane.conversation-computer-turn-model-rejected.v1";
/** Identifies a new physical dispatch claim, never a new paid-model reservation. */
export const _CONVERSATION_MODEL_RETRY_CLAIMED_EVENT = "opencrane.conversation-computer-turn-model-retry-claimed.v1";

/**
 * Saves the first model reservation before allowing its one original physical send.
 *
 * Called by: KurrentConversationComputerTurnStore. Observing an existing reservation or losing an
 * append acknowledgement cannot recover permission to send; later attempts need a retry claim.
 */
export async function _ReserveConversationModel(store: ConversationComputerModelPersistence, bootstrapId: string, reservation: ConversationComputerTurnModelReservation): Promise<boolean>
{
	const turn = await store.load(bootstrapId);
	if (turn === null || turn.protocol.state !== ConversationComputerTurnProtocolStates.Open && turn.protocol.state !== ConversationComputerTurnProtocolStates.ResultReady)
		return false;
	const event = _ConversationModelReservationEvent(turn, reservation);
	const checked = _ReadConversationModelReservation(_Candidate(event, turn), turn);
	_ReduceConversationComputerTurnProtocol(turn.protocol, { kind: ConversationComputerTurnProtocolEvents.ModelReserved, reservation: checked }, turn.budget);
	try { await store.history.append({ streamName: _Stream(bootstrapId), expectedRevision: turn.protocol.revision, events: [event] }); }
	catch (error)
	{
		if (!(error instanceof WrongExpectedVersionError))
			throw error;
		return false;
	}
	const winner = await store.load(bootstrapId);
	return winner !== null && winner.protocol.state === ConversationComputerTurnProtocolStates.ModelReserved
		&& winner.protocol.revision === turn.protocol.revision + 1n && _Same(winner.protocol.steps.at(-1)?.reservation, reservation);
}

/** Saves or recovers identical rejection evidence; this method never grants a physical send. */
export async function _RecordConversationModelRejection(store: ConversationComputerModelPersistence, bootstrapId: string, value: ConversationComputerModelRejection): Promise<void>
{
	const rejection = _ConversationComputerModelRejectionSchema.parse(value);
	const turn = await store.load(bootstrapId);
	if (turn === null)
		throw new Error("Conversation computer model rejection requires its frozen turn");
	if (_HasRejection(turn, rejection))
		return;
	const event = _RejectionEvent(turn, rejection);
	const checked = _ReadConversationModelRetryEvent(_Candidate(event, turn), turn);
	_ReduceConversationComputerTurnProtocol(turn.protocol, checked, turn.budget);
	try { await store.history.append({ streamName: _Stream(bootstrapId), expectedRevision: turn.protocol.revision, events: [event] }); }
	catch (error)
	{
		const recovered = await store.load(bootstrapId);
		if (recovered !== null && _HasRejection(recovered, rejection))
			return;
		throw error;
	}
	const winner = await store.load(bootstrapId);
	if (winner === null || !_HasRejection(winner, rejection))
		throw new Error("Conversation computer model rejection differs from its stored evidence");
}

/**
 * Returns true only for this call's acknowledged append and still-current exact claim.
 *
 * Called by: KurrentConversationComputerTurnStore. A compare-and-set loser returns false even if
 * the winner has identical fields: each call creates its own append identity so Kurrent's event
 * idempotency cannot acknowledge a different claimant's write. A lost acknowledgement fails without readback:
 * recovering evidence or observing another worker's nonce must never redispatch a paid response.
 */
export async function _ClaimPersistedConversationModelRetry(store: ConversationComputerModelPersistence, bootstrapId: string, value: ConversationComputerModelRetryClaim): Promise<boolean>
{
	const claim = _ConversationComputerModelRetryClaimSchema.parse(value);
	const turn = await store.load(bootstrapId);
	if (turn === null || turn.protocol.state !== ConversationComputerTurnProtocolStates.ModelRetryWaiting)
		return false;
	const event = _ClaimEvent(turn, claim, randomUUID());
	const checked = _ReadConversationModelRetryEvent(_Candidate(event, turn), turn);
	_ReduceConversationComputerTurnProtocol(turn.protocol, checked, turn.budget);
	try { await store.history.append({ streamName: _Stream(bootstrapId), expectedRevision: turn.protocol.revision, events: [event] }); }
	catch (error)
	{
		if (!(error instanceof WrongExpectedVersionError))
			throw error;
		return false;
	}
	const winner = await store.load(bootstrapId);
	const current = winner !== null && winner.protocol.state === ConversationComputerTurnProtocolStates.ModelReserved
		&& winner.protocol.revision === turn.protocol.revision + 1n && _Same(winner.protocol.modelRetry?.claim, claim)
		&& _Same(winner.protocol.steps.at(-1)?.reservation, turn.protocol.steps.at(-1)?.reservation);
	if (!current)
		return false;
	let ownEvent = false;
	for await (const recorded of store.history.readStream({ streamName: _Stream(bootstrapId), fromRevision: turn.protocol.revision + 1n, maxCount: 2 }))
	{
		if (recorded.revision !== turn.protocol.revision + 1n || recorded.id !== event.id || !_Same(recorded.metadata, event.metadata) || !_Same(recorded.data, event.data) || recorded.type !== event.type)
			return false;
		ownEvent = true;
	}
	return ownEvent;
}

/** Validates exact event bytes, lease coordinates and revision before protocol replay. */
export function _ReadConversationModelRetryEvent(event: HistoryRecordedEvent, turn: FrozenConversationComputerTurn): ConversationComputerTurnProtocolEvent
{
	let result: ConversationComputerTurnProtocolEvent;
	let expected;
	if (event.type === _CONVERSATION_MODEL_REJECTED_EVENT)
	{
		const rejection = _ConversationComputerModelRejectionSchema.parse(event.data["rejection"]);
		result = { kind: ConversationComputerTurnProtocolEvents.ModelRejected, rejection };
		expected = _RejectionEvent(turn, rejection);
	}
	else if (event.type === _CONVERSATION_MODEL_RETRY_CLAIMED_EVENT)
	{
		const claim = _ConversationComputerModelRetryClaimSchema.parse(event.data["claim"]);
		result = { kind: ConversationComputerTurnProtocolEvents.ModelRetryClaimed, claim };
		const appendAttemptId = event.metadata["appendAttemptId"];
		if (typeof appendAttemptId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(appendAttemptId))
			throw new Error("Conversation computer model retry lacks its fresh append identity");
		expected = _ClaimEvent(turn, claim, appendAttemptId);
	}
	else throw new Error("Conversation computer retry history contains an unknown event");
	if (event.revision !== turn.protocol.revision + 1n || event.streamName !== _Stream(turn.bootstrapId) || event.id !== expected.id
		|| !_Same(event.data, expected.data) || !_Same(event.metadata, expected.metadata))
		throw new Error("Conversation computer model retry crossed its exact event fence");
	return result;
}

/** Uses the physical nonce to distinguish rejected sends within one unchanged turn. */
function _RejectionEvent(turn: FrozenConversationComputerTurn, rejection: ConversationComputerModelRejection)
{
	return { id: _ConversationComputerEventId(`model-rejection-${rejection.receipt.physicalNonce}`, turn.bootstrapId), type: _CONVERSATION_MODEL_REJECTED_EVENT, data: { bootstrapId: turn.bootstrapId, rejection }, metadata: _Metadata(turn) };
}

/** Separates one persistence call from another even when their physical claim payloads match. */
function _ClaimEvent(turn: FrozenConversationComputerTurn, claim: ConversationComputerModelRetryClaim, appendAttemptId: string)
{
	return { id: _ConversationComputerEventId(`model-retry-${claim.physicalNonce}`, appendAttemptId), type: _CONVERSATION_MODEL_RETRY_CLAIMED_EVENT, data: { bootstrapId: turn.bootstrapId, claim }, metadata: { ..._Metadata(turn), appendAttemptId } };
}

/** Matches saved evidence only within the current reservation retained by the projection. */
function _HasRejection(turn: FrozenConversationComputerTurn, rejection: ConversationComputerModelRejection): boolean
{
	return turn.protocol.modelRetry?.rejections.some(saved => _Same(saved, rejection)) ?? false;
}

/** Prepares the same event envelope the replay path validates after persistence. */
function _Candidate(event: { readonly id: string; readonly type: string; readonly data: Record<string, unknown>; readonly metadata: Record<string, unknown> }, turn: FrozenConversationComputerTurn): HistoryRecordedEvent
{
	return { ...event, streamName: _Stream(turn.bootstrapId), revision: turn.protocol.revision + 1n, recordedAt: new Date() } as HistoryRecordedEvent;
}

/** Compares non-secret stored coordinates with the repository's canonical JSON encoding. */
function _Same(left: unknown, right: unknown): boolean
{
	return left === undefined || right === undefined ? left === right : ___DigestCanonicalJson(left as JsonValue) === ___DigestCanonicalJson(right as JsonValue);
}

/** Keeps retry evidence in the existing bootstrap-specific turn stream. */
function _Stream(bootstrapId: string): string
{
	return `conversation-computer-turn-${bootstrapId}`;
}

/** Requires every retry event to preserve the frozen silo, computer and lease fence. */
function _Metadata(turn: FrozenConversationComputerTurn): Record<string, unknown>
{
	return { siloId: turn.siloId, computerId: turn.computerId, leaseId: turn.lease.leaseId, generation: String(turn.lease.leaseGeneration), bootstrapId: turn.bootstrapId };
}
