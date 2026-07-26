import { describe, expect, it } from "vitest";

import { __BuildGovernedSkillWorkloadJob } from "../skill-workload-job.js";

/** Builds one bounded tool-runner profile. */
function _Profile()
{
	return { kind: "tool-runner" as const, image: `ghcr.io/opencrane/tool-runner@sha256:${"a".repeat(64)}`, imagePullPolicy: "IfNotPresent" as const, serverNamespace: "opencrane", namespace: "opencrane-tools", serviceAccountName: "tool-runner-default", capabilityTokenAudience: "opencrane-tool-runner", scratchSize: "64Mi", activeDeadlineSeconds: 300, ttlSecondsAfterFinished: 0, resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } } };
}

/** Builds the opaque authority coordinates for one worker Job. */
function _Assignment()
{
	return { jobId: "tool-job-1", siloId: "silo-1", namespace: "opencrane-tools", capabilityReference: "tool-capability-1" };
}

describe("governed skill workload Job", function _describeJob()
{
	it("is deterministic, one-shot, unprivileged, and carries no source or credential material", function _builds()
	{
		const job = __BuildGovernedSkillWorkloadJob(_Assignment(), _Profile());
		expect(job.spec).toMatchObject({ suspend: true, backoffLimit: 0, parallelism: 1, completions: 1, ttlSecondsAfterFinished: 0 });
		expect(job.spec?.template.spec).toMatchObject({ automountServiceAccountToken: false, restartPolicy: "Never", securityContext: { runAsNonRoot: true } });
		expect(job.spec?.template.spec?.containers[0]?.securityContext).toMatchObject({ allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] } });
		expect(JSON.stringify(job)).not.toContain("artifactContentAddress");
		expect(JSON.stringify(job)).not.toContain("password");
	});

	it("rejects a wrong workload identity class or a server-namespace Job", function _rejectsWidening()
	{
		expect(function _wrongIdentity() { __BuildGovernedSkillWorkloadJob(_Assignment(), { ..._Profile(), serviceAccountName: "skill-authoring-default" }); }).toThrow(/class-bounded identity/);
		expect(function _foreignNamespace() { __BuildGovernedSkillWorkloadJob({ ..._Assignment(), namespace: "other-silo-tools" }, _Profile()); }).toThrow(/deployment-owned namespace/);
		expect(function _wrongAudience() { __BuildGovernedSkillWorkloadJob(_Assignment(), { ..._Profile(), capabilityTokenAudience: "opencrane-server" }); }).toThrow(/fixed audience/);
		expect(function _oversizedResources() { __BuildGovernedSkillWorkloadJob(_Assignment(), { ..._Profile(), activeDeadlineSeconds: 901, resources: { requests: { cpu: "3", memory: "3Gi" }, limits: { cpu: "3", memory: "3Gi" } } }); }).toThrow(/bounded resources/);
		expect(function _oversizedNamespace() { __BuildGovernedSkillWorkloadJob({ ..._Assignment(), namespace: "a".repeat(64) }, { ..._Profile(), namespace: "a".repeat(64) }); }).toThrow(/bounded resources/);
	});

	it("builds the separately owned authoring Job class", function _buildsAuthoring()
	{
		const profile = { ..._Profile(), kind: "authoring" as const, image: `ghcr.io/opencrane/skill-authoring@sha256:${"b".repeat(64)}`, namespace: "opencrane-authoring", serviceAccountName: "skill-authoring-default", capabilityTokenAudience: "opencrane-skill-authoring" };
		const job = __BuildGovernedSkillWorkloadJob({ ..._Assignment(), namespace: "opencrane-authoring" }, profile);
		expect(job.metadata?.name).toMatch(/^skill-author-/);
		expect(job.spec?.template.metadata?.labels).toMatchObject({ "app.kubernetes.io/component": "skill-authoring" });
	});
});
