import { ConversationGenesisOriginKinds } from "@opencrane/models/conversations";
import type { PrepareRoutineOccurrenceCommand } from "@opencrane/backend/server/agents/scheduling/contract";
import type { ConversationPrivatePayloadCoordinates } from "@opencrane/backend/server/conversations/history";

import type { StoredConversationPrivatePayload } from "../messages/db/prisma-conversation-history-repository.types";
import { _DeterministicUuid } from "../sessions/agent-session-identifiers";
import { _RoutineEventId } from "./routine-occurrence-history.mapper";
import type { RoutineOccurrenceHistoryRecord } from "./routine-occurrence-history.types";

/** Uses the same service author for encryption, stored payload and immutable history. */
export function _RoutineInstructionCoordinates(siloId: string, conversationId: string): ConversationPrivatePayloadCoordinates
{
	return { siloId, conversationId, authorSubject: "opencrane", payloadRef: _RoutineEventId("payload", conversationId) };
}

/** Derives a computer identity from the already reserved occurrence, not from a retry allocation. */
export function _RoutineComputerId(conversationId: string): string
{
	return `computer-${_DeterministicUuid("routine-occurrence-computer", conversationId)}`;
}

/** Combines saved database coordinates with frozen routine facts without exposing instruction text. */
export function _RoutinePreparedRecord(command: PrepareRoutineOccurrenceCommand, computer: { readonly computerId: string; readonly agentIdentityId: string; readonly profileRevisionId: string; readonly createdAt: Date }, payload: StoredConversationPrivatePayload): RoutineOccurrenceHistoryRecord
{
	return {
		siloId: command.siloId, conversationId: command.conversationId,
		origin: { kind: ConversationGenesisOriginKinds.RoutineOccurrence, routineId: command.routineId, routineRevision: command.routineRevision, firingId: command.firingId, destinationConversationId: command.destinationConversationId, trigger: command.trigger, scheduledSlot: command.scheduledSlot },
		agentServiceId: command.selectedManagedServiceId,
		requesterPrincipalId: command.requesterPrincipalId, requesterIssuer: command.requesterIssuer,
		requesterSubjectId: command.requesterSubjectId, requesterAuthenticatedAt: command.requesterAuthenticatedAt,
		task: command.task, audiencePrincipalIds: command.audiencePrincipalIds,
		computerId: computer.computerId, agentIdentityId: computer.agentIdentityId,
		profileRevisionId: computer.profileRevisionId, createdAt: computer.createdAt.toISOString(),
		payloadRef: payload.coordinates.payloadRef, ciphertextDigest: payload.ciphertextDigest as `sha256:${string}`,
	};
}
