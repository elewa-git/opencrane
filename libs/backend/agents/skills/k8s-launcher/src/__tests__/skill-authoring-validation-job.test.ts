import { describe, expect, it } from "vitest";

import { __BuildSkillAuthoringValidationJob } from "../skill-authoring-validation-job";

/** Builds one bounded skill-authoring profile. */
function _Profile()
{
	return { image: `ghcr.io/opencrane/skill-authoring@sha256:${"a".repeat(64)}`, imagePullPolicy: "IfNotPresent" as const, serverNamespace: "opencrane", namespace: "opencrane-skill-authoring", serviceAccountName: "skill-authoring-default", capabilityTokenAudience: "opencrane-skill-authoring", bootstrapUrl: "http://opencrane-server.opencrane.svc.cluster.local:8081/api/internal/agent-runtime", capabilityTokenPath: "/var/run/opencrane/tokens/capability.token", bootstrapReferencePath: "/var/run/opencrane/bootstrap/reference", scratchSize: "128Mi", activeDeadlineSeconds: 300, ttlSecondsAfterFinished: 0, resources: { requests: { cpu: "500m", memory: "3Gi" }, limits: { cpu: "2", memory: "4Gi" } } };
}

/** Builds the opaque authority coordinates for one worker Job. */
function _Assignment()
{
	return { jobId: "authoring-job-1", siloId: "silo-1", namespace: "opencrane-skill-authoring", capabilityReference: `skill-bootstrap-v1_${"a".repeat(64)}` };
}

describe("skill-authoring validation Job", function _DescribeJob()
{
	it("is deterministic, one-shot, unprivileged, and carries no source or credential material", function _builds()
	{
		const job = __BuildSkillAuthoringValidationJob(_Assignment(), _Profile());
		expect(job.spec).toMatchObject({ suspend: true, backoffLimit: 0, parallelism: 1, completions: 1, ttlSecondsAfterFinished: 0 });
		expect(job.spec?.template.spec).toMatchObject({ automountServiceAccountToken: false, restartPolicy: "Never", securityContext: { runAsNonRoot: true } });
		expect(job.spec?.template.spec?.containers[0]?.securityContext).toMatchObject({ allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] } });
		expect(JSON.stringify(job)).not.toContain("artifactContentAddress");
		expect(JSON.stringify(job)).not.toContain("password");
		expect(JSON.stringify(job)).not.toContain("OPENCRANE_SKILL_CAPABILITY_REFERENCE");
		expect(job.spec?.template.spec?.volumes).toEqual(expect.arrayContaining([expect.objectContaining({ name: "bootstrap-reference", downwardAPI: expect.anything() })]));
	});

	it("rejects a wrong worker identity or a server-namespace Job", function _rejectsWidening()
	{
		expect(function _WrongIdentity() { __BuildSkillAuthoringValidationJob(_Assignment(), { ..._Profile(), serviceAccountName: "other-authoring" }); }).toThrow(/fixed identity/);
		expect(function _ForeignNamespace() { __BuildSkillAuthoringValidationJob({ ..._Assignment(), namespace: "other-silo-authoring" }, _Profile()); }).toThrow(/deployment-owned namespace/);
		expect(function _WrongAudience() { __BuildSkillAuthoringValidationJob(_Assignment(), { ..._Profile(), capabilityTokenAudience: "opencrane-server" }); }).toThrow(/fixed audience/);
		expect(function _InvalidBootstrapPort() { __BuildSkillAuthoringValidationJob(_Assignment(), { ..._Profile(), bootstrapUrl: "http://opencrane-server.opencrane.svc.cluster.local:99999/api/internal/agent-runtime" }); }).toThrow(/fixed bootstrap endpoint/);
		expect(function _OversizedResources() { __BuildSkillAuthoringValidationJob(_Assignment(), { ..._Profile(), activeDeadlineSeconds: 901, resources: { requests: { cpu: "3", memory: "3Gi" }, limits: { cpu: "3", memory: "3Gi" } } }); }).toThrow(/bounded resources/);
		expect(function _OversizedNamespace() { __BuildSkillAuthoringValidationJob({ ..._Assignment(), namespace: "a".repeat(64) }, { ..._Profile(), namespace: "a".repeat(64) }); }).toThrow(/bounded resources/);
		expect(function _NonOpaqueReference() { __BuildSkillAuthoringValidationJob({ ..._Assignment(), capabilityReference: "workload-identifier" }, _Profile()); }).toThrow(/opaque bootstrap reference/);
	});

	it("builds the workflow-owned authoring Job class", function _buildsAuthoring()
	{
		const profile = { ..._Profile(), namespace: "opencrane-authoring" };
		const job = __BuildSkillAuthoringValidationJob({ ..._Assignment(), namespace: "opencrane-authoring" }, profile);
		expect(job.metadata?.name).toMatch(/^skill-author-/);
		expect(job.spec?.template.metadata?.labels).toMatchObject({ "app.kubernetes.io/component": "skill-authoring" });
	});

	it("reserves the fixed extraction and validation scratch budget for authoring Jobs", function _reservesAuthoringScratch()
	{
		const assignment = { ..._Assignment(), namespace: "opencrane-skill-authoring" };
		expect(function _SmallScratch() { __BuildSkillAuthoringValidationJob(assignment, { ..._Profile(), scratchSize: "32Mi" }); }).toThrow(/bounded resources/);
		expect(function _SmallMemory() { __BuildSkillAuthoringValidationJob(assignment, { ..._Profile(), resources: { requests: { cpu: "500m", memory: "2Gi" }, limits: { cpu: "2", memory: "2Gi" } } }); }).toThrow(/bounded resources/);
		expect(__BuildSkillAuthoringValidationJob(assignment, { ..._Profile(), scratchSize: "128Mi" }).spec?.template.spec?.volumes).toEqual(expect.arrayContaining([expect.objectContaining({ name: "scratch", emptyDir: { sizeLimit: "128Mi" } })]));
	});
});
