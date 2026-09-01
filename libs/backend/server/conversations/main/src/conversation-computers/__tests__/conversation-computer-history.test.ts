import { ComputerLeaseStates, ConversationComputerStates, type ComputerLease, type ConversationComputer, type ConversationComputerExecution } from "@opencrane/contracts";
import { HistoryExpectedRevisions, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { describe, expect, it, vi } from "vitest";

import { ConversationComputerHistory } from "../conversation-computer-history";
import type { ConversationComputerAppendCommand, ConversationComputerCurrentCommand } from "../conversation-computer-history.types";

/** Reuses a valid UUID for the immutable computer-history event idempotency key. */
const _EVENT_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";

/** Builds the active execution fence held by the default warm computer snapshot. */
function _Execution(overrides: Partial<ConversationComputerExecution> = {}): ConversationComputerExecution
{
	return { id: "execution-1", leaseId: "lease-1", leaseGeneration: 1, startedAt: "2026-09-01T00:00:00.000Z", endedAt: null, ...overrides };
}

/** Builds a valid logical computer snapshot that follows one selected identity and profile. */
function _Computer(overrides: Partial<ConversationComputer> = {}): ConversationComputer
{
	return {
		schemaVersion: 1,
		id: "computer-1",
		siloId: "silo-1",
		conversationId: "conversation-1",
		agentIdentityId: "identity-1",
		profileRevisionId: "profile-1",
		state: ConversationComputerStates.Warm,
		leaseGeneration: 1,
		workspaceCheckpoint: null,
		activeExecution: _Execution(),
		createdAt: "2026-09-01T00:00:00.000Z",
		updatedAt: "2026-09-01T00:00:00.000Z",
		...overrides,
	};
}

/** Builds the active lease that fences the default warm computer snapshot. */
function _Lease(overrides: Partial<ComputerLease> = {}): ComputerLease
{
	return {
		schemaVersion: 1,
		id: "lease-1",
		computerId: "computer-1",
		generation: 1,
		sandboxClaimId: "claim-1",
		sandboxId: "sandbox-1",
		state: ComputerLeaseStates.Active,
		claimedAt: "2026-09-01T00:00:00.000Z",
		expiresAt: "2026-09-01T00:20:00.000Z",
		releasedAt: null,
		...overrides,
	};
}

/** Builds the trusted coordinate tuple accepted by the history loader. */
function _CurrentCommand(overrides: Partial<ConversationComputerCurrentCommand> = {}): ConversationComputerCurrentCommand
{
	return { siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", ...overrides };
}

/** Adds a trusted server clock when activation needs to reject an expired lease. */
function _ActiveCommand(overrides: Partial<ConversationComputerCurrentCommand> = {})
{
	return { ..._CurrentCommand(overrides), nowEpochMilliseconds: Date.parse("2026-09-01T00:10:00.000Z") };
}

/** Builds a checked snapshot append command. */
function _AppendCommand(overrides: Partial<ConversationComputerAppendCommand> = {}): ConversationComputerAppendCommand
{
	return { expectedRevision: 0n, eventId: _EVENT_ID, computer: _Computer(), lease: _Lease(), ...overrides };
}

/** Builds a recorded computer-history envelope whose metadata agrees with its typed snapshot. */
function _Event(revision: bigint, computer: ConversationComputer = _Computer(), lease: ComputerLease | null = _Lease()): HistoryRecordedEvent
{
	return {
		streamName: `conversation-computer-${computer.id}`,
		id: _EVENT_ID,
		type: "opencrane.conversation-computer.v1",
		data: { computer, lease },
		metadata: {
			siloId: computer.siloId,
			computerId: computer.id,
			conversationId: computer.conversationId,
			agentIdentityId: computer.agentIdentityId,
			profileRevisionId: computer.profileRevisionId,
			leaseId: lease?.id ?? null,
			leaseGeneration: lease?.generation ?? null,
			leaseState: lease?.state ?? null,
			executionId: computer.activeExecution?.id ?? null,
			executionLeaseId: computer.activeExecution?.leaseId ?? null,
			executionLeaseGeneration: computer.activeExecution?.leaseGeneration ?? null,
			executionEndedAt: computer.activeExecution?.endedAt ?? null,
		},
		revision,
		recordedAt: new Date("2026-09-01T00:00:00.000Z"),
	};
}

/** Turns a finite test sequence into the HistoryStore stream read contract. */
async function *_Events(events: readonly HistoryRecordedEvent[]): AsyncIterable<HistoryRecordedEvent>
{
	for (const event of events)
		yield event;
}

/** Builds a narrow fake HistoryStore without introducing a direct KurrentDB client into this package. */
function _Store(overrides: Partial<Pick<HistoryStore, "append" | "readHead" | "readStream">> = {}): Pick<HistoryStore, "append" | "readHead" | "readStream">
{
	return {
		append: vi.fn(),
		readHead: vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: null }),
		readStream: vi.fn().mockReturnValue(_Events([])),
		...overrides,
	};
}

describe("ConversationComputerHistory", function ()
{
	it("appends a validated complete snapshot to its deterministic stream and propagates a stale append conflict", async function ()
	{
		const append = vi.fn().mockResolvedValueOnce({ streamName: "conversation-computer-computer-1", revision: 1n }).mockRejectedValueOnce(new Error("stale expected revision"));
		const history = new ConversationComputerHistory(_Store({ append, readStream: vi.fn().mockReturnValue(_Events([_Event(0n)])), readHead: vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: 0n }) }));

		await expect(history.append(_AppendCommand())).resolves.toEqual({ streamName: "conversation-computer-computer-1", revision: 1n });
		expect(append).toHaveBeenCalledWith({
			streamName: "conversation-computer-computer-1",
			expectedRevision: 0n,
			events: [{
				id: _EVENT_ID,
				type: "opencrane.conversation-computer.v1",
				data: { computer: _Computer(), lease: _Lease() },
				metadata: { siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", leaseId: "lease-1", leaseGeneration: 1, leaseState: ComputerLeaseStates.Active, executionId: "execution-1", executionLeaseId: "lease-1", executionLeaseGeneration: 1, executionEndedAt: null },
			}],
		});
		await expect(history.append(_AppendCommand({ expectedRevision: HistoryExpectedRevisions.NoStream }))).rejects.toThrow("stale expected revision");
	});

	it("returns current state with exact head evidence and rejects duplicate, out-of-order, or stale read revisions", async function ()
	{
		const current = new ConversationComputerHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([_Event(0n)])), readHead: vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: 0n }) }));
		const duplicate = new ConversationComputerHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([_Event(0n), _Event(0n)])), readHead: vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: 0n }) }));
		const outOfOrder = new ConversationComputerHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([_Event(1n)])), readHead: vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: 1n }) }));
		const staleHead = new ConversationComputerHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([_Event(0n)])), readHead: vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: 1n }) }));

		await expect(current.load(_CurrentCommand())).resolves.toEqual({ streamName: "conversation-computer-computer-1", revision: 0n, computer: _Computer(), lease: _Lease() });
		await expect(duplicate.load(_CurrentCommand())).rejects.toThrow("noncontiguous");
		await expect(outOfOrder.load(_CurrentCommand())).rejects.toThrow("noncontiguous");
		await expect(staleHead.load(_CurrentCommand())).rejects.toThrow("changed while loading");
	});

	it("does not activate a lost or retired computer even when its historic stream remains readable", async function ()
	{
		const lostComputer = _Computer({ state: ConversationComputerStates.RecoveryRequired, activeExecution: _Execution({ endedAt: "2026-09-01T00:05:00.000Z" }), updatedAt: "2026-09-01T00:05:00.000Z" });
		const lostLease = _Lease({ state: ComputerLeaseStates.Lost, releasedAt: "2026-09-01T00:05:00.000Z" });
		const retiredComputer = _Computer({ state: ConversationComputerStates.Retired, leaseGeneration: 1, activeExecution: null });
		const lost = new ConversationComputerHistory(_Store({ readStream: vi.fn().mockImplementation(function _ReadLostComputer() { return _Events([_Event(0n, lostComputer, lostLease)]); }), readHead: vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: 0n }) }));
		const retired = new ConversationComputerHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([_Event(0n, retiredComputer, null)])), readHead: vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: 0n }) }));

		await expect(lost.load(_CurrentCommand())).resolves.toEqual(expect.objectContaining({ computer: lostComputer, lease: lostLease }));
		await expect(lost.loadActiveLease(_ActiveCommand())).rejects.toThrow("non-warm or retired");
		await expect(retired.loadActiveLease(_ActiveCommand())).rejects.toThrow("non-warm or retired");
	});

	it("accepts a replacement only after the prior lease becomes terminal and keeps generation monotonic", async function ()
	{
		const releasedComputer = _Computer({ state: ConversationComputerStates.Cold, activeExecution: _Execution({ endedAt: "2026-09-01T00:05:00.000Z" }), updatedAt: "2026-09-01T00:05:00.000Z" });
		const releasedLease = _Lease({ state: ComputerLeaseStates.Released, releasedAt: "2026-09-01T00:05:00.000Z" });
		const claimedComputer = _Computer({ state: ConversationComputerStates.ClaimPending, leaseGeneration: 2, activeExecution: null, updatedAt: "2026-09-01T00:06:00.000Z" });
		const claimedLease = _Lease({ id: "lease-2", generation: 2, sandboxClaimId: "claim-2", sandboxId: null, state: ComputerLeaseStates.Claimed, expiresAt: "2026-09-01T00:26:00.000Z" });
		const replacementComputer = _Computer({ state: ConversationComputerStates.Warm, leaseGeneration: 2, activeExecution: _Execution({ id: "execution-2", leaseId: "lease-2", leaseGeneration: 2, startedAt: "2026-09-01T00:07:00.000Z" }), updatedAt: "2026-09-01T00:07:00.000Z" });
		const replacementLease = _Lease({ id: "lease-2", generation: 2, sandboxClaimId: "claim-2", sandboxId: "sandbox-2", expiresAt: "2026-09-01T00:26:00.000Z" });
		const valid = new ConversationComputerHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([_Event(0n), _Event(1n, releasedComputer, releasedLease), _Event(2n, claimedComputer, claimedLease), _Event(3n, replacementComputer, replacementLease)])), readHead: vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: 3n }) }));
		const directReplacement = new ConversationComputerHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([_Event(0n), _Event(1n, replacementComputer, replacementLease)])), readHead: vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: 1n }) }));

		await expect(valid.loadActiveLease(_ActiveCommand())).resolves.toEqual({ streamName: "conversation-computer-computer-1", revision: 3n, computer: replacementComputer, lease: replacementLease });
		await expect(directReplacement.load(_CurrentCommand())).rejects.toThrow("replaced a nonterminal lease");
	});

	it("rejects a stale active lease before a caller can use its generation", async function ()
	{
		const history = new ConversationComputerHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([_Event(0n)])), readHead: vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: 0n }) }));
		await expect(history.loadActiveLease({ ..._ActiveCommand(), nowEpochMilliseconds: Date.parse("2026-09-01T00:20:00.000Z") })).rejects.toThrow("expired lease");
	});

	it("returns only an open execution that matches the active lease at the checked computer head", async function ()
	{
		const history = new ConversationComputerHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([_Event(0n)])), readHead: vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: 0n }) }));
		const terminalComputer = _Computer({ activeExecution: _Execution({ endedAt: "2026-09-01T00:05:00.000Z" }), updatedAt: "2026-09-01T00:05:00.000Z" });
		const terminal = new ConversationComputerHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([_Event(0n, terminalComputer)])), readHead: vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: 0n }) }));

		await expect(history.loadActiveExecution(_ActiveCommand())).resolves.toEqual(expect.objectContaining({ execution: _Execution() }));
		await expect(terminal.loadActiveExecution(_ActiveCommand())).rejects.toThrow("missing or terminal execution");
	});

	it("rejects a mismatched execution fence and a replacement before the active execution ends", async function ()
	{
		const mismatched = _Computer({ activeExecution: _Execution({ leaseId: "lease-2" }) });
		const replacement = _Computer({ activeExecution: _Execution({ id: "execution-2", startedAt: "2026-09-01T00:01:00.000Z" }), updatedAt: "2026-09-01T00:01:00.000Z" });
		const invalidFence = new ConversationComputerHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([_Event(0n, mismatched)])), readHead: vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: 0n }) }));
		const directReplacement = new ConversationComputerHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([_Event(0n), _Event(1n, replacement)])), readHead: vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: 1n }) }));

		await expect(invalidFence.load(_CurrentCommand())).rejects.toThrow("execution to match its lease");
		await expect(directReplacement.load(_CurrentCommand())).rejects.toThrow("replaced an active execution");
	});

	it("rejects execution metadata that does not attest the stored computer snapshot", async function ()
	{
		const event = _Event(0n);
		const forged = { ...event, metadata: { ...event.metadata, executionId: "execution-2" } };
		const history = new ConversationComputerHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([forged])), readHead: vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: 0n }) }));

		await expect(history.load(_CurrentCommand())).rejects.toThrow("does not match its envelope");
	});

	it("fails closed when a stored snapshot changes silo, conversation, identity, or profile coordinates", async function ()
	{
		const coordinates = [
			_Computer({ siloId: "silo-2" }),
			_Computer({ conversationId: "conversation-2" }),
			_Computer({ agentIdentityId: "identity-2" }),
			_Computer({ profileRevisionId: "profile-2" }),
		];

		for (const computer of coordinates)
		{
			const history = new ConversationComputerHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([_Event(0n, computer)])), readHead: vi.fn().mockResolvedValue({ streamName: "conversation-computer-computer-1", revision: 0n }) }));
			await expect(history.load(_CurrentCommand())).rejects.toThrow("different");
		}
	});
});
