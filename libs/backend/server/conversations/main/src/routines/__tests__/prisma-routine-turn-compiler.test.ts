import { ComputerLeaseStates, ConversationAuthorKinds, ConversationComputerStates, ConversationEntryProvenance, ConversationMessageActivations, MessageStates } from "@opencrane/contracts";
import { type HistoryReadRequest, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { RoutineFiringTrigger } from "@opencrane/models/agents";
import { ConversationGenesisOriginKinds } from "@opencrane/models/conversations";
import { describe, expect, it, vi } from "vitest";

import { _RoutineEventId, _RoutineGenesis, _RoutineInstructionEntry } from "../routine-occurrence-history.mapper";
import { PrismaRoutineTurnCompilerRepository } from "../prisma-routine-turn-compiler";
import type { RoutineOccurrenceHistoryRecord } from "../routine-occurrence-history.types";
import { RoutineTurnDispatchKinds } from "../routine-turn-compiler.types";

const _MOCKS = vi.hoisted(function _Mocks()
{
	return { compile: vi.fn(), revalidate: vi.fn(), recover: vi.fn(), prompt: vi.fn() };
});

vi.mock("@opencrane/backend/agents/execution/runs", function _Runs()
{
	return { PrismaRoutineRunSnapshotRecoveryRepository: class { public recover = _MOCKS.recover; } };
});
vi.mock("@opencrane/backend/agents/execution/inputs", function _Inputs()
{
	return { __CompileRunInput: _MOCKS.compile, __RevalidateRunInputSnapshot: _MOCKS.revalidate, __RunInputAuthorityExpiresAt: vi.fn(function _Expires() { return "2099-09-25T10:00:00.000Z"; }), SessionAssemblyLoadOutcomes: { Denied: "denied" }, TransactionBoundProductResourceAuthorizationSource: class {} };
});
vi.mock("../routine-run-input-composition", function _Composition()
{
	return { _RoutineExecutionSubject: vi.fn(), _RoutinePromptCompiler: _MOCKS.prompt };
});

const _RECORD: RoutineOccurrenceHistoryRecord = {
	siloId: "silo-1", conversationId: "occurrence-1",
	origin: { kind: ConversationGenesisOriginKinds.RoutineOccurrence, routineId: "routine-1", routineRevision: 2, firingId: "firing-1", destinationConversationId: "destination-1", trigger: RoutineFiringTrigger.Automatic, scheduledSlot: "2026-09-25T10:00:00.000Z" },
	agentServiceId: "service-1", requesterPrincipalId: "principal-1", requesterIssuer: "https://issuer.example", requesterSubjectId: "subject-1", requesterAuthenticatedAt: "2026-09-24T12:00:00.000Z",
	task: { taskId: "task-1", taskName: "routine-occurrence", idempotencyKey: "occurrence-1" }, audiencePrincipalIds: ["principal-1"], computerId: "computer-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", createdAt: "2026-09-25T10:00:01.000Z", payloadRef: "conversation-private://payload-1", ciphertextDigest: `sha256:${"a".repeat(64)}`,
};
const _COMPUTER = { schemaVersion: 1 as const, id: "computer-1", siloId: "silo-1", conversationId: "occurrence-1", agentIdentityId: "identity-1", profileRevisionId: "profile-1", state: ConversationComputerStates.Warm, leaseGeneration: 1, workspaceCheckpoint: null, createdAt: _RECORD.createdAt, updatedAt: _RECORD.createdAt };
const _LEASE = { schemaVersion: 1 as const, id: "lease-1", computerId: "computer-1", generation: 1, sandboxClaimId: "computer-1-g1", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.computers.svc.cluster.local", state: ComputerLeaseStates.Active, claimedAt: _RECORD.createdAt, expiresAt: "2099-09-25T10:00:00.000Z", releasedAt: null };
const _COMMAND = { computer: { siloId: "silo-1", conversationId: "occurrence-1", computerId: "computer-1", agentIdentityId: "identity-1" }, profileRevisionId: "profile-1", lease: { leaseId: "lease-1", leaseGeneration: 1, sandboxClaimId: "computer-1-g1" } };
const _RUN_ID = _RoutineEventId("run", _RECORD.conversationId);
const _SNAPSHOT = { runId: _RUN_ID, attempt: 1, inputSnapshotDigest: `sha256:${"b".repeat(64)}`, digest: `sha256:${"c".repeat(64)}` };
const _COMPILED = { runId: _RUN_ID, attempt: 1, promptCompilerVersion: "routine-test", digest: `sha256:${"d".repeat(64)}`, model: { modelAlias: "model-1" } };

/** Stores the exact computer and conversation streams needed by the compiler. */
class _History implements Pick<HistoryStore, "readStream">
{
	public readonly streams = new Map<string, HistoryRecordedEvent[]>();
	public constructor()
	{
		const genesis = _RoutineGenesis(_RECORD);
		const entry = _RoutineInstructionEntry(_RECORD);
		this.streams.set(`conversation-${_RECORD.conversationId}`, [
			{ id: _RoutineEventId("genesis", _RECORD.conversationId), type: "opencrane.conversation-created.v1", data: { genesis }, metadata: { siloId: _RECORD.siloId, conversationId: _RECORD.conversationId, causationId: "genesis", correlationId: "genesis", idempotencyKey: "genesis" }, streamName: `conversation-${_RECORD.conversationId}`, revision: 0n, recordedAt: new Date(_RECORD.createdAt) },
			{ id: entry.id, type: "opencrane.conversation-entry.v1", data: { entry }, metadata: { siloId: _RECORD.siloId, conversationId: _RECORD.conversationId, causationId: entry.causationId, correlationId: entry.correlationId, idempotencyKey: entry.idempotencyKey }, streamName: `conversation-${_RECORD.conversationId}`, revision: 1n, recordedAt: new Date(_RECORD.createdAt) },
		]);
		this.streams.set(`conversation-computer-${_RECORD.computerId}`, [{ id: _RoutineEventId("computer", _RECORD.conversationId), type: "opencrane.conversation-computer.v1", data: { computer: _COMPUTER, lease: _LEASE }, metadata: { siloId: _RECORD.siloId, computerId: _RECORD.computerId, conversationId: _RECORD.conversationId, agentIdentityId: _RECORD.agentIdentityId, profileRevisionId: _RECORD.profileRevisionId, leaseId: _LEASE.id, leaseGeneration: String(_LEASE.generation), leaseState: _LEASE.state }, streamName: `conversation-computer-${_RECORD.computerId}`, revision: 0n, recordedAt: new Date(_RECORD.createdAt) }]);
	}
	public async readHead(streamName: string): Promise<{ readonly streamName: string; readonly revision: bigint | null }>
	{
		const events = this.streams.get(streamName) ?? [];
		return { streamName, revision: events.length === 0 ? null : BigInt(events.length - 1) };
	}
	public async *readStream(request: HistoryReadRequest): AsyncIterable<HistoryRecordedEvent>
	{
		for (const event of this.streams.get(request.streamName) ?? [])
			yield event;
	}
}

/** Builds the compiler with read-only routine and workflow seams. */
function _Fixture(record: RoutineOccurrenceHistoryRecord | null = _RECORD)
{
	vi.clearAllMocks();
	_MOCKS.recover.mockResolvedValue(_SNAPSHOT);
	_MOCKS.revalidate.mockResolvedValue({ outcome: "loaded", value: { executionSubject: { runScope: { runId: _RUN_ID } } } });
	_MOCKS.compile.mockResolvedValue(_COMPILED);
	const history = new _History();
	const transaction = { agentService: { findUnique: vi.fn().mockResolvedValue({ name: "Company" }) }, agentRun: { findUnique: vi.fn().mockResolvedValue({ workflowTaskId: _RoutineEventId("turn-task", _RECORD.conversationId), workflowTaskName: "conversation-computer-turn", workflowTaskKey: _RoutineEventId("activation", _RECORD.conversationId) }) } };
	const occurrences = { readRecord: vi.fn().mockResolvedValue(record) };
	const routines = { recover: vi.fn().mockResolvedValue(true) };
	const routinesFactory = vi.fn().mockReturnValue(routines);
	const dependencies = { occurrences, history, routines: routinesFactory, cipher: {}, membership: {}, maximumTurnCostUsdMicros: 500_000 } as never;
	const repository = new PrismaRoutineTurnCompilerRepository(transaction as never, dependencies);
	return { repository, occurrences, routines, transaction, history };
}

describe("PrismaRoutineTurnCompilerRepository", function _Suite()
{
	it("compiles the exact saved routine snapshot and attested instruction history", async function _Compiles()
	{
		const fixture = _Fixture();

		await expect(fixture.repository.compile(_COMMAND)).resolves.toMatchObject({ binding: { runId: _RUN_ID, leaseGeneration: 1 }, compiledInput: _COMPILED, latestPendingEntryId: _RoutineEventId("instruction", _RECORD.conversationId) });
		expect(fixture.routines.recover).toHaveBeenCalledOnce();
		expect(_MOCKS.compile).toHaveBeenCalledWith(_SNAPSHOT, 1, undefined);
	});

	it("returns null when the prepared occurrence or admitted run is absent", async function _Absent()
	{
		await expect(_Fixture(null).repository.compile(_COMMAND)).resolves.toBeNull();
		const absentRun = _Fixture();
		_MOCKS.recover.mockResolvedValue(null);
		await expect(absentRun.repository.compile(_COMMAND)).resolves.toBeNull();
	});

	it.each([
		["computer", { computer: { ..._COMMAND.computer, computerId: "other" } }],
		["lease", { lease: { ..._COMMAND.lease, leaseGeneration: 2 } }],
		["profile", { profileRevisionId: "profile-other" }],
	] as const)("rejects a substituted %s", async function _Mismatch(_name, patch)
	{
		await expect(_Fixture().repository.compile({ ..._COMMAND, ...patch })).rejects.toThrow(/another computer or lease|generation|history/iu);
	});

	it("rejects a missing or ended active lease without compiling or recovery writes", async function _LeaseEnded()
	{
		const fixture = _Fixture();
		const events = fixture.history.streams.get(`conversation-computer-${_RECORD.computerId}`)!;
		events[0] = { ...events[0]!, data: { computer: _COMPUTER, lease: { ..._LEASE, expiresAt: "2026-09-25T10:01:00.000Z" } } };
		await expect(fixture.repository.compile(_COMMAND)).resolves.toBeNull();
		expect(_MOCKS.recover).not.toHaveBeenCalled();
		expect(_MOCKS.compile).not.toHaveBeenCalled();
	});

	it("rejects saved stage receipt substitution before compilation", async function _StageReceipt()
	{
		const fixture = _Fixture();
		fixture.routines.recover.mockResolvedValue(false);
		await expect(fixture.repository.dispatch(_COMMAND)).rejects.toThrow("saved stage receipts");
		expect(_MOCKS.compile).not.toHaveBeenCalled();
	});

	it("rejects another saved turn task without interactive fallback", async function _TaskReceipt()
	{
		const fixture = _Fixture();
		fixture.transaction.agentRun.findUnique.mockResolvedValue({ workflowTaskId: _RoutineEventId("turn-task", _RECORD.conversationId), workflowTaskName: "conversation-computer-turn", workflowTaskKey: _RoutineEventId("another", _RECORD.conversationId) });
		await expect(fixture.repository.dispatch(_COMMAND)).rejects.toThrow("admitted turn task");
		expect(_MOCKS.compile).not.toHaveBeenCalled();
	});

	it("rechecks current execution permission before returning compiled input", async function _Revoked()
	{
		const fixture = _Fixture();
		_MOCKS.revalidate.mockResolvedValue({ outcome: "denied", reason: "identity_unavailable" });
		await expect(fixture.repository.dispatch(_COMMAND)).rejects.toThrow("current execution authority");
		expect(_MOCKS.compile).not.toHaveBeenCalled();
	});

	it("fails closed when the attested instruction is missing or substituted", async function _Instruction()
	{
		await expect(_Fixture(null).repository.dispatch(_COMMAND)).rejects.toThrow("attested instruction record");
		const fixture = _Fixture();
		const entries = fixture.history.streams.get(`conversation-${_RECORD.conversationId}`)!;
		entries[1] = { ...entries[1]!, data: { entry: { ..._RoutineInstructionEntry(_RECORD), addressedAgentIdentityId: "another-identity" } } };
		await expect(fixture.repository.dispatch(_COMMAND)).rejects.toThrow("attested history");
		expect(_MOCKS.recover).not.toHaveBeenCalled();
	});

	it("replays the original pending prefix and permits an unanswered instruction anchor", async function _Anchor()
	{
		const fixture = _Fixture();
		await expect(fixture.repository.compile(_COMMAND, { expectedRevision: 1n, latestPendingEntryId: _RoutineEventId("instruction", _RECORD.conversationId) })).resolves.toMatchObject({ latestPendingEntryPosition: "1" });
		await expect(fixture.repository.compile(_COMMAND, { expectedRevision: 1n, latestPendingEntryId: "other" })).rejects.toThrow("history anchor");
	});

	it("rejects a revision-zero prefix that cannot contain the attested instruction", async function _EmptyPrefix()
	{
		const fixture = _Fixture();

		await expect(fixture.repository.compile(_COMMAND, { expectedRevision: 0n, latestPendingEntryId: _RoutineEventId("instruction", _RECORD.conversationId) })).rejects.toThrow("history anchor");
		await expect(fixture.repository.dispatch(_COMMAND, { expectedRevision: 0n, latestPendingEntryId: _RoutineEventId("instruction", _RECORD.conversationId) })).rejects.toThrow("history anchor");
	});

	it("rejects a direct compile when the selected prefix substitutes the attested instruction", async function _CompileInstruction()
	{
		const fixture = _Fixture();
		const entries = fixture.history.streams.get(`conversation-${_RECORD.conversationId}`)!;
		entries[1] = { ...entries[1]!, data: { entry: { ..._RoutineInstructionEntry(_RECORD), addressedAgentIdentityId: "another-identity" } } };

		await expect(fixture.repository.compile(_COMMAND, { expectedRevision: 1n, latestPendingEntryId: _RoutineEventId("instruction", _RECORD.conversationId) })).rejects.toThrow("history anchor");
	});

	it("keeps an unanswered routine-owned turn from falling back to interactive admission", async function _RoutineDispatch()
	{
		const fixture = _Fixture();
		_MOCKS.recover.mockResolvedValue(null);

		await expect(fixture.repository.dispatch(_COMMAND)).resolves.toEqual({ kind: RoutineTurnDispatchKinds.Routine });
	});

	it("routes an answered initial instruction to interactive follow-up", async function _InteractiveDispatch()
	{
		const fixture = _Fixture();
		const entries = fixture.history.streams.get(`conversation-${_RECORD.conversationId}`)!;
		const answerId = _RoutineEventId("answer-dispatch", _RECORD.conversationId);
		entries.push({ ...entries[1]!, id: answerId, revision: 2n, data: { entry: { ...(entries[1]!.data as { entry: Record<string, unknown> }).entry, id: answerId, idempotencyKey: answerId, position: "2", runId: _RoutineEventId("run", _RECORD.conversationId), author: { kind: ConversationAuthorKinds.Agent, agentIdentityId: _RECORD.agentIdentityId, agentServiceId: _RECORD.agentServiceId, name: "Company", avatarArtifactRevisionId: null }, provenance: ConversationEntryProvenance.AgentAuthored, attestation: null, activation: ConversationMessageActivations.None, state: MessageStates.Completed, causationId: _RECORD.origin.firingId, correlationId: _RECORD.origin.firingId, replyToEntryId: _RoutineEventId("instruction", _RECORD.conversationId) } }, metadata: { ...(entries[1]!.metadata), causationId: _RECORD.origin.firingId, correlationId: _RECORD.origin.firingId, idempotencyKey: answerId } });

		await expect(fixture.repository.dispatch(_COMMAND)).resolves.toEqual({ kind: RoutineTurnDispatchKinds.Interactive });
		expect(_MOCKS.compile).not.toHaveBeenCalled();
	});
});
