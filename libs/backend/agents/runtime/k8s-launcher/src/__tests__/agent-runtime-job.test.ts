import { AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE } from "@opencrane/contracts";
import { describe, expect, it } from "vitest";

import { __BuildSuspendedAgentRuntimeJob, __DeriveAgentRuntimeReleaseDeadlineSeconds } from "../agent-runtime-job.js";
import type { AgentRuntimeJobAssignment, AgentRuntimeJobProfile } from "../agent-runtime-job.types.js";

/** Create one valid immutable run-attempt assignment. */
function _Assignment(): AgentRuntimeJobAssignment
{
	return {
		runId: "run-1",
		attempt: 2,
		agentServiceId: "service-1",
		agentRevisionId: "revision-1",
		siloId: "silo-1",
		namespace: "opencrane-silo-1-runtime",
		bootstrapReference: "bootstrap-ref-1",
		litellmKeySecretName: "agent-runtime-a2-litellm-key",
	};
}

/** Create the release-fixed resource profile for runtime Jobs. */
function _Profile(): AgentRuntimeJobProfile
{
	return {
		image: "ghcr.io/italanta/opencrane-agent-runtime@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		imagePullPolicy: "IfNotPresent",
		runtimeStreamUrl: "http://opencrane-server.opencrane-silo-1.svc.cluster.local:3001/api/internal/agent-runtime",
		litellmBaseUrl: "http://litellm.opencrane-silo-1.svc.cluster.local:4000",
		serverNamespace: "opencrane-silo-1",
		serviceAccountName: "agent-runtime-personal",
		projectedTokenTtlSeconds: 600,
		scratchSize: "64Mi",
		activeDeadlineSeconds: 900,
		ttlSecondsAfterFinished: 0,
		resources: { requests: { cpu: "25m", memory: "64Mi" }, limits: { cpu: "250m", memory: "128Mi" } },
	};
}

describe("personal-runtime attempt Job", function _Suite()
{
	it("derives one stable resource identity per run attempt", function _DeterministicIdentity()
	{
		const first = __BuildSuspendedAgentRuntimeJob(_Assignment(), _Profile());
		const replay = __BuildSuspendedAgentRuntimeJob(_Assignment(), _Profile());
		const nextAttempt = __BuildSuspendedAgentRuntimeJob({ ..._Assignment(), attempt: 3 }, _Profile());

		expect(replay).toEqual(first);
		expect(first.metadata?.namespace).toBe("opencrane-silo-1-runtime");
		expect(first.metadata?.name?.length).toBeLessThanOrEqual(63);
		expect(nextAttempt.metadata?.name).not.toBe(first.metadata?.name);
	});

	it("keeps the Job suspended, single-Pod, zero-retry, and non-privileged", function _SuspendedJob()
	{
		const job = __BuildSuspendedAgentRuntimeJob(_Assignment(), _Profile());
		const podSpec = job.spec?.template.spec;
		const runtime = podSpec?.containers[0];

		expect(job.kind).toBe("Job");
		expect(job.spec).toMatchObject({ suspend: true, parallelism: 1, completions: 1, backoffLimit: 0, activeDeadlineSeconds: 900, ttlSecondsAfterFinished: 0 });
		expect(podSpec).toMatchObject({ automountServiceAccountToken: false, enableServiceLinks: false, restartPolicy: "Never", terminationGracePeriodSeconds: 0, securityContext: { runAsNonRoot: true, runAsUser: 65532, runAsGroup: 65532, fsGroup: 65532, fsGroupChangePolicy: "OnRootMismatch", seccompProfile: { type: "RuntimeDefault" } } });
		expect(runtime?.securityContext).toMatchObject({ allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"] } });
		expect(podSpec?.serviceAccountName).toBe("agent-runtime-personal");
		expect(job).not.toHaveProperty("serviceAccount");
		expect(job.spec?.template.metadata?.labels).toMatchObject({ "app.kubernetes.io/name": "opencrane-agent-runtime", "app.kubernetes.io/component": "agent-runtime" });
		expect(job.spec?.template.metadata?.annotations?.["opencrane.ai/bootstrap-reference"]).toBe("bootstrap-ref-1");
	});

	it("projects only the runtime audience and mounts bounded ephemeral scratch", function _BoundedVolumes()
	{
		const job = __BuildSuspendedAgentRuntimeJob(_Assignment(), _Profile());
		const volumes = job.spec?.template.spec?.volumes;
		const tokenProjection = volumes?.find(volume => volume.name === "runtime-token")?.projected?.sources?.[0]?.serviceAccountToken;
		const tokenMode = volumes?.find(volume => volume.name === "runtime-token")?.projected?.defaultMode;
		const bootstrapVolume = volumes?.find(volume => volume.name === "runtime-bootstrap")?.downwardAPI;
		const runtime = job.spec?.template.spec?.containers[0];
		const serialized = JSON.stringify(job);

		expect(tokenProjection).toMatchObject({ audience: AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, expirationSeconds: 600, path: "runtime.token" });
		expect(tokenMode).toBe(0o440);
		expect(bootstrapVolume).toEqual({ defaultMode: 0o440, items: [{ path: "reference", fieldRef: { fieldPath: "metadata.annotations['opencrane.ai/bootstrap-reference']" } }] });
		expect(runtime?.volumeMounts).toContainEqual({ name: "runtime-bootstrap", mountPath: "/var/run/opencrane/bootstrap", readOnly: true });
		expect(volumes?.find(volume => volume.name === "scratch")?.emptyDir).toEqual({ sizeLimit: "64Mi" });
		const litellmVolume = volumes?.find(volume => volume.name === "litellm-key")?.projected;
		expect(litellmVolume).toEqual({ defaultMode: 0o440, sources: [{ secret: { name: "agent-runtime-a2-litellm-key", items: [{ key: "key", path: "key" }] } }] });
		expect(runtime?.volumeMounts).toContainEqual({ name: "litellm-key", mountPath: "/var/run/opencrane/litellm", readOnly: true });
		expect(runtime?.env).toContainEqual({ name: "OPENCRANE_RUNTIME_LITELLM_KEY_PATH", value: "/var/run/opencrane/litellm/key" });
		expect(runtime?.env).toContainEqual({ name: "OPENCRANE_RUNTIME_LITELLM_BASE_URL", value: "http://litellm.opencrane-silo-1.svc.cluster.local:4000" });
		expect(runtime?.env).not.toContainEqual(expect.objectContaining({ name: expect.stringMatching(/KEY$/), value: expect.stringMatching(/^sk-/) }));
		expect(serialized).not.toContain("envFrom");
		expect(serialized).not.toMatch(/(?:OPENAI|ANTHROPIC|GEMINI|MISTRAL|DEEPSEEK)_API_KEY/);
		expect(serialized).not.toContain("persistentVolumeClaim");
		expect(serialized).not.toContain("secretKeyRef");
		expect(serialized).not.toContain("secretName");
		expect(serialized).not.toContain("configMapKeyRef");
		expect(job.spec?.template.spec?.containers[0]?.env).not.toContainEqual(expect.objectContaining({ name: expect.stringMatching(/BOOTSTRAP/) }));
		expect(job.spec?.template.spec?.containers[0]?.args).toBeUndefined();
		expect(serialized).not.toContain("NetworkPolicy");
	});

	it("rejects Internet endpoints and non-positive attempts before adapter I/O", function _InvalidInputs()
	{
		expect(function _InternetEndpoint() { __BuildSuspendedAgentRuntimeJob(_Assignment(), { ..._Profile(), runtimeStreamUrl: "https://example.com/runtime" }); }).toThrow(/in-cluster HTTP stream URL/);
		expect(function _InvalidAttempt() { __BuildSuspendedAgentRuntimeJob({ ..._Assignment(), attempt: 0 }, _Profile()); }).toThrow(/positive safe integer/);
		expect(function _MutableImageTag() { __BuildSuspendedAgentRuntimeJob(_Assignment(), { ..._Profile(), image: "ghcr.io/italanta/opencrane-agent-runtime:latest" }); }).toThrow(/immutable image/);
		expect(function _InvalidPullPolicy() { __BuildSuspendedAgentRuntimeJob(_Assignment(), { ..._Profile(), imagePullPolicy: "Sometimes" as "Always" }); }).toThrow(/image pull policy/);
		expect(function _SameNamespaceServer() { __BuildSuspendedAgentRuntimeJob({ ..._Assignment(), namespace: "opencrane-silo-1" }, _Profile()); }).toThrow(/different namespaces/);
		expect(function _UnboundedScratch() { __BuildSuspendedAgentRuntimeJob(_Assignment(), { ..._Profile(), scratchSize: "2Gi" }); }).toThrow(/bounded scratch/);
		expect(function _MissingResourceLimits() { __BuildSuspendedAgentRuntimeJob(_Assignment(), { ..._Profile(), resources: {} }); }).toThrow(/CPU and memory requests/);
		expect(function _MissingBootstrapReference() { __BuildSuspendedAgentRuntimeJob({ ..._Assignment(), bootstrapReference: "" }, _Profile()); }).toThrow(/invalid authority coordinate/);
	});

	it("does not mutate assignment or release-profile inputs", function _DoesNotMutateInputs()
	{
		const assignment = _Assignment();
		const profile = _Profile();
		const expectedAssignment = structuredClone(assignment);
		const expectedProfile = structuredClone(profile);

		__BuildSuspendedAgentRuntimeJob(assignment, profile);

		expect(assignment).toEqual(expectedAssignment);
		expect(profile).toEqual(expectedProfile);
	});

	it("derives a conservative whole-second deadline capped by both assignment and profile", function _DerivesReleaseDeadline()
	{
		expect(__DeriveAgentRuntimeReleaseDeadlineSeconds("2026-07-20T00:30:00.000Z", Date.parse("2026-07-20T00:20:00.000Z"), 900)).toBe(599);
		expect(__DeriveAgentRuntimeReleaseDeadlineSeconds("2026-07-20T01:00:00.000Z", Date.parse("2026-07-20T00:20:00.000Z"), 900)).toBe(900);
	});

	it("fails closed when assignment expiry cannot leave one safe execution second", function _RejectsExpiredRelease()
	{
		expect(function _Expired() { __DeriveAgentRuntimeReleaseDeadlineSeconds("2026-07-20T00:20:00.000Z", Date.parse("2026-07-20T00:20:00.000Z"), 900); }).toThrow(/expires before a safe Job release/);
		expect(function _Subsecond() { __DeriveAgentRuntimeReleaseDeadlineSeconds("2026-07-20T00:20:01.999Z", Date.parse("2026-07-20T00:20:00.000Z"), 900); }).toThrow(/expires before a safe Job release/);
		expect(function _NonCanonical() { __DeriveAgentRuntimeReleaseDeadlineSeconds("2026-07-20T00:20:10Z", Date.parse("2026-07-20T00:20:00.000Z"), 900); }).toThrow(/canonical expiry/);
	});

	it("rejects delayed terminal cleanup that could retain scratch beyond assignment expiry", function _RejectsRetainedScratch()
	{
		expect(function _DelayedCleanup() { __BuildSuspendedAgentRuntimeJob(_Assignment(), { ..._Profile(), ttlSecondsAfterFinished: 1 }); }).toThrow(/immediate terminal cleanup/);
	});

	it("defaults to the personal identity class when no profile is selected", function _DefaultsPersonal()
	{
		const job = __BuildSuspendedAgentRuntimeJob(_Assignment(), _Profile());
		const tokenProjection = job.spec?.template.spec?.volumes?.find(volume => volume.name === "runtime-token")?.projected?.sources?.[0]?.serviceAccountToken;
		expect(tokenProjection?.audience).toBe(AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE);
	});
});

describe("managed (central) agent runtime identity profile", function _ManagedSuite()
{
	/** Managed profile reusing the shared runtime image with the managed identity class. */
	function _ManagedProfile(): AgentRuntimeJobProfile
	{
		return { ..._Profile(), identityProfile: "managed", serviceAccountName: "managed-agent-runtime-harvester" };
	}

	it("projects the distinct managed audience for a managed ServiceAccount", function _ManagedAudience()
	{
		const job = __BuildSuspendedAgentRuntimeJob(_Assignment(), _ManagedProfile());
		const tokenProjection = job.spec?.template.spec?.volumes?.find(volume => volume.name === "runtime-token")?.projected?.sources?.[0]?.serviceAccountToken;
		expect(tokenProjection?.audience).toBe(MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE);
		expect(tokenProjection?.audience).not.toBe(AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE);
		expect(job.spec?.template.spec?.serviceAccountName).toBe("managed-agent-runtime-harvester");
	});

	it("rejects a personal ServiceAccount name on a managed profile and vice versa", function _MutuallyExclusive()
	{
		expect(function _PersonalNameOnManaged() { __BuildSuspendedAgentRuntimeJob(_Assignment(), { ..._ManagedProfile(), serviceAccountName: "agent-runtime-personal" }); }).toThrow(/bounded runtime ServiceAccount/);
		expect(function _ManagedNameOnPersonal() { __BuildSuspendedAgentRuntimeJob(_Assignment(), { ..._Profile(), serviceAccountName: "managed-agent-runtime-harvester" }); }).toThrow(/bounded runtime ServiceAccount/);
	});
});
