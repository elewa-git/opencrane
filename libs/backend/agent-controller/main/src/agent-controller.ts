import { createHash } from "node:crypto";

import type { AgentControllerDependencies, AgentControllerReconcileResult, AgentJobProjection, DesiredAgentJob, ObservedAgentJob } from "./agent-controller.types.js";

/** Reconcile one authority-selected run into one tightly bounded Kubernetes Job. */
export async function __ReconcileAgentJob(dependencies: AgentControllerDependencies): Promise<AgentControllerReconcileResult>
{
	// 1. Load one desired state record from the OpenCrane authority, never from controller storage.
	const desired = await dependencies.desiredJobs.readNext();
	if (desired === null)
	{
		return { outcome: "idle" };
	}
	if (!_IsAllowedDesiredJob(desired, dependencies.policy))
	{
		await dependencies.status.rejectDesired(desired, "invalid_desired_job");
		return { outcome: "rejected", reason: "invalid_desired_job", runId: desired.runId, attempt: desired.attempt };
	}

	// 2. Create only an inert projection and durably acknowledge its immutable Kubernetes UID.
	const projection = _BuildJobProjection(desired);
	const existing = await dependencies.jobs.get(projection);
	const observed = existing ?? await dependencies.jobs.createSuspended(projection);
	if (!_MatchesProjection(observed, projection))
	{
		return { outcome: "rejected", reason: "mismatched_existing_job", runId: desired.runId, attempt: desired.attempt };
	}
	if (existing === null && !observed.suspended)
	{
		// 3. A new Job active before acknowledgement could have executed without a UID-bound bootstrap.
		await dependencies.jobs.delete(projection, observed.uid);
		await dependencies.status.rejectDesired(desired, "unsafe_existing_job");
		return { outcome: "rejected", reason: "unsafe_existing_job", runId: desired.runId, attempt: desired.attempt };
	}
	const start = await dependencies.status.recordJob(desired, projection, observed.uid);
	if (!start.bootstrapReady)
	{
		if (!observed.suspended)
		{
			await dependencies.jobs.delete(projection, observed.uid);
			await dependencies.status.rejectDesired(desired, "unsafe_existing_job");
			return { outcome: "rejected", reason: "unsafe_existing_job", runId: desired.runId, attempt: desired.attempt };
		}
		return { outcome: "prepared", runId: desired.runId, attempt: desired.attempt, workloadUid: observed.uid };
	}

	// 4. Permit execution only after OpenCrane proves UID-bound bootstrap delivery, then report Pod identity.
	if (observed.suspended)
	{
		await dependencies.jobs.unsuspend(projection, observed.uid);
	}
	const podUid = await dependencies.jobs.firstPodUid(projection, observed.uid);
	if (podUid !== null)
	{
		await dependencies.status.recordPod(desired, projection, observed.uid, podUid);
	}
	return { outcome: "reconciled", runId: desired.runId, attempt: desired.attempt, workloadUid: observed.uid, podUid };
}

/** Build a deterministic projection that carries no untrusted Kubernetes fields. */
export function _BuildJobProjection(desired: DesiredAgentJob): AgentJobProjection
{
	return {
		name: _KubernetesJobName(desired.runId, desired.attempt),
		namespace: desired.namespace,
		labels: {
			"app.kubernetes.io/component": "agent-runtime",
			"opencrane.io/run-id": desired.runId,
			"opencrane.io/run-attempt": String(desired.attempt),
			"opencrane.io/agent-service-id": desired.agentServiceId,
			"opencrane.io/agent-revision-id": desired.agentRevisionId,
			"opencrane.io/silo-id": desired.siloId,
		},
		serviceAccountName: desired.serviceAccountName,
		image: desired.image,
		suspend: true,
		backoffLimit: 0,
	};
}

/** Reject a desired record that tries to widen the controller's immutable boundary. */
function _IsAllowedDesiredJob(desired: DesiredAgentJob, policy: AgentControllerDependencies["policy"]): boolean
{
	return /^[a-z0-9][a-z0-9-]{0,62}$/.test(desired.runId)
		&& Number.isSafeInteger(desired.attempt) && desired.attempt > 0
		&& _IsKubernetesLabelValue(desired.agentServiceId) && _IsKubernetesLabelValue(desired.agentRevisionId) && _IsKubernetesLabelValue(desired.siloId)
		&& desired.namespace === policy.runtimeNamespace
		&& desired.serviceAccountName === policy.runtimeServiceAccountName
		&& desired.image === policy.runtimeImage;
}

/** Convert a durable identifier to the Kubernetes DNS-label segment used in the deterministic name. */
function _KubernetesJobName(runId: string, attempt: number): string
{
	const prefix = "agent-run-";
	const digest = createHash("sha256").update(`${runId}:${attempt}`).digest("hex").slice(0, 16);
	const suffix = `-${digest}-a${attempt}`;
	return `${prefix}${runId.slice(0, 63 - prefix.length - suffix.length)}${suffix}`;
}

/** Return whether an authority identifier can be emitted unchanged as a Kubernetes label value. */
function _IsKubernetesLabelValue(value: string): boolean
{
	return /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(value) && value.length <= 63;
}

/** Verify a named existing Job still belongs to the exact desired run projection. */
function _MatchesProjection(observed: ObservedAgentJob, projection: AgentJobProjection): boolean
{
	return observed.name === projection.name
		&& Object.entries(projection.labels).every(function _matchingLabel([key, value]) { return observed.labels[key] === value; });
}
