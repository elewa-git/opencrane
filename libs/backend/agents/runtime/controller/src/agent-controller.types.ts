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
 * @see {@link AgentControllerWorkloadStore}
 */
export interface AgentControllerAuthority
{
	/**
	 * Take the next run attempt that needs a workload projection, under a lease only this caller holds.
	 * @param signal - Process shutdown; aborting cancels the in-flight HTTP request.
	 * @returns The claim, whose `lease.eventId` must be passed back to
	 * {@link AgentControllerAuthority.__CommitAssignment}, or null when nothing is ready and the loop
	 * should sleep.
	 * @throws When OpenCrane answers with anything but 200 or 204, or with a body that fails
	 * validation. The loop logs it and retries on the next poll.
	 */
	__Claim(signal: AbortSignal): Promise<AgentControllerRunAttemptClaim | null>;
	/**
	 * Record the UID of the prepared workload created for this attempt, finishing the assignment.
	 *
	 * Nothing may release the workload until this has been recorded, so this call is the point after
	 * which agent code is allowed to run at all.
	 * @param eventId - The claim's `lease.eventId`; OpenCrane uses it to reject a stale or replayed commit.
	 * @param command - The recorded coordinates plus the UID the workload store issued.
	 * @param signal - Process shutdown; aborting cancels the in-flight HTTP request.
	 * @returns `assigned` for the commit that took effect, or `idempotent` when this attempt was
	 * already committed — both mean the assignment now stands, so a caller must not treat
	 * `idempotent` as a failure.
	 * @throws When OpenCrane answers with any status other than 200, or returns a result whose run,
	 * attempt, or workload UID does not match what was submitted.
	 */
	__CommitAssignment(eventId: string, command: AgentControllerRunAttemptAssignmentCommand, signal: AbortSignal): Promise<AgentControllerRunAttemptAssignmentResult>;
	/**
	 * Take the next already-assigned workload that is ready to be released, under its own lease.
	 * @param signal - Process shutdown; aborting cancels the in-flight HTTP request.
	 * @returns The claim, carrying the assignment expiry the released workload must not outlive, or null
	 * when nothing is ready and the loop should sleep.
	 * @throws When OpenCrane answers with anything but 200 or 204, or with a body that fails
	 * validation. The loop logs it and retries on the next poll.
	 */
	__ClaimWorkloadRelease(signal: AbortSignal): Promise<AgentControllerRunWorkloadReleaseClaim | null>;
	/**
	 * Record the first runtime instance once it is confirmed to be the expected one.
	 *
	 * This pins the instance UID that the bootstrap exchange later checks, so it must happen
	 * before the runtime is allowed to exchange its bootstrap reference for credentials.
	 * @param eventId - The release claim's `lease.eventId`; OpenCrane uses it to reject a stale replay.
	 * @param command - Recorded coordinates plus the runtime instance's workload-shaped UID.
	 * @param signal - Process shutdown; aborting cancels the in-flight HTTP request.
	 * @returns `registered` for the call that took effect, or `idempotent` when this instance was
	 * already registered — both mean the runtime identity now stands recorded.
	 * @throws When OpenCrane answers with any status other than 200, or returns a result whose run,
	 * attempt, workload UID, or instance UID does not match what was submitted.
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
 * Everything the controller asks its workload projection to do.
 *
 * Deliberately small: prepare an exact Job-shaped workload projection, project an attempt key when
 * its strategy requires one, release the workload, and find its first runtime instance. A projection
 * that does not match what OpenCrane recorded makes every method throw rather than get repaired.
 *
 * Production projects the shapes into Kubernetes. Tier 2 projects the same evidence into an
 * authenticated local process without changing the controller's authority protocol.
 *
 * Called by: {@link __ReconcileNextAgentRuntimeAttempt} and {@link __ReconcileNextRuntimeRelease}.
 * Implemented by {@link __CreateKubernetesAgentControllerStore} and
 * {@link __CreateLocalProcessAgentControllerStore}.
 * @see {@link AgentControllerAuthority}
 */
export interface AgentControllerWorkloadStore
{
	/**
	 * Prepare the suspended attempt projection, or accept an existing one that matches exactly.
	 *
	 * @param expected - The Job-shaped projection this attempt should have.
	 * @returns The exact prepared projection, including the UID the caller must commit.
	 * @throws When an existing projection is not suspended or differs in any owned field.
	 */
	__EnsureSuspendedJob(expected: V1Job): Promise<V1Job>;
	/**
	 * Project the attempt-scoped model key when the selected workload strategy requires it.
	 *
	 * A strategy without model access performs no projection. Replays must remain idempotent.
	 */
	__EnsureAttemptKeySecret(expected: V1Secret): Promise<void>;
	/**
	 * Release the assigned workload, or accept it if a previous poll already did.
	 *
	 * @param expected - The Job-shaped projection rebuilt from the recorded coordinates.
	 * @param workloadUid - UID recorded at assignment; the projection's UID must equal it.
	 * @param assignmentExpiresAt - Canonical UTC instant the released workload must stop before.
	 * @param releaseLeaseExpiresAt - Expiry of the caller's release lease, folded into the deadline so
	 * a slow operation cannot buy the workload extra running time.
	 * @returns The released Job-shaped projection.
	 * @throws When the projection differs from `expected`, its UID does not match, release fails, or
	 * its resulting deadline would outlive `assignmentExpiresAt`.
	 */
	__EnsureRuntimeJobReleased(expected: V1Job, workloadUid: string, assignmentExpiresAt: string, releaseLeaseExpiresAt: string): Promise<V1Job>;
	/**
	 * Return the workload's first runtime-instance evidence, or null while none exists.
	 * @param expectedJob - Job-shaped projection whose first instance is wanted.
	 * @param workloadUid - UID recorded at assignment.
	 * @param serviceAccountName - Workload identity the runtime instance must carry.
	 * @returns The one matching instance, or null when the adapter has not produced it yet.
	 * @throws When evidence is ambiguous or does not belong to the assigned workload.
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
	/** Workload adapter that prepares the suspended attempt and later releases it. */
	readonly workloads: AgentControllerWorkloadStore;
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
 * `Idle` means nothing was claimable and the loop may sleep. Anything else means a workload now exists
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
 * - `PendingPod` — the workload was released but its first-instance evidence does not exist. There is
 *   nothing to do until it does, so the loop sleeps; the release claim is handed out again on a
 *   later poll once its lease expires, and that pass finds the runtime instance.
 *
 * Counting `PendingPod` as work would spin the loop at full speed while the workload adapter starts
 * the runtime instance. Counting `Idle` as work would do the same against an empty queue.
 */
export enum AgentControllerReconcileOutcomes
{
	/** No durable work was claimable. */
	Idle = "idle",
	/** Release succeeded, but first-instance evidence does not exist yet. A later poll picks the claim up again. */
	PendingPod = "pending-pod",
}

/**
 * What one release poll did.
 *
 * `Idle` means nothing was claimable. `PendingPod` means the workload was released but its first
 * instance does not exist yet, so nothing is owed until a later poll. `registered` and `idempotent` both mean the
 * first runtime instance is now recorded and may exchange its bootstrap reference — so a caller
 * must not read `idempotent` as a failure.
 * @see {@link AgentControllerReconcileOutcomes}
 */
export type AgentControllerRuntimeReleaseReconcileResult =
	| { readonly outcome: AgentControllerReconcileOutcomes.Idle }
	| { readonly outcome: AgentControllerReconcileOutcomes.PendingPod; readonly eventId: string; readonly runId: string; readonly attempt: number; readonly workloadUid: string }
	| { readonly outcome: "registered" | "idempotent"; readonly eventId: string; readonly runId: string; readonly attempt: number; readonly workloadUid: string; readonly podUid: string };
