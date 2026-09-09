import { _ConversationModelRequestDigest } from "../conversation-computer-model-reservation";
import type { ConversationComputerModelReservation } from "../conversation-computer-model.types";
import type { ConversationComputerTurnStore } from "../conversation-computer-turn.types";
import { BoundConversationWriter } from "../bound-conversation-writer";
import type { BoundConversationWriterAppend, BoundConversationWriterBinding } from "../bound-conversation-writer.types";
import type { FrozenConversationComputerTurn } from "../conversation-computer-turn.types";

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
export function _ModelReservationFixture(turn: Pick<FrozenConversationComputerTurn, "bootstrapId" | "compile" | "modelAlias">, invocationFence: string): ConversationComputerModelReservation
{
	const facts = { ordinal: 1 as const, compiledInputDigest: turn.compile.digest, maxCompletionTokens: 100, authorityExpiresAtEpochMs: Date.parse("2099-01-01T00:00:00Z"), dispatchDeadlineEpochMs: Date.parse("2099-01-01T00:00:00Z") };
	return { invocationFence, ...facts, requestDigest: _ConversationModelRequestDigest(turn, facts) };
}

/** Use the real decision owner before testing persistence of a simulated model response. */
export async function _ReserveConversationOutputFixture(store: ConversationComputerTurnStore, bootstrapId: string, invocationFence: string)
{
	const turn = (await store.load(bootstrapId))!;
	await store.reserveModel(bootstrapId, _ModelReservationFixture(turn, invocationFence));
	return (await store.load(bootstrapId))!;
}
