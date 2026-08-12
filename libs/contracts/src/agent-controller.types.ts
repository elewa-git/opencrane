/** Sole projected-token audience accepted from the agent controller. */
export const AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE = "opencrane-agent-controller";

/** Exact Kubernetes ServiceAccount allowed to drive agent-workload reconciliation. */
export const AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME = "agent-controller";

/** How a runtime workload's cleanup is authorized. Stored with each outbox command. */
export enum RunWorkloadCleanupModes
{
	/** Cleanup may only touch the Job whose UID was recorded when the assignment was stored. */
	Assigned = "assigned",
	/** Cleanup may take over only the Job that is still suspended and was created before the assignment committed. */
	UnassignedOrphan = "unassigned_orphan",
}

/** Proof that this controller replica currently owns one outbox event. A newer claim invalidates it. */
export interface AgentControllerRunAttemptClaimLease
{
	/** Durable run-outbox event identifier. */
	readonly eventId: string;
	/** Time the database issued the claim; the commit must send it back unchanged to succeed. */
	readonly claimedAt: string;
	/** Delivery counter for this event; it only increases, and the commit must send it back with the claim time. */
	readonly deliveryCount: number;
	/** Database-derived instant after which another controller may reclaim the event. */
	readonly expiresAt: string;
}

/** The minimum the controller needs to build one suspended runtime Job. */
export interface AgentControllerRunAttemptProjection
{
	/** Logical run identifier. */
	readonly runId: string;
	/** Positive attempt number within the logical run. */
	readonly attempt: number;
	/** Silo authority containing the run. */
	readonly siloId: string;
	/** Stable AgentService executed by the attempt. */
	readonly agentServiceId: string;
	/** Immutable AgentRevision executed by the attempt. */
	readonly agentRevisionId: string;
	/** Digest of the run's compiled input. The controller gets this digest only, never the input itself. @see CompiledRunInput */
	readonly inputSnapshotDigest: string;
	/** Exact Kubernetes namespace in which the attempt must run. */
	readonly namespace: string;
	/** Name of the workload profile the controller must look up before building the Job. */
	readonly workloadProfile: string;
	/** Opaque bootstrap reference mounted into this attempt's Job. It is not a credential. @see __CreateSkillWorkloadBootstrapReference */
	readonly bootstrapReference: string;
	/**
	 * Attempt-scoped LiteLLM virtual key minted by the control plane at claim time.
	 *
	 * TRANSIENT ONLY: this value rides the claim HTTP response, is written straight into the
	 * per-attempt Kubernetes Secret by the controller, and is never persisted to Postgres or logged.
	 * It is a short-lived, budget- and alias-bound virtual key — never the LiteLLM master key or an
	 * upstream provider secret, both of which stay in the control plane.
	 */
	readonly litellmKey: string;
}

/** One claimed outbox event, together with the fields needed to build its suspended Job. */
export interface AgentControllerRunAttemptClaim
{
	/** Claim proof the controller must send back when it commits the assignment. */
	readonly lease: AgentControllerRunAttemptClaimLease;
	/** The attempt fields that are safe to give the Kubernetes controller. @see AgentControllerRunAttemptProjection */
	readonly attempt: AgentControllerRunAttemptProjection;
}

/** What the controller sends back to prove it created the suspended Job. */
export interface AgentControllerRunAttemptAssignmentCommand
{
	/** Exact database claim instant returned by the claim endpoint. */
	readonly claimedAt: string;
	/** Exact delivery generation returned by the claim endpoint. */
	readonly deliveryCount: number;
	/** Logical run expected on the claimed event. */
	readonly runId: string;
	/** Attempt expected on the claimed event. */
	readonly attempt: number;
	/** Named workload profile observed when the event was claimed. */
	readonly expectedWorkloadProfile: string;
	/** Exact opaque bootstrap reference returned by the claim authority. */
	readonly bootstrapReference: string;
	/** Namespace containing the already-created suspended Job. */
	readonly namespace: string;
	/** Bounded runtime-profile ServiceAccount selected for the Job. */
	readonly serviceAccountName: string;
	/** Immutable Kubernetes UID returned for the suspended Job. */
	readonly workloadUid: string;
}

/** Response to an assignment commit, whether it committed now or replayed an identical earlier commit. */
export interface AgentControllerRunAttemptAssignmentResult
{
	/** Whether this call committed the assignment or replayed its exact durable value. */
	readonly outcome: "assigned" | "idempotent";
	/** Logical run bound to the Job. */
	readonly runId: string;
	/** Attempt bound to the Job. */
	readonly attempt: number;
	/** Immutable Kubernetes Job UID stored by the run authority. */
	readonly workloadUid: string;
}

/** The stored workload facts the controller needs to unsuspend the Job and register its first Pod. */
export interface AgentControllerRunWorkloadReleaseProjection
{
	/** Logical run bound to the suspended Job. */
	readonly runId: string;
	/** Positive attempt number bound to the suspended Job. */
	readonly attempt: number;
	/** Silo authority containing the run. */
	readonly siloId: string;
	/** Stable AgentService executed by the Job. */
	readonly agentServiceId: string;
	/** Immutable AgentRevision executed by the Job. */
	readonly agentRevisionId: string;
	/** Kubernetes namespace containing the suspended Job. */
	readonly namespace: string;
	/** Bounded runtime-profile ServiceAccount selected when the assignment was committed. */
	readonly serviceAccountName: string;
	/** Immutable Kubernetes Job UID stored by the run authority. */
	readonly workloadUid: string;
	/** Immutable workload profile stored with the assignment. */
	readonly workloadProfile: string;
	/** UTC time after which this assignment no longer permits execution. */
	readonly assignmentExpiresAt: string;
	/** Stable opaque bootstrap reference projected into the Job; it grants no authority by itself. */
	readonly bootstrapReference: string;
}

/** A claimed request to unsuspend a Job and register its first Pod. */
export interface AgentControllerRunWorkloadReleaseClaim
{
	/** Claim proof that stops an older controller replica from acting on this event. */
	readonly lease: AgentControllerRunAttemptClaimLease;
	/** Exact durable assignment safe for the controller to reconcile. */
	readonly workload: AgentControllerRunWorkloadReleaseProjection;
}

/** What the controller sends back once the assigned Job has created its first Pod. */
export interface AgentControllerRunWorkloadRegistrationCommand
{
	/** Exact database claim instant returned by the release claim endpoint. */
	readonly claimedAt: string;
	/** Exact delivery generation returned by the release claim endpoint. */
	readonly deliveryCount: number;
	/** Logical run expected on the release event. */
	readonly runId: string;
	/** Attempt expected on the release event. */
	readonly attempt: number;
	/** Silo authority expected on the assignment. */
	readonly siloId: string;
	/** Stable AgentService expected on the assignment. */
	readonly agentServiceId: string;
	/** Immutable AgentRevision expected on the assignment. */
	readonly agentRevisionId: string;
	/** Namespace containing the assigned Job and its first Pod. */
	readonly namespace: string;
	/** ServiceAccount observed on the assigned Job and Pod. */
	readonly serviceAccountName: string;
	/** Immutable Kubernetes Job UID stored by the run authority. */
	readonly workloadUid: string;
	/** Immutable workload profile echoed from the release claim. */
	readonly workloadProfile: string;
	/** Exact opaque bootstrap reference projected into the Job. */
	readonly bootstrapReference: string;
	/** Immutable Kubernetes UID of the first Pod created for the Job. */
	readonly podUid: string;
}

/** Response to a first-Pod registration, whether it registered now or replayed an identical earlier call. */
export interface AgentControllerRunWorkloadRegistrationResult
{
	/** Whether this call registered the Pod or replayed its exact durable value. */
	readonly outcome: "registered" | "idempotent";
	/** Logical run bound to the Pod. */
	readonly runId: string;
	/** Attempt bound to the Pod. */
	readonly attempt: number;
	/** Immutable Kubernetes Job UID owning the Pod. */
	readonly workloadUid: string;
	/** Immutable Kubernetes Pod UID registered for the attempt. */
	readonly podUid: string;
}

/** Response after pruning delivered run-outbox rows; it reports a capped row count only. */
export interface AgentControllerRunOutboxPruneResult
{
	/** Number of retention-expired records removed in one transaction. */
	readonly deletedCount: number;
}
