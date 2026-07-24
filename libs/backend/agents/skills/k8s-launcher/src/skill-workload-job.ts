import { createHash } from "node:crypto";
import type { V1Job } from "@kubernetes/client-node";

import { __BuildSkillAuthoringWorkloadJob } from "./skill-authoring-workload-job.js";
import type { SkillWorkloadJobAssignment, SkillWorkloadJobProfile } from "./skill-workload-job.types.js";
import { __BuildToolRunnerWorkloadJob } from "./tool-runner-workload-job.js";

/** Maximum size of the non-authoritative scratch filesystem. */
const _MAX_SCRATCH_BYTES = 1_073_741_824n;

/** Minimum scratch capacity for safe authoring archive extraction and offline validation output. */
const _MIN_AUTHORING_SCRATCH_BYTES = 134_217_728n;

/** Maximum wall-clock lifetime granted to one untrusted governed-skill Job. */
const _MAX_ACTIVE_DEADLINE_SECONDS = 900;

/** Maximum CPU limit granted to one untrusted governed-skill Job in millicores. */
const _MAX_CPU_MILLICORES = 2_000;

/** Maximum memory limit granted to one untrusted governed-skill Job in bytes. */
const _MAX_MEMORY_BYTES = 2_147_483_648n;
/** Fixed read-only projected token path for the bootstrap worker. */
const _CAPABILITY_TOKEN_PATH = "/var/run/opencrane/tokens/capability.token";
/** Fixed read-only downward-API bootstrap reference path. */
const _BOOTSTRAP_REFERENCE_PATH = "/var/run/opencrane/bootstrap/reference";

/** Validate the one deployment-owned same-silo bootstrap endpoint. */
function _IsBootstrapUrl(value: string): boolean
{
	try
	{
		const parsed = new URL(value);
		const port = Number(parsed.port);
		return parsed.protocol === "http:" && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.svc\.cluster\.local$/.test(parsed.hostname) && Number.isSafeInteger(port) && port >= 1 && port <= 65_535 && parsed.pathname === "/api/internal/agent-runtime" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
	}
	catch
	{
		return false;
	}
}

/** Validate an opaque identifier before it is projected into Kubernetes metadata. */
function _IsBoundedCoordinate(value: string): boolean
{
	return value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Parse a positive binary Kubernetes quantity into bytes. */
function _ParseBinaryBytes(value: string): bigint | null
{
	const match = /^([1-9][0-9]*)(Ki|Mi|Gi)$/.exec(value);
	if (!match) return null;
	const exponent = { Ki: 1n, Mi: 2n, Gi: 3n }[match[2] as "Ki" | "Mi" | "Gi"];
	return BigInt(match[1]) * (1024n ** exponent);
}

/** Parse a positive Kubernetes CPU quantity into millicores. */
function _ParseCpuMillis(value: string): number | null
{
	const milli = /^([1-9][0-9]*)m$/.exec(value);
	const cores = /^([1-9][0-9]*(?:\.[0-9]+)?)$/.exec(value);
	const parsed = milli ? Number(milli[1]) : cores ? Number(cores[1]) * 1_000 : 0;
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Validate deployment-owned limits before a controller can submit the worker Job. */
function _AssertProfile(profile: SkillWorkloadJobProfile): void
{
	const expectedServiceAccountName = profile.kind === "authoring" ? "skill-authoring-default" : "tool-runner-default";
	const expectedAudience = profile.kind === "authoring" ? "opencrane-skill-authoring" : "opencrane-tool-runner";
	const scratchBytes = _ParseBinaryBytes(profile.scratchSize);
	const requestedCpu = _ParseCpuMillis(String(profile.resources.requests?.cpu ?? ""));
	const limitedCpu = _ParseCpuMillis(String(profile.resources.limits?.cpu ?? ""));
	const requestedMemory = _ParseBinaryBytes(String(profile.resources.requests?.memory ?? ""));
	const limitedMemory = _ParseBinaryBytes(String(profile.resources.limits?.memory ?? ""));
	if (!/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(profile.image) || !["Always", "IfNotPresent", "Never"].includes(profile.imagePullPolicy) || profile.serviceAccountName !== expectedServiceAccountName || profile.capabilityTokenAudience !== expectedAudience || !_IsBootstrapUrl(profile.bootstrapUrl) || profile.capabilityTokenPath !== _CAPABILITY_TOKEN_PATH || profile.bootstrapReferencePath !== _BOOTSTRAP_REFERENCE_PATH || profile.namespace.length > 63 || !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(profile.namespace) || profile.namespace === profile.serverNamespace || !scratchBytes || scratchBytes > _MAX_SCRATCH_BYTES || (profile.kind === "authoring" && scratchBytes < _MIN_AUTHORING_SCRATCH_BYTES) || !Number.isSafeInteger(profile.activeDeadlineSeconds) || profile.activeDeadlineSeconds < 1 || profile.activeDeadlineSeconds > _MAX_ACTIVE_DEADLINE_SECONDS || profile.ttlSecondsAfterFinished !== 0 || !requestedCpu || !limitedCpu || requestedCpu > limitedCpu || limitedCpu > _MAX_CPU_MILLICORES || !requestedMemory || !limitedMemory || requestedMemory > limitedMemory || limitedMemory > _MAX_MEMORY_BYTES)
	{
		throw new Error("governed skill Job profile requires one fixed bootstrap endpoint, fixed audience and paths, class-bounded identity, immutable image, bounded resources, scratch, and lifetime");
	}
}

/** Validate controller-supplied durable coordinates before they become labels or annotations. */
function _AssertAssignment(assignment: SkillWorkloadJobAssignment, profile: SkillWorkloadJobProfile): void
{
	if (![assignment.jobId, assignment.siloId, assignment.namespace, assignment.capabilityReference].every(function _isValid(value): boolean { return _IsBoundedCoordinate(value); }) || !/^skill-bootstrap-v1_[a-f0-9]{64}$/.test(assignment.capabilityReference) || assignment.namespace !== profile.namespace)
	{
		throw new Error("governed skill Job assignment requires bounded coordinates, an opaque bootstrap reference, and its deployment-owned namespace");
	}
}

/** Derive a selector-safe, collision-resistant one-shot Job name without leaking authority ids. */
export function __SkillWorkloadJobName(assignment: SkillWorkloadJobAssignment, profile: SkillWorkloadJobProfile): string
{
	const digest = createHash("sha256").update(`${profile.kind}\u0000${assignment.siloId}\u0000${assignment.jobId}`).digest("hex").slice(0, 24);
	return `${profile.kind === "authoring" ? "skill-author" : "tool-run"}-${digest}`;
}

/** Build one deterministic, unprivileged Job carrying only an opaque exchanged capability reference. */
export function __BuildGovernedSkillWorkloadJob(assignment: SkillWorkloadJobAssignment, profile: SkillWorkloadJobProfile): V1Job
{
	// 1. Refuse unbounded identity, image, storage, or lifetime inputs before Kubernetes can see them.
	_AssertProfile(profile);
	_AssertAssignment(assignment, profile);

	// 2. Select one app-owned Job class so the workload registry can inspect distinct construction anchors.
	return profile.kind === "authoring" ? __BuildSkillAuthoringWorkloadJob(assignment, profile) : __BuildToolRunnerWorkloadJob(assignment, profile);
}

/** Build the shared hardened Job spec after an app-specific function constructed the Job envelope. */
export function __BuildSkillWorkloadJobSpec(profile: SkillWorkloadJobProfile, component: "skill-authoring" | "tool-runner", name: string, annotations: Readonly<Record<string, string>>): NonNullable<V1Job["spec"]>
{
	return {
		suspend: true,
		backoffLimit: 0,
		completions: 1,
		parallelism: 1,
		activeDeadlineSeconds: profile.activeDeadlineSeconds,
		ttlSecondsAfterFinished: 0,
		template: {
			metadata: { labels: { "app.kubernetes.io/component": component, "opencrane.ai/skill-workload": name }, annotations },
			spec: {
				serviceAccountName: profile.serviceAccountName,
				automountServiceAccountToken: false,
				enableServiceLinks: false,
				restartPolicy: "Never",
				terminationGracePeriodSeconds: 0,
				securityContext: { runAsNonRoot: true, runAsUser: 65532, runAsGroup: 65532, fsGroup: 65532, seccompProfile: { type: "RuntimeDefault" } },
				containers: [{ name: component, image: profile.image, imagePullPolicy: profile.imagePullPolicy, securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] }, readOnlyRootFilesystem: true }, env: [{ name: "OPENCRANE_SKILL_BOOTSTRAP_URL", value: profile.bootstrapUrl }, { name: "OPENCRANE_SKILL_TOKEN_PATH", value: profile.capabilityTokenPath }, { name: "OPENCRANE_SKILL_BOOTSTRAP_REFERENCE_PATH", value: profile.bootstrapReferencePath }], resources: structuredClone(profile.resources), volumeMounts: [{ name: "capability-token", mountPath: "/var/run/opencrane/tokens", readOnly: true }, { name: "bootstrap-reference", mountPath: "/var/run/opencrane/bootstrap", readOnly: true }, { name: "scratch", mountPath: "/tmp" }] }],
				volumes: [{ name: "capability-token", projected: { defaultMode: 0o440, sources: [{ serviceAccountToken: { path: "capability.token", audience: profile.capabilityTokenAudience, expirationSeconds: 600 } }] } }, { name: "bootstrap-reference", downwardAPI: { defaultMode: 0o440, items: [{ path: "reference", fieldRef: { fieldPath: "metadata.annotations['opencrane.ai/capability-reference']" } }] } }, { name: "scratch", emptyDir: { sizeLimit: profile.scratchSize } }],
			},
		},
	};
}
