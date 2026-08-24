import { __BuildSuspendedAgentRuntimeJob } from "@opencrane/backend/agents/runtime/k8s-launcher";

import { _ResolveAgentControllerRuntimeProfile } from "./agent-controller-profiles";
import { AgentControllerReconcileOutcomes, type AgentControllerOptions, type AgentControllerReconcileResult } from "./agent-controller.types";
import { _AgentRuntimeAttemptKeySecretName, _BuildAgentRuntimeAttemptKeySecret } from "./agent-runtime-attempt-key";

/** Return the workload UID the projection store assigned, or throw when it is missing. */
function _RequireWorkloadUid(uid: string | undefined): string
{
	if (!uid || uid.trim().length === 0)
	{
		throw new Error("workload store did not return an immutable UID for the suspended runtime projection");
	}
	return uid;
}

/**
 * Reconcile one claimed attempt into a durable, still-suspended assignment.
 *
 * Workload changes before the database commit are safe only because the projection remains suspended.
 * A retry may exact-adopt that inert object, but unrecorded agent code can never start.
 * @param options - Fixed authority, profiles, workload adapter, and logger.
 * @param signal - Process shutdown propagated to authority calls.
 * @returns Idle or the exact durable assignment outcome.
 */
export async function __ReconcileNextAgentRuntimeAttempt(options: AgentControllerOptions, signal: AbortSignal): Promise<AgentControllerReconcileResult>
{
	// 1. Take the next claim from OpenCrane, so what should run is decided there and never by the workload adapter.
	const claim = await options.authority.__Claim(signal);
	if (!claim) return { outcome: AgentControllerReconcileOutcomes.Idle };

	// 2. Match the claim to one configured profile, and check it names that profile's own namespace.
	const profile = _ResolveAgentControllerRuntimeProfile(options.profiles, claim.attempt.workloadProfile);
	if (!profile || claim.attempt.namespace !== profile.namespace || profile.serverNamespace === profile.namespace)
	{
		throw new Error("claimed runtime attempt does not match this controller's bounded workload profile namespace");
	}
	const assignment = {
		runId: claim.attempt.runId,
		attempt: claim.attempt.attempt,
		agentServiceId: claim.attempt.agentServiceId,
		agentRevisionId: claim.attempt.agentRevisionId,
		siloId: claim.attempt.siloId,
		namespace: claim.attempt.namespace,
		bootstrapReference: claim.attempt.bootstrapReference,
		litellmKeySecretName: _AgentRuntimeAttemptKeySecretName(claim.attempt.bootstrapReference),
	};
	const job = __BuildSuspendedAgentRuntimeJob(assignment, profile);

	// 3. Create the suspended projection (or accept an identical existing one) and take its workload UID.
	const persistedJob = await options.workloads.__EnsureSuspendedJob(job);
	const workloadUid = _RequireWorkloadUid(persistedJob.metadata?.uid);

	// 4. Let the selected adapter project the attempt key when its model strategy requires one.
	const attemptKeySecret = _BuildAgentRuntimeAttemptKeySecret(persistedJob, workloadUid, assignment.litellmKeySecretName, claim.attempt.litellmKey);
	await options.workloads.__EnsureAttemptKeySecret(attemptKeySecret);

	// 5. Commit the exact workload UID so a separate durable claim may release it.
	const committed = await options.authority.__CommitAssignment(claim.lease.eventId, {
		claimedAt: claim.lease.claimedAt,
		deliveryCount: claim.lease.deliveryCount,
		runId: claim.attempt.runId,
		attempt: claim.attempt.attempt,
		expectedWorkloadProfile: claim.attempt.workloadProfile,
		bootstrapReference: claim.attempt.bootstrapReference,
		namespace: claim.attempt.namespace,
		serviceAccountName: profile.serviceAccountName,
		workloadUid,
	}, signal);

	options.log.info({ eventId: claim.lease.eventId, runId: claim.attempt.runId, attempt: claim.attempt.attempt, workloadUid, outcome: committed.outcome }, "runtime attempt assigned to suspended workload");
	return { outcome: committed.outcome, eventId: claim.lease.eventId, runId: claim.attempt.runId, attempt: claim.attempt.attempt, workloadUid };
}
