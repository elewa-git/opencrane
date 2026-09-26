import { isDeepStrictEqual } from "node:util";

import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import type { RoutineComputerActivationReceipt, RoutineOccurrenceCommand, RoutineOccurrencePreparationReceipt } from "@opencrane/backend/server/agents/scheduling/contract";
import { _ComputerScopeOf, _LeaseScopeOf, type CurrentConversationComputer } from "@opencrane/backend/server/conversations/computers";
import { ___DigestCanonicalJson } from "@opencrane/util";

import type { ConversationComputerActivationCommand, ConversationComputerActiveLeaseProjectionCommand } from "../computers/activation/conversation-computer-activation.types";
import { _RoutineEventId, _RoutinePreparationReceipt } from "./routine-occurrence-history.mapper";
import type { RoutineOccurrenceHistoryRecord } from "./routine-occurrence-history.types";

/** Rejects a substituted instruction record before it can select a computer or a requester. */
export function _AssertRoutineActivationHistory(command: RoutineOccurrenceCommand, preparation: RoutineOccurrencePreparationReceipt, record: RoutineOccurrenceHistoryRecord | null): asserts record is RoutineOccurrenceHistoryRecord
{
	if (record === null)
		throw new Error("Routine activation requires its prepared occurrence history");
	if (!isDeepStrictEqual(command, _RoutineOccurrenceCommand(record)) || !isDeepStrictEqual(preparation, _RoutinePreparationReceipt(record)))
		throw new Error("Routine activation command or preparation differs from its saved history");
}

/** Recovers the original unadmitted command from immutable instruction evidence. */
export function _RoutineOccurrenceCommand(record: RoutineOccurrenceHistoryRecord): RoutineOccurrenceCommand
{
	return {
		siloId: record.siloId, firingId: record.origin.firingId, routineId: record.origin.routineId,
		routineRevision: record.origin.routineRevision, task: record.task, admittedRunId: null,
		trigger: record.origin.trigger, scheduledSlot: record.origin.scheduledSlot,
		conversationId: record.conversationId, destinationConversationId: record.origin.destinationConversationId,
		selectedManagedServiceId: record.agentServiceId, requesterPrincipalId: record.requesterPrincipalId,
		requesterIssuer: record.requesterIssuer, requesterSubjectId: record.requesterSubjectId,
		requesterAuthenticatedAt: record.requesterAuthenticatedAt, audiencePrincipalIds: record.audiencePrincipalIds,
	};
}

/** Keeps every poll and lost-response retry on the computer's initial generation. */
export function _RoutineActivationCommand(record: RoutineOccurrenceHistoryRecord): ConversationComputerActivationCommand
{
	return { activationEventId: _RoutineEventId("activation", record.conversationId), causationId: _RoutineEventId("instruction", record.conversationId), causationPosition: "1", siloId: record.siloId, computerId: record.computerId, conversationId: record.conversationId, generation: 1 };
}

/** Rejects missing or replaced computer history rather than requesting a replacement generation. */
export function _AssertRoutineActivationComputer(current: CurrentConversationComputer | null): asserts current is CurrentConversationComputer
{
	if (current === null || current.computer.leaseGeneration !== 1 || (current.lease !== null && current.lease.generation !== 1))
		throw new Error("Routine activation computer generation differs from its prepared history");
}

/** Recognises normal lifecycle endings that close this occurrence without allocating another lease. */
export function _RoutineActivationEnded(current: CurrentConversationComputer, nowEpochMs: number): boolean
{
	return current.computer.state === ConversationComputerStates.Retired
		|| current.lease?.state === ComputerLeaseStates.Released || current.lease?.state === ComputerLeaseStates.Lost
		|| (current.lease !== null && Date.parse(current.lease.expiresAt) <= nowEpochMs);
}

/** A saved publication may recover its active history, but may not recreate a missing realization. */
export function _AssertRoutineActivationReplay(receipt: RoutineComputerActivationReceipt, record: RoutineOccurrenceHistoryRecord, preparation: RoutineOccurrencePreparationReceipt, current: CurrentConversationComputer): void
{
	if (current.lease === null)
		throw new Error("Published routine activation has lost its computer lease");
	const publication = { computer: _ComputerScopeOf(current.computer), lease: { ..._LeaseScopeOf(current.lease), expiresAt: current.lease.expiresAt } };
	if (!isDeepStrictEqual(receipt, _RoutineActivationReceipt(record, preparation, current, publication)))
		throw new Error("Published routine activation receipt differs from its computer history");
}

/** Binds the saved receipt to the attested instruction and the exact active realization. */
export function _RoutineActivationReceipt(record: RoutineOccurrenceHistoryRecord, preparation: RoutineOccurrencePreparationReceipt, current: CurrentConversationComputer, publication: ConversationComputerActiveLeaseProjectionCommand): RoutineComputerActivationReceipt
{
	_AssertRoutineActivationComputer(current);
	const lease = current.lease;
	if (current.computer.state !== ConversationComputerStates.Warm || lease?.state !== ComputerLeaseStates.Active || lease.sandboxId === null || lease.serviceFQDN === null)
		throw new Error("Routine activation receipt requires an assigned active computer");
	const expected = { computer: _ComputerScopeOf(current.computer), lease: { ..._LeaseScopeOf(lease), expiresAt: lease.expiresAt } };
	if (!isDeepStrictEqual(publication, expected))
		throw new Error("Routine activation publication differs from active computer history");
	const reference = { schemaVersion: 1, ...expected, profileRevisionId: record.profileRevisionId, sandboxClaimId: lease.sandboxClaimId, sandboxId: lease.sandboxId, serviceFQDN: lease.serviceFQDN };
	const computerReference = JSON.stringify(reference);
	return { receiptId: _RoutineEventId("activation-receipt", record.conversationId), computerReference, digest: ___DigestCanonicalJson({ preparation: { ...preparation }, firingId: record.origin.firingId, computerReference }) };
}
