import { ApprovalRequestState, Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { __DecideDeferredToolRequest, __DeferToolRequest } from "../deferred-tool-approval.js";
import { __DigestCanonicalJson } from "../canonical-json-digest.js";
import { DeferredToolDecisionKinds } from "../deferred-tool-approval.types.js";

/** Build a transaction whose approvalRequest reads return the supplied row and writes report a count. */
function _transaction(row: unknown, updatedCount: number, invocationRow: unknown = { id: "tool-1", runId: "run-1", attempt: 2, toolInvocationId: "call-7", toolRevisionId: "integration:search:query", argumentsDigest: __DigestCanonicalJson({ query: "original" }) }): { transaction: Prisma.TransactionClient; updateMany: ReturnType<typeof vi.fn> }
{
	const findUnique = vi.fn().mockResolvedValue(row);
	const updateMany = vi.fn().mockResolvedValue({ count: updatedCount });
	const invocationFindUnique = vi.fn().mockResolvedValue(invocationRow);
	return { transaction: { approvalRequest: { findUnique, updateMany }, toolInvocation: { findUnique: invocationFindUnique } } as unknown as Prisma.TransactionClient, updateMany };
}

/** A pending deferred-tool approval bound to a tool invocation row. */
function _pending(): unknown
{
	const schema = { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string" } } };
	return { id: "approval-1", runId: "run-1", attempt: 2, siloId: "silo-1", subjectId: "user-1", toolInvocationRowId: "tool-1", resourceId: "integration:search:query", argumentsDigest: __DigestCanonicalJson({ query: "original" }), reviewedToolSchema: schema, reviewedToolSchemaDigest: __DigestCanonicalJson(schema), state: ApprovalRequestState.Pending, expiresAt: new Date("2026-07-22T09:00:00.000Z") };
}

const NOW = new Date("2026-07-21T09:00:00.000Z");

describe("deferred tool approval authority", function _suite()
{
	it("approves and records the complete validated replacement arguments", async function _approve()
	{
		const { transaction, updateMany } = _transaction(_pending(), 1);
		const result = await __DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", subjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: { query: "edited" }, decidedBy: "user-1", now: NOW });
		expect(result).toEqual({ outcome: "approved", argumentsDigest: __DigestCanonicalJson({ query: "edited" }) });
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "approval-1", state: ApprovalRequestState.Pending, expiresAt: { gt: NOW } }), data: expect.objectContaining({ state: ApprovalRequestState.Approved, finalArguments: { query: "edited" }, finalArgumentsDigest: __DigestCanonicalJson({ query: "edited" }), resumeTokenHash: expect.stringMatching(/^sha256:/) }) }));
	});

	it("conflicts when the reserved tool invocation is missing or belongs to another attempt", async function _brokenReservationLink()
	{
		for (const invocationRow of [null, { id: "tool-1", runId: "run-other", attempt: 2, toolInvocationId: "call-7" }, { id: "tool-1", runId: "run-1", attempt: 9, toolInvocationId: "call-7" }])
		{
			const { transaction, updateMany } = _transaction(_pending(), 1, invocationRow);
			const result = await __DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", subjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: { query: "edited" }, decidedBy: "user-1", now: NOW });
			expect(result).toEqual({ outcome: "conflict" });
			expect(updateMany).not.toHaveBeenCalled();
		}
	});

	it("denies by closing the pending request without a result", async function _deny()
	{
		const { transaction } = _transaction(_pending(), 1);
		const result = await __DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", subjectId: "user-1", decision: DeferredToolDecisionKinds.Denied, decidedBy: "user-1", now: NOW });
		expect(result).toEqual({ outcome: "denied" });
	});

	it("replays an identical decision idempotently", async function _idempotent()
	{
		const finalArguments = { query: "edited" };
		const { transaction, updateMany } = _transaction({ ..._pending() as object, state: ApprovalRequestState.Approved, finalArgumentsDigest: __DigestCanonicalJson(finalArguments) }, 0);
		const result = await __DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", subjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: finalArguments, decidedBy: "user-1", now: NOW });
		expect(result).toEqual({ outcome: "already_decided", decision: DeferredToolDecisionKinds.Approved, argumentsDigest: __DigestCanonicalJson(finalArguments) });
		expect(updateMany).not.toHaveBeenCalled();
	});

	it("conflicts when re-decided the other way", async function _conflict()
	{
		const { transaction } = _transaction({ ..._pending() as object, state: ApprovalRequestState.Approved }, 0);
		const result = await __DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", subjectId: "user-1", decision: DeferredToolDecisionKinds.Denied, decidedBy: "user-1", now: NOW });
		expect(result).toEqual({ outcome: "conflict" });
	});

	it("conflicts on a row that is not a deferred-tool approval", async function _notTool()
	{
		const { transaction } = _transaction({ ..._pending() as object, toolInvocationRowId: null }, 0);
		const result = await __DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", subjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: { query: "edited" }, decidedBy: "user-1", now: NOW });
		expect(result).toEqual({ outcome: "conflict" });
	});

	it("expires a pending approval before it can be decided", async function _expires()
	{
		const { transaction, updateMany } = _transaction({ ..._pending() as object, expiresAt: new Date("2026-07-20T09:00:00.000Z") }, 1);
		const result = await __DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", subjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: { query: "edited" }, decidedBy: "user-1", now: NOW });
		expect(result).toEqual({ outcome: "expired" });
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
			where: expect.objectContaining({ state: ApprovalRequestState.Pending, expiresAt: { lte: NOW } }),
			data: expect.objectContaining({ state: ApprovalRequestState.Expired, resumeTokenHash: null }),
		}));
	});

	it("does not let a different subject decide an otherwise valid approval", async function _wrongOwner()
	{
		const { transaction, updateMany } = _transaction(_pending(), 1);
		const result = await __DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", subjectId: "user-2", decision: DeferredToolDecisionKinds.Approved, arguments: { query: "edited" }, decidedBy: "user-2", now: NOW });
		expect(result).toEqual({ outcome: "conflict" });
		expect(updateMany).not.toHaveBeenCalled();
	});

	it("propagates a stale approval trigger so the transaction owner can roll back", async function _staleAuthority()
	{
		const { transaction, updateMany } = _transaction(_pending(), 1);
		updateMany.mockRejectedValueOnce(new Error("ApprovalRequest decision authority is no longer current"));

		await expect(__DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", subjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: { query: "edited" }, decidedBy: "user-1", now: NOW })).rejects.toThrow("ApprovalRequest decision authority is no longer current");
	});
});

/** Live assignment + proof key the defer authority binds the approval to. */
const ASSIGNMENT = { agentServiceId: "svc-1", agentRevisionId: "rev-1", siloId: "silo-1", subjectId: "user-1", audience: "opencrane-agent-runtime", serviceAccountName: "agent-runtime-1", namespace: "silo-1-runtime", workloadKind: "Job", workloadUid: "wl-1", podUid: "pod-1" };
const PROOF_KEY = { id: "proof-1", keyThumbprint: "thumb-1" };

/** Command opening a pending deferred-tool approval for a reserved invocation. */
function _deferCommand(): Parameters<typeof __DeferToolRequest>[1]
{
	const schema = { type: "object", properties: { query: { type: "string" } } };
	return { interruptId: "approval-existing", runId: "run-1", attempt: 2, toolInvocationRowId: "tool-1", toolRevisionId: "integration:search:query", reviewedArguments: { query: "original" }, argumentsDigest: __DigestCanonicalJson({ query: "original" }), reviewedParametersSchema: schema, reviewedParametersSchemaDigest: __DigestCanonicalJson(schema), safeProposedArguments: { query: "original" }, responseSchema: { type: "object" }, actionDigest: "invocation-1", effectivePolicyDigest: "sha256:cap", approverPolicyRevision: "integration-tools-require-approval", now: NOW, expiresAt: new Date("2026-07-22T09:00:00.000Z") };
}

describe("defer tool request authority", function _deferSuite()
{
	it("opens a pending approval bound to the reserved tool invocation and live workload", async function _defers()
	{
		const create = vi.fn().mockResolvedValue({ id: "approval-9" });
		const transaction = {
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(ASSIGNMENT) },
			runProofKey: { findUnique: vi.fn().mockResolvedValue(PROOF_KEY) },
			approvalRequest: { create },
		} as unknown as Prisma.TransactionClient;

		const result = await __DeferToolRequest(transaction, _deferCommand());

		expect(result).toEqual({ outcome: "deferred", approvalRequestId: "approval-9" });
		expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: ApprovalRequestState.Pending, toolInvocationRowId: "tool-1", resourceKind: "tool", resourceId: "integration:search:query", proofKeyId: "proof-1" }) }));
	});

	it("reports unavailable when the live workload or proof key is absent", async function _unavailable()
	{
		const transaction = {
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(ASSIGNMENT) },
			runProofKey: { findUnique: vi.fn().mockResolvedValue(null) },
			approvalRequest: { create: vi.fn() },
		} as unknown as Prisma.TransactionClient;

		expect(await __DeferToolRequest(transaction, _deferCommand())).toEqual({ outcome: "unavailable" });
	});

	it("replays the existing approval idempotently on a duplicate defer", async function _idempotentDefer()
	{
		const create = vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "6" }));
		const transaction = {
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(ASSIGNMENT) },
			runProofKey: { findUnique: vi.fn().mockResolvedValue(PROOF_KEY) },
			approvalRequest: { create, findFirst: vi.fn().mockResolvedValue({ id: "approval-existing", argumentsDigest: _deferCommand().argumentsDigest, reviewedToolSchemaDigest: _deferCommand().reviewedParametersSchemaDigest }) },
		} as unknown as Prisma.TransactionClient;

		expect(await __DeferToolRequest(transaction, _deferCommand())).toEqual({ outcome: "already_deferred", approvalRequestId: "approval-existing" });
	});
});
