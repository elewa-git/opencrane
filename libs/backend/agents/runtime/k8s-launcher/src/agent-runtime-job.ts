import { createHash } from "node:crypto";
import type { V1Job } from "@kubernetes/client-node";

import { AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE, ___IsAgentRuntimeServiceAccountName, ___IsManagedAgentRuntimeServiceAccountName } from "@opencrane/contracts";

import type { AgentRuntimeIdentityProfile, AgentRuntimeJobAssignment, AgentRuntimeJobProfile } from "./agent-runtime-job.types.js";

/** Resolve the identity class a profile projects, defaulting to the personal runtime class. */
function _IdentityProfile(profile: AgentRuntimeJobProfile): AgentRuntimeIdentityProfile
{
	return profile.identityProfile ?? "personal";
}

/** Return the projected-token audience minted for the profile's identity class. */
function _ProjectedTokenAudience(profile: AgentRuntimeJobProfile): string
{
	return _IdentityProfile(profile) === "managed" ? MANAGED_AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE : AGENT_RUNTIME_PROJECTED_TOKEN_AUDIENCE;
}

/** Return whether a ServiceAccount name belongs to the profile's bounded identity class. */
function _IsIdentityServiceAccountName(profile: AgentRuntimeJobProfile, value: string): boolean
{
	return _IdentityProfile(profile) === "managed" ? ___IsManagedAgentRuntimeServiceAccountName(value) : ___IsAgentRuntimeServiceAccountName(value);
}

/** Exact component label selected by the runtime namespace's deployment-owned policy. */
const _COMPONENT_LABEL = "agent-runtime";

/** Exact projected-token path read by the runtime process. */
const _TOKEN_PATH = "/var/run/opencrane/tokens/runtime.token";

/** Read-only directory containing the downward-API bootstrap reference. */
const _BOOTSTRAP_MOUNT_PATH = "/var/run/opencrane/bootstrap";

/** Read-only directory containing the attempt-scoped LiteLLM virtual key. */
const _LITELLM_KEY_MOUNT_PATH = "/var/run/opencrane/litellm";

/** Secret item key and mounted filename of the attempt-scoped LiteLLM virtual key. */
const _LITELLM_KEY_FILENAME = "key";

/** Pod annotation projected as the non-secret bootstrap reference file. */
const _BOOTSTRAP_REFERENCE_ANNOTATION = "opencrane.ai/bootstrap-reference";

/** Hard ceiling for non-authoritative runtime-local scratch. */
const _MAX_SCRATCH_BYTES = 1_073_741_824n;

/** Safety margin ensuring whole-second Kubernetes deadline rounding cannot extend authority. */
const _RELEASE_DEADLINE_SAFETY_SECONDS = 1;

/** Reject blank or control-character-bearing authority coordinates. */
function _IsBoundedCoordinate(value: string): boolean
{
	return value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Parse a positive binary Kubernetes storage quantity into bytes. */
function _ParseBinaryBytes(value: string): bigint | null
{
	const match = /^([1-9][0-9]*)(Ki|Mi|Gi|Ti|Pi|Ei)$/.exec(value);
	if (!match) return null;
	const exponent = { Ki: 1n, Mi: 2n, Gi: 3n, Ti: 4n, Pi: 5n, Ei: 6n }[match[2] as "Ki" | "Mi" | "Gi" | "Ti" | "Pi" | "Ei"];
	return BigInt(match[1]) * (1024n ** exponent);
}

/** Parse a positive Kubernetes CPU quantity into millicores. */
function _ParseCpuMillis(value: string): number | null
{
	const milli = /^([1-9][0-9]*)m$/.exec(value);
	const cores = /^([0-9]+(?:\.[0-9]+)?)$/.exec(value);
	const parsed = milli ? Number(milli[1]) : cores ? Number(cores[1]) * 1000 : 0;
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Validate every deployment-owned runtime limit before the profile reaches Kubernetes.
 * The checks keep an authority bug from widening network reach, selecting a moving image, mounting
 * unbounded scratch, or granting a per-user identity through a supposedly bounded profile.
 */
function _AssertProfile(profile: AgentRuntimeJobProfile): void
{
	// 1. Pin the image and stream to the exact in-cluster endpoint the policy will admit.
	const streamUrl = URL.parse(profile.runtimeStreamUrl);
	if (!_IsBoundedCoordinate(profile.image) || !/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(profile.image) || !streamUrl || streamUrl.protocol !== "http:" || !streamUrl.hostname.endsWith(`.${profile.serverNamespace}.svc.cluster.local`) || streamUrl.pathname !== "/api/internal/agent-runtime" || streamUrl.search !== "" || streamUrl.hash !== "" || streamUrl.username !== "" || streamUrl.password !== "")
	{
		throw new Error("agent runtime profile requires an immutable image and an in-cluster HTTP stream URL");
	}
	if (!["Always", "IfNotPresent", "Never"].includes(profile.imagePullPolicy))
	{
		throw new Error("agent runtime profile requires a Kubernetes image pull policy");
	}

	// 1b. Pin the LiteLLM proxy to an in-cluster endpoint reached only with the attempt-scoped key.
	const litellmUrl = URL.parse(profile.litellmBaseUrl);
	if (!litellmUrl || (litellmUrl.protocol !== "http:" && litellmUrl.protocol !== "https:") || !litellmUrl.hostname.endsWith(".svc.cluster.local") || litellmUrl.username !== "" || litellmUrl.password !== "" || litellmUrl.hash !== "")
	{
		throw new Error("agent runtime profile requires an in-cluster LiteLLM base URL");
	}

	// 2. Bind the profile to one server namespace and the selected runtime identity class, never a
	//    per-user KSA and never the OTHER class's grammar (personal ⇔ managed are mutually exclusive).
	if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(profile.serverNamespace) || profile.serverNamespace.length > 63 || !_IsIdentityServiceAccountName(profile, profile.serviceAccountName))
	{
		throw new Error("agent runtime profile requires one valid server namespace and bounded runtime ServiceAccount");
	}

	// 3. Require the projected-token and lifecycle bounds shared with deployment policy.
	if (!Number.isSafeInteger(profile.projectedTokenTtlSeconds) || profile.projectedTokenTtlSeconds < 600 || profile.projectedTokenTtlSeconds > 3600)
	{
		throw new Error("agent runtime projected-token TTL must be between 600 and 3600 seconds");
	}

	// 4. Bound transient storage, lifecycle, CPU, and memory before the manifest reaches an adapter.
	const scratchBytes = _ParseBinaryBytes(profile.scratchSize);
	if (!scratchBytes || scratchBytes > _MAX_SCRATCH_BYTES || !Number.isSafeInteger(profile.activeDeadlineSeconds) || profile.activeDeadlineSeconds < 1 || profile.ttlSecondsAfterFinished !== 0)
	{
		throw new Error("agent runtime profile requires bounded scratch, a finite deadline, and immediate terminal cleanup");
	}
	const requestedCpu = _ParseCpuMillis(String(profile.resources.requests?.cpu ?? ""));
	const limitedCpu = _ParseCpuMillis(String(profile.resources.limits?.cpu ?? ""));
	const requestedMemory = _ParseBinaryBytes(String(profile.resources.requests?.memory ?? ""));
	const limitedMemory = _ParseBinaryBytes(String(profile.resources.limits?.memory ?? ""));
	if (!requestedCpu || !limitedCpu || requestedCpu > limitedCpu || !requestedMemory || !limitedMemory || requestedMemory > limitedMemory)
	{
		throw new Error("agent runtime profile requires valid CPU and memory requests no greater than limits");
	}
}

/** Validate assignment coordinates that cross from durable authority into Kubernetes metadata. */
function _AssertAssignment(assignment: AgentRuntimeJobAssignment): void
{
	if (!Number.isSafeInteger(assignment.attempt) || assignment.attempt < 1)
	{
		throw new Error("agent runtime attempt must be a positive safe integer");
	}
	for (const value of [assignment.runId, assignment.agentServiceId, assignment.agentRevisionId, assignment.siloId, assignment.namespace, assignment.bootstrapReference])
	{
		if (!_IsBoundedCoordinate(value))
		{
			throw new Error("agent runtime assignment contains an invalid authority coordinate");
		}
	}
	if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(assignment.namespace) || assignment.namespace.length > 63)
	{
		throw new Error("agent runtime namespace must be a valid DNS label");
	}
	if (!/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(assignment.litellmKeySecretName) || assignment.litellmKeySecretName.length > 253)
	{
		throw new Error("agent runtime assignment requires a valid LiteLLM key Secret name");
	}
}

/** Keep untrusted runtime Pods outside the namespace that contains the OpenCrane server. */
function _AssertSeparatedNamespaces(assignment: AgentRuntimeJobAssignment, profile: AgentRuntimeJobProfile): void
{
	if (assignment.namespace === profile.serverNamespace)
	{
		throw new Error("agent runtime Job and OpenCrane server require different namespaces");
	}
}

/**
 * Derive the stable Kubernetes name shared by one run attempt's resources.
 * Attempt coordinates are NUL-delimited before hashing so concatenation cannot create aliases.
 */
function _AttemptResourceName(assignment: AgentRuntimeJobAssignment): string
{
	const digest = createHash("sha256").update(`${assignment.siloId}\u0000${assignment.runId}\u0000${assignment.attempt}`).digest("hex").slice(0, 24);
	return `agent-runtime-a${assignment.attempt}-${digest}`;
}

/** Derive the deterministic runtime Job name from its durable attempt identity. */
export function __AgentRuntimeAttemptResourceName(siloId: string, runId: string, attempt: number): string
{
	const assignment = { siloId, runId, attempt, agentServiceId: "name-derivation", agentRevisionId: "name-derivation", namespace: "runtime", bootstrapReference: "name-derivation", litellmKeySecretName: "name-derivation" };
	_AssertAssignment(assignment);
	return _AttemptResourceName(assignment);
}

/** Build full authority annotations without forcing arbitrary identifiers into label grammar. */
function _AuthorityAnnotations(assignment: AgentRuntimeJobAssignment): Record<string, string>
{
	return {
		"opencrane.ai/run-id": assignment.runId,
		"opencrane.ai/run-attempt": String(assignment.attempt),
		"opencrane.ai/agent-service-id": assignment.agentServiceId,
		"opencrane.ai/agent-revision-id": assignment.agentRevisionId,
		"opencrane.ai/silo-id": assignment.siloId,
	};
}

/** Build selector-safe labels unique to the exact attempt. */
function _AttemptLabels(name: string): Record<string, string>
{
	return {
		"app.kubernetes.io/name": "opencrane-agent-runtime",
		"app.kubernetes.io/component": _COMPONENT_LABEL,
		"opencrane.ai/runtime-attempt": name,
	};
}

/** Build the suspended, one-Pod Job that cannot run before durable assignment commits. */
function _BuildJob(assignment: AgentRuntimeJobAssignment, profile: AgentRuntimeJobProfile, name: string, labels: Record<string, string>): V1Job
{
	const podAnnotations = { ..._AuthorityAnnotations(assignment), [_BOOTSTRAP_REFERENCE_ANNOTATION]: assignment.bootstrapReference };
	return {
		apiVersion: "batch/v1",
		kind: "Job",
		metadata: { name, namespace: assignment.namespace, labels: { ...labels }, annotations: _AuthorityAnnotations(assignment) },
		spec: {
			suspend: true,
			parallelism: 1,
			completions: 1,
			backoffLimit: 0,
			activeDeadlineSeconds: profile.activeDeadlineSeconds,
			ttlSecondsAfterFinished: profile.ttlSecondsAfterFinished,
			template: {
				metadata: { labels: { ...labels }, annotations: podAnnotations },
					spec: {
					serviceAccountName: profile.serviceAccountName,
					automountServiceAccountToken: false,
					enableServiceLinks: false,
					restartPolicy: "Never",
					terminationGracePeriodSeconds: 0,
					securityContext: { runAsNonRoot: true, runAsUser: 65532, runAsGroup: 65532, fsGroup: 65532, fsGroupChangePolicy: "OnRootMismatch", seccompProfile: { type: "RuntimeDefault" } },
					containers: [{
						name: _COMPONENT_LABEL,
						image: profile.image,
						imagePullPolicy: profile.imagePullPolicy,
						securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] }, readOnlyRootFilesystem: true },
						env: [
							{ name: "OPENCRANE_RUNTIME_STREAM_URL", value: profile.runtimeStreamUrl },
							{ name: "OPENCRANE_RUNTIME_TOKEN_PATH", value: _TOKEN_PATH },
							{ name: "OPENCRANE_RUNTIME_LITELLM_BASE_URL", value: profile.litellmBaseUrl },
							{ name: "OPENCRANE_RUNTIME_LITELLM_KEY_PATH", value: `${_LITELLM_KEY_MOUNT_PATH}/${_LITELLM_KEY_FILENAME}` },
							{ name: "POD_UID", valueFrom: { fieldRef: { fieldPath: "metadata.uid" } } },
						],
						volumeMounts: [
							{ name: "runtime-token", mountPath: "/var/run/opencrane/tokens", readOnly: true },
							{ name: "runtime-bootstrap", mountPath: _BOOTSTRAP_MOUNT_PATH, readOnly: true },
							{ name: "litellm-key", mountPath: _LITELLM_KEY_MOUNT_PATH, readOnly: true },
							{ name: "scratch", mountPath: "/tmp" },
						],
						resources: structuredClone(profile.resources),
					}],
					volumes: [
						{ name: "runtime-token", projected: { defaultMode: 0o440, sources: [{ serviceAccountToken: { path: "runtime.token", audience: _ProjectedTokenAudience(profile), expirationSeconds: profile.projectedTokenTtlSeconds } }] } },
						{ name: "runtime-bootstrap", downwardAPI: { defaultMode: 0o440, items: [{ path: "reference", fieldRef: { fieldPath: `metadata.annotations['${_BOOTSTRAP_REFERENCE_ANNOTATION}']` } }] } },
						// The attempt-scoped LiteLLM key is projected group-readable (0440); never the master
						// key, never a provider secret, and never a plaintext env var.
						{ name: "litellm-key", projected: { defaultMode: 0o440, sources: [{ secret: { name: assignment.litellmKeySecretName, items: [{ key: _LITELLM_KEY_FILENAME, path: _LITELLM_KEY_FILENAME }] } }] } },
						{ name: "scratch", emptyDir: { sizeLimit: profile.scratchSize } },
					],
				},
			},
		},
	};
}

/**
 * Build the exact Kubernetes Job for one personal-runtime attempt. The returned Job is
 * always suspended; the controller may unsuspend it only after persisting the Job UID together
 * with the PendingPod assignment and one-time bootstrap in the same authority transition.
 *
 * Runtime namespace ingress and egress are deployment-owned invariants rather than per-attempt
 * resources, so this pure builder deliberately has no Networking API surface.
 * @param assignment - Durable run coordinates that become workload annotations and identity.
 * @param profile - Bounded deployment-owned image, ServiceAccount, server, and resource limits.
 * @returns Deterministically named, still-suspended one-attempt Job.
 */
export function __BuildSuspendedAgentRuntimeJob(assignment: AgentRuntimeJobAssignment, profile: AgentRuntimeJobProfile): V1Job
{
	// 1. Reject malformed authority and release inputs before any adapter can send them to Kubernetes.
	_AssertAssignment(assignment);
	_AssertProfile(profile);
	_AssertSeparatedNamespaces(assignment, profile);

	// 2. Derive one collision-resistant identity reused by the Job and its Pod selector labels.
	const name = _AttemptResourceName(assignment);
	const labels = _AttemptLabels(name);

	// 3. Return only the suspended Job; Helm owns namespace-wide network isolation.
	return _BuildJob(assignment, profile, name, labels);
}

/**
 * Derive the conservative Kubernetes deadline for releasing one durable assignment.
 *
 * Kubernetes accepts only whole seconds. The result therefore rounds down, subtracts one further
 * safety second, and never exceeds the deployment-owned profile maximum. An expired or nearly
 * expired assignment fails before the controller can make the Job executable.
 * @param assignmentExpiresAt - Canonical UTC assignment expiry issued by Postgres authority.
 * @param nowEpochMilliseconds - Current controller wall-clock instant in epoch milliseconds.
 * @param profileMaximumSeconds - Maximum active lifetime permitted by the immutable profile.
 * @returns Positive whole seconds safe to patch into the assigned Job before release.
 */
export function __DeriveAgentRuntimeReleaseDeadlineSeconds(assignmentExpiresAt: string, nowEpochMilliseconds: number, profileMaximumSeconds: number): number
{
	const expiresAtEpochMilliseconds = Date.parse(assignmentExpiresAt);
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(assignmentExpiresAt)
		|| !Number.isSafeInteger(expiresAtEpochMilliseconds)
		|| new Date(expiresAtEpochMilliseconds).toISOString() !== assignmentExpiresAt
		|| !Number.isSafeInteger(nowEpochMilliseconds)
		|| nowEpochMilliseconds < 0
		|| !Number.isSafeInteger(profileMaximumSeconds)
		|| profileMaximumSeconds < 1)
	{
		throw new Error("agent runtime release requires canonical expiry, current time, and profile deadline");
	}
	const remainingWholeSeconds = Math.floor((expiresAtEpochMilliseconds - nowEpochMilliseconds) / 1_000) - _RELEASE_DEADLINE_SAFETY_SECONDS;
	if (remainingWholeSeconds <= 0)
	{
		throw new Error("agent runtime assignment expires before a safe Job release deadline");
	}
	return Math.min(profileMaximumSeconds, remainingWholeSeconds);
}
