import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import { HistoryExpectedRevisions, type HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { ActiveConversationComputerBootstrapCommand, ActiveConversationComputerExecution, ActiveConversationComputerLease, ActiveConversationComputerLeaseCommand, ActiveConversationComputerRuntimeCommand, ActiveConversationComputerServerCommand, ConversationComputerActivationCurrentCommand, ConversationComputerAppendCommand, ConversationComputerCurrentCommand, ConversationComputerHistorySnapshot, ConversationComputerProvisionAndActivationCommand, ConversationComputerRuntimeCurrentCommand, CurrentConversationComputer } from "./conversation-computer-history.types";
import { _AssertConversationComputerRuntimeCoordinates, _ConversationComputerStreamName, _ValidateConversationComputerActivationCurrentCommand, _ValidateConversationComputerBootstrapCommand, _ValidateConversationComputerCurrentCommand, _ValidateConversationComputerRuntimeCurrentCommand, _ValidatedConversationComputerSnapshot, _ValidatedConversationComputerEvent, _ValidatedConversationComputerProvisionedEvent, _ValidateSnapshotTransition } from "./conversation-computer-history-validation";

/** Recognizes UUID event identifiers without treating a computer coordinate as an idempotency key. */
const _UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Persists and loads KurrentDB history for one logical conversation computer.
 *
 * ADR 0016 gives each agent conversation one computer and permits a run only after an active lease
 * is rechecked. This authority derives stream names from trusted coordinates, validates snapshots
 * on read, and returns the current head with the lease; it does not create claims or decide policy.
 *
 * @see `docs/adr/0016-conversation-history-and-computers.md` for computer ownership and admission.
 */
export class ConversationComputerHistory
{
	/** Connects this authority to the narrow checked KurrentDB port. */
	public constructor(private readonly historyStore: Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream">) {}

	/**
	 * Atomically stores the cold computer, its initial claimed lease, and the matching activation event.
	 *
	 * The computer stream begins cold at revision zero, then enters `ClaimPending` at revision one.
	 * The silo activation stream commits in the same transaction, so a successful pending computer
	 * cannot be left without the work item that begins its Agent Sandbox realization.
	 *
	 * Called by: {@link ConversationComputerCreationActivationAuthority.ensure}.
	 * @param command - Supplies frozen creation identifiers and the closed generation-one snapshots.
	 * @returns Resolves after both streams append in the same KurrentDB operation.
	 * @throws {Error} Rejects malformed event ids, an invalid initial transition, or a changed activation head.
	 */
	public async provisionAndRequestActivation(command: ConversationComputerProvisionAndActivationCommand): Promise<void>
	{
		const cold = _ValidatedConversationComputerSnapshot({ computer: command.computer, lease: null });
		const pending = _ValidatedConversationComputerSnapshot({ computer: { ...command.computer, state: ConversationComputerStates.ClaimPending, leaseGeneration: 1, updatedAt: command.lease.claimedAt }, lease: command.lease });
		if (!_UUID_PATTERN.test(command.provisionEventId) || !_UUID_PATTERN.test(command.claimEventId) || !_UUID_PATTERN.test(command.activationEventId))
			throw new Error("Conversation computer creation requires UUID event identifiers");
		if (cold.computer.state !== ConversationComputerStates.Cold || cold.computer.leaseGeneration !== 0 || cold.computer.workspaceCheckpoint !== null || cold.computer.activeExecution !== null || cold.computer.updatedAt !== cold.computer.createdAt)
			throw new Error("Conversation computer creation requires a cold zero-generation computer");
		if (pending.computer.id !== cold.computer.id || pending.computer.siloId !== cold.computer.siloId || pending.computer.conversationId !== cold.computer.conversationId || pending.computer.agentIdentityId !== cold.computer.agentIdentityId || pending.computer.profileRevisionId !== cold.computer.profileRevisionId || pending.computer.workspaceCheckpoint !== null || pending.computer.activeExecution !== null || pending.lease?.computerId !== cold.computer.id || pending.lease?.state !== ComputerLeaseStates.Claimed || pending.lease.generation !== 1)
			throw new Error("Conversation computer creation requires the first claimed generation");
		_ValidateSnapshotTransition(cold, pending);
		const computerStreamName = _ConversationComputerStreamName(cold.computer.id);
		const activationStreamName = _ConversationComputerActivationStreamName(cold.computer.siloId);
		const activationHead = await this.historyStore.readHead(activationStreamName);
		if (activationHead.streamName !== activationStreamName)
			throw new Error("Conversation computer creation received a foreign activation stream head");
		const activationRevision = activationHead.revision ?? HistoryExpectedRevisions.NoStream;
		await this.historyStore.appendAtomic({
			expectedHeads: [{ streamName: computerStreamName, revision: HistoryExpectedRevisions.NoStream }, { streamName: activationStreamName, revision: activationRevision }],
			appends: [{ streamName: computerStreamName, expectedRevision: HistoryExpectedRevisions.NoStream, events: [_Event(command.provisionEventId, "opencrane.computer-provisioned.v1", cold), _Event(command.claimEventId, "opencrane.conversation-computer.v1", pending)] }, { streamName: activationStreamName, expectedRevision: activationRevision, events: [_ActivationEvent(command.activationEventId, pending)] }],
		});
	}

	/**
	 * Appends one complete computer-and-lease snapshot at the caller-observed stream revision.
	 *
	 * @param command - Supplies closed snapshots, a UUID event key, and the checked stream head.
	 * @returns The KurrentDB receipt for the deterministic computer stream.
	 * @throws {Error} Rejects malformed snapshots and propagates checked-append conflicts unchanged.
	 */
	public async append(command: ConversationComputerAppendCommand)
	{
		const snapshot = _ValidatedConversationComputerSnapshot({ computer: command.computer, lease: command.lease });
		if (typeof command.expectedRevision !== "bigint" || command.expectedRevision < 0n)
			throw new Error("Conversation computer history append requires a provisioned nonnegative expected revision");
		if (!_UUID_PATTERN.test(command.eventId))
			throw new Error("Conversation computer history append requires a UUID event identifier");
		const previous = await this.load({
			siloId: snapshot.computer.siloId,
			computerId: snapshot.computer.id,
			conversationId: snapshot.computer.conversationId,
			agentIdentityId: snapshot.computer.agentIdentityId,
			profileRevisionId: snapshot.computer.profileRevisionId,
		});
		if (previous === null || previous.revision !== command.expectedRevision)
			throw new Error("Conversation computer history append requires the current expected revision");
		_ValidateSnapshotTransition(previous, snapshot);
		command.assertCurrent?.(previous);
		const streamName = _ConversationComputerStreamName(snapshot.computer.id);
		return this.historyStore.append({
			streamName,
			expectedRevision: command.expectedRevision,
			events: [{
				id: command.eventId,
				type: "opencrane.conversation-computer.v1",
				data: { computer: snapshot.computer, lease: snapshot.lease },
				metadata: {
					siloId: snapshot.computer.siloId,
					computerId: snapshot.computer.id,
					conversationId: snapshot.computer.conversationId,
					agentIdentityId: snapshot.computer.agentIdentityId,
					profileRevisionId: snapshot.computer.profileRevisionId,
					leaseId: snapshot.lease?.id ?? null,
					leaseGeneration: snapshot.lease?.generation ?? null,
					leaseState: snapshot.lease?.state ?? null,
					runtimePodNamespace: snapshot.lease?.runtimePod?.namespace ?? null,
					runtimePodServiceAccountName: snapshot.lease?.runtimePod?.serviceAccountName ?? null,
					runtimePodUid: snapshot.lease?.runtimePod?.podUid ?? null,
					executionId: snapshot.computer.activeExecution?.id ?? null,
					executionLeaseId: snapshot.computer.activeExecution?.leaseId ?? null,
					executionLeaseGeneration: snapshot.computer.activeExecution?.leaseGeneration ?? null,
					executionEndedAt: snapshot.computer.activeExecution?.endedAt ?? null,
				},
			}],
		});
	}

	/**
	 * Loads the checked current snapshot for exactly one trusted computer coordinate tuple.
	 *
	 * @param command - Supplies silo, computer, conversation, identity, and profile coordinates that must match.
	 * @returns Current validated state plus its stream head, or null when the computer stream is absent.
	 * @throws {Error} Rejects malformed, foreign, noncontiguous, or concurrently changed stream history.
	 */
	public async load(command: ConversationComputerCurrentCommand): Promise<CurrentConversationComputer | null>
	{
		_ValidateConversationComputerCurrentCommand(command);
		return this._Load(command);
	}

	/**
	 * Loads current state from runtime-safe coordinates and derives the bound identity from checked history.
	 *
	 * A runtime cannot name an identity because this method validates the first stored snapshot before
	 * replaying the complete stream under that derived identity. Missing, foreign, malformed, and stale
	 * histories fail closed.
	 *
	 * Called by: ConversationComputerRuntimeInputElicitationAuthority and future loop command authorities.
	 * @see loadActiveExecutionForRuntime
	 */
	public async loadForRuntime(command: ConversationComputerRuntimeCurrentCommand): Promise<CurrentConversationComputer | null>
	{
		_ValidateConversationComputerRuntimeCurrentCommand(command);
		const streamName = _ConversationComputerStreamName(command.computerId);
		const iterator = this.historyStore.readStream({ streamName })[Symbol.asyncIterator]();
		let first: IteratorResult<import("@opencrane/backend/server/infra/history-store").HistoryRecordedEvent>;
		try
		{
			first = await iterator.next();
		}
		finally
		{
			await iterator.return?.();
		}
		if (first.done)
		{
			const head = await this.historyStore.readHead(streamName);
			if (head.streamName !== streamName || head.revision !== null)
				throw new Error("Conversation computer history omitted a stream event before its reported head");
			return null;
		}
		const snapshot = _ValidatedConversationComputerProvisionedEvent(first.value, streamName);
		_AssertConversationComputerRuntimeCoordinates(snapshot, command);
		return this._Load({ ...command, agentIdentityId: snapshot.computer.agentIdentityId });
	}

	/**
	 * Loads current state from a durable activation event without accepting its profile or identity.
	 *
	 * The event identifies lifecycle work. The first checked history snapshot supplies the profile and
	 * agent identity, then the full stream verifies those coordinates before a claim is requested.
	 *
	 * Called by: `ConversationComputerActivationAuthority` before requesting an Agent Sandbox claim.
	 * @see loadForRuntime for the equivalent runtime-safe coordinate derivation.
	 */
	public async loadForActivation(command: ConversationComputerActivationCurrentCommand): Promise<CurrentConversationComputer | null>
	{
		_ValidateConversationComputerActivationCurrentCommand(command);
		const streamName = _ConversationComputerStreamName(command.computerId);
		const iterator = this.historyStore.readStream({ streamName })[Symbol.asyncIterator]();
		let first: IteratorResult<import("@opencrane/backend/server/infra/history-store").HistoryRecordedEvent>;
		try
		{
			first = await iterator.next();
		}
		finally
		{
			await iterator.return?.();
		}
		if (first.done)
		{
			const head = await this.historyStore.readHead(streamName);
			if (head.streamName !== streamName || head.revision !== null)
				throw new Error("Conversation computer history omitted a stream event before its reported head");
			return null;
		}
		const snapshot = _ValidatedConversationComputerProvisionedEvent(first.value, streamName);
		if (snapshot.computer.siloId !== command.siloId || snapshot.computer.id !== command.computerId || snapshot.computer.conversationId !== command.conversationId)
			throw new Error("Conversation computer activation load received foreign computer coordinates");
		return this._Load({ ...command, agentIdentityId: snapshot.computer.agentIdentityId, profileRevisionId: snapshot.computer.profileRevisionId });
	}

	/**
	 * Loads an open active execution from runtime-safe coordinates after deriving the bound identity internally.
	 *
	 * This rejects a cold, retired, lost, expired, or terminal execution before a command authority can
	 * use its lease generation as an append fence.
	 *
	 * Called by: ConversationComputerRuntimeInputElicitationAuthority and future loop command authorities.
	 * @see loadForRuntime
	 */
	public async loadActiveExecutionForRuntime(command: ActiveConversationComputerRuntimeCommand): Promise<ActiveConversationComputerExecution>
	{
		const current = await this.loadForRuntime(command);
		if (current === null || current.computer.state !== ConversationComputerStates.Warm || current.lease === null || current.lease.state !== ComputerLeaseStates.Active || current.lease.runtimePod === null || !Number.isSafeInteger(command.nowEpochMilliseconds) || Date.parse(current.lease.expiresAt) <= command.nowEpochMilliseconds || current.computer.activeExecution === null || current.computer.activeExecution.endedAt !== null)
			throw new Error("Conversation computer history cannot use an inactive runtime execution");
		return { ...current, lease: current.lease, execution: current.computer.activeExecution };
	}

	/**
	 * Loads an active execution for Sandbox bootstrap after deriving its conversation and profile from
	 * the selected computer stream.
	 *
	 * The route passes its configured silo, the Sandbox-provided computer identifier, and server time.
	 * This method rejects an absent or foreign stream before it calls {@link loadActiveExecutionForRuntime},
	 * which then rejects an inactive or expired lease. Callers must translate every failure to the same
	 * denial rather than disclose which state was missing.
	 *
	 * Called by: ConversationComputer runtime bootstrap route.
	 *
	 * @param command - Fixed silo, one computer identifier, and the server instant for lease expiry.
	 * @returns The currently active execution and its Pod-bound lease.
	 * @throws When the computer stream is absent, belongs to another silo, or has no usable execution.
	 */
	public async loadActiveExecutionForBootstrap(command: ActiveConversationComputerBootstrapCommand): Promise<ActiveConversationComputerExecution>
	{
		_ValidateConversationComputerBootstrapCommand(command);
		const streamName = _ConversationComputerStreamName(command.computerId);
		const iterator = this.historyStore.readStream({ streamName })[Symbol.asyncIterator]();
		let first: IteratorResult<import("@opencrane/backend/server/infra/history-store").HistoryRecordedEvent>;
		try
		{
			first = await iterator.next();
		}
		finally
		{
			await iterator.return?.();
		}
		if (first.done)
			throw new Error("Conversation computer history cannot bootstrap an absent runtime");
		const snapshot = _ValidatedConversationComputerProvisionedEvent(first.value, streamName);
		if (snapshot.computer.siloId !== command.siloId || snapshot.computer.id !== command.computerId)
			throw new Error("Conversation computer bootstrap received foreign runtime coordinates");
		return this.loadActiveExecutionForRuntime({ siloId: command.siloId, computerId: command.computerId, conversationId: snapshot.computer.conversationId, profileRevisionId: snapshot.computer.profileRevisionId, nowEpochMilliseconds: command.nowEpochMilliseconds });
	}

	/**
	 * Loads one active execution for a server-owned command without accepting its identity or profile.
	 *
	 * The durable command worker has already selected a conversation input. It may name that conversation
	 * and computer, but history derives the remaining binding before it checks the active lease and execution.
	 *
	 * Called by: ConversationComputerRuntimeCommandAuthority.
	 * @param command - Supplies trusted silo, computer, conversation, and current server time.
	 * @returns The current active execution and its computer-stream revision fence.
	 * @throws {Error} Rejects a missing, foreign, inactive, expired, or terminal execution.
	 */
	public async loadActiveExecutionForServer(command: ActiveConversationComputerServerCommand): Promise<ActiveConversationComputerExecution>
	{
		const current = await this.loadForActivation(command);
		if (current === null)
			throw new Error("Conversation computer history cannot select a command for a missing computer");
		return this.loadActiveExecution({
			siloId: command.siloId,
			computerId: command.computerId,
			conversationId: command.conversationId,
			agentIdentityId: current.computer.agentIdentityId,
			profileRevisionId: current.computer.profileRevisionId,
			nowEpochMilliseconds: command.nowEpochMilliseconds,
		});
	}

	/** Replays one fully specified trusted computer stream and verifies its current head. */
	private async _Load(command: ConversationComputerCurrentCommand): Promise<CurrentConversationComputer | null>
	{
		const streamName = _ConversationComputerStreamName(command.computerId);
		let expectedRevision = 0n;
		let current: ConversationComputerHistorySnapshot | null = null;
		const executionIds = new Set<string>();

		for await (const event of this.historyStore.readStream({ streamName }))
		{
			const snapshot = _ValidatedConversationComputerEvent(event, command, streamName, expectedRevision);
			if (current !== null)
				_ValidateSnapshotTransition(current, snapshot);
			const previousExecutionId = current?.computer.activeExecution?.id ?? null;
			const executionId = snapshot.computer.activeExecution?.id ?? null;
			if (executionId !== null && executionId !== previousExecutionId && executionIds.has(executionId))
				throw new Error("Conversation computer history reused an execution identifier");
			if (executionId !== null)
				executionIds.add(executionId);
			current = snapshot;
			expectedRevision += 1n;
		}

		const head = await this.historyStore.readHead(streamName);
		if (current === null)
		{
			if (head.streamName !== streamName || head.revision !== null)
				throw new Error("Conversation computer history omitted a stream event before its reported head");
			return null;
		}
		if (head.streamName !== streamName || head.revision !== expectedRevision - 1n)
			throw new Error("Conversation computer history changed while loading its current state");

		return { streamName, revision: head.revision, computer: current.computer, lease: current.lease };
	}

	/**
	 * Loads a computer only when one current active lease may be used for a fresh activation.
	 *
	 * @param command - Supplies the trusted coordinates that must match the current snapshot.
	 * @returns The warm computer, active lease, and checked current-head evidence.
	 * @throws {Error} Rejects missing, retired, cooling, claimed, released, and lost computer state.
	 */
	public async loadActiveLease(command: ActiveConversationComputerLeaseCommand): Promise<ActiveConversationComputerLease>
	{
		const current = await this.load(command);
		if (current === null)
			throw new Error("Conversation computer history cannot activate a missing computer");
		if (current.computer.state !== ConversationComputerStates.Warm)
			throw new Error("Conversation computer history cannot activate a non-warm or retired computer");
		if (current.lease === null || current.lease.state !== ComputerLeaseStates.Active)
			throw new Error("Conversation computer history cannot activate without one active lease");
		if (!Number.isSafeInteger(command.nowEpochMilliseconds) || Date.parse(current.lease.expiresAt) <= command.nowEpochMilliseconds)
			throw new Error("Conversation computer history cannot activate an expired lease");
		return { ...current, lease: current.lease };
	}

	/**
	 * Loads the current execution only when it remains open on the active fenced lease.
	 *
	 * A future command authority uses the returned computer-stream head with the execution fence so
	 * it cannot append a participant event after a loop has stopped or a lease has been replaced.
	 * @param command - Supplies the trusted computer coordinates and current server time.
	 * @returns The active computer lease, execution, and checked stream head.
	 * @throws {Error} Rejects a missing or terminal execution before it reaches command authorization.
	 */
	public async loadActiveExecution(command: ActiveConversationComputerLeaseCommand): Promise<ActiveConversationComputerExecution>
	{
		const activeLease = await this.loadActiveLease(command);
		const execution = activeLease.computer.activeExecution;
		if (execution === null || execution.endedAt !== null)
			throw new Error("Conversation computer history cannot use a missing or terminal execution");
		return { ...activeLease, execution };
	}
}

/** Builds the exact server-stamped envelope shared by provision and lifecycle-snapshot appends. */
function _Event(eventId: string, type: string, snapshot: ConversationComputerHistorySnapshot)
{
	return {
		id: eventId,
		type,
		data: { computer: snapshot.computer, lease: snapshot.lease },
		metadata: {
			siloId: snapshot.computer.siloId,
			computerId: snapshot.computer.id,
			conversationId: snapshot.computer.conversationId,
			agentIdentityId: snapshot.computer.agentIdentityId,
			profileRevisionId: snapshot.computer.profileRevisionId,
			leaseId: snapshot.lease?.id ?? null,
			leaseGeneration: snapshot.lease?.generation ?? null,
			leaseState: snapshot.lease?.state ?? null,
			runtimePodNamespace: snapshot.lease?.runtimePod?.namespace ?? null,
			runtimePodServiceAccountName: snapshot.lease?.runtimePod?.serviceAccountName ?? null,
			runtimePodUid: snapshot.lease?.runtimePod?.podUid ?? null,
			executionId: snapshot.computer.activeExecution?.id ?? null,
			executionLeaseId: snapshot.computer.activeExecution?.leaseId ?? null,
			executionLeaseGeneration: snapshot.computer.activeExecution?.leaseGeneration ?? null,
			executionEndedAt: snapshot.computer.activeExecution?.endedAt ?? null,
		},
	};
}

/** Derives the silo-scoped stream that feeds durable computer activation work. */
function _ConversationComputerActivationStreamName(siloId: string): string
{
	if (siloId.length === 0)
		throw new Error("Conversation computer creation requires a server-provided silo identifier");
	return `computer-activations-${siloId}`;
}

/** Builds the activation event from the claimed computer generation, never from caller input. */
function _ActivationEvent(eventId: string, snapshot: ConversationComputerHistorySnapshot)
{
	if (snapshot.lease === null)
		throw new Error("Conversation computer creation requires a claimed lease for activation");
	return {
		id: eventId,
		type: "opencrane.computer.activation-requested.v1",
		data: { siloId: snapshot.computer.siloId, computerId: snapshot.computer.id, conversationId: snapshot.computer.conversationId, generation: snapshot.lease.generation },
		metadata: { siloId: snapshot.computer.siloId, computerId: snapshot.computer.id, conversationId: snapshot.computer.conversationId, leaseId: snapshot.lease.id, generation: snapshot.lease.generation },
	};
}
