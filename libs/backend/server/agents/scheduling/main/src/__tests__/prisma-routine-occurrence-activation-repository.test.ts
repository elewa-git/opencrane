import { AgentRevisionState, AgentRoutineFiringDisposition, Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { RoutineOccurrenceCommand } from "@opencrane/backend/server/agents/scheduling/contract";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { RoutineFiringTrigger } from "@opencrane/models/agents";
import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";

import { PrismaRoutineOccurrenceActivationRepository } from "../prisma-routine-occurrence-activation-repository";
import type { RoutineTaskAdmissionPort } from "../routine-workflow.types";
import { _CALLER, _FiringRow, _IDENTITY, _NOW, _OCCURRENCE_TASK, _Revision, _Routine, _TaskAdmission } from "./prisma-routine-test-fixtures";

/** Exact saved preparation evidence required by every activation call. */
const _PREPARATION = { receiptId: "preparation-1", historyReference: "history-1", digest: `sha256:${"3".repeat(64)}` as const };
/** Exact activation evidence returned by the computer owner. */
const _ACTIVATION = { receiptId: "activation-1", computerReference: "computer-1", digest: `sha256:${"4".repeat(64)}` as const };

/** Builds the exact content-free command represented by the default firing row. */
function _Command(overrides: Partial<RoutineOccurrenceCommand> = {}): RoutineOccurrenceCommand
{
	return {
		..._IDENTITY,
		admittedRunId: null,
		trigger: RoutineFiringTrigger.Automatic,
		scheduledSlot: "2026-09-25T12:00:00.000Z",
		conversationId: "occurrence-conversation-1",
		destinationConversationId: "destination-1",
		selectedManagedServiceId: "service-1",
		requesterPrincipalId: "principal-1",
		requesterIssuer: _CALLER.issuer,
		requesterSubjectId: _CALLER.subjectId,
		requesterAuthenticatedAt: _CALLER.authenticatedAt,
		audiencePrincipalIds: ["principal-1", "principal-2"],
		...overrides,
	};
}

/** Makes identity lookups behave like the database before returning the selected row. */
function _FindFiring(row = _FiringRow({ preparationReceipt: _PREPARATION }))
{
	return vi.fn(async function _Find(args: { readonly where: { readonly id: string; readonly siloId: string; readonly routineId: string; readonly routineRevision: number } })
	{
		if (args.where.id !== row.id || args.where.siloId !== row.siloId || args.where.routineId !== row.routineId || args.where.routineRevision !== row.routineRevision)
		{
			return null;
		}
		return row;
	});
}

/** Supplies current Allow decisions and inspectable protected-operation admissions. */
function _Authorization()
{
	return {
		decidePrincipal: vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow }),
		admitPrincipalBatch: vi.fn().mockResolvedValue([
			{ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { operationId: "operation-routine" } },
			{ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { operationId: "operation-service" } },
		]),
	};
}

/** Builds current durable facts required by a successful activation admission. */
function _Transaction(row = _FiringRow({ preparationReceipt: _PREPARATION }))
{
	return {
		agentRoutineFiring: { findFirst: _FindFiring(row), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		agentRoutine: { findFirst: vi.fn().mockResolvedValue(_Routine()) },
		agentRoutineRevision: { findUnique: vi.fn().mockResolvedValue(_Revision()) },
		agentRunAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ now: _NOW }) },
		principal: { findMany: vi.fn().mockResolvedValue([{ id: "principal-1", subject: "subject-1" }, { id: "principal-2", subject: "subject-2" }]) },
		conversation: { findFirst: vi.fn().mockResolvedValue({ participants: [{ userId: "subject-1" }, { userId: "subject-2" }] }) },
		agentService: { findFirst: vi.fn().mockResolvedValue({ id: "service-1", principalId: "service-principal-1", activeRevisionId: "service-revision-1", activeRevision: { id: "service-revision-1", state: AgentRevisionState.Published, publishedAt: _NOW } }) },
	};
}

/** Composes the real activation repository from one inspectable transaction. */
function _Repository(transaction: Record<string, unknown>, authorization = _Authorization())
{
	const repository = new PrismaRoutineOccurrenceActivationRepository(transaction as unknown as Prisma.TransactionClient, {
		authorization: vi.fn().mockReturnValue(authorization) as unknown as (client: Prisma.TransactionClient) => AuthorizationAuthority,
		taskAdmission: _TaskAdmission() as unknown as RoutineTaskAdmissionPort<Prisma.TransactionClient>,
	});
	return { repository, authorization };
}

describe("PrismaRoutineOccurrenceActivationRepository", function _Suite()
{
	it("binds the narrow activation authority to its constructor transaction", function _TransactionOwnership()
	{
		const transaction = { agentRoutineFiring: { findFirst: vi.fn(), updateMany: vi.fn() } } as unknown as Prisma.TransactionClient;
		const authorization = vi.fn().mockReturnValue({});
		const repository = new PrismaRoutineOccurrenceActivationRepository(transaction, {
			authorization: authorization as unknown as (client: Prisma.TransactionClient) => AuthorizationAuthority,
			taskAdmission: _TaskAdmission() as unknown as RoutineTaskAdmissionPort<Prisma.TransactionClient>,
		});

		expect(repository).toMatchObject({ authorize: expect.any(Function), record: expect.any(Function), refuse: expect.any(Function) });
		expect(authorization).toHaveBeenCalledExactlyOnceWith(transaction);
	});

	it("authorizes exact fresh activation facts with the persisted actor", async function _AuthorizeFresh()
	{
		const transaction = _Transaction();
		const f = _Repository(transaction);

		await expect(f.repository.authorize(_Command(), _PREPARATION)).resolves.toEqual({ activation: null });
		expect(f.authorization.admitPrincipalBatch).toHaveBeenCalledWith([
			expect.objectContaining({ actorKind: "system", actorId: "opencrane-server/routine-schedule/v1" }),
			expect.objectContaining({ actorKind: "system", actorId: "opencrane-server/routine-schedule/v1" }),
		]);
	});

	it.each([
		["silo identity", { siloId: "silo-other" }],
		["firing identity", { firingId: "firing-other" }],
		["routine identity", { routineId: "routine-other" }],
		["revision identity", { routineRevision: 3 }],
		["task", { task: { ..._OCCURRENCE_TASK, idempotencyKey: "other-key" } }],
		["trigger", { trigger: RoutineFiringTrigger.Manual }],
		["automatic slot", { scheduledSlot: "2026-09-25T11:00:00.000Z" }],
		["occurrence conversation", { conversationId: "conversation-other" }],
		["destination conversation", { destinationConversationId: "destination-other" }],
		["managed service", { selectedManagedServiceId: "service-other" }],
		["requester Principal", { requesterPrincipalId: "principal-other" }],
		["requester issuer", { requesterIssuer: "https://other.example" }],
		["requester subject", { requesterSubjectId: "subject-other" }],
		["requester authentication instant", { requesterAuthenticatedAt: "2026-09-20T10:00:00.000Z" }],
		["frozen audience", { audiencePrincipalIds: ["principal-1"] }],
		["mutable admitted run", { admittedRunId: "run-other" }],
	] as const)("rejects a command with mismatched %s", async function _Mismatch(_name, patch)
	{
		const transaction = _Transaction();
		const f = _Repository(transaction);

		await expect(f.repository.authorize(_Command(patch), _PREPARATION)).rejects.toThrow(/does not match/u);
		expect(transaction.agentRoutine.findFirst).not.toHaveBeenCalled();
	});

	it("rejects an admitted firing and an inexact saved preparation before current authority", async function _ExactUnadmittedPreparation()
	{
		const admittedTransaction = _Transaction(_FiringRow({ preparationReceipt: _PREPARATION, runId: "run-1" }));
		const admitted = _Repository(admittedTransaction);
		await expect(admitted.repository.authorize(_Command(), _PREPARATION)).rejects.toThrow("does not match its saved unadmitted firing");

		const transaction = _Transaction();
		const f = _Repository(transaction);
		await expect(f.repository.authorize(_Command(), { ..._PREPARATION, receiptId: "preparation-other" })).rejects.toThrow("preparation does not match its saved receipt");
		expect(f.authorization.admitPrincipalBatch).not.toHaveBeenCalled();
	});

	it("rechecks current activation authority before recovering a saved activation", async function _SavedActivationFreshAuthority()
	{
		const transaction = _Transaction(_FiringRow({ preparationReceipt: _PREPARATION, activationReceipt: _ACTIVATION }));
		const f = _Repository(transaction);

		await expect(f.repository.authorize(_Command(), _PREPARATION)).resolves.toEqual({ activation: _ACTIVATION });
		expect(f.authorization.admitPrincipalBatch).toHaveBeenCalledOnce();

		transaction.agentRoutine.findFirst.mockResolvedValue(null);
		await expect(f.repository.authorize(_Command(), _PREPARATION)).resolves.toBeNull();
		expect(transaction.agentRoutineFiring.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ disposition: AgentRoutineFiringDisposition.Refused, refusalReason: "stage_activation_current_authority_refused" }) }));
	});

	it("returns null only for a durable refusal", async function _DurableRefusal()
	{
		const refusedTransaction = _Transaction(_FiringRow({ preparationReceipt: _PREPARATION, disposition: AgentRoutineFiringDisposition.Refused }));
		await expect(_Repository(refusedTransaction).repository.authorize(_Command(), _PREPARATION)).resolves.toBeNull();

		const transaction = _Transaction();
		transaction.agentRoutine.findFirst.mockResolvedValue(null);
		transaction.agentRoutineFiring.updateMany.mockResolvedValue({ count: 0 });
		await expect(_Repository(transaction).repository.authorize(_Command(), _PREPARATION)).rejects.toThrow("refusal lost its compare-and-set");
	});

	it("records once under the exact preparation and no-run fence without substituting evidence", async function _RecordAndReplay()
	{
		const transaction = _Transaction();
		const f = _Repository(transaction);

		await expect(f.repository.record(_Command(), _PREPARATION, _ACTIVATION)).resolves.toEqual(_ACTIVATION);
		expect(transaction.agentRoutineFiring.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ workflowTaskId: _OCCURRENCE_TASK.taskId, workflowTaskName: _OCCURRENCE_TASK.taskName, workflowTaskKey: _OCCURRENCE_TASK.idempotencyKey, disposition: AgentRoutineFiringDisposition.Preparing, runId: null, preparationReceipt: { equals: _PREPARATION }, activationReceipt: { equals: Prisma.DbNull } }), data: { activationReceipt: _ACTIVATION } });

		transaction.agentRoutineFiring.findFirst.mockResolvedValue(_FiringRow({ preparationReceipt: _PREPARATION, activationReceipt: _ACTIVATION }));
		await expect(f.repository.record(_Command(), _PREPARATION, _ACTIVATION)).resolves.toEqual(_ACTIVATION);
		await expect(f.repository.record(_Command(), _PREPARATION, { ..._ACTIVATION, receiptId: "activation-other" })).rejects.toThrow("conflicts with its saved activation");
		expect(transaction.agentRoutineFiring.updateMany).toHaveBeenCalledOnce();
	});

	it("fails closed when activation loses its exact compare-and-set", async function _RecordConflict()
	{
		const transaction = _Transaction();
		transaction.agentRoutineFiring.updateMany.mockResolvedValue({ count: 0 });

		await expect(_Repository(transaction).repository.record(_Command(), _PREPARATION, _ACTIVATION)).rejects.toThrow("activation receipt compare-and-set conflict");
	});

	it("does not recover a saved activation through record after refusal", async function _RefusedRecord()
	{
		const transaction = _Transaction(_FiringRow({ preparationReceipt: _PREPARATION, activationReceipt: _ACTIVATION, disposition: AgentRoutineFiringDisposition.Refused }));

		await expect(_Repository(transaction).repository.record(_Command(), _PREPARATION, _ACTIVATION)).rejects.toThrow("requires a preparing unadmitted firing");
		expect(transaction.agentRoutineFiring.updateMany).not.toHaveBeenCalled();
	});

	it("refuses only an unadmitted preparing firing and preserves both saved receipts", async function _Refuse()
	{
		const transaction = _Transaction(_FiringRow({ preparationReceipt: _PREPARATION, activationReceipt: _ACTIVATION }));
		const f = _Repository(transaction);

		await expect(f.repository.refuse(_Command(), _PREPARATION)).resolves.toBeUndefined();
		expect(transaction.agentRoutineFiring.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ disposition: AgentRoutineFiringDisposition.Preparing, runId: null }), data: { disposition: AgentRoutineFiringDisposition.Refused, refusalReason: "activation_current_execution_eligibility_refused", finishedAt: _NOW, updatedAt: _NOW } });
		expect(transaction.agentRoutineFiring.updateMany.mock.calls[0]![0].data).not.toHaveProperty("preparationReceipt");
		expect(transaction.agentRoutineFiring.updateMany.mock.calls[0]![0].data).not.toHaveProperty("activationReceipt");

		transaction.agentRoutineFiring.findFirst.mockResolvedValue(_FiringRow({ preparationReceipt: _PREPARATION, activationReceipt: _ACTIVATION, disposition: AgentRoutineFiringDisposition.Refused }));
		await expect(f.repository.refuse(_Command(), _PREPARATION)).resolves.toBeUndefined();
		expect(transaction.agentRoutineFiring.updateMany).toHaveBeenCalledOnce();
	});
});
