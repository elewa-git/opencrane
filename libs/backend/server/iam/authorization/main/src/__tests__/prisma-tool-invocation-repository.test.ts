import { ExecutionSubjectMembershipKinds } from "@opencrane/models/agents";
import { AgentRunState, ExternalActionClaimKind, ExternalActionRecoveryMode, ToolInvocationState, type Prisma } from "@prisma/client";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";
import { describe, expect, it, vi } from "vitest";

import { ExternalActionClaimKinds, ExternalActionRecoveryModes, ToolInvocationStates } from "../tool-invocation-lifecycle.types";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { PrismaToolInvocationRepository } from "../prisma-tool-invocation-repository";
import { __AdmitPreparingToolInvocationInTransaction } from "../tool-invocation-transaction";

/** Valid execution authority that every run-owned test invocation must carry. */
const EXECUTION_SUBJECT = {
	schemaVersion: 1,
	siloId: "silo-1",
	agentIdentityId: "identity-1",
	principalId: "principal-1",
	identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "0", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-evidence", verifiedAt: "2026-08-11T10:00:00.000Z" },
	membership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "principal-1", siloId: "silo-1", revision: 3, assertionId: "membership-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-evidence", trustedUntil: "2026-08-11T11:00:00.000Z" },
	capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-evidence", decidedAt: "2026-08-11T10:00:00.000Z" },
	runScope: { siloId: "silo-1", runId: "run-1", attempt: 2, agentServiceId: "service-1", agentRevisionId: "revision-1" },
	computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 },
	requester: { membership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "principal-1", siloId: "silo-1", revision: 3, assertionId: "membership-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-evidence", trustedUntil: "2026-08-11T11:00:00.000Z" }, siloId: "silo-1", requesterPrincipalId: "principal-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-08-11T10:00:00.000Z" },
	admission: { authorizingPrincipalId: "principal-1", decisionEvidenceId: "admission-evidence", admittedAt: "2026-08-11T10:00:00.000Z" },
} as const;

/** Build one complete persistence row around a focused state override. */
function _row(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown>
{
	return {
		id: "invocation-row-1", siloId: "silo-1", runId: "run-1", attempt: 2, agentServiceId: "service-1", agentRevisionId: "revision-1", agentIdentityId: "identity-1", principalId: "principal-1",
		authorizationActorKind: null, authorizationExecutionSubject: null, authorizationCoordinates: null, authorizationDecisionDigests: [], authorizationAssignmentDigest: null, authorizationEvidenceDigest: null,
		runtimeInstanceId: "runtime-1", commandId: "command-1", candidateId: "candidate-1", toolRevisionId: "integration:calendar:create", toolInvocationId: "tool-1",
		arguments: { title: "Proposed" }, argumentsDigest: "sha256:proposed", effectiveArguments: { title: "Proposed" }, effectiveArgumentsDigest: "sha256:proposed", requestFingerprint: "sha256:fingerprint", requestIdentity: {}, approvalRequired: false,
		recoveryMode: ExternalActionRecoveryMode.Manual, recoveryKey: null, state: ToolInvocationState.Preparing, preparationAttempt: 1,
		retryDeadlineAt: new Date("2026-08-11T10:05:00.000Z"), nextPreparationAttemptAt: new Date("2026-08-11T10:00:00.000Z"), claimAttempt: 0,
		claimKind: null, claimFence: 0, claimExpiresAt: null, recoveryRequiredAt: null, result: null, failureCode: null, revision: 0,
		createdAt: new Date("2026-08-11T10:00:00.000Z"), updatedAt: new Date("2026-08-11T10:00:00.000Z"), completedAt: null, ...overrides,
	};
}

/** Build complete structured authorization evidence around the fixed invocation fixture. */
function _authorizationEvidence()
{
	const assignmentDigest = `sha256:${"a".repeat(64)}` as const;
	const evidence = {
		actorKind: "workload" as const,
		executionSubject: EXECUTION_SUBJECT,
		coordinates: [{ resource: { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: "integration:calendar:create" }, action: ProductAuthorizationActions.Invoke }],
		decisionDigests: [`sha256:${"b".repeat(64)}`] as const,
		agentRevisionId: "revision-1",
		runId: "run-1",
		attempt: 2,
		argumentsDigest: "sha256:proposed",
		assignmentDigest,
	};
	return { ...evidence, evidenceDigest: ___DigestCanonicalJson(evidence as unknown as JsonValue) };
}

/** Fixed provider-free retry policy approved for production. */
function _policy()
{
	return { attemptLimit: 3, retryWindowMilliseconds: 300_000, retryDelayMilliseconds: 1_000 };
}

describe("PrismaToolInvocationRepository", function _suite()
{
	it("admits effective arguments with coherent timestamps after delayed uniqueness reads", async function _admits()
	{
		const created = _row({ preparationAttempt: 0 });
		const create = vi.fn(async function _DelayedCreate({ data }: { data: Prisma.ToolInvocationUncheckedCreateInput })
		{
			const createdAt = new Date(data.createdAt ?? "2026-08-11T10:00:00.005Z");
			if (new Date(data.nextPreparationAttemptAt).getTime() < createdAt.getTime() || new Date(data.retryDeadlineAt).getTime() <= createdAt.getTime())
				throw new Error("tool_invocations_identity_check");
			return { ...created, createdAt };
		});
		const findUnique = vi.fn(async function _DelayedRead() { await Promise.resolve(); return null; });
		const transaction = { toolInvocation: { findUnique, create } } as unknown as Prisma.TransactionClient;
		const intent = { siloId: "silo-1", runId: "run-1", attempt: 2, agentServiceId: "service-1", agentRevisionId: "revision-1", authorizationEvidence: _authorizationEvidence(), requestIdentity: { runtimeInstanceId: "runtime-1", commandId: "command-1", candidateId: "candidate-1" }, toolRevisionId: "integration:calendar:create", toolInvocationId: "tool-1", arguments: { title: "Proposed" }, argumentsDigest: "sha256:proposed", requestFingerprint: "sha256:fingerprint", approvalRequired: false, recoveryMode: ExternalActionRecoveryModes.Manual, recoveryKey: null } as const;
		const result = await __AdmitPreparingToolInvocationInTransaction(transaction, intent, new Date("2026-08-11T10:00:00.000Z"), _policy());
		expect(result.outcome).toBe("admitted");
		expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ effectiveArguments: { title: "Proposed" }, effectiveArgumentsDigest: "sha256:proposed", createdAt: new Date("2026-08-11T10:00:00.000Z"), nextPreparationAttemptAt: new Date("2026-08-11T10:00:00.000Z"), retryDeadlineAt: new Date("2026-08-11T10:05:00.000Z") }) });
	});


	it("allows successful first preparation after the retry deadline because only retries expire", async function _latePreparationSuccess()
	{
		const initial = _row({ preparationAttempt: 0, revision: 0 });
		const ready = _row({ state: ToolInvocationState.Ready, preparationAttempt: 1, revision: 1, nextPreparationAttemptAt: new Date("2026-08-11T10:06:00.000Z") });
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(ready), updateMany } } as unknown as Prisma.TransactionClient;

		await expect(new PrismaToolInvocationRepository(transaction).markPrepared("invocation-row-1", 0, new Date("2026-08-11T10:06:00.000Z"))).resolves.toEqual(expect.objectContaining({ state: ToolInvocationStates.Ready, preparationAttempt: 1 }));
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: ToolInvocationState.Preparing, revision: 0 }), data: expect.objectContaining({ state: ToolInvocationState.Ready, preparationAttempt: { increment: 1 } }) }));
	});

	it("retries only provider-free preparation before the third attempt", async function _boundedPreparationRetry()
	{
		const initial = _row({ preparationAttempt: 0, revision: 0 });
		const retried = _row({ preparationAttempt: 1, revision: 1, nextPreparationAttemptAt: new Date("2026-08-11T10:00:02.000Z") });
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(retried), updateMany }, toolResultDelivery: { create: vi.fn() } } as unknown as Prisma.TransactionClient;
		const result = await new PrismaToolInvocationRepository(transaction).recordPreparationFailure("invocation-row-1", 0, new Date("2026-08-11T10:00:01.000Z"), _policy(), "preparation_failed");
		expect(result).toEqual({ changed: true, invocation: expect.objectContaining({ state: ToolInvocationStates.Preparing, preparationAttempt: 1 }) });
		expect(transaction.toolResultDelivery.create).not.toHaveBeenCalled();
	});

	it("fails the third provider-free preparation attempt and saves one delivery", async function _exhaustedPreparation()
	{
		const initial = _row({ preparationAttempt: 2, revision: 2 });
		const failed = _row({ state: ToolInvocationState.Failed, preparationAttempt: 3, failureCode: "preparation_failed", revision: 3 });
		const create = vi.fn();
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(failed), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, toolResultDelivery: { create } } as unknown as Prisma.TransactionClient;
		const result = await new PrismaToolInvocationRepository(transaction).recordPreparationFailure("invocation-row-1", 2, new Date("2026-08-11T10:00:01.000Z"), _policy(), "preparation_failed");
		expect(result.invocation).toEqual(expect.objectContaining({ state: ToolInvocationStates.Failed, preparationAttempt: 3 }));
		expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ toolInvocationId: "invocation-row-1", payload: { toolInvocationId: "tool-1", outcome: "failed", failureCode: "preparation_failed" } }) });
	});

	it("persists approved arguments as the only dispatch-effective values", async function _approvedArguments()
	{
		const proposed = _row({ approvalRequired: true, state: ToolInvocationState.AwaitingApproval, revision: 1 });
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValue(proposed), updateMany } } as unknown as Prisma.TransactionClient;
		await expect(new PrismaToolInvocationRepository(transaction).markApproved("invocation-row-1", { title: "Proposed" }, "sha256:proposed", { title: "Approved" }, "sha256:approved")).resolves.toBe(true);
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ effectiveArguments: { title: "Approved" }, effectiveArgumentsDigest: "sha256:approved", state: ToolInvocationState.Ready }) }));
	});

	it("binds terminal completion to exact claim kind, fence, and revision", async function _exactClaim()
	{
		const before = _row({ state: ToolInvocationState.Reconciling, claimKind: ExternalActionClaimKind.Reconcile, claimFence: 4, revision: 6 });
		const winner = _row({ state: ToolInvocationState.Succeeded, claimKind: null, claimFence: 4, result: { ok: true }, revision: 7 });
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(winner).mockResolvedValueOnce(winner), updateMany }, toolResultDelivery: { create: vi.fn() } } as unknown as Prisma.TransactionClient;
		const claim = { invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Reconcile, fence: 4, revision: 6 };
		await new PrismaToolInvocationRepository(transaction).complete(claim, { toolInvocationId: "tool-1", outcome: "succeeded", result: { ok: true } }, new Date("2026-08-11T10:00:01.000Z"));
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: ToolInvocationState.Reconciling, claimKind: ExternalActionClaimKind.Reconcile, claimFence: 4, revision: 6, run: { is: { attempt: 2, state: AgentRunState.Running } } }) }));
	});

	it("does not create a duplicate delivery when a stale claim and revision lose the completion CAS", async function _completionCasLoser()
	{
		const claimed = _row({ state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 3, revision: 5 });
		const winner = _row({ state: ToolInvocationState.Succeeded, claimKind: null, claimFence: 3, revision: 6, result: { ok: true }, completedAt: new Date("2026-08-11T10:00:01.000Z") });
		const updateMany = vi.fn().mockResolvedValue({ count: 0 });
		const create = vi.fn();
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(winner), updateMany }, toolResultDelivery: { create } } as unknown as Prisma.TransactionClient;
		const staleClaim = { invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 2, revision: 4 };

		await expect(new PrismaToolInvocationRepository(transaction).complete(staleClaim, { toolInvocationId: "tool-1", outcome: "succeeded", result: { ok: true } }, new Date("2026-08-11T10:00:01.000Z"))).resolves.toEqual({ outcome: "winner", invocation: expect.objectContaining({ state: ToolInvocationStates.Succeeded, revision: 6 }) });
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ claimFence: 2, revision: 4 }) }));
		expect(create).not.toHaveBeenCalled();
	});

	it("never grants a second reconciliation claim while a live lease exists", async function _singleClaim()
	{
		const active = _row({ state: ToolInvocationState.Reconciling, claimKind: ExternalActionClaimKind.Reconcile, claimFence: 2, claimExpiresAt: new Date("2026-08-11T10:01:00.000Z"), revision: 3 });
		const updateMany = vi.fn().mockResolvedValue({ count: 0 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(active).mockResolvedValueOnce(active), updateMany } } as unknown as Prisma.TransactionClient;
		await expect(new PrismaToolInvocationRepository(transaction).claim("invocation-row-1", ExternalActionClaimKinds.Reconcile, new Date("2026-08-11T10:00:01.000Z"), 30_000)).resolves.toEqual({ outcome: "winner", invocation: expect.objectContaining({ claimKind: ExternalActionClaimKinds.Reconcile }) });
		expect(updateMany).not.toHaveBeenCalled();
	});

	it("moves an ambiguous manual dispatch to visible recovery", async function _manualRecovery()
	{
		const claimed = _row({ state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 3, revision: 5 });
		const recovered = _row({ state: ToolInvocationState.RecoveryRequired, claimKind: null, claimFence: 3, revision: 6 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(recovered), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } } as unknown as Prisma.TransactionClient;
		const result = await new PrismaToolInvocationRepository(transaction).completeAmbiguous({ invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 3, revision: 5 }, new Date("2026-08-11T10:00:01.000Z"));
		expect(result).toEqual({ changed: true, invocation: expect.objectContaining({ state: ToolInvocationStates.RecoveryRequired }) });
		expect(transaction.toolInvocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ run: { is: { attempt: 2, state: AgentRunState.Running } } }) }));
	});

	it("releases a proven pre-dispatch failure under the exact claim fence", async function _releaseBeforeDispatch()
	{
		const claimed = _row({ state: ToolInvocationState.Claimed, claimKind: ExternalActionClaimKind.Dispatch, claimFence: 3, revision: 5, preparationAttempt: 1 });
		const ready = _row({ state: ToolInvocationState.Ready, claimKind: null, claimFence: 3, revision: 6, preparationAttempt: 2 });
		const updateMany = vi.fn().mockResolvedValue({ count: 1 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValueOnce(ready), updateMany } } as unknown as Prisma.TransactionClient;
		const result = await new PrismaToolInvocationRepository(transaction).releaseClaimBeforeDispatch({ invocationId: "invocation-row-1", kind: ExternalActionClaimKinds.Dispatch, fence: 3, revision: 5 }, new Date("2026-08-11T10:00:01.000Z"));
		expect(result.invocation).toEqual(expect.objectContaining({ state: ToolInvocationStates.Ready, preparationAttempt: 2 }));
		expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ claimKind: ExternalActionClaimKind.Dispatch, claimFence: 3, revision: 5 }) }));
	});

	it("recovers an expired reconciliation lease without starting provider dispatch", async function _expiredReconciliation()
	{
		const active = _row({ recoveryMode: ExternalActionRecoveryMode.Reconciliation, state: ToolInvocationState.Reconciling, claimKind: ExternalActionClaimKind.Reconcile, claimFence: 3, claimExpiresAt: new Date("2026-08-11T10:00:00.000Z"), revision: 5 });
		const available = _row({ recoveryMode: ExternalActionRecoveryMode.Reconciliation, state: ToolInvocationState.Reconciling, claimKind: null, claimFence: 3, claimExpiresAt: null, revision: 6 });
		const transaction = { toolInvocation: { findUnique: vi.fn().mockResolvedValueOnce(active).mockResolvedValueOnce(available), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } } as unknown as Prisma.TransactionClient;
		const result = await new PrismaToolInvocationRepository(transaction).recoverExpiredClaim("invocation-row-1", new Date("2026-08-11T10:00:01.000Z"));
		expect(result).toEqual({ changed: true, invocation: expect.objectContaining({ state: ToolInvocationStates.Reconciling, claimKind: null }) });
	});
});
