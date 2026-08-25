import { createHash } from "node:crypto";

import type { V1Job } from "@kubernetes/client-node";
import { __IsArtifactPreprocessBootstrapReference } from "@opencrane/contracts";

import type { ArtifactPreprocessorJobAssignment, ArtifactPreprocessorJobProfile } from "./artifact-preprocessor-job.types";

/** Maximum temporary scratch space the PDF worker can receive. */
const _MAX_SCRATCH_BYTES = 536_870_912n;
/** Smallest scratch space that holds a bounded source PDF and its text output. */
const _MIN_SCRATCH_BYTES = 67_108_864n;
/** Maximum wall-clock lifetime for the controlled PDF conversion Job. */
const _MAX_ACTIVE_DEADLINE_SECONDS = 600;
/** Maximum CPU limit granted to one PDF conversion Job in millicores. */
const _MAX_CPU_MILLICORES = 2_000;
/** Maximum memory limit granted to one PDF conversion Job in bytes. */
const _MAX_MEMORY_BYTES = 1_073_741_824n;
/** Fixed ServiceAccount name for the broker-only PDF converter. */
const _SERVICE_ACCOUNT_NAME = "artifact-preprocessor";
/** Fixed audience the OpenCrane server accepts from this worker class. */
const _TOKEN_AUDIENCE = "opencrane-artifact-preprocessor";
/** Fixed token mount path inside the worker. */
const _TOKEN_PATH = "/var/run/opencrane/tokens/opencrane.token";
/** Fixed opaque reference path inside the worker. */
const _BOOTSTRAP_REFERENCE_PATH = "/var/run/opencrane/bootstrap/reference";

/**
 * Builds the deterministic Kubernetes name for one preprocessing Job without exposing its product
 * record identifiers.
 *
 * The name hashes the silo and preprocessing-job IDs, so the Job metadata can correlate retries
 * without putting either readable ID into Kubernetes. Called by: `__BuildArtifactPreprocessorJob`.
 *
 * @param assignment - Controller-selected coordinates for the preprocessing task.
 * @returns An `artifact-preprocess-*` name derived from the assignment coordinates.
 */
export function __ArtifactPreprocessorJobName(assignment: ArtifactPreprocessorJobAssignment): string
{
	const digest = createHash("sha256").update(`${assignment.siloId}\u0000${assignment.preprocessJobId}`).digest("hex").slice(0, 24);
	return `artifact-preprocess-${digest}`;
}

/** Parse a Kubernetes binary quantity into bytes. */
function _BinaryBytes(value: string): bigint | null
{
	const match = /^([1-9][0-9]*)(Mi|Gi)$/.exec(value);
	if (match === null)
		return null;
	const exponent = match[2] === "Mi" ? 2n : 3n;
	return BigInt(match[1]) * (1024n ** exponent);
}

/** Parse positive CPU quantities into millicores for request-versus-limit checks. */
function _CpuMillicores(value: string): number | null
{
	const milli = /^([1-9][0-9]*)m$/.exec(value);
	const cores = /^([1-9][0-9]*(?:\.[0-9]+)?)$/.exec(value);
	if (milli !== null)
		return Number.isSafeInteger(Number(milli[1])) && Number(milli[1]) > 0 ? Number(milli[1]) : null;
	if (cores === null)
		return null;
	const parsed = Number(cores[1]) * 1_000;
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Return whether text is a safe bounded coordinate for Kubernetes metadata. */
function _Bounded(value: string): boolean
{
	return value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Reject deployment policy that could widen the worker's identity, endpoint, or resources. */
function _AssertProfile(profile: ArtifactPreprocessorJobProfile): void
{
	const scratchBytes = _BinaryBytes(profile.scratchSize);
	const internalUrl = new URL(profile.openCraneInternalUrl);
	const requestedCpu = _CpuMillicores(String(profile.resources.requests?.cpu ?? ""));
	const limitedCpu = _CpuMillicores(String(profile.resources.limits?.cpu ?? ""));
	const requestedMemory = _BinaryBytes(String(profile.resources.requests?.memory ?? ""));
	const limitedMemory = _BinaryBytes(String(profile.resources.limits?.memory ?? ""));
	if (!/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(profile.image) || !["Always", "IfNotPresent", "Never"].includes(profile.imagePullPolicy) || profile.serviceAccountName !== _SERVICE_ACCOUNT_NAME || profile.tokenAudience !== _TOKEN_AUDIENCE || profile.tokenPath !== _TOKEN_PATH || profile.bootstrapReferencePath !== _BOOTSTRAP_REFERENCE_PATH || profile.namespace === profile.serverNamespace || !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(profile.namespace) || profile.namespace.length > 63 || !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(profile.serverServiceName) || internalUrl.protocol !== "http:" || internalUrl.hostname !== `${profile.serverServiceName}.${profile.serverNamespace}.svc.cluster.local` || internalUrl.username || internalUrl.password || internalUrl.search || internalUrl.hash || (internalUrl.pathname !== "" && internalUrl.pathname !== "/") || !scratchBytes || scratchBytes < _MIN_SCRATCH_BYTES || scratchBytes > _MAX_SCRATCH_BYTES || !Number.isSafeInteger(profile.activeDeadlineSeconds) || profile.activeDeadlineSeconds < 1 || profile.activeDeadlineSeconds > _MAX_ACTIVE_DEADLINE_SECONDS || profile.ttlSecondsAfterFinished !== 0 || !requestedCpu || !limitedCpu || requestedCpu > limitedCpu || limitedCpu > _MAX_CPU_MILLICORES || !requestedMemory || !limitedMemory || requestedMemory > limitedMemory || limitedMemory > _MAX_MEMORY_BYTES)
	{
		throw new Error("artifact preprocessing Job profile requires one fixed worker identity, endpoint and token paths, immutable image, bounded scratch and lifetime, and complete CPU and memory resources");
	}
}

/** Reject a caller-selected namespace or a readable bootstrap reference before Kubernetes sees it. */
function _AssertAssignment(assignment: ArtifactPreprocessorJobAssignment, profile: ArtifactPreprocessorJobProfile): void
{
	if (![assignment.preprocessJobId, assignment.siloId, assignment.namespace, assignment.bootstrapReference].every(function _Valid(value): boolean { return _Bounded(value); }) || assignment.namespace !== profile.namespace || !__IsArtifactPreprocessBootstrapReference(assignment.bootstrapReference))
	{
		throw new Error("artifact preprocessing Job assignment requires bounded coordinates, the deployment-owned namespace, and an opaque bootstrap reference");
	}
}

/**
 * Builds a suspended, one-shot, unprivileged Job for one PDF preprocessing task.
 *
 * The builder checks the deployment profile and controller assignment before it creates a manifest.
 * That prevents a caller from widening the worker identity, broker endpoint, namespace, or bootstrap
 * reference. The returned Job starts suspended, leaving release to a separate controller action.
 * This package has no production caller yet; its contract test verifies the hardened shape and those
 * rejections.
 *
 * @param assignment - Controller-selected task coordinates and opaque bootstrap reference.
 * @param profile - Deployment-owned worker identity, broker endpoint, and resource policy.
 * @returns The suspended Kubernetes Job manifest for this preprocessing task.
 * @throws Error when either input would widen the constrained worker policy.
 */
export function __BuildArtifactPreprocessorJob(assignment: ArtifactPreprocessorJobAssignment, profile: ArtifactPreprocessorJobProfile): V1Job
{
	_AssertProfile(profile);
	_AssertAssignment(assignment, profile);
	const name = __ArtifactPreprocessorJobName(assignment);
	return {
		metadata: { name, namespace: profile.namespace, labels: { "app.kubernetes.io/component": "artifact-preprocessor", "opencrane.ai/artifact-preprocessor": name }, annotations: { "opencrane.ai/bootstrap-reference": assignment.bootstrapReference } },
		spec: {
			suspend: true,
			backoffLimit: 0,
			completions: 1,
			parallelism: 1,
			activeDeadlineSeconds: profile.activeDeadlineSeconds,
			ttlSecondsAfterFinished: 0,
			template: {
				metadata: { labels: { "app.kubernetes.io/component": "artifact-preprocessor", "opencrane.ai/artifact-preprocessor": name }, annotations: { "opencrane.ai/bootstrap-reference": assignment.bootstrapReference } },
				spec: {
					serviceAccountName: profile.serviceAccountName,
					automountServiceAccountToken: false,
					enableServiceLinks: false,
					restartPolicy: "Never",
					terminationGracePeriodSeconds: 0,
					securityContext: { runAsNonRoot: true, runAsUser: 65532, runAsGroup: 65532, fsGroup: 65532, seccompProfile: { type: "RuntimeDefault" } },
					containers: [{ name: "artifact-preprocessor", image: profile.image, imagePullPolicy: profile.imagePullPolicy, securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] }, readOnlyRootFilesystem: true }, env: [{ name: "OPENCRANE_INTERNAL_URL", value: profile.openCraneInternalUrl }, { name: "OPENCRANE_PREPROCESSOR_TOKEN_PATH", value: profile.tokenPath }, { name: "OPENCRANE_PREPROCESSOR_BOOTSTRAP_REFERENCE_PATH", value: profile.bootstrapReferencePath }, { name: "ARTIFACT_PREPROCESSOR_SCRATCH_DIRECTORY", value: "/scratch" }], resources: structuredClone(profile.resources), volumeMounts: [{ name: "opencrane-token", mountPath: "/var/run/opencrane/tokens", readOnly: true }, { name: "bootstrap-reference", mountPath: "/var/run/opencrane/bootstrap", readOnly: true }, { name: "scratch", mountPath: "/scratch" }] }],
					volumes: [{ name: "opencrane-token", projected: { defaultMode: 0o440, sources: [{ serviceAccountToken: { path: "opencrane.token", audience: profile.tokenAudience, expirationSeconds: 600 } }] } }, { name: "bootstrap-reference", downwardAPI: { defaultMode: 0o440, items: [{ path: "reference", fieldRef: { fieldPath: "metadata.annotations['opencrane.ai/bootstrap-reference']" } }] } }, { name: "scratch", emptyDir: { sizeLimit: profile.scratchSize } }],
				},
			},
		},
	};
}
