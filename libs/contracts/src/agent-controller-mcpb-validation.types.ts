/**
 * Carries the database lease for one MCP bundle inspection job claimed by the agent controller.
 *
 * The controller must return the claim timestamp and delivery count when it records a Job UID. Once
 * the lease expires, those fields can no longer authorise that assignment.
 */
export interface AgentControllerMcpbValidationClaim
{
	/** Identifies the saved inspection job for the later assignment call. */
	readonly workloadId: string;
	/** Identifies the silo that owns the bundle validation. */
	readonly siloId: string;
	/** Identifies the validation used to derive the Kubernetes Job name. */
	readonly validationId: string;
	/** Records when the database granted this controller's claim. */
	readonly claimedAt: string;
	/** Increases when the database grants the work to another controller pass. */
	readonly deliveryCount: number;
	/** Records when this claim stops permitting a Job assignment. */
	readonly expiresAt: string;
}

/**
 * Carries the claim fence and Kubernetes Job UID that the controller submits for one inspection job.
 *
 * The command deliberately excludes workload selection fields: the server selected the workload when
 * it issued the claim, and the strict parser rejects additional caller fields.
 */
export interface AgentControllerMcpbValidationAssignmentCommand
{
	/** Repeats the database time from the claim. */
	readonly claimedAt: string;
	/** Repeats the database counter from the claim. */
	readonly deliveryCount: number;
	/** Identifies the immutable suspended Kubernetes Job that the controller created. */
	readonly workloadUid: string;
}

/**
 * Carries the saved result of a matching MCP bundle inspection Job assignment.
 *
 * `assigned` means this request saved the Job UID; `idempotent` means the same UID was already
 * saved. The controller must verify the echoed workload and Job IDs before trusting either outcome.
 */
export interface AgentControllerMcpbValidationAssignmentResult
{
	/** Says whether this request saved the assignment or returned the earlier matching assignment. */
	readonly outcome: "assigned" | "idempotent";
	/** Identifies the saved inspection job. */
	readonly workloadId: string;
	/** Identifies the Kubernetes Job saved for that inspection job. */
	readonly workloadUid: string;
}
