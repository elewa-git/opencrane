import { ComputerLeaseStates, ConversationComputerRealizationKinds, ConversationComputerStates, type ComputerLease, type ConversationComputer, type ConversationComputerRealization } from "@opencrane/contracts";
import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";

import type { ConversationComputerCurrentCommand, ConversationComputerHistorySnapshot } from "./conversation-computer-history.types";

/** Names the one versioned event schema this history authority accepts. */
const _CONVERSATION_COMPUTER_EVENT_TYPE = "opencrane.conversation-computer.v1";
/** Recognizes the UUID event identifiers that HistoryStore uses for idempotent appends. */
const _UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Derives the one stream that may represent a computer without accepting a caller-selected stream. */
export function _ConversationComputerStreamName(computerId: string): string
{
	if (!_Identifier(computerId))
		throw new Error("Conversation computer history requires a server-provided computer identifier");
	return `conversation-computer-${computerId}`;
}

/** Validates trusted coordinates before they can select a durable computer history stream. */
export function _ValidateConversationComputerCurrentCommand(command: ConversationComputerCurrentCommand): void
{
	if (!_Identifier(command.computer.siloId))
		throw new Error("Conversation computer history load requires a server-provided silo identifier");
	if (!_Identifier(command.computer.computerId))
		throw new Error("Conversation computer history load requires a server-provided computer identifier");
	if (!_Identifier(command.computer.conversationId))
		throw new Error("Conversation computer history load requires a server-provided conversation identifier");
	if (!_Identifier(command.computer.agentIdentityId))
		throw new Error("Conversation computer history load requires a server-provided agent identity identifier");
	if (!_Identifier(command.profileRevisionId))
		throw new Error("Conversation computer history load requires a server-provided profile revision identifier");
}

/** Validates one envelope and closed snapshot before it can contribute to current computer state. */
export function _ValidatedConversationComputerEvent(event: HistoryRecordedEvent, command: ConversationComputerCurrentCommand, streamName: string, expectedRevision: bigint): ConversationComputerHistorySnapshot
{
	if (event.streamName !== streamName)
		throw new Error("Conversation computer history received an event from a different stream");
	if (event.revision !== expectedRevision)
		throw new Error("Conversation computer history received a noncontiguous stream revision");
	if (event.type !== _CONVERSATION_COMPUTER_EVENT_TYPE)
		throw new Error("Conversation computer history received an unsupported event type");
	if (!_UUID_PATTERN.test(event.id))
		throw new Error("Conversation computer history received an event with an invalid identifier");
	const snapshot = _ValidatedConversationComputerSnapshot(event.data);
	// KurrentDB stores a string map: a lease-free computer omits all three lease coordinates.
	const leaseGeneration = snapshot.lease === null ? undefined : String(snapshot.lease.generation);
	if (event.metadata.siloId !== snapshot.computer.siloId || event.metadata.computerId !== snapshot.computer.id || event.metadata.conversationId !== snapshot.computer.conversationId || event.metadata.agentIdentityId !== snapshot.computer.agentIdentityId || event.metadata.profileRevisionId !== snapshot.computer.profileRevisionId || event.metadata.leaseId !== snapshot.lease?.id || event.metadata.leaseGeneration !== leaseGeneration || event.metadata.leaseState !== snapshot.lease?.state)
		throw new Error("Conversation computer history received an event that does not match its envelope");
	if (snapshot.computer.siloId !== command.computer.siloId)
		throw new Error("Conversation computer history received a computer from a different silo");
	if (snapshot.computer.id !== command.computer.computerId)
		throw new Error("Conversation computer history received a different computer");
	if (snapshot.computer.conversationId !== command.computer.conversationId)
		throw new Error("Conversation computer history received a computer for a different conversation");
	if (snapshot.computer.agentIdentityId !== command.computer.agentIdentityId)
		throw new Error("Conversation computer history received a computer for a different agent identity");
	if (snapshot.computer.profileRevisionId !== command.profileRevisionId)
		throw new Error("Conversation computer history received a computer for a different profile revision");
	return snapshot;
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
	if (!_Record(value) || !_ExactKeys(value, ["schemaVersion", "id", "siloId", "conversationId", "agentIdentityId", "profileRevisionId", "state", "leaseGeneration", "workspaceCheckpoint", "createdAt", "updatedAt"]))
		throw new Error("Conversation computer history requires a valid computer snapshot");
	if (value.schemaVersion !== 1 || !_Identifier(value.id) || !_Identifier(value.siloId) || !_Identifier(value.conversationId) || !_Identifier(value.agentIdentityId) || !_Identifier(value.profileRevisionId) || !_ComputerState(value.state) || !_NonnegativeInteger(value.leaseGeneration) || !_IsoTimestamp(value.createdAt) || !_IsoTimestamp(value.updatedAt))
		throw new Error("Conversation computer history requires valid computer coordinates");
	if (Date.parse(value.updatedAt) < Date.parse(value.createdAt))
		throw new Error("Conversation computer history requires a computer update after its creation");
	if (value.workspaceCheckpoint !== null)
		_ValidatedWorkspaceCheckpoint(value.workspaceCheckpoint);
	return value as unknown as ConversationComputer;
}

/** Parses the exact closed ComputerLease contract at a history boundary. */
export function _ValidatedComputerLease(value: unknown): ComputerLease
{
	if (!_Record(value) || !_ExactKeys(value, ["schemaVersion", "id", "computerId", "generation", "realization", "state", "claimedAt", "expiresAt", "releasedAt"]))
		throw new Error("Conversation computer history requires a valid lease snapshot");
	if (value.schemaVersion !== 1 || !_Identifier(value.id) || !_Identifier(value.computerId) || !_PositiveInteger(value.generation) || !_LeaseState(value.state) || !_IsoTimestamp(value.claimedAt) || !_IsoTimestamp(value.expiresAt) || (value.releasedAt !== null && !_IsoTimestamp(value.releasedAt)))
		throw new Error("Conversation computer history requires valid lease coordinates");
	_ValidatedConversationComputerRealization(value.realization);
	if (Date.parse(value.expiresAt) <= Date.parse(value.claimedAt))
		throw new Error("Conversation computer history requires a lease expiry after its claim");
	if (value.releasedAt !== null && Date.parse(value.releasedAt) < Date.parse(value.claimedAt))
		throw new Error("Conversation computer history requires a lease release after its claim");
	return value as unknown as ComputerLease;
}

/** Checks whether one snapshot has zero or one lease consistent with the computer's lifecycle. */
function _ValidateCurrentLease(computer: ConversationComputer, lease: ComputerLease | null): void
{
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
		const pendingSandbox = lease.realization.kind !== ConversationComputerRealizationKinds.AgentSandbox || lease.realization.sandboxId === null && lease.realization.serviceFQDN === null;
		if (computer.state !== ConversationComputerStates.ClaimPending || !pendingSandbox || lease.releasedAt !== null)
			throw new Error("Conversation computer history requires a pending claim without a sandbox");
		return;
	}
	if (lease.state === ComputerLeaseStates.Active)
	{
		const assignedSandbox = lease.realization.kind !== ConversationComputerRealizationKinds.AgentSandbox || lease.realization.sandboxId !== null && lease.realization.serviceFQDN !== null;
		if ((computer.state !== ConversationComputerStates.Warm && computer.state !== ConversationComputerStates.Cooling) || !assignedSandbox || lease.releasedAt !== null)
			throw new Error("Conversation computer history requires an active lease for a warm or cooling computer");
		return;
	}
	if (lease.releasedAt === null)
		throw new Error("Conversation computer history requires a terminal lease release time");
	if (computer.state === ConversationComputerStates.Warm || computer.state === ConversationComputerStates.ClaimPending)
		throw new Error("Conversation computer history cannot retain a terminal lease on an admitting computer");
}

/** Checks stable computer coordinates and lease-generation progress across snapshots. */
export function _ValidateSnapshotTransition(previous: ConversationComputerHistorySnapshot, current: ConversationComputerHistorySnapshot): void
{
	if (!_SameComputerCoordinates(previous.computer, current.computer))
		throw new Error("Conversation computer history changed stable computer coordinates");
	if (previous.computer.state === ConversationComputerStates.Retired && current.computer.state !== ConversationComputerStates.Retired)
		throw new Error("Conversation computer history cannot reactivate a retired computer");
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
}

/** Preserves immutable computer identity, ownership, profile, and creation coordinates. */
function _SameComputerCoordinates(first: ConversationComputer, current: ConversationComputer): boolean
{
	return first.schemaVersion === current.schemaVersion && first.id === current.id && first.siloId === current.siloId && first.conversationId === current.conversationId && first.agentIdentityId === current.agentIdentityId && first.profileRevisionId === current.profileRevisionId && first.createdAt === current.createdAt;
}

/** Allows lifecycle changes for one lease without letting a terminal or foreign lease return. */
function _ValidateSameLeaseTransition(previous: ComputerLease, current: ComputerLease): void
{
	if (previous.schemaVersion !== current.schemaVersion || previous.computerId !== current.computerId || previous.generation !== current.generation || previous.claimedAt !== current.claimedAt || previous.realization.kind !== current.realization.kind)
		throw new Error("Conversation computer history changed stable lease coordinates");
	if (!_SameRealization(previous.realization, current.realization))
		throw new Error("Conversation computer history changed its realization coordinates");
	if ((previous.state === ComputerLeaseStates.Released || previous.state === ComputerLeaseStates.Lost) && previous.state !== current.state)
		throw new Error("Conversation computer history reactivated a terminal lease");
	if (previous.state === ComputerLeaseStates.Active && current.state === ComputerLeaseStates.Claimed)
		throw new Error("Conversation computer history moved an active lease back to claimed");
}

/** Parses one closed realization variant without accepting credentials or unknown fields. */
export function _ValidatedConversationComputerRealization(value: unknown): ConversationComputerRealization
{
	if (!_Record(value))
		throw new Error("Conversation computer history requires a valid realization");
	if (value.kind === ConversationComputerRealizationKinds.AgentSandbox)
	{
		if (!_ExactKeys(value, ["kind", "claimId", "sandboxId", "serviceFQDN"]) || !_Identifier(value.claimId) || (value.sandboxId !== null && !_Identifier(value.sandboxId)) || (value.serviceFQDN !== null && !_ServiceFqdn(value.serviceFQDN)))
			throw new Error("Conversation computer history requires valid Agent Sandbox coordinates");
		return value as unknown as ConversationComputerRealization;
	}
	if (value.kind === ConversationComputerRealizationKinds.HostDevelopmentProcess)
	{
		if (!_ExactKeys(value, ["kind", "processId", "endpoint"]) || !_Identifier(value.processId) || !_LoopbackEndpoint(value.endpoint))
			throw new Error("Conversation computer history requires a loopback host process");
		return value as unknown as ConversationComputerRealization;
	}
	throw new Error("Conversation computer history requires a supported realization kind");
}

/** Keeps realization coordinates immutable once a lease has been recorded. */
function _SameRealization(previous: ConversationComputerRealization, current: ConversationComputerRealization): boolean
{
	if (previous.kind === ConversationComputerRealizationKinds.AgentSandbox && current.kind === ConversationComputerRealizationKinds.AgentSandbox)
		return previous.claimId === current.claimId && (previous.sandboxId === null || previous.sandboxId === current.sandboxId) && (previous.serviceFQDN === null || previous.serviceFQDN === current.serviceFQDN);
	if (previous.kind === ConversationComputerRealizationKinds.HostDevelopmentProcess && current.kind === ConversationComputerRealizationKinds.HostDevelopmentProcess)
		return previous.processId === current.processId && previous.endpoint === current.endpoint;
	return false;
}

/** Accepts only an HTTP listener on IPv4 or IPv6 loopback. */
function _LoopbackEndpoint(value: unknown): value is string
{
	if (typeof value !== "string")
		return false;
	try
	{
		const url = new URL(value);
		return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "[::1]") && url.username === "" && url.password === "" && url.pathname === "/" && url.search === "" && url.hash === "";
	}
	catch
	{
		return false;
	}
}

function _ServiceFqdn(value: unknown): value is string
{
	return typeof value === "string" && value.length <= 253 && value.endsWith(".svc.cluster.local") && value.split(".").every(_Identifier);
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
	return value === ConversationComputerStates.Cold || value === ConversationComputerStates.ClaimPending || value === ConversationComputerStates.Warm || value === ConversationComputerStates.Cooling || value === ConversationComputerStates.RecoveryRequired || value === ConversationComputerStates.Retired;
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
