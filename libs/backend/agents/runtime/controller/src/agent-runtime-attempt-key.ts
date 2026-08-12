import type { V1Job, V1Secret } from "@kubernetes/client-node";

/**
 * Derive the deterministic per-attempt Secret name carrying the attempt-scoped LiteLLM key.
 * @param bootstrapReference - Stable per-attempt reference issued by OpenCrane authority.
 * @returns DNS-compatible Secret name shared by assignment and release reconciliation.
 */
export function _AgentRuntimeAttemptKeySecretName(bootstrapReference: string): string
{
	const prefix = "bootstrap-v1_";
	const suffix = bootstrapReference.startsWith(prefix) ? bootstrapReference.slice(prefix.length, prefix.length + 32) : "";
	return suffix.length === 32 ? `litellm-key-${suffix}` : "litellm-key-profilevalidation";
}

/** Build one immutable, Job-owned Secret carrying bounded transient attempt-key data. */
function _BuildAgentRuntimeKeySecret(persistedJob: V1Job, workloadUid: string, secretName: string, stringData: Record<string, string>): V1Secret
{
	const namespace = persistedJob.metadata?.namespace;
	const jobName = persistedJob.metadata?.name;
	if (!namespace || !jobName)
	{
		throw new Error("suspended runtime Job is missing the metadata needed to own its key Secret");
	}
	if (Object.values(stringData).some(function _Blank(value) { return typeof value !== "string" || value.length === 0; }))
	{
		throw new Error("claimed runtime attempt is missing its transient attempt-scoped key");
	}
	return {
		apiVersion: "v1",
		kind: "Secret",
		type: "Opaque",
		immutable: true,
		metadata: {
			name: secretName,
			namespace,
			labels: { "app.kubernetes.io/name": "opencrane-agent-runtime", "app.kubernetes.io/component": "agent-runtime" },
			ownerReferences: [{ apiVersion: "batch/v1", kind: "Job", name: jobName, uid: workloadUid, controller: true, blockOwnerDeletion: true }],
		},
		stringData,
	};
}

/**
 * Build the immutable, Job-owned Secret carrying one transient attempt-scoped model key.
 * @param persistedJob - Created or exact-adopted suspended Job carrying its API identity.
 * @param workloadUid - Immutable Job UID that owns the Secret.
 * @param secretName - Deterministic per-attempt Secret name projected by the Job.
 * @param key - Transient attempt-scoped key value; never the LiteLLM master key.
 * @returns Immutable Secret garbage-collected with the exact Job.
 */
export function _BuildAgentRuntimeAttemptKeySecret(persistedJob: V1Job, workloadUid: string, secretName: string, key: string): V1Secret
{
	return _BuildAgentRuntimeKeySecret(persistedJob, workloadUid, secretName, { key });
}
