import { ComputerLeaseStates, ConversationComputerStates, type ComputerLease, type ComputerLeaseRuntimePod, type ConversationComputer, type ConversationComputerExecution } from "@opencrane/contracts";
import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";

import type { ConversationComputerActivationCurrentCommand, ConversationComputerCurrentCommand, ConversationComputerHistorySnapshot, ConversationComputerRuntimeCurrentCommand } from "./conversation-computer-history.types";

/** Names the one versioned event schema this history authority accepts. */
const _CONVERSATION_COMPUTER_EVENT_TYPE = "opencrane.conversation-computer.v1";
/** Names the immutable cold lifecycle anchor required at revision zero. */
const _COMPUTER_PROVISIONED_EVENT_TYPE = "opencrane.computer-provisioned.v1";
/** Recognizes the UUID event identifiers that HistoryStore uses for idempotent appends. */
const _UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Derives the one stream that may represent a computer without accepting a caller-selected stream. */
export function _ConversationComputerStreamName(computerId: string): string
{
	if (!_Identifier(computerId))
		throw new Error("Conversation computer history requires a server-provided computer identifier");
	return `computer-${computerId}`;
}

/** Validates trusted coordinates before they can select a durable computer history stream. */
export function _ValidateConversationComputerCurrentCommand(command: ConversationComputerCurrentCommand): void
{
	if (!_Identifier(command.siloId))
		throw new Error("Conversation computer history load requires a server-provided silo identifier");
	if (!_Identifier(command.computerId))
		throw new Error("Conversation computer history load requires a server-provided computer identifier");
	if (!_Identifier(command.conversationId))
		throw new Error("Conversation computer history load requires a server-provided conversation identifier");
	if (!_Identifier(command.agentIdentityId))
		throw new Error("Conversation computer history load requires a server-provided agent identity identifier");
	if (!_Identifier(command.profileRevisionId))
		throw new Error("Conversation computer history load requires a server-provided profile revision identifier");
}

/** Validates computer coordinates without allowing a runtime command to select an AgentIdentity. */
export function _ValidateConversationComputerRuntimeCurrentCommand(command: ConversationComputerRuntimeCurrentCommand): void
{
	if (!_Identifier(command.siloId) || !_Identifier(command.computerId) || !_Identifier(command.conversationId) || !_Identifier(command.profileRevisionId))
		throw new Error("Conversation computer runtime load requires server-provided computer coordinates");
}

/**
 * Validates the small bootstrap command before history derives the bound conversation and profile.
 *
 * A Sandbox may name a computer but cannot add identity or profile coordinates. Rejecting malformed
 * coordinates here prevents it from reaching a different deterministic stream by accident.
 */
export function _ValidateConversationComputerBootstrapCommand(command: { readonly siloId: string; readonly computerId: string; readonly nowEpochMilliseconds: number }): void
{
	if (!_Identifier(command.siloId) || !_Identifier(command.computerId) || !Number.isSafeInteger(command.nowEpochMilliseconds))
		throw new Error("Conversation computer bootstrap requires valid server-owned runtime coordinates");
}

/** Validates activation coordinates without allowing an event to choose identity or profile. */
export function _ValidateConversationComputerActivationCurrentCommand(command: ConversationComputerActivationCurrentCommand): void
{
	if (!_Identifier(command.siloId) || !_Identifier(command.computerId) || !_Identifier(command.conversationId))
		throw new Error("Conversation computer activation load requires server-provided computer coordinates");
}

/** Validates one envelope and closed snapshot before it can contribute to current computer state. */
export function _ValidatedConversationComputerEvent(event: HistoryRecordedEvent, command: ConversationComputerCurrentCommand, streamName: string, expectedRevision: bigint): ConversationComputerHistorySnapshot
{
	if (event.streamName !== streamName)
		throw new Error("Conversation computer history received an event from a different stream");
	if (event.revision !== expectedRevision)
		throw new Error("Conversation computer history received a noncontiguous stream revision");
	const snapshot = expectedRevision === 0n ? _ValidatedConversationComputerProvisionedEvent(event, streamName) : _ValidatedConversationComputerSnapshotEvent(event, streamName);
	if (snapshot.computer.siloId !== command.siloId)
		throw new Error("Conversation computer history received a computer from a different silo");
	if (snapshot.computer.id !== command.computerId)
		throw new Error("Conversation computer history received a different computer");
	if (snapshot.computer.conversationId !== command.conversationId)
		throw new Error("Conversation computer history received a computer for a different conversation");
	if (snapshot.computer.agentIdentityId !== command.agentIdentityId)
		throw new Error("Conversation computer history received a computer for a different agent identity");
	if (snapshot.computer.profileRevisionId !== command.profileRevisionId)
		throw new Error("Conversation computer history received a computer for a different profile revision");
	return snapshot;
}

/** Validates a cold revision-zero computer anchor before any claim or execution snapshot may follow. */
export function _ValidatedConversationComputerProvisionedEvent(event: HistoryRecordedEvent, streamName: string): ConversationComputerHistorySnapshot
{
	if (event.streamName !== streamName || event.revision !== 0n)
		throw new Error("Conversation computer history received a provision event from a different stream or revision");
	if (event.type !== _COMPUTER_PROVISIONED_EVENT_TYPE)
		throw new Error("Conversation computer history requires a computer provision event at revision zero");
	const snapshot = _ValidatedComputerEnvelope(event);
	if (snapshot.computer.state !== ConversationComputerStates.Cold || snapshot.computer.leaseGeneration !== 0 || snapshot.computer.workspaceCheckpoint !== null || snapshot.computer.activeExecution !== null || snapshot.lease !== null || snapshot.computer.updatedAt !== snapshot.computer.createdAt)
		throw new Error("Conversation computer history requires a cold zero-generation computer provision");
	return snapshot;
}

/** Validates one non-initial state snapshot after a computer provision event has anchored its stream. */
function _ValidatedConversationComputerSnapshotEvent(event: HistoryRecordedEvent, streamName: string): ConversationComputerHistorySnapshot
{
	if (event.streamName !== streamName)
		throw new Error("Conversation computer history received an event from a different stream");
	if (event.type !== _CONVERSATION_COMPUTER_EVENT_TYPE)
		throw new Error("Conversation computer history received an unsupported event type");
	return _ValidatedComputerEnvelope(event);
}

/** Verifies an exact computer snapshot and metadata before lifecycle-specific validation runs. */
function _ValidatedComputerEnvelope(event: HistoryRecordedEvent): ConversationComputerHistorySnapshot
{
	if (!_UUID_PATTERN.test(event.id))
		throw new Error("Conversation computer history received an event with an invalid identifier");
	const snapshot = _ValidatedConversationComputerSnapshot(event.data);
	if (event.metadata.siloId !== snapshot.computer.siloId || event.metadata.computerId !== snapshot.computer.id || event.metadata.conversationId !== snapshot.computer.conversationId || event.metadata.agentIdentityId !== snapshot.computer.agentIdentityId || event.metadata.profileRevisionId !== snapshot.computer.profileRevisionId || event.metadata.leaseId !== (snapshot.lease?.id ?? null) || event.metadata.leaseGeneration !== (snapshot.lease?.generation ?? null) || event.metadata.leaseState !== (snapshot.lease?.state ?? null) || event.metadata.runtimePodNamespace !== (snapshot.lease?.runtimePod?.namespace ?? null) || event.metadata.runtimePodServiceAccountName !== (snapshot.lease?.runtimePod?.serviceAccountName ?? null) || event.metadata.runtimePodUid !== (snapshot.lease?.runtimePod?.podUid ?? null) || event.metadata.executionId !== (snapshot.computer.activeExecution?.id ?? null) || event.metadata.executionLeaseId !== (snapshot.computer.activeExecution?.leaseId ?? null) || event.metadata.executionLeaseGeneration !== (snapshot.computer.activeExecution?.leaseGeneration ?? null) || event.metadata.executionEndedAt !== (snapshot.computer.activeExecution?.endedAt ?? null))
		throw new Error("Conversation computer history received an event that does not match its envelope");
	return snapshot;
}

/** Checks runtime-safe computer coordinates after the identity has been derived from the event. */
export function _AssertConversationComputerRuntimeCoordinates(snapshot: ConversationComputerHistorySnapshot, command: ConversationComputerRuntimeCurrentCommand): void
{
	if (snapshot.computer.siloId !== command.siloId || snapshot.computer.id !== command.computerId || snapshot.computer.conversationId !== command.conversationId || snapshot.computer.profileRevisionId !== command.profileRevisionId)
		throw new Error("Conversation computer runtime load received foreign computer coordinates");
}

/** Parses the exact closed computer-and-lease event data without accepting future fields as authority. */
export function _ValidatedConversationComputerSnapshot(value: unknown): ConversationComputerHistorySnapshot
{
	if (!_Record(value) || !_ExactKeys(value, ["computer", "lease"]))
		throw new Error("Conversation computer history requires a complete computer snapshot");
	const computer = _ValidatedConversationComputer(value.computer);
	const lease = value.lease === null ? null : _ValidatedComputerLease(value.lease);
	_ValidateCurrentLease(computer, lease);
	return { computer, lease };
}

/** Parses the exact closed ConversationComputer contract at a history boundary. */
export function _ValidatedConversationComputer(value: unknown): ConversationComputer
{
	if (!_Record(value) || !_ExactKeys(value, ["schemaVersion", "id", "siloId", "conversationId", "agentIdentityId", "profileRevisionId", "state", "leaseGeneration", "workspaceCheckpoint", "activeExecution", "createdAt", "updatedAt"]))
		throw new Error("Conversation computer history requires a valid computer snapshot");
	if (value.schemaVersion !== 1 || !_Identifier(value.id) || !_Identifier(value.siloId) || !_Identifier(value.conversationId) || !_Identifier(value.agentIdentityId) || !_Identifier(value.profileRevisionId) || !_ComputerState(value.state) || !_NonnegativeInteger(value.leaseGeneration) || !_IsoTimestamp(value.createdAt) || !_IsoTimestamp(value.updatedAt))
		throw new Error("Conversation computer history requires valid computer coordinates");
	if (Date.parse(value.updatedAt) < Date.parse(value.createdAt))
		throw new Error("Conversation computer history requires a computer update after its creation");
	if (value.workspaceCheckpoint !== null)
		_ValidatedWorkspaceCheckpoint(value.workspaceCheckpoint);
	if (value.activeExecution !== null)
		_ValidatedConversationComputerExecution(value.activeExecution);
	return value as unknown as ConversationComputer;
}

/** Parses the exact fenced execution record retained by one computer snapshot. */
function _ValidatedConversationComputerExecution(value: unknown): ConversationComputerExecution
{
	if (!_Record(value) || !_ExactKeys(value, ["id", "leaseId", "leaseGeneration", "startedAt", "endedAt"]))
		throw new Error("Conversation computer history requires a valid active execution");
	if (!_Identifier(value.id) || !_Identifier(value.leaseId) || !_PositiveInteger(value.leaseGeneration) || !_IsoTimestamp(value.startedAt) || (value.endedAt !== null && !_IsoTimestamp(value.endedAt)))
		throw new Error("Conversation computer history requires valid active execution coordinates");
	if (value.endedAt !== null && Date.parse(value.endedAt) < Date.parse(value.startedAt))
		throw new Error("Conversation computer history requires an execution end after its start");
	return value as unknown as ConversationComputerExecution;
}

/** Parses the exact closed ComputerLease contract at a history boundary. */
export function _ValidatedComputerLease(value: unknown): ComputerLease
{
	if (!_Record(value) || !_ExactKeys(value, ["schemaVersion", "id", "computerId", "generation", "sandboxClaimId", "sandboxId", "runtimePod", "state", "claimedAt", "expiresAt", "releasedAt"]))
		throw new Error("Conversation computer history requires a valid lease snapshot");
	if (value.schemaVersion !== 1 || !_Identifier(value.id) || !_Identifier(value.computerId) || !_PositiveInteger(value.generation) || !_Identifier(value.sandboxClaimId) || (value.sandboxId !== null && !_Identifier(value.sandboxId)) || (value.runtimePod !== null && !_ValidatedComputerLeaseRuntimePod(value.runtimePod)) || !_LeaseState(value.state) || !_IsoTimestamp(value.claimedAt) || !_IsoTimestamp(value.expiresAt) || (value.releasedAt !== null && !_IsoTimestamp(value.releasedAt)))
		throw new Error("Conversation computer history requires valid lease coordinates");
	if (Date.parse(value.expiresAt) <= Date.parse(value.claimedAt))
		throw new Error("Conversation computer history requires a lease expiry after its claim");
	if (value.releasedAt !== null && Date.parse(value.releasedAt) < Date.parse(value.claimedAt))
		throw new Error("Conversation computer history requires a lease release after its claim");
	return value as unknown as ComputerLease;
}

/** Validates the durable Pod identity that a later TokenReview must match exactly. */
function _ValidatedComputerLeaseRuntimePod(value: unknown): value is ComputerLeaseRuntimePod
{
	return _Record(value) && _ExactKeys(value, ["namespace", "serviceAccountName", "podUid"]) && _DnsLabel(value.namespace) && _DnsLabel(value.serviceAccountName) && _Identifier(value.podUid);
}

/** Checks whether one snapshot has zero or one lease consistent with the computer's lifecycle. */
function _ValidateCurrentLease(computer: ConversationComputer, lease: ComputerLease | null): void
{
	_ValidateActiveExecution(computer, lease);
	if (lease === null)
	{
		if (computer.state !== ConversationComputerStates.Cold && computer.state !== ConversationComputerStates.RecoveryRequired && computer.state !== ConversationComputerStates.Retired)
			throw new Error("Conversation computer history requires a lease for its current computer state");
		return;
	}
	if (lease.computerId !== computer.id || lease.generation !== computer.leaseGeneration)
		throw new Error("Conversation computer history requires the lease to match its computer generation");
	if (lease.state === ComputerLeaseStates.Claimed)
	{
		if ((computer.state !== ConversationComputerStates.ClaimPending && computer.state !== ConversationComputerStates.ClaimDispatched) || lease.sandboxId !== null || lease.runtimePod !== null || lease.releasedAt !== null)
			throw new Error("Conversation computer history requires a pending claim without a sandbox");
		return;
	}
	if (lease.state === ComputerLeaseStates.Active)
	{
		if ((computer.state !== ConversationComputerStates.Warm && computer.state !== ConversationComputerStates.Cooling) || lease.sandboxId === null || lease.runtimePod === null || lease.releasedAt !== null)
			throw new Error("Conversation computer history requires an active lease for a warm or cooling computer");
		return;
	}
	if (lease.releasedAt === null)
		throw new Error("Conversation computer history requires a terminal lease release time");
	if (computer.state === ConversationComputerStates.Warm || computer.state === ConversationComputerStates.ClaimPending || computer.state === ConversationComputerStates.ClaimDispatched)
		throw new Error("Conversation computer history cannot retain a terminal lease on an admitting computer");
}

/** Checks that the retained execution is fenced to the current lease and computer lifecycle. */
function _ValidateActiveExecution(computer: ConversationComputer, lease: ComputerLease | null): void
{
	const execution = computer.activeExecution;
	if (execution === null)
		return;
	if (lease === null || execution.leaseId !== lease.id || execution.leaseGeneration !== lease.generation)
		throw new Error("Conversation computer history requires an execution to match its lease");
	if (Date.parse(execution.startedAt) < Date.parse(lease.claimedAt))
		throw new Error("Conversation computer history requires an execution after its lease claim");
	if (Date.parse(execution.startedAt) < Date.parse(computer.createdAt) || Date.parse(execution.startedAt) > Date.parse(computer.updatedAt) || (execution.endedAt !== null && Date.parse(execution.endedAt) > Date.parse(computer.updatedAt)))
		throw new Error("Conversation computer history requires execution times within the computer snapshot");
	if (execution.endedAt === null && (lease.state !== ComputerLeaseStates.Active || (computer.state !== ConversationComputerStates.Warm && computer.state !== ConversationComputerStates.Cooling)))
		throw new Error("Conversation computer history requires an active execution on an active warm lease");
}

/** Checks stable computer coordinates and lease-generation progress across snapshots. */
export function _ValidateSnapshotTransition(previous: ConversationComputerHistorySnapshot, current: ConversationComputerHistorySnapshot): void
{
	if (!_SameComputerCoordinates(previous.computer, current.computer))
		throw new Error("Conversation computer history changed stable computer coordinates");
	if (previous.computer.state === ConversationComputerStates.Retired && current.computer.state !== ConversationComputerStates.Retired)
		throw new Error("Conversation computer history cannot reactivate a retired computer");
	if (previous.computer.state === ConversationComputerStates.ClaimPending && current.computer.state === ConversationComputerStates.Warm)
		throw new Error("Conversation computer history requires claim dispatch before a computer can become warm");
	if (previous.computer.state === ConversationComputerStates.ClaimDispatched)
		_ValidateClaimDispatchedTransition(previous, current);
	if (current.computer.leaseGeneration < previous.computer.leaseGeneration)
		throw new Error("Conversation computer history decreased its lease generation");
	if (previous.lease !== null && current.lease !== null && previous.lease.id !== current.lease.id)
	{
		if (previous.lease.state === ComputerLeaseStates.Active || previous.lease.state === ComputerLeaseStates.Claimed)
			throw new Error("Conversation computer history replaced a nonterminal lease");
		if (current.lease.generation <= previous.lease.generation)
			throw new Error("Conversation computer history reused a lease generation");
	}
	if (previous.lease !== null && current.lease !== null && previous.lease.id === current.lease.id)
		_ValidateSameLeaseTransition(previous.lease, current.lease);
	_ValidateExecutionTransition(previous.computer.activeExecution, current.computer.activeExecution);
}

/** Limits a durable claim fence to controller-backed warmth or one lease-expiry compensation. */
function _ValidateClaimDispatchedTransition(previous: ConversationComputerHistorySnapshot, current: ConversationComputerHistorySnapshot): void
{
	if (current.computer.state === ConversationComputerStates.ClaimDispatched || current.computer.state === ConversationComputerStates.Warm)
		return;
	if (current.computer.state !== ConversationComputerStates.RecoveryRequired || previous.lease === null || current.lease === null || current.lease.state !== ComputerLeaseStates.Lost || current.lease.sandboxId !== null || current.lease.releasedAt === null || current.computer.activeExecution !== null)
		throw new Error("Conversation computer history requires claim dispatch to converge before terminal transition");
}

/** Prevents a live execution from being replaced or reactivated without first recording its end. */
function _ValidateExecutionTransition(previous: ConversationComputerExecution | null, current: ConversationComputerExecution | null): void
{
	if (previous === null)
		return;
	if (previous.endedAt === null && (current === null || current.id !== previous.id))
		throw new Error("Conversation computer history replaced an active execution without ending it");
	if (current === null || current.id !== previous.id)
		return;
	if (previous.leaseId !== current.leaseId || previous.leaseGeneration !== current.leaseGeneration || previous.startedAt !== current.startedAt)
		throw new Error("Conversation computer history changed stable execution coordinates");
	if (previous.endedAt !== null && previous.endedAt !== current.endedAt)
		throw new Error("Conversation computer history reactivated a terminal execution");
}

/** Preserves immutable computer identity, ownership, profile, and creation coordinates. */
function _SameComputerCoordinates(first: ConversationComputer, current: ConversationComputer): boolean
{
	return first.schemaVersion === current.schemaVersion && first.id === current.id && first.siloId === current.siloId && first.conversationId === current.conversationId && first.agentIdentityId === current.agentIdentityId && first.profileRevisionId === current.profileRevisionId && first.createdAt === current.createdAt;
}

/** Allows lifecycle changes for one lease without letting a terminal or foreign lease return. */
function _ValidateSameLeaseTransition(previous: ComputerLease, current: ComputerLease): void
{
	if (previous.schemaVersion !== current.schemaVersion || previous.computerId !== current.computerId || previous.generation !== current.generation || previous.sandboxClaimId !== current.sandboxClaimId || previous.claimedAt !== current.claimedAt)
		throw new Error("Conversation computer history changed stable lease coordinates");
	if (previous.sandboxId !== null && previous.sandboxId !== current.sandboxId)
		throw new Error("Conversation computer history changed an assigned sandbox");
	if (previous.runtimePod !== null && !_SameRuntimePod(previous.runtimePod, current.runtimePod))
		throw new Error("Conversation computer history changed an active sandbox Pod identity");
	if ((previous.state === ComputerLeaseStates.Released || previous.state === ComputerLeaseStates.Lost) && previous.state !== current.state)
		throw new Error("Conversation computer history reactivated a terminal lease");
	if (previous.state === ComputerLeaseStates.Active && current.state === ComputerLeaseStates.Claimed)
		throw new Error("Conversation computer history moved an active lease back to claimed");
}

/** Compares an immutable verified Pod identity without permitting a same-name replacement. */
function _SameRuntimePod(previous: ComputerLeaseRuntimePod, current: ComputerLeaseRuntimePod | null): boolean
{
	return current !== null && previous.namespace === current.namespace && previous.serviceAccountName === current.serviceAccountName && previous.podUid === current.podUid;
}

/** Validates the nested immutable workspace checkpoint when one is present. */
function _ValidatedWorkspaceCheckpoint(value: unknown): void
{
	if (!_Record(value) || !_ExactKeys(value, ["artifactRevisionId", "digest", "format", "checkpointedAt"]) || !_Identifier(value.artifactRevisionId) || !_Identifier(value.digest) || !_Identifier(value.format) || !_IsoTimestamp(value.checkpointedAt))
		throw new Error("Conversation computer history requires a valid workspace checkpoint");
}

/** Checks a plain object has exactly the expected closed contract keys. */
function _ExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean
{
	const actual = Object.keys(value);
	return actual.length === keys.length && actual.every(key => keys.includes(key));
}

/** Checks a nonempty trusted identifier without normalizing the durable coordinate. */
function _Identifier(value: unknown): value is string
{
	return typeof value === "string" && value.trim().length > 0 && value === value.trim();
}

/** Checks one Kubernetes DNS label used by the release-owned namespace and ServiceAccount. */
function _DnsLabel(value: unknown): value is string
{
	return typeof value === "string" && value.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value);
}

/** Checks one nonnegative safe integer stored as the computer's durable generation. */
function _NonnegativeInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Checks one positive safe integer stored as a lease fence. */
function _PositiveInteger(value: unknown): value is number
{
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Checks the exact current ConversationComputer state set. */
function _ComputerState(value: unknown): value is ConversationComputerStates
{
	return value === ConversationComputerStates.Cold || value === ConversationComputerStates.ClaimPending || value === ConversationComputerStates.ClaimDispatched || value === ConversationComputerStates.Warm || value === ConversationComputerStates.Cooling || value === ConversationComputerStates.RecoveryRequired || value === ConversationComputerStates.Retired;
}

/** Checks the exact current ComputerLease state set. */
function _LeaseState(value: unknown): value is ComputerLeaseStates
{
	return value === ComputerLeaseStates.Claimed || value === ComputerLeaseStates.Active || value === ComputerLeaseStates.Released || value === ComputerLeaseStates.Lost;
}

/** Checks the ISO timestamp representation stored in the shared computer contracts. */
function _IsoTimestamp(value: unknown): value is string
{
	return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** Narrows one unknown HistoryStore payload to a JSON-object candidate. */
function _Record(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
