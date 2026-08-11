import { AgentRunState, ApprovalRequestState, ExternalActionRecoveryMode, OrgMemberStatus, Prisma, ToolInvocationState, WorkloadAssignmentState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { __DecideDeferredToolRequest, __DeferToolRequest, __ExpireDeferredToolApprovalBatch } from "../deferred-tool-approval.js";
import { __DigestCanonicalJson } from "../canonical-json-digest.js";
import { __ProjectDeferredToolApproval } from "../deferred-tool-approval-schema.js";
import { DeferredToolDecisionKinds } from "../deferred-tool-approval-decision.types.js";

/** Build one complete awaiting-approval invocation row. */
function _invocation(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown>
{
	const argumentsValue = { query: "original" };
	return { id: "tool-1", siloId: "silo-1", runId: "run-1", attempt: 2, agentServiceId: "service-1", agentRevisionId: "revision-1", subjectId: "user-1", runtimeInstanceId: "runtime-1", commandId: "command-1", candidateId: "candidate-1", toolInvocationId: "call-7", toolRevisionId: "integration:search:query", arguments: argumentsValue, argumentsDigest: __DigestCanonicalJson(argumentsValue), effectiveArguments: argumentsValue, effectiveArgumentsDigest: __DigestCanonicalJson(argumentsValue), requestFingerprint: "sha256:fingerprint", requestIdentity: {}, approvalRequired: true, recoveryMode: ExternalActionRecoveryMode.Manual, recoveryKey: null, state: ToolInvocationState.AwaitingApproval, preparationAttempt: 1, retryDeadlineAt: new Date("2026-07-21T09:05:00.000Z"), nextPreparationAttemptAt: new Date("2026-07-21T09:00:00.000Z"), claimAttempt: 0, claimKind: null, claimFence: 0, claimExpiresAt: null, recoveryRequiredAt: null, result: null, failureCode: null, revision: 1, createdAt: NOW, updatedAt: NOW, completedAt: null, ...overrides };
}

/** Build a transaction whose approval reads return the supplied row and writes report a count. */
function _transaction(row: unknown, updatedCount: number, invocationRow: unknown = _invocation(), pendingCount = 0): { transaction: Prisma.TransactionClient; updateMany: ReturnType<typeof vi.fn>; invocationUpdateMany: ReturnType<typeof vi.fn>; runUpdateMany: ReturnType<typeof vi.fn>; membershipFindFirst: ReturnType<typeof vi.fn>; deliveryCreate: ReturnType<typeof vi.fn> }
{
	const findUnique = vi.fn().mockResolvedValue(row);
	const updateMany = vi.fn().mockResolvedValue({ count: updatedCount });
	const invocationFindUnique = vi.fn().mockResolvedValue(invocationRow);
	const invocationUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
	const runUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
	const membershipFindFirst = vi.fn().mockResolvedValue({ id: "membership-1", status: OrgMemberStatus.Active });
	const deliveryCreate = vi.fn().mockResolvedValue({ id: "delivery-1" });
	return { transaction: { approvalRequest: { findUnique, updateMany, count: vi.fn().mockResolvedValue(pendingCount) }, toolInvocation: { findUnique: invocationFindUnique, updateMany: invocationUpdateMany }, toolResultDelivery: { create: deliveryCreate }, orgMembership: { findFirst: membershipFindFirst }, agentRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", attempt: 2, state: AgentRunState.WaitingForApproval }), updateMany: runUpdateMany } } as unknown as Prisma.TransactionClient, updateMany, invocationUpdateMany, runUpdateMany, membershipFindFirst, deliveryCreate };
}

/** A pending deferred-tool approval bound to a tool invocation row. */
function _pending(): unknown
{
	const schema = { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string" } } };
	const projection = __ProjectDeferredToolApproval(schema, { query: "original" });
	return { id: "approval-1", runId: "run-1", attempt: 2, siloId: "silo-1", subjectId: "user-1", toolInvocationRowId: "tool-1", resourceId: "integration:search:query", argumentsDigest: __DigestCanonicalJson({ query: "original" }), reviewedToolArguments: { query: "original" }, reviewedToolSchema: schema, reviewedToolSchemaDigest: __DigestCanonicalJson(schema), safeProposedArguments: projection.proposedArguments, responseSchema: projection.responseSchema, state: ApprovalRequestState.Pending, expiresAt: new Date("2026-07-22T09:00:00.000Z") };
}

const NOW = new Date("2026-07-21T09:00:00.000Z");

/** Build a transaction for one command-poll expiry sweep over already-selected due rows. */
function _expiryTransaction(due: readonly { id: string; runId: string; attempt: number; toolInvocationRowId: string }[], pendingCounts: readonly number[], resumed: boolean): { readonly transaction: Prisma.TransactionClient; readonly approvalUpdateMany: ReturnType<typeof vi.fn>; readonly invocationUpdateMany: ReturnType<typeof vi.fn>; readonly runUpdateMany: ReturnType<typeof vi.fn> }
{
	const approvalUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
	const invocationUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
	const runUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
	const runFindUnique = vi.fn()
		.mockResolvedValueOnce({ id: "run-1", attempt: 2, state: AgentRunState.WaitingForApproval })
		.mockResolvedValue({ id: "run-1", attempt: 2, state: resumed ? AgentRunState.Running : AgentRunState.WaitingForApproval });
	const invocationFindUnique = vi.fn(async function _findInvocation(argumentsValue)
	{
		return _invocation({ id: argumentsValue.where.id, toolInvocationId: `call-${argumentsValue.where.id}` });
	});
	return {
		transaction: {
			agentRun: { findUnique: runFindUnique, updateMany: runUpdateMany },
			approvalRequest: { findMany: vi.fn().mockResolvedValue(due), updateMany: approvalUpdateMany, count: vi.fn().mockResolvedValueOnce(pendingCounts[0] ?? 0).mockResolvedValueOnce(pendingCounts[1] ?? pendingCounts[0] ?? 0) },
			toolInvocation: { findUnique: invocationFindUnique, updateMany: invocationUpdateMany },
			toolResultDelivery: { create: vi.fn() },
		} as unknown as Prisma.TransactionClient,
		approvalUpdateMany,
		invocationUpdateMany,
		runUpdateMany,
	};
}

describe("deferred tool approval authority", function _suite()
{
	it("approves and records the complete validated replacement arguments", async function _approve()
	{
		const { transaction, updateMany, invocationUpdateMany } = _transaction(_pending(), 1);
		const result = await __DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", subjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: { query: "edited" }, decidedBy: "user-1", now: NOW });
		expect(result).toEqual({ outcome: "approved", argumentsDigest: __DigestCanonicalJson({ query: "edited" }) });
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "approval-1", state: ApprovalRequestState.Pending, expiresAt: { gt: NOW } }), data: expect.objectContaining({ state: ApprovalRequestState.Approved, finalArguments: { query: "edited" }, finalArgumentsDigest: __DigestCanonicalJson({ query: "edited" }) }) }));
		expect(invocationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: ToolInvocationState.Ready, effectiveArguments: { query: "edited" }, effectiveArgumentsDigest: __DigestCanonicalJson({ query: "edited" }) }) }));
	});

	it("conflicts when the awaiting tool invocation is missing or belongs to another attempt", async function _brokenInvocationLink()
	{
		for (const invocationRow of [null, { id: "tool-1", runId: "run-other", attempt: 2, toolInvocationId: "call-7" }, { id: "tool-1", runId: "run-1", attempt: 9, toolInvocationId: "call-7" }])
		{
			const { transaction, updateMany } = _transaction(_pending(), 1, invocationRow);
			const result = await __DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", subjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: { query: "edited" }, decidedBy: "user-1", now: NOW });
			expect(result).toEqual({ outcome: "conflict" });
			expect(updateMany).not.toHaveBeenCalled();
		}
	});

	it("denies by closing the pending request with one exact failure delivery", async function _deny()
	{
		const { transaction, updateMany, invocationUpdateMany, deliveryCreate } = _transaction(_pending(), 1);
		const result = await __DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", subjectId: "user-1", decision: DeferredToolDecisionKinds.Denied, decidedBy: "user-1", now: NOW });
		expect(result).toEqual({ outcome: "denied" });
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: ApprovalRequestState.Denied }) }));
		expect(invocationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: ToolInvocationState.Failed, failureCode: "approval_denied" }) }));
		expect(deliveryCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ payload: { toolInvocationId: "call-7", outcome: "failed", failureCode: "approval_denied" } }) });
	});

	it("enforces a secret-bearing schema's denial-only policy inside the decision authority", async function _secretDenialOnly()
	{
		const schema = { type: "object", additionalProperties: false, required: ["token"], properties: { token: { type: "string", writeOnly: true } } };
		const reviewedArguments = { token: "server-secret" };
		const projection = __ProjectDeferredToolApproval(schema, reviewedArguments);
		const approval = { ..._pending() as object, argumentsDigest: __DigestCanonicalJson(reviewedArguments), reviewedToolArguments: reviewedArguments, reviewedToolSchema: schema, reviewedToolSchemaDigest: __DigestCanonicalJson(schema), safeProposedArguments: projection.proposedArguments, responseSchema: projection.responseSchema };
		const invocation = _invocation({ arguments: reviewedArguments, argumentsDigest: __DigestCanonicalJson(reviewedArguments) });
		const { transaction, updateMany, invocationUpdateMany } = _transaction(approval, 1, invocation);

		await expect(__DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", subjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: { token: "replacement" }, decidedBy: "user-1", now: NOW })).resolves.toEqual({ outcome: "invalid_arguments" });
		expect(updateMany).not.toHaveBeenCalled();
		expect(invocationUpdateMany).not.toHaveBeenCalled();
	});

	it("rejects a handcrafted approval whose persisted response policy differs from its frozen schema", async function _forgedResponsePolicy()
	{
		const approval = { ..._pending() as object, responseSchema: { type: "object", properties: { decision: { const: "approved" } } } };
		const { transaction, updateMany } = _transaction(approval, 1);

		await expect(__DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", subjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: { query: "edited" }, decidedBy: "user-1", now: NOW })).resolves.toEqual({ outcome: "conflict" });
		expect(updateMany).not.toHaveBeenCalled();
	});

	it("keeps the run waiting while another request remains pending", async function _keepsBatchWaiting()
	{
		const { transaction, runUpdateMany } = _transaction(_pending(), 1, undefined, 1);

		await expect(__DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", subjectId: "user-1", decision: DeferredToolDecisionKinds.Denied, decidedBy: "user-1", now: NOW })).resolves.toEqual({ outcome: "denied" });
		expect(runUpdateMany).not.toHaveBeenCalled();
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
			data: expect.objectContaining({ state: ApprovalRequestState.Expired }),
		}));
	});

	it("expires every due request and resumes only after the batch is empty", async function _expiresDueBatch()
	{
		const due = [
			{ id: "approval-1", runId: "run-1", attempt: 2, toolInvocationRowId: "tool-1" },
			{ id: "approval-2", runId: "run-1", attempt: 2, toolInvocationRowId: "tool-2" },
		];
		const context = _expiryTransaction(due, [1, 0], true);

		await expect(__ExpireDeferredToolApprovalBatch(context.transaction, { runId: "run-1", attempt: 2, now: NOW })).resolves.toEqual({ expiredCount: 2, resumed: true });
		expect(context.approvalUpdateMany).toHaveBeenCalledTimes(2);
		expect(context.invocationUpdateMany).toHaveBeenCalledTimes(2);
		expect(context.runUpdateMany).toHaveBeenCalledTimes(1);
	});

	it("keeps a mixed due and future batch waiting after expiring only the due row", async function _keepsFutureApprovalWaiting()
	{
		const context = _expiryTransaction([{ id: "approval-due", runId: "run-1", attempt: 2, toolInvocationRowId: "tool-due" }], [1], false);

		await expect(__ExpireDeferredToolApprovalBatch(context.transaction, { runId: "run-1", attempt: 2, now: NOW })).resolves.toEqual({ expiredCount: 1, resumed: false });
		expect(context.runUpdateMany).not.toHaveBeenCalled();
	});

	it("fails closed when the owner membership was suspended before decision", async function _suspendedMembership()
	{
		const { transaction, updateMany, membershipFindFirst } = _transaction(_pending(), 1);
		membershipFindFirst.mockResolvedValueOnce(null);

		await expect(__DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", subjectId: "user-1", decision: DeferredToolDecisionKinds.Denied, decidedBy: "user-1", now: NOW })).resolves.toEqual({ outcome: "conflict" });
		expect(updateMany).not.toHaveBeenCalled();
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
const ASSIGNMENT = { agentServiceId: "svc-1", agentRevisionId: "rev-1", siloId: "silo-1", subjectId: "user-1", audience: "opencrane-agent-runtime", serviceAccountName: "agent-runtime-1", namespace: "silo-1-runtime", workloadKind: "Job", workloadUid: "wl-1", podUid: "pod-1", state: WorkloadAssignmentState.Registered, expiresAt: new Date("2026-07-21T10:00:00.000Z") };
const PROOF_KEY = { id: "proof-1", keyThumbprint: "thumb-1", expiresAt: new Date("2026-07-21T09:30:00.000Z"), revokedAt: null };

/** Command opening a pending deferred-tool approval for an awaiting invocation. */
function _deferCommand(): Parameters<typeof __DeferToolRequest>[1]
{
	const schema = { type: "object", properties: { query: { type: "string" } } };
	return { interruptId: "approval-existing", runId: "run-1", attempt: 2, toolInvocationRowId: "tool-1", toolRevisionId: "integration:search:query", reviewedArguments: { query: "original" }, argumentsDigest: __DigestCanonicalJson({ query: "original" }), reviewedParametersSchema: schema, reviewedParametersSchemaDigest: __DigestCanonicalJson(schema), safeProposedArguments: { query: "original" }, responseSchema: { type: "object" }, actionDigest: "invocation-1", effectivePolicyDigest: "sha256:cap", approverPolicyRevision: "integration-tools-require-approval", now: NOW, expiresAt: new Date("2026-07-22T09:00:00.000Z") };
}

describe("defer tool request authority", function _deferSuite()
{
	it("opens a pending approval bound to the awaiting tool invocation and live workload", async function _defers()
	{
		const create = vi.fn().mockResolvedValue({ id: "approval-9" });
		const pause = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = {
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(ASSIGNMENT) },
			runProofKey: { findUnique: vi.fn().mockResolvedValue(PROOF_KEY) },
			agentRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", attempt: 2, state: AgentRunState.Running }), updateMany: pause },
			approvalRequest: { create, findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
			toolInvocation: { findUnique: vi.fn().mockResolvedValue(_invocation()) },
		} as unknown as Prisma.TransactionClient;

		const result = await __DeferToolRequest(transaction, _deferCommand());

		expect(result).toEqual({ outcome: "deferred", approvalRequestId: "approval-9" });
		expect(pause).toHaveBeenCalledWith({ where: { id: "run-1", attempt: 2, state: AgentRunState.Running }, data: { state: AgentRunState.WaitingForApproval } });
		expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: ApprovalRequestState.Pending, toolInvocationRowId: "tool-1", resourceKind: "tool", resourceId: "integration:search:query", proofKeyId: "proof-1", expiresAt: PROOF_KEY.expiresAt }) }));
	});

	it("adds a second pending request without changing an already-waiting run", async function _batches()
	{
		const create = vi.fn().mockResolvedValue({ id: "approval-9" });
		const pause = vi.fn();
		const transaction = {
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(ASSIGNMENT) },
			runProofKey: { findUnique: vi.fn().mockResolvedValue(PROOF_KEY) },
			agentRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", attempt: 2, state: AgentRunState.WaitingForApproval }), updateMany: pause },
			approvalRequest: { create, findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(1) },
			toolInvocation: { findUnique: vi.fn().mockResolvedValue(_invocation()) },
		} as unknown as Prisma.TransactionClient;

		expect(await __DeferToolRequest(transaction, _deferCommand())).toEqual({ outcome: "deferred", approvalRequestId: "approval-9" });
		expect(pause).not.toHaveBeenCalled();
	});

	it("reports unavailable when the live workload or proof key is absent", async function _unavailable()
	{
		const transaction = {
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(ASSIGNMENT) },
			runProofKey: { findUnique: vi.fn().mockResolvedValue(null) },
			approvalRequest: { create: vi.fn(), findFirst: vi.fn() },
		} as unknown as Prisma.TransactionClient;

		expect(await __DeferToolRequest(transaction, _deferCommand())).toEqual({ outcome: "unavailable" });
	});

	it("fails closed when a managed service has no concrete human approver", async function _managedWithoutApprover()
	{
		const create = vi.fn();
		const transaction = {
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue({ ...ASSIGNMENT, subjectId: "agent-service:svc-1" }) },
			runProofKey: { findUnique: vi.fn().mockResolvedValue(PROOF_KEY) },
			approvalRequest: { create },
		} as unknown as Prisma.TransactionClient;

		expect(await __DeferToolRequest(transaction, _deferCommand())).toEqual({ outcome: "unavailable" });
		expect(create).not.toHaveBeenCalled();
	});

	it("replays the existing approval idempotently on a duplicate defer", async function _idempotentDefer()
	{
		const transaction = {
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(ASSIGNMENT) },
			runProofKey: { findUnique: vi.fn().mockResolvedValue(PROOF_KEY) },
			approvalRequest: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue({ id: "approval-existing", argumentsDigest: _deferCommand().argumentsDigest, reviewedToolSchemaDigest: _deferCommand().reviewedParametersSchemaDigest }) },
			toolInvocation: { findUnique: vi.fn().mockResolvedValue(_invocation()) },
		} as unknown as Prisma.TransactionClient;

		expect(await __DeferToolRequest(transaction, _deferCommand())).toEqual({ outcome: "already_deferred", approvalRequestId: "approval-existing" });
	});

	it("does not open when the run cannot enter its waiting state", async function _pauseRace()
	{
		const create = vi.fn();
		const transaction = {
			workloadAssignment: { findUnique: vi.fn().mockResolvedValue(ASSIGNMENT) },
			runProofKey: { findUnique: vi.fn().mockResolvedValue(PROOF_KEY) },
			agentRun: { findUnique: vi.fn().mockResolvedValue({ id: "run-1", attempt: 2, state: AgentRunState.Running }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
			approvalRequest: { create, findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
			toolInvocation: { findUnique: vi.fn().mockResolvedValue(_invocation()) },
		} as unknown as Prisma.TransactionClient;

		expect(await __DeferToolRequest(transaction, _deferCommand())).toEqual({ outcome: "unavailable" });
		expect(create).not.toHaveBeenCalled();
	});
});
