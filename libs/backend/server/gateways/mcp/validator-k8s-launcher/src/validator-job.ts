import { createHash } from "node:crypto";

import type { V1Job } from "@kubernetes/client-node";

import type { McpbValidatorJobAssignment, McpbValidatorJobProfile } from "./validator-job.types";

/** Fixed identity assigned to the MCP bundle validator worker. */
const _SERVICE_ACCOUNT_NAME = "mcpb-validator-default";
/** Fixed projected-token audience that no other workload class may use. */
const _TOKEN_AUDIENCE = "opencrane-mcpb-validator";
/** Read-only file containing the worker's short-lived projected token. */
const _TOKEN_PATH = "/var/run/opencrane/tokens/validator.token";
/** Read-only file containing the controller-created opaque bootstrap reference. */
const _REFERENCE_PATH = "/var/run/opencrane/bootstrap/reference";
/** Smallest scratch volume that can hold a bounded MCP bundle and extracted manifest. */
const _MIN_SCRATCH_BYTES = 134_217_728n;
/** Largest scratch volume the validator plane may request. */
const _MAX_SCRATCH_BYTES = 536_870_912n;
/** Largest validator Job lifetime. */
const _MAX_ACTIVE_DEADLINE_SECONDS = 600;
/** Largest CPU limit that this untrusted one-shot worker may receive. */
const _MAX_CPU_MILLICORES = 2_000;
/** Largest memory limit that this untrusted one-shot worker may receive. */
const _MAX_MEMORY_BYTES = 2_147_483_648n;

/** Return true only for a bounded Kubernetes-safe trace coordinate. */
function _IsBoundedCoordinate(value: string): boolean
{
	return value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Parse Ki, Mi, and Gi quantities into bytes. */
function _ParseBinaryBytes(value: string): bigint | null
{
	const match = /^([1-9][0-9]*)(Ki|Mi|Gi)$/u.exec(value);
	if (match === null)
	{
		return null;
	}
	const exponents = { Ki: 1n, Mi: 2n, Gi: 3n } as const;
	return BigInt(match[1]) * (1024n ** exponents[match[2] as keyof typeof exponents]);
}

/** Parse an integer millicore or decimal core quantity into millicores. */
function _ParseCpuMillis(value: string): number | null
{
	const millicores = /^([1-9][0-9]*)m$/u.exec(value);
	const cores = /^([1-9][0-9]*(?:\.[0-9]+)?)$/u.exec(value);
	let parsed = 0;
	if (millicores !== null)
	{
		parsed = Number(millicores[1]);
	}
	else if (cores !== null)
	{
		parsed = Number(cores[1]) * 1_000;
	}
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Accept the deployment-owned internal worker endpoint only when it has the fixed path and an in-cluster host. */
function _IsBootstrapUrl(value: string): boolean
{
	try
	{
		const parsed = new URL(value);
		const port = Number(parsed.port);
		return parsed.protocol === "http:" && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.svc\.cluster\.local$/u.test(parsed.hostname) && Number.isSafeInteger(port) && port >= 1 && port <= 65_535 && parsed.pathname === "/api/internal/mcpb-validator" && parsed.username === "" && parsed.password === "" && parsed.search === "" && parsed.hash === "";
	}
	catch
	{
		return false;
	}
}

/** Reject a profile that could widen the validator worker's identity, resources, or internal route. */
function _AssertProfile(profile: McpbValidatorJobProfile): void
{
	const scratchBytes = _ParseBinaryBytes(profile.scratchSize);
	const requestedCpu = _ParseCpuMillis(String(profile.resources.requests?.cpu ?? ""));
	const limitedCpu = _ParseCpuMillis(String(profile.resources.limits?.cpu ?? ""));
	const requestedMemory = _ParseBinaryBytes(String(profile.resources.requests?.memory ?? ""));
	const limitedMemory = _ParseBinaryBytes(String(profile.resources.limits?.memory ?? ""));
	if (!/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/u.test(profile.image) || !["Always", "IfNotPresent", "Never"].includes(profile.imagePullPolicy) || profile.serviceAccountName !== _SERVICE_ACCOUNT_NAME || profile.tokenAudience !== _TOKEN_AUDIENCE || !_IsBootstrapUrl(profile.bootstrapUrl) || profile.tokenPath !== _TOKEN_PATH || profile.bootstrapReferencePath !== _REFERENCE_PATH || profile.namespace === profile.serverNamespace || !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(profile.namespace) || profile.namespace.length > 63 || scratchBytes === null || scratchBytes < _MIN_SCRATCH_BYTES || scratchBytes > _MAX_SCRATCH_BYTES || !Number.isSafeInteger(profile.activeDeadlineSeconds) || profile.activeDeadlineSeconds < 1 || profile.activeDeadlineSeconds > _MAX_ACTIVE_DEADLINE_SECONDS || profile.ttlSecondsAfterFinished !== 0 || requestedCpu === null || limitedCpu === null || requestedCpu > limitedCpu || limitedCpu > _MAX_CPU_MILLICORES || requestedMemory === null || limitedMemory === null || requestedMemory > limitedMemory || limitedMemory > _MAX_MEMORY_BYTES)
	{
		throw new Error("MCP bundle validator Job profile requires its fixed identity, route, bounded resources, scratch, and lifetime");
	}
}

/** Reject caller values before they become labels, annotations, mounts, or Kubernetes resource names. */
function _AssertAssignment(assignment: McpbValidatorJobAssignment, profile: McpbValidatorJobProfile): void
{
	if (![assignment.validationId, assignment.siloId, assignment.namespace, assignment.bootstrapReference].every(function _IsValid(value): boolean { return _IsBoundedCoordinate(value); }) || !/^mcpb-validator-v1_[a-f0-9]{64}$/u.test(assignment.bootstrapReference) || assignment.namespace !== profile.namespace)
	{
		throw new Error("MCP bundle validator Job assignment requires bounded coordinates, an opaque reference, and the deployment-owned namespace");
	}
}

/**
 * Build a deterministic opaque Kubernetes Job name without exposing the validation identifier.
 *
 * Called by: `__BuildMcpbValidatorJob` and the focused builder test. Production has no caller yet.
 * It hashes the silo and validation identifiers, so Kubernetes resource names and selectors do not
 * reveal the durable validation record.
 *
 * @param assignment - Database-admitted coordinates for the one validator Job.
 * @returns A DNS-safe name that stays stable for the same validation in the same silo.
 */
export function __McpbValidatorJobName(assignment: McpbValidatorJobAssignment): string
{
	const digest = createHash("sha256").update(`${assignment.siloId}\u0000${assignment.validationId}`).digest("hex").slice(0, 24);
	return `mcpb-validate-${digest}`;
}

/**
 * Build the suspended, one-shot, restricted Job a future controller may submit after durable assignment.
 *
 * Called by: the focused builder test. Production has no caller yet. The returned Job has no bundle
 * bytes, artifact address, command, database connection, or long-lived credential. The future
 * controller must save Kubernetes' returned UID against the same durable assignment before it
 * removes `suspend`.
 *
 * @param assignment - Database-admitted opaque identifiers and the deployment-owned namespace.
 * @param profile - Trusted deployment limits for this worker class.
 * @returns A suspended Kubernetes Job with the exact validator identity, token audience, and limits.
 * @throws Error when either input could widen the worker's identity, route, resources, namespace, or reference.
 * @see __McpbValidatorJobName
 */
export function __BuildMcpbValidatorJob(assignment: McpbValidatorJobAssignment, profile: McpbValidatorJobProfile): V1Job
{
	// 1. Check fixed deployment policy before Kubernetes sees a manifest that could widen this worker's authority.
	_AssertProfile(profile);
	_AssertAssignment(assignment, profile);

	// 2. Derive opaque metadata. The manifest carries no bundle bytes, artifact address, command, or credentials.
	const name = __McpbValidatorJobName(assignment);
	const annotations = { "opencrane.ai/silo-id": assignment.siloId, "opencrane.ai/mcpb-validation": assignment.validationId, "opencrane.ai/mcpb-bootstrap-reference": assignment.bootstrapReference };

	// 3. Keep the Job suspended until the controller writes its Kubernetes UID to the durable validation assignment.
	return {
		apiVersion: "batch/v1",
		kind: "Job",
		metadata: { name, namespace: assignment.namespace, labels: { "app.kubernetes.io/name": "opencrane-mcpb-validator", "app.kubernetes.io/component": "mcpb-validator", "opencrane.ai/mcpb-validator": name }, annotations },
		spec: {
			suspend: true,
			backoffLimit: 0,
			completions: 1,
			parallelism: 1,
			activeDeadlineSeconds: profile.activeDeadlineSeconds,
			ttlSecondsAfterFinished: profile.ttlSecondsAfterFinished,
			template: {
				metadata: { labels: { "app.kubernetes.io/component": "mcpb-validator", "opencrane.ai/mcpb-validator": name }, annotations },
				spec: {
					serviceAccountName: profile.serviceAccountName,
					automountServiceAccountToken: false,
					enableServiceLinks: false,
					restartPolicy: "Never",
					terminationGracePeriodSeconds: 0,
					securityContext: { runAsNonRoot: true, runAsUser: 65532, runAsGroup: 65532, fsGroup: 65532, seccompProfile: { type: "RuntimeDefault" } },
					containers: [{ name: "mcpb-validator", image: profile.image, imagePullPolicy: profile.imagePullPolicy, securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] }, readOnlyRootFilesystem: true }, env: [{ name: "OPENCRANE_MCPB_BOOTSTRAP_URL", value: profile.bootstrapUrl }, { name: "OPENCRANE_MCPB_TOKEN_PATH", value: profile.tokenPath }, { name: "OPENCRANE_MCPB_BOOTSTRAP_REFERENCE_PATH", value: profile.bootstrapReferencePath }], resources: structuredClone(profile.resources), volumeMounts: [{ name: "validator-token", mountPath: "/var/run/opencrane/tokens", readOnly: true }, { name: "bootstrap-reference", mountPath: "/var/run/opencrane/bootstrap", readOnly: true }, { name: "scratch", mountPath: "/tmp" }] }],
					volumes: [{ name: "validator-token", projected: { defaultMode: 0o440, sources: [{ serviceAccountToken: { path: "validator.token", audience: profile.tokenAudience, expirationSeconds: 600 } }] } }, { name: "bootstrap-reference", downwardAPI: { defaultMode: 0o440, items: [{ path: "reference", fieldRef: { fieldPath: "metadata.annotations['opencrane.ai/mcpb-bootstrap-reference']" } }] } }, { name: "scratch", emptyDir: { sizeLimit: profile.scratchSize } }],
				},
			},
		},
	};
}
