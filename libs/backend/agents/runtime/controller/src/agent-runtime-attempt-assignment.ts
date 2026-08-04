import { __BuildSuspendedAgentRuntimeJob } from "@opencrane/backend/agents/runtime/k8s-launcher";

import { _ResolveAgentControllerRuntimeProfile } from "./agent-controller-profiles.js";
import { AgentControllerReconcileOutcomes, type AgentControllerOptions, type AgentControllerReconcileResult } from "./agent-controller.types.js";
import { _AgentRuntimeAttemptKeySecretName, _AgentRuntimeObotKeySecretName, _BuildAgentRuntimeAttemptKeySecret, _BuildAgentRuntimeObotKeySecret } from "./agent-runtime-attempt-key.js";

/** Require an immutable Job UID returned by the Kubernetes API. */
function _RequireWorkloadUid(uid: string | undefined): string
{
	if (!uid || uid.trim().length === 0)
	{
		throw new Error("Kubernetes did not return an immutable UID for the suspended runtime Job");
	}
	return uid;
}

/**
 * Reconcile one claimed attempt into a durable, still-suspended assignment.
 *
 * Kubernetes changes before the database commit are safe only because the Job remains suspended.
 * A retry may exact-adopt that inert object, but unrecorded agent code can never start.
 * @param options - Fixed authority, profiles, Kubernetes adapter, and logger.
 * @param signal - Process shutdown propagated to authority calls.
 * @returns Idle or the exact durable assignment outcome.
 */
export async function __ReconcileNextAgentRuntimeAttempt(options: AgentControllerOptions, signal: AbortSignal): Promise<AgentControllerReconcileResult>
{
	// 1. Claim desired state from OpenCrane so Kubernetes never becomes business authority.
	const claim = await options.authority.__Claim(signal);
	if (!claim) return { outcome: AgentControllerReconcileOutcomes.Idle };

	// 2. Bind the claim to one immutable profile and its deployment-owned namespace.
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
		obotKeySecretName: claim.attempt.obotKey === undefined ? undefined : _AgentRuntimeObotKeySecretName(claim.attempt.bootstrapReference),
	};
	const job = __BuildSuspendedAgentRuntimeJob(assignment, profile);

	// 3. Create or exact-adopt only the deterministic suspended Job and bind its API-issued UID.
	const persistedJob = await options.kubernetes.__EnsureSuspendedJob(job);
	const workloadUid = _RequireWorkloadUid(persistedJob.metadata?.uid);

	// 4. Create the Job-owned key Secret before any release reconciliation can unsuspend the Job.
	const attemptKeySecret = _BuildAgentRuntimeAttemptKeySecret(persistedJob, workloadUid, assignment.litellmKeySecretName, claim.attempt.litellmKey);
	await options.kubernetes.__EnsureAttemptKeySecret(attemptKeySecret);
	if (claim.attempt.obotKey !== undefined && assignment.obotKeySecretName !== undefined)
	{
		await options.kubernetes.__EnsureAttemptKeySecret(_BuildAgentRuntimeObotKeySecret(persistedJob, workloadUid, assignment.obotKeySecretName, claim.attempt.obotKey.key, claim.attempt.obotKey.keyId));
	}

	// 5. Commit the exact Job UID so a separate durable claim may release it.
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

	options.log.info({ eventId: claim.lease.eventId, runId: claim.attempt.runId, attempt: claim.attempt.attempt, workloadUid, outcome: committed.outcome }, "runtime attempt assigned to suspended Job");
	return { outcome: committed.outcome, eventId: claim.lease.eventId, runId: claim.attempt.runId, attempt: claim.attempt.attempt, workloadUid };
}
