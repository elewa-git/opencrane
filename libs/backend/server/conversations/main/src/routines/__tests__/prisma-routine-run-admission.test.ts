import { AgentRoutineFiringDisposition, AgentRoutineFiringTrigger, type AgentRoutineFiring, type AgentRun, type Prisma, type PrismaClient, type RunInputSnapshot as StoredSnapshot } from "@prisma/client";

import { __CreatePrismaSessionAssemblyAuthorities } from "@opencrane/backend/agents/execution/inputs";
import { RunExecutionPersonalMemoryPolicies, RunExecutionPersonaPolicies, type InitialRunAuthority, type RunAdmissionCommand, type RunAdmissionRepository } from "@opencrane/backend/agents/execution/runs";
import type { RoutineOccurrenceRunAdmissionRepository, RoutineRunAdmissionInput } from "@opencrane/backend/server/agents/scheduling/contract";
import { _ComputerScopeOf, _LeaseScopeOf, ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import { ComputerLeaseStates, ConversationComputerStates } from "@opencrane/contracts";
import { HistoryExpectedRevisions, type HistoryAppend, type HistoryAppendReceipt, type HistoryReadRequest, type HistoryRecordedEvent, type HistoryStore, type HistoryStreamHead } from "@opencrane/backend/server/infra/history-store";
import { ExecutionSubjectMembershipKinds, RoutineFiringTrigger, type ExecutionSubject } from "@opencrane/models/agents";
import { ConversationGenesisOriginKinds } from "@opencrane/models/conversations";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CONVERSATION_COMPUTER_TURN_TASK } from "../../computers/turns/workflow/conversation-computer-turn-task";
import { PrismaRoutineRunAdmissionUnitOfWork } from "../prisma-routine-run-admission";
import { _RoutineActivationCommand, _RoutineActivationReceipt } from "../routine-computer-activation.mapper";
import { _RoutineEventId, _RoutinePreparationReceipt } from "../routine-occurrence-history.mapper";
import type { RoutineOccurrenceHistoryRecord } from "../routine-occurrence-history.types";

const _assembly = vi.hoisted(function _AssemblyMocks()
{
	return { createAuthorities: vi.fn(), compile: vi.fn() };
});

vi.mock("@opencrane/backend/agents/execution/inputs", async function _MockInputs(importOriginal)
{
	const actual = await importOriginal<typeof import("@opencrane/backend/agents/execution/inputs")>();
	return { ...actual, __CreatePrismaSessionAssemblyAuthorities: _assembly.createAuthorities, __CompileRunInput: _assembly.compile };
});

const _PROFILE_REVISION = `sha256:${"a".repeat(64)}`;
const _RECORD: RoutineOccurrenceHistoryRecord = {
	siloId: "silo-1", conversationId: "conversation-1",
	origin: { kind: ConversationGenesisOriginKinds.RoutineOccurrence, routineId: "routine-1", routineRevision: 2, firingId: "firing-1", destinationConversationId: "destination-1", trigger: RoutineFiringTrigger.Automatic, scheduledSlot: "2026-09-25T10:00:00.000Z" },
	agentServiceId: "service-1", requesterPrincipalId: "requester-original", requesterIssuer: "https://issuer.example", requesterSubjectId: "subject-original", requesterAuthenticatedAt: "2026-09-24T12:00:00.000Z",
	task: { taskId: "occurrence-task-1", taskName: "routine-occurrence", idempotencyKey: "firing-1" }, audiencePrincipalIds: ["requester-original"], computerId: "computer-1", agentIdentityId: "identity-1", profileRevisionId: _PROFILE_REVISION,
	createdAt: "2026-09-25T10:00:01.000Z", payloadRef: "conversation-private://payload-1", ciphertextDigest: `sha256:${"b".repeat(64)}`,
};

/** Keeps one active computer history in revision order. */
class _MemoryHistoryStore implements Pick<HistoryStore, "append" | "readHead" | "readStream">
{
	/** Stored events by immutable stream name. */
	public readonly streams = new Map<string, HistoryRecordedEvent[]>();

	/** Read one stable stream snapshot. */
	public async *readStream(request: HistoryReadRequest): AsyncIterable<HistoryRecordedEvent>
	{
		for (const event of [...(this.streams.get(request.streamName) ?? [])])
			yield event;
	}

	/** Return the current in-memory stream head. */
	public async readHead(streamName: string): Promise<HistoryStreamHead>
	{
		const events = this.streams.get(streamName) ?? [];
		return { streamName, revision: events.length === 0 ? null : BigInt(events.length - 1) };
	}

	/** Append only at the caller's exact expected revision. */
	public async append(command: HistoryAppend): Promise<HistoryAppendReceipt>
	{
		const events = this.streams.get(command.streamName) ?? [];
		const head = events.length === 0 ? null : BigInt(events.length - 1);
		const expected = command.expectedRevision === HistoryExpectedRevisions.NoStream ? null : command.expectedRevision;
		if (expected !== head)
			throw new Error("WrongExpectedVersion");
		for (const event of command.events)
			events.push({ ...event, streamName: command.streamName, revision: BigInt(events.length), recordedAt: new Date("2026-09-25T10:00:02.000Z") });
		this.streams.set(command.streamName, events);
		return { streamName: command.streamName, revision: BigInt(events.length - 1) };
	}
}

/** Create the complete managed execution subject returned inside run admission. */
function _ExecutionSubject(command: RunAdmissionCommand, run: InitialRunAuthority): ExecutionSubject
{
	if (command.trigger === "interactive")
		throw new Error("routine test authority received an interactive command");
	const requesterMembership = { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: _RECORD.requesterPrincipalId, siloId: command.siloId, revision: 7, assertionId: "membership-1", payloadDigest: `sha256:${"c".repeat(64)}`, decisionEvidenceId: "membership-decision-1", trustedUntil: "2099-09-25T00:00:00.000Z" } as const;
	return {
		schemaVersion: 1, siloId: command.siloId, agentIdentityId: _RECORD.agentIdentityId, principalId: "company-principal",
		identity: { agentIdentityId: _RECORD.agentIdentityId, principalId: "company-principal", siloId: command.siloId, headRevision: "4", headDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "identity-decision-1", verifiedAt: "2026-09-25T10:00:02.000Z" },
		membership: { kind: ExecutionSubjectMembershipKinds.Managed, siloId: command.siloId, principalId: "company-principal", agentServiceId: command.agentServiceId, agentRevisionId: run.agentRevisionId, agentRevisionDigest: `sha256:${"e".repeat(64)}`, decisionEvidenceId: "company-decision-1", trustedUntil: "2099-09-25T00:00:00.000Z" },
		capability: { agentIdentityId: _RECORD.agentIdentityId, computerId: _RECORD.computerId, capabilitySetDigest: `sha256:${"f".repeat(64)}`, effectiveContractDigest: `sha256:${"0".repeat(64)}`, decisionEvidenceId: "capability-decision-1", decidedAt: "2026-09-25T10:00:02.000Z" },
		runScope: { siloId: command.siloId, runId: command.runId, attempt: 1, agentServiceId: command.agentServiceId, agentRevisionId: run.agentRevisionId },
		computerScope: { siloId: command.siloId, computerId: _RECORD.computerId, leaseId: "lease-1", leaseGeneration: 1 },
		requester: { membership: requesterMembership, siloId: command.siloId, requesterPrincipalId: _RECORD.requesterPrincipalId, requestIdempotencyKey: command.requestIdempotencyKey, authenticatedAt: _RECORD.requesterAuthenticatedAt },
		admission: { authorizingPrincipalId: _RECORD.requesterPrincipalId, decisionEvidenceId: "admission-decision-1", admittedAt: "2026-09-25T10:00:03.000Z" },
	};
}

/** Supply deterministic input sources while retaining the actual run admission unit of work. */
function _Authorities(admission: RunAdmissionRepository, currentExecutionAuthority: () => boolean): ReturnType<typeof __CreatePrismaSessionAssemblyAuthorities>
{
	const loaded = <Value>(value: Value) => ({ outcome: "loaded", value } as const);
	return {
		admission,
		runAuthority: { load: async function _LoadRun(command) { return loaded({ agentServiceId: command.agentServiceId, agentRevisionId: "revision-1", executionPolicy: { persona: RunExecutionPersonaPolicies.None, personalMemory: RunExecutionPersonalMemoryPolicies.None }, promptCompilerVersion: "prompt-v1", trigger: command.trigger }); } },
		executionSubject: { load: async function _LoadSubject(command, run) { return currentExecutionAuthority() ? loaded(_ExecutionSubject(command, run)) : { outcome: "denied", reason: "identity_unavailable" }; } },
		approvedPersona: { load: async function _LoadPersona() { return loaded({ personaId: null, personaRevisionId: null }); } },
		conversationContext: { load: async function _LoadConversation(command) { return loaded({ messageIds: [command.requestIdempotencyKey] }); } },
		preferenceFacts: { load: async function _LoadPreferences() { return loaded([]); } },
		memoryScope: { load: async function _LoadMemory() { return loaded({ memoryQueryPolicy: { scope: "none" }, datasetId: null }); } },
		toolPolicy: { load: async function _LoadTools() { return loaded({ modelDefinitionId: "model-1", modelRoute: { alias: "target" }, mcpTools: [], skillRevisionIds: [], artifactRevisionIds: [] }); } },
		skillEligibility: { load: async function _LoadSkills() { return loaded(null); } },
		productAuthorization: { load: async function _LoadAuthorization() { return loaded(null); }, verifyExisting: async function _VerifyAuthorization() { return loaded(null); } },
		budgetPolicy: { load: async function _LoadBudget() { return loaded({ budgetPolicy: { maxModelTurns: 1, maxCompletionTokens: 1000, maxCostUsdMicros: null, maxToolInvocations: 0, maxLoopIterations: 1, wallClockDeadlineEpochMs: 4_102_444_800_000 } }); } },
	};
}

/** Seed the active realization whose published activation receipt admission must replay. */
async function _Input(history: _MemoryHistoryStore): Promise<RoutineRunAdmissionInput>
{
	const computers = new ConversationComputerHistory(history);
	await computers.append({
		expectedRevision: HistoryExpectedRevisions.NoStream, eventId: "0a1b2c3d-0000-5000-8000-000000000001",
		computer: { schemaVersion: 1, id: _RECORD.computerId, siloId: _RECORD.siloId, conversationId: _RECORD.conversationId, agentIdentityId: _RECORD.agentIdentityId, profileRevisionId: _RECORD.profileRevisionId, state: ConversationComputerStates.Warm, leaseGeneration: 1, workspaceCheckpoint: null, createdAt: _RECORD.createdAt, updatedAt: "2026-09-25T10:00:02.000Z" },
		lease: { schemaVersion: 1, id: "lease-1", computerId: _RECORD.computerId, generation: 1, sandboxClaimId: "computer-1-g1", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.computers.svc.cluster.local", state: ComputerLeaseStates.Active, claimedAt: "2026-09-25T10:00:02.000Z", expiresAt: "2099-09-25T11:00:02.000Z", releasedAt: null },
	});
	const current = await computers.load({ computer: { siloId: _RECORD.siloId, conversationId: _RECORD.conversationId, computerId: _RECORD.computerId, agentIdentityId: _RECORD.agentIdentityId }, profileRevisionId: _RECORD.profileRevisionId });
	if (current?.lease === null || current === null)
		throw new Error("test computer did not become active");
	const preparation = _RoutinePreparationReceipt(_RECORD);
	const activation = _RoutineActivationReceipt(_RECORD, preparation, current, { computer: _ComputerScopeOf(current.computer), lease: { ..._LeaseScopeOf(current.lease), expiresAt: current.lease.expiresAt } });
	return {
		siloId: _RECORD.siloId, firingId: _RECORD.origin.firingId, routineId: _RECORD.origin.routineId, routineRevision: _RECORD.origin.routineRevision, task: _RECORD.task, admittedRunId: null,
		trigger: _RECORD.origin.trigger, scheduledSlot: _RECORD.origin.scheduledSlot, conversationId: _RECORD.conversationId, destinationConversationId: _RECORD.origin.destinationConversationId, selectedManagedServiceId: _RECORD.agentServiceId,
		requesterPrincipalId: _RECORD.requesterPrincipalId, requesterIssuer: _RECORD.requesterIssuer, requesterSubjectId: _RECORD.requesterSubjectId, requesterAuthenticatedAt: _RECORD.requesterAuthenticatedAt, audiencePrincipalIds: [..._RECORD.audiencePrincipalIds], preparation, activation,
	};
}

/** Compose actual run/receipt repositories over rollback-capable in-memory Prisma delegates. */
async function _Fixture()
{
	const history = new _MemoryHistoryStore();
	const input = await _Input(history);
	const state = { runs: [] as AgentRun[], snapshots: [] as StoredSnapshot[], tasks: [] as { taskId: string; taskName: string; idempotencyKey: string }[], firingRunId: null as string | null, refused: false };
	const controls = { authority: true, currentExecutionAuthority: true, receiptMismatch: false, bindFailure: false, loseCommitAcknowledgement: false };
	const transaction = {
		agentRun: {
			findUnique: vi.fn(async function _FindRun({ where }: { where: Prisma.AgentRunWhereUniqueInput })
			{
				if (where.siloId_requestIdempotencyKey !== undefined)
					return state.runs.find(run => run.siloId === where.siloId_requestIdempotencyKey!.siloId && run.requestIdempotencyKey === where.siloId_requestIdempotencyKey!.requestIdempotencyKey) ?? null;
				const id = where.id_attempt?.id ?? where.id;
				return state.runs.find(run => run.id === id && (where.id_attempt === undefined || run.attempt === where.id_attempt.attempt)) ?? null;
			}),
			findFirst: vi.fn(async function _FindCompeting({ where }: { where: Prisma.AgentRunWhereInput })
			{
				return state.runs.find(run => (where.OR as Prisma.AgentRunWhereInput[]).some(candidate => candidate.workflowTaskId === run.workflowTaskId || (candidate.workflowTaskName === run.workflowTaskName && candidate.workflowTaskKey === run.workflowTaskKey))) ?? null;
			}),
			create: vi.fn(async function _CreateRun({ data }: { data: Prisma.AgentRunUncheckedCreateInput })
			{
				const run = { ...data, attempt: 1, state: "Accepted", workflowTaskId: null, workflowTaskName: null, workflowTaskKey: null, startedAt: null, finishedAt: null, terminalReason: null, costAmount: null, costCurrency: null } as AgentRun;
				state.runs.push(run);
				return run;
			}),
			updateMany: vi.fn(async function _BindReceipt({ where, data }: { where: Prisma.AgentRunWhereInput; data: Prisma.AgentRunUpdateManyMutationInput })
			{
				if (controls.bindFailure)
					return { count: 0 };
				const run = state.runs.find(candidate => candidate.id === where.id && candidate.attempt === where.attempt && candidate.workflowTaskId === null && candidate.workflowTaskName === null && candidate.workflowTaskKey === null);
				if (run === undefined)
					return { count: 0 };
				run.workflowTaskId = data.workflowTaskId as string;
				run.workflowTaskName = data.workflowTaskName as string;
				run.workflowTaskKey = data.workflowTaskKey as string;
				return { count: 1 };
			}),
		},
		runInputSnapshot: {
			findUnique: vi.fn(async function _FindSnapshot({ where }: { where: Prisma.RunInputSnapshotWhereUniqueInput }) { return state.snapshots.find(snapshot => snapshot.runId === where.runId_attempt_digest?.runId && snapshot.attempt === where.runId_attempt_digest.attempt && snapshot.digest === where.runId_attempt_digest.digest) ?? null; }),
			create: vi.fn(async function _CreateSnapshot({ data }: { data: Prisma.RunInputSnapshotUncheckedCreateInput }) { const row = { id: "snapshot-1", retiredMemoryFacts: [], ...data } as StoredSnapshot; state.snapshots.push(row); return row; }),
		},
		agentRoutineFiring: {
			findUnique: vi.fn(async function _FindFiring()
			{
				return { id: input.firingId, siloId: input.siloId, routineId: input.routineId, routineRevision: input.routineRevision, conversationId: input.conversationId, requesterPrincipalId: input.requesterPrincipalId, trigger: AgentRoutineFiringTrigger.Automatic, scheduledSlot: new Date(input.scheduledSlot!), runId: state.firingRunId, disposition: AgentRoutineFiringDisposition.Preparing, workflowTaskId: input.task.taskId, workflowTaskName: input.task.taskName, workflowTaskKey: input.task.idempotencyKey } as AgentRoutineFiring;
			}),
			updateMany: vi.fn(async function _BindFiring({ data }: { data: Prisma.AgentRoutineFiringUpdateManyMutationInput })
			{
				if (state.firingRunId !== null)
					return { count: 0 };
				state.firingRunId = data.runId as string;
				return { count: 1 };
			}),
		},
	};
	const prisma = { $transaction: vi.fn(async function _Transaction(work: (client: Prisma.TransactionClient) => Promise<unknown>, options?: { isolationLevel?: string })
	{
		const before = { runs: state.runs.map(run => ({ ...run })), snapshots: state.snapshots.map(snapshot => ({ ...snapshot })), tasks: state.tasks.map(task => ({ ...task })), firingRunId: state.firingRunId, refused: state.refused };
		let result: unknown;
		try
		{
			result = await work(transaction as unknown as Prisma.TransactionClient);
		}
		catch (error)
		{
			state.runs.splice(0, state.runs.length, ...before.runs);
			state.snapshots.splice(0, state.snapshots.length, ...before.snapshots);
			state.tasks.splice(0, state.tasks.length, ...before.tasks);
			state.firingRunId = before.firingRunId;
			state.refused = before.refused;
			throw error;
		}
		const committedNewRun = before.runs.length === 0 && state.runs.length === 1;
		if (controls.loseCommitAcknowledgement && committedNewRun)
		{
			controls.loseCommitAcknowledgement = false;
			throw new Error("routine admission commit acknowledgement was lost");
		}
		return result;
	}) } as unknown as PrismaClient;
	const routines: RoutineOccurrenceRunAdmissionRepository = {
		authorize: vi.fn(async function _Authorize()
		{
			if (controls.receiptMismatch)
				throw new Error("saved receipt mismatch");
			return controls.authority && !state.refused && state.firingRunId === null;
		}),
		recover: vi.fn(async function _Recover(_command, runId)
		{
			if (controls.receiptMismatch)
				throw new Error("saved receipt mismatch");
			return state.firingRunId === runId;
		}),
		refuse: vi.fn(async function _Refuse()
		{
			if (state.firingRunId !== null)
				return false;
			state.refused = true;
			return true;
		}),
	};
	const routinesFactory = vi.fn(function _Routines(client: Prisma.TransactionClient) { expect(client).toBe(transaction); return routines; });
	const workflows = { spawn: vi.fn(async function _Spawn(context: { client: Prisma.TransactionClient }, task: { taskName: string; idempotencyKey: string })
	{
		expect(context.client).toBe(transaction);
		const receipt = { taskId: "0a1b2c3d-0000-5000-8000-000000000099", taskName: task.taskName, idempotencyKey: task.idempotencyKey };
		state.tasks.push(receipt);
		return receipt;
	}) };
	_assembly.createAuthorities.mockImplementation(function _CreateAuthorities(admission: RunAdmissionRepository) { return _Authorities(admission, function _CurrentExecutionAuthority() { return controls.currentExecutionAuthority; }); });
	_assembly.compile.mockResolvedValue({});
	const adapter = new PrismaRoutineRunAdmissionUnitOfWork({ prisma, routines: routinesFactory, occurrences: { readRecord: vi.fn().mockResolvedValue(_RECORD) }, history: history as unknown as HistoryStore, cipher: {} as never, membership: {} as never, workflows });
	return { adapter, input, state, controls, transaction, prisma, routines, routinesFactory, workflows };
}

describe("PrismaRoutineRunAdmissionUnitOfWork", function _Suite()
{
	beforeEach(function _ResetAssemblyMocks() { _assembly.createAuthorities.mockReset(); _assembly.compile.mockReset(); });

	it("atomically admits the automatic root, snapshot and exact task for the original requester", async function _AdmitsAutomaticRoot()
	{
		const fixture = await _Fixture();

		const receipt = await fixture.adapter.admit(fixture.input);

		expect(receipt).toMatchObject({ runId: _RoutineEventId("run", _RECORD.conversationId), runTask: { taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName, idempotencyKey: _RoutineActivationCommand(_RECORD).activationEventId } });
		expect(fixture.state.runs).toHaveLength(1);
		expect(fixture.state.snapshots).toHaveLength(1);
		expect(fixture.state.tasks).toHaveLength(1);
		expect(fixture.state.firingRunId).toBe(receipt?.runId);
		expect(fixture.state.snapshots[0]).toMatchObject({ origin: { kind: "scheduled", requesterPrincipalId: _RECORD.requesterPrincipalId, requesterIssuer: _RECORD.requesterIssuer, requesterSubjectId: _RECORD.requesterSubjectId, requesterAuthenticatedAt: _RECORD.requesterAuthenticatedAt }, executionSubject: { requester: { requesterPrincipalId: _RECORD.requesterPrincipalId } } });
		expect(fixture.workflows.spawn).toHaveBeenCalledWith({ client: fixture.transaction }, expect.objectContaining({ taskName: CONVERSATION_COMPUTER_TURN_TASK.taskName }));
		expect(fixture.routines.recover).toHaveBeenCalledWith(fixture.input, receipt?.runId);
		expect(fixture.prisma.$transaction).toHaveBeenNthCalledWith(1, expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
	});

	it("rolls back the run, snapshot, firing backlink and spawned task when receipt binding fails", async function _RollsBackAtomicAdmission()
	{
		const fixture = await _Fixture();
		fixture.controls.bindFailure = true;

		await expect(fixture.adapter.admit(fixture.input)).rejects.toThrow("not confirmed");
		expect(fixture.state).toMatchObject({ runs: [], snapshots: [], tasks: [], firingRunId: null, refused: false });
		expect(fixture.workflows.spawn).toHaveBeenCalledOnce();
	});

	it("recovers a committed lost response without spawning or binding another task", async function _RecoversLostCommitResponse()
	{
		const fixture = await _Fixture();
		fixture.controls.loseCommitAcknowledgement = true;

		await expect(fixture.adapter.admit(fixture.input)).rejects.toThrow("not confirmed");
		await expect(fixture.adapter.admit(fixture.input)).resolves.toMatchObject({ runTask: fixture.state.tasks[0] });
		expect(fixture.state.runs).toHaveLength(1);
		expect(fixture.state.snapshots).toHaveLength(1);
		expect(fixture.state.tasks).toHaveLength(1);
		expect(fixture.workflows.spawn).toHaveBeenCalledOnce();
		expect(fixture.routines.recover).toHaveBeenCalledOnce();
	});

	it("commits a current-authority refusal only while the firing remains unadmitted", async function _RefusesOnlyUnadmitted()
	{
		const denied = await _Fixture();
		denied.controls.authority = false;
		await expect(denied.adapter.admit(denied.input)).resolves.toBeNull();
		expect(denied.state).toMatchObject({ runs: [], snapshots: [], tasks: [], firingRunId: null, refused: true });

		const admitted = await _Fixture();
		await admitted.adapter.admit(admitted.input);
		admitted.controls.authority = false;
		await expect(admitted.adapter.admit(admitted.input)).resolves.toMatchObject({ runId: admitted.state.runs[0].id });
		expect(admitted.state.refused).toBe(false);
		expect(admitted.routines.refuse).not.toHaveBeenCalled();
	});

	it("rejects duplicate recovery after managed requester authority is revoked without changing the admitted firing or task", async function _RejectsRevokedDuplicate()
	{
		const fixture = await _Fixture();
		const admitted = await fixture.adapter.admit(fixture.input);
		const savedRun = { ...fixture.state.runs[0] };
		const savedTask = { ...fixture.state.tasks[0] };
		fixture.controls.currentExecutionAuthority = false;

		await expect(fixture.adapter.admit(fixture.input)).rejects.toThrow("admitted run remains recorded");
		expect(fixture.workflows.spawn).toHaveBeenCalledOnce();
		expect(fixture.state.runs).toEqual([savedRun]);
		expect(fixture.state.tasks).toEqual([savedTask]);
		expect(fixture.state.firingRunId).toBe(admitted?.runId);
		expect(fixture.state.refused).toBe(false);
		expect(fixture.routines.refuse).toHaveBeenCalledOnce();
	});

	it("rejects changed saved receipts while recovering an admitted run", async function _RejectsReceiptMismatch()
	{
		const fixture = await _Fixture();
		await fixture.adapter.admit(fixture.input);
		fixture.controls.receiptMismatch = true;

		await expect(fixture.adapter.admit(fixture.input)).rejects.toThrow(/receipt|admission/iu);
		expect(fixture.routines.recover).toHaveBeenCalledTimes(2);
		expect(fixture.workflows.spawn).toHaveBeenCalledOnce();
		expect(fixture.state.refused).toBe(false);
	});
});
