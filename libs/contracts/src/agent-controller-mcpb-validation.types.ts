/** A saved MCP bundle inspection job claimed by the agent controller. */
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

/** The Kubernetes Job evidence the controller sends back for one saved claim. */
export interface AgentControllerMcpbValidationAssignmentCommand
{
	/** Repeats the database time from the claim. */
	readonly claimedAt: string;
	/** Repeats the database counter from the claim. */
	readonly deliveryCount: number;
	/** Identifies the immutable suspended Kubernetes Job that the controller created. */
	readonly workloadUid: string;
}

/** The server response after it saves, or replays, a matching Job assignment. */
export interface AgentControllerMcpbValidationAssignmentResult
{
	/** Says whether this request saved the assignment or returned the earlier matching assignment. */
	readonly outcome: "assigned" | "idempotent";
	/** Identifies the saved inspection job. */
	readonly workloadId: string;
	/** Identifies the Kubernetes Job saved for that inspection job. */
	readonly workloadUid: string;
}
