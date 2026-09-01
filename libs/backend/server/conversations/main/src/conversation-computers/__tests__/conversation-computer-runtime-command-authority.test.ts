import { CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION, ConversationComputerRuntimeCommandKinds, ConversationComputerRuntimeTerminalStates, ComputerLeaseStates, ConversationComputerStates, type ComputerLease, type ConversationComputer, type ConversationComputerRuntimeCommandEnvelope } from "@opencrane/contracts";
import { HistoryExpectedRevisions, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { describe, expect, it, vi } from "vitest";

import { ConversationComputerRuntimeCommandAuthority } from "../conversation-computer-runtime-command-authority";
import type { ConversationComputerRuntimeStartTurnIssueCommand } from "../conversation-computer-runtime-command-authority.types";

/** Reuses a valid participant-input UUID as the target command idempotency key. */
const _COMMAND_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";
/** Reuses a separate valid UUID for a second queued command. */
const _SECOND_COMMAND_ID = "b9d6434b-a3a9-4478-a78f-cf08a479c7f1";
/** Fixes every server clock read in the command-queue tests. */
const _NOW = new Date("2026-09-01T00:10:00.000Z");

/** Builds the current active lease that fences every default command operation. */
function _Lease(overrides: Partial<ComputerLease> = {}): ComputerLease
{
	return { schemaVersion: 1, id: "lease-1", computerId: "computer-1", generation: 2, sandboxClaimId: "claim-1", sandboxId: "sandbox-1", runtimePod: { namespace: "testv5", serviceAccountName: "agent-sandbox-runtime", podUid: "pod-1" }, state: ComputerLeaseStates.Active, claimedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-09-01T00:20:00.000Z", releasedAt: null, ...overrides };
}

/** Builds the current warm computer and its one server-created open execution. */
function _Computer(overrides: Partial<ConversationComputer> = {}): ConversationComputer
{
	return { schemaVersion: 1, id: "computer-1", siloId: "testv5", conversationId: "conversation-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", state: ConversationComputerStates.Warm, leaseGeneration: 2, workspaceCheckpoint: null, activeExecution: { id: "execution-1", leaseId: "lease-1", leaseGeneration: 2, startedAt: "2026-09-01T00:01:00.000Z", endedAt: null }, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:01:00.000Z", ...overrides };
}

/** Builds the complete execution fence returned only by checked computer history. */
function _Active()
{
	const computer = _Computer();
	const lease = _Lease();
	return { streamName: "computer-computer-1", revision: 4n, computer, lease, execution: computer.activeExecution! };
}

/** Builds the target start command that the server stores for one protected participant input. */
function _Command(sequence = 1, commandId = _COMMAND_ID): ConversationComputerRuntimeCommandEnvelope
{
	return {
		protocolVersion: CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION,
		commandId,
		sequence,
		computerId: "computer-1",
		executionId: "execution-1",
		leaseGeneration: 2,
		issuedAt: _NOW.toISOString(),
		expiresAt: "2026-09-01T00:15:00.000Z",
		kind: ConversationComputerRuntimeCommandKinds.StartTurn,
		payload: { inputEntryId: commandId, inputPayloadRef: "payload://31c1f1dc-0010-4f13-9c2f-d3841ffd6651", inputPayloadDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
	};
}

/** Builds one valid immutable command-stream event with duplicated execution fence metadata. */
function _Issued(revision: bigint, command = _Command()): HistoryRecordedEvent
{
	return { streamName: "conversation-computer-runtime-computer-1-execution-1", id: command.commandId, type: "opencrane.conversation-computer-runtime-command-issued.v1", data: { command }, metadata: { computerId: command.computerId, executionId: command.executionId, leaseGeneration: command.leaseGeneration, commandId: command.commandId }, revision, recordedAt: _NOW };
}

/** Builds one durable completion record for a command the runtime reported as terminal. */
function _Completed(revision: bigint, command = _Command()): HistoryRecordedEvent
{
	const report = { protocolVersion: CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION, commandId: command.commandId, computerId: command.computerId, executionId: command.executionId, leaseGeneration: command.leaseGeneration, state: ConversationComputerRuntimeTerminalStates.Completed };
	return { streamName: "conversation-computer-runtime-computer-1-execution-1", id: "4ce5f25a-b6d7-4a19-9cbe-636c159b5f90", type: "opencrane.conversation-computer-runtime-command-completed.v1", data: { report }, metadata: { computerId: report.computerId, executionId: report.executionId, leaseGeneration: report.leaseGeneration, commandId: report.commandId }, revision, recordedAt: _NOW };
}

/** Builds the command terminal success event that must share a transaction with an output message. */
function _OutputRecorded(revision: bigint, command = _Command()): HistoryRecordedEvent
{
	return { streamName: "conversation-computer-runtime-computer-1-execution-1", id: "5bf0d6c2-5215-4cdb-a29f-e3735195b8f7", type: "opencrane.conversation-computer-runtime-command-output-recorded.v1", data: { commandId: command.commandId }, metadata: { computerId: command.computerId, executionId: command.executionId, leaseGeneration: command.leaseGeneration, commandId: command.commandId }, revision, recordedAt: _NOW };
}

/** Builds one finite HistoryStore event sequence for every queue replay. */
async function *_Events(events: readonly HistoryRecordedEvent[]): AsyncIterable<HistoryRecordedEvent>
{
	for (const event of events)
		yield event;
}

/** Builds the authority with controllable command events and exact active-execution reads. */
function _Subject(events: readonly HistoryRecordedEvent[] = [])
{
	const active = _Active();
	const history = {
		appendAtomic: vi.fn().mockResolvedValue([]),
		readHead: vi.fn().mockResolvedValue({ streamName: "conversation-computer-runtime-computer-1-execution-1", revision: events.length === 0 ? null : BigInt(events.length - 1) }),
		readStream: vi.fn().mockImplementation(function _ReadStream() { return _Events(events); }),
	};
	const computers = { loadActiveExecutionForServer: vi.fn().mockResolvedValue(active) };
	return { authority: new ConversationComputerRuntimeCommandAuthority({ history, computers, clock: { now: function _Now() { return _NOW; } } }), history, computers };
}

/** Builds the trusted server-selected input that may issue one target start command. */
function _Issue(overrides: Record<string, unknown> = {}): ConversationComputerRuntimeStartTurnIssueCommand
{
	return { siloId: "testv5", computerId: "computer-1", conversationId: "conversation-1", inputEntryId: _COMMAND_ID, inputPayloadRef: "payload://31c1f1dc-0010-4f13-9c2f-d3841ffd6651", inputPayloadDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const, ...overrides };
}

describe("ConversationComputerRuntimeCommandAuthority", function _CommandAuthoritySuite()
{
	it("prepares an output claim against the command stream head so completion races conflict", async function _PreparesOutputClaim()
	{
		const subject = _Subject([_Issued(0n)]);
		const claim = await subject.authority.prepareOutputClaim({ siloId: "testv5", computerId: "computer-1", conversationId: "conversation-1", commandId: _COMMAND_ID, executionId: "execution-1", leaseGeneration: 2 });
		expect(claim.expectedHead).toEqual({ streamName: "conversation-computer-runtime-computer-1-execution-1", revision: 0n });
		expect(claim.append.events[0]).toMatchObject({ type: "opencrane.conversation-computer-runtime-command-output-recorded.v1", data: { commandId: _COMMAND_ID } });
	});

	it("treats an atomically recorded output as terminal and advances polling to the next command", async function _RecordsTerminalOutput()
	{
		const subject = _Subject([_Issued(0n), _Issued(1n, _Command(2, _SECOND_COMMAND_ID)), _OutputRecorded(2n)]);

		await expect(subject.authority.poll({ siloId: "testv5", computerId: "computer-1", conversationId: "conversation-1" })).resolves.toEqual({ command: _Command(2, _SECOND_COMMAND_ID) });
		await expect(subject.authority.complete({ siloId: "testv5", computerId: "computer-1", conversationId: "conversation-1", report: { protocolVersion: CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION, commandId: _COMMAND_ID, computerId: "computer-1", executionId: "execution-1", leaseGeneration: 2, state: ConversationComputerRuntimeTerminalStates.Completed } })).rejects.toThrow("cannot replace an atomically recorded output");
	});
	it("issues one ordered command under both the checked computer and empty queue heads", async function _IssuesCommand()
	{
		const subject = _Subject();

		const result = await subject.authority.issueStartTurn(_Issue());

		expect(result.command).toEqual(expect.objectContaining({ commandId: _COMMAND_ID, sequence: 1, computerId: "computer-1", executionId: "execution-1", leaseGeneration: 2, kind: ConversationComputerRuntimeCommandKinds.StartTurn }));
		expect(subject.history.appendAtomic).toHaveBeenCalledWith(expect.objectContaining({ expectedHeads: [{ streamName: "computer-computer-1", revision: 4n }, { streamName: "conversation-computer-runtime-computer-1-execution-1", revision: HistoryExpectedRevisions.NoStream }] }));
	});

	it("replays the existing exact input command without writing a second sequence", async function _ReplaysExactIssue()
	{
		const subject = _Subject([_Issued(0n)]);

		await expect(subject.authority.issueStartTurn(_Issue())).resolves.toEqual({ command: _Command() });
		expect(subject.history.appendAtomic).not.toHaveBeenCalled();
	});

	it("returns only the oldest incomplete command and never accepts a runtime cursor", async function _PollsOldestCommand()
	{
		const subject = _Subject([_Issued(0n), _Issued(1n, _Command(2, _SECOND_COMMAND_ID))]);

		await expect(subject.authority.poll({ siloId: "testv5", computerId: "computer-1", conversationId: "conversation-1" })).resolves.toEqual({ command: _Command() });
		expect(subject.computers.loadActiveExecutionForServer).toHaveBeenCalledTimes(2);
	});

	it("refuses a completion that attempts to skip the oldest pending command", async function _RefusesSkippedCompletion()
	{
		const subject = _Subject([_Issued(0n), _Issued(1n, _Command(2, _SECOND_COMMAND_ID))]);

		await expect(subject.authority.complete({ siloId: "testv5", computerId: "computer-1", conversationId: "conversation-1", report: { protocolVersion: CONVERSATION_COMPUTER_RUNTIME_PROTOCOL_VERSION, commandId: _SECOND_COMMAND_ID, computerId: "computer-1", executionId: "execution-1", leaseGeneration: 2, state: ConversationComputerRuntimeTerminalStates.Completed } })).rejects.toThrow("oldest pending command");
		expect(subject.history.appendAtomic).not.toHaveBeenCalled();
	});

	it("fails closed when corrupted command history completes a later command before its head", async function _RejectsSkippedPersistedCompletion()
	{
		const subject = _Subject([_Issued(0n), _Issued(1n, _Command(2, _SECOND_COMMAND_ID)), _Completed(2n, _Command(2, _SECOND_COMMAND_ID))]);

		await expect(subject.authority.poll({ siloId: "testv5", computerId: "computer-1", conversationId: "conversation-1" })).rejects.toThrow("invalid completion");
	});
});
