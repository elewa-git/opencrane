import { AgentRunState, ExternalActionRecoveryMode, Prisma, ToolInvocationState, WorkloadAssignmentState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { __OpenDeferredToolApproval } from "../prisma-deferred-tool-approval-opener.js";
import { __DigestCanonicalJson } from "../canonical-json-digest.js";

/** Structured logger double used to verify ambiguous-recovery evidence. */
function _Logger()
{
	return { error: vi.fn(), warn: vi.fn() };
}

/** Build the exact command shared by deferred-approval opener scenarios. */
function _Command()
{
	const now = new Date("2026-07-29T00:00:00.000Z");
	const argumentsValue = { calendarId: "primary" };
	const parametersSchema = { type: "object", additionalProperties: false, required: ["calendarId"], properties: { calendarId: { type: "string" } } };
	return { interruptId: "interrupt-1", runId: "run-1", attempt: 1, toolInvocationId: "invoke-1", toolRevisionId: "integration:calendar:read", arguments: argumentsValue, argumentsDigest: __DigestCanonicalJson(argumentsValue), parametersSchema, parametersSchemaDigest: __DigestCanonicalJson(parametersSchema), capabilitySetDigest: "sha256:capabilities", invocationId: "invocation-1", now, expiresAt: new Date(now.getTime() + 60_000) };
}

/** Build the complete awaiting-approval invocation returned by the transaction repository. */
function _Invocation()
{
	const argumentsValue = { calendarId: "primary" };
	return { id: "invocation-1", siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", subjectId: "subject-1", runtimeInstanceId: "runtime-1", commandId: "command-1", candidateId: "candidate-1", toolRevisionId: "integration:calendar:read", toolInvocationId: "invoke-1", arguments: argumentsValue, argumentsDigest: __DigestCanonicalJson(argumentsValue), effectiveArguments: argumentsValue, effectiveArgumentsDigest: __DigestCanonicalJson(argumentsValue), requestFingerprint: "sha256:fingerprint", requestIdentity: {}, approvalRequired: true, recoveryMode: ExternalActionRecoveryMode.Manual, recoveryKey: null, state: ToolInvocationState.AwaitingApproval, preparationAttempt: 1, retryDeadlineAt: new Date("2026-07-29T00:05:00.000Z"), nextPreparationAttemptAt: new Date("2026-07-29T00:00:00.000Z"), claimAttempt: 0, claimKind: null, claimFence: 0, claimExpiresAt: null, recoveryRequiredAt: null, result: null, failureCode: null, revision: 1, createdAt: new Date("2026-07-29T00:00:00.000Z"), updatedAt: new Date("2026-07-29T00:00:00.000Z"), completedAt: null };
}

/** Build a live workload transaction that can create one linked approval. */
function _LiveTransaction()
{
	return {
		workloadAssignment: { findUnique: vi.fn(async function _assignment() { return { agentRevisionId: "revision-1", agentServiceId: "service-1", siloId: "silo-1", subjectId: "subject-1", audience: "audience-1", serviceAccountName: "runtime-1", namespace: "runtime", workloadKind: "Job", workloadUid: "job-1", podUid: "pod-1", state: WorkloadAssignmentState.Registered, expiresAt: new Date("2026-07-29T00:02:00.000Z") }; }) },
		runProofKey: { findUnique: vi.fn(async function _proof() { return { id: "proof-1", keyThumbprint: "thumbprint-1", expiresAt: new Date("2026-07-29T00:01:30.000Z"), revokedAt: null }; }) },
		agentRun: { findUnique: vi.fn(async function _run() { return { id: "run-1", attempt: 1, state: AgentRunState.Running }; }), updateMany: vi.fn(async function _pause() { return { count: 1 }; }) },
		approvalRequest: { create: vi.fn(async function _create() { return { id: "approval-1" }; }), findFirst: vi.fn(async function _existing() { return null; }), count: vi.fn(async function _pending() { return 0; }) },
			toolInvocation: { findUnique: vi.fn(async function _invocation() { return _Invocation(); }), updateMany: vi.fn() },
		toolResultDelivery: { create: vi.fn(async function _delivery() { return { id: "delivery-1" }; }) },
	};
}

describe("Prisma deferred-tool approval opener", function _describeOpener()
{
	it("creates the approval inside the caller-owned transaction", async function _createsApproval()
	{
		const transaction = _LiveTransaction();
		const prisma = {
			$transaction: vi.fn(async function _transaction(callback) { return callback(transaction); }),
			approvalRequest: { findFirst: vi.fn() },
			toolInvocation: { updateMany: vi.fn() },
		};

		await expect(__OpenDeferredToolApproval(prisma as never, _Command(), _Logger() as never)).resolves.toBe(true);
		expect(transaction.approvalRequest.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: "interrupt-1", toolInvocationRowId: "invocation-1", reviewedToolArguments: { calendarId: "primary" }, reviewedToolSchema: expect.any(Object), actionDigest: expect.stringMatching(/^sha256:/) }) }));
		expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	});

	it("fails closed before approval creation when the compiled schema digest is stale", async function _rejectsStaleSchemaDigest()
	{
		const transaction = _LiveTransaction();
		transaction.toolInvocation.updateMany.mockResolvedValueOnce({ count: 1 } as never);
		const prisma = { $transaction: vi.fn(async function _transaction(callback) { return callback(transaction); }) };

		await expect(__OpenDeferredToolApproval(prisma as never, { ..._Command(), parametersSchemaDigest: "sha256:stale" }, _Logger() as never)).resolves.toBe(false);
		expect(transaction.approvalRequest.create).not.toHaveBeenCalled();
		expect(transaction.toolInvocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ failureCode: "approval_arguments_invalid" }) }));
	});

	it("terminalises the invocation when no live workload can own the approval", async function _terminalisesUnavailable()
	{
		const transaction = _LiveTransaction();
		transaction.workloadAssignment.findUnique.mockResolvedValueOnce(null as never);
		transaction.toolInvocation.updateMany.mockResolvedValueOnce({ count: 1 } as never);
		const prisma = { $transaction: vi.fn(async function _transaction(callback) { return callback(transaction); }), approvalRequest: { findFirst: vi.fn() }, toolInvocation: { updateMany: vi.fn() } };

		await expect(__OpenDeferredToolApproval(prisma as never, _Command(), _Logger() as never)).resolves.toBe(false);
		expect(transaction.toolInvocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ failureCode: "approval_unavailable" }) }));
	});

	it("recognises a linked approval after an ambiguous transaction failure", async function _recoversCommittedApproval()
	{
		const recoveryTransaction = { approvalRequest: { findFirst: vi.fn(async function _approval() { return { id: "approval-1" }; }) } };
		const prisma = {
			$transaction: vi.fn()
				.mockRejectedValueOnce(new Error("connection lost"))
				.mockImplementationOnce(async function _recover(callback) { return callback(recoveryTransaction); }),
		};

		const logger = _Logger();
		await expect(__OpenDeferredToolApproval(prisma as never, _Command(), logger as never)).resolves.toBe(true);
		expect(prisma.$transaction).toHaveBeenCalledTimes(2);
		expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error), runId: "run-1", invocationId: "invocation-1" }), expect.stringContaining("ambiguous"));
	});

	it("fails an invocation when transaction recovery finds no linked approval", async function _failsUnlinkedInvocation()
	{
		const recoveryTransaction = { approvalRequest: { findFirst: vi.fn(async function _approval() { return null; }) } };
		const terminalisationTransaction = { approvalRequest: { findFirst: vi.fn(async function _approval() { return null; }) }, toolInvocation: { findUnique: vi.fn(async function _invocation() { return _Invocation(); }), updateMany: vi.fn(async function _fail() { return { count: 1 }; }) }, toolResultDelivery: { create: vi.fn() } };
		const prisma = {
			$transaction: vi.fn()
				.mockRejectedValueOnce(new Error("connection lost"))
				.mockImplementationOnce(async function _recover(callback) { return callback(recoveryTransaction); })
				.mockImplementationOnce(async function _terminalise(callback) { return callback(terminalisationTransaction); }),
		};

		await expect(__OpenDeferredToolApproval(prisma as never, _Command(), _Logger() as never)).resolves.toBe(false);
		expect(terminalisationTransaction.toolInvocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ failureCode: "approval_defer_failed" }) }));
	});

	it("rechecks linkage before terminalising after the first recovery read fails", async function _rechecksLinkedApproval()
	{
		const failedReadTransaction = { approvalRequest: { findFirst: vi.fn(async function _approval() { throw new Error("recovery read unavailable"); }) } };
		const linkedTransaction = { approvalRequest: { findFirst: vi.fn(async function _approval() { return { id: "interrupt-1" }; }) }, toolInvocation: { updateMany: vi.fn() } };
		const prisma = {
			$transaction: vi.fn()
				.mockRejectedValueOnce(new Error("connection lost after commit"))
				.mockImplementationOnce(async function _recover(callback) { return callback(failedReadTransaction); })
				.mockImplementationOnce(async function _recheck(callback) { return callback(linkedTransaction); }),
		};

		await expect(__OpenDeferredToolApproval(prisma as never, _Command(), _Logger() as never)).resolves.toBe(true);
		expect(linkedTransaction.approvalRequest.findFirst).toHaveBeenCalledWith({ where: { id: "interrupt-1", runId: "run-1", attempt: 1, toolInvocationRowId: "invocation-1" } });
		expect(linkedTransaction.toolInvocation.updateMany).not.toHaveBeenCalled();
	});

	it("surfaces an unresolved invocation when recovery cannot prove or terminalise it", async function _surfacesUnresolvedRecovery()
	{
		const recoveryTransaction = { approvalRequest: { findFirst: vi.fn(async function _approval() { throw new Error("recovery read unavailable"); }) } };
		const terminalisationTransaction = { approvalRequest: { findFirst: vi.fn(async function _approval() { return null; }) }, toolInvocation: { updateMany: vi.fn(async function _fail() { throw new Error("terminalisation unavailable"); }) } };
		const prisma = {
			$transaction: vi.fn()
				.mockRejectedValueOnce(new Error("connection lost"))
				.mockImplementationOnce(async function _recover(callback) { return callback(recoveryTransaction); })
				.mockImplementationOnce(async function _terminalise(callback) { return callback(terminalisationTransaction); }),
		};
		const logger = _Logger();

		await expect(__OpenDeferredToolApproval(prisma as never, _Command(), logger as never)).rejects.toThrow("could not terminalise");
		expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error), runId: "run-1", attempt: 1, invocationId: "invocation-1" }), expect.stringContaining("could not terminalise"));
		expect(JSON.stringify(logger.error.mock.calls)).not.toContain("transactionError");
	});
});
