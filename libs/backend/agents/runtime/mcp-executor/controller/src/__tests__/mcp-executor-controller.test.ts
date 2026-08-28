import { describe, expect, it, vi } from "vitest";

import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import { ___CreateLogger } from "@opencrane/backend/observability";

import { __ReconcileNextMcpExecutorRelease, __ReconcileNextMcpExecutorWorkload } from "../mcp-executor-controller";
import type { McpExecutorControllerAuthority, McpExecutorControllerOptions } from "../mcp-executor-controller.types";

/** Returns one valid MCP workload claim and imported image. */
function _Claim()
{
	return { claim: { claimId: "claim-1", siloId: "silo-a", workloadClass: RuntimeWorkloadClaimClasses.McpExecutor, profileName: "mcp-isolated", idempotencyKey: "mcp:server-1", claimedAt: "2026-08-26T00:00:00.000Z", deliveryCount: 1, expiresAt: "2099-08-26T00:01:00.000Z", executionReference: "execution-1" }, registryReference: `registry.example.test/opencrane/mcp@sha256:${"a".repeat(64)}` } as const;
}

/** Returns the fixed deployment profile used by controller tests. */
function _Profile()
{
	return { companionImage: `ghcr.io/elewa-git/opencrane-mcp-executor@sha256:${"b".repeat(64)}`, imagePullPolicy: "IfNotPresent" as const, serverNamespace: "silo-a", namespace: "opencrane-mcp-executor", serviceAccountName: "mcp-executor-default", opencraneInternalUrl: "http://opencrane-server.silo-a.svc.cluster.local:3001/api/internal/mcp-executor", projectedTokenTtlSeconds: 600, scratchSize: "64Mi", activeDeadlineSeconds: 600, serverResources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "512Mi" } }, companionResources: { requests: { cpu: "25m", memory: "64Mi" }, limits: { cpu: "250m", memory: "128Mi" } } };
}

/** Builds options around authority and Kubernetes doubles. */
function _Options(authority: McpExecutorControllerAuthority, kubernetes: McpExecutorControllerOptions["kubernetes"]): McpExecutorControllerOptions
{
	return { authority, kubernetes, profile: _Profile(), pollIntervalMilliseconds: 100, log: ___CreateLogger("mcp-controller-test", { destination: 2, level: "silent", pretty: false }) };
}

describe("MCP executor controller", function _DescribeController()
{
	it("records the Kubernetes Job UID before any release", async function _AssignsSuspendedJob()
	{
		const authority = { __Claim: vi.fn().mockResolvedValue(_Claim()), __CommitAssignment: vi.fn().mockResolvedValue("assigned"), __ClaimRelease: vi.fn(), __CommitRelease: vi.fn(), __RegisterFirstPod: vi.fn() } satisfies McpExecutorControllerAuthority;
		const kubernetes = { ensureSuspendedJob: vi.fn().mockResolvedValue({ metadata: { uid: "job-uid-1" } }), releaseJob: vi.fn(), findFirstPod: vi.fn(), deleteJob: vi.fn() };

		await expect(__ReconcileNextMcpExecutorWorkload(_Options(authority, kubernetes), new AbortController().signal)).resolves.toMatchObject({ outcome: "assigned", workloadUid: "job-uid-1" });
		expect(authority.__CommitAssignment).toHaveBeenCalledWith(expect.objectContaining({ claimId: "claim-1", deliveryCount: 1, workloadUid: "job-uid-1" }), expect.any(AbortSignal));
		expect(kubernetes.ensureSuspendedJob).toHaveBeenCalledWith(expect.objectContaining({ spec: expect.objectContaining({ suspend: true }) }));
	});

	it("releases the saved UID and records the first owned Pod", async function _ReleasesAndRegisters()
	{
		const expiredAssignment = { ..._Claim(), claim: { ..._Claim().claim, expiresAt: "2026-08-26T00:01:00.000Z" } };
		const release = { ...expiredAssignment, workloadUid: "job-uid-1", releaseClaimedAt: "2026-08-26T00:00:10.000Z", releaseDeliveryCount: 2, releaseExpiresAt: "2099-08-26T00:02:00.000Z" };
		const authority = { __Claim: vi.fn(), __CommitAssignment: vi.fn(), __ClaimRelease: vi.fn().mockResolvedValue(release), __CommitRelease: vi.fn().mockResolvedValue("released"), __RegisterFirstPod: vi.fn().mockResolvedValue("registered") } satisfies McpExecutorControllerAuthority;
		const kubernetes = { ensureSuspendedJob: vi.fn(), releaseJob: vi.fn().mockResolvedValue(undefined), findFirstPod: vi.fn().mockResolvedValue({ metadata: { uid: "pod-uid-1" } }), deleteJob: vi.fn() };

		await expect(__ReconcileNextMcpExecutorRelease(_Options(authority, kubernetes), new AbortController().signal)).resolves.toMatchObject({ outcome: "registered", podUid: "pod-uid-1" });
		expect(kubernetes.releaseJob).toHaveBeenCalledWith(expect.anything(), "job-uid-1", release.releaseExpiresAt);
		expect(authority.__RegisterFirstPod).toHaveBeenCalledWith("claim-1", expect.objectContaining({ workloadUid: "job-uid-1", podUid: "pod-uid-1", releaseDeliveryCount: 2 }), expect.any(AbortSignal));
	});

	it("does not invent a Pod while Kubernetes has not exposed one", async function _WaitsForPod()
	{
		const authority = { __Claim: vi.fn(), __CommitAssignment: vi.fn(), __ClaimRelease: vi.fn().mockResolvedValue({ ..._Claim(), workloadUid: "job-uid-1", releaseClaimedAt: "2026-08-26T00:00:10.000Z", releaseDeliveryCount: 2, releaseExpiresAt: "2099-08-26T00:02:00.000Z" }), __CommitRelease: vi.fn().mockResolvedValue("idempotent"), __RegisterFirstPod: vi.fn() } satisfies McpExecutorControllerAuthority;
		const kubernetes = { ensureSuspendedJob: vi.fn(), releaseJob: vi.fn().mockResolvedValue(undefined), findFirstPod: vi.fn().mockResolvedValue(null), deleteJob: vi.fn() };

		await expect(__ReconcileNextMcpExecutorRelease(_Options(authority, kubernetes), new AbortController().signal)).resolves.toMatchObject({ outcome: "pending-pod" });
		expect(authority.__RegisterFirstPod).not.toHaveBeenCalled();
	});
});
