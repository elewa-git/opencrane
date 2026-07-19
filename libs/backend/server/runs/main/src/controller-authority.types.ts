/** Server-issued immutable desired Job descriptor for the database-blind controller. */
export interface ControllerDesiredJob
{
	/** Logical run identifier. */
	readonly runId: string;
	/** Current durable run attempt. */
	readonly attempt: number;
	/** Immutable AgentService identifier. */
	readonly agentServiceId: string;
	/** Immutable AgentRevision identifier. */
	readonly agentRevisionId: string;
	/** Silo authority identifier. */
	readonly siloId: string;
	/** Server-derived authorization subject. */
	readonly subjectId: string;
	/** Exact runtime namespace. */
	readonly namespace: string;
	/** Exact zero-RBAC runtime KSA. */
	readonly serviceAccountName: string;
	/** Exact immutable runtime image. */
	readonly image: string;
	/** Epoch-millisecond expiry for the assignment/bootstrap authority. */
	readonly expiresAtEpochMs: number;
}

/** Immutable Kubernetes Job observation supplied by the authenticated controller. */
export interface ControllerJobObservation
{
	/** Server-issued desired Job coordinates. */
	readonly desired: ControllerDesiredJob;
	/** Deterministic Kubernetes Job name. */
	readonly workloadName: string;
	/** Kubernetes-assigned immutable Job UID. */
	readonly workloadUid: string;
}

/** Immutable Pod observation supplied by the authenticated controller. */
export interface ControllerPodObservation extends ControllerJobObservation
{
	/** First immutable runtime Pod UID observed for the Job. */
	readonly podUid: string;
}

/** Exact controller identity extracted from a successful Kubernetes TokenReview. */
export interface VerifiedControllerIdentity
{
	/** TokenReview-confirmed service-account namespace. */
	readonly namespace: string;
	/** TokenReview-confirmed service-account name. */
	readonly serviceAccountName: string;
}

/** Persistence boundary for controller desired state and immutable acknowledgements. */
export interface ControllerAuthorityRepository
{
	/** Claim at most one reclaimable desired Job without publishing its outbox event. */
	claimDesiredJob(nowEpochMs: number): Promise<ControllerDesiredJob | null>;
	/** Persist the exact Job UID and bootstrap authority before returning readiness. */
	recordJob(observation: ControllerJobObservation, nowEpochMs: number): Promise<{ readonly bootstrapReady: boolean }>;
	/** Persist only the first exact Pod UID for the previously acknowledged Job. */
	recordPod(observation: ControllerPodObservation, nowEpochMs: number): Promise<void>;
	/** Fail one invalid desired record durably so it cannot starve later controller work. */
	rejectDesiredJob(runId: string, attempt: number, reason: string, nowEpochMs: number): Promise<void>;
}
