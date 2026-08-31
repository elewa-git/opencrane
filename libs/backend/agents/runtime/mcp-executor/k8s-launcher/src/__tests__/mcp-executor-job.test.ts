import { describe, expect, it } from "vitest";

import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";

import { __BuildSuspendedMcpExecutorJob } from "../mcp-executor-job";
import type { McpExecutorJobAssignment } from "../mcp-executor-job.types";

/** Builds a valid MCP claim and imported image assignment. */
function _Assignment(): McpExecutorJobAssignment
{
	return { claim: { claimId: "claim-1", siloId: "silo-1", workloadClass: RuntimeWorkloadClaimClasses.McpExecutor, profileName: "mcp-default", idempotencyKey: "invocation-1", claimedAt: "2026-08-26T00:00:00.000Z", deliveryCount: 1, expiresAt: "2026-08-26T00:01:00.000Z", executionReference: "mcp-execution-v1_abcdef" }, registryReference: `registry.internal/opencrane/mcp@sha256:${"a".repeat(64)}`, namespace: "opencrane-mcp" };
}

/** Builds the fixed deployment profile for one MCP executor namespace. */
function _Profile()
{
	return { companionImage: `registry.internal/opencrane/mcp-companion@sha256:${"b".repeat(64)}`, imagePullPolicy: "IfNotPresent" as const, serverNamespace: "opencrane", namespace: "opencrane-mcp", serviceAccountName: "mcp-executor-default", opencraneInternalUrl: "http://opencrane-server.opencrane.svc.cluster.local:8081/api/internal/mcp-executor", projectedTokenTtlSeconds: 600, scratchSize: "64Mi", activeDeadlineSeconds: 300, serverResources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "512Mi" } }, companionResources: { requests: { cpu: "50m", memory: "64Mi" }, limits: { cpu: "200m", memory: "128Mi" } } };
}

/** Trusted controller time while the claim is still current. */
const _NOW = new Date("2026-08-26T00:00:30.000Z");

describe("OCI-backed MCP executor Job", function _DescribeMcpExecutorJob()
{
	it("keeps the uploaded server separate from the companion authority", function _SeparatesAuthority()
	{
		const job = __BuildSuspendedMcpExecutorJob(_Assignment(), _Profile(), _NOW);
		const server = job.spec?.template.spec?.initContainers?.find(container => container.name === "mcp-server");
		const companion = job.spec?.template.spec?.containers.find(container => container.name === "mcp-companion");

		expect(job.spec).toMatchObject({ suspend: true, backoffLimit: 0, completions: 1, parallelism: 1 });
		expect(job.spec?.ttlSecondsAfterFinished).toBeUndefined();
		expect(job.spec?.template.spec).toMatchObject({ automountServiceAccountToken: false, restartPolicy: "Never", serviceAccountName: "mcp-executor-default" });
		expect(server?.image).toBe(_Assignment().registryReference);
		expect(server?.restartPolicy).toBe("Always");
		expect(server?.volumeMounts?.map(mount => mount.name)).toEqual(["server-scratch"]);
		expect(JSON.stringify(server)).not.toContain("executor-token");
		expect(JSON.stringify(server)).not.toContain("mcp-execution-v1_abcdef");
		expect(companion?.volumeMounts?.map(mount => mount.name)).toEqual(["executor-token", "claim-reference", "companion-scratch"]);
		expect(companion?.env).toEqual(expect.arrayContaining([expect.objectContaining({ name: "OPENCRANE_MCP_SERVER_URL", value: "http://127.0.0.1:3000/mcp" })]));
	});

	it("rejects mutable images, foreign namespaces, wrong identities, and stale leases", function _RejectsWidening()
	{
		expect(function _MutableServer() { __BuildSuspendedMcpExecutorJob({ ..._Assignment(), registryReference: "registry.internal/opencrane/mcp:latest" }, _Profile(), _NOW); }).toThrow(/immutable imported image/);
		expect(function _MutableCompanion() { __BuildSuspendedMcpExecutorJob(_Assignment(), { ..._Profile(), companionImage: "registry.internal/opencrane/companion:latest" }, _NOW); }).toThrow(/immutable companion image/);
		expect(function _ForeignNamespace() { __BuildSuspendedMcpExecutorJob({ ..._Assignment(), namespace: "other" }, _Profile(), _NOW); }).toThrow(/deployment-owned namespace/);
		expect(function _WrongIdentity() { __BuildSuspendedMcpExecutorJob(_Assignment(), { ..._Profile(), serviceAccountName: "agent-runtime" }, _NOW); }).toThrow(/fixed identity/);
		expect(function _StaleLease() { __BuildSuspendedMcpExecutorJob({ ..._Assignment(), claim: { ..._Assignment().claim, expiresAt: _Assignment().claim.claimedAt } }, _Profile(), _NOW); }).toThrow(/current MCP claim/);
		expect(function _ExpiredLease() { __BuildSuspendedMcpExecutorJob(_Assignment(), _Profile(), new Date("2026-08-26T00:02:00.000Z")); }).toThrow(/current MCP claim/);
		expect(function _WrongServer() { __BuildSuspendedMcpExecutorJob(_Assignment(), { ..._Profile(), opencraneInternalUrl: "http://attacker.other.svc.cluster.local:8081/api/internal/mcp-executor" }, _NOW); }).toThrow(/fixed identity and endpoint/);
		expect(function _UnboundedCpu() { __BuildSuspendedMcpExecutorJob(_Assignment(), { ..._Profile(), serverResources: { requests: { cpu: "100", memory: "128Mi" }, limits: { cpu: "1m", memory: "512Mi" } } }, _NOW); }).toThrow(/bounded resources/);
	});

	it("rebuilds the same suspended Job after a database claim delivery expires", function _KeepsAssignmentIdentityStable()
	{
		const first = __BuildSuspendedMcpExecutorJob(_Assignment(), _Profile(), _NOW);
		const retry = { ..._Assignment(), claim: { ..._Assignment().claim, claimedAt: "2026-08-26T00:01:30.000Z", deliveryCount: 2, expiresAt: "2026-08-26T00:02:30.000Z" } };
		const second = __BuildSuspendedMcpExecutorJob(retry, _Profile(), new Date("2026-08-26T00:02:00.000Z"));

		expect(second).toEqual(first);
		expect(second.metadata?.annotations).not.toHaveProperty("opencrane.ai/mcp-delivery-count");
	});
});
