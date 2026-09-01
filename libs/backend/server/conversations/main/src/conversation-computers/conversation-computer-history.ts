import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import { HistoryExpectedRevisions, type HistoryStore } from "@opencrane/backend/server/infra/history-store";

import type { ActiveConversationComputerLease, ActiveConversationComputerLeaseCommand, ConversationComputerAppendCommand, ConversationComputerCurrentCommand, ConversationComputerHistorySnapshot, CurrentConversationComputer } from "./conversation-computer-history.types";
import { _ConversationComputerStreamName, _ValidateConversationComputerCurrentCommand, _ValidatedConversationComputerSnapshot, _ValidatedConversationComputerEvent, _ValidateSnapshotTransition } from "./conversation-computer-history-validation";

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
	public constructor(private readonly historyStore: Pick<HistoryStore, "append" | "readHead" | "readStream">) {}

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
		if (!_ExpectedRevision(command.expectedRevision))
			throw new Error("Conversation computer history append requires a nonnegative expected revision");
		if (!_UUID_PATTERN.test(command.eventId))
			throw new Error("Conversation computer history append requires a UUID event identifier");
		if (command.expectedRevision !== HistoryExpectedRevisions.NoStream)
		{
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
		}
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
		const streamName = _ConversationComputerStreamName(command.computerId);
		let expectedRevision = 0n;
		let current: ConversationComputerHistorySnapshot | null = null;

		for await (const event of this.historyStore.readStream({ streamName }))
		{
			const snapshot = _ValidatedConversationComputerEvent(event, command, streamName, expectedRevision);
			if (current !== null)
				_ValidateSnapshotTransition(current, snapshot);
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
}

/** Checks the only expected revisions accepted by the HistoryStore append contract. */
function _ExpectedRevision(value: ConversationComputerAppendCommand["expectedRevision"]): boolean
{
	return value === HistoryExpectedRevisions.NoStream || (typeof value === "bigint" && value >= 0n);
}
