import { ExecutionSubjectMembershipKinds } from "@opencrane/models/agents";
import { AgentRunState, AgentServiceKind, ApprovalRequestState, ElicitationBodyKind, ElicitationPurpose, ExternalActionRecoveryMode, McpCredentialRequirement, McpExecutionTransport, OrgMemberStatus, PrincipalProvenance, Prisma, ToolApprovalDecisionScope, ToolInvocationAuthorizationActorKind, ToolInvocationState } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const _managedGrantMocks = vi.hoisted(function _ManagedGrantMocks()
{
	return { reconcile: vi.fn().mockResolvedValue(0) };
});

vi.mock("../../grants/persistence/prisma-managed-authorization-grant-repository", function _MockManagedRepository()
{
	return { __ReconcileManagedAuthorizationGrantsInTransaction: _managedGrantMocks.reconcile };
});

import { __DecideDeferredToolRequest } from "../deferred-tool-approval-decision";
import { __DeferToolRequest } from "../deferred-tool-approval-opening";
import { __ExpireDeferredToolApprovalBatch } from "../deferred-tool-approval-expiry";
import { _IsApprovalRequestFenceRejection } from "../deferred-tool-approval-fence";
import { __DigestCanonicalJson } from "../../authority/canonical-json-digest";
import { __ProjectDeferredToolApproval } from "../deferred-tool-approval-schema";
import { DeferredToolDecisionKinds } from "../deferred-tool-approval-decision.types";

/** Current immutable execution subject for generation two of the conversation computer. */
const EXECUTION_SUBJECT = {
	schemaVersion: 1, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "principal-1",
	identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "0", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-evidence", verifiedAt: "2026-07-21T08:00:00.000Z" },
	membership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "principal-1", siloId: "silo-1", revision: 3, assertionId: "membership-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-evidence", trustedUntil: "2026-07-21T09:30:00.000Z" },
	capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-evidence", decidedAt: "2026-07-21T08:00:00.000Z" },
	runScope: { siloId: "silo-1", runId: "run-1", attempt: 2, agentServiceId: "svc-1", agentRevisionId: "rev-1" },
	computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-2", leaseGeneration: 2 },
	requester: { membership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "principal-1", siloId: "silo-1", revision: 3, assertionId: "membership-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-evidence", trustedUntil: "2026-07-21T09:30:00.000Z" }, siloId: "silo-1", requesterPrincipalId: "principal-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-07-21T08:00:00.000Z" },
	admission: { authorizingPrincipalId: "principal-1", decisionEvidenceId: "admission-evidence", admittedAt: "2026-07-21T08:00:00.000Z" },
} as const;

/** Build the active-lease delegate the defer path reads once, only for the lease expiry that caps the approval. */
function _ActiveLeaseDelegate(value: unknown)
{
	return { findUnique: vi.fn().mockResolvedValue(value) };
}

/** Build the error Prisma surfaces when the approval_requests trigger rejects a write for a stale computer lease. */
function _LeaseFenceRejection(): Prisma.PrismaClientUnknownRequestError
{
	return new Prisma.PrismaClientUnknownRequestError("Invalid `prisma.approvalRequest.create()` invocation: Error occurred during query execution: ApprovalRequest requires its exact active conversation computer lease", { clientVersion: "test" });
}

/** Build one complete awaiting-approval invocation row. */
function _invocation(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown>
{
	const argumentsValue = { query: "original" };
	return { id: "tool-1", siloId: "silo-1", runId: "run-1", attempt: 2, agentServiceId: "svc-1", agentRevisionId: "rev-1", agentIdentityId: "identity-1", principalId: "principal-1", authorizationActorKind: ToolInvocationAuthorizationActorKind.Workload, authorizationExecutionSubject: EXECUTION_SUBJECT, authorizationCoordinates: [], authorizationDecisionDigests: [`sha256:${"e".repeat(64)}`], authorizationAssignmentDigest: `sha256:${"f".repeat(64)}`, authorizationEvidenceDigest: `sha256:${"0".repeat(64)}`, subjectId: "user-1", runtimeInstanceId: "runtime-1", commandId: "command-1", candidateId: "candidate-1", toolInvocationId: "call-7", toolRevisionId: "integration:search:query", arguments: argumentsValue, argumentsDigest: __DigestCanonicalJson(argumentsValue), effectiveArguments: argumentsValue, effectiveArgumentsDigest: __DigestCanonicalJson(argumentsValue), requestFingerprint: "sha256:fingerprint", requestIdentity: {}, approvalRequired: true, recoveryMode: ExternalActionRecoveryMode.Manual, recoveryKey: null, state: ToolInvocationState.AwaitingApproval, preparationAttempt: 1, retryDeadlineAt: new Date("2026-07-21T09:05:00.000Z"), nextPreparationAttemptAt: new Date("2026-07-21T09:00:00.000Z"), claimAttempt: 0, claimKind: null, claimFence: 0, claimExpiresAt: null, recoveryRequiredAt: null, result: null, failureCode: null, revision: 1, createdAt: NOW, updatedAt: NOW, completedAt: null, ...overrides };
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
	return { transaction: { approvalRequest: { findUnique, updateMany, count: vi.fn().mockResolvedValue(pendingCount) }, elicitationRequest: { count: vi.fn().mockResolvedValue(0), findUnique: vi.fn().mockResolvedValue(_elicitation(row as Record<string, unknown>)) }, toolInvocation: { findUnique: invocationFindUnique, updateMany: invocationUpdateMany }, toolResultDelivery: { create: deliveryCreate }, ..._requesterDelegates(), orgMembership: { findFirst: membershipFindFirst }, agentRun: { findUnique: vi.fn().mockResolvedValue({ ...RUN, state: AgentRunState.WaitingForInput }), updateMany: runUpdateMany } } as unknown as Prisma.TransactionClient, updateMany, invocationUpdateMany, runUpdateMany, membershipFindFirst, deliveryCreate };
}

/** Current requester identity, organisation membership and active conversation participation. */
function _requesterDelegates(managed = false)
{
	const installPrincipalId = managed ? "company-principal" : "principal-1";
	const installPrincipalProvenance = managed ? PrincipalProvenance.Internal : PrincipalProvenance.External;
	const installPrincipalDisplayName = managed ? null : "Personal owner";
	return {
		principal: {
			findUnique: vi.fn().mockResolvedValue({ id: "principal-1", subject: "user-1", provenance: PrincipalProvenance.External }),
			findMany: vi.fn(async function _Principals(query) { return query.where.subject === "user-1" ? [{ id: "principal-1" }] : []; }),
			count: vi.fn().mockResolvedValue(1),
		},
		orgMembership: { findFirst: vi.fn().mockResolvedValue({ id: "membership-1" }) },
		conversationParticipant: { findUnique: vi.fn().mockResolvedValue({ accessEndedPosition: null }) },
		agentRevisionMcpToolAssignment: { findUnique: vi.fn().mockResolvedValue(_toolAssignment()) },
		mcpServerInstall: { findUnique: vi.fn().mockResolvedValue({ id: "install-1", mcpServerId: "server-1", principalId: installPrincipalId, principal: { siloId: "silo-1", provenance: installPrincipalProvenance, displayName: installPrincipalDisplayName } }) },
		agentService: { findUnique: vi.fn().mockResolvedValue(managed ? { kind: AgentServiceKind.Managed, name: "Company assistant", principalId: "company-principal", principal: { provenance: PrincipalProvenance.Internal }, revisions: [{ id: "rev-1" }] } : null) },
		toolApprovalScope: { findMany: vi.fn().mockResolvedValue([]) },
	};
}

/** Exact assigned OCI tool used by approval-opening tests unless a test replaces it. */
function _toolAssignment(overrides: Readonly<Record<string, unknown>> = {})
{
	return {
		agentServiceId: "svc-1",
		siloId: "silo-1",
		toolRevision: { siloId: "silo-1", serverRevision: { siloId: "silo-1", mcpServerId: "server-1", transport: McpExecutionTransport.OciImage, connectionId: null, connectionGeneration: null, connectionOwnerPrincipalId: null, endpointDigest: null, server: { credentialRequirement: McpCredentialRequirement.Credentialless }, connection: null, ...overrides } },
	};
}

/** Frozen participant-facing approval body with a valid execution-owner disclosure. */
function _approvalBody(managed = false)
{
	const ownerKind = managed ? "company_assistant" : "personal";
	const ownerLabel = managed ? "Company assistant" : "Personal owner";
	return {
		kind: "approval",
		prompt: "Allow this agent to invoke the reviewed tool?",
		action: "Invoke tool",
		target: "records.search",
		dataUse: "The proposed arguments shown in this request will be sent to the tool.",
		externalSystem: "Records",
		consequence: "This invokes the external tool once. Its saved description says: Search the saved records",
		proposedArguments: { query: "original" },
		executionConnection: { ownerKind, ownerLabel, credentialRequirement: "credentialless" },
		offeredScopes: ["once", "always"],
		standingScope: { explanation: "Approve always applies only to this exact assistant revision, connection owner and generation, tool revision, action, and final reviewed arguments. Any changed detail requires a fresh approval. You can revoke it later." },
	};
}

/** Immutable participant request paired with the given protected approval. */
function _elicitation(approval: Record<string, unknown>)
{
	const purposePayload = { approvalRequestId: approval.id as string };
	const body = _approvalBody(approval.principalId === "company-principal");
	return { id: approval.elicitationRequestId, siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 2, assignedParticipantId: "user-1", requestKey: approval.actionDigest, purpose: ElicitationPurpose.ToolApproval, bodyKind: ElicitationBodyKind.Approval, requiresStepUp: true, expiresAt: approval.expiresAt, purposePayload, purposePayloadDigest: __DigestCanonicalJson(purposePayload), body, bodyDigest: __DigestCanonicalJson(body) };
}

/** A pending deferred-tool approval bound to a tool invocation row. */
function _pending(): unknown
{
	const schema = { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string" } } };
	const projection = __ProjectDeferredToolApproval(schema, { query: "original" });
	return { id: "approval-1", elicitationRequestId: "approval-1", actionDigest: "invocation-1", runId: "run-1", attempt: 2, siloId: "silo-1", principalId: "principal-1", toolInvocationRowId: "tool-1", resourceId: "integration:search:query", argumentsDigest: __DigestCanonicalJson({ query: "original" }), reviewedToolArguments: { query: "original" }, reviewedToolSchema: schema, reviewedToolSchemaDigest: __DigestCanonicalJson(schema), safeProposedArguments: projection.proposedArguments, responseSchema: projection.responseSchema, state: ApprovalRequestState.Pending, expiresAt: new Date("2026-07-22T09:00:00.000Z") };
}

const NOW = new Date("2026-07-21T09:00:00.000Z");

/** Build a transaction for one command-poll expiry sweep over already-selected due rows. */
function _expiryTransaction(due: readonly { id: string; siloId: string; runId: string; attempt: number; toolInvocationRowId: string; elicitationRequestId: string | null }[], pendingCounts: readonly number[], resumed: boolean, pendingElicitations = 0): { readonly transaction: Prisma.TransactionClient; readonly approvalUpdateMany: ReturnType<typeof vi.fn>; readonly invocationUpdateMany: ReturnType<typeof vi.fn>; readonly runUpdateMany: ReturnType<typeof vi.fn> }
{
	const approvalUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
	const invocationUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
	const runUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
	const runFindUnique = vi.fn()
		.mockResolvedValueOnce({ id: "run-1", attempt: 2, state: AgentRunState.WaitingForInput })
		.mockResolvedValue({ id: "run-1", attempt: 2, state: resumed ? AgentRunState.Running : AgentRunState.WaitingForInput });
	const invocationFindUnique = vi.fn(async function _findInvocation(argumentsValue)
	{
		return _invocation({ id: argumentsValue.where.id, toolInvocationId: `call-${argumentsValue.where.id}` });
	});
	return {
		transaction: {
			agentRun: { findUnique: runFindUnique, updateMany: runUpdateMany },
			approvalRequest: { findMany: vi.fn().mockResolvedValue(due), updateMany: approvalUpdateMany, count: vi.fn().mockResolvedValueOnce(pendingCounts[0] ?? 0).mockResolvedValueOnce(pendingCounts[1] ?? pendingCounts[0] ?? 0) },
			elicitationRequest: { count: vi.fn().mockResolvedValue(pendingElicitations) },
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
	beforeEach(function _ResetManagedGrants() { _managedGrantMocks.reconcile.mockClear(); });

	it("approves and records the complete validated replacement arguments", async function _approve()
	{
		const { transaction, updateMany, invocationUpdateMany } = _transaction(_pending(), 1);
		const result = await __DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: { query: "edited" }, decidedBy: "user-1", now: NOW });
		expect(result).toEqual({ outcome: "approved", argumentsDigest: __DigestCanonicalJson({ query: "edited" }) });
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "approval-1", state: ApprovalRequestState.Pending, expiresAt: { gt: NOW } }), data: expect.objectContaining({ state: ApprovalRequestState.Approved, finalArguments: { query: "edited" }, finalArgumentsDigest: __DigestCanonicalJson({ query: "edited" }) }) }));
		expect(invocationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: ToolInvocationState.Ready, effectiveArguments: { query: "edited" }, effectiveArgumentsDigest: __DigestCanonicalJson({ query: "edited" }) }) }));
		expect(_managedGrantMocks.reconcile).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ siloId: "silo-1", managerId: "deferred-tool-approval-assignee", resource: { kind: "approval-request", id: "approval-1" }, grants: [] }));
	});

	it.each([
		["approval", { decision: DeferredToolDecisionKinds.Approved, arguments: { query: "edited" } }],
		["denial", { decision: DeferredToolDecisionKinds.Denied }],
	])("lets the lease trigger fence a %s once and propagates its rejection without reading the lease table", async function _LeaseFencedByTrigger(_label, choice)
	{
		const { transaction, updateMany, invocationUpdateMany } = _transaction(_pending(), 1);
		updateMany.mockRejectedValueOnce(_LeaseFenceRejection());

		await expect(__DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", ...choice, decidedBy: "user-1", now: NOW })).rejects.toSatisfy(_IsApprovalRequestFenceRejection);
		expect(updateMany).toHaveBeenCalledTimes(1);
		expect(invocationUpdateMany).not.toHaveBeenCalled();
		expect("conversationComputerActiveLease" in transaction).toBe(false);
	});

	it("conflicts when the awaiting tool invocation is missing or belongs to another attempt", async function _brokenInvocationLink()
	{
		for (const invocationRow of [null, { id: "tool-1", runId: "run-other", attempt: 2, toolInvocationId: "call-7" }, { id: "tool-1", runId: "run-1", attempt: 9, toolInvocationId: "call-7" }])
		{
			const { transaction, updateMany } = _transaction(_pending(), 1, invocationRow);
			const result = await __DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: { query: "edited" }, decidedBy: "user-1", now: NOW });
			expect(result).toEqual({ outcome: "conflict" });
			expect(updateMany).not.toHaveBeenCalled();
		}
	});

	it("denies by closing the pending request with one exact failure delivery", async function _deny()
	{
		const { transaction, updateMany, invocationUpdateMany, deliveryCreate } = _transaction(_pending(), 1);
		const result = await __DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", decision: DeferredToolDecisionKinds.Denied, decidedBy: "user-1", now: NOW });
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

		await expect(__DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: reviewedArguments, decidedBy: "user-1", now: NOW })).resolves.toEqual({ outcome: "invalid_arguments" });
		expect(updateMany).not.toHaveBeenCalled();
		expect(invocationUpdateMany).not.toHaveBeenCalled();
		const denied = _transaction(approval, 1, invocation);
		await expect(__DecideDeferredToolRequest(denied.transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", decision: DeferredToolDecisionKinds.Denied, decidedBy: "user-1", now: NOW })).resolves.toEqual({ outcome: "denied" });
		expect(denied.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: ApprovalRequestState.Denied }) }));
	});

	it("rejects a handcrafted approval whose persisted response policy differs from its frozen schema", async function _forgedResponsePolicy()
	{
		const approval = { ..._pending() as object, responseSchema: { type: "object", properties: { decision: { const: "approved" } } } };
		const { transaction, updateMany } = _transaction(approval, 1);

		await expect(__DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: { query: "edited" }, decidedBy: "user-1", now: NOW })).resolves.toEqual({ outcome: "conflict" });
		expect(updateMany).not.toHaveBeenCalled();
	});

	it("keeps the run waiting while another request remains pending", async function _keepsBatchWaiting()
	{
		const { transaction, runUpdateMany } = _transaction(_pending(), 1, undefined, 1);

		await expect(__DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", decision: DeferredToolDecisionKinds.Denied, decidedBy: "user-1", now: NOW })).resolves.toEqual({ outcome: "denied" });
		expect(runUpdateMany).not.toHaveBeenCalled();
	});

	it("replays an identical decision idempotently", async function _idempotent()
	{
		const finalArguments = { query: "edited" };
		const { transaction, updateMany } = _transaction({ ..._pending() as object, state: ApprovalRequestState.Approved, decisionScope: ToolApprovalDecisionScope.Once, finalArgumentsDigest: __DigestCanonicalJson(finalArguments) }, 0);
		const result = await __DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: finalArguments, decidedBy: "user-1", now: NOW });
		expect(result).toEqual({ outcome: "already_decided", decision: DeferredToolDecisionKinds.Approved, argumentsDigest: __DigestCanonicalJson(finalArguments) });
		expect(updateMany).not.toHaveBeenCalled();
	});

	it("conflicts when re-decided the other way", async function _conflict()
	{
		const { transaction } = _transaction({ ..._pending() as object, state: ApprovalRequestState.Approved, decisionScope: ToolApprovalDecisionScope.Once }, 0);
		const result = await __DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", decision: DeferredToolDecisionKinds.Denied, decidedBy: "user-1", now: NOW });
		expect(result).toEqual({ outcome: "conflict" });
	});

	it("conflicts on a row that is not a deferred-tool approval", async function _notTool()
	{
		const { transaction } = _transaction({ ..._pending() as object, toolInvocationRowId: null }, 0);
		const result = await __DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: { query: "edited" }, decidedBy: "user-1", now: NOW });
		expect(result).toEqual({ outcome: "conflict" });
	});

	it("expires a pending approval before it can be decided", async function _expires()
	{
		const { transaction, updateMany } = _transaction({ ..._pending() as object, expiresAt: new Date("2026-07-20T09:00:00.000Z") }, 1);
		const result = await __DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: { query: "edited" }, decidedBy: "user-1", now: NOW });
		expect(result).toEqual({ outcome: "expired" });
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
			where: expect.objectContaining({ state: ApprovalRequestState.Pending, expiresAt: { lte: NOW } }),
			data: expect.objectContaining({ state: ApprovalRequestState.Expired }),
		}));
	});

	it("expires every due request and resumes only after the batch is empty", async function _expiresDueBatch()
	{
		const due = [
			{ id: "approval-1", siloId: "silo-1", runId: "run-1", attempt: 2, toolInvocationRowId: "tool-1", elicitationRequestId: null },
			{ id: "approval-2", siloId: "silo-1", runId: "run-1", attempt: 2, toolInvocationRowId: "tool-2", elicitationRequestId: null },
		];
		const context = _expiryTransaction(due, [1, 0], true);

		await expect(__ExpireDeferredToolApprovalBatch(context.transaction, { runId: "run-1", attempt: 2, now: NOW })).resolves.toEqual({ expiredCount: 2, resumed: true });
		expect(context.approvalUpdateMany).toHaveBeenCalledTimes(2);
		expect(context.invocationUpdateMany).toHaveBeenCalledTimes(2);
		expect(context.runUpdateMany).toHaveBeenCalledTimes(1);
	});

	it("keeps a mixed due and future batch waiting after expiring only the due row", async function _keepsFutureApprovalWaiting()
	{
		const context = _expiryTransaction([{ id: "approval-due", siloId: "silo-1", runId: "run-1", attempt: 2, toolInvocationRowId: "tool-due", elicitationRequestId: null }], [1], false);

		await expect(__ExpireDeferredToolApprovalBatch(context.transaction, { runId: "run-1", attempt: 2, now: NOW })).resolves.toEqual({ expiredCount: 1, resumed: false });
		expect(context.runUpdateMany).not.toHaveBeenCalled();
	});

	it("keeps a tool expiry paused while a generic request remains pending", async function _KeepsPendingGenericRequest()
	{
		const context = _expiryTransaction([{ id: "approval-due", siloId: "silo-1", runId: "run-1", attempt: 2, toolInvocationRowId: "tool-due", elicitationRequestId: null }], [0], false, 1);

		await expect(__ExpireDeferredToolApprovalBatch(context.transaction, { runId: "run-1", attempt: 2, now: NOW })).resolves.toEqual({ expiredCount: 1, resumed: false });
		expect(context.runUpdateMany).not.toHaveBeenCalled();
	});

	it("fails closed when the owner membership was suspended before decision", async function _suspendedMembership()
	{
		const { transaction, updateMany, membershipFindFirst } = _transaction(_pending(), 1);
		membershipFindFirst.mockResolvedValueOnce(null);

		await expect(__DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", decision: DeferredToolDecisionKinds.Denied, decidedBy: "user-1", now: NOW })).resolves.toEqual({ outcome: "conflict" });
		expect(updateMany).not.toHaveBeenCalled();
	});

	it("does not let a different subject decide an otherwise valid approval", async function _wrongOwner()
	{
		const { transaction, updateMany } = _transaction(_pending(), 1);
		const result = await __DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-2", decision: DeferredToolDecisionKinds.Approved, arguments: { query: "edited" }, decidedBy: "user-2", now: NOW });
		expect(result).toEqual({ outcome: "conflict" });
		expect(updateMany).not.toHaveBeenCalled();
	});

	it("propagates a stale approval trigger so the transaction owner can roll back", async function _staleAuthority()
	{
		const { transaction, updateMany } = _transaction(_pending(), 1);
		updateMany.mockRejectedValueOnce(new Error("ApprovalRequest decision authority is no longer current"));

		await expect(__DecideDeferredToolRequest(transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: { query: "edited" }, decidedBy: "user-1", now: NOW })).rejects.toThrow("ApprovalRequest decision authority is no longer current");
	});
});

/** Current run whose immutable subject names the active conversation-computer lease. */
const RUN = { id: "run-1", siloId: "silo-1", conversationId: "conversation-1", attempt: 2, state: AgentRunState.Running, agentServiceId: "svc-1", agentRevisionId: "rev-1", agentIdentityId: "identity-1", principalId: "principal-1", executionSubject: EXECUTION_SUBJECT };
/** Rebuildable active-lease transaction fence matching the immutable subject. */
const ACTIVE_LEASE = { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", agentIdentityId: "identity-1", leaseId: "lease-2", leaseGeneration: 2, expiresAt: new Date("2026-07-21T09:20:00.000Z") };

/** Command opening a pending deferred-tool approval for an awaiting invocation. */
function _deferCommand(): Parameters<typeof __DeferToolRequest>[1]
{
	const schema = { type: "object", properties: { query: { type: "string" } } };
	return { interruptId: "approval-existing", runId: "run-1", attempt: 2, toolInvocationRowId: "tool-1", toolRevisionId: "integration:search:query", toolName: "records.search", toolDescription: "Search the saved records", externalSystemName: "Records", reviewedArguments: { query: "original" }, argumentsDigest: __DigestCanonicalJson({ query: "original" }), reviewedParametersSchema: schema, reviewedParametersSchemaDigest: __DigestCanonicalJson(schema), safeProposedArguments: { query: "original" }, responseSchema: { type: "object" }, actionDigest: "invocation-1", effectivePolicyDigest: "sha256:cap", approverPolicyRevision: "integration-tools-require-approval", now: NOW, expiresAt: new Date("2026-07-22T09:00:00.000Z") };
}

/** Approval already saved by an identical opening command. */
function _existingApproval()
{
	return { ..._pending() as Record<string, unknown>, id: "approval-existing", elicitationRequestId: "approval-existing", actionDigest: _deferCommand().actionDigest, reviewedToolSchemaDigest: _deferCommand().reviewedParametersSchemaDigest, expiresAt: ACTIVE_LEASE.expiresAt };
}

/** A company assistant executes as its own principal while the human remains the requester. */
function _managedSubject()
{
	return { ...EXECUTION_SUBJECT, principalId: "company-principal", identity: { ...EXECUTION_SUBJECT.identity, principalId: "company-principal" }, membership: { kind: ExecutionSubjectMembershipKinds.Managed, principalId: "company-principal", siloId: "silo-1", agentServiceId: "svc-1", agentRevisionId: "rev-1", agentRevisionDigest: `sha256:${"9".repeat(64)}`, decisionEvidenceId: "managed-evidence", trustedUntil: EXECUTION_SUBJECT.membership.trustedUntil } };
}

/** Transaction for deciding a managed approval with the original human requester. */
function _managedDecision(overrides: Readonly<Record<string, unknown>> = {})
{
	const subject = _managedSubject();
	const context = _transaction({ ..._pending() as object, principalId: subject.principalId, ...overrides }, 1, _invocation({ principalId: subject.principalId, authorizationExecutionSubject: subject }));
	vi.mocked(context.transaction.agentRun.findUnique).mockResolvedValue({ ...RUN, state: AgentRunState.WaitingForInput, principalId: subject.principalId, executionSubject: subject } as never);
	return context;
}

/** Transaction for opening a company approval without dispatching any external call. */
function _managedOpening(existing = false)
{
	const subject = _managedSubject();
	const approval = { ..._existingApproval(), principalId: subject.principalId };
	return {
		agentRun: { findUnique: vi.fn().mockResolvedValue({ ...RUN, principalId: subject.principalId, executionSubject: subject }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		conversationComputerActiveLease: _ActiveLeaseDelegate(ACTIVE_LEASE),
		elicitationRequest: { create: vi.fn().mockResolvedValue({ id: "approval-existing" }), findUnique: vi.fn().mockResolvedValue(_elicitation(approval)) },
		approvalRequest: { create: vi.fn().mockResolvedValue({ id: "approval-existing" }), findFirst: vi.fn().mockResolvedValue(existing ? approval : null), count: vi.fn().mockResolvedValue(0) },
		toolInvocation: { findUnique: vi.fn().mockResolvedValue(_invocation({ principalId: subject.principalId, authorizationExecutionSubject: subject })) },
		..._requesterDelegates(true),
	};
}

/** Transaction for opening a personal approval against the selected installation evidence. */
function _personalOpening()
{
	return {
		agentRun: { findUnique: vi.fn().mockResolvedValue(RUN), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		conversationComputerActiveLease: _ActiveLeaseDelegate(ACTIVE_LEASE),
		elicitationRequest: { create: vi.fn().mockResolvedValue({ id: "approval-existing" }), findUnique: vi.fn() },
		approvalRequest: { create: vi.fn().mockResolvedValue({ id: "approval-existing" }), findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
		toolInvocation: { findUnique: vi.fn().mockResolvedValue(_invocation()) },
		..._requesterDelegates(),
	};
}

/** Exact remote revision and connection selected by the run assignment. */
function _remoteToolAssignment(credentialRequirement: McpCredentialRequirement, managed = false, overrides: Readonly<Record<string, unknown>> = {})
{
	const ownerPrincipalId = managed ? "company-principal" : "principal-1";
	const connection = { id: "connection-1", siloId: "silo-1", mcpServerInstallId: "install-1", mcpServerId: "server-1", ownerPrincipalId, agentServiceId: managed ? "svc-1" : null, generation: 4, endpointDigest: "sha256:endpoint", credentialRequirement, ...overrides };
	return _toolAssignment({ transport: McpExecutionTransport.RemoteHttp, connectionId: "connection-1", connectionGeneration: 4, connectionOwnerPrincipalId: ownerPrincipalId, endpointDigest: "sha256:endpoint", server: { credentialRequirement: McpCredentialRequirement.SharedCredential }, connection });
}

describe("requester-only company tool approvals", function _RequesterOnly()
{
	beforeEach(function _ResetManagedGrants() { _managedGrantMocks.reconcile.mockClear(); });

	it("keeps company execution ownership and assigns only the original human", async function _OpenForRequester()
	{
		const transaction = _managedOpening();
		await expect(__DeferToolRequest(transaction as never, _deferCommand())).resolves.toEqual({ outcome: "deferred", approvalRequestId: "approval-existing" });
		expect(transaction.approvalRequest.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ principalId: "company-principal" }) }));
		expect(transaction.elicitationRequest.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ assignedParticipantId: "user-1" }) }));
		expect(transaction.elicitationRequest.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ body: expect.objectContaining({ executionConnection: { ownerKind: "company_assistant", ownerLabel: "Company assistant", credentialRequirement: "credentialless" } }) }) }));
		expect(transaction.principal.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id_siloId: { id: "principal-1", siloId: "silo-1" } } }));
		const grants = _managedGrantMocks.reconcile.mock.calls[0]?.[1].grants;
		expect(grants).toHaveLength(2);
		expect(grants.every(function _Human(grant: any): boolean { return grant.subject.principalId === "principal-1" && grant.resource.id === "approval-existing"; })).toBe(true);
	});

	it.each([DeferredToolDecisionKinds.Approved, DeferredToolDecisionKinds.Denied])("accepts the requester's %s and revokes temporary grants", async function _Decide(decision)
	{
		const context = _managedDecision();
		const argumentsValue = decision === DeferredToolDecisionKinds.Approved ? { query: "edited" } : undefined;
		await expect(__DecideDeferredToolRequest(context.transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", decision, arguments: argumentsValue, decidedBy: "user-1", now: NOW })).resolves.toMatchObject({ outcome: decision });
		expect(_managedGrantMocks.reconcile).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ grants: [] }));
	});

	it.each(["company-service", "unrelated-admin", "other-participant", "connection-owner"])("refuses %s even if they have a principal", async function _WrongRequester(reviewerSubjectId)
	{
		const context = _managedDecision();
		vi.mocked(context.transaction.principal.findMany).mockResolvedValue([{ id: reviewerSubjectId }] as never);
		await expect(__DecideDeferredToolRequest(context.transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId, decision: DeferredToolDecisionKinds.Denied, decidedBy: reviewerSubjectId, now: NOW })).resolves.toEqual({ outcome: "conflict" });
		expect(context.updateMany).not.toHaveBeenCalled();
	});

	it.each(["no membership", "ended participation", "ambiguous subject", "missing requester", "service identity"])("does not open an approval with %s", async function _OpeningIneligible(reason)
	{
		const transaction = _managedOpening();
		if (reason === "no membership")
			transaction.orgMembership.findFirst.mockResolvedValue(null);
		if (reason === "ended participation")
			transaction.conversationParticipant.findUnique.mockResolvedValue({ accessEndedPosition: 4n });
		if (reason === "ambiguous subject")
			transaction.principal.count.mockResolvedValue(2);
		if (reason === "missing requester")
			transaction.principal.findUnique.mockResolvedValue(null);
		if (reason === "service identity")
			transaction.principal.findUnique.mockResolvedValue({ id: "principal-1", subject: "user-1", provenance: PrincipalProvenance.Internal });
		await expect(__DeferToolRequest(transaction as never, _deferCommand())).resolves.toEqual({ outcome: "unavailable" });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
		expect(transaction.approvalRequest.create).not.toHaveBeenCalled();
	});

	it.each(["no membership", "ended participation", "ambiguous subject", "stale requester", "different elicitation", "different execution owner", "unlinked approval"])("refuses denial with %s", async function _DecisionIneligible(reason)
	{
		const context = _managedDecision();
		if (reason === "no membership")
			context.membershipFindFirst.mockResolvedValue(null);
		if (reason === "ended participation")
			vi.mocked(context.transaction.conversationParticipant.findUnique).mockResolvedValue({ accessEndedPosition: 4n } as never);
		if (reason === "ambiguous subject")
			vi.mocked(context.transaction.principal.findMany).mockResolvedValue([{ id: "principal-1" }, { id: "duplicate" }] as never);
		if (reason === "stale requester")
			vi.mocked(context.transaction.toolInvocation.findUnique).mockResolvedValue(_invocation() as never);
		if (reason === "different elicitation")
			vi.mocked(context.transaction.elicitationRequest.findUnique).mockResolvedValue({ ..._elicitation(_pending() as Record<string, unknown>), assignedParticipantId: "other-participant" } as never);
		if (reason === "different execution owner")
			vi.mocked(context.transaction.approvalRequest.findUnique).mockResolvedValue(_pending() as never);
		if (reason === "unlinked approval")
			vi.mocked(context.transaction.approvalRequest.findUnique).mockResolvedValue({ ..._pending() as object, principalId: "company-principal", elicitationRequestId: null } as never);
		await expect(__DecideDeferredToolRequest(context.transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", decision: DeferredToolDecisionKinds.Denied, decidedBy: "user-1", now: NOW })).resolves.toEqual({ outcome: "conflict" });
		expect(context.updateMany).not.toHaveBeenCalled();
	});

	it("replays the same company approval without replacing its request or execution owner", async function _OpeningReplay()
	{
		const transaction = _managedOpening(true);
		transaction.mcpServerInstall.findUnique.mockResolvedValue({ id: "install-1", mcpServerId: "server-1", principalId: "company-principal", principal: { siloId: "silo-1", provenance: PrincipalProvenance.Internal, displayName: "Renamed profile" } });
		await expect(__DeferToolRequest(transaction as never, _deferCommand())).resolves.toEqual({ outcome: "already_deferred", approvalRequestId: "approval-existing" });
		expect(transaction.elicitationRequest.create).not.toHaveBeenCalled();
		expect(transaction.approvalRequest.create).not.toHaveBeenCalled();
		expect(transaction.mcpServerInstall.findUnique).not.toHaveBeenCalled();
	});

	it("refuses replay when the saved connection-owner disclosure is malformed", async function _MalformedOpeningReplay()
	{
		const transaction = _managedOpening(true);
		const body = { ..._approvalBody(true), executionConnection: { ownerKind: "company_assistant", ownerLabel: "Hidden\u202Eowner", credentialRequirement: "credentialless" } };
		transaction.elicitationRequest.findUnique.mockResolvedValue({ ..._elicitation(_existingApproval()), body, bodyDigest: __DigestCanonicalJson(body) });

		await expect(__DeferToolRequest(transaction as never, _deferCommand())).rejects.toThrow("deferred approval action digest collision");
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
		expect(transaction.mcpServerInstall.findUnique).not.toHaveBeenCalled();
	});

	it("refuses a decision when the saved connection disclosure digest no longer matches", async function _MalformedDecisionDisclosure()
	{
		const context = _managedDecision();
		vi.mocked(context.transaction.elicitationRequest.findUnique).mockResolvedValue({ ..._elicitation({ ..._pending() as object, principalId: "company-principal" } as Record<string, unknown>), bodyDigest: "sha256:changed" } as never);

		await expect(__DecideDeferredToolRequest(context.transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", decision: DeferredToolDecisionKinds.Denied, decidedBy: "user-1", now: NOW })).resolves.toEqual({ outcome: "conflict" });
		expect(context.updateMany).not.toHaveBeenCalled();
	});

	it("replays a saved company decision only for the original requester", async function _DecisionReplay()
	{
		const argumentsValue = { query: "edited" };
		const context = _managedDecision({ state: ApprovalRequestState.Approved, decisionScope: ToolApprovalDecisionScope.Once, finalArgumentsDigest: __DigestCanonicalJson(argumentsValue) });
		const command = { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", decision: DeferredToolDecisionKinds.Approved, arguments: argumentsValue, decidedBy: "user-1", now: NOW };
		await expect(__DecideDeferredToolRequest(context.transaction, command)).resolves.toMatchObject({ outcome: "already_decided" });
		await expect(__DecideDeferredToolRequest(context.transaction, { ...command, reviewerSubjectId: "unrelated-admin", decidedBy: "unrelated-admin" })).resolves.toEqual({ outcome: "conflict" });
		expect(context.updateMany).not.toHaveBeenCalled();
		expect(_managedGrantMocks.reconcile).not.toHaveBeenCalled();
	});

	it.each([
		{ siloId: "other-silo" }, { conversationId: "other-conversation" }, { runId: "other-run" }, { attempt: 8 },
		{ requestKey: "other-action" }, { purpose: ElicitationPurpose.RuntimeInput }, { bodyKind: ElicitationBodyKind.FreeText },
		{ purposePayload: { approvalRequestId: "other-approval" } }, { purposePayloadDigest: "sha256:changed" },
		{ requiresStepUp: false }, { expiresAt: new Date("2026-07-23T09:00:00.000Z") },
	])("refuses a changed immutable elicitation binding %j", async function _ChangedBinding(patch)
	{
		const context = _managedDecision();
		vi.mocked(context.transaction.elicitationRequest.findUnique).mockResolvedValue({ ..._elicitation(_pending() as Record<string, unknown>), ...patch } as never);
		await expect(__DecideDeferredToolRequest(context.transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", decision: DeferredToolDecisionKinds.Denied, decidedBy: "user-1", now: NOW })).resolves.toEqual({ outcome: "conflict" });
		expect(context.updateMany).not.toHaveBeenCalled();
	});

	it("refuses opening replay after the linked assignee changes", async function _OpeningReplayChanged()
	{
		const transaction = _managedOpening(true);
		transaction.elicitationRequest.findUnique.mockResolvedValue({ ..._elicitation(_existingApproval()), assignedParticipantId: "other-participant" });
		await expect(__DeferToolRequest(transaction as never, _deferCommand())).rejects.toThrow("deferred approval action digest collision");
		expect(_managedGrantMocks.reconcile).not.toHaveBeenCalled();
	});

	it("rechecks requester membership before expiring after a lost decision race", async function _RaceExpiry()
	{
		const context = _managedDecision();
		context.updateMany.mockResolvedValue({ count: 0 });
		context.membershipFindFirst.mockResolvedValueOnce({ id: "membership-1" }).mockResolvedValue(null);
		await expect(__DecideDeferredToolRequest(context.transaction, { approvalRequestId: "approval-1", siloId: "silo-1", reviewerSubjectId: "user-1", decision: DeferredToolDecisionKinds.Denied, decidedBy: "user-1", now: NOW })).resolves.toEqual({ outcome: "conflict" });
		expect(context.updateMany).toHaveBeenCalledTimes(1);
		expect(context.invocationUpdateMany).not.toHaveBeenCalled();
	});
});

describe("defer tool request authority", function _deferSuite()
{
	beforeEach(function _ResetManagedGrants() { _managedGrantMocks.reconcile.mockClear(); });

	it("opens a pending approval bound to the awaiting tool invocation and live workload", async function _defers()
	{
		const create = vi.fn().mockResolvedValue({ id: "approval-9" });
		const pause = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = {
			agentRun: { findUnique: vi.fn().mockResolvedValue(RUN), updateMany: pause },
			conversationComputerActiveLease: _ActiveLeaseDelegate(ACTIVE_LEASE),
			elicitationRequest: { create: vi.fn().mockResolvedValue({ id: "approval-existing" }) },
			approvalRequest: { create, findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
			..._requesterDelegates(),
			toolInvocation: { findUnique: vi.fn().mockResolvedValue(_invocation()) },
		} as unknown as Prisma.TransactionClient;

		const result = await __DeferToolRequest(transaction, _deferCommand());

		expect(result).toEqual({ outcome: "deferred", approvalRequestId: "approval-9" });
		expect(pause).toHaveBeenCalledWith({ where: { id: "run-1", attempt: 2, state: AgentRunState.Running }, data: { state: AgentRunState.WaitingForInput } });
		expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: ApprovalRequestState.Pending, toolInvocationRowId: "tool-1", resourceKind: "tool", resourceId: "integration:search:query", expiresAt: ACTIVE_LEASE.expiresAt }) }));
		const elicitationCreate = transaction.elicitationRequest.create as unknown as ReturnType<typeof vi.fn>;
		const expectedBody = _approvalBody();
		expect(elicitationCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ body: expectedBody, bodyDigest: __DigestCanonicalJson(expectedBody) }) });
		expect(transaction.conversationComputerActiveLease.findUnique).toHaveBeenCalledTimes(1);
		expect(transaction.conversationComputerActiveLease.findUnique).toHaveBeenCalledWith({ where: { computerId: "computer-1" }, select: { expiresAt: true } });
		expect(_managedGrantMocks.reconcile).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ siloId: "silo-1", managerId: "deferred-tool-approval-assignee", resource: { kind: "approval-request", id: "approval-9" }, grants: [expect.objectContaining({ capability: expect.objectContaining({ capabilityId: "approval-request:read" }), createdByPrincipalId: "principal-1" }), expect.objectContaining({ capability: expect.objectContaining({ capabilityId: "approval-request:decide" }), createdByPrincipalId: "principal-1" })] }));
	});

	it.each([
		[McpCredentialRequirement.Credentialless, "credentialless"],
		[McpCredentialRequirement.PrincipalCredential, "principal-credential"],
		[McpCredentialRequirement.SharedCredential, "shared-credential"],
	])("freezes a personal remote connection with %s custody from the immutable connection", async function _RemoteCredential(credentialRequirement, expected)
	{
		const transaction = _personalOpening();
		transaction.agentRevisionMcpToolAssignment.findUnique.mockResolvedValue(_remoteToolAssignment(credentialRequirement));

		await expect(__DeferToolRequest(transaction as never, _deferCommand())).resolves.toMatchObject({ outcome: "deferred" });
		expect(transaction.mcpServerInstall.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { mcpServerId_principalId: { mcpServerId: "server-1", principalId: "principal-1" } } }));
		expect(transaction.elicitationRequest.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ body: expect.objectContaining({ executionConnection: { ownerKind: "personal", ownerLabel: "Personal owner", credentialRequirement: expected } }) }) }));
	});

	it("freezes a managed remote connection owned by the assistant rather than its requester", async function _ManagedRemoteOwner()
	{
		const transaction = _managedOpening();
		transaction.agentRevisionMcpToolAssignment.findUnique.mockResolvedValue(_remoteToolAssignment(McpCredentialRequirement.PrincipalCredential, true));

		await expect(__DeferToolRequest(transaction as never, _deferCommand())).resolves.toMatchObject({ outcome: "deferred" });
		expect(transaction.mcpServerInstall.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { mcpServerId_principalId: { mcpServerId: "server-1", principalId: "company-principal" } } }));
		expect(transaction.elicitationRequest.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ assignedParticipantId: "user-1", body: expect.objectContaining({ executionConnection: { ownerKind: "company_assistant", ownerLabel: "Company assistant", credentialRequirement: "principal-credential" } }) }) }));
	});

	it.each([
		["missing assignment", function _MissingAssignment(transaction: ReturnType<typeof _personalOpening>) { transaction.agentRevisionMcpToolAssignment.findUnique.mockResolvedValue(null); }],
		["assignment in another silo", function _WrongAssignmentSilo(transaction: ReturnType<typeof _personalOpening>) { transaction.agentRevisionMcpToolAssignment.findUnique.mockResolvedValue({ ..._toolAssignment(), siloId: "other-silo" }); }],
		["install owned by another principal", function _WrongInstallOwner(transaction: ReturnType<typeof _personalOpening>) { transaction.mcpServerInstall.findUnique.mockResolvedValue({ id: "install-1", mcpServerId: "server-1", principalId: "requester-decoy", principal: { siloId: "silo-1", provenance: PrincipalProvenance.External, displayName: "Requester decoy" } }); }],
		["unsafe owner label", function _UnsafeOwnerLabel(transaction: ReturnType<typeof _personalOpening>) { transaction.mcpServerInstall.findUnique.mockResolvedValue({ id: "install-1", mcpServerId: "server-1", principalId: "principal-1", principal: { siloId: "silo-1", provenance: PrincipalProvenance.External, displayName: "Hidden\u202Eowner" } }); }],
		["credential-requiring OCI server", function _CredentialedOci(transaction: ReturnType<typeof _personalOpening>) { transaction.agentRevisionMcpToolAssignment.findUnique.mockResolvedValue(_toolAssignment({ server: { credentialRequirement: McpCredentialRequirement.PrincipalCredential } })); }],
		["remote connection with changed generation", function _WrongGeneration(transaction: ReturnType<typeof _personalOpening>) { transaction.agentRevisionMcpToolAssignment.findUnique.mockResolvedValue(_remoteToolAssignment(McpCredentialRequirement.Credentialless, false, { generation: 5 })); }],
	])("fails closed before pausing for %s", async function _InvalidConnectionEvidence(_label, mutate)
	{
		const transaction = _personalOpening();
		mutate(transaction);

		await expect(__DeferToolRequest(transaction as never, _deferCommand())).resolves.toEqual({ outcome: "unavailable" });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
		expect(transaction.elicitationRequest.create).not.toHaveBeenCalled();
		expect(transaction.approvalRequest.create).not.toHaveBeenCalled();
	});

	it.each([
		["service principal", { principalId: "requester-decoy" }],
		["service revision", { revisions: [] }],
		["unsafe service label", { name: "Company\u061Cassistant" }],
	])("fails closed before pausing when the managed %s mismatches", async function _InvalidManagedEvidence(_label, servicePatch)
	{
		const transaction = _managedOpening();
		transaction.agentService.findUnique.mockResolvedValue({ kind: AgentServiceKind.Managed, name: "Company assistant", principalId: "company-principal", principal: { provenance: PrincipalProvenance.Internal }, revisions: [{ id: "rev-1" }], ...servicePatch });

		await expect(__DeferToolRequest(transaction as never, _deferCommand())).resolves.toEqual({ outcome: "unavailable" });
		expect(transaction.agentRun.updateMany).not.toHaveBeenCalled();
		expect(transaction.approvalRequest.create).not.toHaveBeenCalled();
	});

	it("freezes denial-only disclosure without storing a secret value", async function _SecretDisclosure()
	{
		const reviewedParametersSchema = { type: "object", required: ["token"], properties: { token: { type: "string", writeOnly: true } } };
		const projection = __ProjectDeferredToolApproval(reviewedParametersSchema, { token: "never-visible" });
		const command = { ..._deferCommand(), reviewedArguments: { token: "never-visible" }, argumentsDigest: __DigestCanonicalJson({ token: "never-visible" }), reviewedParametersSchema, reviewedParametersSchemaDigest: __DigestCanonicalJson(reviewedParametersSchema), safeProposedArguments: projection.proposedArguments, responseSchema: projection.responseSchema };
		const elicitationCreate = vi.fn().mockResolvedValue({ id: "approval-existing" });
		const transaction = {
			agentRun: { findUnique: vi.fn().mockResolvedValue(RUN), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			conversationComputerActiveLease: _ActiveLeaseDelegate(ACTIVE_LEASE),
			elicitationRequest: { create: elicitationCreate },
			approvalRequest: { create: vi.fn().mockResolvedValue({ id: "approval-9" }), findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
			..._requesterDelegates(),
			toolInvocation: { findUnique: vi.fn().mockResolvedValue(_invocation({ arguments: command.reviewedArguments, argumentsDigest: command.argumentsDigest })) },
		} as unknown as Prisma.TransactionClient;

		await expect(__DeferToolRequest(transaction, command)).resolves.toMatchObject({ outcome: "deferred" });
		const saved = elicitationCreate.mock.calls[0]?.[0].data;
		expect(saved.body).toMatchObject({ proposedArguments: null, dataUse: expect.stringContaining("can only be denied") });
		expect(JSON.stringify(saved)).not.toContain("never-visible");
		expect(saved.responseSchema).toBeUndefined();
	});

	it("replays the original request without replacing its frozen disclosure", async function _FrozenReplay()
	{
		const elicitationCreate = vi.fn();
		const transaction = {
			agentRun: { findUnique: vi.fn().mockResolvedValue(RUN) },
			conversationComputerActiveLease: _ActiveLeaseDelegate(ACTIVE_LEASE),
			elicitationRequest: { create: elicitationCreate, findUnique: vi.fn().mockResolvedValue(_elicitation(_existingApproval())) },
			approvalRequest: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue(_existingApproval()), count: vi.fn() },
			..._requesterDelegates(),
			toolInvocation: { findUnique: vi.fn().mockResolvedValue(_invocation()) },
		} as unknown as Prisma.TransactionClient;

		await expect(__DeferToolRequest(transaction, { ..._deferCommand(), externalSystemName: "Renamed records" })).resolves.toEqual({ outcome: "already_deferred", approvalRequestId: "approval-existing" });
		expect(elicitationCreate).not.toHaveBeenCalled();
	});

	it.each(["2026-07-21T08:59:59.000Z", "2026-07-21T09:10:00.000Z"])("bounds approval by the independent requester evidence ending at %s", async function _RequesterExpiry(trustedUntil)
	{
		const subject = { ...EXECUTION_SUBJECT, requester: { ...EXECUTION_SUBJECT.requester, membership: { ...EXECUTION_SUBJECT.requester.membership, trustedUntil } } };
		const create = vi.fn().mockResolvedValue({ id: "approval-9" });
		const pause = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = {
			agentRun: { findUnique: vi.fn().mockResolvedValue({ ...RUN, executionSubject: subject }), updateMany: pause },
			conversationComputerActiveLease: _ActiveLeaseDelegate(ACTIVE_LEASE),
			elicitationRequest: { create: vi.fn().mockResolvedValue({ id: "approval-existing" }) },
			approvalRequest: { create, findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
			..._requesterDelegates(),
			toolInvocation: { findUnique: vi.fn().mockResolvedValue(_invocation({ authorizationExecutionSubject: subject })) },
		} as unknown as Prisma.TransactionClient;
		const result = await __DeferToolRequest(transaction, _deferCommand());
		if (Date.parse(trustedUntil) <= NOW.getTime())
		{
			expect(result).toEqual({ outcome: "unavailable" });
			expect(pause).not.toHaveBeenCalled();
			expect(create).not.toHaveBeenCalled();
		}
		else
		{
			expect(result).toEqual({ outcome: "deferred", approvalRequestId: "approval-9" });
			expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ expiresAt: new Date(trustedUntil) }) }));
		}
	});

	it("adds a second pending request without changing an already-waiting run", async function _batches()
	{
		const create = vi.fn().mockResolvedValue({ id: "approval-9" });
		const pause = vi.fn();
		const transaction = {
			agentRun: { findUnique: vi.fn().mockResolvedValue({ ...RUN, state: AgentRunState.WaitingForInput }), updateMany: pause },
			conversationComputerActiveLease: _ActiveLeaseDelegate(ACTIVE_LEASE),
			elicitationRequest: { create: vi.fn().mockResolvedValue({ id: "approval-existing" }) },
			approvalRequest: { create, findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(1) },
			..._requesterDelegates(),
			toolInvocation: { findUnique: vi.fn().mockResolvedValue(_invocation()) },
		} as unknown as Prisma.TransactionClient;

		expect(await __DeferToolRequest(transaction, _deferCommand())).toEqual({ outcome: "deferred", approvalRequestId: "approval-9" });
		expect(pause).not.toHaveBeenCalled();
	});

	it("reports unavailable when the run is no longer running or waiting", async function _unavailable()
	{
		const transaction = {
			agentRun: { findUnique: vi.fn().mockResolvedValue({ ...RUN, state: AgentRunState.Failed }) },
			conversationComputerActiveLease: _ActiveLeaseDelegate(ACTIVE_LEASE),
			toolInvocation: { findUnique: vi.fn().mockResolvedValue(_invocation()) },
			..._requesterDelegates(),
			approvalRequest: { create: vi.fn(), findFirst: vi.fn() },
		} as unknown as Prisma.TransactionClient;

		expect(await __DeferToolRequest(transaction, _deferCommand())).toEqual({ outcome: "unavailable" });
	});

	it.each([
		["lease generation", { ...EXECUTION_SUBJECT, computerScope: { ...EXECUTION_SUBJECT.computerScope, leaseGeneration: 1 } }],
		["lease identity", { ...EXECUTION_SUBJECT, computerScope: { ...EXECUTION_SUBJECT.computerScope, leaseId: "released-lease" } }],
	])("rejects an invocation carrying a stale %s", async function _RejectsStaleLease(_label, staleSubject)
	{
		const create = vi.fn();
		const transaction = {
			agentRun: { findUnique: vi.fn().mockResolvedValue(RUN) },
			conversationComputerActiveLease: _ActiveLeaseDelegate(ACTIVE_LEASE),
			toolInvocation: { findUnique: vi.fn().mockResolvedValue(_invocation({ authorizationExecutionSubject: staleSubject })) },
			..._requesterDelegates(),
			approvalRequest: { create },
		} as unknown as Prisma.TransactionClient;

		expect(await __DeferToolRequest(transaction, _deferCommand())).toEqual({ outcome: "unavailable" });
		expect(create).not.toHaveBeenCalled();
	});

	it("writes the approval without re-checking the lease row, so the trigger is the only lease fence", async function _TriggerIsTheOnlyLeaseFence()
	{
		const create = vi.fn().mockResolvedValue({ id: "approval-9" });
		const transaction = {
			agentRun: { findUnique: vi.fn().mockResolvedValue(RUN), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			conversationComputerActiveLease: _ActiveLeaseDelegate(null),
			elicitationRequest: { create: vi.fn().mockResolvedValue({ id: "approval-existing" }) },
			approvalRequest: { create, findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
			..._requesterDelegates(),
			toolInvocation: { findUnique: vi.fn().mockResolvedValue(_invocation()) },
		} as unknown as Prisma.TransactionClient;

		expect(await __DeferToolRequest(transaction, _deferCommand())).toEqual({ outcome: "deferred", approvalRequestId: "approval-9" });
		expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ expiresAt: new Date(EXECUTION_SUBJECT.membership.trustedUntil) }) }));
	});

	it("propagates the trigger's stale-lease rejection so the transaction owner can roll back", async function _PropagatesLeaseFence()
	{
		const transaction = {
			agentRun: { findUnique: vi.fn().mockResolvedValue(RUN), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
			conversationComputerActiveLease: _ActiveLeaseDelegate({ ...ACTIVE_LEASE, leaseId: "lease-3", leaseGeneration: 3 }),
			elicitationRequest: { create: vi.fn().mockResolvedValue({ id: "approval-existing" }) },
			approvalRequest: { create: vi.fn().mockRejectedValue(_LeaseFenceRejection()), findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
			..._requesterDelegates(),
			toolInvocation: { findUnique: vi.fn().mockResolvedValue(_invocation()) },
		} as unknown as Prisma.TransactionClient;

		await expect(__DeferToolRequest(transaction, _deferCommand())).rejects.toSatisfy(_IsApprovalRequestFenceRejection);
	});

	it("recognises only the approval_requests trigger fence as a rolled-back rejection", function _RecognisesFence()
	{
		expect(_IsApprovalRequestFenceRejection(_LeaseFenceRejection())).toBe(true);
		expect(_IsApprovalRequestFenceRejection(new Prisma.PrismaClientUnknownRequestError("ApprovalRequest requires the current waiting run and its exact computer-lease invocation", { clientVersion: "test" }))).toBe(true);
		expect(_IsApprovalRequestFenceRejection(new Prisma.PrismaClientUnknownRequestError("connection reset", { clientVersion: "test" }))).toBe(false);
		expect(_IsApprovalRequestFenceRejection(new Prisma.PrismaClientKnownRequestError("ApprovalRequest requires its exact active conversation computer lease", { code: "P2002", clientVersion: "test" }))).toBe(false);
		expect(_IsApprovalRequestFenceRejection(new Error("ApprovalRequest requires its exact active conversation computer lease"))).toBe(false);
	});

	it("fails closed when a managed service has no concrete human approver", async function _managedWithoutApprover()
	{
		const create = vi.fn();
		const transaction = {
			agentRun: { findUnique: vi.fn().mockResolvedValue(RUN) },
			conversationComputerActiveLease: _ActiveLeaseDelegate(ACTIVE_LEASE),
			toolInvocation: { findUnique: vi.fn().mockResolvedValue(_invocation()) },
			principal: { findUnique: vi.fn().mockResolvedValue(null) },
			approvalRequest: { create },
		} as unknown as Prisma.TransactionClient;

		expect(await __DeferToolRequest(transaction, _deferCommand())).toEqual({ outcome: "unavailable" });
		expect(create).not.toHaveBeenCalled();
	});

	it("replays the existing approval idempotently on a duplicate defer", async function _idempotentDefer()
	{
		const transaction = {
			agentRun: { findUnique: vi.fn().mockResolvedValue(RUN) },
			conversationComputerActiveLease: _ActiveLeaseDelegate(ACTIVE_LEASE),
			approvalRequest: { create: vi.fn(), findFirst: vi.fn().mockResolvedValue(_existingApproval()) },
			elicitationRequest: { findUnique: vi.fn().mockResolvedValue(_elicitation(_existingApproval())) },
			..._requesterDelegates(),
			toolInvocation: { findUnique: vi.fn().mockResolvedValue(_invocation()) },
		} as unknown as Prisma.TransactionClient;

		expect(await __DeferToolRequest(transaction, _deferCommand())).toEqual({ outcome: "already_deferred", approvalRequestId: "approval-existing" });
	});

	it("does not open when the run cannot enter its waiting state", async function _pauseRace()
	{
		const create = vi.fn();
		const transaction = {
			agentRun: { findUnique: vi.fn().mockResolvedValue(RUN), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
			conversationComputerActiveLease: _ActiveLeaseDelegate(ACTIVE_LEASE),
			approvalRequest: { create, findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0) },
			..._requesterDelegates(),
			toolInvocation: { findUnique: vi.fn().mockResolvedValue(_invocation()) },
		} as unknown as Prisma.TransactionClient;

		expect(await __DeferToolRequest(transaction, _deferCommand())).toEqual({ outcome: "unavailable" });
		expect(create).not.toHaveBeenCalled();
	});

	it("fails closed before pausing when the assigned subject has no exact Principal", async function _MissingPrincipal()
	{
		const pause = vi.fn();
		const create = vi.fn();
		const transaction = {
			agentRun: { findUnique: vi.fn().mockResolvedValue(RUN), updateMany: pause },
			conversationComputerActiveLease: _ActiveLeaseDelegate(ACTIVE_LEASE),
			toolInvocation: { findUnique: vi.fn().mockResolvedValue(_invocation()) },
			principal: { findUnique: vi.fn().mockResolvedValue(null) },
			approvalRequest: { create },
		} as unknown as Prisma.TransactionClient;

		expect(await __DeferToolRequest(transaction, _deferCommand())).toEqual({ outcome: "unavailable" });
		expect(pause).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
	});
});
