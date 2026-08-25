import { describe, expect, it } from "vitest";

import { __BuildArtifactPreprocessorJob } from "../index";

/** Return one bounded deployment-owned PDF worker profile. */
function _Profile()
{
	return { image: `ghcr.io/opencrane/artifact-preprocessor@sha256:${"a".repeat(64)}`, imagePullPolicy: "IfNotPresent" as const, serverNamespace: "opencrane", serverServiceName: "opencrane-server", namespace: "opencrane-artifact-preprocessor", serviceAccountName: "artifact-preprocessor", tokenAudience: "opencrane-artifact-preprocessor", openCraneInternalUrl: "http://opencrane-server.opencrane.svc.cluster.local:8081", tokenPath: "/var/run/opencrane/tokens/opencrane.token", bootstrapReferencePath: "/var/run/opencrane/bootstrap/reference", scratchSize: "128Mi", activeDeadlineSeconds: 300, ttlSecondsAfterFinished: 0, resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "1", memory: "512Mi" } } };
}

/** Return controller-owned opaque coordinates for one preprocessing task. */
function _Assignment()
{
	return { preprocessJobId: "preprocess-1", siloId: "silo-1", namespace: "opencrane-artifact-preprocessor", bootstrapReference: `artifact-preprocess-bootstrap-v1_${"b".repeat(64)}` };
}

describe("artifact preprocessing Job builder", function _DescribeArtifactPreprocessorJob()
{
	it("builds a suspended one-shot worker without product identifiers or database credentials", function _BuildsHardenedJob()
	{
		const job = __BuildArtifactPreprocessorJob(_Assignment(), _Profile());
		expect(job.spec).toMatchObject({ suspend: true, backoffLimit: 0, completions: 1, parallelism: 1, ttlSecondsAfterFinished: 0 });
		expect(job.spec?.template.spec).toMatchObject({ serviceAccountName: "artifact-preprocessor", automountServiceAccountToken: false, restartPolicy: "Never" });
		expect(job.spec?.template.spec?.containers[0]?.securityContext).toMatchObject({ allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] } });
		expect(JSON.stringify(job)).not.toContain("preprocess-1");
		expect(JSON.stringify(job)).not.toContain("silo-1");
		expect(JSON.stringify(job)).not.toContain("DATABASE_URL");
	});

	it("rejects a widened identity, endpoint, namespace, or bootstrap reference", function _RejectsWidenedAuthority()
	{
		expect(function _WrongIdentity() { __BuildArtifactPreprocessorJob(_Assignment(), { ..._Profile(), serviceAccountName: "opencrane-server" }); }).toThrow(/fixed worker identity/);
		expect(function _WrongEndpoint() { __BuildArtifactPreprocessorJob(_Assignment(), { ..._Profile(), openCraneInternalUrl: "https://example.com" }); }).toThrow(/fixed worker identity/);
		expect(function _WrongServerService() { __BuildArtifactPreprocessorJob(_Assignment(), { ..._Profile(), openCraneInternalUrl: "http://receiver.opencrane.svc.cluster.local" }); }).toThrow(/fixed worker identity/);
		expect(function _WrongNamespace() { __BuildArtifactPreprocessorJob({ ..._Assignment(), namespace: "other" }, _Profile()); }).toThrow(/deployment-owned namespace/);
		expect(function _ReadableReference() { __BuildArtifactPreprocessorJob({ ..._Assignment(), bootstrapReference: "preprocess-1" }, _Profile()); }).toThrow(/opaque bootstrap reference/);
		expect(function _OversizedResources() { __BuildArtifactPreprocessorJob(_Assignment(), { ..._Profile(), resources: { requests: { cpu: "1", memory: "128Mi" }, limits: { cpu: "4", memory: "2Gi" } } }); }).toThrow(/bounded scratch and lifetime/);
		expect(function _InvertedResources() { __BuildArtifactPreprocessorJob(_Assignment(), { ..._Profile(), resources: { requests: { cpu: "1", memory: "512Mi" }, limits: { cpu: "500m", memory: "128Mi" } } }); }).toThrow(/bounded scratch and lifetime/);
	});
});
