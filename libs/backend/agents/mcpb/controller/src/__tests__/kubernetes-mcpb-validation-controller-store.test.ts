import type { V1Job } from "@kubernetes/client-node";
import { describe, expect, it } from "vitest";

import { __BuildMcpbValidatorJob } from "@opencrane/backend/server/gateways/mcp/validator-k8s-launcher";
import { __CreateMcpbValidatorBootstrapReference } from "@opencrane/contracts";

import { __CreateKubernetesMcpbValidationControllerStore } from "../kubernetes-mcpb-validation-controller-store";
import type { McpbValidationControllerBatchApi } from "../mcpb-validation-controller.types";

/** Build the fixed Job expected by the MCP bundle controller. */
function _Job(): V1Job
{
	return __BuildMcpbValidatorJob({ validationId: "validation-1", siloId: "silo-1", namespace: "opencrane-mcpb-validation", bootstrapReference: __CreateMcpbValidatorBootstrapReference("workload-1") }, { image: `ghcr.io/elewa-git/opencrane-mcpb-validator@sha256:${"a".repeat(64)}`, imagePullPolicy: "IfNotPresent", serverNamespace: "opencrane", namespace: "opencrane-mcpb-validation", serviceAccountName: "mcpb-validator-default", tokenAudience: "opencrane-mcpb-validator", bootstrapUrl: "http://opencrane-server.opencrane.svc.cluster.local:8081/api/internal/mcpb-validator", tokenPath: "/var/run/opencrane/tokens/validator.token", bootstrapReferencePath: "/var/run/opencrane/bootstrap/reference", scratchSize: "128Mi", activeDeadlineSeconds: 300, ttlSecondsAfterFinished: 0, resources: { requests: { cpu: "250m", memory: "256Mi" }, limits: { cpu: "1", memory: "1Gi" } } });
}

/** Return an AlreadyExists error from a fake Kubernetes API. */
function _Conflict(): Error & { statusCode: number }
{
	return Object.assign(new Error("already exists"), { statusCode: 409 });
}

/** Add the controller labels and selector Kubernetes adds after accepting a Job. */
function _KubernetesJob(job: V1Job): V1Job
{
	const uid = "job-uid-1";
	const name = job.metadata?.name;
	if (!name)
	{
		throw new Error("expected test Job name");
	}
	const generatedLabels = { "batch.kubernetes.io/controller-uid": uid, "batch.kubernetes.io/job-name": name, "controller-uid": uid, "job-name": name };
	const generatedSelector = { "batch.kubernetes.io/controller-uid": uid };
	const labels = { ...job.spec?.template.metadata?.labels, ...generatedLabels };
	return { ...job, metadata: { ...job.metadata, uid }, spec: { ...job.spec!, selector: { matchLabels: generatedSelector }, template: { ...job.spec!.template, metadata: { ...job.spec!.template.metadata, labels } } } };
}

describe("MCP bundle validation Kubernetes store", function _McpbValidationStoreSuite()
{
	it("accepts the Kubernetes-generated Job selectors on a newly created suspended Job", async function _Creates()
	{
		const expected = _Job();
		const batchApi: McpbValidationControllerBatchApi = { async createNamespacedJob() { return _KubernetesJob(expected); }, async readNamespacedJob() { throw new Error("unexpected read"); } };
		const store = __CreateKubernetesMcpbValidationControllerStore({ batchApi, requestTimeoutMilliseconds: 1_000, shutdownSignal: new AbortController().signal });

		expect((await store.__EnsureSuspendedJob(expected)).metadata?.uid).toBe("job-uid-1");
	});

	it("adopts only the matching Kubernetes-generated Job after a create conflict", async function _Adopts()
	{
		const expected = _Job();
		const batchApi: McpbValidationControllerBatchApi = { async createNamespacedJob() { throw _Conflict(); }, async readNamespacedJob() { return _KubernetesJob(expected); } };
		const store = __CreateKubernetesMcpbValidationControllerStore({ batchApi, requestTimeoutMilliseconds: 1_000, shutdownSignal: new AbortController().signal });

		expect((await store.__EnsureSuspendedJob(expected)).metadata?.uid).toBe("job-uid-1");
	});
});
