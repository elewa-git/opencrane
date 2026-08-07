/** Sole projected-token audience accepted from the agent controller. */
export const AGENT_CONTROLLER_PROJECTED_TOKEN_AUDIENCE = "opencrane-agent-controller";

/** Exact Kubernetes ServiceAccount allowed to drive agent-workload reconciliation. */
export const AGENT_CONTROLLER_SERVICE_ACCOUNT_NAME = "agent-controller";

/** Stable cleanup projections persisted with runtime-workload outbox commands. */
export enum RunWorkloadCleanupModes
{
	/** Cleanup is fenced by an immutable Kubernetes Job UID from durable assignment. */
	Assigned = "assigned",
	/** Cleanup may adopt only the exact still-suspended Job created before assignment committed. */
	UnassignedOrphan = "unassigned_orphan",
}

/** Database-issued claim generation fencing one controller delivery attempt. */
export interface AgentControllerRunAttemptClaimLease
{
	/** Durable run-outbox event identifier. */
	readonly eventId: string;
	/** Exact database claim instant used as a compare-and-swap token. */
	readonly claimedAt: string;
	/** Monotonic delivery generation paired with the claim instant. */
	readonly deliveryCount: number;
	/** Database-derived instant after which another controller may reclaim the event. */
	readonly expiresAt: string;
}

/**
 * Attempt-scoped Obot key minted by the control plane at claim time.
 *
 * TRANSIENT ONLY: like the LiteLLM key, the value rides the claim HTTP response, is written straight
 * into the per-attempt Kubernetes Secret by the controller, and is never persisted to Postgres or
 * logged. The key is scoped to the exact Obot MCP server ids of the attempt's integration
 * assignments and expires with the assignment lease — never the Obot service credential.
 */
export interface AgentControllerObotAttemptKey
{
	/** Transient attempt-scoped Obot bearer key value; written only into the per-attempt Secret. */
	readonly key: string;
	/** Obot-minted key identifier stored beside the key for later revocation; not a credential. */
	readonly keyId: string;
}
/** Narrow desired-state projection needed to build one suspended runtime Job. */
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
	/** Digest of the immutable runtime input; the controller never receives its private body. */
	readonly inputSnapshotDigest: string;
	/** Exact Kubernetes namespace in which the attempt must run. */
	readonly namespace: string;
	/** Named bounded workload profile the controller must resolve. */
	readonly workloadProfile: string;
	/** Stable opaque bootstrap reference projected into the one-attempt Job; it is not a credential. */
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
	/**
	 * Attempt-scoped Obot key, present only when the run has integration assignments AND the Obot
	 * transport is composed. Absent means the attempt receives no Obot credential (feature off).
	 */
	readonly obotKey?: AgentControllerObotAttemptKey;
}

/** One claimed outbox command and its authorised suspended-Job projection. */
export interface AgentControllerRunAttemptClaim
{
	/** Claim generation that must accompany the eventual assignment commit. */
	readonly lease: AgentControllerRunAttemptClaimLease;
	/** Attempt coordinates safe to expose to the Kubernetes mutator. */
	readonly attempt: AgentControllerRunAttemptProjection;
}

/** Exact suspended Job evidence submitted for authoritative assignment. */
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

/** Successful or exact-idempotent assignment response. */
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

/** Immutable workload coordinates the controller must release and register. */
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
	/** Absolute canonical UTC instant after which the assignment grants no execution authority. */
	readonly assignmentExpiresAt: string;
	/** Stable opaque bootstrap reference projected into the Job; it grants no authority by itself. */
	readonly bootstrapReference: string;
	/**
	 * Whether the attempt was claimed with an Obot key, so the release reconciliation rebuilds the
	 * exact same Job shape (obot key volume and env present) that the assignment created.
	 */
	readonly obotKeyProvisioned?: boolean;
}

/** One leased request to unsuspend a Job and register its first Pod. */
export interface AgentControllerRunWorkloadReleaseClaim
{
	/** Claim generation that fences stale controller replicas. */
	readonly lease: AgentControllerRunAttemptClaimLease;
	/** Exact durable assignment safe for the controller to reconcile. */
	readonly workload: AgentControllerRunWorkloadReleaseProjection;
}

/** First-Pod evidence submitted after the assigned Job creates a Pod. */
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

/** Successful or exact-idempotent first-Pod registration response. */
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

/** Bounded response returned after delivered run-outbox maintenance. */
export interface AgentControllerRunOutboxPruneResult
{
	/** Number of retention-expired records removed in one transaction. */
	readonly deletedCount: number;
}
