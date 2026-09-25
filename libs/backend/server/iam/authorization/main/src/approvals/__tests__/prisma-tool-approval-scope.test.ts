import { ExternalActionRecoveryMode, McpExecutionTransport, PrincipalProvenance, Prisma, ToolApprovalScopeState, ToolInvocationState } from "@prisma/client";
import { ElicitationConnectionOwnerKinds, McpCredentialRequirement } from "@opencrane/contracts";
import { ExecutionSubjectMembershipKinds } from "@opencrane/models/agents";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../grants/persistence/prisma-managed-authorization-grant-repository", function _ManagedGrants()
{
	return { __ReconcileManagedAuthorizationGrantsInTransaction: vi.fn().mockResolvedValue(2) };
});

import { __ApplyStandingToolApprovalInTransaction, __ConsumeStandingToolApprovalAdmissionInTransaction, __CreateToolApprovalScopeInTransaction, __ValidateStandingToolApprovalAdmissionInTransaction } from "../prisma-tool-approval-scope";
import { __DigestCanonicalJson } from "../../authority/canonical-json-digest";

const _NOW = new Date("2026-09-25T08:00:00.000Z");
const _ARGUMENTS = { recordId: "record-1", status: "approved" } as const;
const _DIGEST = __DigestCanonicalJson(_ARGUMENTS);
const _CONNECTION = { disclosure: { ownerKind: ElicitationConnectionOwnerKinds.Personal, ownerLabel: "Personal owner", credentialRequirement: McpCredentialRequirement.PrincipalCredential }, connectionId: "connection-1", connectionOwnerPrincipalId: "agent-principal-1", connectionGeneration: 7, connectionEndpointDigest: "sha256:endpoint", assistantLabel: null } as const;

/** Complete frozen execution subject used to prove the original requester at claim time. */
function _ExecutionSubject()
{
	const trustedUntil = new Date(_NOW.getTime() + 60_000).toISOString();
	const membership = { kind: ExecutionSubjectMembershipKinds.Fleet, siloId: "silo-1", principalId: "agent-principal-1", revision: 1, assertionId: "membership-1", payloadDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "membership-evidence", trustedUntil } as const;
	return {
		schemaVersion: 1 as const, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "agent-principal-1",
		identity: { siloId: "silo-1", agentIdentityId: "identity-1", principalId: "agent-principal-1", headRevision: "0", headDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "identity-evidence", verifiedAt: _NOW.toISOString() },
		membership,
		capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-evidence", decidedAt: _NOW.toISOString() },
		runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" },
		computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 },
		requester: { siloId: "silo-1", requesterPrincipalId: "requester-1", requestIdempotencyKey: "request-1", authenticatedAt: _NOW.toISOString(), membership: { ...membership, principalId: "requester-1" } },
		admission: { authorizingPrincipalId: "requester-1", decisionEvidenceId: "admission-evidence", admittedAt: _NOW.toISOString() },
	};
}

/** Exact active standing scope used by admission and claim tests. */
function _Scope(overrides: Readonly<Record<string, unknown>> = {})
{
	return { id: "scope-1", siloId: "silo-1", requesterPrincipalId: "requester-1", requesterSubjectId: "user-1", agentServiceId: "service-1", agentRevisionId: "revision-1", connectionId: "connection-1", connectionOwnerPrincipalId: "agent-principal-1", connectionGeneration: 7, connectionEndpointDigest: "sha256:endpoint", toolRevisionId: "tool-revision-1", toolAction: "invoke", reviewedArguments: _ARGUMENTS, argumentsDigest: _DIGEST, routineId: null, routineRevision: null, actionLabel: "Invoke tool", targetLabel: "records.update", externalSystemLabel: "Records", assistantLabel: null, connectionOwnerLabel: "Personal owner", sourceApprovalRequestId: "approval-1", scopeIdentityDigest: "sha256:scope", state: ToolApprovalScopeState.Active, revision: 0, revocationIdempotencyDigest: null, revocationCommandDigest: null, revokedByPrincipalId: null, revokedAt: null, createdAt: _NOW, ...overrides };
}

/** Interactive run row whose null routine coordinates prevent scope bleed. */
function _InteractiveRun()
{
	return { id: "run-1", siloId: "silo-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", conversationId: "conversation-1", trigger: "Interactive", routineFiringId: null, routineId: null, routineRevision: null, routineScheduledSlot: null, inputSnapshotDigest: "sha256:snapshot" };
}

/** Interactive input snapshot linked by the run's saved digest. */
function _InteractiveSnapshot()
{
	return { runId: "run-1", attempt: 1, snapshotVersion: 3, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", conversationId: "conversation-1", origin: { kind: "interactive", messageId: "message-1", historyRevision: "9" }, digest: "sha256:snapshot" };
}

/** Prisma delegates needed to derive interactive null routine coordinates. */
function _InteractiveProvenance(invocation: Readonly<Record<string, unknown>>)
{
	return {
		toolInvocation: { findUnique: vi.fn().mockResolvedValue(invocation), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		agentRun: { findUnique: vi.fn().mockResolvedValue(_InteractiveRun()) },
		runInputSnapshot: { findMany: vi.fn().mockResolvedValue([_InteractiveSnapshot()]) },
	};
}

/** Scheduled run row linked to one immutable routine firing. */
function _ScheduledRun()
{
	return { ..._InteractiveRun(), trigger: "Scheduled", routineFiringId: "firing-1", routineId: "routine-1", routineRevision: 3, routineScheduledSlot: new Date("2026-09-25T10:00:00.000Z") };
}

/** Scheduled input snapshot that repeats the immutable occurrence and requester. */
function _ScheduledSnapshot()
{
	return {
		..._InteractiveSnapshot(),
		origin: { kind: "scheduled", routineId: "routine-1", routineRevision: 3, firingId: "firing-1", scheduledSlot: "2026-09-25T10:00:00.000Z", requesterPrincipalId: "requester-1", requesterIssuer: "https://issuer.example", requesterSubjectId: "user-1", requesterAuthenticatedAt: "2026-09-01T08:00:00.000Z", workflowTaskId: "task-1", workflowTaskName: "routine-occurrence", workflowTaskKey: "firing-1" },
	};
}

/** Prisma delegates needed to derive a routine-scoped approval from a scheduled invocation. */
function _ScheduledProvenance(invocation: Readonly<Record<string, unknown>>)
{
	const routine = { id: "routine-1", siloId: "silo-1", originalRequesterPrincipalId: "requester-1", requesterIssuer: "https://issuer.example", requesterSubjectId: "user-1", requesterAuthenticatedAt: new Date("2026-09-01T08:00:00.000Z"), selectedManagedServiceId: "service-1" };
	const firing = { id: "firing-1", siloId: "silo-1", routineId: "routine-1", routineRevision: 3, trigger: "Automatic", scheduledSlot: new Date("2026-09-25T10:00:00.000Z"), requesterPrincipalId: "requester-1", conversationId: "conversation-1", runId: "run-1", workflowTaskId: "task-1", workflowTaskName: "routine-occurrence", workflowTaskKey: "firing-1", routine };
	return {
		toolInvocation: { findUnique: vi.fn().mockResolvedValue(invocation), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		agentRun: { findUnique: vi.fn().mockResolvedValue(_ScheduledRun()) },
		runInputSnapshot: { findMany: vi.fn().mockResolvedValue([_ScheduledSnapshot()]) },
		agentRoutineFiring: { findUnique: vi.fn().mockResolvedValue(firing) },
	};
}

describe("standing tool approval persistence", function _Suite()
{
	it("deduplicates identical first approvals through one canonical scope identity", async function _Deduplicates()
	{
		const upsert = vi.fn().mockResolvedValue(_Scope());
		const provenance = _InteractiveProvenance({ siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" });
		const transaction = { ...provenance, approvalRequest: { findUnique: vi.fn().mockResolvedValue({ toolInvocationRowId: "invocation-1" }) }, toolApprovalScope: { findUnique: vi.fn().mockResolvedValue(null), upsert } } as unknown as Prisma.TransactionClient;
		const command = { approvalRequestId: "approval-2", siloId: "silo-1", requesterPrincipalId: "requester-1", requesterSubjectId: "user-1", agentServiceId: "service-1", agentRevisionId: "revision-1", toolRevisionId: "tool-revision-1", arguments: _ARGUMENTS, argumentsDigest: _DIGEST, actionLabel: "Invoke tool", targetLabel: "records.update", externalSystemLabel: "Records", connection: _CONNECTION, now: _NOW };

		await expect(__CreateToolApprovalScopeInTransaction(transaction, command)).resolves.toMatchObject({ id: "scope-1" });
		expect(upsert).toHaveBeenCalledOnce();
	});

	it("creates a new active scope after a fresh human approval replaces revoked consent", async function _FreshAfterRevocation()
	{
		const created = _Scope({ id: "scope-2", sourceApprovalRequestId: "approval-2" });
		const upsert = vi.fn().mockResolvedValue(created);
		const provenance = _InteractiveProvenance({ siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" });
		const transaction = { ...provenance, approvalRequest: { findUnique: vi.fn().mockResolvedValue({ toolInvocationRowId: "invocation-1" }) }, toolApprovalScope: { findUnique: vi.fn().mockResolvedValue(null), upsert } } as unknown as Prisma.TransactionClient;
		const command = { approvalRequestId: "approval-2", siloId: "silo-1", requesterPrincipalId: "requester-1", requesterSubjectId: "user-1", agentServiceId: "service-1", agentRevisionId: "revision-1", toolRevisionId: "tool-revision-1", arguments: _ARGUMENTS, argumentsDigest: _DIGEST, actionLabel: "Invoke tool", targetLabel: "records.update", externalSystemLabel: "Records", connection: _CONNECTION, now: _NOW };

		await expect(__CreateToolApprovalScopeInTransaction(transaction, command)).resolves.toMatchObject({ id: "scope-2" });
		expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ sourceApprovalRequestId: "approval-2", scopeIdentityDigest: expect.stringMatching(/^sha256:/), activeIdentityDigest: expect.stringMatching(/^sha256:/) }) }));
	});

	it("derives routine scope coordinates from the approved invocation instead of the command", async function _RoutineScope()
	{
		const scope = _Scope({ routineId: "routine-1", routineRevision: 3 });
		const upsert = vi.fn().mockResolvedValue(scope);
		const provenance = _ScheduledProvenance({ siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" });
		const transaction = { ...provenance, approvalRequest: { findUnique: vi.fn().mockResolvedValue({ toolInvocationRowId: "invocation-1" }) }, toolApprovalScope: { findUnique: vi.fn().mockResolvedValue(null), upsert } } as unknown as Prisma.TransactionClient;
		const command = { approvalRequestId: "approval-1", siloId: "silo-1", requesterPrincipalId: "requester-1", requesterSubjectId: "user-1", agentServiceId: "service-1", agentRevisionId: "revision-1", toolRevisionId: "tool-revision-1", arguments: _ARGUMENTS, argumentsDigest: _DIGEST, actionLabel: "Invoke tool", targetLabel: "records.update", externalSystemLabel: "Records", connection: _CONNECTION, now: _NOW };

		await expect(__CreateToolApprovalScopeInTransaction(transaction, command)).resolves.toMatchObject({ routineId: "routine-1", routineRevision: 3 });
		expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ routineId: "routine-1", routineRevision: 3 }) }));
	});

	it("refuses a routine scope when durable requester provenance does not match the reviewer", async function _RequesterMismatch()
	{
		const provenance = _ScheduledProvenance({ siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" });
		const transaction = { ...provenance, approvalRequest: { findUnique: vi.fn().mockResolvedValue({ toolInvocationRowId: "invocation-1" }) }, toolApprovalScope: { findUnique: vi.fn(), upsert: vi.fn() } } as unknown as Prisma.TransactionClient;
		const command = { approvalRequestId: "approval-1", siloId: "silo-1", requesterPrincipalId: "requester-2", requesterSubjectId: "user-2", agentServiceId: "service-1", agentRevisionId: "revision-1", toolRevisionId: "tool-revision-1", arguments: _ARGUMENTS, argumentsDigest: _DIGEST, actionLabel: "Invoke tool", targetLabel: "records.update", externalSystemLabel: "Records", connection: _CONNECTION, now: _NOW };

		await expect(__CreateToolApprovalScopeInTransaction(transaction, command)).rejects.toThrow("invalid routine provenance");
	});

	it("matches the original requester subject and interactive null routine before creating one-use evidence", async function _Matches()
	{
		const scope = _Scope();
		const admission = { id: "admission-1", scopeId: scope.id, scopeRevision: 0, toolInvocationId: "invocation-1", origin: "StandingConsent", argumentsDigest: _DIGEST, createdAt: _NOW, consumedAt: null, consumedClaimFence: null, scope };
		const invocation = { id: "invocation-1", siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", approvalRequired: true, arguments: _ARGUMENTS, argumentsDigest: _DIGEST, state: ToolInvocationState.AwaitingApproval, recoveryMode: ExternalActionRecoveryMode.Manual, claimKind: null, preparationAttempt: 1, retryDeadlineAt: new Date(_NOW.getTime() + 60_000), revision: 2, createdAt: _NOW, standingApprovalAdmission: admission };
		const findMany = vi.fn().mockResolvedValue([scope]);
		const provenance = _InteractiveProvenance(invocation);
		const transaction = { ...provenance, toolApprovalScope: { findMany }, toolApprovalAdmission: { create: vi.fn().mockResolvedValue(admission) } } as unknown as Prisma.TransactionClient;

		await expect(__ApplyStandingToolApprovalInTransaction(transaction, { invocationId: "invocation-1", siloId: "silo-1", requesterPrincipalId: "requester-1", requesterSubjectId: "user-1", agentServiceId: "service-1", agentRevisionId: "revision-1", toolRevisionId: "tool-revision-1", arguments: _ARGUMENTS, argumentsDigest: _DIGEST, connection: _CONNECTION, now: _NOW })).resolves.toBe(true);
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ requesterSubjectId: "user-1", routineId: null, routineRevision: null, connectionGeneration: 7 }) }));
	});

	it("matches only the same immutable routine revision when applying standing consent", async function _RoutineMatch()
	{
		const scope = _Scope({ routineId: "routine-1", routineRevision: 3 });
		const admission = { id: "admission-1", scopeId: scope.id, scopeRevision: 0, toolInvocationId: "invocation-1", origin: "StandingConsent", argumentsDigest: _DIGEST, createdAt: _NOW, consumedAt: null, consumedClaimFence: null, scope };
		const invocation = { id: "invocation-1", siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", approvalRequired: true, arguments: _ARGUMENTS, argumentsDigest: _DIGEST, state: ToolInvocationState.AwaitingApproval, recoveryMode: ExternalActionRecoveryMode.Manual, claimKind: null, preparationAttempt: 1, retryDeadlineAt: new Date(_NOW.getTime() + 60_000), revision: 2, createdAt: _NOW, standingApprovalAdmission: admission };
		const findMany = vi.fn().mockResolvedValue([scope]);
		const provenance = _ScheduledProvenance(invocation);
		const transaction = { ...provenance, toolApprovalScope: { findMany }, toolApprovalAdmission: { create: vi.fn().mockResolvedValue(admission) } } as unknown as Prisma.TransactionClient;

		await expect(__ApplyStandingToolApprovalInTransaction(transaction, { invocationId: "invocation-1", siloId: "silo-1", requesterPrincipalId: "requester-1", requesterSubjectId: "user-1", agentServiceId: "service-1", agentRevisionId: "revision-1", toolRevisionId: "tool-revision-1", arguments: _ARGUMENTS, argumentsDigest: _DIGEST, connection: _CONNECTION, now: _NOW })).resolves.toBe(true);
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ routineId: "routine-1", routineRevision: 3 }) }));
	});

	it("does not accept an interactive scope returned for a routine invocation", async function _InteractiveSeparation()
	{
		const interactiveScope = _Scope();
		const invocation = { id: "invocation-1", siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" };
		const provenance = _ScheduledProvenance(invocation);
		const transaction = { ...provenance, toolApprovalScope: { findMany: vi.fn().mockResolvedValue([interactiveScope]) } } as unknown as Prisma.TransactionClient;

		await expect(__ApplyStandingToolApprovalInTransaction(transaction, { invocationId: "invocation-1", siloId: "silo-1", requesterPrincipalId: "requester-1", requesterSubjectId: "user-1", agentServiceId: "service-1", agentRevisionId: "revision-1", toolRevisionId: "tool-revision-1", arguments: _ARGUMENTS, argumentsDigest: _DIGEST, connection: _CONNECTION, now: _NOW })).resolves.toBe(false);
	});

	it("rejects claim admission after revocation or a changed frozen connection generation", async function _ClaimFence()
	{
		const subject = _ExecutionSubject();
		const scope = _Scope({ state: ToolApprovalScopeState.Revoked, revision: 1 });
		const invocation = { id: "invocation-1", siloId: "silo-1", runId: "run-1", attempt: 1, principalId: "agent-principal-1", agentServiceId: "service-1", agentRevisionId: "revision-1", toolRevisionId: "tool-revision-1", approvalRequired: true, effectiveArguments: _ARGUMENTS, effectiveArgumentsDigest: _DIGEST, authorizationExecutionSubject: subject, standingApprovalAdmission: { id: "admission-1", scopeRevision: 0, consumedAt: null, origin: "StandingConsent", argumentsDigest: _DIGEST, scope } };
		const provenance = _InteractiveProvenance(invocation);
		const transaction = { ...provenance, agentRevisionMcpToolAssignment: { findUnique: vi.fn().mockResolvedValue({ siloId: "silo-1", agentServiceId: "service-1" }) }, mcpToolRevision: { findUnique: vi.fn().mockResolvedValue({ serverRevision: { transport: McpExecutionTransport.RemoteHttp, connectionId: "connection-1", connectionGeneration: 8, connectionOwnerPrincipalId: "agent-principal-1", endpointDigest: "sha256:endpoint" } }) }, principal: { findUnique: vi.fn().mockResolvedValue({ id: "requester-1", subject: "user-1", provenance: PrincipalProvenance.External }) } } as unknown as Prisma.TransactionClient;

		await expect(__ValidateStandingToolApprovalAdmissionInTransaction(transaction, "invocation-1")).resolves.toBe(false);
	});

	it("fails closed when claim validation cannot reload the invocation", async function _MissingInvocation()
	{
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValue(null) } } as unknown as Prisma.TransactionClient;
		await expect(__ValidateStandingToolApprovalAdmissionInTransaction(transaction, "missing-invocation")).resolves.toBe(false);
	});

	it("rejects one-use evidence copied from another routine revision", async function _RoutineRevisionMismatch()
	{
		const subject = _ExecutionSubject();
		const scope = _Scope({ routineId: "routine-1", routineRevision: 4 });
		const invocation = { id: "invocation-1", siloId: "silo-1", runId: "run-1", attempt: 1, principalId: "agent-principal-1", agentServiceId: "service-1", agentRevisionId: "revision-1", toolRevisionId: "tool-revision-1", approvalRequired: true, effectiveArguments: _ARGUMENTS, effectiveArgumentsDigest: _DIGEST, authorizationExecutionSubject: subject, standingApprovalAdmission: { id: "admission-1", scopeRevision: 0, consumedAt: null, origin: "StandingConsent", argumentsDigest: _DIGEST, scope } };
		const provenance = _ScheduledProvenance(invocation);
		const transaction = { ...provenance, agentRevisionMcpToolAssignment: { findUnique: vi.fn() }, mcpToolRevision: { findUnique: vi.fn() }, principal: { findUnique: vi.fn() } } as unknown as Prisma.TransactionClient;

		await expect(__ValidateStandingToolApprovalAdmissionInTransaction(transaction, "invocation-1")).resolves.toBe(false);
		expect(transaction.agentRevisionMcpToolAssignment.findUnique).not.toHaveBeenCalled();
	});

	it("rejects claim admission after the current agent revision loses its tool assignment", async function _CurrentPermission()
	{
		const subject = _ExecutionSubject();
		const scope = _Scope();
		const invocation = { id: "invocation-1", siloId: "silo-1", runId: "run-1", attempt: 1, principalId: "agent-principal-1", agentServiceId: "service-1", agentRevisionId: "revision-1", toolRevisionId: "tool-revision-1", approvalRequired: true, effectiveArguments: _ARGUMENTS, effectiveArgumentsDigest: _DIGEST, authorizationExecutionSubject: subject, standingApprovalAdmission: { id: "admission-1", scopeRevision: 0, consumedAt: null, origin: "StandingConsent", argumentsDigest: _DIGEST, scope } };
		const provenance = _InteractiveProvenance(invocation);
		const transaction = { ...provenance, agentRevisionMcpToolAssignment: { findUnique: vi.fn().mockResolvedValue(null) }, mcpToolRevision: { findUnique: vi.fn() }, principal: { findUnique: vi.fn() } } as unknown as Prisma.TransactionClient;

		await expect(__ValidateStandingToolApprovalAdmissionInTransaction(transaction, "invocation-1")).resolves.toBe(false);
		expect(transaction.mcpToolRevision.findUnique).not.toHaveBeenCalled();
	});

	it("fails closed before scope lookup when routine snapshot provenance is corrupt", async function _CorruptRoutine()
	{
		const invocation = { id: "invocation-1", siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" };
		const provenance = _ScheduledProvenance(invocation);
		provenance.runInputSnapshot.findMany.mockResolvedValue([{ ..._ScheduledSnapshot(), origin: { ..._ScheduledSnapshot().origin, routineId: "routine-2" } }]);
		const findMany = vi.fn();
		const transaction = { ...provenance, toolApprovalScope: { findMany } } as unknown as Prisma.TransactionClient;

		await expect(__ApplyStandingToolApprovalInTransaction(transaction, { invocationId: "invocation-1", siloId: "silo-1", requesterPrincipalId: "requester-1", requesterSubjectId: "user-1", agentServiceId: "service-1", agentRevisionId: "revision-1", toolRevisionId: "tool-revision-1", arguments: _ARGUMENTS, argumentsDigest: _DIGEST, connection: _CONNECTION, now: _NOW })).resolves.toBe(false);
		expect(findMany).not.toHaveBeenCalled();
	});

	it("consumes the one-use admission only while the same scope revision remains active", async function _Consumes()
	{
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { toolApprovalAdmission: { findUnique: vi.fn().mockResolvedValue({ id: "admission-1", scopeRevision: 0 }), updateMany } } as unknown as Prisma.TransactionClient;
		await __ConsumeStandingToolApprovalAdmissionInTransaction(transaction, "invocation-1", 3, _NOW);
		expect(updateMany).toHaveBeenCalledWith({ where: { id: "admission-1", scopeRevision: 0, consumedAt: null, scope: { is: { state: ToolApprovalScopeState.Active, revision: 0 } } }, data: { consumedAt: _NOW, consumedClaimFence: 3 } });
	});
});
