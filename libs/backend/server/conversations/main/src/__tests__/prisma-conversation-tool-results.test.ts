import { AgentRunState, ExternalActionRecoveryMode, Prisma, ToolInvocationState, ToolResultDeliveryState, type PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE, ConversationComputerRealizationKinds, ConversationModelToolModes } from "@opencrane/contracts";
import { HistoryExpectedRevisions, type HistoryRecordedEvent, type HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { ConversationComputerToolResultOutcomes, type ConversationComputerContinuationReservation } from "../conversation-computer-continuation.types";
import { _ConversationModelRequestDigest } from "../conversation-computer-model-reservation";
import { KurrentConversationComputerTurnStore } from "../conversation-computer-turn-store";
import type { FrozenConversationComputerTurn } from "../conversation-computer-turn.types";
import type { ConversationToolDispatchDependencies } from "../conversation-tool-dispatch.types";
import type { ConversationComputerBootstrapCommand } from "../conversation-computer-turn.types";
import { PrismaConversationToolDispatchAuthority } from "../db/prisma-conversation-tool-dispatch-authority";
import { PrismaConversationToolResultsUnitOfWork } from "../db/prisma-conversation-tool-results";
import { _PrepareConversationOutputIntent } from "./conversation-output-intent.fixture";

const _NOW = new Date("2026-09-09T05:10:00.000Z");
const _WORKLOAD = { subject: "system:serviceaccount:computers:computer", namespace: "computers", serviceAccountName: "computer", podUid: "pod-1" };
const _DIGEST = `sha256:${"a".repeat(64)}`;
const _FIRST = "11111111-1111-4111-8111-111111111111";
const _SECOND = "22222222-2222-4222-8222-222222222222";
const _PROPOSAL = "33333333-3333-4333-8333-333333333333";
const _REFERENCE = "44444444-4444-4444-8444-444444444444";

/** Uses real turn-event validation over in-memory append and read operations. */
async function _savedTurn(reserve: boolean)
{
	const streams = new Map<string, HistoryRecordedEvent[]>();
	const history: Pick<HistoryStore, "append" | "readStream"> = {
		async append(command)
		{
			const events = streams.get(command.streamName) ?? [];
			const expected = command.expectedRevision === HistoryExpectedRevisions.NoStream ? -1n : command.expectedRevision;
			if (expected !== BigInt(events.length - 1))
				throw new Error("Fixture received a conflicting history append");
			for (const event of command.events)
				events.push({ ...structuredClone(event), metadata: Object.fromEntries(Object.entries(event.metadata).map(([key, value]) => [key, String(value)])), streamName: command.streamName, revision: BigInt(events.length), recordedAt: new Date() });
			streams.set(command.streamName, events);
			return { streamName: command.streamName, revision: BigInt(events.length - 1) };
		},
		async *readStream(request)
		{
			for (const event of (streams.get(request.streamName) ?? []).filter(event => event.revision >= (request.fromRevision ?? 0n)).slice(0, request.maxCount)) yield structuredClone(event);
		},
	};
	const store = new KurrentConversationComputerTurnStore(history);
	const frozen: FrozenConversationComputerTurn = {
		bootstrapId: "55555555-5555-4555-8555-555555555555", siloId: "silo-1", computerId: "computer-1",
		binding: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", leaseGeneration: 1, agentIdentityId: "identity-1", agentServiceId: "service-1", agentName: "Ada", agentAvatarArtifactRevisionId: null, runId: "run-1", expectedRevision: 1n, maximumEntryBytes: 65_536 },
		lease: { leaseId: "lease-1", leaseGeneration: 1, realization: { kind: ConversationComputerRealizationKinds.AgentSandbox, claimId: "computer-1-g1", sandboxId: "sandbox-1", serviceFQDN: "sandbox-1.computers.svc.cluster.local" } }, compile: { runId: "run-1", attempt: 1, promptCompilerVersion: "test-v1", digest: _DIGEST },
		latestPendingEntryId: "input-1", modelAlias: "model-1", maximumBudgetUsd: 1, credentialLifetimeSeconds: 60,
		modelReservation: null, toolSelection: null, continuationReservation: null, outputReceipt: null, outputSourceCommandId: null,
	};
	await store.createOrRead(frozen);
	const first = { ordinal: 1 as const, tools: ConversationModelToolModes.Select, compiledInputDigest: _DIGEST, maxCompletionTokens: 100, authorityExpiresAtEpochMs: _NOW.getTime() + 60_000, dispatchDeadlineEpochMs: _NOW.getTime() + 25_000 };
	await store.reserveModel(frozen.bootstrapId, { ...first, invocationFence: _FIRST, requestDigest: _ConversationModelRequestDigest(frozen, first) });
	await store.selectTool(frozen.bootstrapId, { proposalId: _PROPOSAL, requestFingerprint: _DIGEST, payloadRef: _REFERENCE, ciphertextDigest: _DIGEST });
	let turn = (await store.load(frozen.bootstrapId))!;
	const row = _row(turn);
	const second = { ordinal: 2 as const, tools: ConversationModelToolModes.None, compiledInputDigest: _DIGEST, maxCompletionTokens: 100, authorityExpiresAtEpochMs: _NOW.getTime() + 60_000, dispatchDeadlineEpochMs: _NOW.getTime() + 25_000,
		proposalId: _PROPOSAL, resultDigest: row.resultDelivery.payloadDigest, continuation: { payloadRef: _REFERENCE, ciphertextDigest: _DIGEST } };
	const reservation: ConversationComputerContinuationReservation = { ...second, invocationFence: _SECOND, requestDigest: _ConversationModelRequestDigest(turn, second) };
	if (reserve)
	{
		await store.reserveContinuation(turn.bootstrapId, reservation);
		turn = (await store.load(turn.bootstrapId))!;
	}
	return { store, streams, turn, row, reservation };
}

/** Supplies the real IAM reader's linked terminal relation; current guard behavior is independently spied. */
function _row(turn: FrozenConversationComputerTurn)
{
	const _COMMAND = { siloId: turn.siloId, runId: turn.compile.runId, attempt: turn.compile.attempt, toolInvocationId: turn.toolSelection!.proposalId, runtimeInstanceId: turn.computerId, commandId: turn.bootstrapId, requestFingerprint: turn.toolSelection!.requestFingerprint };
	const payload = { toolInvocationId: _COMMAND.toolInvocationId, outcome: "succeeded", result: { record: { name: "Private result" } } };
	return {
		id: "internal-invocation-1", ..._COMMAND, mcpTaskId: null, agentServiceId: "service-1", agentRevisionId: "revision-1", agentIdentityId: "identity-1", principalId: "principal-1",
		candidateId: "candidate-1", toolRevisionId: "tool-revision-1", arguments: { query: "record" }, argumentsDigest: "sha256:arguments", effectiveArguments: { query: "record" }, effectiveArgumentsDigest: "sha256:arguments",
		authorizationActorKind: null, authorizationExecutionSubject: null, authorizationCoordinates: null, authorizationDecisionDigests: [], authorizationAssignmentDigest: null, authorizationEvidenceDigest: null,
		requestIdentity: { runtimeInstanceId: _COMMAND.runtimeInstanceId, commandId: _COMMAND.commandId, candidateId: "candidate-1" },
		approvalRequired: false, recoveryMode: ExternalActionRecoveryMode.Manual, recoveryKey: null,
		state: ToolInvocationState.Succeeded, preparationAttempt: 1, retryDeadlineAt: new Date(_NOW.getTime() + 60_000), nextPreparationAttemptAt: _NOW,
		claimAttempt: 1, claimKind: null, claimFence: 1, claimExpiresAt: null, revision: 3, recoveryRequiredAt: null,
		result: payload.result as JsonValue | null, failureCode: null as string | null, completedAt: _NOW as Date | null, createdAt: _NOW, updatedAt: _NOW,
		run: { id: _COMMAND.runId, siloId: _COMMAND.siloId, attempt: _COMMAND.attempt, state: AgentRunState.Running as AgentRunState },
		resultDelivery: { id: "delivery-1", toolInvocationId: "internal-invocation-1", state: ToolResultDeliveryState.Pending, payload: payload as JsonValue, payloadDigest: ___DigestCanonicalJson(payload), createdAt: _NOW, consumedAt: null as Date | null },
	};
}


/** Models transaction rollback while using the real IAM read/consume and conversation unit of work. */
async function _fixture(reserve = true)
{
	const saved = await _savedTurn(reserve);
	let row = { ...saved.row, resultDelivery: { ...saved.row.resultDelivery, state: ToolResultDeliveryState.Pending as ToolResultDeliveryState } };
	const controls = { notAfter: _NOW.getTime() + 60_000 as number | null, beforeWrite: async function _BeforeWrite() {}, afterWrite: async function _AfterWrite() {} };
	const findFirst = vi.fn(async function _Find() { return structuredClone(row); });
	const updateMany = vi.fn(async function _Acknowledge(command: Prisma.ToolResultDeliveryUpdateManyArgs)
	{
		await controls.beforeWrite();
		expect(command.where).toMatchObject({ toolInvocationId: row.id, payloadDigest: row.resultDelivery.payloadDigest, state: ToolResultDeliveryState.Pending });
		if (row.resultDelivery.state !== ToolResultDeliveryState.Pending)
			return { count: 0 };
		row.resultDelivery.state = ToolResultDeliveryState.Consumed;
		row.resultDelivery.consumedAt = command.data.consumedAt as Date;
		await controls.afterWrite();
		return { count: 1 };
	});
	const transaction = { toolInvocation: { findFirst }, toolResultDelivery: { updateMany } } as unknown as Prisma.TransactionClient;
	const run = vi.fn(async function _Transaction(work: (tx: Prisma.TransactionClient) => Promise<unknown>)
	{
		const before = structuredClone(row);
		try { return await work(transaction); }
		catch (error) { row = before; throw error; }
	});
	const prisma = { $transaction: run } as unknown as PrismaClient;
	const admit = vi.fn(async function _Pod(command: ConversationComputerBootstrapCommand)
	{
		if (command.process.kind !== ConversationComputerRealizationKinds.AgentSandbox || command.process.workload.podUid !== _WORKLOAD.podUid)
			throw new Error("Pod binding denied");
	});
	const guard = vi.spyOn(PrismaConversationToolDispatchAuthority.prototype, "admitUntil").mockImplementation(async function _Current(this: PrismaConversationToolDispatchAuthority, invocation, _now, workload)
	{
		expect((this as unknown as { transaction: unknown }).transaction).toBe(transaction);
		expect(invocation).toMatchObject({ id: row.id, runId: saved.turn.compile.runId, attempt: saved.turn.compile.attempt });
		expect(workload).toEqual({ audience: CONVERSATION_COMPUTER_PROJECTED_TOKEN_AUDIENCE, namespace: _WORKLOAD.namespace, serviceAccountName: _WORKLOAD.serviceAccountName, workloadKind: "pod", workloadUid: _WORKLOAD.podUid, podUid: _WORKLOAD.podUid });
		return controls.notAfter;
	});
	const dependencies = {} as ConversationToolDispatchDependencies;
	const unit = new PrismaConversationToolResultsUnitOfWork(prisma, "silo-1", saved.store, { admit }, dependencies);
	return { ...saved, unit, run, guard, admit, controls, findFirst, updateMany, current: function _CurrentRow() { return row; } };
}

beforeEach(function _Clock() { vi.useFakeTimers(); vi.setSystemTime(_NOW); });
afterEach(function _Restore() { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("saved conversation tool results", function _results()
{
	it("reads exact result content with the current authority in the same Serializable transaction", async function _read()
	{
		const f = await _fixture(false);
		await expect(f.unit.read(f.turn, _WORKLOAD)).resolves.toEqual({ outcome: ConversationComputerToolResultOutcomes.Available, payload: f.row.resultDelivery.payload, payloadDigest: f.row.resultDelivery.payloadDigest, notAfterEpochMs: _NOW.getTime() + 60_000 });
		expect(f.run).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
		expect(f.guard).toHaveBeenCalledOnce();
		expect(f.updateMany).not.toHaveBeenCalled();
	});

	it("consumes only after the real turn store confirms call two, then preserves an exact restart", async function _consume()
	{
		const f = await _fixture();
		await expect(f.unit.consume(f.turn, _WORKLOAD)).resolves.toMatchObject({ outcome: ConversationComputerToolResultOutcomes.Available, payloadDigest: f.row.resultDelivery.payloadDigest, notAfterEpochMs: f.reservation.dispatchDeadlineEpochMs });
		const consumedAt = f.current().resultDelivery.consumedAt;
		await expect(f.unit.consume(f.turn, _WORKLOAD)).resolves.toMatchObject({ outcome: ConversationComputerToolResultOutcomes.Available });
		expect(f.current().resultDelivery.consumedAt).toEqual(consumedAt);
		expect(f.updateMany).toHaveBeenCalledOnce();
	});

	it("rejects a caller-fabricated reservation when the real stream contains only the tool selection", async function _unsavedReservation()
	{
		const f = await _fixture(false);
		await expect(f.unit.consume({ ...f.turn, continuationReservation: f.reservation }, _WORKLOAD)).resolves.toEqual({ outcome: ConversationComputerToolResultOutcomes.Unavailable });
		expect(f.findFirst).not.toHaveBeenCalled();
		expect(f.updateMany).not.toHaveBeenCalled();
	});

	it.each(["invocationFence", "proposalId", "resultDigest", "ordinal", "requestDigest"])("rejects mismatched saved reservation %s", async function _wrongReservation(field)
	{
		const f = await _fixture();
		const reservation = { ...f.reservation, [field]: field === "ordinal" ? 1 : "changed" } as ConversationComputerContinuationReservation;
		await expect(f.unit.consume({ ...f.turn, continuationReservation: reservation }, _WORKLOAD)).resolves.toEqual({ outcome: ConversationComputerToolResultOutcomes.Unavailable });
		expect(f.findFirst).not.toHaveBeenCalled();
	});

	it.each(["silo", "attempt", "selection", "compile"])("refuses changed turn %s before reading private rows", async function _wrongTurn(kind)
	{
		const f = await _fixture();
		const turn = { ...f.turn,
			siloId: kind === "silo" ? "foreign" : f.turn.siloId,
			compile: { ...f.turn.compile,
				attempt: kind === "attempt" ? 2 : 1,
				digest: kind === "compile" ? `sha256:${"f".repeat(64)}` : f.turn.compile.digest,
			},
			toolSelection: kind === "selection" ? { ...f.turn.toolSelection!, requestFingerprint: `sha256:${"f".repeat(64)}` } : f.turn.toolSelection,
		};
		await expect(f.unit.read(turn, _WORKLOAD)).resolves.toEqual({ outcome: ConversationComputerToolResultOutcomes.Unavailable });
		expect(f.findFirst).not.toHaveBeenCalled();
	});

	it("refuses a different Pod before result or permission reads", async function _wrongPod()
	{
		const f = await _fixture();
		await expect(f.unit.read(f.turn, { ..._WORKLOAD, podUid: "foreign-pod" })).rejects.toThrow("Pod binding denied");
		expect(f.findFirst).not.toHaveBeenCalled();
		expect(f.guard).not.toHaveBeenCalled();
	});

	it.each([null, _NOW.getTime()])("keeps revoked or expired current authority unavailable: %s", async function _ended(notAfter)
	{
		const f = await _fixture();
		f.controls.notAfter = notAfter;
		await expect(f.unit.consume(f.turn, _WORKLOAD)).resolves.toEqual({ outcome: ConversationComputerToolResultOutcomes.Unavailable });
		expect(f.updateMany).not.toHaveBeenCalled();
	});

	it("does not extend the original model authority window when a current lease lasts longer", async function _OriginalCeiling()
	{
		const f = await _fixture(false);
		f.controls.notAfter = _NOW.getTime() + 120_000;
		await expect(f.unit.read(f.turn, _WORKLOAD)).resolves.toMatchObject({ outcome: ConversationComputerToolResultOutcomes.Available, notAfterEpochMs: f.turn.modelReservation!.authorityExpiresAtEpochMs });
	});

	it("rolls back acknowledgement when a delayed write crosses the admitted deadline", async function _lateWrite()
	{
		const f = await _fixture();
		f.controls.beforeWrite = async function _Delay() { vi.setSystemTime(f.reservation.dispatchDeadlineEpochMs + 1); };
		await expect(f.unit.consume(f.turn, _WORKLOAD)).resolves.toEqual({ outcome: ConversationComputerToolResultOutcomes.Unavailable });
		expect(f.updateMany).toHaveBeenCalledOnce();
		expect(f.current().resultDelivery.state).toBe(ToolResultDeliveryState.Pending);
		expect(f.current().resultDelivery.consumedAt).toBeNull();
	});

	it("rolls back if write readback disagrees with the exact result", async function _changedResult()
	{
		const f = await _fixture();
		f.controls.afterWrite = async function _Tamper() { f.current().resultDelivery.payloadDigest = `sha256:${"c".repeat(64)}`; };
		await expect(f.unit.consume(f.turn, _WORKLOAD)).resolves.toEqual({ outcome: ConversationComputerToolResultOutcomes.Unavailable });
		expect(f.current().resultDelivery.state).toBe(ToolResultDeliveryState.Pending);
	});

	it("propagates unknown transaction or history failures without retrying them", async function _uncertain()
	{
		const f = await _fixture();
		f.controls.afterWrite = async function _Lost() { throw new Error("unknown transaction failure"); };
		await expect(f.unit.consume(f.turn, _WORKLOAD)).rejects.toThrow("unknown transaction failure");
		expect(f.run).toHaveBeenCalledOnce();
		expect(f.current().resultDelivery.state).toBe(ToolResultDeliveryState.Pending);
	});

	it("rechecks the saved reservation and Pod after a proven database rollback", async function _retry()
	{
		const f = await _fixture();
		let writes = 0;
		f.controls.afterWrite = async function _Conflict()
		{
			if (++writes === 1)
				throw new Prisma.PrismaClientKnownRequestError("serialization failure", { code: "P2034", clientVersion: "6" });
		};
		await expect(f.unit.consume(f.turn, _WORKLOAD)).resolves.toMatchObject({ outcome: ConversationComputerToolResultOutcomes.Available });
		expect(f.run).toHaveBeenCalledTimes(2);
		expect(f.admit).toHaveBeenCalledTimes(2);
		expect(f.guard).toHaveBeenCalledTimes(2);
	});

	it("reads exact consumed content after output intent is stored and before the run completes", async function _savedOutput()
	{
		const f = await _fixture();
		await f.unit.consume(f.turn, _WORKLOAD);
		const intent = await _PrepareConversationOutputIntent(f.turn, _SECOND);
		await f.store.markOutput(f.turn.bootstrapId, intent);
		const outputTurn = (await f.store.load(f.turn.bootstrapId))!;
		expect(outputTurn.outputReceipt).not.toBeNull();
		await expect(f.unit.read(outputTurn, _WORKLOAD)).resolves.toMatchObject({ outcome: ConversationComputerToolResultOutcomes.Available });
		f.current().run.state = AgentRunState.Completed;
		await expect(f.unit.read(outputTurn, _WORKLOAD)).resolves.toEqual({ outcome: ConversationComputerToolResultOutcomes.Unavailable });
	});
});
