import { createHash } from "node:crypto";
import type { V1Job } from "@kubernetes/client-node";

import { __BuildSkillAuthoringWorkloadJob } from "./skill-authoring-workload-job";
import { SkillWorkloadKinds } from "./skill-workload-job.types";
import type { SkillWorkloadJobAssignment, SkillWorkloadJobProfile } from "./skill-workload-job.types";
import { __BuildToolRunnerWorkloadJob } from "./tool-runner-workload-job";

/** Maximum size of the scratch filesystem. Nothing the platform relies on is stored there. */
const _MAX_SCRATCH_BYTES = 1_073_741_824n;

/** Smallest scratch size that still fits the unpacked authoring archive and the validation output. */
const _MIN_AUTHORING_SCRATCH_BYTES = 134_217_728n;

/** Smallest memory request that can load the pinned ClamAV signature database. */
const _MIN_AUTHORING_MEMORY_BYTES = 3_221_225_472n;

/** Smallest memory limit that lets the scan finish without Kubernetes killing it. */
const _MIN_AUTHORING_MEMORY_LIMIT_BYTES = 4_294_967_296n;

/** Maximum wall-clock lifetime granted to one untrusted governed-skill Job. */
const _MAX_ACTIVE_DEADLINE_SECONDS = 900;

/** Maximum CPU limit granted to one untrusted governed-skill Job in millicores. */
const _MAX_CPU_MILLICORES = 2_000;

/** Maximum memory limit granted to one untrusted governed-skill Job in bytes. */
const _MAX_MEMORY_BYTES = 4_294_967_296n;

/** Read-only path of the rotating projected capability token. */
const _CAPABILITY_TOKEN_PATH = "/var/run/opencrane/tokens/capability.token";
/** Fixed read-only downward-API bootstrap reference path. */
const _BOOTSTRAP_REFERENCE_PATH = "/var/run/opencrane/bootstrap/reference";

/**
 * Accepts a bootstrap URL only when it is an in-cluster address ending in `.svc.cluster.local` and
 * its path is exactly the worker route.
 *
 * The URL comes from the Helm chart, never from a worker. This function checks the shape only: a
 * valid in-cluster host, no username or password, and the exact path. Whether that address really is
 * the OpenCrane server is enforced elsewhere, by NetworkPolicy and by the bootstrap route itself.
 */
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

/**
 * Accepts an id only when it is short and free of control characters, before it goes into Kubernetes
 * metadata.
 *
 * This checks size and characters, not permissions. The shape of the bootstrap reference is checked
 * separately, because an annotation should stay useful for tracing without becoming a credential.
 */
function _IsBoundedCoordinate(value: string): boolean
{
	return value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Parses a Kubernetes size such as `512Mi` into bytes. Only `Ki`, `Mi` and `Gi` are accepted. */
function _ParseBinaryBytes(value: string): bigint | null
{
	const match = /^([1-9][0-9]*)(Ki|Mi|Gi)$/.exec(value);
	if (!match) return null;
	const exponent = { Ki: 1n, Mi: 2n, Gi: 3n }[match[2] as "Ki" | "Mi" | "Gi"];
	return BigInt(match[1]) * (1024n ** exponent);
}

/** Parses a strictly positive CPU quantity into millicores so requests and limits can be compared safely. */
function _ParseCpuMillis(value: string): number | null
{
	const milli = /^([1-9][0-9]*)m$/.exec(value);
	const cores = /^([1-9][0-9]*(?:\.[0-9]+)?)$/.exec(value);
	const parsedCores = cores ? Number(cores[1]) * 1_000 : 0;
	const parsed = milli ? Number(milli[1]) : parsedCores;
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Validates the deployment-owned Job policy before a controller can submit the worker manifest.
 *
 * Each condition is fail-closed. A Job needs a distinct class identity, a short-lived
 * exact-audience token, one constrained bootstrap endpoint, bounded ephemeral resources, and no
 * retry or retained scratch. Accepting a partial profile would silently widen worker authority.
 */
function _AssertProfile(profile: SkillWorkloadJobProfile): void
{
	// 1. Work out the one ServiceAccount and token audience this class may use. Never take them from the caller.
	const expectedServiceAccountName = profile.kind === SkillWorkloadKinds.Authoring ? "skill-authoring-default" : "tool-runner-default";
	const expectedAudience = profile.kind === SkillWorkloadKinds.Authoring ? "opencrane-skill-authoring" : "opencrane-tool-runner";

	// 2. Turn the profile's sizes into numbers, so requests, limits, and this class's minimums can be compared.
	const scratchBytes = _ParseBinaryBytes(profile.scratchSize);
	const requestedCpu = _ParseCpuMillis(String(profile.resources.requests?.cpu ?? ""));
	const limitedCpu = _ParseCpuMillis(String(profile.resources.limits?.cpu ?? ""));
	const requestedMemory = _ParseBinaryBytes(String(profile.resources.requests?.memory ?? ""));
	const limitedMemory = _ParseBinaryBytes(String(profile.resources.limits?.memory ?? ""));
	// 3. Reject the whole profile if any single check fails. Kubernetes must never get a partly-hardened manifest.
	if (!/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(profile.image) || !["Always", "IfNotPresent", "Never"].includes(profile.imagePullPolicy) || profile.serviceAccountName !== expectedServiceAccountName || profile.capabilityTokenAudience !== expectedAudience || !_IsBootstrapUrl(profile.bootstrapUrl) || profile.capabilityTokenPath !== _CAPABILITY_TOKEN_PATH || profile.bootstrapReferencePath !== _BOOTSTRAP_REFERENCE_PATH || profile.namespace.length > 63 || !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(profile.namespace) || profile.namespace === profile.serverNamespace || !scratchBytes || scratchBytes > _MAX_SCRATCH_BYTES || (profile.kind === SkillWorkloadKinds.Authoring && scratchBytes < _MIN_AUTHORING_SCRATCH_BYTES) || !Number.isSafeInteger(profile.activeDeadlineSeconds) || profile.activeDeadlineSeconds < 1 || profile.activeDeadlineSeconds > _MAX_ACTIVE_DEADLINE_SECONDS || profile.ttlSecondsAfterFinished !== 0 || !requestedCpu || !limitedCpu || requestedCpu > limitedCpu || limitedCpu > _MAX_CPU_MILLICORES || !requestedMemory || !limitedMemory || requestedMemory > limitedMemory || limitedMemory > _MAX_MEMORY_BYTES || (profile.kind === SkillWorkloadKinds.Authoring && (requestedMemory < _MIN_AUTHORING_MEMORY_BYTES || limitedMemory < _MIN_AUTHORING_MEMORY_LIMIT_BYTES)))
	{
		throw new Error("governed skill Job profile requires one fixed bootstrap endpoint, fixed audience and paths, class-bounded identity, immutable image, bounded resources, scratch, and lifetime");
	}
}

/**
 * Checks the ids the controller supplied, before they go into Job metadata.
 *
 * The assignment names a workload the database already reserved. It may not name a namespace other
 * than the profile's, and its bootstrap reference must be the hashed opaque form, so no readable
 * database id ends up in an annotation. Both are rejected here, before any Kubernetes object exists,
 * rather than being caught later by the bootstrap route.
 */
function _AssertAssignment(assignment: SkillWorkloadJobAssignment, profile: SkillWorkloadJobProfile): void
{
	if (![assignment.jobId, assignment.siloId, assignment.namespace, assignment.capabilityReference].every(function _isValid(value): boolean { return _IsBoundedCoordinate(value); }) || !/^skill-bootstrap-v1_[a-f0-9]{64}$/.test(assignment.capabilityReference) || assignment.namespace !== profile.namespace)
	{
		throw new Error("governed skill Job assignment requires bounded coordinates, an opaque bootstrap reference, and its deployment-owned namespace");
	}
}

/**
 * Builds the Job's Kubernetes name from a hash, so the name is safe in a label selector and reveals
 * no database ids.
 *
 * The hash covers the workload class, the silo, and the job id, so the same id in another silo or
 * another class never produces the same Kubernetes name. This is naming only: the internal bootstrap
 * route still checks the worker's identity and its stored assignment before it accepts anything.
 */
export function __SkillWorkloadJobName(assignment: SkillWorkloadJobAssignment, profile: SkillWorkloadJobProfile): string
{
	const digest = createHash("sha256").update(`${profile.kind}\u0000${assignment.siloId}\u0000${assignment.jobId}`).digest("hex").slice(0, 24);
	return `${profile.kind === SkillWorkloadKinds.Authoring ? "skill-author" : "tool-run"}-${digest}`;
}

/**
 * Builds one unprivileged Job. The only credential-like value in it is the opaque reference the
 * worker trades for its real capability.
 *
 * The controller must record the Job's Kubernetes identity in the database before it unsuspends the
 * Job; until then `suspend: true` stops it from running. Once the Job finishes, `backoffLimit: 0`
 * stops any retry and `ttlSecondsAfterFinished: 0` deletes the Job and its scratch filesystem.
 */
export function __BuildGovernedSkillWorkloadJob(assignment: SkillWorkloadJobAssignment, profile: SkillWorkloadJobProfile): V1Job
{
	// 1. Reject a bad ServiceAccount, image, storage size, or lifetime before Kubernetes ever sees them.
	_AssertProfile(profile);
	_AssertAssignment(assignment, profile);

	// 2. Pick the builder for this workload class, so each class has its own named build function.
	return profile.kind === SkillWorkloadKinds.Authoring ? __BuildSkillAuthoringWorkloadJob(assignment, profile) : __BuildToolRunnerWorkloadJob(assignment, profile);
}

/**
 * Builds the hardened Job spec that both workload classes share. The class-specific builder makes
 * the surrounding Job object and calls this.
 *
 * The profile and assignment have already been checked. Do not add a second way to start work here,
 * and never put source code, tool arguments, artifacts, or credentials in the manifest: a worker
 * gets its short-lived capability only by presenting its projected token and the separate opaque
 * reference to the bootstrap route, which verifies both.
 */
export function __BuildSkillWorkloadJobSpec(profile: SkillWorkloadJobProfile, component: "skill-authoring" | "tool-runner", name: string, annotations: Readonly<Record<string, string>>): NonNullable<V1Job["spec"]>
{
	return {
		// 1. Lifecycle: the Job stays suspended until the controller has recorded it in the database. backoffLimit 0 means it never retries, and ttlSecondsAfterFinished 0 deletes it — and its scratch — as soon as it finishes.
		suspend: true,
		backoffLimit: 0,
		completions: 1,
		parallelism: 1,
		activeDeadlineSeconds: profile.activeDeadlineSeconds,
		ttlSecondsAfterFinished: 0,
		template: {
			metadata: { labels: { "app.kubernetes.io/component": component, "opencrane.ai/skill-workload": name }, annotations },
			spec: {
				// 2. Identity: no ServiceAccount token is automounted and no service-link env vars are injected, so the worker gets neither default credentials nor cluster service discovery.
				serviceAccountName: profile.serviceAccountName,
				automountServiceAccountToken: false,
				enableServiceLinks: false,
				restartPolicy: "Never",
				terminationGracePeriodSeconds: 0,
				securityContext: { runAsNonRoot: true, runAsUser: 65532, runAsGroup: 65532, fsGroup: 65532, seccompProfile: { type: "RuntimeDefault" } },
				// 3. Container: the digest-pinned image runs with no privilege escalation, all capabilities dropped, a read-only root filesystem, and one size-capped writable scratch mount.
				containers: [{ name: component, image: profile.image, imagePullPolicy: profile.imagePullPolicy, securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] }, readOnlyRootFilesystem: true }, env: [{ name: "OPENCRANE_SKILL_BOOTSTRAP_URL", value: profile.bootstrapUrl }, { name: "OPENCRANE_SKILL_TOKEN_PATH", value: profile.capabilityTokenPath }, { name: "OPENCRANE_SKILL_BOOTSTRAP_REFERENCE_PATH", value: profile.bootstrapReferencePath }], resources: structuredClone(profile.resources), volumeMounts: [{ name: "capability-token", mountPath: "/var/run/opencrane/tokens", readOnly: true }, { name: "bootstrap-reference", mountPath: "/var/run/opencrane/bootstrap", readOnly: true }, { name: "scratch", mountPath: "/tmp" }] }],
				// 4. Bootstrap: the audience-bound token and the opaque reference arrive as two separate read-only mounts.
				volumes: [{ name: "capability-token", projected: { defaultMode: 0o440, sources: [{ serviceAccountToken: { path: "capability.token", audience: profile.capabilityTokenAudience, expirationSeconds: 600 } }] } }, { name: "bootstrap-reference", downwardAPI: { defaultMode: 0o440, items: [{ path: "reference", fieldRef: { fieldPath: "metadata.annotations['opencrane.ai/capability-reference']" } }] } }, { name: "scratch", emptyDir: { sizeLimit: profile.scratchSize } }],
			},
		},
	};
}
