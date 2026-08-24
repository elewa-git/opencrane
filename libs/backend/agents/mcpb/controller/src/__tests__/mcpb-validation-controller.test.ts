import { describe, expect, it, vi } from "vitest";

import { __ReconcileNextMcpbValidation } from "../mcpb-validation-controller";
import { McpbValidationControllerReconcileOutcomes, type McpbValidationControllerOptions } from "../mcpb-validation-controller.types";

/** Return the fixed validator profile that the restricted Job builder accepts. */
function _Profile()
{
	return { image: `ghcr.io/elewa-git/opencrane-mcpb-validator@sha256:${"a".repeat(64)}`, imagePullPolicy: "IfNotPresent" as const, serverNamespace: "opencrane", namespace: "opencrane-mcpb-validation", serviceAccountName: "mcpb-validator-default", tokenAudience: "opencrane-mcpb-validator", bootstrapUrl: "http://opencrane-server.opencrane.svc.cluster.local:8081/api/internal/mcpb-validator", tokenPath: "/var/run/opencrane/tokens/validator.token", bootstrapReferencePath: "/var/run/opencrane/bootstrap/reference", scratchSize: "128Mi", activeDeadlineSeconds: 300, ttlSecondsAfterFinished: 0, resources: { requests: { cpu: "250m", memory: "256Mi" }, limits: { cpu: "1", memory: "1Gi" } } };
}

/** Return one database-fenced MCP bundle inspection claim. */
function _Claim()
{
	return { workloadId: "workload-1", siloId: "silo-1", validationId: "validation-1", claimedAt: "2026-08-25T00:00:00.000Z", deliveryCount: 1, expiresAt: "2026-08-25T00:01:00.000Z" };
}

/** Build a controller pass with replaceable server and Kubernetes behavior. */
function _Options(overrides: Partial<McpbValidationControllerOptions> = {}): McpbValidationControllerOptions
{
	return {
		authority: { __Claim: vi.fn().mockResolvedValue(_Claim()), __CommitAssignment: vi.fn().mockResolvedValue("assigned") },
		kubernetes: { __EnsureSuspendedJob: vi.fn().mockResolvedValue({ metadata: { uid: "job-uid-1" } }) },
		profile: _Profile(),
		pollIntervalMilliseconds: 1_000,
		log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn(), child: vi.fn() } as never,
		...overrides,
	};
}

describe("MCP bundle validation controller", function _McpbValidationControllerSuite()
{
	it("creates one suspended validator Job and commits its Kubernetes UID under the same claim", async function _AssignsValidatorJob()
	{
		const options = _Options();

		const result = await __ReconcileNextMcpbValidation(options, new AbortController().signal);

		expect(result).toEqual({ outcome: McpbValidationControllerReconcileOutcomes.Assigned, workloadId: "workload-1", workloadUid: "job-uid-1" });
		expect(options.kubernetes.__EnsureSuspendedJob).toHaveBeenCalledWith(expect.objectContaining({ spec: expect.objectContaining({ suspend: true }), metadata: expect.objectContaining({ namespace: "opencrane-mcpb-validation" }) }));
		expect(options.authority.__CommitAssignment).toHaveBeenCalledWith("workload-1", { claimedAt: _Claim().claimedAt, deliveryCount: 1, workloadUid: "job-uid-1" }, expect.any(AbortSignal));
	});

	it("does not create a Job when the server has no pending inspection work", async function _RemainsIdle()
	{
		const options = _Options({ authority: { __Claim: vi.fn().mockResolvedValue(null), __CommitAssignment: vi.fn() } });

		await expect(__ReconcileNextMcpbValidation(options, new AbortController().signal)).resolves.toEqual({ outcome: McpbValidationControllerReconcileOutcomes.Idle });
		expect(options.kubernetes.__EnsureSuspendedJob).not.toHaveBeenCalled();
	});

	it("fails when the database rejects the claim after the Job was created", async function _RejectsStaleClaim()
	{
		const options = _Options({ authority: { __Claim: vi.fn().mockResolvedValue(_Claim()), __CommitAssignment: vi.fn().mockResolvedValue("conflict") } });

		await expect(__ReconcileNextMcpbValidation(options, new AbortController().signal)).rejects.toThrow("lost its database claim");
	});
});
