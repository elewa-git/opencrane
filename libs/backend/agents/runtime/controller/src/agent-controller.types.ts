import type { V1Job, V1Pod, V1Secret } from "@kubernetes/client-node";
import type { Logger } from "@opencrane/backend/observability";
import type { AgentControllerRunAttemptAssignmentCommand, AgentControllerRunAttemptAssignmentResult, AgentControllerRunAttemptClaim, AgentControllerRunWorkloadRegistrationCommand, AgentControllerRunWorkloadRegistrationResult, AgentControllerRunWorkloadReleaseClaim } from "@opencrane/contracts";
import type { AgentRuntimeJobProfile } from "@opencrane/backend/agents/runtime/k8s-launcher";

/** One deployment-owned runtime profile and the sole namespace where it may create workloads. */
export interface AgentControllerRuntimeProfile extends AgentRuntimeJobProfile
{
	/** Dedicated namespace containing only Jobs and Pods of this identity profile. */
	readonly namespace: string;
}

/** Immutable runtime profiles keyed by the authority-owned profile name. */
export type AgentControllerRuntimeProfiles = Readonly<Record<string, AgentControllerRuntimeProfile>>;

/** OpenCrane authority operations available to the outbound-only controller. */
export interface AgentControllerAuthority
{
	/** Claim one durable run-attempt request, or return null when no work is ready. */
	__Claim(signal: AbortSignal): Promise<AgentControllerRunAttemptClaim | null>;
	/** Atomically persist the exact suspended Job UID for the claimed attempt. */
	__CommitAssignment(eventId: string, command: AgentControllerRunAttemptAssignmentCommand, signal: AbortSignal): Promise<AgentControllerRunAttemptAssignmentResult>;
	/** Claim one assigned workload that is ready for release, or return null when none is ready. */
	__ClaimWorkloadRelease(signal: AbortSignal): Promise<AgentControllerRunWorkloadReleaseClaim | null>;
	/** Atomically register the first exact Pod created by the assigned Job. */
	__RegisterFirstPod(eventId: string, command: AgentControllerRunWorkloadRegistrationCommand, signal: AbortSignal): Promise<AgentControllerRunWorkloadRegistrationResult>;
	/** Delete one bounded batch of successful, retention-expired run outbox records. */
	__PrunePublishedOutbox?(signal: AbortSignal): Promise<number>;
}

/** Kubernetes operations available to the assignment and release reconciliations. */
export interface AgentControllerKubernetesStore
{
	/** Create or exact-adopt the suspended attempt Job without changing it. */
	__EnsureSuspendedJob(expected: V1Job): Promise<V1Job>;
	/**
	 * Create the immutable, Job-owned attempt-scoped key Secret, or accept an existing one.
	 *
	 * Create-only: the store has no `get`/`list` on Secrets. An AlreadyExists response is treated as
	 * the idempotent replay of this exact attempt's prior creation, never re-read.
	 */
	__EnsureAttemptKeySecret(expected: V1Secret): Promise<void>;
	/** Exact-adopt or conditionally release the assigned Job within its absolute authority lifetime. */
	__EnsureRuntimeJobReleased(expected: V1Job, workloadUid: string, assignmentExpiresAt: string, releaseLeaseExpiresAt: string): Promise<V1Job>;
	/** Return the unique exact first Pod, or null while Kubernetes has not created one. */
	__FindFirstRuntimePod(expectedJob: V1Job, workloadUid: string, serviceAccountName: string): Promise<V1Pod | null>;
}

/** Dependencies and fixed policy for the controller reconciliation loop. */
export interface AgentControllerOptions
{
	/** Authenticated OpenCrane desired-state and assignment authority. */
	readonly authority: AgentControllerAuthority;
	/** Least-privilege Kubernetes projection and release adapter. */
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

/** Result of one desired-state poll. */
export type AgentControllerReconcileResult =
	| { readonly outcome: AgentControllerReconcileOutcomes.Idle }
	| { readonly outcome: "assigned" | "idempotent"; readonly eventId: string; readonly runId: string; readonly attempt: number; readonly workloadUid: string };

/** Controller-owned loop outcomes that determine whether another poll may be delayed. */
export enum AgentControllerReconcileOutcomes
{
	/** No durable work was claimable. */
	Idle = "idle",
	/** Release succeeded but Kubernetes has not created the uniquely owned first Pod. */
	PendingPod = "pending-pod",
}

/** Result of one workload-release poll. */
export type AgentControllerRuntimeReleaseReconcileResult =
	| { readonly outcome: AgentControllerReconcileOutcomes.Idle }
	| { readonly outcome: AgentControllerReconcileOutcomes.PendingPod; readonly eventId: string; readonly runId: string; readonly attempt: number; readonly workloadUid: string }
	| { readonly outcome: "registered" | "idempotent"; readonly eventId: string; readonly runId: string; readonly attempt: number; readonly workloadUid: string; readonly podUid: string };
