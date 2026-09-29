import { AgentRevisionState, AgentRoutineFiringDisposition, Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { RoutineOccurrenceCommand } from "@opencrane/backend/server/agents/scheduling/contract";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { RoutineFiringTrigger } from "@opencrane/models/agents";
import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";

import { PrismaRoutineOccurrencePreparationRepository } from "../prisma-routine-occurrence-preparation-repository";
import type { RoutineTaskAdmissionPort } from "../routine-workflow.types";
import { _CALLER, _FiringRow, _IDENTITY, _NOW, _OCCURRENCE_TASK, _Revision, _Routine, _TaskAdmission } from "./prisma-routine-test-fixtures";

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
function _FindFiring(row = _FiringRow())
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

/** Builds current durable facts required by a successful preparation admission. */
function _Transaction(row = _FiringRow())
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

/** Composes the real preparation repository from one inspectable transaction. */
function _Repository(transaction: Record<string, unknown>, authorization = _Authorization())
{
	const repository = new PrismaRoutineOccurrencePreparationRepository(transaction as unknown as Prisma.TransactionClient, {
		authorization: vi.fn().mockReturnValue(authorization) as unknown as (client: Prisma.TransactionClient) => AuthorizationAuthority,
		taskAdmission: _TaskAdmission() as unknown as RoutineTaskAdmissionPort<Prisma.TransactionClient>,
	});
	return { repository, authorization };
}

describe("PrismaRoutineOccurrencePreparationRepository", function _Suite()
{
	it("binds the narrow preparation authority to its constructor transaction", function _TransactionOwnership()
	{
		const transaction = { agentRoutineFiring: { findFirst: vi.fn(), updateMany: vi.fn() } } as unknown as Prisma.TransactionClient;
		const authorization = vi.fn().mockReturnValue({});
		const repository = new PrismaRoutineOccurrencePreparationRepository(transaction, {
			authorization: authorization as unknown as (client: Prisma.TransactionClient) => AuthorizationAuthority,
			taskAdmission: _TaskAdmission() as unknown as RoutineTaskAdmissionPort<Prisma.TransactionClient>,
		});

		expect(repository).toMatchObject({ authorize: expect.any(Function), record: expect.any(Function), refuse: expect.any(Function) });
		expect(authorization).toHaveBeenCalledOnce();
		expect(authorization).toHaveBeenCalledWith(transaction);
	});

	it("authorizes exact fresh facts with the persisted automatic actor", async function _AuthorizeFresh()
	{
		const transaction = _Transaction();
		const f = _Repository(transaction);

		await expect(f.repository.authorize(_Command())).resolves.toEqual({ preparation: null });
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

		await expect(f.repository.authorize(_Command(patch))).rejects.toThrow(/does not match/u);
		expect(transaction.agentRoutine.findFirst).not.toHaveBeenCalled();
	});

	it("rejects inconsistent persisted requester provenance before authority admission", async function _RequesterProvenance()
	{
		const transaction = _Transaction(_FiringRow({ requesterPrincipalId: "principal-other" }));
		const f = _Repository(transaction);

		await expect(f.repository.authorize(_Command())).rejects.toThrow("requester provenance does not match");
		expect(f.authorization.admitPrincipalBatch).not.toHaveBeenCalled();
	});

	it("durably refuses fresh preparation when the current routine is unavailable", async function _AuthorityDenial()
	{
		const transaction = _Transaction();
		transaction.agentRoutine.findFirst.mockResolvedValue(null);
		const f = _Repository(transaction);

		await expect(f.repository.authorize(_Command())).resolves.toBeNull();
		expect(transaction.agentRoutineFiring.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ disposition: AgentRoutineFiringDisposition.Preparing, runId: null }), data: { disposition: AgentRoutineFiringDisposition.Refused, refusalReason: "stage_preparation_current_authority_refused", finishedAt: _NOW, updatedAt: _NOW } }));
	});

	it("recovers an exact saved publication marker without repeating current admissions", async function _SavedMarker()
	{
		const saved = { receiptId: "preparation-saved", historyReference: "history-saved", digest: `sha256:${"2".repeat(64)}` as const };
		const transaction = _Transaction(_FiringRow({ disposition: AgentRoutineFiringDisposition.Running, runId: "run-1", preparationReceipt: saved }));
		const f = _Repository(transaction);

		await expect(f.repository.authorize(_Command())).resolves.toEqual({ preparation: saved });
		expect(transaction.agentRoutine.findFirst).not.toHaveBeenCalled();
		expect(f.authorization.admitPrincipalBatch).not.toHaveBeenCalled();
	});

	it("never treats an admitted run without a saved marker as fresh publication authority", async function _NoRunFastPath()
	{
		const transaction = _Transaction(_FiringRow({ runId: "run-1" }));
		const f = _Repository(transaction);
		const receipt = { receiptId: "preparation-1", historyReference: "history-1", digest: `sha256:${"4".repeat(64)}` as const };

		await expect(f.repository.authorize(_Command())).rejects.toThrow("requires a preparing unadmitted firing");
		await expect(f.repository.record(_Command(), receipt)).rejects.toThrow("requires a preparing unadmitted firing");
		await expect(f.repository.refuse(_Command())).rejects.toThrow("requires a fresh unadmitted firing");
		expect(f.authorization.admitPrincipalBatch).not.toHaveBeenCalled();
		expect(transaction.agentRoutineFiring.updateMany).not.toHaveBeenCalled();
	});

	it("records once under the no-run task fence and replays only the exact receipt", async function _RecordAndReplay()
	{
		const receipt = { receiptId: "preparation-1", historyReference: "history-1", digest: `sha256:${"4".repeat(64)}` as const };
		const transaction = _Transaction();
		const f = _Repository(transaction);

		await expect(f.repository.record(_Command(), receipt)).resolves.toEqual(receipt);
		expect(transaction.agentRoutineFiring.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ workflowTaskId: _OCCURRENCE_TASK.taskId, workflowTaskName: _OCCURRENCE_TASK.taskName, workflowTaskKey: _OCCURRENCE_TASK.idempotencyKey, disposition: AgentRoutineFiringDisposition.Preparing, runId: null, preparationReceipt: { equals: Prisma.DbNull } }), data: { preparationReceipt: receipt } });

		transaction.agentRoutineFiring.findFirst.mockResolvedValue(_FiringRow({ preparationReceipt: receipt }));
		await expect(f.repository.record(_Command(), receipt)).resolves.toEqual(receipt);
		await expect(f.repository.record(_Command(), { ...receipt, receiptId: "preparation-other" })).rejects.toThrow("conflicts with its saved publication");
		expect(transaction.agentRoutineFiring.updateMany).toHaveBeenCalledOnce();
	});

	it("fails closed when publication loses its same-transaction compare-and-set", async function _RecordConflict()
	{
		const transaction = _Transaction();
		transaction.agentRoutineFiring.updateMany.mockResolvedValue({ count: 0 });
		const f = _Repository(transaction);
		const receipt = { receiptId: "preparation-1", historyReference: "history-1", digest: `sha256:${"4".repeat(64)}` as const };

		await expect(f.repository.record(_Command(), receipt)).rejects.toThrow("preparation receipt compare-and-set conflict");
	});

	it("records only the fixed external-eligibility refusal before publication", async function _ExternalRefusal()
	{
		const transaction = _Transaction();
		const f = _Repository(transaction);

		await expect(f.repository.refuse(_Command())).resolves.toBeUndefined();
		expect(transaction.agentRoutineFiring.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ disposition: AgentRoutineFiringDisposition.Preparing, runId: null, preparationReceipt: { equals: Prisma.DbNull } }), data: { disposition: AgentRoutineFiringDisposition.Refused, refusalReason: "preparation_current_execution_eligibility_refused", finishedAt: _NOW, updatedAt: _NOW } });
	});
});
