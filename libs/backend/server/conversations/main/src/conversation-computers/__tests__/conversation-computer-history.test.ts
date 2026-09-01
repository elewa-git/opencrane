import { ComputerLeaseStates, ConversationComputerStates, type ComputerLease, type ConversationComputer } from "@opencrane/contracts";
import { HistoryExpectedRevisions, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { describe, expect, it, vi } from "vitest";

import { ConversationComputerHistory } from "../conversation-computer-history";
import type { ConversationComputerAppendCommand, ConversationComputerCurrentCommand } from "../conversation-computer-history.types";

/** Reuses a valid event identifier for the stream's immutable creation record. */
const _EVENT_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";

/** Builds the sole cold computer state that may establish its canonical stream. */
function _ColdComputer(overrides: Partial<ConversationComputer> = {}): ConversationComputer
{
	return { schemaVersion: 1, id: "computer-1", siloId: "silo-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", state: ConversationComputerStates.Cold, leaseGeneration: 0, workspaceCheckpoint: null, activeExecution: null, createdAt: "2026-09-02T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", ...overrides };
}

/** Builds an active lease that can follow cold provisioning only after a lifecycle snapshot. */
function _Lease(overrides: Partial<ComputerLease> = {}): ComputerLease
{
	return { schemaVersion: 1, id: "lease-1", computerId: "computer-1", generation: 1, sandboxClaimId: "claim-1", sandboxId: "sandbox-1", runtimePod: { namespace: "sandbox", serviceAccountName: "agent-sandbox-runtime", podUid: "pod-1" }, state: ComputerLeaseStates.Active, claimedAt: "2026-09-02T00:01:00.000Z", expiresAt: "2026-09-02T00:21:00.000Z", releasedAt: null, ...overrides };
}

/** Builds a warm lifecycle snapshot that follows a proven cold computer. */
function _WarmComputer(overrides: Partial<ConversationComputer> = {}): ConversationComputer
{
	return _ColdComputer({ state: ConversationComputerStates.Warm, leaseGeneration: 1, updatedAt: "2026-09-02T00:01:00.000Z", ...overrides });
}

/** Builds a warm computer whose open execution is fenced to the active lease. */
function _ActiveComputer(overrides: Partial<ConversationComputer> = {}): ConversationComputer
{
	return _WarmComputer({ activeExecution: { id: "execution-1", leaseId: "lease-1", leaseGeneration: 1, startedAt: "2026-09-02T00:01:00.000Z", endedAt: null }, ...overrides });
}

/** Builds metadata that attests precisely to the durable computer-and-lease snapshot. */
function _Metadata(computer: ConversationComputer, lease: ComputerLease | null)
{
	return { siloId: computer.siloId, computerId: computer.id, conversationId: computer.conversationId, agentIdentityId: computer.agentIdentityId, profileRevisionId: computer.profileRevisionId, leaseId: lease?.id ?? null, leaseGeneration: lease?.generation ?? null, leaseState: lease?.state ?? null, runtimePodNamespace: lease?.runtimePod?.namespace ?? null, runtimePodServiceAccountName: lease?.runtimePod?.serviceAccountName ?? null, runtimePodUid: lease?.runtimePod?.podUid ?? null, executionId: computer.activeExecution?.id ?? null, executionLeaseId: computer.activeExecution?.leaseId ?? null, executionLeaseGeneration: computer.activeExecution?.leaseGeneration ?? null, executionEndedAt: computer.activeExecution?.endedAt ?? null };
}

/** Builds the revision-zero provision event that every computer reader must validate first. */
function _ProvisionedEvent(computer: ConversationComputer = _ColdComputer()): HistoryRecordedEvent
{
	return { streamName: `computer-${computer.id}`, id: _EVENT_ID, type: "opencrane.computer-provisioned.v1", data: { computer, lease: null }, metadata: _Metadata(computer, null), revision: 0n, recordedAt: new Date(computer.createdAt) };
}

/** Builds one later lifecycle state snapshot after the immutable provision record. */
function _SnapshotEvent(revision: bigint, computer: ConversationComputer = _WarmComputer(), lease: ComputerLease | null = _Lease()): HistoryRecordedEvent
{
	return { streamName: `computer-${computer.id}`, id: "c0b3a4a1-e99d-4de4-9a04-75bd7c1973c5", type: "opencrane.conversation-computer.v1", data: { computer, lease }, metadata: _Metadata(computer, lease), revision, recordedAt: new Date(computer.updatedAt) };
}

/** Converts a fixed sequence into the narrow HistoryStore streaming interface. */
async function *_Events(events: readonly HistoryRecordedEvent[]): AsyncIterable<HistoryRecordedEvent>
{
	for (const event of events)
		yield event;
}

/** Builds the fixed coordinates used for every computer history load. */
function _CurrentCommand(overrides: Partial<ConversationComputerCurrentCommand> = {}): ConversationComputerCurrentCommand
{
	return { siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", ...overrides };
}

/** Creates a narrow HistoryStore fake that cannot add any general KurrentDB capability to the test. */
function _Store(overrides: Partial<Pick<HistoryStore, "append" | "readHead" | "readStream">> = {}): Pick<HistoryStore, "append" | "readHead" | "readStream">
{
	return { append: vi.fn(), readHead: vi.fn().mockResolvedValue({ streamName: "computer-computer-1", revision: null }), readStream: vi.fn().mockReturnValue(_Events([])), ...overrides };
}

/** Creates a fresh readable stream for helpers that inspect its first event before replaying it. */
function _ProvisionedStore(events: readonly HistoryRecordedEvent[]): Pick<HistoryStore, "append" | "readHead" | "readStream">
{
	return _Store({ readStream: vi.fn().mockImplementation(function _ReadEvents() { return _Events(events); }), readHead: vi.fn().mockResolvedValue({ streamName: "computer-computer-1", revision: events.at(-1)?.revision ?? null }) });
}

describe("ConversationComputerHistory", function _DescribeConversationComputerHistory()
{
	it("provisions only a cold zero-generation computer at no stream on its canonical stream", async function _ProvisionsColdComputer()
	{
		const append = vi.fn().mockResolvedValue({ streamName: "computer-computer-1", revision: 0n });
		const history = new ConversationComputerHistory(_Store({ append }));

		await expect(history.provision({ eventId: _EVENT_ID, computer: _ColdComputer() })).resolves.toEqual({ streamName: "computer-computer-1", revision: 0n });
		expect(append).toHaveBeenCalledWith(expect.objectContaining({ streamName: "computer-computer-1", expectedRevision: HistoryExpectedRevisions.NoStream, events: [expect.objectContaining({ type: "opencrane.computer-provisioned.v1", data: { computer: _ColdComputer(), lease: null } })] }));
	});

	it("rejects a warm, leased, checkpointed, or changed-time computer before it can establish a stream", async function _RejectsUnprovenComputer()
	{
		const append = vi.fn();
		const history = new ConversationComputerHistory(_Store({ append }));
		const checkpointed = _ColdComputer({ workspaceCheckpoint: { artifactRevisionId: "artifact-1", digest: "sha256:checkpoint", format: "v1", checkpointedAt: "2026-09-02T00:00:00.000Z" } });

		await expect(history.provision({ eventId: _EVENT_ID, computer: _WarmComputer() })).rejects.toThrow("requires a lease");
		await expect(history.provision({ eventId: _EVENT_ID, computer: checkpointed })).rejects.toThrow("cold zero-generation");
		expect(append).not.toHaveBeenCalled();
	});

	it("loads a cold anchor then later warm lease state at its checked head", async function _LoadsProvisionedComputer()
	{
		const cold = _ColdComputer();
		const warm = _WarmComputer();
		const lease = _Lease();
		const events = [_ProvisionedEvent(cold), _SnapshotEvent(1n, warm, lease)];
		const history = new ConversationComputerHistory(_Store({ readStream: vi.fn().mockImplementation(function _ReadEvents() { return _Events(events); }), readHead: vi.fn().mockResolvedValue({ streamName: "computer-computer-1", revision: 1n }) }));

		await expect(history.load(_CurrentCommand())).resolves.toEqual({ streamName: "computer-computer-1", revision: 1n, computer: warm, lease });
		await expect(history.loadActiveLease({ ..._CurrentCommand(), nowEpochMilliseconds: Date.parse("2026-09-02T00:10:00.000Z") })).resolves.toEqual(expect.objectContaining({ lease }));
	});

	it("rejects a generic or warm revision-zero snapshot and a lifecycle append without a provision", async function _RejectsUnanchoredHistory()
	{
		const warm = _WarmComputer();
		const genericFirst = _SnapshotEvent(0n, warm, _Lease());
		const history = new ConversationComputerHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([genericFirst])), readHead: vi.fn().mockResolvedValue({ streamName: "computer-computer-1", revision: 0n }) }));
		const append = vi.fn();
		const writer = new ConversationComputerHistory(_Store({ append }));
		const command: ConversationComputerAppendCommand = { expectedRevision: HistoryExpectedRevisions.NoStream, eventId: _EVENT_ID, computer: warm, lease: _Lease() };

		await expect(history.load(_CurrentCommand())).rejects.toThrow("computer provision event at revision zero");
		await expect(writer.append(command)).rejects.toThrow("provisioned nonnegative");
		expect(append).not.toHaveBeenCalled();
	});

	it("fails closed for foreign, noncontiguous, or stale lifecycle history", async function _RejectsInvalidHistory()
	{
		const foreign = { ..._ProvisionedEvent(), streamName: "computer-foreign" };
		const gap = [_ProvisionedEvent(), _SnapshotEvent(2n)];
		const stale = [_ProvisionedEvent(), _SnapshotEvent(1n)];

		await expect(new ConversationComputerHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events([foreign])), readHead: vi.fn().mockResolvedValue({ streamName: "computer-computer-1", revision: 0n }) })).load(_CurrentCommand())).rejects.toThrow("different stream");
		await expect(new ConversationComputerHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events(gap)), readHead: vi.fn().mockResolvedValue({ streamName: "computer-computer-1", revision: 2n }) })).load(_CurrentCommand())).rejects.toThrow("noncontiguous");
		await expect(new ConversationComputerHistory(_Store({ readStream: vi.fn().mockReturnValue(_Events(stale)), readHead: vi.fn().mockResolvedValue({ streamName: "computer-computer-1", revision: 2n }) })).load(_CurrentCommand())).rejects.toThrow("changed while loading");
	});

	it("retains the claim, lease-generation, and Pod-identity fences after cold provisioning", async function _RetainsLeaseFences()
	{
		const cold = _ColdComputer();
		const pending = _ColdComputer({ state: ConversationComputerStates.ClaimPending, leaseGeneration: 1, updatedAt: "2026-09-02T00:01:00.000Z" });
		const claimed = _Lease({ sandboxId: null, runtimePod: null, state: ComputerLeaseStates.Claimed });
		const bypassWarm = _WarmComputer();
		const active = _ActiveComputer();
		const changedPod = _Lease({ runtimePod: { namespace: "sandbox", serviceAccountName: "agent-sandbox-runtime", podUid: "pod-2" } });

		await expect(new ConversationComputerHistory(_ProvisionedStore([_ProvisionedEvent(cold), _SnapshotEvent(1n, pending, claimed), _SnapshotEvent(2n, bypassWarm, _Lease())])).load(_CurrentCommand())).rejects.toThrow("requires claim dispatch");
		await expect(new ConversationComputerHistory(_ProvisionedStore([_ProvisionedEvent(cold), _SnapshotEvent(1n, active, _Lease()), _SnapshotEvent(2n, active, changedPod)])).load(_CurrentCommand())).rejects.toThrow("active sandbox Pod identity");
	});

	it("derives runtime, bootstrap, and server execution coordinates only from a provisioned stream", async function _DerivesExecutionCoordinates()
	{
		const active = _ActiveComputer();
		const history = new ConversationComputerHistory(_ProvisionedStore([_ProvisionedEvent(), _SnapshotEvent(1n, active, _Lease())]));
		const nowEpochMilliseconds = Date.parse("2026-09-02T00:10:00.000Z");

		await expect(history.loadActiveExecutionForRuntime({ siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", profileRevisionId: "profile-1", nowEpochMilliseconds })).resolves.toEqual(expect.objectContaining({ computer: expect.objectContaining({ agentIdentityId: "identity-1" }), execution: expect.objectContaining({ id: "execution-1" }) }));
		await expect(history.loadActiveExecutionForBootstrap({ siloId: "silo-1", computerId: "computer-1", nowEpochMilliseconds })).resolves.toEqual(expect.objectContaining({ computer: expect.objectContaining({ conversationId: "conversation-1", profileRevisionId: "profile-1" }) }));
		await expect(history.loadActiveExecutionForServer({ siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", nowEpochMilliseconds })).resolves.toEqual(expect.objectContaining({ execution: expect.objectContaining({ leaseGeneration: 1 }) }));
		await expect(history.loadActiveExecutionForRuntime({ siloId: "silo-1", computerId: "computer-1", conversationId: "conversation-1", profileRevisionId: "profile-1", nowEpochMilliseconds: Date.parse("2026-09-02T00:21:00.000Z") })).rejects.toThrow("inactive runtime execution");
	});

	it("rejects mismatched execution fences and forged lifecycle-envelope metadata", async function _RejectsForgedExecution()
	{
		const mismatchedExecution = _ActiveComputer({ activeExecution: { id: "execution-1", leaseId: "lease-2", leaseGeneration: 1, startedAt: "2026-09-02T00:01:00.000Z", endedAt: null } });
		const forged = { ..._SnapshotEvent(1n, _ActiveComputer(), _Lease()), metadata: { ..._SnapshotEvent(1n, _ActiveComputer(), _Lease()).metadata, executionId: "execution-2" } };

		await expect(new ConversationComputerHistory(_ProvisionedStore([_ProvisionedEvent(), _SnapshotEvent(1n, mismatchedExecution, _Lease())])).load(_CurrentCommand())).rejects.toThrow("execution to match its lease");
		await expect(new ConversationComputerHistory(_ProvisionedStore([_ProvisionedEvent(), forged])).load(_CurrentCommand())).rejects.toThrow("does not match its envelope");
	});
});
