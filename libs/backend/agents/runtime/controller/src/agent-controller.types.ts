import type { V1Job, V1Pod, V1Secret } from "@kubernetes/client-node";
import type { Logger } from "@opencrane/backend/observability";
import type { AgentControllerRunAttemptAssignmentCommand, AgentControllerRunAttemptAssignmentResult, AgentControllerRunAttemptClaim, AgentControllerRunWorkloadRegistrationCommand, AgentControllerRunWorkloadRegistrationResult, AgentControllerRunWorkloadReleaseClaim } from "@opencrane/contracts";
import type { AgentRuntimeJobProfile } from "@opencrane/backend/agents/runtime/k8s-launcher";

/**
 * One runtime profile as the deployment configures it, plus the single namespace it owns.
 *
 * The profile carries everything a runtime Job needs that is not run-specific: image, identity,
 * endpoints, and limits. Adding the namespace here is what lets the controller refuse a claim whose
 * namespace does not match the profile it names, so a claim can never place a workload in another
 * profile's namespace.
 * @see {@link AgentRuntimeJobProfile}
 */
export interface AgentControllerRuntimeProfile extends AgentRuntimeJobProfile
{
	/** Dedicated namespace containing only Jobs and Pods of this identity profile. */
	readonly namespace: string;
}

/**
 * Runtime profiles, looked up by the profile name OpenCrane sends on a claim
 * (`claim.attempt.workloadProfile`). Built once at startup and never changed afterwards.
 * @see {@link __ValidateAgentControllerRuntimeProfiles}
 */
export type AgentControllerRuntimeProfiles = Readonly<Record<string, AgentControllerRuntimeProfile>>;

/**
 * Everything the controller asks OpenCrane for.
 *
 * The controller only ever calls out over HTTP. It runs no server and accepts no inbound request,
 * so what should run is always decided in OpenCrane and never inferred from the cluster.
 *
 * Each method is atomic on the OpenCrane side, because more than one controller replica may be
 * polling: the two claim methods hand out a lease so only one replica holds a given piece of work,
 * and the two commit methods are keyed by that lease's `eventId` so a redelivered claim cannot
 * apply twice.
 *
 * Called by: {@link __ReconcileNextAgentRuntimeAttempt}, {@link __ReconcileNextRuntimeRelease},
 * and the outbox prune step in agent-controller.ts. Implemented by
 * {@link __CreateHttpAgentControllerAuthority}.
 * @see {@link AgentControllerKubernetesStore}
 */
export interface AgentControllerAuthority
{
	/**
	 * Take the next run attempt that needs a Kubernetes Job, under a lease only this caller holds.
	 * @param signal - Process shutdown; aborting cancels the in-flight HTTP request.
	 * @returns The claim, whose `lease.eventId` must be passed back to
	 * {@link AgentControllerAuthority.__CommitAssignment}, or null when nothing is ready and the loop
	 * should sleep.
	 * @throws When OpenCrane answers with anything but 200 or 204, or with a body that fails
	 * validation. The loop logs it and retries on the next poll.
	 */
	__Claim(signal: AbortSignal): Promise<AgentControllerRunAttemptClaim | null>;
	/**
	 * Record the UID of the suspended Job created for this attempt, finishing the assignment.
	 *
	 * Nothing may unsuspend the Job until this has been recorded, so this call is the point after
	 * which agent code is allowed to run at all.
	 * @param eventId - The claim's `lease.eventId`; OpenCrane uses it to reject a stale or replayed commit.
	 * @param command - The recorded coordinates plus the UID Kubernetes issued.
	 * @param signal - Process shutdown; aborting cancels the in-flight HTTP request.
	 * @returns `assigned` for the commit that took effect, or `idempotent` when this attempt was
	 * already committed — both mean the assignment now stands, so a caller must not treat
	 * `idempotent` as a failure.
	 * @throws When OpenCrane answers with any status other than 200, or returns a result whose run,
	 * attempt, or workload UID does not match what was submitted.
	 */
	__CommitAssignment(eventId: string, command: AgentControllerRunAttemptAssignmentCommand, signal: AbortSignal): Promise<AgentControllerRunAttemptAssignmentResult>;
	/**
	 * Take the next already-assigned Job that is ready to be unsuspended, under its own lease.
	 * @param signal - Process shutdown; aborting cancels the in-flight HTTP request.
	 * @returns The claim, carrying the assignment expiry the released Job must not outlive, or null
	 * when nothing is ready and the loop should sleep.
	 * @throws When OpenCrane answers with anything but 200 or 204, or with a body that fails
	 * validation. The loop logs it and retries on the next poll.
	 */
	__ClaimWorkloadRelease(signal: AbortSignal): Promise<AgentControllerRunWorkloadReleaseClaim | null>;
	/**
	 * Record the first Pod the assigned Job created, once it is confirmed to be the expected one.
	 *
	 * This is what pins the Pod UID that the bootstrap exchange later checks, so it must happen
	 * before the runtime is allowed to exchange its bootstrap reference for credentials.
	 * @param eventId - The release claim's `lease.eventId`; OpenCrane uses it to reject a stale replay.
	 * @param command - Recorded coordinates plus the Pod UID observed in the cluster.
	 * @param signal - Process shutdown; aborting cancels the in-flight HTTP request.
	 * @returns `registered` for the call that took effect, or `idempotent` when this Pod was already
	 * registered — both mean the Pod now stands recorded.
	 * @throws When OpenCrane answers with any status other than 200, or returns a result whose run,
	 * attempt, workload UID, or Pod UID does not match what was submitted.
	 */
	__RegisterFirstPod(eventId: string, command: AgentControllerRunWorkloadRegistrationCommand, signal: AbortSignal): Promise<AgentControllerRunWorkloadRegistrationResult>;
	/**
	 * Delete a capped batch of run-outbox records that published successfully and are past retention.
	 *
	 * Optional: when a deployment does not provide it, the controller simply never prunes.
	 * @param signal - Process shutdown; aborting cancels the in-flight HTTP request.
	 * @returns How many records were deleted. A full batch means more remain for the next pass.
	 * @throws When OpenCrane answers with any status other than 200. The loop logs it and carries on.
	 */
	__PrunePublishedOutbox?(signal: AbortSignal): Promise<number>;
}

/**
 * Everything the controller does to Kubernetes.
 *
 * Deliberately small: create a suspended Job, create its key Secret, release the Job, find its
 * first Pod. There is no update, no delete, and no read of a Secret, so a bug in the controller
 * cannot rewrite or remove a workload — and a Job that does not match what OpenCrane recorded
 * makes every method here throw rather than get repaired.
 *
 * Called by: {@link __ReconcileNextAgentRuntimeAttempt} and {@link __ReconcileNextRuntimeRelease}.
 * Implemented by {@link __CreateKubernetesAgentControllerStore}.
 * @see {@link AgentControllerAuthority}
 */
export interface AgentControllerKubernetesStore
{
	/**
	 * Create the suspended attempt Job, or accept an existing one that matches exactly.
	 *
	 * Never modifies what it finds. An AlreadyExists reply means a previous poll got this far before
	 * failing, so the Job is read back and compared field by field.
	 * @param expected - The Job this attempt should have, from {@link __BuildSuspendedAgentRuntimeJob}.
	 * @returns The Job as Kubernetes holds it, including the UID the caller must commit.
	 * @throws When the existing Job is not suspended, or differs from `expected` in any owned field.
	 * The caller must not repair it: a mismatch means OpenCrane and the cluster disagree.
	 */
	__EnsureSuspendedJob(expected: V1Job): Promise<V1Job>;
	/**
	 * Create the immutable, Job-owned attempt-scoped key Secret, or accept an existing one.
	 *
	 * Create-only: the store has no `get`/`list` on Secrets. An AlreadyExists response is treated as
	 * the idempotent replay of this exact attempt's prior creation, never re-read.
	 */
	__EnsureAttemptKeySecret(expected: V1Secret): Promise<void>;
	/**
	 * Unsuspend the assigned Job, or accept it if a previous poll already did.
	 *
	 * The patch is conditional on the Job's UID and resource version, so a Job that changed under us
	 * is never released. Before returning, the released Job is checked again to confirm it cannot
	 * still be running after the assignment expires.
	 * @param expected - The Job rebuilt from the recorded coordinates.
	 * @param workloadUid - UID recorded at assignment; the Job's UID must equal it.
	 * @param assignmentExpiresAt - Canonical UTC instant the released Job must stop before.
	 * @param releaseLeaseExpiresAt - Expiry of the caller's release lease, folded into the deadline so
	 * a slow request cannot buy the Job extra running time.
	 * @returns The released Job as Kubernetes holds it.
	 * @throws When the Job differs from `expected`, when its UID does not match, when the conditional
	 * patch is rejected, when Kubernetes did not actually release it, or when the resulting deadline
	 * would let it outlive `assignmentExpiresAt`.
	 * @see {@link _PlanAgentRuntimeJobRelease}
	 */
	__EnsureRuntimeJobReleased(expected: V1Job, workloadUid: string, assignmentExpiresAt: string, releaseLeaseExpiresAt: string): Promise<V1Job>;
	/**
	 * Return the Job's first Pod once exactly one matches, or null while Kubernetes has not created it.
	 * @param expectedJob - The Job whose Pod is wanted; supplies the labels and namespace to match.
	 * @param workloadUid - UID recorded at assignment; part of the label selector.
	 * @param serviceAccountName - The ServiceAccount the Pod must be running as.
	 * @returns The one matching Pod, or null — null is normal and simply means poll again later.
	 * @throws When more than one Pod matches, since choosing between them could register the wrong
	 * one; and when the single match is not owned by the assigned Job or does not carry the expected
	 * labels and ServiceAccount.
	 * @see {@link _AssertExactFirstAgentRuntimePod}
	 */
	__FindFirstRuntimePod(expectedJob: V1Job, workloadUid: string, serviceAccountName: string): Promise<V1Pod | null>;
}

/**
 * Everything the controller loop needs: its two ports, its profiles, its timings, and its logger.
 *
 * Assembled once by `apps/agent-controller/src/index.ts` and never changed while the loop runs.
 * {@link __RunAgentController} validates the timings before its first poll.
 */
export interface AgentControllerOptions
{
	/** Authenticated client for the OpenCrane API that hands out claims and records assignments. */
	readonly authority: AgentControllerAuthority;
	/** Kubernetes adapter that creates the suspended Job and later releases it. */
	readonly kubernetes: AgentControllerKubernetesStore;
	/** Profiles selected by the claimed workload-profile name. */
	readonly profiles: AgentControllerRuntimeProfiles;
	/** Delay after an empty poll or a handled reconciliation failure. */
	readonly pollIntervalMilliseconds: number;
	/** Delay between durable outbox-retention maintenance attempts. */
	readonly outboxPruneIntervalMilliseconds?: number;
	/** Process-wide structured logger. */
	readonly log: Logger;
}

/**
 * What one assignment poll did.
 *
 * `Idle` means nothing was claimable and the loop may sleep. Anything else means a Job now exists
 * and its UID is recorded: `assigned` for the commit that took effect, `idempotent` when this
 * attempt had already been committed by an earlier poll. Both are success — a caller that treats
 * `idempotent` as a failure would keep retrying work that is already done.
 * @see {@link AgentControllerReconcileOutcomes}
 */
export type AgentControllerReconcileResult =
	| { readonly outcome: AgentControllerReconcileOutcomes.Idle }
	| { readonly outcome: "assigned" | "idempotent"; readonly eventId: string; readonly runId: string; readonly attempt: number; readonly workloadUid: string };

/**
 * The two outcomes {@link __RunAgentController} checks when deciding whether it may sleep.
 *
 * Every other outcome (`assigned`, `idempotent`, `registered`) means real work happened, so the
 * loop polls again straight away. These two are the exceptions:
 *
 * - `Idle` — nothing was claimable, so sleeping for the poll interval costs nothing.
 * - `PendingPod` — the Job was released but Kubernetes has not created its Pod yet. There is
 *   nothing to do until it does, so the loop sleeps; the release claim is handed out again on a
 *   later poll once its lease expires, and that pass finds the Pod.
 *
 * Counting `PendingPod` as work would spin the loop at full speed while Kubernetes schedules the
 * Pod. Counting `Idle` as work would do the same against an empty queue.
 */
export enum AgentControllerReconcileOutcomes
{
	/** No durable work was claimable. */
	Idle = "idle",
	/** Release succeeded, but the Job's first Pod does not exist yet. Not an error: a later poll picks the claim up again. */
	PendingPod = "pending-pod",
}

/**
 * What one release poll did.
 *
 * `Idle` means nothing was claimable. `PendingPod` means the Job was released but its Pod does not
 * exist yet, so nothing is owed until a later poll. `registered` and `idempotent` both mean the
 * first Pod is now recorded and the runtime may exchange its bootstrap reference — so a caller
 * must not read `idempotent` as a failure.
 * @see {@link AgentControllerReconcileOutcomes}
 */
export type AgentControllerRuntimeReleaseReconcileResult =
	| { readonly outcome: AgentControllerReconcileOutcomes.Idle }
	| { readonly outcome: AgentControllerReconcileOutcomes.PendingPod; readonly eventId: string; readonly runId: string; readonly attempt: number; readonly workloadUid: string }
	| { readonly outcome: "registered" | "idempotent"; readonly eventId: string; readonly runId: string; readonly attempt: number; readonly workloadUid: string; readonly podUid: string };
