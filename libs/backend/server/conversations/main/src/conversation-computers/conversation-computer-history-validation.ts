import { ___ComputerLeaseSchema, ___ConversationComputerRealizationSchema, ___ConversationComputerSchema, ComputerLeaseStates, ConversationComputerRealizationKinds, ConversationComputerStates, type ComputerLease, type ConversationComputer, type ConversationComputerRealization } from "@opencrane/contracts";
import type { HistoryRecordedEvent } from "@opencrane/backend/server/infra/history-store";
import { z } from "zod";

import type { ConversationComputerCurrentCommand, ConversationComputerHistorySnapshot } from "./conversation-computer-history.types";

/** Names the one versioned event schema this history authority accepts. */
const _CONVERSATION_COMPUTER_EVENT_TYPE = "opencrane.conversation-computer.v1";
/** Recognizes the UUID event identifiers that HistoryStore uses for idempotent appends. */
const _UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Composes the public computer and lease contracts into the closed durable event payload. */
const _ConversationComputerHistorySnapshotSchema: z.ZodType<ConversationComputerHistorySnapshot> = z.object({
	computer: ___ConversationComputerSchema,
	lease: ___ComputerLeaseSchema.nullable()
}).strict();

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
	if (
		event.metadata.siloId !== snapshot.computer.siloId
		|| event.metadata.computerId !== snapshot.computer.id
		|| event.metadata.conversationId !== snapshot.computer.conversationId
		|| event.metadata.agentIdentityId !== snapshot.computer.agentIdentityId
		|| event.metadata.profileRevisionId !== snapshot.computer.profileRevisionId
		|| event.metadata.leaseId !== snapshot.lease?.id
		|| event.metadata.leaseGeneration !== leaseGeneration
		|| event.metadata.leaseState !== snapshot.lease?.state
	)
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
	const result = _ConversationComputerHistorySnapshotSchema.safeParse(value);

	if (!result.success)
		throw new Error("Conversation computer history requires a complete computer snapshot");

	_validateComputerChronology(result.data.computer);

	if (result.data.lease !== null)
		_validateLeaseChronology(result.data.lease);

	_ValidateCurrentLease(result.data.computer, result.data.lease);

	return result.data;
}

/** Preserves the computer's temporal ordering after its public structure has been parsed. */
function _validateComputerChronology(computer: ConversationComputer): void
{
	if (Date.parse(computer.updatedAt) < Date.parse(computer.createdAt))
		throw new Error("Conversation computer history requires a computer update after its creation");
}

/** Preserves lease claim, expiry, and release ordering after its public structure has been parsed. */
function _validateLeaseChronology(lease: ComputerLease): void
{
	if (Date.parse(lease.expiresAt) <= Date.parse(lease.claimedAt))
		throw new Error("Conversation computer history requires a lease expiry after its claim");

	if (lease.releasedAt !== null && Date.parse(lease.releasedAt) < Date.parse(lease.claimedAt))
		throw new Error("Conversation computer history requires a lease release after its claim");
}

/** Checks whether one snapshot has zero or one lease consistent with the computer's lifecycle. */
function _ValidateCurrentLease(computer: ConversationComputer, lease: ComputerLease | null): void
{
	if (lease === null)
	{
		if (
			computer.state !== ConversationComputerStates.Cold
			&& computer.state !== ConversationComputerStates.RecoveryRequired
			&& computer.state !== ConversationComputerStates.Retired
		)
			throw new Error("Conversation computer history requires a lease for its current computer state");
		return;
	}
	if (lease.computerId !== computer.id || lease.generation !== computer.leaseGeneration)
		throw new Error("Conversation computer history requires the lease to match its computer generation");
	if (lease.state === ComputerLeaseStates.Claimed)
	{
		const validClaimedRealization = lease.realization.kind !== ConversationComputerRealizationKinds.AgentSandbox
			|| (
				lease.realization.sandboxId === null
				&& lease.realization.serviceFQDN === null
			);

		if (
			computer.state !== ConversationComputerStates.ClaimPending
			|| !validClaimedRealization
			|| lease.releasedAt !== null
		)
			throw new Error("Conversation computer history requires a realization valid for a claimed lease");
		return;
	}
	if (lease.state === ComputerLeaseStates.Active)
	{
		const validActiveRealization = lease.realization.kind !== ConversationComputerRealizationKinds.AgentSandbox
			|| (
				lease.realization.sandboxId !== null
				&& lease.realization.serviceFQDN !== null
			);

		if (
			(
				computer.state !== ConversationComputerStates.Warm
				&& computer.state !== ConversationComputerStates.Cooling
			)
			|| !validActiveRealization
			|| lease.releasedAt !== null
		)
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
	if (
		previous.lease
		&& current.lease
		&& previous.lease.id !== current.lease.id
	)
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
	return first.schemaVersion === current.schemaVersion
		&& first.id === current.id
		&& first.siloId === current.siloId
		&& first.conversationId === current.conversationId
		&& first.agentIdentityId === current.agentIdentityId
		&& first.profileRevisionId === current.profileRevisionId
		&& first.createdAt === current.createdAt;
}

/** Allows lifecycle changes for one lease without letting a terminal or foreign lease return. */
function _ValidateSameLeaseTransition(previous: ComputerLease, current: ComputerLease): void
{
	if (
		previous.schemaVersion !== current.schemaVersion
		|| previous.computerId !== current.computerId
		|| previous.generation !== current.generation
		|| previous.claimedAt !== current.claimedAt
		|| previous.realization.kind !== current.realization.kind
	)
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
	const result = ___ConversationComputerRealizationSchema.safeParse(value);

	if (!result.success)
		throw new Error("Conversation computer history requires a valid realization");

	return result.data;
}

/** Keeps realization coordinates immutable once a lease has been recorded. */
function _SameRealization(previous: ConversationComputerRealization, current: ConversationComputerRealization): boolean
{
	if (previous.kind === ConversationComputerRealizationKinds.AgentSandbox && current.kind === ConversationComputerRealizationKinds.AgentSandbox)
		return previous.claimId === current.claimId
			&& (
				previous.sandboxId === null
				|| previous.sandboxId === current.sandboxId
			)
			&& (
				previous.serviceFQDN === null
				|| previous.serviceFQDN === current.serviceFQDN
			);
	if (previous.kind === ConversationComputerRealizationKinds.HostDevelopmentProcess && current.kind === ConversationComputerRealizationKinds.HostDevelopmentProcess)
		return previous.processId === current.processId && previous.endpoint === current.endpoint;
	return false;
}

/** Checks a nonempty trusted identifier without normalizing the durable coordinate. */
function _Identifier(value: unknown): value is string
{
	return typeof value === "string"
		&& !!value.trim()
		&& value === value.trim();
}
