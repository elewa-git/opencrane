import { createHash } from "node:crypto";
import type { V1Job } from "@kubernetes/client-node";

import { SKILL_AUTHORING_VALIDATION_PROJECTED_TOKEN_AUDIENCE, SKILL_AUTHORING_VALIDATION_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";

import type { SkillAuthoringValidationJobAssignment, SkillAuthoringValidationJobProfile } from "./skill-authoring-validation-job.types";

const _MAX_SCRATCH_BYTES = 1_073_741_824n;
const _MIN_SCRATCH_BYTES = 134_217_728n;
const _MIN_MEMORY_BYTES = 3_221_225_472n;
const _MIN_MEMORY_LIMIT_BYTES = 4_294_967_296n;
const _MAX_ACTIVE_DEADLINE_SECONDS = 900;
const _MAX_CPU_MILLICORES = 2_000;
const _MAX_MEMORY_BYTES = 4_294_967_296n;
const _CAPABILITY_TOKEN_PATH = "/var/run/opencrane/tokens/capability.token";
const _BOOTSTRAP_REFERENCE_PATH = "/var/run/opencrane/bootstrap/reference";

/** Returns whether a URL identifies the fixed cluster-local worker API base. */
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

/** Returns whether a coordinate is bounded before it enters Kubernetes metadata. */
function _IsBoundedCoordinate(value: string): boolean
{
	return value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Parses a positive binary Kubernetes size. */
function _ParseBinaryBytes(value: string): bigint | null
{
	const match = /^([1-9][0-9]*)(Ki|Mi|Gi)$/.exec(value);
	if (!match)
		return null;
	const exponent = { Ki: 1n, Mi: 2n, Gi: 3n }[match[2] as "Ki" | "Mi" | "Gi"];
	return BigInt(match[1]) * (1024n ** exponent);
}

/** Parses a positive Kubernetes CPU quantity into millicores. */
function _ParseCpuMillis(value: string): number | null
{
	const milli = /^([1-9][0-9]*)m$/.exec(value);
	const cores = /^([1-9][0-9]*(?:\.[0-9]+)?)$/.exec(value);
	let parsed = 0;
	if (milli)
		parsed = Number(milli[1]);
	else if (cores)
		parsed = Number(cores[1]) * 1_000;
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Rejects any deployment profile that could widen the authoring Job envelope. */
function _AssertProfile(profile: SkillAuthoringValidationJobProfile): void
{
	const scratchBytes = _ParseBinaryBytes(profile.scratchSize);
	const requestedCpu = _ParseCpuMillis(String(profile.resources.requests?.cpu ?? ""));
	const limitedCpu = _ParseCpuMillis(String(profile.resources.limits?.cpu ?? ""));
	const requestedMemory = _ParseBinaryBytes(String(profile.resources.requests?.memory ?? ""));
	const limitedMemory = _ParseBinaryBytes(String(profile.resources.limits?.memory ?? ""));
	if (!/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(profile.image) || !["Always", "IfNotPresent", "Never"].includes(profile.imagePullPolicy) || profile.serviceAccountName !== SKILL_AUTHORING_VALIDATION_SERVICE_ACCOUNT_NAME || profile.capabilityTokenAudience !== SKILL_AUTHORING_VALIDATION_PROJECTED_TOKEN_AUDIENCE || !_IsBootstrapUrl(profile.bootstrapUrl) || profile.capabilityTokenPath !== _CAPABILITY_TOKEN_PATH || profile.bootstrapReferencePath !== _BOOTSTRAP_REFERENCE_PATH || profile.namespace.length > 63 || !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(profile.namespace) || profile.namespace === profile.serverNamespace || !scratchBytes || scratchBytes < _MIN_SCRATCH_BYTES || scratchBytes > _MAX_SCRATCH_BYTES || !Number.isSafeInteger(profile.activeDeadlineSeconds) || profile.activeDeadlineSeconds < 1 || profile.activeDeadlineSeconds > _MAX_ACTIVE_DEADLINE_SECONDS || profile.ttlSecondsAfterFinished !== 0 || !requestedCpu || !limitedCpu || requestedCpu > limitedCpu || limitedCpu > _MAX_CPU_MILLICORES || !requestedMemory || !limitedMemory || requestedMemory < _MIN_MEMORY_BYTES || limitedMemory < _MIN_MEMORY_LIMIT_BYTES || requestedMemory > limitedMemory || limitedMemory > _MAX_MEMORY_BYTES)
	{
		throw new Error("skill authoring Job profile requires one fixed bootstrap endpoint, fixed audience and paths, fixed identity, immutable image, bounded resources, scratch, and lifetime");
	}
}

/** Rejects validation coordinates that cannot safely enter the exact deployment profile. */
function _AssertAssignment(assignment: SkillAuthoringValidationJobAssignment, profile: SkillAuthoringValidationJobProfile): void
{
	if (![assignment.jobId, assignment.siloId, assignment.namespace, assignment.capabilityReference].every(function _IsValid(value): boolean { return _IsBoundedCoordinate(value); }) || !/^skill-bootstrap-v1_[a-f0-9]{64}$/.test(assignment.capabilityReference) || assignment.namespace !== profile.namespace)
	{
		throw new Error("skill authoring Job assignment requires bounded coordinates, an opaque bootstrap reference, and its deployment-owned namespace");
	}
}

/** Builds a selector-safe resource name without exposing saved validation ids. */
function _JobName(assignment: SkillAuthoringValidationJobAssignment): string
{
	const digest = createHash("sha256").update(`authoring\u0000${assignment.siloId}\u0000${assignment.jobId}`).digest("hex").slice(0, 24);
	return `skill-author-${digest}`;
}

/** Builds the sole restricted Kubernetes Job used by the skill-authoring workflow. */
export function __BuildSkillAuthoringValidationJob(assignment: SkillAuthoringValidationJobAssignment, profile: SkillAuthoringValidationJobProfile): V1Job
{
	_AssertProfile(profile);
	_AssertAssignment(assignment, profile);
	const name = _JobName(assignment);
	const component = "skill-authoring";
	const annotations = { "opencrane.ai/silo-id": assignment.siloId, "opencrane.ai/job-id": assignment.jobId, "opencrane.ai/capability-reference": assignment.capabilityReference };
	return {
		apiVersion: "batch/v1",
		kind: "Job",
		metadata: { name, namespace: assignment.namespace, labels: { "app.kubernetes.io/name": "opencrane-skill-authoring", "app.kubernetes.io/component": component, "opencrane.ai/skill-authoring-validation": name }, annotations },
		spec: {
			suspend: true,
			backoffLimit: 0,
			completions: 1,
			parallelism: 1,
			activeDeadlineSeconds: profile.activeDeadlineSeconds,
			ttlSecondsAfterFinished: 0,
			template: {
				metadata: { labels: { "app.kubernetes.io/component": component, "opencrane.ai/skill-authoring-validation": name }, annotations },
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
		},
	};
}
