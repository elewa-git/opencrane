import { McpApprovalStatus, McpExecutorCommandState, McpExecutorWorkloadState, McpRuntimeExecutionKind, McpServerRevisionState, McpServerStatus, McpServerTransport, OciImageValidationState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ExternalActionRecoveryModes, ToolInvocationStates } from "@opencrane/backend/server/iam/authorization";

import { PrismaMcpRuntimeCompanionRepository } from "../prisma-mcp-runtime-companion-repository";
import { PrismaMcpRuntimeControllerRepository } from "../prisma-mcp-runtime-controller-repository";
import { PrismaMcpOciServerPromotionRepository } from "../prisma-mcp-oci-server-promotion-repository";
import { PrismaMcpToolInvocationAdmissionRepository } from "../prisma-mcp-tool-invocation-admission-repository";

/** Fixed runtime settings used by transaction-scoped repository tests. */
function _Options()
{
	return { siloId: "silo-1", executorNamespace: "mcp-executors", executorServiceAccountName: "mcp-executor-default", profileName: "mcp-default", controllerClaimLeaseMilliseconds: 30_000, companionClaimLeaseMilliseconds: 60_000, log: { info: vi.fn() } as never };
}

describe("Prisma MCP runtime repositories", function _DescribePrismaMcpRuntimeRepositories()
{
	it("promotes an imported image into one immutable discovery execution", async function _PromotesImportedImage()
	{
		const transaction = {
			ociImageValidation: { findFirst: vi.fn().mockResolvedValue({ id: "validation-1", siloId: "silo-1", state: OciImageValidationState.Imported, registryReference: `registry.test/mcp/image@sha256:${"a".repeat(64)}` }) },
			mcpServerRevision: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "revision-1" }) },
			mcpServer: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "server-1" }) },
			mcpRuntimeExecution: { create: vi.fn().mockResolvedValue({ id: "execution-1" }) },
			auditEntry: { create: vi.fn().mockResolvedValue({ id: 1 }) },
		};
		const repository = new PrismaMcpOciServerPromotionRepository(transaction as never, _Options());

		await expect(repository.promoteImportedValidation({ siloId: "silo-1", principalId: "principal-1" }, "validation-1", { name: "Search", description: "Search records" })).resolves.toMatchObject({ outcome: "created", serverId: "server-1", serverRevisionId: "revision-1" });
		expect(transaction.mcpServer.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ transport: McpServerTransport.OciImage, status: McpServerStatus.Draft }) }));
		expect(transaction.mcpRuntimeExecution.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: McpRuntimeExecutionKind.Discovery, profileName: "mcp-default" }) }));
	});

	it("admits only a ready manual-recovery ToolInvocation selected by a ready MCP tool revision", async function _AdmitsReadyInvocation()
	{
		const invocation = { id: "invocation-row-1", siloId: "silo-1", toolRevisionId: "tool-1", state: ToolInvocationStates.Ready, recoveryMode: ExternalActionRecoveryModes.Manual };
		const transaction = {
			mcpRuntimeExecution: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "execution-1" }) },
			mcpToolRevision: { findFirst: vi.fn().mockResolvedValue({ serverRevisionId: "revision-1", serverRevision: { state: McpServerRevisionState.Ready, server: { status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published } } }) },
		};
		const toolInvocations = { findById: vi.fn().mockResolvedValue(invocation), claim: vi.fn(), completeSucceeded: vi.fn(), completeFailed: vi.fn(), completeAmbiguous: vi.fn() };
		const repository = new PrismaMcpToolInvocationAdmissionRepository(transaction as never, toolInvocations as never, _Options());

		await expect(repository.admitInvocation("invocation-row-1")).resolves.toBe("admitted");
		expect(transaction.mcpRuntimeExecution.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ toolInvocationId: "invocation-row-1", kind: McpRuntimeExecutionKind.Invocation }) }));
	});

	it("rejects an MCP invocation after its catalogue server is disabled", async function _RejectsDisabledServer()
	{
		const invocation = { id: "invocation-row-1", siloId: "silo-1", toolRevisionId: "tool-1", state: ToolInvocationStates.Ready, recoveryMode: ExternalActionRecoveryModes.Manual };
		const transaction = {
			mcpRuntimeExecution: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
			mcpToolRevision: { findFirst: vi.fn().mockResolvedValue({ serverRevisionId: "revision-1", serverRevision: { state: McpServerRevisionState.Ready, server: { status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Disabled } } }) },
		};
		const toolInvocations = { findById: vi.fn().mockResolvedValue(invocation), claim: vi.fn(), completeSucceeded: vi.fn(), completeFailed: vi.fn(), completeAmbiguous: vi.fn() };
		const repository = new PrismaMcpToolInvocationAdmissionRepository(transaction as never, toolInvocations as never, _Options());

		await expect(repository.admitInvocation("invocation-row-1")).resolves.toBe("not_ready");
		expect(transaction.mcpRuntimeExecution.create).not.toHaveBeenCalled();
	});

	it("returns a database-fenced controller claim with the immutable imported image", async function _ClaimsForController()
	{
		const claimedAt = new Date("2026-08-26T00:00:00.000Z");
		const claimExpiresAt = new Date("2026-08-26T00:00:30.000Z");
		const execution = { id: "execution-1", siloId: "silo-1", workloadState: McpExecutorWorkloadState.Pending, commandState: McpExecutorCommandState.Failed, profileName: "mcp-default", idempotencyKey: "key-1", executionReference: "reference-1", claimedAt: null, claimExpiresAt: null, deliveryCount: 0, serverRevision: { registryReference: `registry.test/mcp/image@sha256:${"a".repeat(64)}` } };
		const transaction = {
			mcpRuntimeClaimCandidate: { findFirst: vi.fn().mockResolvedValue({ id: "execution-1" }) },
			mcpRuntimeExecution: { findFirst: vi.fn().mockResolvedValue(execution), updateManyAndReturn: vi.fn().mockResolvedValue([{ claimedAt, claimExpiresAt }]) },
		};
		const repository = new PrismaMcpRuntimeControllerRepository(transaction as never, _Options());

		await expect(repository.claimNext()).resolves.toMatchObject({ claim: { claimId: "execution-1", deliveryCount: 1, claimedAt: claimedAt.toISOString(), expiresAt: claimExpiresAt.toISOString() }, registryReference: execution.serverRevision.registryReference });
	});

	it("binds a late suspended Job UID while keeping an exhausted execution closed", async function _BindsTerminalAssignment()
	{
		const claimedAt = new Date("2026-08-26T00:00:00.000Z");
		const execution = { id: "execution-1", siloId: "silo-1", workloadState: McpExecutorWorkloadState.Pending, commandState: McpExecutorCommandState.Failed, profileName: "mcp-default", claimedAt, claimExpiresAt: new Date("2099-08-26T00:00:30.000Z"), deliveryCount: 1, workloadUid: null };
		const transaction = {
			mcpRuntimeClock: { findUnique: vi.fn().mockResolvedValue({ singleton: 1, now: new Date("2026-08-26T00:00:10.000Z") }) },
			mcpRuntimeExecution: { findFirst: vi.fn().mockResolvedValue(execution), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		};
		const repository = new PrismaMcpRuntimeControllerRepository(transaction as never, _Options());

		await expect(repository.commitAssignment({ claimId: execution.id, claimedAt: claimedAt.toISOString(), deliveryCount: 1, profileName: "mcp-default", workloadUid: "job-uid-1" })).resolves.toBe("assigned");
		expect(transaction.mcpRuntimeExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ commandState: McpExecutorCommandState.Failed, workloadUid: null }), data: expect.objectContaining({ workloadState: McpExecutorWorkloadState.Closed, workloadUid: "job-uid-1" }) }));
	});

	it("reclaims a released Job until Kubernetes exposes its first Pod", async function _ReclaimsReleasedJob()
	{
		const releaseClaimedAt = new Date("2026-08-26T00:01:00.000Z");
		const releaseExpiresAt = new Date("2026-08-26T00:01:30.000Z");
		const execution = { id: "execution-1", siloId: "silo-1", workloadState: McpExecutorWorkloadState.Released, profileName: "mcp-default", idempotencyKey: "key-1", executionReference: "reference-1", claimedAt: new Date("2026-08-26T00:00:00.000Z"), claimExpiresAt: new Date("2026-08-26T00:00:30.000Z"), deliveryCount: 1, workloadUid: "job-1", podUid: null, releaseClaimedAt: new Date("2026-08-26T00:00:30.000Z"), releaseExpiresAt: new Date("2026-08-26T00:01:00.000Z"), releaseDeliveryCount: 1, serverRevision: { registryReference: `registry.test/mcp/image@sha256:${"a".repeat(64)}` } };
		const transaction = {
			mcpRuntimeReleaseClaimCandidate: { findFirst: vi.fn().mockResolvedValue({ id: execution.id }) },
			mcpRuntimeExecution: { findFirst: vi.fn().mockResolvedValue(execution), updateManyAndReturn: vi.fn().mockResolvedValue([{ releaseClaimedAt, releaseExpiresAt }]) },
		};
		const repository = new PrismaMcpRuntimeControllerRepository(transaction as never, _Options());

		await expect(repository.claimNextRelease()).resolves.toMatchObject({ workloadUid: "job-1", releaseDeliveryCount: 2, releaseClaimedAt: releaseClaimedAt.toISOString() });
		expect(transaction.mcpRuntimeExecution.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workloadState: McpExecutorWorkloadState.Released, podUid: null }) }));
	});

	it("claims a closed terminal execution until its exact Job is deleted", async function _ClaimsCleanup()
	{
		const cleanupClaimedAt = new Date("2026-08-26T00:02:00.000Z");
		const cleanupExpiresAt = new Date("2026-08-26T00:02:30.000Z");
		const execution = { id: "execution-1", siloId: "silo-1", workloadState: McpExecutorWorkloadState.Closed, commandState: McpExecutorCommandState.Failed, profileName: "mcp-default", idempotencyKey: "key-1", executionReference: "reference-1", claimedAt: new Date("2026-08-26T00:00:00.000Z"), claimExpiresAt: new Date("2026-08-26T00:00:30.000Z"), deliveryCount: 1, workloadUid: "job-1", cleanupCompletedAt: null, cleanupClaimedAt: new Date("2026-08-26T00:01:00.000Z"), cleanupExpiresAt: new Date("2026-08-26T00:01:30.000Z"), cleanupDeliveryCount: 1, createdAt: new Date("2026-08-26T00:00:00.000Z"), serverRevision: { registryReference: `registry.test/mcp/image@sha256:${"a".repeat(64)}` } };
		const transaction = {
			mcpRuntimeClock: { findUnique: vi.fn().mockResolvedValue({ singleton: 1, now: new Date("2026-08-26T00:01:31.000Z") }) },
			mcpRuntimeExecution: { findFirst: vi.fn().mockResolvedValue(execution), updateManyAndReturn: vi.fn().mockResolvedValue([{ cleanupClaimedAt, cleanupExpiresAt }]) },
		};
		const repository = new PrismaMcpRuntimeControllerRepository(transaction as never, _Options());

		await expect(repository.claimNextCleanup()).resolves.toMatchObject({ workloadUid: "job-1", cleanupDeliveryCount: 2, cleanupClaimedAt: cleanupClaimedAt.toISOString() });
		expect(transaction.mcpRuntimeExecution.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workloadState: McpExecutorWorkloadState.Closed, cleanupCompletedAt: null, workloadUid: { not: null } }) }));
	});

	it("records cleanup only under the current Job UID and delivery fence", async function _CommitsCleanup()
	{
		const cleanupClaimedAt = new Date("2026-08-26T00:02:00.000Z");
		const execution = { id: "execution-1", siloId: "silo-1", workloadState: McpExecutorWorkloadState.Closed, commandState: McpExecutorCommandState.Succeeded, workloadUid: "job-1", cleanupCompletedAt: null, cleanupClaimedAt, cleanupExpiresAt: new Date("2026-08-26T00:02:30.000Z"), cleanupDeliveryCount: 2 };
		const transaction = {
			mcpRuntimeClock: { findUnique: vi.fn().mockResolvedValue({ singleton: 1, now: new Date("2026-08-26T00:02:10.000Z") }) },
			mcpRuntimeExecution: { findFirst: vi.fn().mockResolvedValue(execution), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		};
		const repository = new PrismaMcpRuntimeControllerRepository(transaction as never, _Options());

		await expect(repository.commitCleanup("execution-1", { cleanupClaimedAt: cleanupClaimedAt.toISOString(), cleanupDeliveryCount: 2, workloadUid: "job-1" })).resolves.toBe("cleaned");
		expect(transaction.mcpRuntimeExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ cleanupCompletedAt: null, cleanupDeliveryCount: 2, workloadUid: "job-1" }), data: expect.objectContaining({ cleanupCompletedAt: expect.any(Date) }) }));
	});

	it("rejects stale cleanup evidence and does not rewrite completed cleanup", async function _RejectsStaleCleanup()
	{
		const completedAt = new Date("2026-08-26T00:02:05.000Z");
		const execution = { id: "execution-1", siloId: "silo-1", workloadState: McpExecutorWorkloadState.Closed, commandState: McpExecutorCommandState.Failed, workloadUid: "job-1", cleanupCompletedAt: completedAt, cleanupClaimedAt: new Date("2026-08-26T00:02:00.000Z"), cleanupExpiresAt: new Date("2026-08-26T00:02:30.000Z"), cleanupDeliveryCount: 2 };
		const transaction = { mcpRuntimeExecution: { findFirst: vi.fn().mockResolvedValue(execution), updateMany: vi.fn() } };
		const repository = new PrismaMcpRuntimeControllerRepository(transaction as never, _Options());

		await expect(repository.commitCleanup("execution-1", { cleanupClaimedAt: "2026-08-26T00:01:00.000Z", cleanupDeliveryCount: 1, workloadUid: "job-1" })).resolves.toBe("idempotent");
		expect(transaction.mcpRuntimeExecution.updateMany).not.toHaveBeenCalled();
	});

	it("claims discovery only for the registered TokenReview-confirmed Pod", async function _ClaimsForCompanion()
	{
		const expiry = new Date("2026-08-26T00:01:00.000Z");
		const execution = { id: "execution-1", siloId: "silo-1", kind: McpRuntimeExecutionKind.Discovery, workloadState: McpExecutorWorkloadState.Registered, commandState: McpExecutorCommandState.Pending, podUid: "pod-1", companionClaimFence: null, companionClaimExpiresAt: null, toolInvocationId: null, serverRevision: { tools: [] } };
		const transaction = {
			mcpRuntimeExecution: { findFirst: vi.fn().mockResolvedValue(execution), updateManyAndReturn: vi.fn().mockResolvedValue([{ companionClaimExpiresAt: expiry }]) },
			mcpRuntimeClock: { findUnique: vi.fn().mockResolvedValue({ singleton: 1, now: new Date("2026-08-26T00:00:00.000Z") }) },
		};
		const toolInvocations = { findById: vi.fn(), claim: vi.fn(), completeSucceeded: vi.fn(), completeFailed: vi.fn(), completeAmbiguous: vi.fn() };
		const repository = new PrismaMcpRuntimeCompanionRepository(transaction as never, toolInvocations as never, _Options());

		await expect(repository.claim({ subject: "system:serviceaccount:mcp-executors:mcp-executor-default", namespace: "mcp-executors", serviceAccountName: "mcp-executor-default", podUid: "pod-1" }, "reference-1")).resolves.toMatchObject({ kind: "discovery", executionId: "execution-1", expiresAt: expiry.toISOString() });
	});

	it("recovers an expired invocation without another companion Pod claim", async function _RecoversExpiredInvocation()
	{
		const now = new Date("2026-08-26T00:02:00.000Z");
		const execution = { id: "execution-1", siloId: "silo-1", profileName: "mcp-default", kind: McpRuntimeExecutionKind.Invocation, workloadState: McpExecutorWorkloadState.Registered, commandState: McpExecutorCommandState.Claimed, toolInvocationId: "invocation-1", toolInvocationClaimFence: "tool-fence-1", toolInvocationClaimRevision: 3, companionClaimExpiresAt: new Date("2026-08-26T00:01:00.000Z"), serverRevision: { mcpServerId: "server-1" } };
		const transaction = {
			mcpRuntimeClock: { findUnique: vi.fn().mockResolvedValue({ singleton: 1, now }) },
			mcpRuntimeExecution: { findFirst: vi.fn().mockResolvedValue(execution), update: vi.fn().mockResolvedValue({ id: execution.id }) },
		};
		const toolInvocations = { findById: vi.fn(), claim: vi.fn(), completeSucceeded: vi.fn(), completeFailed: vi.fn(), completeAmbiguous: vi.fn().mockResolvedValue({ state: ToolInvocationStates.RecoveryRequired }) };
		const repository = new PrismaMcpRuntimeCompanionRepository(transaction as never, toolInvocations as never, _Options());

		await expect(repository.recoverNextExpiredInvocation()).resolves.toBe(true);
		expect(toolInvocations.completeAmbiguous).toHaveBeenCalledWith(expect.objectContaining({ invocationId: "invocation-1", fence: "tool-fence-1", revision: 3 }), now);
		expect(transaction.mcpRuntimeExecution.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ commandState: McpExecutorCommandState.RecoveryRequired, workloadState: McpExecutorWorkloadState.Closed }) }));
	});

	it("closes MCP work when cancellation wins before the companion claim", async function _ClosesCancelledInvocation()
	{
		const execution = { id: "execution-1", siloId: "silo-1", profileName: "mcp-default", kind: McpRuntimeExecutionKind.Invocation, workloadState: McpExecutorWorkloadState.Registered, commandState: McpExecutorCommandState.Pending, podUid: "pod-1", toolInvocationId: "invocation-1", companionClaimFence: null, companionClaimExpiresAt: null, serverRevision: { tools: [] } };
		const transaction = {
			mcpRuntimeClock: { findUnique: vi.fn().mockResolvedValue({ singleton: 1, now: new Date("2026-08-26T00:00:00.000Z") }) },
			mcpRuntimeExecution: { findFirst: vi.fn().mockResolvedValue(execution), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
		};
		const toolInvocations = { findById: vi.fn(), claim: vi.fn().mockResolvedValue({ outcome: "winner", invocation: { state: ToolInvocationStates.Failed } }), completeSucceeded: vi.fn(), completeFailed: vi.fn(), completeAmbiguous: vi.fn() };
		const repository = new PrismaMcpRuntimeCompanionRepository(transaction as never, toolInvocations as never, _Options());

		await expect(repository.claim({ subject: "system:serviceaccount:mcp-executors:mcp-executor-default", namespace: "mcp-executors", serviceAccountName: "mcp-executor-default", podUid: "pod-1" }, "reference-1")).resolves.toBe("terminal");
		expect(transaction.mcpRuntimeExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ commandState: McpExecutorCommandState.Failed, workloadState: McpExecutorWorkloadState.Closed }) }));
	});
});
