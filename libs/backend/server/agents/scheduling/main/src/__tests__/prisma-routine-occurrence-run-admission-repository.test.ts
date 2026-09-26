import { AgentRevisionState, AgentRoutineFiringDisposition, Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { RoutineRunAdmissionInput } from "@opencrane/backend/server/agents/scheduling/contract";
import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { RoutineFiringTrigger } from "@opencrane/models/agents";
import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";

import { PrismaRoutineOccurrenceRunAdmissionRepository } from "../prisma-routine-occurrence-run-admission-repository";
import type { RoutineTaskAdmissionPort } from "../routine-workflow.types";
import { _CALLER, _FiringRow, _IDENTITY, _INSTRUCTION, _NOW, _Revision, _Routine, _TaskAdmission } from "./prisma-routine-test-fixtures";

/** Exact preparation evidence saved by the occurrence owner. */
const _PREPARATION = { receiptId: "preparation-1", historyReference: "history-1", digest: `sha256:${"3".repeat(64)}` as const };
/** Exact activation evidence saved by the computer owner. */
const _ACTIVATION = { receiptId: "activation-1", computerReference: "computer-1", digest: `sha256:${"4".repeat(64)}` as const };

/** Builds the content-free command represented by the saved firing. */
function _Command(overrides: Partial<RoutineRunAdmissionInput> = {}): RoutineRunAdmissionInput
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
		preparation: _PREPARATION,
		activation: _ACTIVATION,
		...overrides,
	};
}

/** Supplies current allow decisions and effect admissions for the transaction-bound facts. */
function _Authorization(): AuthorizationAuthority
{
	return {
		decide: vi.fn(),
		decidePrincipal: vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow }),
		admit: vi.fn(),
		admitPrincipal: vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { operationId: "operation" } }),
		admitPrincipalBatch: vi.fn().mockResolvedValue([
			{ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { operationId: "operation-routine" } },
			{ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { operationId: "operation-service" } },
		]),
		listEntitled: vi.fn(),
		listPrincipalEntitled: vi.fn(),
		replaceManagedGrants: vi.fn(),
		retireResourceGrants: vi.fn(),
	};
}

/** Creates the repository over a transaction that exposes every inspected row and clock. */
function _Repository(row = _FiringRow({ preparationReceipt: _PREPARATION, activationReceipt: _ACTIVATION, routine: { ..._Routine(), originalRequesterPrincipalId: "principal-1" }, revision: _Revision() }))
{
	const findFirst = vi.fn().mockResolvedValue(row);
	const transaction = {
		agentRoutineFiring: { findFirst, updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		agentRoutine: { findFirst: vi.fn().mockResolvedValue(_Routine()), agentRoutineRevision: undefined },
		agentRoutineRevision: { findUnique: vi.fn().mockResolvedValue(_Revision()) },
		agentRunAuthorityClock: { findUnique: vi.fn().mockResolvedValue({ now: _NOW }) },
		principal: { findMany: vi.fn().mockResolvedValue([{ id: "principal-1", subject: "subject-1" }, { id: "principal-2", subject: "subject-2" }]) },
		conversation: { findFirst: vi.fn().mockResolvedValue({ participants: [{ userId: "subject-1" }, { userId: "subject-2" }] }) },
		agentService: { findFirst: vi.fn().mockResolvedValue({ id: "service-1", principalId: "service-principal-1", activeRevisionId: "service-revision-1", activeRevision: { id: "service-revision-1", state: AgentRevisionState.Published, publishedAt: _NOW } }) },
	};
	const authorization = _Authorization();
	const repository = new PrismaRoutineOccurrenceRunAdmissionRepository(transaction as unknown as Prisma.TransactionClient, {
		authorization: vi.fn().mockReturnValue(authorization) as unknown as (client: Prisma.TransactionClient) => AuthorizationAuthority,
		taskAdmission: _TaskAdmission() as unknown as RoutineTaskAdmissionPort<Prisma.TransactionClient>,
	});
	return { repository, transaction, authorization };
}

describe("PrismaRoutineOccurrenceRunAdmissionRepository", function _Suite()
{
	it("authorizes the exact saved command and both receipts", async function _ExactSavedEvidence()
	{
		const f = _Repository();

		await expect(f.repository.authorize(_Command())).resolves.toBe(true);
		expect(f.transaction.agentRoutineFiring.findFirst).toHaveBeenCalled();
		expect(f.transaction.agentRoutineFiring.updateMany).not.toHaveBeenCalled();
	});

	it.each([
		["task", { task: { ..._IDENTITY.task, idempotencyKey: "other-key" } }],
		["preparation", { preparation: { ..._PREPARATION, receiptId: "other-preparation" } }],
		["activation", { activation: { ..._ACTIVATION, receiptId: "other-activation" } }],
	] as const)("rejects substituted %s evidence", async function _Substitution(_name, patch)
	{
		await expect(_Repository().repository.authorize(_Command(patch))).rejects.toThrow(/routine (occurrence stage does not match its saved task fence|run admission receipts differ from saved stage evidence)/iu);
	});

	it("returns false after current authority denies the final stage", async function _CurrentDenial()
	{
		const f = _Repository();
		f.transaction.agentRoutine.findFirst.mockResolvedValue(null);

		await expect(f.repository.authorize(_Command())).resolves.toBe(false);
		expect(f.transaction.agentRoutineFiring.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ disposition: AgentRoutineFiringDisposition.Refused, refusalReason: "stage_run_admission_current_authority_refused" }) }));
	});

	it("rejects a firing that already has an admitted run", async function _AdmittedRun()
	{
		const f = _Repository(_FiringRow({ preparationReceipt: _PREPARATION, activationReceipt: _ACTIVATION, runId: "run-1", disposition: AgentRoutineFiringDisposition.Running }));

		await expect(f.repository.authorize(_Command())).rejects.toThrow("Routine run admission differs from its saved unadmitted firing");
		await expect(f.repository.recover(_Command(), "run-1")).resolves.toBe(true);
		await expect(f.repository.recover(_Command(), "run-other")).resolves.toBe(false);
		await expect(f.repository.refuse(_Command())).resolves.toBe(false);
		expect(f.transaction.agentRoutineFiring.updateMany).not.toHaveBeenCalled();
	});

	it("does not recover a run from an unadmitted firing", async function _RecoverUnadmitted()
	{
		const f = _Repository();

		await expect(f.repository.recover(_Command(), "run-1")).resolves.toBe(false);
		expect(f.transaction.agentRoutineFiring.updateMany).not.toHaveBeenCalled();
	});

	it("refuses only a preparing unadmitted firing with a compare-and-set", async function _RefusePreparing()
	{
		const f = _Repository();

		await expect(f.repository.refuse(_Command())).resolves.toBe(true);
		expect(f.transaction.agentRoutineFiring.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ disposition: AgentRoutineFiringDisposition.Preparing, runId: null }), data: expect.objectContaining({ disposition: AgentRoutineFiringDisposition.Refused, refusalReason: "run_admission_current_authority_refused", finishedAt: _NOW, updatedAt: _NOW }) }));
	});

	it("recovers an existing refusal without writing it again", async function _RefusedReplay()
	{
		const f = _Repository(_FiringRow({ preparationReceipt: _PREPARATION, activationReceipt: _ACTIVATION, disposition: AgentRoutineFiringDisposition.Refused }));

		await expect(f.repository.refuse(_Command())).resolves.toBe(true);
		expect(f.transaction.agentRoutineFiring.updateMany).not.toHaveBeenCalled();
	});

	it("fails closed when the refusal compare-and-set loses the preparing row", async function _RefuseConflict()
	{
		const f = _Repository();
		f.transaction.agentRoutineFiring.updateMany.mockResolvedValue({ count: 0 });

		await expect(f.repository.refuse(_Command())).rejects.toThrow("lost its preparing firing");
	});
});
