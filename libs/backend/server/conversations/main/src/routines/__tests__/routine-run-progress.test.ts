import { describe, expect, it, vi } from "vitest";

import type { RoutineRunProgressFacts } from "@opencrane/backend/agents/execution/runs";
import { RoutineRunProgressCancellationDecisions } from "@opencrane/backend/agents/execution/runs";
import { AgentRunStates, AgentRunTerminalReasons, RoutineFiringDisposition, RoutineFiringTrigger } from "@opencrane/models/agents";
import { ConversationGenesisOriginKinds } from "@opencrane/models/conversations";
import { ConversationAuthorKinds, ConversationEntryAudiences, ConversationEntryKinds, ConversationEntryProvenance, ConversationMessageActivations, MessageStates } from "@opencrane/contracts";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ConversationComputerStopAdmissionKinds, ConversationComputerStopDecisions } from "../../computers/interruptions/conversation-computer-stop.types";
import { ConversationComputerTurnProtocolStates, ConversationComputerTurnUnavailableReasons } from "../../computers/turns/conversation-computer-turn-protocol.types";
import type { FrozenConversationComputerTurn } from "../../computers/turns/conversation-computer-turn.types";
import { _RoutineInstructionEntry } from "../routine-occurrence-history.mapper";
import type { RoutineOccurrenceHistoryRecord } from "../routine-occurrence-history.types";
import { ConversationRoutineRunProgressObserver, ConversationRoutineRunProgressReporter, ConversationRoutineRunProgressWaitEvidenceReader } from "../routine-run-progress";
import { RoutineRunProgressWaitKinds, type RoutineRunProgressWait } from "../routine-run-progress.types";

const _DIGEST = `sha256:${"a".repeat(64)}` as const;
const _COMMAND_DIGEST = `sha256:${"b".repeat(64)}` as const;
const _FINISHED_AT = "2026-09-25T10:05:00.000Z";

const _RECORD: RoutineOccurrenceHistoryRecord = {
	siloId: "silo-1", conversationId: "conversation-1",
	origin: { kind: ConversationGenesisOriginKinds.RoutineOccurrence, routineId: "routine-1", routineRevision: 2, firingId: "firing-1", destinationConversationId: "destination-1", trigger: RoutineFiringTrigger.Automatic, scheduledSlot: "2026-09-25T10:00:00.000Z" },
	agentServiceId: "service-1", requesterPrincipalId: "principal-1", requesterIssuer: "issuer-1", requesterSubjectId: "subject-1", requesterAuthenticatedAt: "2026-09-24T10:00:00.000Z",
	task: { taskId: "task-1", taskName: "agents.routines.occurrence/v1", idempotencyKey: "occurrence-1" }, audiencePrincipalIds: ["principal-1"], computerId: "computer-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1",
	createdAt: "2026-09-25T10:00:01.000Z", payloadRef: "conversation-private://instruction", ciphertextDigest: _DIGEST,
};

function _Facts(overrides: Partial<RoutineRunProgressFacts> = {}): RoutineRunProgressFacts
{
	return {
		runId: "run-1", siloId: "silo-1", attempt: 1, state: AgentRunStates.Running, finishedAt: null, terminalReason: null, trigger: "scheduled",
		agentServiceId: "service-1", agentRevisionId: "revision-1", agentIdentityId: "identity-1", principalId: "managed-principal-1", conversationId: "conversation-1", requestIdempotencyKey: "request-1", inputSnapshotDigest: _DIGEST,
		routine: { routineId: "routine-1", routineRevision: 2, firingId: "firing-1", scheduledSlot: "2026-09-25T10:00:00.000Z" },
		executionSubject: { siloId: "silo-1", principalId: "managed-principal-1", agentIdentityId: "identity-1", runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" }, computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 2 }, requester: { siloId: "silo-1", requesterPrincipalId: "principal-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-09-24T10:00:00.000Z" } } as never,
		originalTurnTask: { taskId: "turn-task-1", taskName: "conversation-computer-turn/v1", idempotencyKey: "activation-1" }, cancellation: null,
		...overrides,
	};
}

function _Turn(): FrozenConversationComputerTurn
{
	return {
		bootstrapId: "bootstrap-1", siloId: "silo-1", computerId: "computer-1", lease: { leaseId: "lease-1", leaseGeneration: 2, sandboxClaimId: "computer-1-g2" },
		binding: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", leaseGeneration: 2, agentIdentityId: "identity-1", agentServiceId: "service-1", agentName: "Ada", agentAvatarArtifactRevisionId: null, runId: "run-1", expectedRevision: 1n, maximumEntryBytes: 65_536 },
		latestPendingEntryId: _RoutineInstructionEntry(_RECORD).id, latestPendingEntryPosition: "1", modelAlias: "model-1", maximumBudgetUsd: 1, credentialLifetimeSeconds: 60,
		compile: { runId: "run-1", attempt: 1, promptCompilerVersion: "v1", digest: _DIGEST }, budget: { maxModelTurns: 1, maxCompletionTokens: 100, maxToolInvocations: 1, maxCostUsdMicros: null, maxLoopIterations: 1, wallClockDeadlineEpochMs: Date.parse("2099-01-01T00:00:00.000Z") },
		protocol: { state: ConversationComputerTurnProtocolStates.ToolPending, revision: 2n, steps: [{ state: ConversationComputerTurnProtocolStates.ToolPending, reservation: {} as never, selection: {} as never, result: null }], accounting: { reservedModelCalls: 1, reservedCompletionTokens: 100, reservedToolInvocations: 1, toolResultCyclesFed: 0 }, modelRetry: null, output: null, unavailable: null, cancellation: null },
	};
}

function _Fixture(facts: RoutineRunProgressFacts | null = _Facts(), turn: FrozenConversationComputerTurn = _Turn(), entries: readonly unknown[] = [_RoutineInstructionEntry(_RECORD)], waits: readonly (RoutineRunProgressWait | null)[] = [{ kind: RoutineRunProgressWaitKinds.Approval, id: "tool-1" }])
{
	const sink = { recordRunProgress: vi.fn().mockResolvedValue(undefined) };
	const readWait = vi.fn();
	for (const wait of waits)
		readWait.mockResolvedValueOnce(wait);
	const observer = new ConversationRoutineRunProgressObserver({ read: vi.fn().mockResolvedValue(facts) }, { load: vi.fn().mockResolvedValue(turn) }, { readRecord: vi.fn().mockResolvedValue(_RECORD) }, { read: vi.fn().mockResolvedValue({ streamName: "conversation-conversation-1", genesis: {}, entries }) } as never, { read: readWait });
	return { observer, reporter: new ConversationRoutineRunProgressReporter({ observer, sink }), sink, turn };
}

describe("routine run progress", function _Suite()
{
	it("reports only a saved protocol wait and its successful resume", async function _Waits()
	{
		const wait = { kind: RoutineRunProgressWaitKinds.Approval, id: "tool-1" } as const;
		const f = _Fixture(_Facts(), _Turn(), [_RoutineInstructionEntry(_RECORD)], [wait, null]);
		await f.reporter.recordWaiting(f.turn, wait);
		await f.reporter.recordRunning(f.turn);
		expect(f.sink.recordRunProgress).toHaveBeenNthCalledWith(1, expect.objectContaining({ disposition: RoutineFiringDisposition.Waiting, sourceState: AgentRunStates.Running, resultReference: null, resultDigest: null }));
		expect(f.sink.recordRunProgress).toHaveBeenNthCalledWith(2, expect.objectContaining({ disposition: RoutineFiringDisposition.Running, sourceState: AgentRunStates.Running }));
	});

	it("keeps ordinary interactive runs out of scheduling", async function _Ordinary()
	{
		const f = _Fixture(null);
		await f.reporter.recordWaiting(f.turn, { kind: RoutineRunProgressWaitKinds.Approval, id: "tool-1" });
		expect(f.sink.recordRunProgress).not.toHaveBeenCalled();
	});

	it("rejects internal result latency and an unchanged external wait", async function _InvalidWaits()
	{
		const wait = { kind: RoutineRunProgressWaitKinds.Approval, id: "tool-1" } as const;
		const internal = _Fixture(_Facts(), _Turn(), [_RoutineInstructionEntry(_RECORD)], [null]);
		await expect(internal.reporter.recordWaiting(internal.turn, wait)).rejects.toThrow("exact saved external wait");
		const unchanged = _Fixture(_Facts(), _Turn(), [_RoutineInstructionEntry(_RECORD)], [wait]);
		await expect(unchanged.reporter.recordRunning(unchanged.turn)).rejects.toThrow("every external wait to be cleared");
	});

	it("does not classify a turn without a selected saved tool step as Waiting", async function _MissingSelection()
	{
		const candidates = { assertCurrentForWorkflow: vi.fn() };
		const reader = new ConversationRoutineRunProgressWaitEvidenceReader({ candidates, toolResults: { read: vi.fn() } });
		const turn = _Turn();
		const open = { ...turn, protocol: { ...turn.protocol, state: ConversationComputerTurnProtocolStates.Open, steps: [] } } as FrozenConversationComputerTurn;
		await expect(reader.read(open)).resolves.toBeNull();
		expect(candidates.assertCurrentForWorkflow).not.toHaveBeenCalled();
	});

	it("reports completion only from the exact saved assistant answer", async function _Completed()
	{
		const turn = _Turn();
		const answer = { schemaVersion: 1, id: "answer-1", conversationId: "conversation-1", position: "2", author: { kind: ConversationAuthorKinds.Agent, agentIdentityId: "identity-1", agentServiceId: "service-1", name: "Ada", avatarArtifactRevisionId: null }, provenance: ConversationEntryProvenance.AgentAuthored, visibility: { audience: ConversationEntryAudiences.Conversation }, runId: "run-1", causationId: "instruction", correlationId: "run-1", idempotencyKey: "answer-1", occurredAt: _FINISHED_AT, attestation: null, kind: ConversationEntryKinds.Message, state: MessageStates.Completed, blocks: [], replyToEntryId: turn.latestPendingEntryId, addressedAgentIdentityId: null, activation: ConversationMessageActivations.None } as const;
		const receipt = { streamName: "conversation-conversation-1", expectedRevision: "1", event: { id: "output-event-1", type: "opencrane.conversation-entry.v1", data: { entry: answer }, metadata: {} }, display: null };
		const completed = { ...turn, protocol: { ...turn.protocol, state: ConversationComputerTurnProtocolStates.OutputRecorded, output: { sourceCommandId: receipt.event.id, receipt } } } as FrozenConversationComputerTurn;
		const f = _Fixture(_Facts({ state: AgentRunStates.Completed, finishedAt: _FINISHED_AT, terminalReason: AgentRunTerminalReasons.Success }), completed, [_RoutineInstructionEntry(_RECORD), answer]);
		await f.reporter.recordCompleted(completed);
		expect(f.sink.recordRunProgress).toHaveBeenCalledWith(expect.objectContaining({ disposition: RoutineFiringDisposition.Completed, resultReference: "conversation-conversation-1#answer-1", resultDigest: ___DigestCanonicalJson(receipt as unknown as JsonValue) }));
		const substituted = _Fixture(_Facts({ state: AgentRunStates.Completed, finishedAt: _FINISHED_AT, terminalReason: AgentRunTerminalReasons.Success }), completed, [_RoutineInstructionEntry(_RECORD), { ...answer, runId: "foreign-run" }]);
		await expect(substituted.reporter.recordCompleted(completed)).rejects.toThrow("exact saved assistant answer");
		expect(substituted.sink.recordRunProgress).not.toHaveBeenCalled();
	});

	it("reports uncertainty only from the saved unavailable receipt and recovery state", async function _Unavailable()
	{
		const turn = _Turn();
		const receipt = { ordinal: 1, sourceCommandId: "model-1", reason: ConversationComputerTurnUnavailableReasons.ModelResponseUnavailable } as const;
		const unavailable = { ...turn, protocol: { ...turn.protocol, state: ConversationComputerTurnProtocolStates.ResponseUnavailable, unavailable: receipt } } as FrozenConversationComputerTurn;
		const f = _Fixture(_Facts({ state: AgentRunStates.RecoveryRequired }), unavailable);
		await f.reporter.recordUnavailable(unavailable);
		expect(f.sink.recordRunProgress).toHaveBeenCalledWith(expect.objectContaining({ disposition: RoutineFiringDisposition.Uncertain, resultDigest: ___DigestCanonicalJson(receipt) }));
		const wrongState = _Fixture(_Facts(), unavailable);
		await expect(wrongState.reporter.recordUnavailable(unavailable)).rejects.toThrow("unavailable receipt and recovery run");
	});

	it("reports cancellation only after the saved Stop winner and turn receipt agree", async function _Cancelled()
	{
		const turn = _Turn();
		const cancelled = { ...turn, protocol: { ...turn.protocol, state: ConversationComputerTurnProtocolStates.Cancelled, cancellation: { commandId: "stop-1", commandDigest: _COMMAND_DIGEST, occurredAt: "2026-09-25T10:04:00.000Z" } } } as FrozenConversationComputerTurn;
		const cancellation = { commandId: "stop-1", commandDigest: _COMMAND_DIGEST, bootstrapId: turn.bootstrapId, decision: RoutineRunProgressCancellationDecisions.CancellationWon, decidedAt: _FINISHED_AT };
		const f = _Fixture(_Facts({ state: AgentRunStates.Cancelled, finishedAt: _FINISHED_AT, terminalReason: AgentRunTerminalReasons.UserCancelled, cancellation }), cancelled);
		const admission = { kind: ConversationComputerStopAdmissionKinds.Target, command: { commandId: "stop-1", siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", generation: 2, causationId: "stop-entry", causationPosition: "3", requester: { principalId: "principal-1", subjectId: "subject-1", issuer: "issuer-1", authenticatedAt: "2026-09-25T10:03:00.000Z" } }, commandDigest: _COMMAND_DIGEST, target: { bootstrapId: turn.bootstrapId, runId: "run-1", attempt: 1, leaseId: "lease-1", leaseGeneration: 2 }, originalTurnTask: _RECORD.task, cancellationTask: _RECORD.task, requestedAt: "2026-09-25T10:04:00.000Z", authorizationDecisionDigest: _DIGEST } as const;
		await f.reporter.recordStop(admission, { decision: ConversationComputerStopDecisions.CancellationWon, published: true, outputReceiptDigest: null });
		expect(f.sink.recordRunProgress).toHaveBeenCalledWith(expect.objectContaining({ disposition: RoutineFiringDisposition.Cancelled, sourceCancellationCommandId: "stop-1" }));
		const wrong = _Fixture(_Facts({ state: AgentRunStates.Cancelled, finishedAt: _FINISHED_AT, terminalReason: AgentRunTerminalReasons.UserCancelled, cancellation: { ...cancellation, decision: RoutineRunProgressCancellationDecisions.OutputWon } }), cancelled);
		await expect(wrong.reporter.recordStop(admission, { decision: ConversationComputerStopDecisions.CancellationWon, published: false, outputReceiptDigest: null })).rejects.toThrow("finalized cancellation winner");
		const preterminal = _Fixture(_Facts({ state: AgentRunStates.Cancelling, cancellation: { ...cancellation, decision: null, decidedAt: null } }), cancelled);
		await expect(preterminal.reporter.recordStop(admission, { decision: ConversationComputerStopDecisions.CancellationWon, published: true, outputReceiptDigest: null })).rejects.toThrow("finalized cancellation winner");
		await expect(f.reporter.recordStop({ ...admission, commandDigest: _DIGEST }, { decision: ConversationComputerStopDecisions.CancellationWon, published: false, outputReceiptDigest: null })).rejects.toThrow("exact saved cancellation admission");
	});

	it("propagates scheduling acknowledgement failures", async function _Acknowledgement()
	{
		const f = _Fixture();
		f.sink.recordRunProgress.mockRejectedValueOnce(new Error("scheduling unavailable"));
		await expect(f.reporter.recordWaiting(f.turn, { kind: RoutineRunProgressWaitKinds.Approval, id: "tool-1" })).rejects.toThrow("scheduling unavailable");
	});
});
