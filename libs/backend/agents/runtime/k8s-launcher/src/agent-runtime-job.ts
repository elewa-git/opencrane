import type { V1Job } from "@kubernetes/client-node";

import type { AgentRuntimeJobAssignment, AgentRuntimeJobProfile } from "./agent-runtime-job.types.js";
import { _AssertAgentRuntimeJobProfile, _AgentRuntimeProjectedTokenAudience } from "./agent-runtime-profile.js";
import { _AgentRuntimeAttemptResourceName, _AssertAgentRuntimeJobAssignment } from "./agent-runtime-resource-name.js";

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

/** Keep untrusted runtime Pods outside the namespace that contains the OpenCrane server. */
function _AssertSeparatedNamespaces(assignment: AgentRuntimeJobAssignment, profile: AgentRuntimeJobProfile): void
{
	if (assignment.namespace === profile.serverNamespace)
	{
		throw new Error("agent runtime Job and OpenCrane server require different namespaces");
	}
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
						{ name: "runtime-token", projected: { defaultMode: 0o440, sources: [{ serviceAccountToken: { path: "runtime.token", audience: _AgentRuntimeProjectedTokenAudience(profile), expirationSeconds: profile.projectedTokenTtlSeconds } }] } },
						{ name: "runtime-bootstrap", downwardAPI: { defaultMode: 0o440, items: [{ path: "reference", fieldRef: { fieldPath: `metadata.annotations['${_BOOTSTRAP_REFERENCE_ANNOTATION}']` } }] } },
						// The attempt-scoped LiteLLM key is projected group-readable (0440); never the master
						// key, never a provider secret, and never a plaintext environment value.
						{ name: "litellm-key", projected: { defaultMode: 0o440, sources: [{ secret: { name: assignment.litellmKeySecretName, items: [{ key: _LITELLM_KEY_FILENAME, path: _LITELLM_KEY_FILENAME }] } }] } },
						{ name: "scratch", emptyDir: { sizeLimit: profile.scratchSize } },
					],
				},
			},
		},
	};
}

/**
 * Build the exact Kubernetes Job for one already-authorised runtime attempt.
 *
 * The returned Job is always suspended. Runtime namespace networking is deployment-owned, so this
 * pure builder deliberately has no Kubernetes client or Networking API surface.
 * @param assignment - Durable run coordinates projected into workload metadata.
 * @param profile - Bounded deployment-owned image, identity, endpoint, and resource policy.
 * @returns Deterministically named, still-suspended one-attempt Job.
 */
export function __BuildSuspendedAgentRuntimeJob(assignment: AgentRuntimeJobAssignment, profile: AgentRuntimeJobProfile): V1Job
{
	// 1. Reject malformed authority and release inputs before an adapter can send them to Kubernetes.
	_AssertAgentRuntimeJobAssignment(assignment);
	_AssertAgentRuntimeJobProfile(profile);
	_AssertSeparatedNamespaces(assignment, profile);

	// 2. Derive one collision-resistant identity reused by the Job and Pod selector labels.
	const name = _AgentRuntimeAttemptResourceName(assignment);
	const labels = _AttemptLabels(name);

	// 3. Return only the suspended Job; Helm owns namespace-wide network isolation.
	return _BuildJob(assignment, profile, name, labels);
}
