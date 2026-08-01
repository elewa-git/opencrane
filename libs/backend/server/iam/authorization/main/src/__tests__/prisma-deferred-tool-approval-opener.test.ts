import { describe, expect, it, vi } from "vitest";

import { __OpenDeferredToolApproval } from "../prisma-deferred-tool-approval-opener.js";

/** Structured logger double used to verify ambiguous-recovery evidence. */
function _Logger()
{
	return { error: vi.fn(), warn: vi.fn() };
}

/** Build the exact command shared by deferred-approval opener scenarios. */
function _Command()
{
	const now = new Date("2026-07-29T00:00:00.000Z");
	return { runId: "run-1", attempt: 1, toolInvocationId: "invoke-1", toolRevisionId: "integration:calendar:read", argumentsDigest: "sha256:args", capabilitySetDigest: "sha256:capabilities", reservationId: "reservation-1", now, expiresAt: new Date(now.getTime() + 60_000) };
}

/** Build a live workload transaction that can create one linked approval. */
function _LiveTransaction()
{
	return {
		workloadAssignment: { findUnique: vi.fn(async function _assignment() { return { agentRevisionId: "revision-1", agentServiceId: "service-1", siloId: "silo-1", subjectId: "subject-1", audience: "audience-1", serviceAccountName: "runtime-1", namespace: "runtime", workloadKind: "Job", workloadUid: "job-1", podUid: "pod-1" }; }) },
		runProofKey: { findUnique: vi.fn(async function _proof() { return { id: "proof-1", keyThumbprint: "thumbprint-1" }; }) },
		approvalRequest: { create: vi.fn(async function _create() { return { id: "approval-1" }; }) },
		toolInvocation: { updateMany: vi.fn() },
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
		expect(transaction.approvalRequest.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ toolInvocationRowId: "reservation-1", actionDigest: "invoke-1" }) }));
	});

	it("terminalises the reservation when no live workload can own the approval", async function _terminalisesUnavailable()
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
		const prisma = {
			$transaction: vi.fn(async function _transaction() { throw new Error("connection lost"); }),
			approvalRequest: { findFirst: vi.fn(async function _approval() { return { id: "approval-1" }; }) },
			toolInvocation: { updateMany: vi.fn() },
		};

		const logger = _Logger();
		await expect(__OpenDeferredToolApproval(prisma as never, _Command(), logger as never)).resolves.toBe(true);
		expect(prisma.toolInvocation.updateMany).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error), runId: "run-1", reservationId: "reservation-1" }), expect.stringContaining("ambiguous"));
	});

	it("fails a reservation when transaction recovery finds no linked approval", async function _failsUnlinkedReservation()
	{
		const prisma = {
			$transaction: vi.fn(async function _transaction() { throw new Error("connection lost"); }),
			approvalRequest: { findFirst: vi.fn(async function _approval() { return null; }) },
			toolInvocation: { updateMany: vi.fn(async function _fail() { return { count: 1 }; }) },
		};

		await expect(__OpenDeferredToolApproval(prisma as never, _Command(), _Logger() as never)).resolves.toBe(false);
		expect(prisma.toolInvocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ failureCode: "approval_defer_failed" }) }));
	});

	it("surfaces an unresolved reservation when recovery cannot prove or terminalise it", async function _surfacesUnresolvedRecovery()
	{
		const prisma = {
			$transaction: vi.fn(async function _transaction() { throw new Error("connection lost"); }),
			approvalRequest: { findFirst: vi.fn(async function _approval() { throw new Error("recovery read unavailable"); }) },
			toolInvocation: { updateMany: vi.fn(async function _fail() { throw new Error("terminalisation unavailable"); }) },
		};
		const logger = _Logger();

		await expect(__OpenDeferredToolApproval(prisma as never, _Command(), logger as never)).rejects.toThrow("could not terminalise");
		expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error), transactionError: expect.any(Error), runId: "run-1", attempt: 1, reservationId: "reservation-1" }), expect.stringContaining("could not terminalise"));
	});
});
