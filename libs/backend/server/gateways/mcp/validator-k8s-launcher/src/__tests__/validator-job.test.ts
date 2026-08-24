import { describe, expect, it } from "vitest";

import { __BuildMcpbValidatorJob } from "../validator-job";

/** Return one deployment-owned validator profile. */
function _Profile()
{
	return { image: `ghcr.io/elewa-git/opencrane-mcpb-validator@sha256:${"a".repeat(64)}`, imagePullPolicy: "IfNotPresent" as const, serverNamespace: "opencrane", namespace: "opencrane-mcpb-validation", serviceAccountName: "mcpb-validator-default", tokenAudience: "opencrane-mcpb-validator", bootstrapUrl: "http://opencrane-server.opencrane.svc.cluster.local:8081/api/internal/mcpb-validator", tokenPath: "/var/run/opencrane/tokens/validator.token", bootstrapReferencePath: "/var/run/opencrane/bootstrap/reference", scratchSize: "128Mi", activeDeadlineSeconds: 300, ttlSecondsAfterFinished: 0, resources: { requests: { cpu: "250m", memory: "256Mi" }, limits: { cpu: "1", memory: "1Gi" } } };
}

/** Return opaque controller-owned coordinates for one validation. */
function _Assignment()
{
	return { validationId: "validation-1", siloId: "silo-1", namespace: "opencrane-mcpb-validation", bootstrapReference: `mcpb-validator-v1_${"b".repeat(64)}` };
}

describe("MCP bundle validator Job", function _McpbValidatorJobSuite()
{
	it("is suspended, one-shot, restricted, and free of artifact coordinates", function _BuildsRestrictedJob()
	{
		const job = __BuildMcpbValidatorJob(_Assignment(), _Profile());
		expect(job.spec).toMatchObject({ suspend: true, backoffLimit: 0, completions: 1, parallelism: 1, ttlSecondsAfterFinished: 0 });
		expect(job.spec?.template.spec).toMatchObject({ automountServiceAccountToken: false, restartPolicy: "Never", serviceAccountName: "mcpb-validator-default", securityContext: { runAsNonRoot: true } });
		expect(job.spec?.template.spec?.containers[0]?.securityContext).toMatchObject({ allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] } });
		expect(JSON.stringify(job)).not.toContain("artifactRevisionId");
		expect(JSON.stringify(job)).not.toContain("contentAddress");
		expect(job.spec?.template.spec?.containers[0]?.env).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "OPENCRANE_MCPB_BOOTSTRAP_REFERENCE", value: expect.any(String) })]));
		expect(job.spec?.template.spec?.volumes).toEqual(expect.arrayContaining([expect.objectContaining({ name: "validator-token", projected: expect.anything() }), expect.objectContaining({ name: "bootstrap-reference", downwardAPI: expect.anything() })]));
	});

	it("rejects widened identity, route, namespace, resources, scratch, and reference input", function _RejectsWidening()
	{
		expect(function _WrongIdentity() { __BuildMcpbValidatorJob(_Assignment(), { ..._Profile(), serviceAccountName: "opencrane-server" }); }).toThrow(/fixed identity/);
		expect(function _WrongRoute() { __BuildMcpbValidatorJob(_Assignment(), { ..._Profile(), bootstrapUrl: "http://opencrane-server.opencrane.svc.cluster.local:8081/api/internal/agent-runtime" }); }).toThrow(/fixed identity/);
		expect(function _WrongNamespace() { __BuildMcpbValidatorJob({ ..._Assignment(), namespace: "other-namespace" }, _Profile()); }).toThrow(/deployment-owned namespace/);
		expect(function _OversizedResources() { __BuildMcpbValidatorJob(_Assignment(), { ..._Profile(), resources: { requests: { cpu: "3", memory: "1Gi" }, limits: { cpu: "3", memory: "1Gi" } } }); }).toThrow(/bounded resources/);
		expect(function _SmallScratch() { __BuildMcpbValidatorJob(_Assignment(), { ..._Profile(), scratchSize: "64Mi" }); }).toThrow(/bounded resources/);
		expect(function _ReadableReference() { __BuildMcpbValidatorJob({ ..._Assignment(), bootstrapReference: "validation-1" }, _Profile()); }).toThrow(/opaque reference/);
	});
});
