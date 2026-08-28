import { createHash } from "node:crypto";
import type { V1Container, V1Job, V1ResourceRequirements, V1Volume } from "@kubernetes/client-node";

import { RuntimeWorkloadClaimClasses } from "@opencrane/backend/agents/runtime/workloads/contract";
import { MCP_EXECUTOR_PROJECTED_TOKEN_AUDIENCE, MCP_EXECUTOR_SERVICE_ACCOUNT_NAME } from "@opencrane/contracts";

import type { McpExecutorJobAssignment, McpExecutorJobProfile } from "./mcp-executor-job.types";

/** Path where the companion reads its rotating projected token. */
const _TOKEN_PATH = "/var/run/opencrane/tokens/executor.token";
/** Path where the companion reads the opaque execution reference. */
const _REFERENCE_PATH = "/var/run/opencrane/claim/reference";
/** Pod-local MCP endpoint the uploaded image must serve. */
const _MCP_SERVER_URL = "http://127.0.0.1:3000/mcp";
/** Maximum lifetime of one OCI-backed MCP Job. */
const _MAX_DEADLINE_SECONDS = 600;
/** Maximum scratch size granted to either container. */
const _MAX_SCRATCH_BYTES = 1_073_741_824n;
/** Maximum CPU limit granted to either container in millicores. */
const _MAX_CPU_MILLICORES = 4_000;

/** Accepts a short coordinate before it is copied into Kubernetes metadata. */
function _IsCoordinate(value: string): boolean
{
	return value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Accepts only immutable registry references addressed by a SHA-256 manifest digest. */
function _IsDigestImage(value: string): boolean
{
	return /^[a-z0-9][a-z0-9._:-]*(?:\/[a-z0-9][a-z0-9._/-]*)+@sha256:[a-f0-9]{64}$/.test(value);
}

/** Accepts a binary Kubernetes size and returns its byte count. */
function _BinaryBytes(value: string): bigint | null
{
	const match = /^([1-9][0-9]*)(Ki|Mi|Gi)$/.exec(value);
	if (!match)
		return null;
	const exponent = { Ki: 1n, Mi: 2n, Gi: 3n }[match[2] as "Ki" | "Mi" | "Gi"];
	return BigInt(match[1]) * (1024n ** exponent);
}

/** Parses a positive Kubernetes CPU quantity into millicores. */
function _CpuMillicores(value: string): number | null
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

/** Confirms a resource block has positive requests that do not exceed its limits. */
function _HasBoundedResources(resources: V1ResourceRequirements): boolean
{
	const requestCpu = _CpuMillicores(String(resources.requests?.cpu ?? ""));
	const limitCpu = _CpuMillicores(String(resources.limits?.cpu ?? ""));
	const requestMemory = _BinaryBytes(String(resources.requests?.memory ?? ""));
	const limitMemory = _BinaryBytes(String(resources.limits?.memory ?? ""));
	return requestCpu !== null && limitCpu !== null && requestCpu <= limitCpu && limitCpu <= _MAX_CPU_MILLICORES && requestMemory !== null && limitMemory !== null && requestMemory <= limitMemory && limitMemory <= 4_294_967_296n;
}

/** Accepts only the controller's fixed in-cluster MCP executor endpoint. */
function _IsInternalUrl(value: string, serverNamespace: string): boolean
{
	try
	{
		const url = new URL(value);
		const port = Number(url.port);
		const exactService = `opencrane-server.${serverNamespace}.svc.cluster.local`;
		const serviceSuffix = `-opencrane-server.${serverNamespace}.svc.cluster.local`;
		const releasePrefix = url.hostname.endsWith(serviceSuffix) ? url.hostname.slice(0, -serviceSuffix.length) : "";
		const isServerService = url.hostname === exactService || (releasePrefix.length > 0 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u.test(releasePrefix));
		return url.protocol === "http:" && isServerService && Number.isSafeInteger(port) && port > 0 && port <= 65_535 && url.pathname === "/api/internal/mcp-executor" && !url.username && !url.password && !url.search && !url.hash;
	}
	catch
	{
		return false;
	}
}

/** Rejects a profile that could widen the MCP Job's identity, destination, lifetime, or resources. */
function _AssertProfile(profile: McpExecutorJobProfile): void
{
	const scratchBytes = _BinaryBytes(profile.scratchSize);
	const namespacePattern = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
	if (!_IsDigestImage(profile.companionImage) || !["Always", "IfNotPresent", "Never"].includes(profile.imagePullPolicy) || profile.serviceAccountName !== MCP_EXECUTOR_SERVICE_ACCOUNT_NAME || profile.namespace === profile.serverNamespace || profile.namespace.length > 63 || !namespacePattern.test(profile.namespace) || !namespacePattern.test(profile.serverNamespace) || !_IsInternalUrl(profile.opencraneInternalUrl, profile.serverNamespace) || !Number.isSafeInteger(profile.projectedTokenTtlSeconds) || profile.projectedTokenTtlSeconds < 600 || profile.projectedTokenTtlSeconds > 3_600 || scratchBytes === null || scratchBytes > _MAX_SCRATCH_BYTES || !Number.isSafeInteger(profile.activeDeadlineSeconds) || profile.activeDeadlineSeconds < 1 || profile.activeDeadlineSeconds > _MAX_DEADLINE_SECONDS || !_HasBoundedResources(profile.serverResources) || !_HasBoundedResources(profile.companionResources))
	{
		throw new Error("MCP executor profile requires a fixed identity and endpoint, immutable companion image, isolated namespace, bounded resources, scratch, token, and lifetime");
	}
}

/** Rejects a claim, image, or namespace that does not match the MCP executor authority. */
function _AssertAssignment(assignment: McpExecutorJobAssignment, profile: McpExecutorJobProfile, now: Date): void
{
	const claim = assignment.claim;
	const claimedAt = Date.parse(claim.claimedAt);
	const expiresAt = Date.parse(claim.expiresAt);
	if (Number.isNaN(now.getTime()) || claim.workloadClass !== RuntimeWorkloadClaimClasses.McpExecutor || assignment.namespace !== profile.namespace || claim.profileName.length === 0 || claim.deliveryCount < 1 || !Number.isSafeInteger(claim.deliveryCount) || !Number.isFinite(claimedAt) || !Number.isFinite(expiresAt) || claimedAt >= expiresAt || now.getTime() >= expiresAt || ![claim.claimId, claim.siloId, claim.profileName, claim.idempotencyKey, claim.executionReference].every(_IsCoordinate) || !_IsDigestImage(assignment.registryReference))
	{
		throw new Error("MCP executor assignment requires a current MCP claim, immutable imported image, bounded coordinates, and the deployment-owned namespace");
	}
}

/** Returns a deterministic Job name without revealing claim or silo identifiers. */
function _McpExecutorJobName(assignment: McpExecutorJobAssignment): string
{
	const claim = assignment.claim;
	const digest = createHash("sha256").update(`${claim.siloId}\u0000${claim.claimId}`).digest("hex").slice(0, 24);
	return `mcp-exec-${digest}`;
}

/** Builds metadata that the controller can compare without placing the imported image in annotations. */
function _Annotations(assignment: McpExecutorJobAssignment): Record<string, string>
{
	return { "opencrane.ai/mcp-claim-id": assignment.claim.claimId, "opencrane.ai/silo-id": assignment.claim.siloId, "opencrane.ai/mcp-profile": assignment.claim.profileName, "opencrane.ai/mcp-execution-reference": assignment.claim.executionReference };
}

/** Builds the uploaded MCP server as a restartable init container without authority mounts. */
function _ServerContainer(assignment: McpExecutorJobAssignment, profile: McpExecutorJobProfile): V1Container
{
	return { name: "mcp-server", image: assignment.registryReference, imagePullPolicy: profile.imagePullPolicy, restartPolicy: "Always", securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] }, readOnlyRootFilesystem: true }, resources: structuredClone(profile.serverResources), volumeMounts: [{ name: "server-scratch", mountPath: "/tmp" }] };
}

/** Builds the companion that initiates every exchange and holds the projected OpenCrane token. */
function _CompanionContainer(profile: McpExecutorJobProfile): V1Container
{
	return { name: "mcp-companion", image: profile.companionImage, imagePullPolicy: profile.imagePullPolicy, securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] }, readOnlyRootFilesystem: true }, env: [{ name: "OPENCRANE_MCP_EXECUTOR_URL", value: profile.opencraneInternalUrl }, { name: "OPENCRANE_MCP_SERVER_URL", value: _MCP_SERVER_URL }, { name: "OPENCRANE_MCP_TOKEN_PATH", value: _TOKEN_PATH }, { name: "OPENCRANE_MCP_CLAIM_REFERENCE_PATH", value: _REFERENCE_PATH }, { name: "POD_UID", valueFrom: { fieldRef: { fieldPath: "metadata.uid" } } }], resources: structuredClone(profile.companionResources), volumeMounts: [{ name: "executor-token", mountPath: "/var/run/opencrane/tokens", readOnly: true }, { name: "claim-reference", mountPath: "/var/run/opencrane/claim", readOnly: true }, { name: "companion-scratch", mountPath: "/tmp" }] };
}

/** Gives only the companion its token and claim reference, while each container gets separate scratch space. */
function _Volumes(profile: McpExecutorJobProfile): V1Volume[]
{
	return [{ name: "executor-token", projected: { defaultMode: 0o440, sources: [{ serviceAccountToken: { path: "executor.token", audience: MCP_EXECUTOR_PROJECTED_TOKEN_AUDIENCE, expirationSeconds: profile.projectedTokenTtlSeconds } }] } }, { name: "claim-reference", downwardAPI: { defaultMode: 0o440, items: [{ path: "reference", fieldRef: { fieldPath: "metadata.annotations['opencrane.ai/mcp-execution-reference']" } }] } }, { name: "server-scratch", emptyDir: { sizeLimit: profile.scratchSize } }, { name: "companion-scratch", emptyDir: { sizeLimit: profile.scratchSize } }];
}

/**
 * Builds one suspended OCI-backed MCP Job from saved authority and deployment policy.
 *
 * The uploaded server runs as a restartable init container, so the companion controls the Job's
 * lifetime. Only the companion receives the projected token and claim reference. The controller
 * must record this Job's UID before release. The controller deletes that UID after the database
 * records a terminal execution.
 *
 * @param assignment - Database claim, imported image digest, and selected namespace.
 * @param profile - Fixed companion, identity, endpoint, and limits from deployment configuration.
 * @param now - Trusted controller time used to refuse an expired database lease.
 * @returns A deterministic, still-suspended two-container Job.
 * @throws When any authority, image, namespace, endpoint, identity, or resource bound is invalid.
 */
export function __BuildSuspendedMcpExecutorJob(assignment: McpExecutorJobAssignment, profile: McpExecutorJobProfile, now: Date): V1Job
{
	// 1. Validate both inputs before they can influence Kubernetes metadata or a container image.
	_AssertProfile(profile);
	_AssertAssignment(assignment, profile, now);

	// 2. Hash the claim into a Kubernetes name so labels do not reveal claim or silo identifiers.
	const name = _McpExecutorJobName(assignment);
	const labels = { "app.kubernetes.io/name": "opencrane-mcp-executor", "app.kubernetes.io/component": "mcp-executor", "opencrane.ai/mcp-workload": name };
	const annotations = _Annotations(assignment);

	// 3. Keep the Job suspended until the controller records its UID, with no Kubernetes retries.
	return { apiVersion: "batch/v1", kind: "Job", metadata: { name, namespace: assignment.namespace, labels, annotations }, spec: { suspend: true, backoffLimit: 0, completions: 1, parallelism: 1, activeDeadlineSeconds: profile.activeDeadlineSeconds, template: { metadata: { labels: { ...labels }, annotations: { ...annotations } }, spec: { serviceAccountName: profile.serviceAccountName, automountServiceAccountToken: false, enableServiceLinks: false, restartPolicy: "Never", terminationGracePeriodSeconds: 0, securityContext: { runAsNonRoot: true, runAsUser: 65532, runAsGroup: 65532, fsGroup: 65532, seccompProfile: { type: "RuntimeDefault" } }, initContainers: [_ServerContainer(assignment, profile)], containers: [_CompanionContainer(profile)], volumes: _Volumes(profile) } } } };
}
