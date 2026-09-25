import { ConversationAuthorKinds, ConversationComputerStates, ConversationEntryAudiences, ConversationEntryKinds, ConversationEntryProvenance, ConversationMessageActivations, ConversationMessageContentBlockKinds, MessageStates, type ConversationComputer, type MessageEntry } from "@opencrane/contracts";
import { ConversationHistoryModes, type ConversationHistoryGenesis } from "@opencrane/backend/server/conversations/history";
import type { HistoryEvent } from "@opencrane/backend/server/infra/history-store";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { _DeterministicUuid } from "../sessions/agent-session-identifiers";
import type { RoutineOccurrenceHistoryRecord } from "./routine-occurrence-history.types";

/** Names the immutable private record that proves which routine instruction was published. */
export const _ROUTINE_INSTRUCTION_EVENT = "opencrane.routine-occurrence-instruction.v1";

/** Derives the receipt stream from the globally unique reserved occurrence conversation. */
export function _RoutineInstructionStream(conversationId: string): string { return `routine-occurrence-instruction-${conversationId}`; }

/** Gives every occurrence write a stable, purpose-separated event identifier. */
export function _RoutineEventId(purpose: string, conversationId: string): string { return _DeterministicUuid(`routine-occurrence-${purpose}`, conversationId); }

/** Builds the content-free immutable ownership event without borrowing a human session. */
export function _RoutineGenesis(record: RoutineOccurrenceHistoryRecord): ConversationHistoryGenesis
{
	return { schemaVersion: 1, siloId: record.siloId, conversationId: record.conversationId, mode: ConversationHistoryModes.AgentSession, agentServiceId: record.agentServiceId, createdByPrincipalId: record.requesterPrincipalId, createdAt: record.createdAt, origin: record.origin };
}

/** Establishes a cold computer; activation and root-run admission are separate later steps. */
export function _RoutineColdComputer(record: RoutineOccurrenceHistoryRecord): ConversationComputer
{
	return { schemaVersion: 1, id: record.computerId, siloId: record.siloId, conversationId: record.conversationId, agentIdentityId: record.agentIdentityId, profileRevisionId: record.profileRevisionId, state: ConversationComputerStates.Cold, leaseGeneration: 1, workspaceCheckpoint: null, createdAt: record.createdAt, updatedAt: record.createdAt };
}

/** Publishes the encrypted instruction reference without creating a human message or activation. */
export function _RoutineInstructionEntry(record: RoutineOccurrenceHistoryRecord): MessageEntry
{
	const id = _RoutineEventId("instruction", record.conversationId);
	return {
		schemaVersion: 1, id, conversationId: record.conversationId, position: "1",
		author: { kind: ConversationAuthorKinds.Service, serviceId: "opencrane", name: "OpenCrane" },
		provenance: ConversationEntryProvenance.ServiceAttested, visibility: { audience: ConversationEntryAudiences.Conversation },
		runId: null, causationId: record.origin.firingId, correlationId: record.origin.firingId, idempotencyKey: id, occurredAt: record.createdAt,
		attestation: { serviceId: "opencrane", receiptId: _RoutineEventId("receipt", record.conversationId), domainStream: _RoutineInstructionStream(record.conversationId), domainRevision: "0", decisionEvidenceId: null },
		kind: ConversationEntryKinds.Message, state: MessageStates.Completed,
		blocks: [{ id: _RoutineEventId("instruction-block", record.conversationId), kind: ConversationMessageContentBlockKinds.Text, payloadRef: record.payloadRef, ciphertextDigest: record.ciphertextDigest }],
		replyToEntryId: null, addressedAgentIdentityId: record.agentIdentityId, activation: ConversationMessageActivations.None,
	};
}

/** Builds the exact receipt envelope that recovery compares with stored history. */
export function _RoutineInstructionReceiptEvent(record: RoutineOccurrenceHistoryRecord): HistoryEvent
{
	return { id: _RoutineEventId("receipt", record.conversationId), type: _ROUTINE_INSTRUCTION_EVENT, data: { record }, metadata: { siloId: record.siloId, conversationId: record.conversationId, firingId: record.origin.firingId } };
}

/** Binds the preparation result to all immutable coordinates and the encrypted payload digest. */
export function _RoutineHistoryDigest(record: RoutineOccurrenceHistoryRecord): `sha256:${string}`
{
	return ___DigestCanonicalJson({ ...record, origin: { ...record.origin }, task: { ...record.task }, audiencePrincipalIds: [...record.audiencePrincipalIds] });
}
