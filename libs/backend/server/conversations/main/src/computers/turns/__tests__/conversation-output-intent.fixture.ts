import { BoundConversationWriter, type BoundConversationWriterAppend, type BoundConversationWriterBinding } from "@opencrane/backend/server/conversations/history";
import { ConversationModelToolModes } from "@opencrane/contracts";

import { _ConversationModelRequestDigest } from "../conversation-computer-model-reservation";
import { _ConversationComputerTurnHistoryDigest } from "../conversation-computer-turn-protocol";
import type { ConversationComputerTurnModelReservation } from "../conversation-computer-turn-protocol.types";
import type { ConversationComputerTurnStore, FrozenConversationComputerTurn } from "../conversation-computer-turn.types";

/** Prepare a real writer intent without permitting the fixture to append history. */
export async function _PrepareBoundDraft(binding: BoundConversationWriterBinding, command: BoundConversationWriterAppend)
{
	const writer = new BoundConversationWriter({} as never, binding, { now: function _Now() { return new Date("2026-09-08T22:00:00.000Z"); } }, { assertMayAppend: async function _Rate() {} }, { assertMayUseVisibility: async function _Visibility() {} }, { assertMayAppend: async function _Fence() {} });
	return writer.prepare(command);
}

/** Build the completed text answer used by the turn store's intent-versus-reservation proofs. */
export function _PrepareConversationOutputIntent(turn: FrozenConversationComputerTurn, sourceCommandId: string, payloadRef = "opaque-payload")
{
	return _PrepareBoundDraft(turn.binding, { sourceCommandId, entry: { kind: "message", state: "completed", blocks: [{ id: "block", kind: "text", payloadRef, ciphertextDigest: "sha256:ciphertext" }], replyToEntryId: turn.latestPendingEntryId, addressedAgentIdentityId: null, activation: "none", visibility: { audience: "conversation" }, causationId: turn.latestPendingEntryId, correlationId: turn.latestPendingEntryId } });
}

/** Represent a model request already dispatched before a storage/restart proof begins. */
export function _ModelReservationFixture(turn: Pick<FrozenConversationComputerTurn, "bootstrapId" | "compile" | "modelAlias" | "budget" | "protocol">, invocationFence: string, tools = ConversationModelToolModes.None): ConversationComputerTurnModelReservation
{
	const deadline = Math.min(turn.budget.wallClockDeadlineEpochMs, turn.protocol.steps.at(-1)?.reservation.authorityExpiresAtEpochMs ?? turn.budget.wallClockDeadlineEpochMs);
	const facts = { ordinal: turn.protocol.steps.length + 1, tools, compiledInputDigest: turn.compile.digest, historyDigest: _ConversationComputerTurnHistoryDigest(turn.protocol.steps), maxCompletionTokens: 100, authorityExpiresAtEpochMs: deadline, dispatchDeadlineEpochMs: deadline };
	return { invocationFence, ...facts, requestDigest: _ConversationModelRequestDigest(turn, facts) };
}

/** Use the real decision owner before testing persistence of a simulated model response. */
export async function _ReserveConversationOutputFixture(store: ConversationComputerTurnStore, bootstrapId: string, invocationFence: string)
{
	const turn = (await store.load(bootstrapId))!;
	await store.reserveModel(bootstrapId, _ModelReservationFixture(turn, invocationFence));
	return (await store.load(bootstrapId))!;
}
